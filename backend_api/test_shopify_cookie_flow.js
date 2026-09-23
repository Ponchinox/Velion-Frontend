/**
 * SHOPIFY OAUTH COOKIE PERSISTENCE & CSRF VERIFICATION TEST
 * ==========================================================
 * Verifica el ciclo de vida completo de la cookie OAuth y la protección CSRF:
 * START OAUTH
 *  → Set-Cookie emitido con (HttpOnly, Secure, SameSite=Lax, Path=/)
 *  → Redirección a Shopify con state cifrado
 *  → Callback simulado de retorno desde Shopify
 *  → Cookie presente y coincidente con el state
 *  → Validación de HMAC y State
 *  → Callback NO devuelve CSRF_DETECTED
 *  → Cookie limpiada inmediatamente (Single-Use)
 *  → Verificación de que sin cookie o con cookie errónea sí dispara CSRF_DETECTED
 */

import assert from 'node:assert';
import crypto from 'crypto';
import {
  connectShopify,
  handleShopifyCallback,
} from './src/controllers/shopifyController.js';
import {
  OAUTH_COOKIE_NAME,
  OAUTH_COOKIE_PATH,
  resolveOAuthCookieSecure,
} from './src/services/integrations/shopify/shopifyOAuthService.js';

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

// Configurar entorno de prueba con HTTPS (idéntico a producción)
process.env.JWT_SECRET = 'test_secret_key_for_jwt_which_is_at_least_32_characters_long_123';
process.env.SHOPIFY_CLIENT_ID = 'test_client_id_oauth_flow';
process.env.SHOPIFY_CLIENT_SECRET = 'test_client_secret_oauth_flow';
process.env.SHOPIFY_REDIRECT_URI = 'https://185.163.116.210/api/integrations/shopify/callback';
process.env.FRONTEND_URL = 'https://185.163.116.210';

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
  };
}

console.log('======================================================================');
console.log('🧪 VELION SHOPIFY OAUTH COOKIE PERSISTENCE & CSRF VALIDATION SUITE');
console.log('======================================================================\n');

(async () => {
  const originalPrisma = (await import('./src/db.js')).default;
  const store = new Map();
  const mockPrisma = {
    integration: {
      async findFirst({ where }) {
        return null; // Tienda libre para conectar
      },
      async findUnique({ where }) {
        const key = `${where.tenantId_provider.tenantId}_${where.tenantId_provider.provider}`;
        return store.get(key) || null;
      },
      async upsert({ where, update, create }) {
        const key = `${where.tenantId_provider.tenantId}_${where.tenantId_provider.provider}`;
        const merged = { ...(store.get(key) || {}), ...(store.has(key) ? update : create) };
        store.set(key, merged);
        return merged;
      },
    },
  };

  const oldFindFirst = originalPrisma.integration.findFirst;
  const oldFindUnique = originalPrisma.integration.findUnique;
  const oldUpsert = originalPrisma.integration.upsert;
  originalPrisma.integration.findFirst = mockPrisma.integration.findFirst;
  originalPrisma.integration.findUnique = mockPrisma.integration.findUnique;
  originalPrisma.integration.upsert = mockPrisma.integration.upsert;

  // Mock global fetch para token exchange
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        access_token: 'shpat_mock_success_token_123',
        refresh_token: 'shprt_mock_refresh_token_456',
        expires_in: 3600,
        refresh_token_expires_in: 7776000,
        scope: 'read_products,read_inventory,write_draft_orders',
      }),
    };
  };

  try {
    // ── STEP 1: START OAUTH → Set-Cookie emitido con opciones seguras ───────
    let savedNonce = null;
    let savedCookieOpts = null;
    let savedAuthUrl = null;
    let extractedState = null;

    await runTest('STEP 1: START OAUTH emite Set-Cookie seguro y authUrl válida', async () => {
      const req = {
        method: 'POST',
        user: { tenantId: 'tenant_cookie_test', userId: 'user_cookie_test' },
        body: { shopDomain: 'mi-tienda-demo.myshopify.com' },
      };
      const res = mockResponse();

      await connectShopify(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.authUrl);
      assert.ok(res.cookies[OAUTH_COOKIE_NAME], 'La cookie OAUTH_COOKIE_NAME debe haber sido emitida');

      const cookieEntry = res.cookies[OAUTH_COOKIE_NAME];
      savedNonce = cookieEntry.val;
      savedCookieOpts = cookieEntry.opts;
      savedAuthUrl = res.body.authUrl;

      // Verificar opciones exactas de la cookie
      assert.strictEqual(savedCookieOpts.httpOnly, true, 'Debe ser httpOnly');
      assert.strictEqual(savedCookieOpts.secure, true, 'Debe ser secure bajo HTTPS');
      assert.strictEqual(savedCookieOpts.sameSite, 'lax', 'Debe ser sameSite=lax para navegación top-level');
      assert.strictEqual(savedCookieOpts.path, '/', 'Path debe ser / para cubrir todas las rutas sin desfases');
      assert.strictEqual(savedCookieOpts.maxAge, 600000, 'maxAge debe ser 10 minutos (600,000 ms)');

      // Extraer state de la URL de autorización
      const parsedUrl = new URL(savedAuthUrl);
      extractedState = parsedUrl.searchParams.get('state');
      assert.ok(extractedState, 'state debe estar presente en query params');
      assert.strictEqual(parsedUrl.searchParams.get('redirect_uri'), process.env.SHOPIFY_REDIRECT_URI);
    });

    // ── STEP 2: SIMULAR REDIRECCIÓN DE SHOPIFY AL CALLBACK CON COOKIE ─────────
    await runTest('STEP 2: Callback con cookie y state legítimos NO devuelve CSRF_DETECTED', async () => {
      const shop = 'mi-tienda-demo.myshopify.com';
      const code = 'shopify_auth_code_live_simulation';
      const timestamp = String(Math.floor(Date.now() / 1000));

      // Construir firma HMAC legítima tal como la calcula Shopify
      const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
      const cleanParams = { code, shop, state: extractedState, timestamp };
      const sortedKeys = Object.keys(cleanParams).sort();
      const message = sortedKeys.map(k => `${k}=${cleanParams[k]}`).join('&');
      const hmac = crypto.createHmac('sha256', clientSecret).update(message).digest('hex');

      // Simular request del navegador conteniendo la cookie shopify_oauth_nonce
      const req = {
        query: { code, shop, state: extractedState, timestamp, hmac },
        headers: {
          cookie: `${OAUTH_COOKIE_NAME}=${savedNonce}`,
        },
      };
      const res = mockResponse();

      await handleShopifyCallback(req, res);

      // Verificaciones críticas de éxito:
      assert.notStrictEqual(res.statusCode, 400, 'El callback NO debe responder 400');
      assert.strictEqual(res.body, null, 'El callback NO debe retornar un cuerpo de error');
      assert.strictEqual(res.statusCode, 302, 'El callback debe redirigir con 302 hacia el frontend');
      assert.ok(res.redirectUrl.includes('shopify=connected'), 'Redirección debe indicar conexión exitosa');
      assert.ok(res.redirectUrl.includes('shop=mi-tienda-demo.myshopify.com'));

      // Verificar que la cookie fue eliminada inmediatamente (Single-Use Nonce)
      assert.ok(res.clearedCookies[OAUTH_COOKIE_NAME], 'La cookie debe haberse limpiado con clearCookie');
      assert.strictEqual(res.clearedCookies[OAUTH_COOKIE_NAME].path, '/');
      assert.strictEqual(res.clearedCookies[OAUTH_COOKIE_NAME].secure, true);
    });

    // ── STEP 3: PROTECCIÓN CSRF — COMPROBAR QUE RECHAZA SIN COOKIE ────────────
    await runTest('STEP 3: Callback SIN cookie devuelve CSRF_DETECTED (Protección CSRF activa)', async () => {
      const shop = 'mi-tienda-demo.myshopify.com';
      const code = 'code_without_cookie';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

      const cleanParams = { code, shop, state: extractedState, timestamp };
      const sortedKeys = Object.keys(cleanParams).sort();
      const message = sortedKeys.map(k => `${k}=${cleanParams[k]}`).join('&');
      const hmac = crypto.createHmac('sha256', clientSecret).update(message).digest('hex');

      const req = {
        query: { code, shop, state: extractedState, timestamp, hmac },
        headers: {}, // SIN cookie de sesión
      };
      const res = mockResponse();

      await handleShopifyCallback(req, res);

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body?.code, 'CSRF_DETECTED');
      assert.ok(res.body?.error.includes('Cookie de sesión OAuth no encontrada'));
    });

    // ── STEP 4: PROTECCIÓN CSRF — COMPROBAR QUE RECHAZA COOKIE DISCREPANTE ────
    await runTest('STEP 4: Callback con cookie alterada/ajena devuelve CSRF_DETECTED', async () => {
      const shop = 'mi-tienda-demo.myshopify.com';
      const code = 'code_fake_cookie';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

      const cleanParams = { code, shop, state: extractedState, timestamp };
      const sortedKeys = Object.keys(cleanParams).sort();
      const message = sortedKeys.map(k => `${k}=${cleanParams[k]}`).join('&');
      const hmac = crypto.createHmac('sha256', clientSecret).update(message).digest('hex');

      const req = {
        query: { code, shop, state: extractedState, timestamp, hmac },
        headers: {
          cookie: `${OAUTH_COOKIE_NAME}=nonce_atacante_totalmente_distinto_1234567890abcdef1234567890abcdef`,
        },
      };
      const res = mockResponse();

      await handleShopifyCallback(req, res);

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body?.code, 'CSRF_DETECTED');
    });

  } finally {
    originalPrisma.integration.findFirst = oldFindFirst;
    originalPrisma.integration.findUnique = oldFindUnique;
    originalPrisma.integration.upsert = oldUpsert;
    globalThis.fetch = originalFetch;
  }

  console.log('\n======================================================================');
  console.log(`🎉 TEST SUITE PERSISTENCIA Y CSRF: ${passedTests}/${totalTests} TESTS PASARON`);
  console.log('======================================================================\n');
})();
