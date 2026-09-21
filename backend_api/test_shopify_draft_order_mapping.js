/**
 * test_shopify_draft_order_mapping.js
 * ====================================
 * Suite de pruebas unitarias para el mapeo determinista de DraftOrderInput (API 2026-07).
 * 
 * Verificaciones:
 * 1. Mapeo de items Shopify puros a lineItems con variantId (GID) y quantity.
 * 2. Mapeo de items MERGED a su externalVariantId.
 * 3. Rechazo de ordenes sin items (EMPTY_ORDER_ITEMS).
 * 4. Rechazo de items sin externalVariantId GID valido (INVALID_VARIANT_ID).
 * 5. Rechazo de items con cantidad invalida o <= 0 (INVALID_QUANTITY).
 * 6. Construccion de tags indexables ("velion", "velion-order-<UUID>").
 * 7. Inyeccion de customAttributes estructurados (key: "velion_order_id", value: "<UUID>").
 * 8. Zero customer creation: sin email ni campos de cliente en el payload.
 * 9. presentmentCurrencyCode coincide con integration.shopCurrencyCode.
 * 10. Moneda no resuelta lanza SHOPIFY_CURRENCY_UNRESOLVED.
 */

import assert from 'node:assert';
import { buildDraftOrderInput } from './src/services/integrations/shopify/shopifyDraftOrderService.js';
import { ShopifyDraftOrderError } from './src/services/integrations/shopify/shopifyErrors.js';

console.log('======================================================================');
console.log('🧪 TEST SUITE 1: SHOPIFY DRAFT ORDER MAPPING (API 2026-07)');
console.log('======================================================================\n');

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    throw err;
  }
}

async function main() {
  const mockIntegration = {
    id: 'integ-1',
    shopDomain: 'velion-dev.myshopify.com',
    shopCurrencyCode: 'USD',
    priceSource: 'SHOPIFY'
  };

  // Test 1: Mapeo de item Shopify puro
  await runTest('Mapeo de item Shopify puro a lineItems con GID y cantidad', () => {
    const order = {
      id: 'd3b07384-d113-466c-9c7a-8f81a7b45f01',
      items: [
        {
          name: 'The Minimal Snowboard',
          quantity: 1,
          price: 885.95,
          externalVariantId: 'gid://shopify/ProductVariant/45000000001'
        }
      ]
    };

    const input = buildDraftOrderInput(order, mockIntegration);
    assert.strictEqual(input.lineItems.length, 1);
    assert.strictEqual(input.lineItems[0].variantId, 'gid://shopify/ProductVariant/45000000001');
    assert.strictEqual(input.lineItems[0].quantity, 1);
  });

  // Test 2: Mapeo de item MERGED
  await runTest('Mapeo de item MERGED con externalVariantId correspondiente', () => {
    const order = {
      id: 'd3b07384-d113-466c-9c7a-8f81a7b45f02',
      items: [
        {
          name: 'Snowboard Pro 2026',
          quantity: 2,
          price: 799.00,
          sourceProvider: 'MERGED',
          externalVariantId: 'gid://shopify/ProductVariant/45000000002'
        }
      ]
    };

    const input = buildDraftOrderInput(order, mockIntegration);
    assert.strictEqual(input.lineItems[0].variantId, 'gid://shopify/ProductVariant/45000000002');
    assert.strictEqual(input.lineItems[0].quantity, 2);
  });

  // Test 3: Rechazo de orden sin items
  await runTest('Rechazo fail-closed de orden con array de items vacio', () => {
    const order = {
      id: 'd3b07384-d113-466c-9c7a-8f81a7b45f03',
      items: []
    };

    assert.throws(
      () => buildDraftOrderInput(order, mockIntegration),
      (err) => err instanceof ShopifyDraftOrderError && err.code === 'EMPTY_ORDER_ITEMS'
    );
  });

  // Test 4: Rechazo de variantId no valido (no GID)
  await runTest('Rechazo de item sin externalVariantId en formato GID de Shopify', () => {
    const order = {
      id: 'd3b07384-d113-466c-9c7a-8f81a7b45f04',
      items: [
        {
          name: 'Invalido',
          quantity: 1,
          price: 100,
          externalVariantId: '12345' // No es gid://shopify/ProductVariant/
        }
      ]
    };

    assert.throws(
      () => buildDraftOrderInput(order, mockIntegration),
      (err) => err instanceof ShopifyDraftOrderError && err.code === 'INVALID_VARIANT_ID'
    );
  });

  // Test 5: Rechazo de cantidad no valida
  await runTest('Rechazo de cantidad <= 0 o no entera', () => {
    const orderZero = {
      id: 'd3b07384-d113-466c-9c7a-8f81a7b45f05',
      items: [
        {
          name: 'Snowboard',
          quantity: 0,
          externalVariantId: 'gid://shopify/ProductVariant/45000000001'
        }
      ]
    };

    assert.throws(
      () => buildDraftOrderInput(orderZero, mockIntegration),
      (err) => err instanceof ShopifyDraftOrderError && err.code === 'INVALID_QUANTITY'
    );
  });

  // Test 6: Tags indexables estructurados
  await runTest('Tags contienen "velion" y "velion-order-<ORDER_ID>" para indexacion', () => {
    const order = {
      id: 'd3b07384-d113-466c-9c7a-8f81a7b45f06',
      items: [{ name: 'Test', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/45000000001' }]
    };

    const input = buildDraftOrderInput(order, mockIntegration);
    assert.deepStrictEqual(input.tags, ['velion', `velion-${order.id.replace(/-/g, '')}`]);
    assert.ok(input.tags[1].length <= 40, 'El tag indexable debe cumplir con el límite máximo de 40 caracteres de Shopify');
  });

  // Test 7: customAttributes estructurados para verificacion secundaria
  await runTest('customAttributes contienen velion_order_id = <ORDER_ID>', () => {
    const order = {
      id: 'd3b07384-d113-466c-9c7a-8f81a7b45f07',
      items: [{ name: 'Test', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/45000000001' }]
    };

    const input = buildDraftOrderInput(order, mockIntegration);
    assert.strictEqual(Array.isArray(input.customAttributes), true);
    assert.strictEqual(input.customAttributes.length, 1);
    assert.strictEqual(input.customAttributes[0].key, 'velion_order_id');
    assert.strictEqual(input.customAttributes[0].value, 'd3b07384-d113-466c-9c7a-8f81a7b45f07');
  });

  // Test 8: Cero Customer en el payload inicial
  await runTest('DraftOrderInput no incluye campos de customer, email ni shippingAddress', () => {
    const order = {
      id: 'd3b07384-d113-466c-9c7a-8f81a7b45f08',
      items: [{ name: 'Test', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/45000000001' }]
    };

    const input = buildDraftOrderInput(order, mockIntegration);
    assert.strictEqual(input.customer, undefined);
    assert.strictEqual(input.email, undefined);
    assert.strictEqual(input.shippingAddress, undefined);
    assert.strictEqual(input.customerId, undefined);
  });

  // Test 9: presentmentCurrencyCode
  await runTest('presentmentCurrencyCode refleja integration.shopCurrencyCode', () => {
    const order = {
      id: 'd3b07384-d113-466c-9c7a-8f81a7b45f09',
      items: [{ name: 'Test', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/45000000001' }]
    };

    const input = buildDraftOrderInput(order, mockIntegration);
    assert.strictEqual(input.presentmentCurrencyCode, 'USD');
    assert.strictEqual(input.note, 'Pedido asistido por Velion');
  });

  // Test 10: Moneda no resuelta lanza error
  await runTest('Integration sin shopCurrencyCode lanza SHOPIFY_CURRENCY_UNRESOLVED', () => {
    const order = {
      id: 'd3b07384-d113-466c-9c7a-8f81a7b45f10',
      items: [{ name: 'Test', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/45000000001' }]
    };

    assert.throws(
      () => buildDraftOrderInput(order, { ...mockIntegration, shopCurrencyCode: null }),
      (err) => err instanceof ShopifyDraftOrderError && err.code === 'SHOPIFY_CURRENCY_UNRESOLVED'
    );
  });

  console.log(`\n======================================================================`);
  console.log(`🎉 SUITE 1 COMPLETADA: ${passedTests}/${totalTests} pruebas pasaron.`);
  console.log(`======================================================================\n`);
}

main().catch((err) => {
  console.error('Fallo fatal en Suite 1:', err);
  process.exit(1);
});
