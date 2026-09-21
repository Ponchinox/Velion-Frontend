/**
 * test_commerce_external_order_guard.js
 * =======================================
 * Suite de pruebas para verificar el guardián de frontera de pedidos
 * (External Order Boundary Guard) en syncCommercialOrder.
 *
 * Cobertura requerida (Punto 1):
 * 1. shopify:<uuid> bloqueado con EXTERNAL_ORDER_FLOW_NOT_IMPLEMENTED.
 * 2. MERGED con ID nativo bloqueado (no puede entrar al native order flow).
 * 3. MERGED con priceSource=VELION igualmente bloqueado.
 * 4. MERGED con priceSource=SHOPIFY igualmente bloqueado.
 * 5. Pedido Native no relacionado continúa funcionando normalmente.
 * 6. Product.id nativo que NO forma parte de merge continúa permitido.
 */

import assert from 'node:assert';
import { syncCommercialOrder } from './src/services/orderCommercialService.js';

console.log('======================================================================');
console.log('🧪 VELION EXTERNAL ORDER BOUNDARY GUARD SUITE (FASE 4C)');
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

function createOrderGuardMockDb({ priceSource = 'SHOPIFY' } = {}) {
  const createdOrders = [];
  const createdOrderItems = [];
  const createdAlerts = [];

  const tenant = {
    id: 'tenant-order-guard',
    bankAccounts: 'BCP: 191-12345678-0-01',
    termsAndPolicies: 'Envíos a todo Lima Metropolitana'
  };

  const customer = {
    id: 'cust-uuid-1',
    phone: '51999888777',
    name: 'Juan Pérez',
    commercialState: {}
  };

  const nativeProducts = [
    {
      id: 'nat-pure-native-99',
      name: 'Termo Inteligente Puro Nativo',
      description: 'Sin variante Shopify correspondiente',
      price: 65.00,
      promotionalPrice: null,
      type: 'PHYSICAL_PRODUCT',
      sku: 'SKU-PURE-NATIVE',
      normalizedSku: 'SKU-PURE-NATIVE',
      isAvailable: true,
      imageUrl: null,
      images: [],
      videoUrl: null,
      user: { tenantId: 'tenant-order-guard' }
    },
    {
      id: 'nat-prod-merged-1',
      name: 'Polo Velion Nativo (Merged)',
      description: 'Tiene match 1:1 con Shopify',
      price: 45.00,
      promotionalPrice: null,
      type: 'PHYSICAL_PRODUCT',
      sku: 'SKU-MERGED-1',
      normalizedSku: 'SKU-MERGED-1',
      isAvailable: true,
      imageUrl: null,
      images: [],
      videoUrl: null,
      user: { tenantId: 'tenant-order-guard' }
    }
  ];

  const externalProducts = [
    {
      id: 'ext-prod-1',
      tenantId: 'tenant-order-guard',
      provider: 'SHOPIFY',
      externalId: 'gid://shopify/Product/1',
      title: 'Polo Shopify Parent',
      isAvailable: true
    }
  ];

  const externalVariants = [
    {
      id: 'var-shopify-merged-1',
      tenantId: 'tenant-order-guard',
      externalProductId: 'ext-prod-1',
      provider: 'SHOPIFY',
      externalVariantId: 'gid://shopify/ProductVariant/101',
      title: 'Default Title',
      sku: 'SKU-MERGED-1',
      normalizedSku: 'SKU-MERGED-1',
      price: 50.00,
      inventoryQuantity: 20,
      availableForSale: true
    }
  ];

  let integration = {
    id: 'int-order-guard',
    tenantId: 'tenant-order-guard',
    provider: 'SHOPIFY',
    status: 'CONNECTED',
    catalogMode: 'COMBINED',
    priceSource: priceSource,
    stockSource: 'SHOPIFY'
  };

  const db = {
    setPriceSource(ps) {
      integration.priceSource = ps;
    },
    tenant: {
      async findUnique() { return tenant; }
    },
    customer: {
      async update({ data }) {
        customer.commercialState = data.commercialState;
        return customer;
      }
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
        const found = externalVariants.find(v => {
          if (where.id && v.id !== where.id) return false;
          if (where.tenantId && v.tenantId !== where.tenantId) return false;
          return true;
        });
        if (!found) return null;
        const res = { ...found };
        if (include?.externalProduct) {
          res.externalProduct = externalProducts.find(p => p.id === found.externalProductId) || null;
        }
        return res;
      },
      async findMany({ where, include }) {
        let list = externalVariants.filter(v => {
          if (where.tenantId && v.tenantId !== where.tenantId) return false;
          if (where.normalizedSku && v.normalizedSku !== where.normalizedSku) return false;
          return true;
        });
        if (include?.externalProduct) {
          list = list.map(v => ({
            ...v,
            externalProduct: externalProducts.find(p => p.id === v.externalProductId) || null
          }));
        }
        return list;
      }
    },
    order: {
      async create({ data }) {
        const orderId = `ord-${Date.now()}-${Math.random()}`;
        const ord = { id: orderId, ...data };
        createdOrders.push(ord);
        if (data.items?.create) {
          createdOrderItems.push(...data.items.create.map(i => ({ orderId, ...i })));
        }
        return ord;
      }
    },
    alert: {
      async create({ data }) {
        createdAlerts.push(data);
        return { id: 'alert-1', ...data };
      }
    },
    $transaction: async (cb) => cb(db)
  };

  return {
    db,
    tenant,
    customer,
    createdOrders,
    createdOrderItems,
    createdAlerts
  };
}

// ── EJECUCIÓN DE TESTS ────────────────────────────────────────────────────────

await runTest('TEST 1: Ítem con prefijo shopify:<id> en PAYMENT_PENDING rechaza con EXTERNAL_ORDER_FLOW_NOT_IMPLEMENTED', async () => {
  const { db, tenant, customer, createdOrders } = createOrderGuardMockDb();

  const result = await syncCommercialOrder({
    tenant,
    customer,
    clientNumber: '51999888777',
    currentCommercialState: {},
    args: {
      currentStage: 'PAYMENT_PENDING',
      productId: 'shopify:var-shopify-merged-1',
      productName: 'Polo Shopify',
      quantity: 1,
      paymentMethod: 'BCP',
      shippingCity: 'Lima',
      customerConfirmed: true
    },
    prismaClient: db
  });

  assert.strictEqual(result.error, 'EXTERNAL_ORDER_FLOW_NOT_IMPLEMENTED');
  assert.strictEqual(createdOrders.length, 0, 'No debe haberse creado ninguna orden');
});

await runTest('TEST 2: Ítem MERGED con ID nativo (nat-prod-merged-1) bloqueado con EXTERNAL_ORDER_FLOW_NOT_IMPLEMENTED', async () => {
  const { db, tenant, customer, createdOrders, createdOrderItems } = createOrderGuardMockDb({ priceSource: 'SHOPIFY' });

  const result = await syncCommercialOrder({
    tenant,
    customer,
    clientNumber: '51999888777',
    currentCommercialState: {},
    args: {
      currentStage: 'PAYMENT_PENDING',
      productId: 'nat-prod-merged-1', // ID nativo que está emparejado 1:1 con Shopify
      productName: 'Polo Velion Nativo (Merged)',
      quantity: 1,
      paymentMethod: 'BCP',
      shippingCity: 'Lima',
      customerConfirmed: true
    },
    prismaClient: db
  });

  assert.strictEqual(result.error, 'EXTERNAL_ORDER_FLOW_NOT_IMPLEMENTED');
  assert.ok(result.message.includes('Shopify o combinados aún no está habilitado'));
  assert.strictEqual(createdOrders.length, 0, 'No debe haberse creado ninguna orden para item MERGED');
  assert.strictEqual(createdOrderItems.length, 0, 'No debe haberse creado ningún OrderItem');
});

await runTest('TEST 3: Ítem MERGED con priceSource=VELION igualmente bloqueado fail-closed', async () => {
  const { db, tenant, customer, createdOrders } = createOrderGuardMockDb({ priceSource: 'VELION' });

  const result = await syncCommercialOrder({
    tenant,
    customer,
    clientNumber: '51999888777',
    currentCommercialState: {},
    args: {
      currentStage: 'PAYMENT_PENDING',
      productId: 'nat-prod-merged-1', // Sigue siendo MERGED aunque use precio de Velion
      productName: 'Polo Velion Nativo (Merged)',
      quantity: 2,
      paymentMethod: 'BCP',
      shippingCity: 'Lima',
      customerConfirmed: true
    },
    prismaClient: db
  });

  assert.strictEqual(result.error, 'EXTERNAL_ORDER_FLOW_NOT_IMPLEMENTED');
  assert.strictEqual(createdOrders.length, 0);
});

await runTest('TEST 4: Ítem MERGED con priceSource=SHOPIFY igualmente bloqueado fail-closed', async () => {
  const { db, tenant, customer, createdOrders } = createOrderGuardMockDb({ priceSource: 'SHOPIFY' });

  const result = await syncCommercialOrder({
    tenant,
    customer,
    clientNumber: '51999888777',
    currentCommercialState: {},
    args: {
      currentStage: 'PAYMENT_PENDING',
      productId: 'nat-prod-merged-1',
      productName: 'Polo Velion Nativo (Merged)',
      quantity: 1,
      paymentMethod: 'BCP',
      shippingCity: 'Lima',
      customerConfirmed: true
    },
    prismaClient: db
  });

  assert.strictEqual(result.error, 'EXTERNAL_ORDER_FLOW_NOT_IMPLEMENTED');
  assert.strictEqual(createdOrders.length, 0);
});

await runTest('TEST 5: Producto Nativo puro no relacionado (nat-pure-native-99) crea orden exitosamente', async () => {
  const { db, tenant, customer, createdOrders, createdOrderItems } = createOrderGuardMockDb();

  const result = await syncCommercialOrder({
    tenant,
    customer,
    clientNumber: '51999888777',
    currentCommercialState: {
      currentStage: 'PRODUCT_SELECTED',
      productId: 'nat-pure-native-99',
      productName: 'Termo Inteligente Puro Nativo',
      quantity: 2,
      customerConfirmed: true
    },
    args: {
      currentStage: 'PAYMENT_PENDING',
      paymentMethod: 'BCP',
      shippingCity: 'Lima'
    },
    prismaClient: db
  });

  assert.strictEqual(result.error, undefined, 'No debe haber error para producto nativo puro');
  assert.strictEqual(createdOrders.length, 1, 'Debe haber creado exactamente 1 orden');
  assert.strictEqual(createdOrderItems.length, 1, 'Debe haber creado exactamente 1 OrderItem');
  assert.strictEqual(createdOrderItems[0].productId, 'nat-pure-native-99');
  assert.strictEqual(createdOrderItems[0].price, 65.00);
});

await runTest('TEST 6: Product.id nativo que NO forma parte de merge continúa 100% permitido', async () => {
  const { db, tenant, customer, createdOrders, createdOrderItems } = createOrderGuardMockDb();

  const result = await syncCommercialOrder({
    tenant,
    customer,
    clientNumber: '51999888777',
    currentCommercialState: {},
    args: {
      currentStage: 'PAYMENT_VERIFIED',
      productId: 'nat-pure-native-99',
      productName: 'Termo Inteligente Puro Nativo',
      quantity: 1,
      paymentMethod: 'BCP',
      shippingCity: 'Lima',
      customerConfirmed: true
    },
    prismaClient: db
  });

  assert.strictEqual(result.error, undefined);
  assert.strictEqual(createdOrders.length, 1);
  assert.strictEqual(createdOrderItems.length, 1);
  assert.strictEqual(createdOrderItems[0].productId, 'nat-pure-native-99');
});

console.log('\n======================================================================');
console.log(`🎉 SUITE EXTERNAL ORDER GUARD: ${passedTests}/${totalTests} TESTS PASARON`);
console.log('======================================================================\n');
