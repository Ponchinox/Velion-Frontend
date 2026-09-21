/**
 * SHOPIFY DOMAIN SECURITY TEST SUITE
 * ==================================
 * Valida la canonicalización, sanitización estricta y defensas anti-SSRF para dominios de Shopify.
 */

import assert from 'node:assert';
import { canonicalizeShopDomain, isValidShopDomain } from './src/services/integrations/shopify/shopifyDomain.js';
import { ShopifyDomainError } from './src/services/integrations/shopify/shopifyErrors.js';

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
console.log('🧪 VELION SHOPIFY DOMAIN SECURITY & SANITIZATION SUITE');
console.log('======================================================================\n');

// 1. Dominio estándar válido
runTest('TEST 1: Dominio válido en minúsculas es aceptado', () => {
  const result = canonicalizeShopDomain('tienda-ejemplo.myshopify.com');
  assert.strictEqual(result, 'tienda-ejemplo.myshopify.com');
  assert.strictEqual(isValidShopDomain('tienda-ejemplo.myshopify.com'), true);
});

// 2. Canonicalización de mayúsculas
runTest('TEST 2: Mayúsculas son convertidas automáticamente a minúsculas', () => {
  const result = canonicalizeShopDomain('MiTienda-Oficial.MyShopify.COM');
  assert.strictEqual(result, 'mitienda-oficial.myshopify.com');
});

// 3. Limpieza de espacios en blanco
runTest('TEST 3: Espacios en blanco al inicio y final son removidos', () => {
  const result = canonicalizeShopDomain('   tienda-limpia.myshopify.com   \n');
  assert.strictEqual(result, 'tienda-limpia.myshopify.com');
});

// 4. Handle simple sin punto ni sufijo
runTest('TEST 4: Handle/slug simple autocompleta con .myshopify.com', () => {
  const result = canonicalizeShopDomain('tienda-slug');
  assert.strictEqual(result, 'tienda-slug.myshopify.com');
});

// 5. Rechazo de sufijo de atacante (ej: shop.myshopify.com.attacker.com)
runTest('TEST 5: Rechazo de subdominio de atacante que contiene myshopify.com', () => {
  assert.throws(
    () => canonicalizeShopDomain('tienda.myshopify.com.evil-attacker.com'),
    (err) => err instanceof ShopifyDomainError
  );
  assert.strictEqual(isValidShopDomain('tienda.myshopify.com.evil-attacker.com'), false);
});

// 6. Rechazo de URL completa con https://
runTest('TEST 6: Rechazo de URLs completas con protocolo https://', () => {
  assert.throws(
    () => canonicalizeShopDomain('https://tienda.myshopify.com'),
    (err) => err instanceof ShopifyDomainError
  );
  assert.strictEqual(isValidShopDomain('https://tienda.myshopify.com'), false);
});

// 7. Rechazo de URLs completas con http://
runTest('TEST 7: Rechazo de URLs completas con protocolo http://', () => {
  assert.throws(
    () => canonicalizeShopDomain('http://tienda.myshopify.com'),
    (err) => err instanceof ShopifyDomainError
  );
});

// 8. Rechazo de paths o query strings
runTest('TEST 8: Rechazo de rutas y query parameters (anti-path traversal)', () => {
  assert.throws(
    () => canonicalizeShopDomain('tienda.myshopify.com/admin/settings'),
    (err) => err instanceof ShopifyDomainError
  );
  assert.throws(
    () => canonicalizeShopDomain('tienda.myshopify.com?query=1'),
    (err) => err instanceof ShopifyDomainError
  );
});

// 9. Rechazo de credenciales o arrobas en URL
runTest('TEST 9: Rechazo de credenciales en URL (@)', () => {
  assert.throws(
    () => canonicalizeShopDomain('admin:password@tienda.myshopify.com'),
    (err) => err instanceof ShopifyDomainError
  );
});

// 10. Rechazo de puertos
runTest('TEST 10: Rechazo de puertos explícitos (:)', () => {
  assert.throws(
    () => canonicalizeShopDomain('tienda.myshopify.com:8080'),
    (err) => err instanceof ShopifyDomainError
  );
});

// 11. Rechazo de dominios externos arbitrarios
runTest('TEST 11: Rechazo de dominios externos arbitrarios (evil.com, amazon.com)', () => {
  assert.throws(
    () => canonicalizeShopDomain('evil.com'),
    (err) => err instanceof ShopifyDomainError
  );
  assert.throws(
    () => canonicalizeShopDomain('shop.amazon.com'),
    (err) => err instanceof ShopifyDomainError
  );
});

// 12. Rechazo de dominios que inician con guión
runTest('TEST 12: Rechazo de dominios con inicio inválido (-guion)', () => {
  assert.throws(
    () => canonicalizeShopDomain('-tienda.myshopify.com'),
    (err) => err instanceof ShopifyDomainError
  );
});

// 13. Rechazo de entradas no string o vacías (Fail-Closed)
runTest('TEST 13: Rechazo de valores nulos, vacíos o no string', () => {
  assert.throws(() => canonicalizeShopDomain(''), (err) => err instanceof ShopifyDomainError);
  assert.throws(() => canonicalizeShopDomain(null), (err) => err instanceof ShopifyDomainError);
  assert.throws(() => canonicalizeShopDomain(undefined), (err) => err instanceof ShopifyDomainError);
  assert.throws(() => canonicalizeShopDomain(12345), (err) => err instanceof ShopifyDomainError);
});

console.log('\n======================================================================');
console.log(`🎉 SUITE SHOPIFY DOMAIN SECURITY: ${passedTests}/${totalTests} TESTS PASARON`);
console.log('======================================================================\n');
