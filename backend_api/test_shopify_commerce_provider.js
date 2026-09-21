/**
 * test_shopify_commerce_provider.js
 * ==================================
 * Suite de pruebas unitarias para ShopifyCachedProvider.
 *
 * Cobertura requerida:
 * 1. getProduct válido: retorna item comercial normalizado con todos los campos.
 * 2. Aislamiento multi-tenant estricto: Tenant B no puede acceder a variantes de Tenant A.
 * 3. getPrice: devuelve precio de la variante sin aplicar promociones nativas.
 * 4. getStock: disponibilidad gobernada por availableForSale (NO por inventoryQuantity > 0).
 * 5. Caso especial: inventoryQuantity = 0 y availableForSale = true -> inStock = true.
 * 6. Caso especial: inventoryQuantity = 10 y availableForSale = false -> inStock = false.
 * 7. Default Title: displayName es product.title (omite "- Default Title").
 * 8. Variante real: displayName es `${product.title} - ${variant.title}`.
 * 9. Media: imageUrl, images sincronizados, videoUrl estrictamente null.
 * 10. Offline / Cero red: verificación de que el provider no invoca fetch ni módulos de red.
 */

import assert from 'node:assert';
import { ShopifyCachedProvider } from './src/services/commerce/ShopifyCachedProvider.js';

console.log('======================================================================');
console.log('🧪 VELION SHOPIFY CACHED COMMERCE PROVIDER SUITE');
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

// Fixtures mock para testing in-memory
function createMockDb() {
  const products = [
    {
      id: 'ext-prod-1',
      tenantId: 'tenant-alpha',
      provider: 'SHOPIFY',
      externalId: 'gid://shopify/Product/1001',
      title: 'Snowboard Minimal',
      description: 'Tabla de nieve de alta calidad',
      category: 'Deportes',
      tags: ['invierno', 'nieve'],
      imageUrl: 'https://cdn.shopify.com/snowboard.jpg',
      images: ['https://cdn.shopify.com/snowboard.jpg', 'https://cdn.shopify.com/snowboard-2.jpg'],
      isAvailable: true,
      syncedAt: new Date()
    },
    {
      id: 'ext-prod-2',
      tenantId: 'tenant-alpha',
      provider: 'SHOPIFY',
      externalId: 'gid://shopify/Product/1002',
      title: 'Camiseta Velion',
      description: 'Camiseta de algodón peruano',
      category: 'Ropa',
      tags: ['verano'],
      imageUrl: 'https://cdn.shopify.com/shirt.jpg',
      images: ['https://cdn.shopify.com/shirt.jpg'],
      isAvailable: true,
      syncedAt: new Date()
    },
    {
      id: 'ext-prod-beta',
      tenantId: 'tenant-beta',
      provider: 'SHOPIFY',
      externalId: 'gid://shopify/Product/9999',
      title: 'Producto Secreto Beta',
      description: 'Solo para Beta',
      category: 'Confidencial',
      tags: [],
      imageUrl: null,
      images: [],
      isAvailable: true,
      syncedAt: new Date()
    }
  ];

  const variants = [
    {
      id: 'var-uuid-1',
      tenantId: 'tenant-alpha',
      externalProductId: 'ext-prod-1',
      provider: 'SHOPIFY',
      externalVariantId: 'gid://shopify/ProductVariant/2001',
      sku: 'SNOW-MIN-DEF',
      normalizedSku: 'SNOW-MIN-DEF',
      title: 'Default Title',
      price: 250.00,
      compareAtPrice: 300.00,
      inventoryQuantity: 15,
      availableForSale: true,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 'var-uuid-2-m',
      tenantId: 'tenant-alpha',
      externalProductId: 'ext-prod-2',
      provider: 'SHOPIFY',
      externalVariantId: 'gid://shopify/ProductVariant/2002',
      sku: 'SHIRT-M',
      normalizedSku: 'SHIRT-M',
      title: 'Medium',
      price: 49.90,
      compareAtPrice: null,
      inventoryQuantity: 0, // Caso crítico: stock 0 pero disponible para venta
      availableForSale: true,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 'var-uuid-2-l',
      tenantId: 'tenant-alpha',
      externalProductId: 'ext-prod-2',
      provider: 'SHOPIFY',
      externalVariantId: 'gid://shopify/ProductVariant/2003',
      sku: 'SHIRT-L',
      normalizedSku: 'SHIRT-L',
      title: 'Large',
      price: 49.90,
      compareAtPrice: null,
      inventoryQuantity: 10, // Stock positivo pero venta no permitida
      availableForSale: false,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 'var-beta-1',
      tenantId: 'tenant-beta',
      externalProductId: 'ext-prod-beta',
      provider: 'SHOPIFY',
      externalVariantId: 'gid://shopify/ProductVariant/9001',
      sku: 'BETA-SKU',
      normalizedSku: 'BETA-SKU',
      title: 'Default Title',
      price: 999.00,
      compareAtPrice: null,
      inventoryQuantity: 5,
      availableForSale: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ];

  return {
    externalProductVariant: {
      async findFirst({ where, include }) {
        const found = variants.find(v => {
          if (where.id && v.id !== where.id) return false;
          if (where.tenantId && v.tenantId !== where.tenantId) return false;
          if (where.provider && v.provider !== where.provider) return false;
          return true;
        });
        if (!found) return null;
        const result = { ...found };
        if (include?.externalProduct) {
          result.externalProduct = products.find(p => p.id === found.externalProductId) || null;
        }
        return result;
      },
      async findMany({ where, include }) {
        let list = variants.filter(v => {
          if (where.tenantId && v.tenantId !== where.tenantId) return false;
          if (where.provider && v.provider !== where.provider) return false;
          if (where.availableForSale !== undefined && v.availableForSale !== where.availableForSale) return false;
          return true;
        });

        if (include?.externalProduct) {
          list = list.map(v => ({
            ...v,
            externalProduct: products.find(p => p.id === v.externalProductId) || null
          }));
        }

        if (where.externalProduct?.isAvailable !== undefined) {
          list = list.filter(v => v.externalProduct?.isAvailable === where.externalProduct.isAvailable);
        }
        if (where.externalProduct?.category) {
          list = list.filter(v => v.externalProduct?.category === where.externalProduct.category);
        }

        return list;
      }
    },
    integration: {
      async findFirst({ where }) {
        return {
          id: 'int-1',
          tenantId: where?.tenantId || 'tenant-alpha',
          provider: 'SHOPIFY',
          shopCurrencyCode: 'USD',
          status: 'CONNECTED'
        };
      }
    }
  };
}

// ── EJECUCIÓN DE TESTS ────────────────────────────────────────────────────────

await runTest('TEST 1: getProduct normaliza variante con todos los campos requeridos', async () => {
  const mockDb = createMockDb();
  const provider = new ShopifyCachedProvider(mockDb);

  const item = await provider.getProduct('tenant-alpha', 'shopify:var-uuid-1');
  assert.ok(item, 'Debe encontrar el item');
  assert.strictEqual(item.id, 'shopify:var-uuid-1');
  assert.strictEqual(item.name, 'Snowboard Minimal'); // Default Title omitido
  assert.strictEqual(item.price, 250.00);
  assert.strictEqual(item.type, 'PHYSICAL_PRODUCT');
  assert.strictEqual(item.category, 'Deportes');
  assert.strictEqual(item.isAvailable, true);
  assert.strictEqual(item.imageUrl, 'https://cdn.shopify.com/snowboard.jpg');
  assert.deepStrictEqual(item.images, ['https://cdn.shopify.com/snowboard.jpg', 'https://cdn.shopify.com/snowboard-2.jpg']);
  assert.strictEqual(item.videoUrl, null, 'Shopify no provee video directo en V1');
  assert.strictEqual(item.sku, 'SNOW-MIN-DEF');
  assert.strictEqual(item.source, 'SHOPIFY');
});

await runTest('TEST 2: Aislamiento Multi-Tenant — Tenant Alpha no puede leer variantes de Tenant Beta', async () => {
  const mockDb = createMockDb();
  const provider = new ShopifyCachedProvider(mockDb);

  // Tenant Alpha consulta UUID de Tenant Beta
  const leaked = await provider.getProduct('tenant-alpha', 'shopify:var-beta-1');
  assert.strictEqual(leaked, null, 'Debe retornar null (fail-closed) ante acceso cross-tenant');

  // Tenant Beta sí puede leer su propia variante
  const legit = await provider.getProduct('tenant-beta', 'shopify:var-beta-1');
  assert.ok(legit, 'Tenant Beta debe poder consultar su propia variante');
  assert.strictEqual(legit.name, 'Producto Secreto Beta');
});

await runTest('TEST 3: getPrice retorna precio de la variante sin promociones activas', async () => {
  const mockDb = createMockDb();
  const provider = new ShopifyCachedProvider(mockDb);

  const priceInfo = await provider.getPrice('tenant-alpha', 'shopify:var-uuid-1');
  assert.strictEqual(priceInfo.price, 250.00);
  assert.strictEqual(priceInfo.effectivePrice, 250.00);
  assert.strictEqual(priceInfo.promotionalPrice, null);
  assert.strictEqual(priceInfo.hasActivePromo, false);
});

await runTest('TEST 4: getStock respeta availableForSale (stock 0 pero disponible -> inStock = true)', async () => {
  const mockDb = createMockDb();
  const provider = new ShopifyCachedProvider(mockDb);

  // var-uuid-2-m tiene inventoryQuantity = 0 pero availableForSale = true
  const stock = await provider.getStock('tenant-alpha', 'shopify:var-uuid-2-m');
  assert.strictEqual(stock.inStock, true, 'Debe estar en stock porque availableForSale es true');
  assert.strictEqual(stock.inventoryQuantity, 0);
  assert.strictEqual(stock.isTracked, false, 'isTracked debe ser false (no inferido de inventoryQuantity)');
});

await runTest('TEST 5: getStock respeta availableForSale=false (stock 10 pero no vendible -> inStock = false)', async () => {
  const mockDb = createMockDb();
  const provider = new ShopifyCachedProvider(mockDb);

  // var-uuid-2-l tiene inventoryQuantity = 10 pero availableForSale = false
  const stock = await provider.getStock('tenant-alpha', 'shopify:var-uuid-2-l');
  assert.strictEqual(stock.inStock, false, 'No debe estar en stock porque availableForSale es false');
  assert.strictEqual(stock.inventoryQuantity, 10);
});

await runTest('TEST 6: Default Title no aparece en el displayName mostrado al cliente', async () => {
  const mockDb = createMockDb();
  const provider = new ShopifyCachedProvider(mockDb);

  const item = await provider.getProduct('tenant-alpha', 'shopify:var-uuid-1');
  assert.strictEqual(item.name, 'Snowboard Minimal');
  assert.ok(!item.name.includes('Default Title'), 'No debe incluir "Default Title"');
});

await runTest('TEST 7: Variante con título real compone correctamente el displayName', async () => {
  const mockDb = createMockDb();
  const provider = new ShopifyCachedProvider(mockDb);

  const item = await provider.getProduct('tenant-alpha', 'shopify:var-uuid-2-m');
  assert.strictEqual(item.name, 'Camiseta Velion - Medium');
});

await runTest('TEST 8: getCompactCatalogCsv genera cabecera exacta y formato canónico', async () => {
  const mockDb = createMockDb();
  const provider = new ShopifyCachedProvider(mockDb);

  const csv = await provider.getCompactCatalogCsv('tenant-alpha');
  const lines = csv.trim().split('\n');

  assert.strictEqual(lines[0], 'ID,Nombre,Precio,Tipo,Categoria', 'Cabecera exacta requerida');
  assert.ok(lines.length >= 2, 'Debe contener filas de datos');

  // Solo variantes disponibles (var-uuid-1 y var-uuid-2-m; var-uuid-2-l tiene availableForSale=false)
  assert.ok(lines.some(l => l.startsWith('shopify:var-uuid-1,Snowboard Minimal,USD 250,PHYSICAL_PRODUCT,Deportes')));
  assert.ok(lines.some(l => l.startsWith('shopify:var-uuid-2-m,Camiseta Velion - Medium,USD 49.9,PHYSICAL_PRODUCT,Ropa')));
  assert.ok(!lines.some(l => l.includes('var-uuid-2-l')), 'Variante no disponible no debe aparecer en CSV');
});

await runTest('TEST 9: searchProducts con filtro de categoría y texto', async () => {
  const mockDb = createMockDb();
  const provider = new ShopifyCachedProvider(mockDb);

  const sports = await provider.searchProducts('tenant-alpha', { category: 'Deportes' });
  assert.strictEqual(sports.length, 1);
  assert.strictEqual(sports[0].name, 'Snowboard Minimal');

  const queryMatch = await provider.searchProducts('tenant-alpha', { query: 'camiseta' });
  assert.strictEqual(queryMatch.length, 2); // Medium y Large
});

await runTest('TEST 10: Formato de IDs inválidos o sin prefijo shopify: retorna null', async () => {
  const mockDb = createMockDb();
  const provider = new ShopifyCachedProvider(mockDb);

  const noPrefix = await provider.getProduct('tenant-alpha', 'var-uuid-1');
  assert.strictEqual(noPrefix, null, 'ID sin prefijo debe retornar null');

  const emptyId = await provider.getProduct('tenant-alpha', '');
  assert.strictEqual(emptyId, null);

  const nullTenant = await provider.getProduct(null, 'shopify:var-uuid-1');
  assert.strictEqual(nullTenant, null);
});

await runTest('TEST 11: Cero llamadas de red (fetch=0, GraphQL=0, OAuth/token=0) durante operaciones de ShopifyCachedProvider', async () => {
  const mockDb = createMockDb();
  const provider = new ShopifyCachedProvider(mockDb);

  let fetchCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = () => {
    fetchCalls++;
    throw new Error('NETWORK CALL DETECTED');
  };

  try {
    await provider.getProduct('tenant-alpha', 'shopify:var-uuid-1');
    await provider.getStock('tenant-alpha', 'shopify:var-uuid-1');
    await provider.getPrice('tenant-alpha', 'shopify:var-uuid-1');
    await provider.searchProducts('tenant-alpha', { category: 'Deportes' });
    await provider.getCompactCatalogCsv('tenant-alpha');
    assert.strictEqual(fetchCalls, 0, 'ShopifyCachedProvider fetch calls must be exactly 0');
  } finally {
    global.fetch = originalFetch;
  }
});

console.log('\n======================================================================');
console.log(`🎉 SUITE SHOPIFY CACHED PROVIDER: ${passedTests}/${totalTests} TESTS PASARON`);
console.log('======================================================================\n');
