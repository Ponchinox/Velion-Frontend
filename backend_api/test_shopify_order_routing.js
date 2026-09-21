/**
 * test_shopify_order_routing.js
 * ==============================
 * Suite de pruebas unitarias para el ruteo de pedidos en orderCommercialService.
 * 
 * Verificaciones:
 * 1. Item nativo puro (source: VELION) -> Flujo nativo tradicional (externalProvider: null, currency: PEN).
 * 2. Item Shopify puro (source: SHOPIFY) -> Flujo Shopify Draft (externalProvider: 'SHOPIFY', currency: USD).
 * 3. Item MERGED -> Flujo Shopify Draft con snapshot sourceProvider: 'MERGED'.
 * 4. Carrito mixto (VELION + SHOPIFY) -> Falla cerrado con MIXED_PROVIDER_ORDER_NOT_SUPPORTED.
 * 5. externalOrderMode = NONE -> Falla cerrado con EXTERNAL_ORDER_DISABLED.
 * 6. externalOrderMode = SHOPIFY_COMPLETE -> Falla cerrado con SHOPIFY_COMPLETE_NOT_IMPLEMENTED.
 * 7. priceSource = VELION para Shopify -> Falla cerrado con SHOPIFY_PRICE_OVERRIDE_CURRENCY_UNRESOLVED.
 * 8. Integración desconectada -> Falla cerrado con SHOPIFY_INTEGRATION_NOT_CONNECTED.
 */

import assert from 'node:assert';
import { syncCommercialOrder } from './src/services/orderCommercialService.js';

console.log('======================================================================');
console.log('🧪 TEST SUITE 3: SHOPIFY ORDER ROUTING');
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

function createMockPrisma({ products = [], integrations = [], customers = [], externalProducts = [], externalVariants = [] } = {}) {
  const store = {
    products: new Map(products.map(p => [p.id, { ...p }])),
    integrations: new Map(integrations.map(i => [`${i.tenantId}:${i.provider}`, { ...i }])),
    customers: new Map(customers.map(c => [c.id, { ...c }])),
    externalProducts: new Map(externalProducts.map(ep => [ep.id, { ...ep }])),
    externalVariants: new Map(externalVariants.map(ev => [ev.id, { ...ev }])),
    orders: new Map(),
    alerts: []
  };

  const client = {
    product: {
      findFirst: async ({ where }) => {
        for (const p of store.products.values()) {
          if (where.id && p.id !== where.id) continue;
          if (where.user?.tenantId && p.tenantId !== where.user.tenantId) continue;
          return { ...p };
        }
        return null;
      },
      count: async () => 1
    },
    externalProductVariant: {
      findFirst: async ({ where }) => {
        for (const ev of store.externalVariants.values()) {
          if (where.tenantId && ev.tenantId !== where.tenantId) continue;
          if (where.normalizedSku && ev.normalizedSku !== where.normalizedSku) continue;
          return { ...ev, externalProduct: store.externalProducts.get(ev.externalProductId) };
        }
        return null;
      },
      findMany: async ({ where }) => {
        const res = [];
        for (const ev of store.externalVariants.values()) {
          if (where.tenantId && ev.tenantId !== where.tenantId) continue;
          if (where.normalizedSku && ev.normalizedSku !== where.normalizedSku) continue;
          res.push({ ...ev, externalProduct: store.externalProducts.get(ev.externalProductId) });
        }
        return res;
      },
      findUnique: async ({ where }) => store.externalVariants.get(where.id) || null
    },
    externalProduct: {
      findFirst: async ({ where }) => store.externalProducts.get(where.id) || null
    },
    integration: {
      findFirst: async ({ where }) => {
        const key = `${where.tenantId}:${where.provider || 'SHOPIFY'}`;
        return store.integrations.get(key) || null;
      }
    },
    customer: {
      update: async ({ where, data }) => {
        const c = store.customers.get(where.id);
        if (c) {
          Object.assign(c, data);
        }
        return c;
      }
    },
    order: {
      findFirst: async ({ where }) => {
        for (const o of store.orders.values()) {
          if (where.id && o.id !== where.id) continue;
          if (where.tenantId && o.tenantId !== where.tenantId) continue;
          return { ...o };
        }
        return null;
      },
      create: async ({ data }) => {
        const id = `order-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const created = { id, ...data, items: data.items?.create || [] };
        store.orders.set(id, created);
        return created;
      },
      update: async ({ where, data }) => {
        const o = store.orders.get(where.id);
        if (o) Object.assign(o, data);
        return o;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const [id, o] of store.orders.entries()) {
          if (where.id && o.id !== where.id) continue;
          Object.assign(o, data);
          count++;
        }
        return { count };
      }
    },
    alert: {
      create: async ({ data }) => {
        store.alerts.push(data);
        return data;
      }
    },
    $transaction: async (fn) => {
      if (Array.isArray(fn)) return fn;
      return await fn(client);
    },
    _store: store
  };

  return client;
}

async function main() {
  const tenantId = 'tenant-routing';
  const tenant = {
    id: tenantId,
    currencyCode: 'PEN',
    bankAccounts: 'BCP: 191-12345678-0-99',
    termsAndPolicies: 'Envíos a todo el país vía Olva Courier'
  };

  const customer = {
    id: 'cust-1',
    name: 'Juan Perez',
    phone: '51987654321',
    commercialState: {}
  };

  const defaultShopifyInteg = {
    id: 'integ-1',
    tenantId,
    provider: 'SHOPIFY',
    status: 'CONNECTED',
    shopDomain: 'velion-dev.myshopify.com',
    catalogMode: 'COMBINED',
    priceSource: 'SHOPIFY',
    stockSource: 'SHOPIFY',
    externalOrderMode: 'SHOPIFY_DRAFT',
    shopCurrencyCode: 'USD'
  };

  // 1. Pure Velion item
  await runTest('Item nativo puro genera orden nativa tradicional (externalProvider null, PEN)', async () => {
    const mockDb = createMockPrisma({
      products: [{ id: 'prod-native', tenantId, name: 'Polo Nativo', price: 50, promotionalPrice: null, type: 'PHYSICAL_PRODUCT' }],
      integrations: [defaultShopifyInteg],
      customers: [customer]
    });

    const res = await syncCommercialOrder({
      tenant,
      customer,
      clientNumber: customer.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: 'prod-native',
        productName: 'Polo Nativo',
        quantity: 2,
        shippingCity: 'Lima',
        paymentMethod: 'BCP'
      },
      prismaClient: mockDb
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.error, undefined);
    const createdOrder = Array.from(mockDb._store.orders.values())[0];
    assert.strictEqual(createdOrder.externalProvider, null);
    assert.strictEqual(createdOrder.currencyCode, 'PEN');
    assert.strictEqual(createdOrder.totalAmount, 100);
    assert.strictEqual(createdOrder.items[0].sourceProvider, 'VELION');
  });

  // 2. Pure Shopify item
  await runTest('Item Shopify puro genera orden externa SHOPIFY con externalSyncStatus NOT_STARTED', async () => {
    const extProdId = 'ext-prod-1';
    const extVarId = 'var-101';
    const mockDb = createMockPrisma({
      externalProducts: [{ id: extProdId, tenantId, title: 'The Minimal Snowboard', isAvailable: true }],
      externalVariants: [{ id: extVarId, tenantId, externalProductId: extProdId, externalVariantId: 'gid://shopify/ProductVariant/9991', price: 885.95, availableForSale: true, title: 'Default Title' }],
      integrations: [defaultShopifyInteg],
      customers: [customer]
    });

    const mockGraphql = async () => ({
      data: {
        draftOrderCreate: {
          draftOrder: {
            id: 'gid://shopify/DraftOrder/111',
            status: 'OPEN',
            invoiceUrl: 'https://checkout.shopify.com/111',
            totalPriceSet: { presentmentMoney: { amount: '885.95', currencyCode: 'USD' } }
          }
        }
      }
    });

    const res = await syncCommercialOrder({
      tenant,
      customer,
      clientNumber: customer.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: `shopify:${extVarId}`,
        quantity: 1,
        shippingCity: 'Lima',
        paymentMethod: 'BCP'
      },
      prismaClient: mockDb,
      graphqlExecutor: mockGraphql
    });

    assert.strictEqual(res.success, true);
    const createdOrder = Array.from(mockDb._store.orders.values())[0];
    assert.strictEqual(createdOrder.externalProvider, 'SHOPIFY');
    assert.strictEqual(createdOrder.currencyCode, 'USD');
    assert.strictEqual(createdOrder.items[0].sourceProvider, 'SHOPIFY');
    assert.strictEqual(createdOrder.items[0].externalVariantId, 'gid://shopify/ProductVariant/9991');
  });

  // 3. MERGED item
  await runTest('Item MERGED genera orden externa SHOPIFY con sourceProvider MERGED', async () => {
    const extProdId = 'ext-prod-merged';
    const extVarId = 'var-merged';
    const mockDb = createMockPrisma({
      products: [{ id: 'prod-merged', tenantId, name: 'Snowboard Fusion', normalizedSku: 'SKU-MERGE', price: 500, type: 'PHYSICAL_PRODUCT', isAvailable: true }],
      externalProducts: [{ id: extProdId, tenantId, title: 'Snowboard Fusion Shopify', isAvailable: true }],
      externalVariants: [{ id: extVarId, tenantId, externalProductId: extProdId, externalVariantId: 'gid://shopify/ProductVariant/9992', normalizedSku: 'SKU-MERGE', price: 550, availableForSale: true, title: 'Default' }],
      integrations: [defaultShopifyInteg],
      customers: [customer]
    });

    const mockGraphql = async () => ({
      data: {
        draftOrderCreate: {
          draftOrder: {
            id: 'gid://shopify/DraftOrder/222',
            status: 'OPEN',
            invoiceUrl: 'https://checkout.shopify.com/222',
            totalPriceSet: { presentmentMoney: { amount: '550.00', currencyCode: 'USD' } }
          }
        }
      }
    });

    const res = await syncCommercialOrder({
      tenant,
      customer,
      clientNumber: customer.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: 'prod-merged',
        quantity: 1,
        shippingCity: 'Lima',
        paymentMethod: 'BCP'
      },
      prismaClient: mockDb,
      graphqlExecutor: mockGraphql
    });

    assert.strictEqual(res.success, true);
    const createdOrder = Array.from(mockDb._store.orders.values())[0];
    assert.strictEqual(createdOrder.externalProvider, 'SHOPIFY');
    assert.strictEqual(createdOrder.currencyCode, 'USD');
    assert.strictEqual(createdOrder.items[0].sourceProvider, 'MERGED');
    assert.strictEqual(createdOrder.items[0].externalVariantId, 'gid://shopify/ProductVariant/9992');
  });

  // 4. Mixed Cart Guard
  await runTest('Carrito mixto (VELION + SHOPIFY) falla cerrado con MIXED_PROVIDER_ORDER_NOT_SUPPORTED', async () => {
    const extVarId = 'var-mix';
    const mockDb = createMockPrisma({
      products: [{ id: 'prod-nat', tenantId, name: 'Nativo', price: 10, type: 'PHYSICAL_PRODUCT' }],
      externalProducts: [{ id: 'ext-p', tenantId, title: 'Shopify' }],
      externalVariants: [{ id: extVarId, tenantId, externalProductId: 'ext-p', externalVariantId: 'gid://shopify/ProductVariant/3', price: 20 }],
      integrations: [defaultShopifyInteg],
      customers: [customer]
    });

    const res = await syncCommercialOrder({
      tenant,
      customer,
      clientNumber: customer.phone,
      currentCommercialState: {
        items: [
          { productId: 'prod-nat', quantity: 1 },
          { productId: `shopify:${extVarId}`, quantity: 1 }
        ]
      },
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        paymentMethod: 'BCP'
      },
      prismaClient: mockDb
    });

    assert.strictEqual(res.error, 'MIXED_PROVIDER_ORDER_NOT_SUPPORTED');
  });

  // 5. externalOrderMode = NONE
  await runTest('externalOrderMode = NONE falla cerrado con EXTERNAL_ORDER_DISABLED', async () => {
    const extVarId = 'var-none';
    const mockDb = createMockPrisma({
      externalProducts: [{ id: 'ep', tenantId, title: 'Test' }],
      externalVariants: [{ id: extVarId, tenantId, externalProductId: 'ep', externalVariantId: 'gid://shopify/ProductVariant/4', price: 20 }],
      integrations: [{ ...defaultShopifyInteg, externalOrderMode: 'NONE' }],
      customers: [customer]
    });

    const res = await syncCommercialOrder({
      tenant,
      customer,
      clientNumber: customer.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: `shopify:${extVarId}`,
        quantity: 1,
        shippingCity: 'Lima',
        paymentMethod: 'BCP'
      },
      prismaClient: mockDb
    });

    assert.strictEqual(res.error, 'EXTERNAL_ORDER_DISABLED');
  });

  // 6. externalOrderMode = SHOPIFY_COMPLETE
  await runTest('externalOrderMode = SHOPIFY_COMPLETE falla con SHOPIFY_COMPLETE_NOT_IMPLEMENTED', async () => {
    const extVarId = 'var-comp';
    const mockDb = createMockPrisma({
      externalProducts: [{ id: 'ep', tenantId, title: 'Test' }],
      externalVariants: [{ id: extVarId, tenantId, externalProductId: 'ep', externalVariantId: 'gid://shopify/ProductVariant/5', price: 20 }],
      integrations: [{ ...defaultShopifyInteg, externalOrderMode: 'SHOPIFY_COMPLETE' }],
      customers: [customer]
    });

    const res = await syncCommercialOrder({
      tenant,
      customer,
      clientNumber: customer.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: `shopify:${extVarId}`,
        quantity: 1,
        shippingCity: 'Lima',
        paymentMethod: 'BCP'
      },
      prismaClient: mockDb
    });

    assert.strictEqual(res.error, 'SHOPIFY_COMPLETE_NOT_IMPLEMENTED');
  });

  // 7. priceSource = VELION para Shopify
  await runTest('priceSource = VELION para Shopify falla con SHOPIFY_PRICE_OVERRIDE_CURRENCY_UNRESOLVED', async () => {
    const extVarId = 'var-price-velion';
    const mockDb = createMockPrisma({
      externalProducts: [{ id: 'ep', tenantId, title: 'Test' }],
      externalVariants: [{ id: extVarId, tenantId, externalProductId: 'ep', externalVariantId: 'gid://shopify/ProductVariant/6', price: 20 }],
      integrations: [{ ...defaultShopifyInteg, priceSource: 'VELION' }],
      customers: [customer]
    });

    const res = await syncCommercialOrder({
      tenant,
      customer,
      clientNumber: customer.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: `shopify:${extVarId}`,
        quantity: 1,
        shippingCity: 'Lima',
        paymentMethod: 'BCP'
      },
      prismaClient: mockDb
    });

    assert.strictEqual(res.error, 'SHOPIFY_PRICE_OVERRIDE_CURRENCY_UNRESOLVED');
  });

  // 8. Integración desconectada
  await runTest('Integración desconectada falla con SHOPIFY_INTEGRATION_NOT_CONNECTED', async () => {
    const extVarId = 'var-disc';
    const mockDb = createMockPrisma({
      externalProducts: [{ id: 'ep', tenantId, title: 'Test' }],
      externalVariants: [{ id: extVarId, tenantId, externalProductId: 'ep', externalVariantId: 'gid://shopify/ProductVariant/7', price: 20 }],
      integrations: [{ ...defaultShopifyInteg, status: 'DISCONNECTED' }],
      customers: [customer]
    });

    const res = await syncCommercialOrder({
      tenant,
      customer,
      clientNumber: customer.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: `shopify:${extVarId}`,
        quantity: 1,
        shippingCity: 'Lima',
        paymentMethod: 'BCP'
      },
      prismaClient: mockDb
    });

    assert.strictEqual(res.error, 'SHOPIFY_INTEGRATION_NOT_CONNECTED');
  });

  console.log(`\n======================================================================`);
  console.log(`🎉 SUITE 3 COMPLETADA: ${passedTests}/${totalTests} pruebas pasaron.`);
  console.log(`======================================================================\n`);
}

main().catch((err) => {
  console.error('Fallo fatal en Suite 3:', err);
  process.exit(1);
});
