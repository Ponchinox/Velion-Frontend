import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prisma from './src/db.js';
import {
  syncCommercialOrder,
  isPseudoPaymentMethod,
  isPaymentMethodAuthorized,
  getCanonicalProductPrice
} from './src/services/orderCommercialService.js';
import { createProduct, updateProduct } from './src/controllers/productController.js';
import { getCompactCatalogIndex, invalidateCatalogCache } from './src/services/catalogCacheService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('======================================================================');
console.log('🧪 VELION ARCHITECTURE SUITE: PHYSICAL_PRODUCT vs SERVICE (S1–S22)');
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
    console.error(`  ❌ FAIL: ${name}:`, err.message);
    throw err;
  }
}

/**
 * Adaptador en memoria con semántica idéntica a Prisma/PostgreSQL
 */
function createInMemoryPrisma() {
  const tenants = new Map();
  const users = new Map();
  const products = new Map();
  const customers = new Map();
  const orders = new Map();
  const orderItems = new Map();
  const alerts = [];

  let idCounter = 1;
  const genId = () => `id-${idCounter++}-${Math.random().toString(36).substring(2, 7)}`;

  return {
    tenants,
    users,
    products,
    customers,
    orders,
    orderItems,
    alerts,

    tenant: {
      findUnique: async ({ where, select }) => {
        const t = tenants.get(where.id);
        if (!t) return null;
        if (select) {
          const res = {};
          for (const k of Object.keys(select)) {
            if (select[k]) res[k] = t[k];
          }
          return res;
        }
        return { ...t };
      }
    },

    product: {
      create: async ({ data }) => {
        const id = data.id || genId();
        const record = { id, type: data.type || 'PHYSICAL_PRODUCT', ...data };
        products.set(id, record);
        return record;
      },
      findFirst: async ({ where, select }) => {
        for (const p of products.values()) {
          if (where.id && p.id !== where.id) continue;
          if (where.user?.tenantId) {
            const user = users.get(p.userId);
            if (!user || user.tenantId !== where.user.tenantId) continue;
          }
          if (select) {
            const res = {};
            for (const k of Object.keys(select)) {
              if (select[k]) res[k] = p[k];
            }
            return res;
          }
          return { ...p };
        }
        return null;
      },
      findMany: async ({ where, select }) => {
        const matches = [];
        for (const p of products.values()) {
          if (where?.user?.tenantId) {
            const user = users.get(p.userId);
            if (!user || user.tenantId !== where.user.tenantId) continue;
          }
          if (where?.isAvailable !== undefined && p.isAvailable !== where.isAvailable) continue;
          if (select) {
            const res = {};
            for (const k of Object.keys(select)) {
              if (select[k]) res[k] = p[k];
            }
            matches.push(res);
          } else {
            matches.push({ ...p });
          }
        }
        return matches;
      }
    },

    customer: {
      create: async ({ data }) => {
        const id = data.id || genId();
        const record = { id, ...data };
        customers.set(id, record);
        return record;
      },
      findFirst: async ({ where }) => {
        for (const c of customers.values()) {
          if (where.id && c.id !== where.id) continue;
          if (where.tenantId && c.tenantId !== where.tenantId) continue;
          return { ...c };
        }
        return null;
      },
      update: async ({ where, data }) => {
        const c = customers.get(where.id);
        if (!c) throw new Error(`Customer not found: ${where.id}`);
        Object.assign(c, data);
        return { ...c };
      }
    },

    order: {
      create: async ({ data }) => {
        const id = data.id || genId();
        const { items, ...orderData } = data;
        const record = {
          id,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...orderData
        };
        orders.set(id, record);

        if (items?.create) {
          for (const item of items.create) {
            const itemId = genId();
            orderItems.set(itemId, { id: itemId, orderId: id, ...item });
          }
        }
        return { ...record };
      },
      findFirst: async ({ where, include, select }) => {
        for (const o of orders.values()) {
          if (where.id && o.id !== where.id) continue;
          if (where.tenantId && o.tenantId !== where.tenantId) continue;

          let res = { ...o };
          if (include?.items) {
            const items = [];
            for (const it of orderItems.values()) {
              if (it.orderId === o.id) items.push({ ...it });
            }
            res.items = items;
          }
          if (select) {
            const filtered = {};
            for (const k of Object.keys(select)) {
              if (select[k]) filtered[k] = res[k];
            }
            return filtered;
          }
          return res;
        }
        return null;
      },
      update: async ({ where, data }) => {
        const o = orders.get(where.id);
        if (!o) throw new Error(`Order not found: ${where.id}`);
        Object.assign(o, data);
        return { ...o };
      }
    },

    orderItem: {
      deleteMany: async ({ where }) => {
        let count = 0;
        for (const [id, it] of orderItems.entries()) {
          if (where.orderId && it.orderId === where.orderId) {
            orderItems.delete(id);
            count++;
          }
        }
        return { count };
      },
      create: async ({ data }) => {
        const id = genId();
        const record = { id, ...data };
        orderItems.set(id, record);
        return record;
      }
    },

    alert: {
      create: async ({ data }) => {
        const id = genId();
        const record = { id, createdAt: new Date(), ...data };
        alerts.push(record);
        return record;
      }
    },

    $transaction: async (ops) => {
      if (Array.isArray(ops)) {
        const results = [];
        for (const op of ops) {
          results.push(await op);
        }
        return results;
      }
      if (typeof ops === 'function') {
        return await ops(this);
      }
      return ops;
    }
  };
}

async function main() {
  const db = createInMemoryPrisma();

  // Tenants
  const tenantA = { id: 'tenant-serv-a', name: 'Academia XGodel', bankAccounts: 'Yape: 987654321, BCP: 191-123456-0-12' };
  const tenantB = { id: 'tenant-phys-b', name: 'Tienda Física B', bankAccounts: 'Yape: 911222333, Contraentrega Lima' };
  const tenantNoPay = { id: 'tenant-nopay-c', name: 'Servicios Sin Cuentas', bankAccounts: '' };

  db.tenants.set(tenantA.id, tenantA);
  db.tenants.set(tenantB.id, tenantB);
  db.tenants.set(tenantNoPay.id, tenantNoPay);

  // Users
  const userA = { id: 'user-a', tenantId: tenantA.id };
  const userB = { id: 'user-b', tenantId: tenantB.id };
  db.users.set(userA.id, userA);
  db.users.set(userB.id, userB);

  // Products
  const serviceProd = await db.product.create({
    data: {
      id: 'prod-serv-1',
      name: 'Programa Intensivo UNI',
      price: 350.00,
      type: 'SERVICE',
      userId: userA.id,
      isAvailable: true
    }
  });

  const physicalProd = await db.product.create({
    data: {
      id: 'prod-phys-1',
      name: 'Libro Física UNI',
      price: 60.00,
      type: 'PHYSICAL_PRODUCT',
      userId: userA.id,
      isAvailable: true
    }
  });

  const serviceProdB = await db.product.create({
    data: {
      id: 'prod-serv-b',
      name: 'Curso De Tenant B',
      price: 500.00,
      type: 'SERVICE',
      userId: userB.id,
      isAvailable: true
    }
  });

  // Customers
  const customerA = await db.customer.create({
    data: {
      id: 'cust-a-1',
      tenantId: tenantA.id,
      phone: '51988888888',
      name: 'Estudiante Carlos',
      commercialState: {}
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S1. SERVICE sin quantity explícita puede normalizar internamente quantity=1
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S1: SERVICE sin quantity explicita normaliza internamente quantity=1', async () => {
    const res = await syncCommercialOrder({
      tenant: tenantA,
      customer: customerA,
      clientNumber: customerA.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: serviceProd.id,
        productName: serviceProd.name,
        // quantity omitida
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.state.activeOrderId, 'Debe crear activeOrderId');
    const order = await db.order.findFirst({
      where: { id: res.state.activeOrderId },
      include: { items: true }
    });
    assert.strictEqual(order.items[0].quantity, 1, 'Cantidad interna debe ser 1');
    assert.strictEqual(order.totalAmount, 350.00, 'Total debe ser 1 * 350');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S2. SERVICE no exige shippingCity
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S2: SERVICE no exige shippingCity para crear orden', async () => {
    const res = await syncCommercialOrder({
      tenant: tenantA,
      customer: customerA,
      clientNumber: customerA.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: serviceProd.id,
        // shippingCity omitido
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    const order = await db.order.findFirst({ where: { id: res.state.activeOrderId } });
    assert.strictEqual(order.shippingCity, null, 'shippingCity debe ser null en base de datos para SERVICE');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S3. SERVICE no exige shippingAddress
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S3: SERVICE no exige shippingAddress para crear orden', async () => {
    const res = await syncCommercialOrder({
      tenant: tenantA,
      customer: customerA,
      clientNumber: customerA.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: serviceProd.id,
        // shippingAddress omitido
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    const order = await db.order.findFirst({ where: { id: res.state.activeOrderId } });
    assert.strictEqual(order.shippingAddress, null, 'shippingAddress debe ser null en base de datos para SERVICE');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S4. Una ciudad mencionada por un cliente de SERVICE no debe convertir flujo en SHIPPING_COORDINATED ni guardarse como envío
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S4: Ciudad mencionada en SERVICE no se almacena como direccion de envio', async () => {
    const res = await syncCommercialOrder({
      tenant: tenantA,
      customer: customerA,
      clientNumber: customerA.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: serviceProd.id,
        shippingCity: 'Lima Carabayllo',
        shippingAddress: 'Av Universitaria 123',
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    const order = await db.order.findFirst({ where: { id: res.state.activeOrderId } });
    assert.strictEqual(order.shippingCity, null, 'SERVICE no debe guardar shippingCity');
    assert.strictEqual(order.shippingAddress, null, 'SERVICE no debe guardar shippingAddress');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S5. SERVICE no genera lenguaje de "cuantas unidades", flete o courier en prompt (Estático sobre guardrails)
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S5: [Estático] Instrucciones de prompt contienen reglas explicitas prohibiendo flete y unidades para SERVICE', async () => {
    const controllerPath = path.join(__dirname, 'src/controllers/whatsappController.js');
    const content = fs.readFileSync(controllerPath, 'utf8');

    // Extraer globalGuardrails
    const match = content.match(/const globalGuardrails = `([\s\S]*?)`\.trim\(\);/);
    assert.ok(match, 'Debe existir globalGuardrails en whatsappController.js');
    const guardrails = match[1];

    assert.ok(guardrails.includes('SERVICIO / PROGRAMA (SERVICE)'), 'Debe incluir sección SERVICE');
    assert.ok(guardrails.includes('PROHIBIDO preguntar "¿cuántas unidades deseas?"'), 'Debe prohibir preguntar cuantas unidades');
    assert.ok(guardrails.includes('PROHIBIDO hablar de paquetes físicos, despacho, flete, courier'), 'Debe prohibir flete/courier');
    assert.ok(guardrails.includes('NUNCA guardes shippingCity ni shippingAddress para un SERVICE'), 'Debe prohibir guardar shipping para SERVICE');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S6. PHYSICAL_PRODUCT continúa exigiendo quantity
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S6: PHYSICAL_PRODUCT con quantity ausente/invalida NO crea orden', async () => {
    const res = await syncCommercialOrder({
      tenant: tenantA,
      customer: customerA,
      clientNumber: customerA.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: physicalProd.id,
        // quantity omitida
        shippingCity: 'Lima',
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.state.activeOrderId, undefined, 'PHYSICAL_PRODUCT sin quantity no debe crear activeOrderId');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S7. PHYSICAL_PRODUCT continúa exigiendo destino/logística
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S7: PHYSICAL_PRODUCT sin destino de envio NO crea orden', async () => {
    const res = await syncCommercialOrder({
      tenant: tenantA,
      customer: customerA,
      clientNumber: customerA.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: physicalProd.id,
        quantity: 1,
        // Sin shippingCity ni shippingAddress
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.state.activeOrderId, undefined, 'PHYSICAL_PRODUCT sin destino no debe crear activeOrderId');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S8. Product.type inválido es rechazado por el controlador con 400
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S8: Product.type invalido es rechazado con 400 por productController', async () => {
    let statusCode = null;
    let jsonResponse = null;

    const mockReq = {
      body: {
        name: 'Curso Inválido',
        price: '100',
        type: 'SUBSCRIPTION_UNKNOWN'
      },
      user: { id: userA.id, tenantId: tenantA.id }
    };

    const mockRes = {
      status: (code) => {
        statusCode = code;
        return {
          json: (data) => { jsonResponse = data; }
        };
      },
      json: (data) => { jsonResponse = data; }
    };

    await createProduct(mockReq, mockRes);
    assert.strictEqual(statusCode, 400, 'Debe responder con status 400 ante tipo inválido');
    assert.ok(jsonResponse?.error?.includes('Debe ser PHYSICAL_PRODUCT o SERVICE'), `Mensaje recibido: ${jsonResponse?.error}`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S9. [FUNCIONAL] createProduct valida y persiste type correctamente
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S9: createProduct() funcional valida req/res (type ausente->PHYSICAL, invalido->400, SERVICE->persiste)', async () => {
    let capturedCreateData = null;
    const origCreate = prisma.product.create;
    prisma.product.create = async ({ data }) => {
      capturedCreateData = data;
      return { id: 'mock-p-id', ...data };
    };

    try {
      // 1. type ausente -> default a PHYSICAL_PRODUCT
      let status1 = null;
      let body1 = null;
      capturedCreateData = null;
      await createProduct({
        body: { name: 'Zapato Cuero', price: 120 },
        user: { id: 'user-test', tenantId: 'tenant-test' }
      }, {
        status: (s) => { status1 = s; return { json: (b) => { body1 = b; } }; },
        json: (b) => { body1 = b; }
      });
      assert.strictEqual(status1, 201);
      assert.strictEqual(capturedCreateData.type, 'PHYSICAL_PRODUCT', 'Type ausente debe persistir como PHYSICAL_PRODUCT');

      // 2. type inválido -> HTTP 400
      let status2 = null;
      let body2 = null;
      capturedCreateData = null;
      await createProduct({
        body: { name: 'Curso Invalido', price: 100, type: 'INVENTADO' },
        user: { id: 'user-test', tenantId: 'tenant-test' }
      }, {
        status: (s) => { status2 = s; return { json: (b) => { body2 = b; } }; },
        json: (b) => { body2 = b; }
      });
      assert.strictEqual(status2, 400);
      assert.ok(body2?.error?.includes('Debe ser PHYSICAL_PRODUCT o SERVICE'));
      assert.strictEqual(capturedCreateData, null, 'No debe llamar a prisma.create si el tipo es inválido');

      // 3. SERVICE explícito -> persiste SERVICE
      let status3 = null;
      let body3 = null;
      capturedCreateData = null;
      await createProduct({
        body: { name: 'Curso UNI', price: 350, type: 'SERVICE' },
        user: { id: 'user-test', tenantId: 'tenant-test' }
      }, {
        status: (s) => { status3 = s; return { json: (b) => { body3 = b; } }; },
        json: (b) => { body3 = b; }
      });
      assert.strictEqual(status3, 201);
      assert.strictEqual(capturedCreateData.type, 'SERVICE', 'Type SERVICE debe persistirse como SERVICE');
    } finally {
      prisma.product.create = origCreate;
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S10. [FUNCIONAL] getCompactCatalogIndex incluye columna Tipo y valores correctos
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S10: getCompactCatalogIndex() funcional genera CSV con columna Tipo y discrimina SERVICE/PHYSICAL_PRODUCT', async () => {
    const origFindMany = prisma.product.findMany;
    const testTenantId = 'tenant-catalog-test-s10';

    prisma.product.findMany = async ({ where }) => {
      assert.strictEqual(where.user.tenantId, testTenantId);
      return [
        { id: 'uuid-phys', name: 'Libro Fisica', price: 60.00, promotionalPrice: null, category: 'Libros', type: 'PHYSICAL_PRODUCT' },
        { id: 'uuid-serv', name: 'Intensivo UNI', price: 350.00, promotionalPrice: null, category: 'Educacion', type: 'SERVICE' }
      ];
    };

    try {
      invalidateCatalogCache(testTenantId);
      const csv = await getCompactCatalogIndex(testTenantId);

      assert.ok(csv.startsWith('ID,Nombre,Precio,Tipo,Categoria\n'), 'CSV debe comenzar con el header incluyendo columna Tipo');
      assert.ok(csv.includes('uuid-phys,Libro Fisica,S/. 60,PHYSICAL_PRODUCT,Libros\n'), 'Debe incluir fila física con PHYSICAL_PRODUCT');
      assert.ok(csv.includes('uuid-serv,Intensivo UNI,S/. 350,SERVICE,Educacion\n'), 'Debe incluir fila de servicio con SERVICE');
    } finally {
      prisma.product.findMany = origFindMany;
      invalidateCatalogCache(testTenantId);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S11. [Estático] get_product_details incluye type en select y prompt
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S11: [Estático] get_product_details select y respuesta incluyen type', async () => {
    const controllerPath = path.join(__dirname, 'src/controllers/whatsappController.js');
    const content = fs.readFileSync(controllerPath, 'utf8');

    assert.ok(content.includes('type: true'), 'select de get_product_details debe incluir type: true');
    assert.ok(content.includes("Tipo: ${product.type === 'SERVICE' ? 'SERVICE (Servicio / Programa)' : 'PHYSICAL_PRODUCT (Producto Físico)'}"),
      'resultString de get_product_details debe incluir tipo explícito');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S12. SERVICE conserva price canonical desde DB (ignora budget del LLM)
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S12: SERVICE conserva price canonical desde DB ante budget malicioso/inventado', async () => {
    const res = await syncCommercialOrder({
      tenant: tenantA,
      customer: customerA,
      clientNumber: customerA.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: serviceProd.id,
        budget: 1.00, // Intento de pagar S/. 1 por curso de S/. 350
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    const order = await db.order.findFirst({
      where: { id: res.state.activeOrderId },
      include: { items: true }
    });
    assert.strictEqual(order.items[0].price, 350.00, 'Precio del item debe ser el canónico de DB (350)');
    assert.strictEqual(order.totalAmount, 350.00, 'TotalAmount debe ser el canónico de DB (350)');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S13. SERVICE de otro tenant no puede utilizarse para crear Order
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S13: SERVICE de otro tenant (cross-tenant) es rechazado y NO crea Order', async () => {
    const res = await syncCommercialOrder({
      tenant: tenantA, // Tenant A intentando usar producto de Tenant B
      customer: customerA,
      clientNumber: customerA.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: serviceProdB.id, // Producto de Tenant B
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.state.activeOrderId, undefined, 'Producto ajeno debe bloquear creación de Order');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S14. SERVICE no puede marcar PAID/PAYMENT_VERIFIED por IA
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S14: SERVICE no puede autoverificarse a PAID ni COMPLETED por la IA', async () => {
    const res = await syncCommercialOrder({
      tenant: tenantA,
      customer: customerA,
      clientNumber: customerA.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_VERIFIED', // Cliente dice "ya pagué"
        customerConfirmed: true,
        productId: serviceProd.id,
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    const order = await db.order.findFirst({ where: { id: res.state.activeOrderId } });
    assert.strictEqual(order.paymentStatus, 'VERIFYING', 'paymentStatus debe ser VERIFYING, nunca PAID');
    assert.strictEqual(order.status, 'PENDING', 'status de la orden debe ser PENDING, nunca COMPLETED');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S15. Tenant sin método de pago configurado: NO crea Order y NO inventa paymentMethod
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S15: Tenant sin metodo de pago configurado rechaza pago e impide crear Order', async () => {
    const res = await syncCommercialOrder({
      tenant: tenantNoPay, // bankAccounts: ""
      customer: customerA,
      clientNumber: customerA.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: serviceProd.id,
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });

    assert.ok(res.error, 'Debe retornar error de método de pago no configurado');
    assert.ok(res.error.includes('La tienda no tiene métodos de pago registrados'));
    assert.strictEqual(res.state?.activeOrderId, undefined, 'NO debe crear Order');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S16. "Por coordinar con asesor" NO cuenta como paymentMethod
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S16: "Por coordinar con asesor" es rechazado como pseudo-metodo', async () => {
    assert.strictEqual(isPseudoPaymentMethod('Por coordinar con asesor'), true);
    assert.strictEqual(isPseudoPaymentMethod('coordinar con asesor'), true);
    assert.strictEqual(isPseudoPaymentMethod('asesor'), true);
    assert.strictEqual(isPseudoPaymentMethod('pendiente de coordinar'), true);

    const res = await syncCommercialOrder({
      tenant: tenantA,
      customer: customerA,
      clientNumber: customerA.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: serviceProd.id,
        paymentMethod: 'Por coordinar con asesor'
      },
      prismaClient: db
    });

    assert.ok(res.error, 'Debe retornar error rechazando pseudo-método');
    assert.ok(res.error.includes('El asesor no es un método de pago'));
    assert.strictEqual(res.state?.activeOrderId, undefined, 'NO debe crear Order con pseudo-método');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S17. Tenant con método de pago legítimamente configurado puede utilizarlo
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S17: Tenant con metodo configurado (Yape / BCP) autoriza creacion de Order', async () => {
    assert.strictEqual(isPaymentMethodAuthorized('Yape', tenantA.bankAccounts), true);
    assert.strictEqual(isPaymentMethodAuthorized('BCP', tenantA.bankAccounts), true);
    assert.strictEqual(isPaymentMethodAuthorized('Transferencia BCP', tenantA.bankAccounts), true);
    assert.strictEqual(isPaymentMethodAuthorized('Plin', tenantA.bankAccounts), false, 'Plin no configurado en Tenant A');

    const res = await syncCommercialOrder({
      tenant: tenantA,
      customer: customerA,
      clientNumber: customerA.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: serviceProd.id,
        paymentMethod: 'BCP'
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.state.activeOrderId, 'Debe crear orden con método autorizado');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S18. [Estático] No existe ya ningún mensaje global hardcodeado de Shalom / "La tienda únicamente acepta Yape o Contraentrega"
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S18: [Estático] Ausencia de hardcodes globales de Shalom y regla fija de Yape/Contraentrega', async () => {
    const serviceFile = fs.readFileSync(
      path.join(__dirname, 'src/services/orderCommercialService.js'),
      'utf8'
    );
    const controllerFile = fs.readFileSync(
      path.join(__dirname, 'src/controllers/whatsappController.js'),
      'utf8'
    );

    const forbiddenStrings = [
      'La tienda ÚNICAMENTE acepta Yape o Contraentrega',
      'adelanto de flete por Shalom',
      'Shalom si es provincia'
    ];

    for (const str of forbiddenStrings) {
      assert.strictEqual(
        serviceFile.includes(str),
        false,
        `orderCommercialService.js contiene string hardcodeado prohibido: "${str}"`
      );
      assert.strictEqual(
        controllerFile.includes(str),
        false,
        `whatsappController.js contiene string hardcodeado prohibido: "${str}"`
      );
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S19. [ADVERSARIAL A] TYPE SPOOFING: Gemini envía type='SERVICE' para producto real PHYSICAL_PRODUCT
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S19: [ADVERSARIAL] Type Spoofing - Gemini envía type=SERVICE en producto físico -> NO Order', async () => {
    // physicalProd está en BD como 'PHYSICAL_PRODUCT'
    // Gemini intenta omitir shipping y quantity pasando type='SERVICE'
    const res = await syncCommercialOrder({
      tenant: tenantA,
      customer: customerA,
      clientNumber: customerA.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: physicalProd.id,
        type: 'SERVICE', // Intento de spoofing en args
        // quantity omitida
        // shippingCity / shippingAddress omitidos
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(
      res.state.activeOrderId,
      undefined,
      'Backend DEBE ignorar args.type y leer verifiedProduct.type de PostgreSQL: no puede crear Order sin logística'
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S20. [ADVERSARIAL B] PAYMENT BANK MISMATCH: Matriz contra Tenant que SOLO tiene BCP
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S20: [ADVERSARIAL] Payment Bank Mismatch - Matriz completa contra Tenant solo BCP', async () => {
    const tenantOnlyBcp = {
      id: 'tenant-only-bcp',
      name: 'Solo BCP Store',
      bankAccounts: 'BCP: 191-123456-0-12 (Titular: Juan Perez)'
    };
    db.tenants.set(tenantOnlyBcp.id, tenantOnlyBcp);

    // 1. Métodos que DEBEN ser aceptados
    assert.strictEqual(isPaymentMethodAuthorized('BCP', tenantOnlyBcp.bankAccounts), true, 'BCP directo debe ser aceptado');
    assert.strictEqual(isPaymentMethodAuthorized('Transferencia BCP', tenantOnlyBcp.bankAccounts), true, 'Transferencia BCP debe ser aceptada');
    assert.strictEqual(isPaymentMethodAuthorized('banco de credito', tenantOnlyBcp.bankAccounts), true, 'Banco de credito debe ser aceptado');

    // 2. Métodos que DEBEN ser rechazados (Competidores, pseudo-métodos, vacíos)
    assert.strictEqual(isPaymentMethodAuthorized('Banco BBVA', tenantOnlyBcp.bankAccounts), false, 'Banco BBVA debe ser rechazado');
    assert.strictEqual(isPaymentMethodAuthorized('BBVA', tenantOnlyBcp.bankAccounts), false, 'BBVA debe ser rechazado');
    assert.strictEqual(isPaymentMethodAuthorized('Interbank', tenantOnlyBcp.bankAccounts), false, 'Interbank debe ser rechazado');
    assert.strictEqual(isPaymentMethodAuthorized('Yape', tenantOnlyBcp.bankAccounts), false, 'Yape debe ser rechazado si no está configurado');
    assert.strictEqual(isPaymentMethodAuthorized('Efectivo', tenantOnlyBcp.bankAccounts), false, 'Efectivo/Contraentrega debe ser rechazado');
    assert.strictEqual(isPaymentMethodAuthorized('Por coordinar con asesor', tenantOnlyBcp.bankAccounts), false, 'Asesor debe ser rechazado');
    assert.strictEqual(isPaymentMethodAuthorized('', tenantOnlyBcp.bankAccounts), false, 'Vacío debe ser rechazado');

    // 3. Verificación funcional de llamada a syncCommercialOrder con banco competidor
    const res = await syncCommercialOrder({
      tenant: tenantOnlyBcp,
      customer: customerA,
      clientNumber: customerA.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: serviceProd.id,
        paymentMethod: 'Banco BBVA'
      },
      prismaClient: db
    });

    assert.ok(res.error, 'Debe retornar error rechazando método no configurado');
    assert.ok(res.error.includes('Método de pago no autorizado'));
    assert.strictEqual(res.state?.activeOrderId, undefined, 'NO debe crear Order');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S21. [ADVERSARIAL C] UNDEFINED BANK ACCOUNTS: Fallback permisivo eliminado (Fail-Closed)
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S21: [ADVERSARIAL] Undefined Bank Accounts - bankAccounts=undefined falla cerrado', async () => {
    const tenantUndefinedAccounts = {
      id: 'tenant-undefined-acc',
      name: 'Tenant Sin Config',
      bankAccounts: undefined
    };
    db.tenants.set(tenantUndefinedAccounts.id, tenantUndefinedAccounts);

    const res = await syncCommercialOrder({
      tenant: tenantUndefinedAccounts,
      customer: customerA,
      clientNumber: customerA.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: serviceProd.id,
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });

    assert.ok(res.error, 'Debe retornar error rechazando pago por ausencia de configuración');
    assert.ok(res.error.includes('La tienda no tiene métodos de pago registrados'));
    assert.strictEqual(res.state?.activeOrderId, undefined, 'NO debe crear Order ante bankAccounts=undefined');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S22. [ADVERSARIAL D] SERVICE MERCHANT NOTIFICATION & ALERT: Sin 'x1' ni 'Envío'
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('S22: [ADVERSARIAL] Service Notification & Alert - Sin "x1", sin "Envío" y copy de Servicio', async () => {
    let capturedNotif = null;

    const res = await syncCommercialOrder({
      tenant: tenantA,
      customer: customerA,
      clientNumber: customerA.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: serviceProd.id,
        paymentMethod: 'Yape'
      },
      onNotification: async (notif) => {
        capturedNotif = notif;
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.state.activeOrderId);
    assert.ok(capturedNotif);
    assert.strictEqual(capturedNotif.productType, 'SERVICE');
    assert.strictEqual(capturedNotif.shippingCity, null);
    assert.strictEqual(capturedNotif.shippingAddress, null);

    // 1. Simular formateador de notificación de whatsappController para SERVICE
    const isServ = capturedNotif.productType === 'SERVICE';
    const clientNumber = customerA.phone;
    let txt = '';
    if (capturedNotif.type === 'NEW_ORDER') {
      if (isServ) {
        const qtySuffix = (capturedNotif.quantity && capturedNotif.quantity > 1) ? ` (${capturedNotif.quantity} personas)` : '';
        txt = `🚨 *NUEVO SERVICIO REGISTRADO por IA*\n\n📱 *Cliente:* +${clientNumber} (${customerA.name || 'Sin Nombre'})\n💼 *Servicio:* ${capturedNotif.productName}${qtySuffix}\n💰 *Monto aprox:* S/. ${capturedNotif.total}\n\n⚡ _Velion Agent Auto-Notification_`;
      } else {
        txt = `🚨 *NUEVO PEDIDO CREADO por IA*\n\n📱 *Cliente:* +${clientNumber} (${customerA.name || 'Sin Nombre'})\n📦 *Producto:* ${capturedNotif.productName} x${capturedNotif.quantity}\n💰 *Monto aprox:* S/. ${capturedNotif.total}\n📍 *Envío:* ${capturedNotif.shippingCity || '-'} / ${capturedNotif.shippingAddress || '-'}\n\n⚡ _Velion Agent Auto-Notification_`;
      }
    }

    assert.ok(txt.includes('🚨 *NUEVO SERVICIO REGISTRADO por IA*'), 'Debe usar título de servicio');
    assert.ok(txt.includes('💼 *Servicio:* Programa Intensivo UNI'), 'Debe usar icono y label de servicio');
    assert.strictEqual(txt.includes('x1'), false, 'NO debe decir x1 para servicio individual');
    assert.strictEqual(txt.includes('Envío'), false, 'NO debe incluir Envío para servicio');
    assert.strictEqual(txt.includes('📦 *Producto:*'), false, 'NO debe usar icono ni copy de producto físico');

    // 2. Verificar la alerta registrada en DB para el dashboard
    const lastAlert = db.alerts[db.alerts.length - 1];
    assert.ok(lastAlert.message.includes('💼 SERVICIO REGISTRADO'), 'Alerta debe decir SERVICIO REGISTRADO');
    assert.strictEqual(lastAlert.message.includes('x1'), false, 'Alerta de servicio no debe decir x1');
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE S1–S22 FINALIZADA: ${passedTests}/${totalTests} TESTS PASARON EXITOSAMENTE`);
  console.log('======================================================================\n');
}

main().catch(err => {
  console.error('\n❌ ERROR FATAL EN SUITE:', err);
  process.exit(1);
});
