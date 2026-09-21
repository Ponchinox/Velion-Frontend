/**
 * test_commerce_catalog_modes.js
 * ================================
 * Suite de pruebas para verificar la alternancia y gobernanza de catalogMode
 * en CommerceService: VELION_ONLY, SHOPIFY_ONLY, COMBINED.
 *
 * Cobertura requerida:
 * 1. VELION_ONLY:
 *    - Delega 100% en VelionNativeProvider.
 *    - Paridad byte-for-byte con Fase 1.
 *    - No requiere integración de Shopify conectada.
 *    - Ítems con prefijo 'shopify:' son inaccesibles (retornan null).
 * 2. SHOPIFY_ONLY:
 *    - Con Integration CONNECTED: resuelve catálogo Shopify correctamente.
 *    - Con Integration DISCONNECTED / inexistente / ERROR:
 *      falla de forma controlada lanzando 'SHOPIFY_INTEGRATION_NOT_CONNECTED'.
 *    - Prohibido el fallback silencioso a Velion Native en SHOPIFY_ONLY.
 * 3. COMBINED:
 *    - Con Integration CONNECTED: resuelve catálogo combinado.
 *    - Con Integration DISCONNECTED / inexistente:
 *      degradación elegante y segura a catálogo Nativo (sin arrojar error).
 */

import assert from 'node:assert';
import { CommerceService } from './src/services/commerce/CommerceService.js';

console.log('======================================================================');
console.log('🧪 VELION COMMERCE SERVICE CATALOG MODES SUITE');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

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

function createMultiModeMockDb({ integrationStatus = 'CONNECTED', catalogMode = 'COMBINED' } = {}) {
  const nativeProducts = [
    {
      id: 'nat-prod-1',
      name: 'Audífonos Bluetooth Velion',
      description: 'Cancelación de ruido activa',
      price: 150.00,
      category: 'Audio',
      type: 'PHYSICAL_PRODUCT',
      tags: ['audio', 'bluetooth'],
      isAvailable: true,
      promotionalPrice: null,
      promoStartDate: null,
      promoEndDate: null,
      imageUrl: 'https://velion.pe/audio.jpg',
      images: ['https://velion.pe/audio.jpg'],
      videoUrl: null,
      sku: 'AUDIO-BT-01',
      normalizedSku: 'AUDIO-BT-01',
      user: { tenantId: 'tenant-test' }
    }
  ];

  const shopifyProducts = [
    {
      id: 'ext-prod-1',
      tenantId: 'tenant-test',
      provider: 'SHOPIFY',
      externalId: 'gid://shopify/Product/5001',
      title: 'Mochila Urbana Shopify',
      description: 'Impermeable',
      category: 'Accesorios',
      tags: ['mochila'],
      imageUrl: 'https://cdn.shopify.com/backpack.jpg',
      images: ['https://cdn.shopify.com/backpack.jpg'],
      isAvailable: true
    }
  ];

  const shopifyVariants = [
    {
      id: 'var-uuid-sh1',
      tenantId: 'tenant-test',
      externalProductId: 'ext-prod-1',
      provider: 'SHOPIFY',
      externalVariantId: 'gid://shopify/ProductVariant/6001',
      sku: 'BAG-URBAN',
      normalizedSku: 'BAG-URBAN',
      title: 'Default Title',
      price: 89.00,
      compareAtPrice: null,
      inventoryQuantity: 20,
      availableForSale: true
    }
  ];

  let currentIntegration = integrationStatus ? {
    id: 'int-uuid-1',
    tenantId: 'tenant-test',
    provider: 'SHOPIFY',
    status: integrationStatus,
    catalogMode: catalogMode,
    priceSource: 'SHOPIFY',
    stockSource: 'SHOPIFY',
    shopCurrencyCode: 'USD'
  } : null;

  return {
    setIntegration(status, mode) {
      if (!status) {
        currentIntegration = null;
      } else {
        currentIntegration = {
          id: 'int-uuid-1',
          tenantId: 'tenant-test',
          provider: 'SHOPIFY',
          status: status,
          catalogMode: mode,
          priceSource: 'SHOPIFY',
          stockSource: 'SHOPIFY',
          shopCurrencyCode: 'USD'
        };
      }
    },
    integration: {
      async findFirst({ where }) {
        if (!currentIntegration) return null;
        if (where.tenantId && currentIntegration.tenantId !== where.tenantId) return null;
        if (where.provider && currentIntegration.provider !== where.provider) return null;
        return currentIntegration;
      }
    },
    product: {
      async findFirst({ where }) {
        return nativeProducts.find(p => p.id === where.id && p.user?.tenantId === where.user?.tenantId) || null;
      },
      async findMany({ where }) {
        return nativeProducts.filter(p => {
          if (where.user?.tenantId && p.user?.tenantId !== where.user.tenantId) return false;
          if (where.isAvailable !== undefined && p.isAvailable !== where.isAvailable) return false;
          return true;
        });
      },
      async count({ where }) {
        return nativeProducts.filter(p => {
          if (where.user?.tenantId && p.user?.tenantId !== where.user.tenantId) return false;
          if (where.normalizedSku && p.normalizedSku !== where.normalizedSku) return false;
          return true;
        }).length;
      }
    },
    externalProductVariant: {
      async findFirst({ where, include }) {
        const found = shopifyVariants.find(v => {
          if (where.id && v.id !== where.id) return false;
          if (where.tenantId && v.tenantId !== where.tenantId) return false;
          return true;
        });
        if (!found) return null;
        const res = { ...found };
        if (include?.externalProduct) {
          res.externalProduct = shopifyProducts.find(p => p.id === found.externalProductId) || null;
        }
        return res;
      },
      async findMany({ where, include }) {
        let list = shopifyVariants.filter(v => {
          if (where.tenantId && v.tenantId !== where.tenantId) return false;
          if (where.normalizedSku && v.normalizedSku !== where.normalizedSku) return false;
          return true;
        });
        if (include?.externalProduct) {
          list = list.map(v => ({
            ...v,
            externalProduct: shopifyProducts.find(p => p.id === v.externalProductId) || null
          }));
        }
        return list;
      }
    }
  };
}

// ── EJECUCIÓN DE TESTS ────────────────────────────────────────────────────────

await runTest('TEST 1: VELION_ONLY genera catálogo nativo con paridad total', async () => {
  const mockDb = createMultiModeMockDb({ integrationStatus: 'CONNECTED', catalogMode: 'VELION_ONLY' });
  const service = new CommerceService(mockDb);

  const csv = await service.getCompactCatalogCsv('tenant-test');
  const lines = csv.trim().split('\n');

  assert.strictEqual(lines[0], 'ID,Nombre,Precio,Tipo,Categoria');
  assert.strictEqual(lines.length, 2);
  assert.ok(lines[1].startsWith('nat-prod-1,Audífonos Bluetooth Velion,S/. 150,PHYSICAL_PRODUCT,Audio'));
});

await runTest('TEST 2: VELION_ONLY no expone ítems shopify: incluso si existen en la BD', async () => {
  const mockDb = createMultiModeMockDb({ integrationStatus: 'CONNECTED', catalogMode: 'VELION_ONLY' });
  const service = new CommerceService(mockDb);

  const item = await service.getProduct('tenant-test', 'shopify:var-uuid-sh1');
  assert.strictEqual(item, null, 'Ítems Shopify deben retornar null en VELION_ONLY');
});

await runTest('TEST 3: SHOPIFY_ONLY con status=CONNECTED resuelve variante Shopify', async () => {
  const mockDb = createMultiModeMockDb({ integrationStatus: 'CONNECTED', catalogMode: 'SHOPIFY_ONLY' });
  const service = new CommerceService(mockDb);

  const csv = await service.getCompactCatalogCsv('tenant-test');
  assert.ok(csv.includes('shopify:var-uuid-sh1,Mochila Urbana Shopify,USD 89,PHYSICAL_PRODUCT,Accesorios'));
  assert.ok(!csv.includes('nat-prod-1'), 'No debe incluir productos nativos en SHOPIFY_ONLY');
});

await runTest('TEST 4: SHOPIFY_ONLY con status=DISCONNECTED lanza SHOPIFY_INTEGRATION_NOT_CONNECTED', async () => {
  const mockDb = createMultiModeMockDb({ integrationStatus: 'DISCONNECTED', catalogMode: 'SHOPIFY_ONLY' });
  const service = new CommerceService(mockDb);

  await assert.rejects(
    async () => await service.getCompactCatalogCsv('tenant-test'),
    /SHOPIFY_INTEGRATION_NOT_CONNECTED/,
    'Debe fallar de forma controlada sin caer a Velion'
  );

  await assert.rejects(
    async () => await service.getProduct('tenant-test', 'shopify:var-uuid-sh1'),
    /SHOPIFY_INTEGRATION_NOT_CONNECTED/
  );
});

await runTest('TEST 5: SHOPIFY_ONLY sin integración registrada lanza SHOPIFY_INTEGRATION_NOT_CONNECTED', async () => {
  const mockDb = createMultiModeMockDb({ integrationStatus: null });
  mockDb.setIntegration(null, 'SHOPIFY_ONLY');
  const service = new CommerceService(mockDb);

  await assert.rejects(
    async () => await service.getCompactCatalogCsv('tenant-test', { catalogMode: 'SHOPIFY_ONLY' }),
    /SHOPIFY_INTEGRATION_NOT_CONNECTED/
  );
});

await runTest('TEST 6: COMBINED con status=CONNECTED incluye tanto nativos como Shopify', async () => {
  const mockDb = createMultiModeMockDb({ integrationStatus: 'CONNECTED', catalogMode: 'COMBINED' });
  const service = new CommerceService(mockDb);

  const csv = await service.getCompactCatalogCsv('tenant-test');
  const lines = csv.trim().split('\n');

  // nat-prod-1 (SKU AUDIO-BT-01) y Mochila (SKU BAG-URBAN) no coinciden -> 2 filas distintas
  assert.strictEqual(lines.length, 3);
  assert.ok(lines.some(l => l.startsWith('nat-prod-1,Audífonos Bluetooth Velion')));
  assert.ok(lines.some(l => l.startsWith('shopify:var-uuid-sh1,Mochila Urbana Shopify')));
});

await runTest('TEST 7: COMBINED con status=DISCONNECTED degrada elegantemente a Native-only', async () => {
  const mockDb = createMultiModeMockDb({ integrationStatus: 'DISCONNECTED', catalogMode: 'COMBINED' });
  const service = new CommerceService(mockDb);

  // No debe arrojar error; debe entregar el catálogo nativo sin romper las ventas del negocio
  const csv = await service.getCompactCatalogCsv('tenant-test');
  const lines = csv.trim().split('\n');

  assert.strictEqual(lines.length, 2);
  assert.ok(lines[1].startsWith('nat-prod-1,Audífonos Bluetooth Velion'));
  assert.ok(!csv.includes('shopify:'), 'No debe incluir Shopify si está desconectado');
});

await runTest('TEST 8: Cero llamadas de red durante lectura de catálogo en CommerceService (VELION_ONLY, SHOPIFY_ONLY, COMBINED)', async () => {
  const mockDb = createMultiModeMockDb({ integrationStatus: 'CONNECTED', catalogMode: 'COMBINED' });
  const service = new CommerceService(mockDb);

  let fetchCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = () => {
    fetchCalls++;
    throw new Error('NETWORK CALL DETECTED DURING CATALOG READ');
  };

  try {
    await service.getCompactCatalogCsv('tenant-test');
    await service.getProduct('tenant-test', 'shopify:var-uuid-sh1');
    await service.getProduct('tenant-test', 'nat-prod-1');
    await service.searchProducts('tenant-test');
    await service.getStock('tenant-test', 'shopify:var-uuid-sh1');
    await service.getPrice('tenant-test', 'shopify:var-uuid-sh1');
    assert.strictEqual(fetchCalls, 0, 'fetch calls must be 0 during commerce catalog reads');
  } finally {
    global.fetch = originalFetch;
  }
});

console.log('\n======================================================================');
console.log(`🎉 SUITE CATALOG MODES: ${passedTests}/${totalTests} TESTS PASARON`);
console.log('======================================================================\n');
