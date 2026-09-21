/**
 * SHOPIFY GRAPHQL CLIENT TEST SUITE
 * ==================================
 * Valida el transporte GraphQL Admin API (versión fija 2026-07), timeouts,
 * throttling en HTTP 429 y HTTP 200 con extensions.code = "THROTTLED",
 * costo de consultas y redacción total de credenciales en errores.
 */

import assert from 'node:assert';
import { executeShopifyGraphql } from './src/services/integrations/shopify/shopifyGraphqlClient.js';
import {
  ShopifyTimeoutError,
  ShopifyThrottledError,
  ShopifyGraphqlError,
  ShopifyAuthError,
  ShopifyIntegrationNotConnectedError,
  ShopifyError,
} from './src/services/integrations/shopify/shopifyErrors.js';
import { persistConnectedTokens } from './src/services/integrations/shopify/shopifyTokenService.js';

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

function createMockPrisma() {
  const store = new Map();
  return {
    _store: store,
    integration: {
      async upsert({ where, update, create }) {
        const key = `${where.tenantId_provider.tenantId}_${where.tenantId_provider.provider}`;
        const merged = { ...(store.get(key) || {}), ...(store.has(key) ? update : create) };
        store.set(key, merged);
        return merged;
      },
      async findUnique({ where }) {
        const key = `${where.tenantId_provider.tenantId}_${where.tenantId_provider.provider}`;
        return store.get(key) || null;
      },
      async update({ where, data }) {
        const key = `${where.tenantId_provider.tenantId}_${where.tenantId_provider.provider}`;
        const existing = store.get(key) || {};
        const updated = { ...existing, ...data };
        store.set(key, updated);
        return updated;
      },
    },
  };
}

console.log('======================================================================');
console.log('🧪 VELION SHOPIFY GRAPHQL CLIENT (API 2026-07) SUITE');
console.log('======================================================================\n');

(async () => {
  const mockPrisma = createMockPrisma();

  // Configurar tenant con integración activa
  await persistConnectedTokens({
    tenantId: 'tenant_gql_1',
    shopDomain: 'tienda-gql.myshopify.com',
    tokenData: {
      accessToken: 'shpat_synthetic_active_token_xyz',
      refreshToken: 'shprt_refresh_xyz',
      expiresIn: 3600,
    },
    prismaClient: mockPrisma,
  });

  // ── TEST 1: Endpoint usa versión congelada 2026-07 y cabeceras correctas ───
  await runTest('TEST 1: executeShopifyGraphql envía petición a endpoint 2026-07 con X-Shopify-Access-Token', async () => {
    let capturedUrl = null;
    let capturedHeaders = null;
    let capturedBody = null;

    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedHeaders = options.headers;
      capturedBody = JSON.parse(options.body);

      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: { shop: { name: 'Mi Tienda Test' } },
          extensions: {
            cost: {
              requestedQueryCost: 1,
              actualQueryCost: 1,
              throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 1999, restoreRate: 100 },
            },
          },
        }),
      };
    };

    const res = await executeShopifyGraphql('tenant_gql_1', {
      query: '{ shop { name } }',
      fetchFn: mockFetch,
      prismaClient: mockPrisma,
    });

    assert.strictEqual(capturedUrl, 'https://tienda-gql.myshopify.com/admin/api/2026-07/graphql.json');
    assert.strictEqual(capturedHeaders['X-Shopify-Access-Token'], 'shpat_synthetic_active_token_xyz');
    assert.strictEqual(capturedHeaders['Content-Type'], 'application/json');
    assert.strictEqual(capturedBody.query, '{ shop { name } }');
    assert.strictEqual(res.data.shop.name, 'Mi Tienda Test');
    assert.strictEqual(res.cost.actualQueryCost, 1);
  });

  // ── TEST 2: Throttling en HTTP 200 con errors[].extensions.code = THROTTLED ──
  await runTest('TEST 2: Detección de throttling en HTTP 200 (errors[].extensions.code = THROTTLED)', async () => {
    let callCount = 0;

    const mockFetchThrottled = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            errors: [
              {
                message: 'Throttled',
                extensions: { code: 'THROTTLED' },
              },
            ],
            extensions: {
              cost: {
                requestedQueryCost: 50,
                actualQueryCost: 0,
                throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 10, restoreRate: 100 },
              },
            },
          }),
        };
      }

      // Segundo intento: éxito
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: { products: { edges: [] } },
          extensions: {
            cost: {
              requestedQueryCost: 50,
              actualQueryCost: 10,
              throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 1950, restoreRate: 100 },
            },
          },
        }),
      };
    };

    const res = await executeShopifyGraphql('tenant_gql_1', {
      query: 'query GetProducts { products(first: 10) { edges { node { id } } } }',
      maxRetries: 1,
      fetchFn: mockFetchThrottled,
      prismaClient: mockPrisma,
    });

    assert.strictEqual(callCount, 2, 'Debe haber reintentado tras recibir THROTTLED en query read-only');
    assert.ok(res.data.products);
  });

  // ── TEST 3: Mutación throttled NO se reintenta a ciegas ─────────────────────
  await runTest('TEST 3: Mutaciones throttled lanzan ShopifyThrottledError sin reintento ciego', async () => {
    let callCount = 0;

    const mockFetchMutationThrottled = async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          errors: [
            {
              message: 'Throttled',
              extensions: { code: 'THROTTLED' },
            },
          ],
        }),
      };
    };

    await assert.rejects(
      async () => {
        await executeShopifyGraphql('tenant_gql_1', {
          query: 'mutation draftOrderCreate($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id } } }',
          maxRetries: 2,
          fetchFn: mockFetchMutationThrottled,
          prismaClient: mockPrisma,
        });
      },
      (err) => err instanceof ShopifyThrottledError
    );

    assert.strictEqual(callCount, 1, 'Mutación NUNCA debe reintentarse ciegamente ante throttling');
  });

  // ── TEST 4: Cancelación limpia ante timeout vía AbortSignal ────────────────
  await runTest('TEST 4: Timeout controlado lanza ShopifyTimeoutError mediante AbortSignal', async () => {
    const mockFetchSlow = async (url, options) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve({ ok: true, text: async () => '{}' });
        }, 500);

        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            const abortErr = new Error('The operation was aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        }
      });
    };

    await assert.rejects(
      async () => {
        await executeShopifyGraphql('tenant_gql_1', {
          query: '{ shop { name } }',
          timeoutMs: 50, // Timeout muy corto
          fetchFn: mockFetchSlow,
          prismaClient: mockPrisma,
        });
      },
      (err) => err instanceof ShopifyTimeoutError
    );
  });

  // ── TEST 5: HTTP 401 lanza ShopifyAuthError ────────────────────────────────
  await runTest('TEST 5: HTTP 401 Unauthorized lanza ShopifyAuthError', async () => {
    const mockFetch401 = async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ errors: '[API] Invalid API key or access token' }),
    });

    await assert.rejects(
      async () => {
        await executeShopifyGraphql('tenant_gql_1', {
          query: '{ shop { name } }',
          fetchFn: mockFetch401,
          prismaClient: mockPrisma,
        });
      },
      (err) => err instanceof ShopifyAuthError
    );
  });

  // ── TEST 6: Tenant no conectado lanza ShopifyIntegrationNotConnectedError ─
  await runTest('TEST 6: Tenant sin integración configurada es rechazado fail-closed', async () => {
    await assert.rejects(
      async () => {
        await executeShopifyGraphql('tenant_inexistente', {
          query: '{ shop { name } }',
          prismaClient: mockPrisma,
        });
      },
      (err) => err instanceof ShopifyIntegrationNotConnectedError
    );
  });

  // ── TEST 7: Auditoría de no filtración de valores de secretos en errores ────
  await runTest('TEST 7: Redacción estricta: tokens y secrets nunca se filtran en mensajes de error', () => {
    const syntheticToken = 'sh' + 'pat_' + '0123456789abcdef0123456789abcdef';
    const rawError = `Failed to connect with token ${syntheticToken} and secret client_secret=very_secret_key`;

    const genericErr = new ShopifyError(rawError);
    assert.ok(!genericErr.message.includes(syntheticToken), 'El token sintético no debe aparecer en el mensaje');
    assert.ok(genericErr.message.includes('[REDACTED_ACCESS_TOKEN]'));
    assert.ok(genericErr.message.includes('client_secret=[REDACTED]'));

    const gqlErr = new ShopifyGraphqlError([{ message: rawError }]);
    assert.ok(!JSON.stringify(gqlErr.details).includes(syntheticToken), 'El token sintético no debe aparecer en details');
    assert.ok(gqlErr.details[0].message.includes('[REDACTED_ACCESS_TOKEN]'));
    assert.ok(gqlErr.details[0].message.includes('client_secret=[REDACTED]'));
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE SHOPIFY GRAPHQL CLIENT: ${passedTests}/${totalTests} TESTS PASARON`);
  console.log('======================================================================\n');
})();
