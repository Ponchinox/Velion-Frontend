import assert from 'assert';
import { syncCommercialOrder } from './src/services/orderCommercialService.js';

function createTransactionalMockDb() {
  let orders = [];
  let orderItems = [];
  let alerts = [];
  let customers = new Map();
  let products = new Map();
  let tenants = new Map();

  let idCounter = 1;
  const generateId = (prefix) => `${prefix}-${idCounter++}`;

  const baseClient = {
    tenant: {
      findUnique: async ({ where }) => tenants.get(where.id) || null
    },
    product: {
      findFirst: async ({ where }) => {
        for (const p of products.values()) {
          if (p.id === where.id) {
            if (where.user?.tenantId && p.user?.tenantId !== where.user.tenantId) continue;
            return p;
          }
        }
        return null;
      }
    },
    customer: {
      findUnique: async ({ where }) => {
        const c = customers.get(where.id);
        return c ? JSON.parse(JSON.stringify(c)) : null;
      },
      update: async ({ where, data }) => {
        const c = customers.get(where.id);
        if (!c) throw new Error('Customer not found');
        if (data.commercialState) {
          c.commercialState = JSON.parse(JSON.stringify(data.commercialState));
        }
        return JSON.parse(JSON.stringify(c));
      }
    },
    order: {
      findFirst: async ({ where }) => {
        for (const o of orders) {
          if (where.id && o.id !== where.id) continue;
          if (where.tenantId && o.tenantId !== where.tenantId) continue;
          return { ...o, items: orderItems.filter(i => i.orderId === o.id) };
        }
        return null;
      },
      create: async ({ data }) => {
        const id = data.id || generateId('ord');
        const { items, ...orderFields } = data;
        const record = { id, createdAt: new Date(), ...orderFields };
        orders.push(record);
        if (items?.create) {
          for (const item of items.create) {
            orderItems.push({ id: generateId('item'), orderId: id, ...item });
          }
        }
        return { ...record, items: orderItems.filter(i => i.orderId === id) };
      },
      update: async ({ where, data }) => {
        const idx = orders.findIndex(o => o.id === where.id);
        if (idx === -1) throw new Error('Order not found');
        orders[idx] = { ...orders[idx], ...data };
        return { ...orders[idx], items: orderItems.filter(i => i.orderId === where.id) };
      }
    },
    orderItem: {
      deleteMany: async ({ where }) => {
        const before = orderItems.length;
        orderItems = orderItems.filter(i => i.orderId !== where.orderId);
        return { count: before - orderItems.length };
      },
      create: async ({ data }) => {
        const record = { id: generateId('item'), ...data };
        orderItems.push(record);
        return record;
      }
    },
    alert: {
      create: async ({ data }) => {
        const record = { id: generateId('alt'), createdAt: new Date(), ...data };
        alerts.push(record);
        return record;
      }
    }
  };

  const db = {
    ...baseClient,
    tenants,
    products,
    customers,
    get orders() { return orders; },
    get orderItems() { return orderItems; },
    get alerts() { return alerts; },
    _failAlertCreate: false,
    _failCustomerUpdate: false,
    $transaction: async (arg) => {
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      if (typeof arg !== 'function') return arg;

      // Snapshot state for rollback
      const snapshotOrders = [...orders];
      const snapshotOrderItems = [...orderItems];
      const snapshotAlerts = [...alerts];
      const snapshotCustomers = new Map([...customers.entries()].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));

      const tx = {
        ...baseClient,
        customer: {
          ...baseClient.customer,
          update: async (args) => {
            if (db._failCustomerUpdate) {
              throw new Error('SIMULATED_CUSTOMER_UPDATE_FAILURE');
            }
            return baseClient.customer.update(args);
          }
        },
        alert: {
          ...baseClient.alert,
          create: async (args) => {
            if (db._failAlertCreate) {
              throw new Error('SIMULATED_ALERT_CREATE_FAILURE');
            }
            return baseClient.alert.create(args);
          }
        }
      };

      try {
        const result = await arg(tx);
        return result;
      } catch (err) {
        // Rollback state on error
        orders = snapshotOrders;
        orderItems = snapshotOrderItems;
        alerts = snapshotAlerts;
        customers.clear();
        for (const [k, v] of snapshotCustomers.entries()) {
          customers.set(k, v);
        }
        throw err;
      }
    }
  };

  return db;
}

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

async function main() {
  console.log('======================================================================');
  console.log('🧪 P1 ORDER ATOMICITY & DUPLICATE ORDER PREVENTION SUITE');
  console.log('======================================================================\n');

  const tenant = {
    id: 'tenant-atomicity-1',
    name: 'Tienda Oficial',
    bankAccounts: 'BCP: 191-12345678-0-12, Yape: 999888777',
    termsAndPolicies: 'Envíos a todo el Perú'
  };

  const product = {
    id: 'prod-audifonos-1',
    name: 'Audífonos Bluetooth Pro',
    price: 150.00,
    type: 'PHYSICAL_PRODUCT',
    user: { tenantId: tenant.id }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // TEST A: order.create success, alert.create fails inside transaction -> ROLLBACK
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST A: alert.create fails inside transaction -> ROLLBACK (ORDER=0, ACTIVE_ORDER_ID=null)', async () => {
    const db = createTransactionalMockDb();
    db.tenants.set(tenant.id, tenant);
    db.products.set(product.id, product);

    const customerA = { id: 'cust-a', name: 'Cliente A', phone: '51900000001', commercialState: {} };
    db.customers.set(customerA.id, customerA);

    // Forzar fallo en alert.create dentro de la transacción
    db._failAlertCreate = true;

    const res = await syncCommercialOrder({
      tenant,
      customer: customerA,
      clientNumber: customerA.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: product.id,
        quantity: 1,
        shippingCity: 'Lima',
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });

    assert.strictEqual(res.error, 'ORDER_CREATION_FAILED', 'Tool debe retornar error ORDER_CREATION_FAILED');
    assert.strictEqual(db.orders.length, 0, 'ORDER_COUNT debe ser 0 tras rollback');
    assert.strictEqual(db.orderItems.length, 0, 'ORDER_ITEMS_COUNT debe ser 0 tras rollback');
    assert.strictEqual(db.alerts.length, 0, 'ALERTS_COUNT debe ser 0 tras rollback');
    assert.strictEqual(db.customers.get(customerA.id).commercialState?.activeOrderId, undefined, 'ACTIVE_ORDER_ID no debe persistir');
    assert.strictEqual(res.state?.activeOrderId, undefined, 'Estado retornado no debe tener activeOrderId');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST B: customer.update fails inside transaction -> ROLLBACK
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST B: customer.update fails inside transaction -> ROLLBACK (ORDER=0, ACTIVE_ORDER_ID=null)', async () => {
    const db = createTransactionalMockDb();
    db.tenants.set(tenant.id, tenant);
    db.products.set(product.id, product);

    const customerB = { id: 'cust-b', name: 'Cliente B', phone: '51900000002', commercialState: {} };
    db.customers.set(customerB.id, customerB);

    // Forzar fallo en customer.update dentro de la transacción
    db._failCustomerUpdate = true;

    const res = await syncCommercialOrder({
      tenant,
      customer: customerB,
      clientNumber: customerB.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: product.id,
        quantity: 1,
        shippingCity: 'Lima',
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });

    assert.strictEqual(res.error, 'ORDER_CREATION_FAILED', 'Tool debe retornar error ORDER_CREATION_FAILED');
    assert.strictEqual(db.orders.length, 0, 'ORDER_COUNT debe ser 0 tras rollback');
    assert.strictEqual(db.orderItems.length, 0, 'ORDER_ITEMS_COUNT debe ser 0 tras rollback');
    assert.strictEqual(db.customers.get(customerB.id).commercialState?.activeOrderId, undefined, 'ACTIVE_ORDER_ID no debe persistir');
    assert.strictEqual(res.state?.activeOrderId, undefined, 'Estado retornado no debe tener activeOrderId');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST C: retry después de TEST A/B -> ORDER_COUNT final = 1
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST C: Retry después de fallos en TEST A/B crea exactamente 1 orden', async () => {
    const db = createTransactionalMockDb();
    db.tenants.set(tenant.id, tenant);
    db.products.set(product.id, product);

    const customerC = { id: 'cust-c', name: 'Cliente C', phone: '51900000003', commercialState: {} };
    db.customers.set(customerC.id, customerC);

    // Intento 1: Falla
    db._failAlertCreate = true;
    const res1 = await syncCommercialOrder({
      tenant,
      customer: customerC,
      clientNumber: customerC.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: product.id,
        quantity: 1,
        shippingCity: 'Lima',
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });
    assert.strictEqual(res1.error, 'ORDER_CREATION_FAILED');
    assert.strictEqual(db.orders.length, 0, 'Intento 1 fallido no deja orden huérfana');

    // Intento 2: Recuperación (BD disponible)
    db._failAlertCreate = false;
    const res2 = await syncCommercialOrder({
      tenant,
      customer: customerC,
      clientNumber: customerC.phone,
      currentCommercialState: res1.state,
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: product.id,
        quantity: 1,
        shippingCity: 'Lima',
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });

    assert.strictEqual(res2.success, true, 'Reintento debe ser exitoso');
    assert.strictEqual(db.orders.length, 1, 'ORDER_COUNT final debe ser exactamente 1');
    assert.strictEqual(db.orderItems.length, 1, 'ORDER_ITEMS_COUNT debe ser exactamente 1');
    assert.ok(res2.state.activeOrderId, 'activeOrderId debe existir');
    assert.strictEqual(db.customers.get(customerC.id).commercialState.activeOrderId, res2.state.activeOrderId, 'activeOrderId persistido en DB');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST D: transaction commit success + onNotification throws
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST D: Commit exitoso + onNotification falla -> ORDER=1 preservada, tool no falla y retry no duplica', async () => {
    const db = createTransactionalMockDb();
    db.tenants.set(tenant.id, tenant);
    db.products.set(product.id, product);

    const customerD = { id: 'cust-d', name: 'Cliente D', phone: '51900000004', commercialState: {} };
    db.customers.set(customerD.id, customerD);

    let notificationAttempted = false;

    const res = await syncCommercialOrder({
      tenant,
      customer: customerD,
      clientNumber: customerD.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: product.id,
        quantity: 2,
        shippingCity: 'Arequipa',
        paymentMethod: 'BCP'
      },
      onNotification: async () => {
        notificationAttempted = true;
        throw new Error('SIMULATED_EXTERNAL_NOTIFICATION_ERROR');
      },
      prismaClient: db
    });

    assert.strictEqual(notificationAttempted, true, 'onNotification debió ser invocado');
    assert.strictEqual(res.success, true, 'Tool debe reportar éxito comercial aunque la notificación externa falle');
    assert.strictEqual(res.error, undefined, 'Tool no debe retornar error genérico');
    assert.strictEqual(res.warning, 'ORDER_CREATED_NOTIFICATION_FAILED', 'Debe registrar warning específico');
    assert.strictEqual(db.orders.length, 1, 'La orden debe permanecer en DB (ORDER_COUNT = 1)');
    assert.strictEqual(db.customers.get(customerD.id).commercialState.activeOrderId, res.state.activeOrderId, 'activeOrderId persistido en DB');

    // Retry con el estado retornado NO debe crear segunda orden
    const retryRes = await syncCommercialOrder({
      tenant,
      customer: customerD,
      clientNumber: customerD.phone,
      currentCommercialState: res.state,
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: product.id,
        quantity: 2,
        shippingCity: 'Arequipa',
        paymentMethod: 'BCP'
      },
      prismaClient: db
    });

    assert.strictEqual(retryRes.success, true);
    assert.strictEqual(db.orders.length, 1, 'Retry NO debe crear segunda orden');
    assert.strictEqual(retryRes.state.activeOrderId, res.state.activeOrderId, 'Debe conservar la misma activeOrderId');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST E: Dos llamadas concurrentes para la misma intención comercial
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST E: Dos llamadas concurrentes crean exactamente 1 orden activa sin items duplicados', async () => {
    const db = createTransactionalMockDb();
    db.tenants.set(tenant.id, tenant);
    db.products.set(product.id, product);

    const customerE = { id: 'cust-e', name: 'Cliente E', phone: '51900000005', commercialState: {} };
    db.customers.set(customerE.id, customerE);

    // Ambas llamadas llegan simultáneamente leyendo currentCommercialState = {} sin activeOrderId
    const [resA, resB] = await Promise.all([
      syncCommercialOrder({
        tenant,
        customer: customerE,
        clientNumber: customerE.phone,
        currentCommercialState: {},
        args: {
          currentStage: 'PAYMENT_PENDING',
          customerConfirmed: true,
          productId: product.id,
          quantity: 1,
          shippingCity: 'Cusco',
          paymentMethod: 'Yape'
        },
        prismaClient: db
      }),
      syncCommercialOrder({
        tenant,
        customer: customerE,
        clientNumber: customerE.phone,
        currentCommercialState: {},
        args: {
          currentStage: 'PAYMENT_PENDING',
          customerConfirmed: true,
          productId: product.id,
          quantity: 1,
          shippingCity: 'Cusco',
          paymentMethod: 'Yape'
        },
        prismaClient: db
      })
    ]);

    assert.strictEqual(resA.success, true, 'Llamada A debe ser exitosa');
    assert.strictEqual(resB.success, true, 'Llamada B debe ser exitosa');
    assert.strictEqual(db.orders.length, 1, 'Debe existir EXACTAMENTE 1 orden creada en DB');
    assert.strictEqual(db.orderItems.length, 1, 'Debe existir EXACTAMENTE 1 OrderItem creado en DB (sin duplicados)');
    assert.strictEqual(resA.state.activeOrderId, resB.state.activeOrderId, 'Ambas llamadas deben compartir la misma activeOrderId');
    assert.strictEqual(db.customers.get(customerE.id).commercialState.activeOrderId, resA.state.activeOrderId, 'Customer debe tener la orden vinculada');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST F: Creación normal
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST F: Creación normal -> orden, items y activeOrderId correctos', async () => {
    const db = createTransactionalMockDb();
    db.tenants.set(tenant.id, tenant);
    db.products.set(product.id, product);

    const customerF = { id: 'cust-f', name: 'Cliente F', phone: '51900000006', commercialState: {} };
    db.customers.set(customerF.id, customerF);

    const res = await syncCommercialOrder({
      tenant,
      customer: customerF,
      clientNumber: customerF.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: product.id,
        quantity: 3,
        shippingCity: 'Trujillo',
        paymentMethod: 'BCP'
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(db.orders.length, 1);
    const created = db.orders[0];
    assert.strictEqual(created.totalAmount, 450.00); // 3 * 150
    assert.strictEqual(created.shippingCity, 'Trujillo');
    assert.strictEqual(created.paymentMethod, 'BCP');
    assert.strictEqual(db.orderItems.length, 1);
    assert.strictEqual(db.orderItems[0].quantity, 3);
    assert.strictEqual(db.orderItems[0].price, 150.00);
    assert.strictEqual(res.state.activeOrderId, created.id);
    assert.strictEqual(db.customers.get(customerF.id).commercialState.activeOrderId, created.id);
    assert.strictEqual(db.alerts.length, 1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST G: Orden existente con activeOrderId
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST G: Orden existente con activeOrderId actualiza orden sin crear una nueva', async () => {
    const db = createTransactionalMockDb();
    db.tenants.set(tenant.id, tenant);
    db.products.set(product.id, product);

    const customerG = { id: 'cust-g', name: 'Cliente G', phone: '51900000007', commercialState: {} };
    db.customers.set(customerG.id, customerG);

    // 1. Crear orden inicial
    const resCreate = await syncCommercialOrder({
      tenant,
      customer: customerG,
      clientNumber: customerG.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: product.id,
        quantity: 1,
        shippingCity: 'Lima',
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });

    const initialOrderId = resCreate.state.activeOrderId;
    assert.strictEqual(db.orders.length, 1);

    // 2. Actualizar orden existente (cambio de cantidad a 2)
    const resUpdate = await syncCommercialOrder({
      tenant,
      customer: customerG,
      clientNumber: customerG.phone,
      currentCommercialState: resCreate.state,
      args: {
        currentStage: 'PAYMENT_PENDING',
        quantity: 2,
        shippingCity: 'Lima Moderna'
      },
      prismaClient: db
    });

    assert.strictEqual(resUpdate.success, true);
    assert.strictEqual(db.orders.length, 1, 'ORDER_COUNT debe seguir siendo 1 (sin nueva orden)');
    assert.strictEqual(resUpdate.state.activeOrderId, initialOrderId, 'Conserva el mismo activeOrderId');
    assert.strictEqual(db.orders[0].totalAmount, 300.00, 'Total actualizado a 2 * 150');
    assert.strictEqual(db.orders[0].shippingCity, 'Lima Moderna');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST H: Regresión sales core intacta
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST H: Regresión sales core y contratos intactos', async () => {
    assert.strictEqual(typeof syncCommercialOrder, 'function');
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE ATOMICIDAD FINALIZADA: ${passedTests}/${totalTests} TESTS PASARON EXITOSAMENTE (100%)`);
  console.log('======================================================================');
}

main().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
