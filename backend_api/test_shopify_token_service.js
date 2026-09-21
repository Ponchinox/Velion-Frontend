/**
 * SHOPIFY TOKEN SERVICE TEST SUITE
 * =================================
 * Valida el ciclo de vida de tokens: cifrado en reposo AES-256-GCM, rotación atómica,
 * semántica oficial de errores (401 invalid_request), concurrencia (coalescing) y desconexión segura.
 */

import assert from 'node:assert';
import {
  persistConnectedTokens,
  getValidAccessToken,
  refreshAccessToken,
  disconnectIntegration,
  REFRESH_BUFFER_MS,
} from './src/services/integrations/shopify/shopifyTokenService.js';
import {
  ShopifyReauthRequiredError,
  ShopifyNetworkError,
  ShopifyDomainConflictError,
  ShopifyIntegrationNotConnectedError,
} from './src/services/integrations/shopify/shopifyErrors.js';
import { decryptText } from './src/utils/cryptoUtils.js';

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}:`, err.message);
    throw err;
  }
}

process.env.JWT_SECRET = 'test_secret_key_for_jwt_which_is_at_least_32_characters_long_123';
process.env.SHOPIFY_CLIENT_ID = 'test_client_id';
process.env.SHOPIFY_CLIENT_SECRET = 'test_client_secret';

// Mock in-memory de Prisma Integration model
function createMockPrisma() {
  const store = new Map();

  return {
    _store: store,
    integration: {
      async upsert({ where, update, create }) {
        const key = `${where.tenantId_provider.tenantId}_${where.tenantId_provider.provider}`;
        // Validar unicidad de shopDomain entre tenants
        const shopDomain = update?.shopDomain || create?.shopDomain;
        if (shopDomain) {
          for (const [k, v] of store.entries()) {
            if (k !== key && v.shopDomain === shopDomain && v.status === 'CONNECTED') {
              const err = new Error('Unique constraint failed on shopDomain');
              err.code = 'P2002';
              throw err;
            }
          }
        }

        const existing = store.get(key) || {};
        const merged = {
          ...existing,
          ...(store.has(key) ? update : create),
          id: existing.id || 'int_' + Math.random().toString(36).slice(2),
          updatedAt: new Date(),
        };
        store.set(key, merged);
        return merged;
      },

      async findUnique({ where }) {
        const key = `${where.tenantId_provider.tenantId}_${where.tenantId_provider.provider}`;
        return store.get(key) || null;
      },

      async update({ where, data }) {
        const key = `${where.tenantId_provider.tenantId}_${where.tenantId_provider.provider}`;
        const existing = store.get(key);
        if (!existing) throw new Error('Record not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        store.set(key, updated);
        return updated;
      },
    },
  };
}

console.log('======================================================================');
console.log('🧪 VELION SHOPIFY TOKEN SERVICE & CONCURRENCY SUITE');
console.log('======================================================================\n');

(async () => {
  // ── TEST 1: Cifrado en reposo AES-256-GCM ──────────────────────────────────
  await runTest('TEST 1: persistConnectedTokens cifra access y refresh tokens en reposo con AES-256-GCM', async () => {
    const mockPrisma = createMockPrisma();
    const tokenData = {
      accessToken: 'shpat_secret_access_token_123',
      refreshToken: 'shprt_secret_refresh_token_456',
      expiresIn: 3600,
      refreshTokenExpiresIn: 7776000,
      scopes: ['read_products', 'read_inventory', 'write_draft_orders'],
    };

    const saved = await persistConnectedTokens({
      tenantId: 'tenant_t1',
      shopDomain: 'tienda-cifrada.myshopify.com',
      tokenData,
      prismaClient: mockPrisma,
    });

    // Validar que no está en texto plano
    assert.notStrictEqual(saved.encryptedAccessToken, tokenData.accessToken);
    assert.notStrictEqual(saved.encryptedRefreshToken, tokenData.refreshToken);
    assert.ok(saved.encryptedAccessToken.includes(':'), 'Debe tener formato iv:authTag:encrypted');
    assert.ok(saved.encryptedRefreshToken.includes(':'), 'Debe tener formato iv:authTag:encrypted');

    // Validar que se descifra exactamente al valor original
    assert.strictEqual(decryptText(saved.encryptedAccessToken), tokenData.accessToken);
    assert.strictEqual(decryptText(saved.encryptedRefreshToken), tokenData.refreshToken);
    assert.strictEqual(saved.status, 'CONNECTED');
    assert.ok(saved.accessTokenExpiresAt instanceof Date);
    assert.ok(saved.refreshTokenExpiresAt instanceof Date);
  });

  // ── TEST 2: Reutilización de token vigente ──────────────────────────────────
  await runTest('TEST 2: getValidAccessToken reutiliza token vigente (>5 min) sin llamar a Shopify', async () => {
    const mockPrisma = createMockPrisma();
    let shopifyHttpCalled = false;

    // Guardar token con 30 minutos de vigencia restante
    await persistConnectedTokens({
      tenantId: 'tenant_t2',
      shopDomain: 'tienda-vigente.myshopify.com',
      tokenData: {
        accessToken: 'shpat_active_token_999',
        refreshToken: 'shprt_active_refresh_888',
        expiresIn: 1800, // 30 minutos
        scopes: ['read_products'],
      },
      prismaClient: mockPrisma,
    });

    const mockFetch = async () => {
      shopifyHttpCalled = true;
      throw new Error('No debería haberse invocado fetch a Shopify');
    };

    const token = await getValidAccessToken('tenant_t2', {
      prismaClient: mockPrisma,
      fetchFn: mockFetch,
    });

    assert.strictEqual(token, 'shpat_active_token_999');
    assert.strictEqual(shopifyHttpCalled, false, 'No debe invocar refresco si el token está vigente');
  });

  // ── TEST 3: Refresco preventivo ante expiración ─────────────────────────────
  await runTest('TEST 3: getValidAccessToken refresca token si está en ventana preventiva (<5 min)', async () => {
    const mockPrisma = createMockPrisma();
    let refreshCalls = 0;

    // Guardar token a punto de expirar (en 2 minutos, dentro del margen de 5 min)
    await persistConnectedTokens({
      tenantId: 'tenant_t3',
      shopDomain: 'tienda-expirando.myshopify.com',
      tokenData: {
        accessToken: 'shpat_old_token_111',
        refreshToken: 'shprt_refresh_222',
        expiresIn: 120, // 2 minutos (menor que REFRESH_BUFFER_MS)
        scopes: ['read_products'],
      },
      prismaClient: mockPrisma,
    });

    const mockFetch = async (url, options) => {
      refreshCalls++;
      const body = JSON.parse(options.body);
      assert.strictEqual(body.grant_type, 'refresh_token');
      assert.strictEqual(body.refresh_token, 'shprt_refresh_222');

      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          access_token: 'shpat_new_refreshed_token_333',
          refresh_token: 'shprt_new_rotated_refresh_444',
          expires_in: 3600,
          refresh_token_expires_in: 7776000,
        }),
      };
    };

    const token = await getValidAccessToken('tenant_t3', {
      prismaClient: mockPrisma,
      fetchFn: mockFetch,
    });

    assert.strictEqual(token, 'shpat_new_refreshed_token_333');
    assert.strictEqual(refreshCalls, 1);

    // Verificar rotación atómica en BD
    const inDb = await mockPrisma.integration.findUnique({
      where: { tenantId_provider: { tenantId: 'tenant_t3', provider: 'SHOPIFY' } },
    });
    assert.strictEqual(decryptText(inDb.encryptedAccessToken), 'shpat_new_refreshed_token_333');
    assert.strictEqual(decryptText(inDb.encryptedRefreshToken), 'shprt_new_rotated_refresh_444');
  });

  // ── TEST 4: Semántica de Error Terminal (HTTP 401 invalid_request) ──────────
  await runTest('TEST 4: Error 401 invalid_request marca status=ERROR, preserva historial y shopDomain', async () => {
    const mockPrisma = createMockPrisma();

    await persistConnectedTokens({
      tenantId: 'tenant_t4',
      shopDomain: 'tienda-revocada.myshopify.com',
      tokenData: {
        accessToken: 'shpat_revoked_token',
        refreshToken: 'shprt_revoked_refresh',
        expiresIn: -10, // Ya expirado
      },
      prismaClient: mockPrisma,
    });

    const mockFetch401 = async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: 'invalid_request', error_description: 'The refresh token has expired.' }),
    });

    await assert.rejects(
      async () => {
        await getValidAccessToken('tenant_t4', {
          prismaClient: mockPrisma,
          fetchFn: mockFetch401,
        });
      },
      (err) => err instanceof ShopifyReauthRequiredError
    );

    // Validar estado en BD
    const inDb = await mockPrisma.integration.findUnique({
      where: { tenantId_provider: { tenantId: 'tenant_t4', provider: 'SHOPIFY' } },
    });
    assert.strictEqual(inDb.status, 'ERROR');
    assert.strictEqual(inDb.lastSyncError, 'REAUTH_REQUIRED');
    assert.strictEqual(inDb.shopDomain, 'tienda-revocada.myshopify.com', 'Debe conservar shopDomain');
    assert.strictEqual(inDb.encryptedAccessToken, null, 'Debe limpiar encryptedAccessToken');
    assert.strictEqual(inDb.encryptedRefreshToken, null, 'Debe limpiar encryptedRefreshToken');
    assert.strictEqual(inDb.accessTokenExpiresAt, null, 'Debe limpiar accessTokenExpiresAt');
    assert.strictEqual(inDb.refreshTokenExpiresAt, null, 'Debe limpiar refreshTokenExpiresAt');
  });

  // ── TEST 5: Error Transitorio 5xx no desconecta la tienda ───────────────────
  await runTest('TEST 5: Error transitorio HTTP 500 ejecuta reintentos sin marcar status=ERROR ni DISCONNECTED', async () => {
    const mockPrisma = createMockPrisma();
    let attempts = 0;

    await persistConnectedTokens({
      tenantId: 'tenant_t5',
      shopDomain: 'tienda-5xx.myshopify.com',
      tokenData: {
        accessToken: 'shpat_t5_token',
        refreshToken: 'shprt_t5_refresh',
        expiresIn: 0,
      },
      prismaClient: mockPrisma,
    });

    const mockFetch500 = async () => {
      attempts++;
      return {
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      };
    };

    await assert.rejects(
      async () => {
        await getValidAccessToken('tenant_t5', {
          prismaClient: mockPrisma,
          fetchFn: mockFetch500,
        });
      },
      (err) => err instanceof ShopifyNetworkError
    );

    assert.strictEqual(attempts, 3, 'Debe haber realizado 3 intentos con backoff');

    const inDb = await mockPrisma.integration.findUnique({
      where: { tenantId_provider: { tenantId: 'tenant_t5', provider: 'SHOPIFY' } },
    });
    assert.strictEqual(inDb.status, 'CONNECTED', 'No debe desconectar ante error transitorio');
  });

  // ── TEST 6: Coalescing de concurrencia en memoria ───────────────────────────
  await runTest('TEST 6: Coalescing en memoria: múltiples peticiones concurrentes disparan 1 solo refresco', async () => {
    const mockPrisma = createMockPrisma();
    let httpCalls = 0;

    await persistConnectedTokens({
      tenantId: 'tenant_t6',
      shopDomain: 'tienda-coalescing.myshopify.com',
      tokenData: {
        accessToken: 'shpat_coalesce_old',
        refreshToken: 'shprt_coalesce_refresh',
        expiresIn: 0,
      },
      prismaClient: mockPrisma,
    });

    const mockFetchSlow = async () => {
      httpCalls++;
      await new Promise((r) => setTimeout(r, 50)); // Simular latencia de red
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          access_token: 'shpat_coalesced_new_token',
          refresh_token: 'shprt_coalesced_new_refresh',
          expires_in: 3600,
        }),
      };
    };

    // Disparar 5 peticiones simultáneas
    const promises = Array.from({ length: 5 }, () =>
      getValidAccessToken('tenant_t6', {
        prismaClient: mockPrisma,
        fetchFn: mockFetchSlow,
      })
    );

    const results = await Promise.all(promises);

    // Todas deben obtener el mismo token refrescado
    for (const res of results) {
      assert.strictEqual(res, 'shpat_coalesced_new_token');
    }
    assert.strictEqual(httpCalls, 1, 'Solo debe haberse ejecutado 1 llamada HTTP a Shopify para los 5 concurrentes');
  });

  // ── TEST 7: Desconexión normal preserva shopDomain ──────────────────────────
  await runTest('TEST 7: Desconexión normal borra tokens pero preserva shopDomain', async () => {
    const mockPrisma = createMockPrisma();

    await persistConnectedTokens({
      tenantId: 'tenant_t7',
      shopDomain: 'tienda-desconectar.myshopify.com',
      tokenData: {
        accessToken: 'shpat_t7',
        refreshToken: 'shprt_t7',
        expiresIn: 3600,
      },
      prismaClient: mockPrisma,
    });

    await disconnectIntegration({
      tenantId: 'tenant_t7',
      releaseDomain: false,
      prismaClient: mockPrisma,
    });

    const inDb = await mockPrisma.integration.findUnique({
      where: { tenantId_provider: { tenantId: 'tenant_t7', provider: 'SHOPIFY' } },
    });
    assert.strictEqual(inDb.status, 'DISCONNECTED');
    assert.strictEqual(inDb.encryptedAccessToken, null);
    assert.strictEqual(inDb.encryptedRefreshToken, null);
    assert.strictEqual(inDb.shopDomain, 'tienda-desconectar.myshopify.com');
  });

  // ── TEST 8: Desconexión con release fija shopDomain=null ────────────────────
  await runTest('TEST 8: Desconexión con releaseDomain=true fija shopDomain=null', async () => {
    const mockPrisma = createMockPrisma();

    await persistConnectedTokens({
      tenantId: 'tenant_t8',
      shopDomain: 'tienda-release.myshopify.com',
      tokenData: {
        accessToken: 'shpat_t8',
        refreshToken: 'shprt_t8',
        expiresIn: 3600,
      },
      prismaClient: mockPrisma,
    });

    await disconnectIntegration({
      tenantId: 'tenant_t8',
      releaseDomain: true,
      prismaClient: mockPrisma,
    });

    const inDb = await mockPrisma.integration.findUnique({
      where: { tenantId_provider: { tenantId: 'tenant_t8', provider: 'SHOPIFY' } },
    });
    assert.strictEqual(inDb.status, 'DISCONNECTED');
    assert.strictEqual(inDb.shopDomain, null);
  });

  // ── TEST 9: Conflicto de dominio (P2002) lanza error tipado ─────────────────
  await runTest('TEST 9: persistConnectedTokens en dominio ya ocupado por otro tenant lanza ShopifyDomainConflictError', async () => {
    const mockPrisma = createMockPrisma();

    // Tenant A conecta la tienda
    await persistConnectedTokens({
      tenantId: 'tenant_A',
      shopDomain: 'tienda-compartida.myshopify.com',
      tokenData: { accessToken: 'token_A', expiresIn: 3600 },
      prismaClient: mockPrisma,
    });

    // Tenant B intenta conectar la misma tienda
    await assert.rejects(
      async () => {
        await persistConnectedTokens({
          tenantId: 'tenant_B',
          shopDomain: 'tienda-compartida.myshopify.com',
          tokenData: { accessToken: 'token_B', expiresIn: 3600 },
          prismaClient: mockPrisma,
        });
      },
      (err) => err instanceof ShopifyDomainConflictError
    );
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE SHOPIFY TOKEN SERVICE: ${passedTests}/${totalTests} TESTS PASARON`);
  console.log('======================================================================\n');
})();
