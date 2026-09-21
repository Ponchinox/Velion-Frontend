/**
 * SHOPIFY CONTROLLER & ROUTES SECURITY TEST SUITE
 * ================================================
 * Valida los endpoints de la API: frontera de autenticación del callback (sin JWT),
 * consumo y limpieza de cookies de un solo uso, HMAC y protección contra fugas de tokens.
 */

import assert from 'node:assert';
import crypto from 'crypto';
import {
  getShopifyStatus,
  connectShopify,
  handleShopifyCallback,
  disconnectShopify,
} from './src/controllers/shopifyController.js';
import {
  buildAuthorizationUrl,
  OAUTH_COOKIE_NAME,
} from './src/services/integrations/shopify/shopifyOAuthService.js';
import { persistConnectedTokens } from './src/services/integrations/shopify/shopifyTokenService.js';
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
process.env.SHOPIFY_CLIENT_ID = 'test_client_id_controller';
process.env.SHOPIFY_CLIENT_SECRET = 'test_client_secret_controller';
process.env.SHOPIFY_REDIRECT_URI = 'https://velion.test/api/integrations/shopify/callback';

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
      async findFirst({ where }) {
        for (const item of store.values()) {
          if (where.provider && item.provider !== where.provider) continue;
          if (where.shopDomain && item.shopDomain !== where.shopDomain) continue;
          if (where.status && item.status !== where.status) continue;
          if (where.NOT?.tenantId && item.tenantId === where.NOT.tenantId) continue;
          return item;
        }
        return null;
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

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    cookies: {},
    clearedCookies: {},
    redirectUrl: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    cookie(name, val, opts) {
      this.cookies[name] = { val, opts };
      return this;
    },
    clearCookie(name, opts) {
      this.clearedCookies[name] = opts;
      delete this.cookies[name];
      return this;
    },
    redirect(url) {
      this.redirectUrl = url;
      return this;
    },
  };
}

console.log('======================================================================');
console.log('🧪 VELION SHOPIFY CONTROLLER & ROUTE SECURITY SUITE');
console.log('======================================================================\n');

(async () => {
  // ── TEST 1: getShopifyStatus devuelve información segura sin tokens ─────────
  await runTest('TEST 1: getShopifyStatus nunca expone tokens ni claves en la respuesta', async () => {
    const mockPrisma = createMockPrisma();
    await persistConnectedTokens({
      tenantId: 'tenant_ctrl_1',
      shopDomain: 'tienda-status.myshopify.com',
      tokenData: {
        accessToken: 'shpat_super_secret_access_token_hidden',
        refreshToken: 'shprt_super_secret_refresh_token_hidden',
        expiresIn: 3600,
        scopes: ['read_products'],
      },
      prismaClient: mockPrisma,
    });

    const req = { user: { tenantId: 'tenant_ctrl_1' } };
    const res = mockResponse();

    // Inyectar mockPrisma temporalmente reemplazando el global
    const originalPrisma = (await import('./src/db.js')).default;
    const oldFindUnique = originalPrisma.integration.findUnique;
    originalPrisma.integration.findUnique = mockPrisma.integration.findUnique;

    try {
      await getShopifyStatus(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.provider, 'SHOPIFY');
      assert.strictEqual(res.body.status, 'CONNECTED');
      assert.strictEqual(res.body.shopDomain, 'tienda-status.myshopify.com');

      // Validar que NINGÚN token aparece en el cuerpo de respuesta
      const jsonStr = JSON.stringify(res.body);
      assert.ok(!jsonStr.includes('shpat_'));
      assert.ok(!jsonStr.includes('shprt_'));
      assert.strictEqual(res.body.encryptedAccessToken, undefined);
      assert.strictEqual(res.body.encryptedRefreshToken, undefined);
    } finally {
      originalPrisma.integration.findUnique = oldFindUnique;
    }
  });

  // ── TEST 2: connectShopify fija cookie HttpOnly y devuelve authUrl ──────────
  await runTest('TEST 2: connectShopify fija cookie HttpOnly SameSite=Lax y genera authUrl segura', async () => {
    const originalPrisma = (await import('./src/db.js')).default;
    const oldFindFirst = originalPrisma.integration.findFirst;
    originalPrisma.integration.findFirst = async () => null; // Tienda libre

    const req = {
      user: { tenantId: 'tenant_ctrl_2', userId: 'user_ctrl_2' },
      body: { shopDomain: 'mitienda-nueva.myshopify.com' },
    };
    const res = mockResponse();

    try {
      await connectShopify(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.authUrl.includes('mitienda-nueva.myshopify.com'));
      assert.ok(res.cookies[OAUTH_COOKIE_NAME]);
      assert.strictEqual(res.cookies[OAUTH_COOKIE_NAME].opts.httpOnly, true);
      assert.strictEqual(res.cookies[OAUTH_COOKIE_NAME].opts.sameSite, 'lax');
    } finally {
      originalPrisma.integration.findFirst = oldFindFirst;
    }
  });

  // ── TEST 3: connectShopify rechaza si tienda ya está ocupada por otro tenant 
  await runTest('TEST 3: connectShopify rechaza con HTTP 409 si la tienda pertenece a otro tenant', async () => {
    const originalPrisma = (await import('./src/db.js')).default;
    const oldFindFirst = originalPrisma.integration.findFirst;
    // Simular que la tienda ya está tomada por tenant_otro
    originalPrisma.integration.findFirst = async () => ({ id: 'int_existing', tenantId: 'tenant_otro' });

    const req = {
      user: { tenantId: 'tenant_ctrl_3', userId: 'user_ctrl_3' },
      body: { shopDomain: 'tienda-ocupada.myshopify.com' },
    };
    const res = mockResponse();

    try {
      await connectShopify(req, res);
      assert.strictEqual(res.statusCode, 409);
      assert.ok(res.body.error.includes('ya está conectada a otra cuenta'));
    } finally {
      originalPrisma.integration.findFirst = oldFindFirst;
    }
  });

  // ── TEST 4: handleShopifyCallback sin JWT pero con HMAC y state válidos ─────
  await runTest('TEST 4: handleShopifyCallback autentica sin JWT (Callback Boundary), limpia cookie y redirige', async () => {
    const originalPrisma = (await import('./src/db.js')).default;
    const mockPrisma = createMockPrisma();
    const oldUpsert = originalPrisma.integration.upsert;
    originalPrisma.integration.upsert = mockPrisma.integration.upsert;

    // Generar state y nonce válidos
    const { state, nonce } = buildAuthorizationUrl({
      shopDomain: 'tienda-callback.myshopify.com',
      tenantId: 'tenant_authed_via_state',
      userId: 'user_authed_via_state',
    });

    const code = 'valid_oauth_code_xyz';
    const shop = 'tienda-callback.myshopify.com';
    const timestamp = '1726851234';

    // Construir HMAC legítimo
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    const message = `code=${code}&shop=${shop}&state=${state}&timestamp=${timestamp}`;
    const hmac = crypto.createHmac('sha256', clientSecret).update(message).digest('hex');

    // Mock global fetch para el token exchange
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          access_token: 'shpat_callback_test_token',
          refresh_token: 'shprt_callback_refresh_token',
          expires_in: 3600,
          refresh_token_expires_in: 7776000,
          scope: 'read_products,read_inventory,write_draft_orders',
        }),
      };
    };

    const req = {
      query: { code, shop, state, timestamp, hmac },
      headers: { cookie: `${OAUTH_COOKIE_NAME}=${nonce}` },
      // Observa: ¡req.user NO existe! Este endpoint no requiere Bearer token.
    };
    const res = mockResponse();

    try {
      await handleShopifyCallback(req, res);

      // Debe redirigir al frontend
      assert.ok(res.redirectUrl);
      assert.ok(res.redirectUrl.includes('shopify=connected'));

      // La cookie debe haberse limpiado de inmediato (Single-Use)
      assert.ok(res.clearedCookies[OAUTH_COOKIE_NAME], 'La cookie shopify_oauth_nonce debe ser limpiada');

      // Validar que se persistió para el tenant extraído exclusivamente del state
      const inDb = await mockPrisma.integration.findUnique({
        where: { tenantId_provider: { tenantId: 'tenant_authed_via_state', provider: 'SHOPIFY' } },
      });
      assert.ok(inDb);
      assert.strictEqual(inDb.status, 'CONNECTED');
      assert.strictEqual(decryptText(inDb.encryptedAccessToken), 'shpat_callback_test_token');
    } finally {
      originalPrisma.integration.upsert = oldUpsert;
      globalThis.fetch = originalFetch;
    }
  });

  // ── TEST 5: handleShopifyCallback rechaza si cookie ya fue consumida (Replay)
  await runTest('TEST 5: handleShopifyCallback rechaza peticiones de replay sin cookie nonce', async () => {
    const { state } = buildAuthorizationUrl({
      shopDomain: 'tienda-replay.myshopify.com',
      tenantId: 'tenant_replay',
      userId: 'user_replay',
    });

    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    const message = `code=some_code&shop=tienda-replay.myshopify.com&state=${state}`;
    const hmac = crypto.createHmac('sha256', clientSecret).update(message).digest('hex');

    const req = {
      query: { code: 'some_code', shop: 'tienda-replay.myshopify.com', state, hmac },
      headers: {}, // Sin cookie (ya consumida o sesión ajena)
    };
    const res = mockResponse();

    await handleShopifyCallback(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.error.includes('Cookie de sesión OAuth no encontrada'));
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE SHOPIFY CONTROLLER & SECURITY: ${passedTests}/${totalTests} TESTS PASARON`);
  console.log('======================================================================\n');
})();
