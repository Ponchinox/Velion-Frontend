/**
 * SHOPIFY OAUTH 2.0 TEST SUITE
 * =============================
 * Valida el flujo OAuth, state estricto (anti-plaintext), CSRF cookies, HMAC y token exchange mockeado.
 */

import assert from 'node:assert';
import crypto from 'crypto';
import {
  buildAuthorizationUrl,
  encryptOAuthState,
  decryptOAuthStateStrict,
  verifyOAuthHmac,
  verifyOAuthState,
  exchangeAuthorizationCode,
  OAUTH_COOKIE_NAME,
  OAUTH_COOKIE_PATH,
} from './src/services/integrations/shopify/shopifyOAuthService.js';
import { ShopifyOAuthError } from './src/services/integrations/shopify/shopifyErrors.js';

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

// Configuración mock para tests
process.env.JWT_SECRET = 'test_secret_key_for_jwt_which_is_at_least_32_characters_long_123';
const mockConfig = {
  clientId: 'mock_client_id_123',
  clientSecret: 'mock_client_secret_xyz_789',
  redirectUri: 'https://velion.test/api/integrations/shopify/callback',
  scopes: ['read_products', 'read_inventory', 'write_draft_orders'],
};

console.log('======================================================================');
console.log('🧪 VELION SHOPIFY OAUTH 2.0 & CSRF STATE VALIDATION SUITE');
console.log('======================================================================\n');

(async () => {
  // ── TEST 1: decryptOAuthStateStrict con state válido ───────────────────────
  await runTest('TEST 1: decryptOAuthStateStrict descifra y valida state legítimo', () => {
    const payload = {
      nonce: crypto.randomBytes(16).toString('hex'),
      tenantId: 'tenant_abc_1',
      userId: 'user_xyz_1',
      shopDomain: 'tienda-test.myshopify.com',
      exp: Date.now() + 600000,
    };
    const encrypted = encryptOAuthState(payload);
    const decrypted = decryptOAuthStateStrict(encrypted);

    assert.strictEqual(decrypted.tenantId, payload.tenantId);
    assert.strictEqual(decrypted.userId, payload.userId);
    assert.strictEqual(decrypted.shopDomain, payload.shopDomain);
    assert.strictEqual(decrypted.nonce, payload.nonce);
  });

  // ── TEST 2: decryptOAuthStateStrict RECHAZA texto plano ─────────────────────
  await runTest('TEST 2: decryptOAuthStateStrict RECHAZA tajantemente state en texto plano', () => {
    const plainJson = JSON.stringify({
      nonce: 'insecure_nonce',
      tenantId: 'tenant_evil',
      userId: 'user_evil',
      shopDomain: 'evil.myshopify.com',
      exp: Date.now() + 600000,
    });

    assert.throws(
      () => decryptOAuthStateStrict(plainJson),
      (err) => err instanceof ShopifyOAuthError && err.code === 'INVALID_STATE'
    );
  });

  // ── TEST 3: decryptOAuthStateStrict RECHAZA formato malformado ──────────────
  await runTest('TEST 3: decryptOAuthStateStrict RECHAZA state con formato o longitudes hex alteradas', () => {
    assert.throws(
      () => decryptOAuthStateStrict('part1:part2:part3'),
      (err) => err instanceof ShopifyOAuthError && err.code === 'INVALID_STATE'
    );
    assert.throws(
      () => decryptOAuthStateStrict('not_even_colons'),
      (err) => err instanceof ShopifyOAuthError && err.code === 'INVALID_STATE'
    );
  });

  // ── TEST 4: decryptOAuthStateStrict RECHAZA authTag manipulado ──────────────
  await runTest('TEST 4: decryptOAuthStateStrict RECHAZA authTag manipulado (anti-tampering)', () => {
    const payload = {
      nonce: crypto.randomBytes(16).toString('hex'),
      tenantId: 'tenant_abc_1',
      userId: 'user_xyz_1',
      shopDomain: 'tienda-test.myshopify.com',
      exp: Date.now() + 600000,
    };
    const encrypted = encryptOAuthState(payload);
    const parts = encrypted.split(':');
    // Alterar un caracter del authTag (segunda parte)
    const tamperedTag = (parts[1][0] === 'a' ? 'b' : 'a') + parts[1].slice(1);
    const tamperedState = `${parts[0]}:${tamperedTag}:${parts[2]}`;

    assert.throws(
      () => decryptOAuthStateStrict(tamperedState),
      (err) => err instanceof ShopifyOAuthError && err.code === 'INVALID_STATE'
    );
  });

  // ── TEST 5: decryptOAuthStateStrict RECHAZA state expirado ──────────────────
  await runTest('TEST 5: decryptOAuthStateStrict RECHAZA state expirado', () => {
    const expiredPayload = {
      nonce: crypto.randomBytes(16).toString('hex'),
      tenantId: 'tenant_abc_1',
      userId: 'user_xyz_1',
      shopDomain: 'tienda-test.myshopify.com',
      exp: Date.now() - 1000, // Expirado hace 1 segundo
    };
    const encrypted = encryptOAuthState(expiredPayload);

    assert.throws(
      () => decryptOAuthStateStrict(encrypted),
      (err) => err instanceof ShopifyOAuthError && err.code === 'STATE_EXPIRED'
    );
  });

  // ── TEST 6: buildAuthorizationUrl genera URL y cookie correctas ─────────────
  await runTest('TEST 6: buildAuthorizationUrl construye URL oficial y cookie HttpOnly SameSite=Lax', () => {
    const res = buildAuthorizationUrl({
      shopDomain: 'MiTienda.MyShopify.com',
      tenantId: 'tenant_123',
      userId: 'user_456',
      config: mockConfig,
    });

    assert.ok(res.authUrl.startsWith('https://mitienda.myshopify.com/admin/oauth/authorize?'));
    assert.ok(res.authUrl.includes('client_id=mock_client_id_123'));
    assert.ok(res.authUrl.includes('scope=read_products%2Cread_inventory%2Cwrite_draft_orders'));
    assert.ok(res.authUrl.includes('state='));

    assert.strictEqual(res.cookieOptions.httpOnly, true);
    assert.strictEqual(res.cookieOptions.sameSite, 'lax');
    assert.strictEqual(res.cookieOptions.path, OAUTH_COOKIE_PATH);
    assert.ok(res.nonce.length >= 32);
  });

  // ── TEST 7: verifyOAuthHmac con firma legítima ──────────────────────────────
  await runTest('TEST 7: verifyOAuthHmac valida correctamente firmas legítimas', () => {
    const query = {
      code: 'auth_code_123',
      shop: 'mitienda.myshopify.com',
      state: 'some_encrypted_state',
      timestamp: '1726850000',
    };

    // Calcular HMAC esperado
    const message = `code=${query.code}&shop=${query.shop}&state=${query.state}&timestamp=${query.timestamp}`;
    const hmac = crypto
      .createHmac('sha256', mockConfig.clientSecret)
      .update(message)
      .digest('hex');

    const isValid = verifyOAuthHmac({
      query: { ...query, hmac },
      clientSecret: mockConfig.clientSecret,
    });

    assert.strictEqual(isValid, true);
  });

  // ── TEST 8: verifyOAuthHmac con firma manipulada ────────────────────────────
  await runTest('TEST 8: verifyOAuthHmac rechaza firmas manipuladas', () => {
    const query = {
      code: 'auth_code_123',
      shop: 'mitienda.myshopify.com',
      hmac: 'fake_hmac_value_that_does_not_match_hash_at_all',
    };

    const isValid = verifyOAuthHmac({
      query,
      clientSecret: mockConfig.clientSecret,
    });

    assert.strictEqual(isValid, false);
  });

  // ── TEST 9: verifyOAuthState con cookie coincidente y dominio correcto ──────
  await runTest('TEST 9: verifyOAuthState aprueba cuando cookie y state coinciden', () => {
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = encryptOAuthState({
      nonce,
      tenantId: 'tenant_target',
      userId: 'user_target',
      shopDomain: 'mitienda.myshopify.com',
      exp: Date.now() + 600000,
    });

    const validated = verifyOAuthState({
      state,
      cookieNonce: nonce,
      shop: 'mitienda.myshopify.com',
    });

    assert.strictEqual(validated.tenantId, 'tenant_target');
    assert.strictEqual(validated.shopDomain, 'mitienda.myshopify.com');
  });

  // ── TEST 10: verifyOAuthState rechaza ante cookie ausente o discrepante ─────
  await runTest('TEST 10: verifyOAuthState rechaza ante cookie ausente o discrepante (CSRF detectado)', () => {
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = encryptOAuthState({
      nonce,
      tenantId: 'tenant_target',
      userId: 'user_target',
      shopDomain: 'mitienda.myshopify.com',
      exp: Date.now() + 600000,
    });

    // Sin cookie
    assert.throws(
      () => verifyOAuthState({ state, cookieNonce: null, shop: 'mitienda.myshopify.com' }),
      (err) => err instanceof ShopifyOAuthError && err.code === 'CSRF_DETECTED'
    );

    // Cookie de otra sesión
    assert.throws(
      () => verifyOAuthState({ state, cookieNonce: 'different_nonce', shop: 'mitienda.myshopify.com' }),
      (err) => err instanceof ShopifyOAuthError && err.code === 'CSRF_DETECTED'
    );
  });

  // ── TEST 11: Shop Binding: State para tienda-a vs Callback para tienda-b ────
  await runTest('TEST 11: Shop Binding: State para tienda-a.myshopify.com y callback para tienda-b.myshopify.com RECHAZA con SHOP_MISMATCH', () => {
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = encryptOAuthState({
      nonce,
      tenantId: 'tenant_target',
      userId: 'user_target',
      shopDomain: 'tienda-a.myshopify.com',
      exp: Date.now() + 600000,
    });

    assert.throws(
      () => verifyOAuthState({ state, cookieNonce: nonce, shop: 'tienda-b.myshopify.com' }),
      (err) => err instanceof ShopifyOAuthError && err.code === 'SHOP_MISMATCH'
    );
  });

  // ── TEST 12: exchangeAuthorizationCode solicita expiring=1 y valida scopes ──
  await runTest('TEST 12: exchangeAuthorizationCode intercambia tokens con expiring=1 y valida scopes', async () => {
    let capturedBody = null;

    const mockFetch = async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          access_token: 'shpat_synthetic_test_token_123',
          scope: 'read_products,read_inventory,write_draft_orders',
          expires_in: 3600,
          refresh_token: 'shprt_synthetic_refresh_token_456',
          refresh_token_expires_in: 7776000,
        }),
      };
    };

    const tokenData = await exchangeAuthorizationCode({
      shopDomain: 'mitienda.myshopify.com',
      code: 'valid_auth_code',
      clientId: mockConfig.clientId,
      clientSecret: mockConfig.clientSecret,
      fetchFn: mockFetch,
    });

    assert.strictEqual(capturedBody.expiring, 1, 'Debe solicitar tokens offline expirables');
    assert.strictEqual(capturedBody.code, 'valid_auth_code');
    assert.strictEqual(tokenData.accessToken, 'shpat_synthetic_test_token_123');
    assert.strictEqual(tokenData.expiresIn, 3600);
    assert.strictEqual(tokenData.refreshTokenExpiresIn, 7776000);
  });

  // ── TEST 12: exchangeAuthorizationCode rechaza si faltan scopes requeridos ──
  await runTest('TEST 12: exchangeAuthorizationCode rechaza si el comercio no concedió todos los scopes V1', async () => {
    const mockFetchInsufficientScopes = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        access_token: 'shpat_synthetic_test_token_123',
        scope: 'read_products', // Faltan read_inventory y write_draft_orders
        expires_in: 3600,
      }),
    });

    await assert.rejects(
      async () => {
        await exchangeAuthorizationCode({
          shopDomain: 'mitienda.myshopify.com',
          code: 'valid_auth_code',
          clientId: mockConfig.clientId,
          clientSecret: mockConfig.clientSecret,
          fetchFn: mockFetchInsufficientScopes,
        });
      },
      (err) => err instanceof ShopifyOAuthError && err.code === 'INSUFFICIENT_SCOPES'
    );
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE SHOPIFY OAUTH 2.0: ${passedTests}/${totalTests} TESTS PASARON`);
  console.log('======================================================================\n');
})();
