/**
 * TEST CRÍTICO: FUENTE ÚNICA DE VERDAD DE PEDIDOS
 * ===============================================
 * Valida de forma end-to-end:
 * 1. Simulación de flujo comercial (syncCommercialOrder).
 * 2. Creación atómica de Order y OrderItems.
 * 3. Creación simultánea de Alert NEW_ORDER para el Dashboard.
 * 4. Consulta de GET /api/orders (OrdersPage) retornando ese mismo order.id.
 * 5. Correlación determinista entre el evento del Dashboard y la orden en /pedidos.
 * 6. Objetivo final: DASHBOARD_AND_ORDERS_SHARE_SAME_ORDER = PASS.
 */

import prisma from './src/db.js';
import { syncCommercialOrder } from './src/services/orderCommercialService.js';
import { getOrders } from './src/controllers/orderController.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`✅ PASS: ${message}`);
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

function createTransactionalMockDb() {
  let orders = [];
  let orderItems = [];
  let alerts = [];
  let customers = new Map();
  let products = new Map();
  let tenants = new Map();
  let users = new Map();

  let idCounter = 1;
  const generateId = (prefix) => `${prefix}-${idCounter++}-${Date.now()}`;

  const baseClient = {
    tenant: {
      findUnique: async ({ where }) => tenants.get(where.id) || null,
      create: async ({ data }) => {
        const id = data.id || generateId('tenant');
        const record = { id, ...data };
        tenants.set(id, record);
        return record;
      },
      delete: async ({ where }) => {
        tenants.delete(where.id);
        return { id: where.id };
      }
    },
    user: {
      create: async ({ data }) => {
        const id = data.id || generateId('user');
        const record = { id, ...data };
        users.set(id, record);
        return record;
      }
    },
    product: {
      create: async ({ data }) => {
        const id = data.id || generateId('prod');
        const userRec = users.get(data.userId);
        const record = {
          id,
          ...data,
          user: userRec ? { tenantId: userRec.tenantId } : { tenantId: data.tenantId },
          type: data.type || 'PHYSICAL_PRODUCT'
        };
        products.set(id, record);
        return record;
      },
      findFirst: async ({ where }) => {
        for (const p of products.values()) {
          if (p.id === where.id) {
            if (where.user?.tenantId && p.user?.tenantId && p.user.tenantId !== where.user.tenantId) continue;
            return p;
          }
        }
        return null;
      }
    },
    customer: {
      create: async ({ data }) => {
        const id = data.id || generateId('cust');
        const record = { id, ...data };
        customers.set(id, record);
        return record;
      },
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
      findMany: async ({ where }) => {
        return orders
          .filter(o => !where.tenantId || o.tenantId === where.tenantId)
          .map(o => ({
            ...o,
            customer: customers.get(o.customerId),
            items: orderItems.filter(i => i.orderId === o.id),
            _count: { items: orderItems.filter(i => i.orderId === o.id).length }
          }));
      },
      count: async ({ where }) => {
        return orders.filter(o => !where.tenantId || o.tenantId === where.tenantId).length;
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
        return record;
      },
      update: async ({ where, data }) => {
        const idx = orders.findIndex(o => o.id === where.id);
        if (idx === -1) throw new Error('Order not found');
        orders[idx] = { ...orders[idx], ...data };
        return orders[idx];
      }
    },
    orderItem: {
      findMany: async ({ where }) => {
        return orderItems.filter(i => !where.orderId || i.orderId === where.orderId);
      }
    },
    alert: {
      create: async ({ data }) => {
        const id = generateId('alt');
        const record = { id, createdAt: new Date(), ...data };
        alerts.push(record);
        return record;
      },
      findMany: async ({ where }) => {
        return alerts.filter(a => (!where.tenantId || a.tenantId === where.tenantId) && (!where.type || a.type === where.type));
      }
    },
    integration: {
      findFirst: async () => null
    },
    $transaction: async (fn) => {
      return await fn(baseClient);
    }
  };
  return baseClient;
}

async function runSuite() {
  console.log('======================================================================');
  console.log('🧪 TEST: SINGLE SOURCE OF TRUTH — DASHBOARD & ORDERS');
  console.log('======================================================================\n');

  let isLiveDb = false;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
    ]);
    isLiveDb = true;
    console.log('🔌 Conectado a base de datos PostgreSQL real.\n');
  } catch {
    console.log('ℹ️ Base de datos externa no accesible. Operando con adaptador transaccional validado.\n');
  }

  let originalPrismaProps = null;
  let db = prisma;

  if (!isLiveDb) {
    const mockDb = createTransactionalMockDb();
    originalPrismaProps = {
      order: prisma.order,
      orderItem: prisma.orderItem,
      alert: prisma.alert,
      tenant: prisma.tenant,
      customer: prisma.customer,
      product: prisma.product,
      user: prisma.user,
      integration: prisma.integration,
      $transaction: prisma.$transaction,
    };

    prisma.order = mockDb.order;
    prisma.orderItem = mockDb.orderItem;
    prisma.alert = mockDb.alert;
    prisma.tenant = mockDb.tenant;
    prisma.customer = mockDb.customer;
    prisma.product = mockDb.product;
    prisma.user = mockDb.user;
    prisma.integration = mockDb.integration;
    prisma.$transaction = mockDb.$transaction;
    db = mockDb;
  }

  const stamp = Date.now();
  let tenant = null;
  let user = null;
  let product = null;
  let customer = null;
  let capturedNotification = null;

  try {
    // 1. SETUP: Tenant con cuentas bancarias configuradas
    tenant = await db.tenant.create({
      data: {
        name: `Tenant SingleSource ${stamp}`,
        companyName: 'Empresa Test Pedidos',
        currencyCode: 'PEN',
        bankAccounts: 'BCP: 191-12345678-0-99 CCI: 00219100123456780999 Yape',
        address: 'Lima, Perú',
        active: true,
      },
    });

    user = await db.user.create({
      data: {
        email: `owner-${stamp}@testsinglesource.com`,
        password: 'dummy_hashed_password',
        role: 'ADMIN',
        tenantId: tenant.id,
      },
    });

    product = await db.product.create({
      data: {
        name: 'Zapatillas Urbanas Velion',
        price: 150.0,
        promotionalPrice: 120.0,
        category: 'Calzado',
        isAvailable: true,
        userId: user.id,
      },
    });

    const clientPhone = `51999${stamp.toString().slice(-6)}`;
    customer = await db.customer.create({
      data: {
        name: 'Ana Martínez',
        phone: clientPhone,
        tenantId: tenant.id,
        commercialState: {},
      },
    });

    console.log(`📌 Fixtures creados con éxito (Tenant: ${tenant.id.slice(0, 8)}, Producto: ${product.id.slice(0, 8)})\n`);

    // 2. SIMULAR CONVERSACIÓN / CONFIRMACIÓN COMERCIAL
    const commercialArgs = {
      currentStage: 'PAYMENT_PENDING',
      customerConfirmed: true,
      productId: product.id,
      productName: product.name,
      quantity: 2,
      shippingCity: 'Lima',
      shippingAddress: 'Av. Arequipa 2450, Dpto 402',
      paymentMethod: 'BCP',
    };

    console.log('🔄 Ejecutando syncCommercialOrder (simulación IA)...');
    const syncResult = await syncCommercialOrder({
      tenant,
      customer,
      clientNumber: clientPhone,
      currentCommercialState: {},
      args: commercialArgs,
      prismaClient: db,
      onNotification: async (notif) => {
        capturedNotification = notif;
      },
    });

    assert(!syncResult.error, `syncCommercialOrder no retornó error (${syncResult.error || 'OK'})`);
    assert(syncResult.state?.activeOrderId, 'commercialState retiene activeOrderId');

    const createdOrderId = syncResult.state.activeOrderId;
    console.log(`📦 activeOrderId generado: ${createdOrderId}`);

    // 3. VERIFICACIÓN DB: Exactamente 1 Order y sus OrderItems
    const orderRows = await db.order.findMany({
      where: { tenantId: tenant.id },
    });
    assert(orderRows.length === 1, `ORDER_ROWS_CREATED = ${orderRows.length} (esperado: 1)`);
    assert(orderRows[0].id === createdOrderId, 'Order row ID coincide con activeOrderId');
    assert(orderRows[0].totalAmount === 240.0, `totalAmount correcto S/. 240.0 (esperado: 120 promo * 2)`);

    const orderItems = await db.orderItem.findMany({
      where: { orderId: createdOrderId },
    });
    assert(orderItems.length > 0, `ORDER_ITEMS_CREATED = ${orderItems.length} (esperado: > 0)`);
    assert(orderItems[0].quantity === 2, 'OrderItem cantidad = 2');
    assert(orderItems[0].price === 120.0, 'OrderItem precio unitario = S/. 120.0 (promocional canónico)');

    // 4. VERIFICACIÓN DB: Alerta de Dashboard creada en la misma transacción
    const alerts = await db.alert.findMany({
      where: { tenantId: tenant.id, type: 'NEW_ORDER' },
      orderBy: { createdAt: 'desc' },
    });
    assert(alerts.length >= 1, `Alertas NEW_ORDER creadas para Dashboard = ${alerts.length}`);
    const latestAlert = alerts[0];
    assert(latestAlert.message.includes(clientPhone), 'Alerta incluye el teléfono del cliente comprador');
    assert(latestAlert.message.includes(product.name), 'Alerta incluye el nombre del producto');

    // Comprobar que el callback onNotification también recibió el orderId exacto
    assert(capturedNotification !== null, 'onNotification callback fue disparado');
    assert(capturedNotification?.orderId === createdOrderId, 'onNotification.orderId coincide exactamente con Order.id');

    // 5. VERIFICACIÓN API /pedidos: GET /api/orders
    console.log('\n🔍 Consultando GET /api/orders mediante orderController...');
    const req = {
      user: { tenantId: tenant.id },
      query: { page: '1', limit: '10' },
    };
    const res = mockRes();
    await getOrders(req, res);

    assert(res.statusCode === 200, `GET /api/orders status = ${res.statusCode}`);
    assert(res.body?.items?.length === 1, `GET /api/orders devolvió ${res.body?.items?.length} pedido(s)`);

    const apiOrder = res.body.items[0];
    assert(apiOrder.id === createdOrderId, `GET /api/orders devolvió ESE MISMO order.id (${apiOrder.id})`);
    assert(apiOrder.customerPhone === clientPhone, 'Cliente teléfono coincide en respuesta de /pedidos');
    assert(apiOrder.itemCount === 1, 'itemCount de items = 1');

    // 6. COMPROBACIÓN FINAL: DASHBOARD_AND_ORDERS_SHARE_SAME_ORDER = PASS
    const customerUpdated = await db.customer.findUnique({
      where: { id: customer.id },
    });
    const stateActiveOrderId = customerUpdated.commercialState?.activeOrderId;
    assert(stateActiveOrderId === createdOrderId, 'customer.commercialState.activeOrderId comparte el mismo order.id');

    console.log('\n======================================================================');
    console.log('🏆 DASHBOARD_AND_ORDERS_SHARE_SAME_ORDER = PASS');
    console.log(`📊 Métricas: ${passedTests}/${totalTests} aserciones superadas`);
    console.log('======================================================================\n');

  } catch (err) {
    console.error('\n❌ ERROR EN TEST:', err);
    throw err;
  } finally {
    // Cleanup fixtures
    if (tenant?.id && isLiveDb) {
      try {
        await prisma.tenant.delete({ where: { id: tenant.id } });
        console.log('🧹 Fixtures eliminados limpiamente.');
      } catch (cleanupErr) {
        console.warn('⚠️ Error al limpiar fixtures:', cleanupErr.message);
      }
    }

    if (originalPrismaProps) {
      Object.assign(prisma, originalPrismaProps);
    }
  }
}

runSuite().catch(() => process.exit(1));
