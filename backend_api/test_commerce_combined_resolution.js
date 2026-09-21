/**
 * test_commerce_combined_resolution.js
 * =====================================
 * Suite de pruebas para verificar la resolución del catálogo combinado (COMBINED):
 * - Coincidencia 1:1 estricta por normalizedSku
 * - Manejo de ambigüedad (2+ nativos o 2+ Shopify)
 * - Prohibición de merge por nombre/categoría/fuzzy
 * - Gobernanza de priceSource (VELION vs SHOPIFY)
 * - Gobernanza de stockSource (VELION vs SHOPIFY)
 * - Preservación de promociones nativas
 * - Deduplicación de conteo (2 Native + 2 Shopify con 1 match = 3 items)
 */

import assert from 'node:assert';
import { CommerceService } from './src/services/commerce/CommerceService.js';

console.log('======================================================================');
console.log('🧪 VELION COMBINED CATALOG RESOLUTION & SKU MATCHING SUITE');
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

function createCombinedFixtureDb({
  priceSource = 'SHOPIFY',
  stockSource = 'SHOPIFY'
} = {}) {
  const integration = {
    id: 'int-combined-1',
    tenantId: 'tenant-match',
    provider: 'SHOPIFY',
    status: 'CONNECTED',
    catalogMode: 'COMBINED',
    priceSource,
    stockSource
  };

  const nativeProducts = [
    {
      id: 'nat-a',
      name: 'Producto A Nativo',
      description: 'Descripción Nativa A',
      price: 100.00,
      promotionalPrice: 80.00,
      promoStartDate: new Date(Date.now() - 3600000),
      promoEndDate: new Date(Date.now() + 3600000), // Promo activa
      category: 'Moda',
      type: 'PHYSICAL_PRODUCT',
      tags: ['a'],
      isAvailable: true,
      imageUrl: 'https://velion.pe/a.jpg',
      images: ['https://velion.pe/a.jpg'],
      videoUrl: 'https://velion.pe/video-a.mp4',
      sku: 'SKU-ABC',
      normalizedSku: 'SKU-ABC',
      user: { tenantId: 'tenant-match' }
    },
    {
      id: 'nat-b',
      name: 'Producto B Solo Nativo',
      description: 'Descripción B',
      price: 200.00,
      promotionalPrice: null,
      category: 'Hogar',
      type: 'PHYSICAL_PRODUCT',
      tags: ['b'],
      isAvailable: true,
      imageUrl: 'https://velion.pe/b.jpg',
      images: [],
      videoUrl: null,
      sku: 'SKU-DEF',
      normalizedSku: 'SKU-DEF',
      user: { tenantId: 'tenant-match' }
    },
    {
      id: 'nat-no-sku',
      name: 'Producto Nativo Sin SKU',
      description: 'Sin SKU',
      price: 50.00,
      promotionalPrice: null,
      category: 'General',
      type: 'PHYSICAL_PRODUCT',
      tags: [],
      isAvailable: true,
      imageUrl: null,
      images: [],
      videoUrl: null,
      sku: null,
      normalizedSku: null,
      user: { tenantId: 'tenant-match' }
    },
    // Par ambiguo en Native con mismo SKU
    {
      id: 'nat-ambig-1',
      name: 'Nativo Ambiguo 1',
      price: 30.00,
      category: 'Varios',
      type: 'PHYSICAL_PRODUCT',
      tags: [],
      isAvailable: true,
      sku: 'SKU-AMBIG-NAT',
      normalizedSku: 'SKU-AMBIG-NAT',
      user: { tenantId: 'tenant-match' }
    },
    {
      id: 'nat-ambig-2',
      name: 'Nativo Ambiguo 2',
      price: 35.00,
      category: 'Varios',
      type: 'PHYSICAL_PRODUCT',
      tags: [],
      isAvailable: true,
      sku: 'SKU-AMBIG-NAT',
      normalizedSku: 'SKU-AMBIG-NAT',
      user: { tenantId: 'tenant-match' }
    },
    // Nativo con mismo nombre que Shopify pero SKU distinto
    {
      id: 'nat-same-name',
      name: 'Mismo Nombre Exacto',
      price: 60.00,
      category: 'General',
      type: 'PHYSICAL_PRODUCT',
      tags: [],
      isAvailable: true,
      sku: 'SKU-DIFF-NATIVE',
      normalizedSku: 'SKU-DIFF-NATIVE',
      user: { tenantId: 'tenant-match' }
    }
  ];

  const shopifyProducts = [
    {
      id: 'ext-p-x',
      tenantId: 'tenant-match',
      provider: 'SHOPIFY',
      externalId: 'gid://shopify/Product/901',
      title: 'Producto X Shopify',
      description: 'Descripción Shopify X',
      category: 'Shopify Cat',
      tags: ['x'],
      imageUrl: 'https://cdn.shopify.com/x.jpg',
      images: ['https://cdn.shopify.com/x.jpg'],
      isAvailable: true
    },
    {
      id: 'ext-p-y',
      tenantId: 'tenant-match',
      provider: 'SHOPIFY',
      externalId: 'gid://shopify/Product/902',
      title: 'Producto Y Solo Shopify',
      description: 'Descripción Y',
      category: 'Electrónica',
      tags: ['y'],
      imageUrl: 'https://cdn.shopify.com/y.jpg',
      images: [],
      isAvailable: true
    },
    {
      id: 'ext-p-no-sku',
      tenantId: 'tenant-match',
      provider: 'SHOPIFY',
      externalId: 'gid://shopify/Product/903',
      title: 'Shopify Sin SKU',
      category: 'General',
      tags: [],
      imageUrl: null,
      images: [],
      isAvailable: true
    },
    {
      id: 'ext-p-same-name',
      tenantId: 'tenant-match',
      provider: 'SHOPIFY',
      externalId: 'gid://shopify/Product/904',
      title: 'Mismo Nombre Exacto',
      category: 'General',
      tags: [],
      imageUrl: null,
      images: [],
      isAvailable: true
    }
  ];

  const shopifyVariants = [
    {
      id: 'var-x', // Coincide 1:1 con nat-a (SKU-ABC)
      tenantId: 'tenant-match',
      externalProductId: 'ext-p-x',
      provider: 'SHOPIFY',
      externalVariantId: 'gid://shopify/ProductVariant/801',
      sku: 'SKU-ABC',
      normalizedSku: 'SKU-ABC',
      title: 'Default Title',
      price: 120.00, // Precio distinto para testear priceSource
      inventoryQuantity: 42,
      availableForSale: false // No disponible para testear stockSource
    },
    {
      id: 'var-y', // Solo Shopify (SKU-XYZ)
      tenantId: 'tenant-match',
      externalProductId: 'ext-p-y',
      provider: 'SHOPIFY',
      externalVariantId: 'gid://shopify/ProductVariant/802',
      sku: 'SKU-XYZ',
      normalizedSku: 'SKU-XYZ',
      title: 'Default Title',
      price: 300.00,
      inventoryQuantity: 5,
      availableForSale: true
    },
    {
      id: 'var-no-sku',
      tenantId: 'tenant-match',
      externalProductId: 'ext-p-no-sku',
      provider: 'SHOPIFY',
      externalVariantId: 'gid://shopify/ProductVariant/803',
      sku: null,
      normalizedSku: null,
      title: 'Default Title',
      price: 55.00,
      inventoryQuantity: 2,
      availableForSale: true
    },
    // Shopify con SKU coincidente con nat-ambig (pero en nativo hay 2)
    {
      id: 'var-ambig-nat',
      tenantId: 'tenant-match',
      externalProductId: 'ext-p-x',
      provider: 'SHOPIFY',
      externalVariantId: 'gid://shopify/ProductVariant/804',
      sku: 'SKU-AMBIG-NAT',
      normalizedSku: 'SKU-AMBIG-NAT',
      title: 'Default Title',
      price: 40.00,
      inventoryQuantity: 10,
      availableForSale: true
    },
    // Dos variantes Shopify con mismo SKU
    {
      id: 'var-ambig-sh-1',
      tenantId: 'tenant-match',
      externalProductId: 'ext-p-x',
      provider: 'SHOPIFY',
      externalVariantId: 'gid://shopify/ProductVariant/805',
      sku: 'SKU-AMBIG-SHOPIFY',
      normalizedSku: 'SKU-AMBIG-SHOPIFY',
      title: 'Roja',
      price: 70.00,
      inventoryQuantity: 3,
      availableForSale: true
    },
    {
      id: 'var-ambig-sh-2',
      tenantId: 'tenant-match',
      externalProductId: 'ext-p-x',
      provider: 'SHOPIFY',
      externalVariantId: 'gid://shopify/ProductVariant/806',
      sku: 'SKU-AMBIG-SHOPIFY',
      normalizedSku: 'SKU-AMBIG-SHOPIFY',
      title: 'Azul',
      price: 70.00,
      inventoryQuantity: 4,
      availableForSale: true
    },
    // Shopify con mismo nombre exacto pero SKU distinto
    {
      id: 'var-same-name',
      tenantId: 'tenant-match',
      externalProductId: 'ext-p-same-name',
      provider: 'SHOPIFY',
      externalVariantId: 'gid://shopify/ProductVariant/807',
      sku: 'SKU-DIFF-SHOPIFY',
      normalizedSku: 'SKU-DIFF-SHOPIFY',
      title: 'Default Title',
      price: 65.00,
      inventoryQuantity: 8,
      availableForSale: true
    }
  ];

  return {
    setSources(pSource, sSource) {
      integration.priceSource = pSource;
      integration.stockSource = sSource;
    },
    integration: {
      async findFirst({ where }) {
        if (where.tenantId !== integration.tenantId) return null;
        return integration;
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

await runTest('TEST 1: Coincidencia 1:1 por SKU-ABC produce fusión conservando ID nativo', async () => {
  const db = createCombinedFixtureDb();
  const service = new CommerceService(db);

  const resolved = await service.resolveCombinedCatalog('tenant-match');
  const mergedA = resolved.find(item => item.id === 'nat-a');

  assert.ok(mergedA, 'Debe existir el item con ID nativo nat-a');
  assert.strictEqual(mergedA.source, 'MERGED', 'source debe ser MERGED');
  assert.strictEqual(mergedA.name, 'Producto A Nativo', 'Nombre descriptivo debe ser el de Velion Native');
  assert.strictEqual(mergedA.description, 'Descripción Nativa A');
  assert.strictEqual(mergedA.videoUrl, 'https://velion.pe/video-a.mp4', 'Video debe ser el nativo');
  assert.strictEqual(mergedA.shopifyVariantLocalId, 'var-x');
});

await runTest('TEST 2: Deduplicación exacta de filas: SKU emparejado no genera fila duplicada', async () => {
  // Probar con caso de catálogo acotado:
  // Native: A (SKU-ABC), B (SKU-DEF)
  // Shopify: X (SKU-ABC), Y (SKU-XYZ)
  // Resultado: 3 ítems totales (A merged con X, B native, Y shopify)
  const db = createCombinedFixtureDb();
  const service = new CommerceService(db);

  const resolved = await service.resolveCombinedCatalog('tenant-match');

  // Verificar que var-x NO aparece como ítem suelto porque fue fusionado con nat-a
  assert.ok(!resolved.some(item => item.id === 'shopify:var-x'), 'var-x no debe existir como ítem separado');
  // Verificar que nat-a sí está presente (como fusionado)
  assert.ok(resolved.some(item => item.id === 'nat-a'));
  // Verificar que nat-b (no emparejado) está presente
  assert.ok(resolved.some(item => item.id === 'nat-b'));
  // Verificar que var-y (no emparejado) está presente como shopify:var-y
  assert.ok(resolved.some(item => item.id === 'shopify:var-y'));
});

await runTest('TEST 3: Sin SKU no hay merge (nat-no-sku y var-no-sku permanecen separados)', async () => {
  const db = createCombinedFixtureDb();
  const service = new CommerceService(db);

  const resolved = await service.resolveCombinedCatalog('tenant-match');

  const natNoSku = resolved.find(i => i.id === 'nat-no-sku');
  const shpNoSku = resolved.find(i => i.id === 'shopify:var-no-sku');

  assert.ok(natNoSku, 'Producto nativo sin SKU debe existir separado');
  assert.ok(shpNoSku, 'Variante Shopify sin SKU debe existir separada');
  assert.strictEqual(natNoSku.source, 'VELION');
  assert.strictEqual(shpNoSku.source, 'SHOPIFY');
});

await runTest('TEST 4: Ambigüedad nativa (2 nativos con SKU-AMBIG-NAT) bloquea merge', async () => {
  const db = createCombinedFixtureDb();
  const service = new CommerceService(db);

  const resolved = await service.resolveCombinedCatalog('tenant-match');

  const ambig1 = resolved.find(i => i.id === 'nat-ambig-1');
  const ambig2 = resolved.find(i => i.id === 'nat-ambig-2');
  const ambigSh = resolved.find(i => i.id === 'shopify:var-ambig-nat');

  assert.ok(ambig1 && ambig2 && ambigSh, 'Los tres deben permanecer como ítems separados');
  assert.strictEqual(ambig1.source, 'VELION');
  assert.strictEqual(ambig2.source, 'VELION');
  assert.strictEqual(ambigSh.source, 'SHOPIFY');
});

await runTest('TEST 5: Ambigüedad Shopify (2 variantes con SKU-AMBIG-SHOPIFY) bloquea merge', async () => {
  const db = createCombinedFixtureDb();
  const service = new CommerceService(db);

  const resolved = await service.resolveCombinedCatalog('tenant-match');

  const sh1 = resolved.find(i => i.id === 'shopify:var-ambig-sh-1');
  const sh2 = resolved.find(i => i.id === 'shopify:var-ambig-sh-2');

  assert.ok(sh1 && sh2, 'Las dos variantes ambiguas de Shopify deben permanecer separadas');
  assert.strictEqual(sh1.source, 'SHOPIFY');
  assert.strictEqual(sh2.source, 'SHOPIFY');
});

await runTest('TEST 6: Prohibido merge por nombre: mismo título con SKU diferente no se fusiona', async () => {
  const db = createCombinedFixtureDb();
  const service = new CommerceService(db);

  const resolved = await service.resolveCombinedCatalog('tenant-match');

  const natSame = resolved.find(i => i.id === 'nat-same-name');
  const shpSame = resolved.find(i => i.id === 'shopify:var-same-name');

  assert.ok(natSame, 'Nativo con mismo nombre debe existir separado');
  assert.ok(shpSame, 'Shopify con mismo nombre debe existir separado');
  assert.strictEqual(natSame.source, 'VELION');
  assert.strictEqual(shpSame.source, 'SHOPIFY');
});

await runTest('TEST 7: priceSource=SHOPIFY usa precio de Shopify para ítem fusionado', async () => {
  const db = createCombinedFixtureDb({ priceSource: 'SHOPIFY', stockSource: 'VELION' });
  const service = new CommerceService(db);

  const resolved = await service.resolveCombinedCatalog('tenant-match');
  const mergedA = resolved.find(i => i.id === 'nat-a');

  // var-x tiene price = 120.00; nat-a tiene price = 100.00 / promo = 80.00
  assert.strictEqual(mergedA.price, 120.00, 'Debe usar precio de Shopify');
  assert.strictEqual(mergedA.promotionalPrice, null);
  assert.strictEqual(mergedA.hasActivePromo, false);
});

await runTest('TEST 8: priceSource=VELION usa precio nativo y preserva promoción activa', async () => {
  const db = createCombinedFixtureDb({ priceSource: 'VELION', stockSource: 'VELION' });
  const service = new CommerceService(db);

  const resolved = await service.resolveCombinedCatalog('tenant-match');
  const mergedA = resolved.find(i => i.id === 'nat-a');

  // nat-a tiene price = 100.00 y promo activa de 80.00
  assert.strictEqual(mergedA.price, 100.00);
  assert.strictEqual(mergedA.promotionalPrice, 80.00);
  assert.strictEqual(mergedA.effectivePrice, 80.00);
  assert.strictEqual(mergedA.hasActivePromo, true);
});

await runTest('TEST 9: stockSource=SHOPIFY usa availableForSale de Shopify', async () => {
  const db = createCombinedFixtureDb({ priceSource: 'SHOPIFY', stockSource: 'SHOPIFY' });
  const service = new CommerceService(db);

  const resolved = await service.resolveCombinedCatalog('tenant-match');
  const mergedA = resolved.find(i => i.id === 'nat-a');

  // var-x tiene availableForSale = false; nat-a tiene isAvailable = true
  assert.strictEqual(mergedA.isAvailable, false, 'Disponibilidad debe venir de Shopify (availableForSale=false)');
  assert.strictEqual(mergedA.inStock, false);
});

await runTest('TEST 10: stockSource=VELION usa isAvailable nativo', async () => {
  const db = createCombinedFixtureDb({ priceSource: 'SHOPIFY', stockSource: 'VELION' });
  const service = new CommerceService(db);

  const resolved = await service.resolveCombinedCatalog('tenant-match');
  const mergedA = resolved.find(i => i.id === 'nat-a');

  // nat-a tiene isAvailable = true
  assert.strictEqual(mergedA.isAvailable, true, 'Disponibilidad debe venir de Velion Native (isAvailable=true)');
  assert.strictEqual(mergedA.inStock, true);
});

console.log('\n======================================================================');
console.log(`🎉 SUITE COMBINED RESOLUTION: ${passedTests}/${totalTests} TESTS PASARON`);
console.log('======================================================================\n');
