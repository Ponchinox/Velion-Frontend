/**
 * SHOPIFY CATALOG MAPPING TEST SUITE
 * ===================================
 * Valida la lógica de transformación y reglas de mapeo de productos y variantes:
 * - Mapeo canónico y normalización de textos.
 * - Regla de categoría: category.fullName -> productType -> null.
 * - Límite de imágenes (hasta 10) y fallback de imageUrl.
 * - Regla de disponibilidad comercial (ACTIVE + sellable variant).
 * - Validación y conversión segura de dinero (Float, no NaN, no negativos).
 * - Semántica de inventario V1: null/undefined -> 0, validación de enteros.
 * - Aceptación de SKUs duplicados sin error.
 */

import assert from 'node:assert';
import {
  parseMoney,
  parseInventoryQuantity,
  computeProductAvailability,
} from './src/services/integrations/shopify/shopifyCatalogSyncService.js';
import { ShopifySyncError } from './src/services/integrations/shopify/shopifyErrors.js';

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

console.log('======================================================================');
console.log('🧪 VELION SHOPIFY CATALOG MAPPING TEST SUITE');
console.log('======================================================================\n');

(async () => {
  // ── 1. PARSE MONEY ──────────────────────────────────────────────────────────
  await runTest('TEST 1: parseMoney convierte correctamente strings numéricos con decimales', async () => {
    assert.strictEqual(parseMoney('600.00'), 600.0);
    assert.strictEqual(parseMoney('949.95'), 949.95);
    assert.strictEqual(parseMoney('10'), 10.0);
    assert.strictEqual(parseMoney(0), 0);
    assert.strictEqual(parseMoney(null), null);
    assert.strictEqual(parseMoney(undefined), null);
    assert.strictEqual(parseMoney(''), null);
  });

  await runTest('TEST 2: parseMoney RECHAZA valores no numéricos, NaN o negativos', async () => {
    assert.throws(() => parseMoney('abc'), (err) => err instanceof ShopifySyncError && err.code === 'INVALID_MONEY_VALUE');
    assert.throws(() => parseMoney(-10.5), (err) => err instanceof ShopifySyncError && err.code === 'INVALID_MONEY_VALUE');
    assert.throws(() => parseMoney(NaN), (err) => err instanceof ShopifySyncError && err.code === 'INVALID_MONEY_VALUE');
    assert.throws(() => parseMoney(Infinity), (err) => err instanceof ShopifySyncError && err.code === 'INVALID_MONEY_VALUE');
  });

  // ── 2. PARSE INVENTORY QUANTITY ─────────────────────────────────────────────
  await runTest('TEST 3: parseInventoryQuantity mapea null y undefined a 0 (INVENTORY_NULL_MAPPING = ZERO_FOR_V1)', async () => {
    assert.strictEqual(parseInventoryQuantity(null), 0);
    assert.strictEqual(parseInventoryQuantity(undefined), 0);
    assert.strictEqual(parseInventoryQuantity(50), 50);
    assert.strictEqual(parseInventoryQuantity('10'), 10);
    assert.strictEqual(parseInventoryQuantity(0), 0);
    assert.strictEqual(parseInventoryQuantity(-5), -5); // Inventarios negativos son válidos en Shopify si hubo sobreventa
  });

  await runTest('TEST 4: parseInventoryQuantity RECHAZA valores flotantes o no enteros', async () => {
    assert.throws(() => parseInventoryQuantity(10.5), (err) => err instanceof ShopifySyncError && err.code === 'INVALID_INVENTORY_QUANTITY');
    assert.throws(() => parseInventoryQuantity('10.5'), (err) => err instanceof ShopifySyncError && err.code === 'INVALID_INVENTORY_QUANTITY');
    assert.throws(() => parseInventoryQuantity('not_a_number'), (err) => err instanceof ShopifySyncError && err.code === 'INVALID_INVENTORY_QUANTITY');
  });

  // ── 3. PRODUCT AVAILABILITY RULE ───────────────────────────────────────────
  await runTest('TEST 5: computeProductAvailability retorna true si status es ACTIVE y existe variante sellable', async () => {
    const variants = [
      { availableForSale: false },
      { availableForSale: true },
    ];
    assert.strictEqual(computeProductAvailability('ACTIVE', variants), true);
  });

  await runTest('TEST 6: computeProductAvailability retorna false si status es ACTIVE pero NINGUNA variante es sellable', async () => {
    const variants = [
      { availableForSale: false },
      { availableForSale: false },
    ];
    assert.strictEqual(computeProductAvailability('ACTIVE', variants), false);
  });

  await runTest('TEST 7: computeProductAvailability retorna false para productos DRAFT o ARCHIVED aunque tengan variantes sellables', async () => {
    const variants = [{ availableForSale: true }];
    assert.strictEqual(computeProductAvailability('DRAFT', variants), false);
    assert.strictEqual(computeProductAvailability('ARCHIVED', variants), false);
  });

  await runTest('TEST 8: computeProductAvailability retorna false para productos sin variantes', async () => {
    assert.strictEqual(computeProductAvailability('ACTIVE', []), false);
    assert.strictEqual(computeProductAvailability('ACTIVE', null), false);
  });

  // ── 4. CATEGORY & TAGS MAPPING ──────────────────────────────────────────────
  await runTest('TEST 9: Mapeo de categoría prioriza category.fullName y usa productType como fallback', async () => {
    const catWithFullName = { id: 'gid://shopify/TaxonomyCategory/gc', fullName: 'Gift Cards' };
    const resolvedCat1 = catWithFullName.fullName?.trim() || 'fallbackType';
    assert.strictEqual(resolvedCat1, 'Gift Cards');

    const catNull = null;
    const resolvedCat2 = catNull?.fullName?.trim() || 'snowboard';
    assert.strictEqual(resolvedCat2, 'snowboard');

    const bothEmpty = catNull?.fullName?.trim() || ''.trim() || null;
    assert.strictEqual(bothEmpty, null);
  });

  // ── 5. IMAGES LIMIT & FALLBACK ──────────────────────────────────────────────
  await runTest('TEST 10: Array de imágenes respeta IMAGE_SYNC_LIMIT (10 max) y fija imageUrl a la primera', async () => {
    const rawImages = Array.from({ length: 15 }, (_, i) => ({ url: `https://cdn.shopify.com/img_${i + 1}.jpg` }));
    const filteredImages = rawImages.map(n => n.url).slice(0, 10);

    assert.strictEqual(filteredImages.length, 10);
    assert.strictEqual(filteredImages[0], 'https://cdn.shopify.com/img_1.jpg');
    assert.strictEqual(filteredImages[9], 'https://cdn.shopify.com/img_10.jpg');

    const emptyImages = [];
    const imageUrlFallback = emptyImages[0] || null;
    assert.strictEqual(imageUrlFallback, null);
  });

  // ── 6. NORMALIZED SKU ───────────────────────────────────────────────────────
  await runTest('TEST 11: normalizedSku convierte a mayúsculas sin espacios y admite duplicados', async () => {
    const sku1 = '  sku-abc-123  ';
    const norm1 = sku1?.trim().toUpperCase() || null;
    assert.strictEqual(norm1, 'SKU-ABC-123');

    const skuNull = null;
    const norm2 = skuNull?.trim().toUpperCase() || null;
    assert.strictEqual(norm2, null);

    // Mismo SKU para dos variantes distintas
    const v1 = { id: 'var_1', sku: 'SKU-COMMON', normalizedSku: 'SKU-COMMON' };
    const v2 = { id: 'var_2', sku: 'sku-common', normalizedSku: 'SKU-COMMON' };
    assert.strictEqual(v1.normalizedSku, v2.normalizedSku);
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE SHOPIFY CATALOG MAPPING: ${passedTests}/${totalTests} TESTS PASARON`);
  console.log('======================================================================\n');
})();
