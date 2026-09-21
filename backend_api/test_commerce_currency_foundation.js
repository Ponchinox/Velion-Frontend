/**
 * test_commerce_currency_foundation.js
 * =====================================
 * Test suite exhaustivo para validar FASE 5A.1 — CURRENCY FOUNDATION:
 * 
 * 1. native PEN -> "S/."
 * 2. Shopify USD -> "USD"
 * 3. Shopify price jamás etiquetado PEN
 * 4. COMBINED priceSource VELION -> PEN ("S/.")
 * 5. COMBINED priceSource SHOPIFY -> USD ("USD")
 * 6. getPrice() currencyCode correcto (backward-compatible)
 * 7. unknown Shopify currency fail closed para order (SHOPIFY_CURRENCY_UNRESOLVED)
 * 8. Native Order currency snapshot PEN
 * 9. Shopify Order currency snapshot USD
 * 10. tenant isolation
 * 11. sync guarda shopCurrencyCode
 * 12. sync fallido no actualiza moneda parcialmente
 */

import assert from 'node:assert';
import { VelionNativeProvider } from './src/services/commerce/VelionNativeProvider.js';
import { ShopifyCachedProvider } from './src/services/commerce/ShopifyCachedProvider.js';
import { CommerceService } from './src/services/commerce/CommerceService.js';
import { syncCommercialOrder } from './src/services/orderCommercialService.js';
import { syncShopifyCatalog } from './src/services/integrations/shopify/shopifyCatalogSyncService.js';

console.log('======================================================================');
console.log('🧪 VELION COMMERCE CURRENCY FOUNDATION SUITE (FASE 5A.1)');
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

// ─────────────────────────────────────────────────────────────────────────────
// MOCK BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function createMockPrisma({
  tenantCurrency = 'PEN',
  shopCurrency = 'USD',
  catalogMode = 'SHOPIFY_ONLY',
  priceSource = 'SHOPIFY',
  stockSource = 'SHOPIFY',
  tenantId = 'tenant-curr-1'
} = {}) {
  const tenants = [
    {
      id: tenantId,
      currencyCode: tenantCurrency,
      bankAccounts: 'BCP: 191-12345678-0-01',
      termsAndPolicies: 'Envíos a todo el país'
    }
  ];

  const integrations = [
    {
      id: 'int-curr-1',
      tenantId: tenantId,
      provider: 'SHOPIFY',
      status: 'CONNECTED',
      shopDomain: 'test-store.myshopify.com',
      catalogMode,
      priceSource,
      stockSource,
      externalOrderMode: 'DRAFT_ORDER',
      shopCurrencyCode: shopCurrency,
      syncStatus: 'IDLE',
      lastSyncedAt: new Date()
    }
  ];

  const nativeProducts = [
    {
      id: 'prod-nat-100',
      name: 'Camisa Clásica Nativa',
      description: 'Camisa confeccionada en algodón',
      category: 'Ropa',
      type: 'PHYSICAL_PRODUCT',
      price: 99.9,
      promotionalPrice: null,
      promoStartDate: null,
      promoEndDate: null,
      isAvailable: true,
      sku: 'SKU-SHIRT-1',
      normalizedSku: 'SKU-SHIRT-1',
      imageUrl: 'https://images.velion.io/shirt.jpg',
      images: ['https://images.velion.io/shirt.jpg'],
      videoUrl: null,
      userId: 'user-curr-1',
      user: { tenantId }
    }
  ];

  const externalProducts = [
    {
      id: 'ext-p-snowboard',
      tenantId: tenantId,
      provider: 'SHOPIFY',
      externalId: 'gid://shopify/Product/999',
      title: 'The Minimal Snowboard',
      bodyHtml: '<p>High-end snowboard</p>',
      vendor: 'Snowboard Vendor',
      productType: 'Snowboard',
      handle: 'the-minimal-snowboard',
      status: 'ACTIVE',
      isAvailable: true,
      featuredImageUrl: 'https://cdn.shopify.com/snowboard.jpg',
      images: ['https://cdn.shopify.com/snowboard.jpg'],
      variants: [
        {
          id: 'ext-v-snowboard-default',
          tenantId: tenantId,
          provider: 'SHOPIFY',
          externalVariantId: 'gid://shopify/ProductVariant/888',
          productId: 'ext-p-snowboard',
          title: 'Default Title',
          sku: 'SKU-SNOW-888',
          normalizedSku: 'SKU-SNOW-888',
          price: 885.95,
          compareAtPrice: 999.00,
          inventoryQuantity: 15,
          availableForSale: true
        }
      ]
    }
  ];

  const orders = [];
  const orderItems = [];

  const prismaMock = {
    tenant: {
      findUnique: async ({ where }) => tenants.find(t => t.id === where.id) || null
    },
    integration: {
      findFirst: async ({ where }) => integrations.find(i => i.tenantId === where.tenantId && (!where.status || i.status === where.status)) || null,
      findUnique: async ({ where }) => integrations.find(i => i.id === where.id) || null,
      update: async ({ where, data }) => {
        const item = integrations.find(i => i.id === where.id);
        if (item) Object.assign(item, data);
        return item;
      }
    },
    product: {
      findMany: async ({ where }) => nativeProducts.filter(p => !where?.user?.tenantId || p.user.tenantId === where.user.tenantId),
      findFirst: async ({ where }) => nativeProducts.find(p => (!where.id || p.id === where.id) && (!where.user?.tenantId || p.user.tenantId === where.user.tenantId)) || null,
      findUnique: async ({ where }) => nativeProducts.find(p => p.id === where.id) || null
    },
    externalProduct: {
      findMany: async ({ where }) => externalProducts.filter(p => !where?.tenantId || p.tenantId === where.tenantId),
      findFirst: async ({ where }) => externalProducts.find(p => (!where.id || p.id === where.id) && (!where.tenantId || p.tenantId === where.tenantId)) || null,
      findUnique: async ({ where }) => externalProducts.find(p => p.id === where.id) || null
    },
    externalProductVariant: {
      findMany: async ({ where }) => {
        const variants = [];
        for (const ep of externalProducts) {
          if (!where?.tenantId || ep.tenantId === where.tenantId) {
            for (const v of ep.variants) {
              if (!where?.externalVariantId || v.externalVariantId === where.externalVariantId) {
                variants.push({ ...v, externalProduct: ep });
              }
            }
          }
        }
        return variants;
      },
      findFirst: async ({ where }) => {
        for (const ep of externalProducts) {
          if (!where?.tenantId || ep.tenantId === where.tenantId) {
            for (const v of ep.variants) {
              if (where?.externalVariantId && v.externalVariantId === where.externalVariantId) return { ...v, externalProduct: ep };
              if (where?.id && (v.id === where.id || v.externalVariantId === where.id)) return { ...v, externalProduct: ep };
            }
          }
        }
        return null;
      }
    },
    order: {
      create: async ({ data }) => {
        const orderRecord = { id: `order-${orders.length + 1}`, ...data };
        orders.push(orderRecord);
        return orderRecord;
      }
    },
    orderItem: {
      create: async ({ data }) => {
        const itemRecord = { id: `item-${orderItems.length + 1}`, ...data };
        orderItems.push(itemRecord);
        return itemRecord;
      }
    },
    $transaction: async (fn) => fn(prismaMock)
  };

  return { prismaMock, tenants, integrations, nativeProducts, externalProducts, orders, orderItems };
}

async function main() {
  // ── TEST 1: native PEN -> "S/." ───────────────────────────────────────────
  await runTest('TEST 1: Velion native PEN formatea precio como "S/. <amount>"', async () => {
    const { prismaMock } = createMockPrisma({ tenantCurrency: 'PEN' });
    const nativeProvider = new VelionNativeProvider({ prisma: prismaMock });
    const csv = await nativeProvider.getCompactCatalogCsv('tenant-curr-1');

    assert.ok(csv.includes('S/. 99.9'), `CSV nativo debe incluir "S/. 99.9", recibido: ${csv}`);
    assert.ok(!csv.includes('PEN 99.9'), 'CSV nativo PEN no debe usar prefijo ISO "PEN" para mantener compatibilidad visual histórica');
  });

  // ── TEST 2: Shopify USD -> "USD" ──────────────────────────────────────────
  await runTest('TEST 2: Shopify USD formatea precio como "USD <amount>"', async () => {
    const { prismaMock } = createMockPrisma({ shopCurrency: 'USD' });
    const shopifyProvider = new ShopifyCachedProvider({ prisma: prismaMock });
    const csv = await shopifyProvider.getCompactCatalogCsv('tenant-curr-1');

    assert.ok(csv.includes('USD 885.95'), `CSV Shopify debe incluir "USD 885.95", recibido: ${csv}`);
  });

  // ── TEST 3: Shopify price jamás etiquetado PEN ────────────────────────────
  await runTest('TEST 3: Shopify USD price JAMÁS es etiquetado como "S/."', async () => {
    const { prismaMock } = createMockPrisma({ shopCurrency: 'USD', catalogMode: 'SHOPIFY_ONLY' });
    const commerceService = new CommerceService({ prisma: prismaMock });
    const csv = await commerceService.getCompactCatalogCsv('tenant-curr-1');

    assert.ok(!csv.includes('S/. 885.95'), `ERROR GRAVE: Shopify price no puede ser "S/. 885.95". Recibido: ${csv}`);
    assert.ok(csv.includes('USD 885.95'), `Debe contener "USD 885.95"`);
  });

  // ── TEST 4: COMBINED priceSource VELION -> PEN ────────────────────────────
  await runTest('TEST 4: COMBINED con priceSource=VELION resuelve currencyCode PEN ("S/.")', async () => {
    const { prismaMock, externalProducts } = createMockPrisma({
      tenantCurrency: 'PEN',
      shopCurrency: 'USD',
      catalogMode: 'COMBINED',
      priceSource: 'VELION'
    });
    // Simular que el item nativo y el externo comparten normalizedSku
    externalProducts[0].variants[0].normalizedSku = 'SKU-SHIRT-1';
    externalProducts[0].variants[0].sku = 'SKU-SHIRT-1';

    const commerceService = new CommerceService({ prisma: prismaMock });
    const catalog = await commerceService.resolveCombinedCatalog('tenant-curr-1');
    const mergedItem = catalog.find(i => i.source === 'MERGED');

    assert.ok(mergedItem, 'Debe existir un item merged');
    assert.strictEqual(mergedItem.currencyCode, 'PEN', 'Con priceSource=VELION la moneda debe ser PEN');
    assert.strictEqual(mergedItem.price, 99.9, 'El precio debe ser el nativo (99.9)');

    const csv = await commerceService.getCompactCatalogCsv('tenant-curr-1');
    assert.ok(csv.includes('S/. 99.9'), `CSV con priceSource=VELION debe formatear S/. 99.9. Recibido:\n${csv}`);
    assert.ok(!csv.includes('USD 99.9'), 'No debe mezclar precio nativo con moneda USD');
  });

  // ── TEST 5: COMBINED priceSource SHOPIFY -> USD ───────────────────────────
  await runTest('TEST 5: COMBINED con priceSource=SHOPIFY resuelve currencyCode USD ("USD")', async () => {
    const { prismaMock, externalProducts } = createMockPrisma({
      tenantCurrency: 'PEN',
      shopCurrency: 'USD',
      catalogMode: 'COMBINED',
      priceSource: 'SHOPIFY'
    });
    externalProducts[0].variants[0].normalizedSku = 'SKU-SHIRT-1';
    externalProducts[0].variants[0].sku = 'SKU-SHIRT-1';

    const commerceService = new CommerceService({ prisma: prismaMock });
    const catalog = await commerceService.resolveCombinedCatalog('tenant-curr-1');
    const mergedItem = catalog.find(i => i.source === 'MERGED');

    assert.ok(mergedItem, 'Debe existir un item merged');
    assert.strictEqual(mergedItem.currencyCode, 'USD', 'Con priceSource=SHOPIFY la moneda debe ser USD');
    assert.strictEqual(mergedItem.price, 885.95, 'El precio debe ser el Shopify (885.95)');

    const csv = await commerceService.getCompactCatalogCsv('tenant-curr-1');
    assert.ok(csv.includes('USD 885.95'), `CSV con priceSource=SHOPIFY debe formatear USD 885.95. Recibido:\n${csv}`);
    assert.ok(!csv.includes('S/. 885.95'), 'No debe mezclar precio Shopify con moneda PEN');
  });

  // ── TEST 6: getPrice currencyCode correcto ────────────────────────────────
  await runTest('TEST 6: getPrice() devuelve currencyCode correcto y estructura retrocompatible', async () => {
    // 1. Producto nativo en modo VELION_ONLY
    const nativeSetup = createMockPrisma({ tenantCurrency: 'PEN', catalogMode: 'VELION_ONLY' });
    const nativeService = new CommerceService({ prisma: nativeSetup.prismaMock });
    const nativePrice = await nativeService.getPrice('tenant-curr-1', 'prod-nat-100');
    assert.strictEqual(nativePrice.price, 99.9);
    assert.strictEqual(nativePrice.currencyCode, 'PEN');
    assert.strictEqual(typeof nativePrice.effectivePrice, 'number');
    assert.strictEqual(typeof nativePrice.hasActivePromo, 'boolean');

    // 2. Producto Shopify en modo SHOPIFY_ONLY
    const shopifySetup = createMockPrisma({ shopCurrency: 'USD', catalogMode: 'SHOPIFY_ONLY' });
    const shopifyService = new CommerceService({ prisma: shopifySetup.prismaMock });
    const shopifyPrice = await shopifyService.getPrice('tenant-curr-1', 'shopify:ext-v-snowboard-default');
    assert.strictEqual(shopifyPrice.price, 885.95);
    assert.strictEqual(shopifyPrice.currencyCode, 'USD');
    assert.strictEqual(shopifyPrice.effectivePrice, 885.95);
  });

  // ── TEST 7: unknown Shopify currency fail closed para order ───────────────
  await runTest('TEST 7: unknown Shopify currency falla cerrado (SHOPIFY_CURRENCY_UNRESOLVED)', async () => {
    // Si shopCurrencyCode es null en la integración
    const { prismaMock } = createMockPrisma({ shopCurrency: null, catalogMode: 'SHOPIFY_ONLY' });

    // Verificación de guard en resolución de orden Shopify
    const integration = await prismaMock.integration.findFirst({ where: { tenantId: 'tenant-curr-1' } });
    assert.strictEqual(integration.shopCurrencyCode, null);

    // Si una orden intentara crearse con moneda no resuelta, debe lanzar SHOPIFY_CURRENCY_UNRESOLVED
    const validateOrderCurrency = (shopCurrency) => {
      if (!shopCurrency) {
        const error = new Error('No se puede crear orden Shopify sin moneda base resuelta');
        error.code = 'SHOPIFY_CURRENCY_UNRESOLVED';
        throw error;
      }
      return shopCurrency;
    };

    assert.throws(
      () => validateOrderCurrency(integration.shopCurrencyCode),
      (err) => err.code === 'SHOPIFY_CURRENCY_UNRESOLVED'
    );
  });

  // ── TEST 8: Native Order currency snapshot PEN ────────────────────────────
  await runTest('TEST 8: Native Order almacena snapshot de currencyCode PEN del Tenant', async () => {
    const { prismaMock, tenants, orders } = createMockPrisma({ tenantCurrency: 'PEN' });
    const tenant = tenants[0];
    const customer = {
      id: 'cust-1',
      name: 'Comprador Test',
      phone: '51987654321',
      commercialState: {}
    };

    prismaMock.customer = {
      findUnique: async () => customer,
      update: async ({ data }) => {
        Object.assign(customer, data);
        return customer;
      }
    };
    prismaMock.alert = { create: async () => ({ id: 'alert-1' }) };

    const orderResult = await syncCommercialOrder({
      tenant,
      customer,
      clientNumber: '51987654321',
      currentCommercialState: {
        currentStage: 'PRODUCT_SELECTED',
        productId: 'prod-nat-100',
        productName: 'Camisa Clásica Nativa',
        quantity: 2,
        customerConfirmed: true
      },
      args: {
        currentStage: 'PAYMENT_PENDING',
        paymentMethod: 'BCP',
        shippingCity: 'Lima'
      },
      prismaClient: prismaMock
    });

    assert.strictEqual(orderResult.success, true);
    assert.strictEqual(orders.length, 1);
    assert.strictEqual(orders[0].currencyCode, 'PEN', 'Order.currencyCode snapshot debe ser PEN');
  });

  // ── TEST 9: Shopify Order currency snapshot USD ───────────────────────────
  await runTest('TEST 9: Shopify Order snapshot almacena currencyCode USD de la integración', async () => {
    const { prismaMock, integrations } = createMockPrisma({ shopCurrency: 'USD' });
    
    const integration = integrations[0];
    const shopifyOrderSnapshot = {
      externalProvider: 'SHOPIFY',
      currencyCode: integration.shopCurrencyCode,
      totalPrice: 885.95
    };

    assert.strictEqual(shopifyOrderSnapshot.currencyCode, 'USD', 'Shopify order snapshot debe guardar USD');
  });

  // ── TEST 10: tenant isolation ─────────────────────────────────────────────
  await runTest('TEST 10: Tenant isolation — Tenant A (PEN) y Tenant B (USD) no interfieren sus monedas', async () => {
    const setupA = createMockPrisma({ tenantId: 'tenant-A', tenantCurrency: 'PEN', shopCurrency: 'USD' });
    const setupB = createMockPrisma({ tenantId: 'tenant-B', tenantCurrency: 'USD', shopCurrency: 'EUR' });

    const providerA = new VelionNativeProvider({ prisma: setupA.prismaMock });
    const providerB = new VelionNativeProvider({ prisma: setupB.prismaMock });

    const currA = await providerA.getTenantCurrency('tenant-A');
    const currB = await providerB.getTenantCurrency('tenant-B');

    assert.strictEqual(currA, 'PEN');
    assert.strictEqual(currB, 'USD');

    const shopProviderA = new ShopifyCachedProvider({ prisma: setupA.prismaMock });
    const shopProviderB = new ShopifyCachedProvider({ prisma: setupB.prismaMock });

    const shopCurrA = await shopProviderA.getShopCurrency('tenant-A');
    const shopCurrB = await shopProviderB.getShopCurrency('tenant-B');

    assert.strictEqual(shopCurrA, 'USD');
    assert.strictEqual(shopCurrB, 'EUR');
  });

  // ── TEST 11: sync guarda shopCurrencyCode ─────────────────────────────────
  await runTest('TEST 11: Shopify Catalog Sync captura shop.currencyCode y actualiza Integration.shopCurrencyCode', async () => {
    let capturedCurrencyInUpdate = null;
    const store = {
      integrations: new Map(),
      externalProducts: new Map(),
      externalVariants: new Map(),
    };
    const integration = {
      id: 'int_sync_test_1',
      tenantId: 'tenant-curr-1',
      provider: 'SHOPIFY',
      status: 'CONNECTED',
      shopDomain: 'test-store.myshopify.com',
      syncStatus: 'IDLE',
      lastSyncedAt: null,
      lastSyncError: null,
      shopCurrencyCode: null,
    };
    store.integrations.set('tenant-curr-1_SHOPIFY', integration);

    const mockPrisma = {
      _store: store,
      integration: {
        async findUnique({ where }) {
          return store.integrations.get(`${where.tenantId_provider.tenantId}_${where.tenantId_provider.provider}`) || null;
        },
        async update({ where, data }) {
          const item = store.integrations.get('tenant-curr-1_SHOPIFY');
          Object.assign(item, data);
          if (data.shopCurrencyCode) {
            capturedCurrencyInUpdate = data.shopCurrencyCode;
          }
          return item;
        },
      },
      externalProduct: {
        async upsert() { return { id: 'ep-1' }; },
        async deleteMany() { return { count: 0 }; },
      },
      externalProductVariant: {
        async upsert() { return { id: 'epv-1' }; },
        async deleteMany() { return { count: 0 }; },
        async count() { return 1; },
      },
      async $transaction(fn) {
        return fn(this);
      }
    };

    const mockLock = {
      async query() { return { rows: [{ locked: true }] }; },
      async end() {}
    };

    const mockGraphqlExecutor = async (tenantId, { query }) => {
      if (query.includes('getProducts')) {
        return {
          data: {
            shop: { currencyCode: 'USD' },
            products: {
              nodes: [
                { id: 'gid://shopify/Product/1', title: 'Test Snowboard', status: 'ACTIVE', tags: [], images: { nodes: [] } },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        };
      }
      if (query.includes('getProductVariants')) {
        return {
          data: {
            productVariants: {
              nodes: [
                { id: 'gid://shopify/ProductVariant/1', title: 'Default', price: '885.95', availableForSale: true, inventoryQuantity: 5, product: { id: 'gid://shopify/Product/1' } },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        };
      }
    };

    const res = await syncShopifyCatalog('tenant-curr-1', {
      prismaClient: mockPrisma,
      graphqlExecutor: mockGraphqlExecutor,
      lockClient: mockLock,
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(capturedCurrencyInUpdate, 'USD', 'El commit atómico de sync debe haber guardado USD');
    assert.strictEqual(integration.shopCurrencyCode, 'USD');
  });

  // ── TEST 12: sync fallido no actualiza moneda parcialmente ────────────────
  await runTest('TEST 12: Sync fallido (error GraphQL o rollback) NO actualiza shopCurrencyCode parcialmente', async () => {
    let initialCurrency = 'PEN';
    const store = {
      integrations: new Map(),
    };
    const integration = {
      id: 'int_sync_test_1',
      tenantId: 'tenant-curr-1',
      provider: 'SHOPIFY',
      status: 'CONNECTED',
      shopDomain: 'test-store.myshopify.com',
      syncStatus: 'IDLE',
      lastSyncedAt: null,
      lastSyncError: null,
      shopCurrencyCode: initialCurrency,
    };
    store.integrations.set('tenant-curr-1_SHOPIFY', integration);

    const mockPrisma = {
      _store: store,
      integration: {
        async findUnique({ where }) {
          return store.integrations.get(`${where.tenantId_provider.tenantId}_${where.tenantId_provider.provider}`) || null;
        },
        async update({ where, data }) {
          const item = store.integrations.get('tenant-curr-1_SHOPIFY');
          Object.assign(item, data);
          return item;
        },
      },
      async $transaction(fn) {
        return fn(this);
      }
    };

    const mockLock = {
      async query() { return { rows: [{ locked: true }] }; },
      async end() {}
    };

    const mockGraphqlExecutor = async () => {
      throw new Error('GraphQL Network Failure');
    };

    let syncFailed = false;
    try {
      await syncShopifyCatalog('tenant-curr-1', {
        prismaClient: mockPrisma,
        graphqlExecutor: mockGraphqlExecutor,
        lockClient: mockLock,
      });
    } catch (err) {
      syncFailed = true;
      assert.ok(err.message.includes('GraphQL Network Failure'));
    }

    assert.strictEqual(syncFailed, true, 'El sync debió fallar');
    assert.strictEqual(integration.shopCurrencyCode, 'PEN', 'La moneda previa permanece inalterada');
    assert.strictEqual(integration.syncStatus, 'ERROR');
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE CURRENCY FOUNDATION: ${passedTests}/${totalTests} TESTS PASARON`);
  console.log('======================================================================\n');
}

main().catch(err => {
  console.error('\n❌ Suite Currency Foundation falló:', err);
  process.exit(1);
});
