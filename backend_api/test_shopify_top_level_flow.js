/**
 * TEST E2E: NAVEGACIÓN TOP-LEVEL PARA SHOPIFY OAUTH Y PREVENCIÓN CSRF
 * ==================================================================
 * Valida el nuevo flujo de navegación top-level directa:
 * 1. GET /api/integrations/shopify/connect?shop=...&token=...&returnTo=...
 *    -> Emite Set-Cookie SameSite=Lax HttpOnly Secure
 *    -> Responde 302 directamente a la URL de autorización de Shopify
 * 2. GET /api/integrations/shopify/callback?code=...&shop=...&state=...&hmac=...
 *    -> Con cookie: 302 Redirect a https://velion-agent.vercel.app/integraciones/shopify?shopify=connected&shop=...
 *    -> Sin cookie: 400 Bad Request { code: 'CSRF_DETECTED' }
 */

import assert from 'assert';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'supersecreto_test_production_jwt_key_32c';
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SHOPIFY_CLIENT_ID = 'shopify_client_id_test';
process.env.SHOPIFY_CLIENT_SECRET = 'shopify_client_secret_test_very_secure_string';
process.env.SHOPIFY_REDIRECT_URI = 'https://185.163.116.210/api/integrations/shopify/callback';
process.env.FRONTEND_URL = 'https://velion-agent.vercel.app';

const {
  connectShopify,
  handleShopifyCallback,
} = await import('./src/controllers/shopifyController.js');

const {
  OAUTH_COOKIE_NAME,
  decryptOAuthStateStrict,
} = await import('./src/services/integrations/shopify/shopifyOAuthService.js');

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
    redirect(url) {
      this.statusCode = 302;
      this.redirectUrl = url;
      return this;
    },
    cookie(name, val, opts) {
      this.cookies[name] = { val, opts };
      return this;
    },
    clearCookie(name, opts) {
      this.clearedCookies[name] = opts;
      return this;
    },
    setHeader(name, val) {
      this.headers[name] = val;
      return this;
    },
  };
}

(async () => {
  console.log('======================================================================');
  console.log('🧪 TEST TOP-LEVEL NAVIGATION OAUTH FLOW & CSRF VALIDATION');
  console.log('======================================================================\n');

  const testTenantId = 'tenant_top_level_test_123';
  const testUserId = 'user_top_level_test_456';
  const testShop = 'tienda-top-level.myshopify.com';
  const returnTo = 'https://velion-agent.vercel.app/integraciones/shopify';

  const validToken = jwt.sign(
    { tenantId: testTenantId, userId: testUserId, role: 'client' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Mock prisma integration
  const originalPrisma = (await import('./src/db.js')).default;
  const oldFindFirst = originalPrisma.integration.findFirst;
  const oldUpsert = originalPrisma.integration.upsert;
  originalPrisma.integration.findFirst = async () => null; // tienda libre
  originalPrisma.integration.upsert = async ({ create }) => ({ id: 'mock_int_id', ...create });

  // Mock fetch para token exchange
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      access_token: 'shpat_mock_top_level_token',
      expires_in: 3600,
      scope: 'read_products,read_inventory,write_draft_orders',
    }),
  });

  try {
    let savedNonce = null;
    let savedState = null;

    // ── TEST 1: GET /connect via TOP-LEVEL NAVIGATION ──────────────────────────
    console.log('▶ TEST 1: GET /connect emite cookie SameSite=Lax y hace 302 a Shopify OAuth');
    const reqConnect = {
      method: 'GET',
      query: {
        shop: testShop,
        token: validToken,
        returnTo,
      },
      headers: {},
    };
    const resConnect = mockResponse();

    await connectShopify(reqConnect, resConnect);

    assert.strictEqual(resConnect.statusCode, 302, 'Debe responder 302 Redirect');
    assert.ok(resConnect.redirectUrl, 'Debe tener redirectUrl');
    assert.ok(resConnect.redirectUrl.startsWith(`https://${testShop}/admin/oauth/authorize?`), 'Debe redirigir a Shopify');
    
    // Validar cookie
    const cookie = resConnect.cookies[OAUTH_COOKIE_NAME];
    assert.ok(cookie, 'Cookie de sesión OAuth debe haberse emitido');
    assert.strictEqual(cookie.opts.httpOnly, true);
    assert.strictEqual(cookie.opts.secure, true);
    assert.strictEqual(cookie.opts.sameSite, 'lax');
    assert.strictEqual(cookie.opts.path, '/');
    savedNonce = cookie.val;

    // Validar state descifrado
    const parsedAuthUrl = new URL(resConnect.redirectUrl);
    savedState = parsedAuthUrl.searchParams.get('state');
    assert.ok(savedState, 'state debe estar en la authUrl');

    const decryptedState = decryptOAuthStateStrict(savedState);
    assert.strictEqual(decryptedState.tenantId, testTenantId);
    assert.strictEqual(decryptedState.userId, testUserId);
    assert.strictEqual(decryptedState.shopDomain, testShop);
    assert.strictEqual(decryptedState.returnTo, returnTo);
    assert.strictEqual(decryptedState.nonce, savedNonce);
    console.log('  ✅ PASS: 302 directo a Shopify OAuth con Set-Cookie SameSite=Lax y state seguro.\n');

    // ── TEST 2: GET /callback con Cookie presente y HMAC válida ───────────────
    console.log('▶ TEST 2: GET /callback con cookie y state legítimos redirige a Vercel');
    const code = 'mock_auth_code_from_shopify';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const cleanParams = { code, shop: testShop, state: savedState, timestamp };
    const sortedKeys = Object.keys(cleanParams).sort();
    const message = sortedKeys.map(k => `${k}=${cleanParams[k]}`).join('&');
    const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_CLIENT_SECRET).update(message).digest('hex');

    const reqCallback = {
      query: { code, shop: testShop, state: savedState, timestamp, hmac },
      headers: {
        cookie: `${OAUTH_COOKIE_NAME}=${savedNonce}`,
      },
    };
    const resCallback = mockResponse();

    await handleShopifyCallback(reqCallback, resCallback);

    if (resCallback.statusCode !== 302) {
      console.error('ERROR RESPONSE BODY:', resCallback.body);
    }
    assert.strictEqual(resCallback.statusCode, 302, 'Callback debe responder 302');
    assert.ok(resCallback.redirectUrl.startsWith('https://velion-agent.vercel.app/integraciones/shopify'), 'Debe redirigir al frontend Vercel');
    assert.ok(resCallback.redirectUrl.includes('shopify=connected'), 'Debe incluir shopify=connected');
    assert.ok(resCallback.redirectUrl.includes(`shop=${encodeURIComponent(testShop)}`), 'Debe incluir shop param');
    assert.ok(resCallback.clearedCookies[OAUTH_COOKIE_NAME], 'Cookie debe haberse consumido (single-use)');
    console.log('  ✅ PASS: Retorno exitoso a Vercel con shopify=connected y single-use cookie limpiada.\n');

    // ── TEST 3: GET /callback SIN Cookie devuelve CSRF_DETECTED ────────────────
    console.log('▶ TEST 3: GET /callback SIN cookie de sesión rechaza con CSRF_DETECTED');
    const reqNoCookie = {
      query: { code, shop: testShop, state: savedState, timestamp, hmac },
      headers: {}, // SIN COOKIE
    };
    const resNoCookie = mockResponse();

    await handleShopifyCallback(reqNoCookie, resNoCookie);

    assert.strictEqual(resNoCookie.statusCode, 400);
    assert.strictEqual(resNoCookie.body?.code, 'CSRF_DETECTED');
    console.log('  ✅ PASS: Protección CSRF rechaza cualquier petición sin cookie legítima.\n');

    console.log('======================================================================');
    console.log('🎉 TODOS LOS TESTS DE NAVEGACIÓN TOP-LEVEL Y CSRF PASARON EXITOSAMENTE');
    console.log('======================================================================\n');
  } finally {
    originalPrisma.integration.findFirst = oldFindFirst;
    originalPrisma.integration.upsert = oldUpsert;
    globalThis.fetch = oldFetch;
  }
})();
