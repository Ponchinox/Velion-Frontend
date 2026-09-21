/**
 * SHOPIFY SECRET LEAK AUDIT SUITE
 * ===============================
 * Verifica que los valores de tokens sintéticos, claves secretas y cabeceras de autorización
 * nunca se serialicen en JSON, nunca aparezcan en mensajes de error y sean estrictamente redactados.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getShopifyConfig } from './src/services/integrations/shopify/shopifyConfig.js';
import { ShopifyError, ShopifyGraphqlError } from './src/services/integrations/shopify/shopifyErrors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}:`, err.message);
    throw err;
  }
}

console.log('======================================================================');
console.log('🔒 VELION SHOPIFY SECRET LEAK AUDIT SUITE');
console.log('======================================================================\n');

process.env.SHOPIFY_CLIENT_ID = 'id_test_123';
process.env.SHOPIFY_CLIENT_SECRET = 'secret_test_value_xyz_super_confidential';
process.env.SHOPIFY_REDIRECT_URI = 'https://velion.test/callback';

// ── TEST 1: Config nunca serializa clientSecret en JSON ni Object.keys ────────
runTest('TEST 1: getShopifyConfig mantiene clientSecret como propiedad no enumerable (oculta a JSON y Object.keys)', () => {
  const cfg = getShopifyConfig();
  const serialized = JSON.stringify(cfg);
  const keys = Object.keys(cfg);

  assert.ok(!serialized.includes(process.env.SHOPIFY_CLIENT_SECRET), 'El valor del secreto no debe aparecer en JSON.stringify');
  assert.ok(!keys.includes('clientSecret'), 'clientSecret no debe estar en Object.keys()');
  assert.strictEqual(cfg.clientSecret, process.env.SHOPIFY_CLIENT_SECRET, 'clientSecret debe ser accesible programáticamente por el backend');
});

// ── TEST 2: ShopifyError.sanitize redacta access_tokens sintéticos ────────────
runTest('TEST 2: ShopifyError.sanitize redacta patrones shpat_* (access tokens)', () => {
  const token = 'sh' + 'pat_' + '9876543210fedcba9876543210fedcba';
  const raw = `Error connecting with access token: ${token}`;
  const sanitized = ShopifyError.sanitize(raw);

  assert.ok(!sanitized.includes(token));
  assert.ok(sanitized.includes('[REDACTED_ACCESS_TOKEN]'));
});

// ── TEST 3: ShopifyError.sanitize redacta refresh_tokens sintéticos ───────────
runTest('TEST 3: ShopifyError.sanitize redacta patrones shprt_* (refresh tokens)', () => {
  const token = 'shprt_abcdef0123456789abcdef0123456789';
  const raw = `Refresh token failed: ${token}`;
  const sanitized = ShopifyError.sanitize(raw);

  assert.ok(!sanitized.includes(token));
  assert.ok(sanitized.includes('[REDACTED_REFRESH_TOKEN]'));
});

// ── TEST 4: ShopifyError.sanitize redacta client_secret en URLs o queries ─────
runTest('TEST 4: ShopifyError.sanitize redacta client_secret= en queries o URLs', () => {
  const secretVal = 'top_secret_key_123';
  const raw = `Failed POST to /admin/oauth/access_token?client_secret=${secretVal}&client_id=123`;
  const sanitized = ShopifyError.sanitize(raw);

  assert.ok(!sanitized.includes(secretVal));
  assert.ok(sanitized.includes('client_secret=[REDACTED]'));
});

// ── TEST 5: ShopifyError.sanitize redacta cabeceras Bearer ─────────────────────
runTest('TEST 5: ShopifyError.sanitize redacta cabeceras Bearer <token>', () => {
  const raw = 'Request failed: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz';
  const sanitized = ShopifyError.sanitize(raw);

  assert.ok(!sanitized.includes('eyJhbGci'));
  assert.ok(sanitized.includes('Bearer [REDACTED]'));
});

// ── TEST 6: ShopifyGraphqlError sanitiza detalles anidados recursivamente ────
runTest('TEST 6: ShopifyGraphqlError sanitiza mensajes y details anidados', () => {
  const token = 'shpat_nested_token_secret_value_111';
  const gqlErr = new ShopifyGraphqlError([
    { message: `Invalid credentials: ${token}`, path: ['shop', 'products'] },
  ]);

  const jsonStr = JSON.stringify(gqlErr.details);
  assert.ok(!jsonStr.includes(token));
  assert.ok(jsonStr.includes('[REDACTED_ACCESS_TOKEN]'));
});

// ── TEST 7: Inspección estática de código fuente: no hay console.log de tokens 
runTest('TEST 7: Inspección estática: no existen console.log que impriman tokens o secretos en código de Shopify', () => {
  const shopifyDir = path.join(__dirname, 'src', 'services', 'integrations', 'shopify');
  const files = fs.readdirSync(shopifyDir).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const content = fs.readFileSync(path.join(shopifyDir, file), 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      if (trimmed.includes('console.log(') || trimmed.includes('console.info(') || trimmed.includes('console.debug(')) {
        assert.ok(!trimmed.includes('accessToken'), `Línea ${idx + 1} en ${file} imprime accessToken: ${line}`);
        assert.ok(!trimmed.includes('refreshToken'), `Línea ${idx + 1} en ${file} imprime refreshToken: ${line}`);
        assert.ok(!trimmed.includes('clientSecret'), `Línea ${idx + 1} en ${file} imprime clientSecret: ${line}`);
      }
    });
  }
});

console.log('\n======================================================================');
console.log(`🎉 SUITE SHOPIFY SECRET LEAK AUDIT: ${passedTests}/${totalTests} TESTS PASARON`);
console.log('======================================================================\n');
