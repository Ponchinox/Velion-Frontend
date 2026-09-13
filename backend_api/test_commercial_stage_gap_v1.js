import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncCommercialOrder } from './src/services/orderCommercialService.js';
import { evaluateAndScheduleFollowUp } from './src/services/followUpService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('======================================================================');
console.log('🧪 COMMERCIAL STAGE GAP (PRODUCT_SELECTED) REGRESSION SUITE');
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
    console.error(`  ❌ FAIL: ${name}:`, err.message);
    throw err;
  }
}

function createMockDb() {
  let idCounter = 1;
  const genId = () => `id-${idCounter++}-${Math.random().toString(36).substring(2, 7)}`;

  const tenants = new Map();
  const users = new Map();
  const products = new Map();
  const customers = new Map();
  const orders = new Map();
  const orderItems = new Map();
  const chats = new Map();
  const contacts = new Map();
  const followUpSequences = new Map();
  const followUpAttempts = new Map();
  const messages = new Map();

  return {
    tenants,
    users,
    products,
    customers,
    contacts,
    chats,
    orders,
    orderItems,
    followUpSequences,
    followUpAttempts,
    messages,

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

    user: {
      findUnique: async ({ where }) => users.get(where.id) || null
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
      }
    },

    customer: {
      create: async ({ data }) => {
        const id = data.id || genId();
        const record = { id, commercialState: null, followUpSuppressed: false, ...data };
        customers.set(id, record);
        return record;
      },
      findUnique: async ({ where }) => {
        const c = customers.get(where.id);
        return c ? { ...c } : null;
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
            const its = [];
            for (const it of orderItems.values()) {
              if (it.orderId === o.id) its.push({ ...it });
            }
            res.items = its;
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
      }
    },

    message: {
      findFirst: async ({ where, orderBy }) => {
        const list = Array.from(messages.values()).filter(m => {
          if (where.chatId && m.chatId !== where.chatId) return false;
          if (where.senderRole?.in && !where.senderRole.in.includes(m.senderRole)) return false;
          return true;
        });
        if (orderBy?.createdAt === 'desc') {
          list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }
        return list[0] || null;
      }
    },

    contact: {
      findFirst: async ({ where }) => {
        for (const ct of contacts.values()) {
          if (where.tenantId && ct.tenantId !== where.tenantId) continue;
          if (where.id && ct.id !== where.id) continue;
          return ct;
        }
        return null;
      },
      findUnique: async ({ where }) => contacts.get(where.id) || null,
      create: async ({ data }) => {
        const id = data.id || genId();
        const ct = { id, botPaused: false, ...data };
        contacts.set(id, ct);
        return ct;
      }
    },

    chat: {
      findUnique: async ({ where }) => chats.get(where.id) || null,
      findFirst: async ({ where }) => {
        for (const ch of chats.values()) {
          if (where.tenantId && ch.tenantId !== where.tenantId) continue;
          if (where.id && ch.id !== where.id) continue;
          return ch;
        }
        return null;
      },
      create: async ({ data }) => {
        const id = data.id || genId();
        const ch = { id, botPaused: false, ...data };
        chats.set(id, ch);
        return ch;
      }
    },

    followUpSequence: {
      findFirst: async ({ where }) => {
        for (const s of followUpSequences.values()) {
          if (where.tenantId && s.tenantId !== where.tenantId) continue;
          if (where.customerId && s.customerId !== where.customerId) continue;
          if (where.status?.in && !where.status.in.includes(s.status)) continue;
          if (where.status && typeof where.status === 'string' && s.status !== where.status) continue;
          return { ...s };
        }
        return null;
      },
      findMany: async ({ where }) => {
        let list = Array.from(followUpSequences.values());
        if (where?.tenantId) list = list.filter(s => s.tenantId === where.tenantId);
        if (where?.customerId) list = list.filter(s => s.customerId === where.customerId);
        if (where?.status?.in) list = list.filter(s => where.status.in.includes(s.status));
        return list;
      },
      create: async ({ data }) => {
        const id = data.id || genId();
        const record = {
          id,
          currentAttempt: 0,
          status: 'SCHEDULED',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data
        };
        followUpSequences.set(id, record);
        return { ...record };
      },
      update: async ({ where, data }) => {
        const s = followUpSequences.get(where.id);
        if (!s) throw new Error(`FollowUpSequence not found: ${where.id}`);
        Object.assign(s, data, { updatedAt: new Date() });
        return { ...s };
      }
    },

    followUpAttempt: {
      create: async ({ data }) => {
        const id = data.id || genId();
        const record = { id, createdAt: new Date(), ...data };
        followUpAttempts.set(id, record);
        return { ...record };
      }
    },

    $transaction: async (ops) => {
      if (Array.isArray(ops)) {
        return Promise.all(ops);
      }
      return ops;
    }
  };
}

async function main() {
  const db = createMockDb();

  const tenant = {
    id: 'tenant-commercial-gap',
    name: 'Tienda JBL Perú',
    followUpEnabled: true,
    timezone: 'America/Lima',
    bankAccounts: 'Transferencia BCP: 191-99887766-0-12, Yape: 996028790'
  };
  db.tenants.set(tenant.id, tenant);

  const owner = {
    id: 'user-owner-1',
    email: 'jbl_owner@test.com',
    tenantId: tenant.id
  };
  db.users.set(owner.id, owner);

  const jblProduct = await db.product.create({
    data: {
      id: 'prod-jbl-go-4',
      name: 'JBL go 4',
      price: 150.00,
      isAvailable: true,
      type: 'PHYSICAL_PRODUCT',
      userId: owner.id
    }
  });

  const customer = await db.customer.create({
    data: {
      id: 'cust-live-smoke-1',
      tenantId: tenant.id,
      phone: '51996028790',
      name: 'Cliente JBL',
      commercialState: null
    }
  });

  const chat = { id: 'chat-gap-1', tenantId: tenant.id };
  db.chats.set(chat.id, chat);
  const inboundMsg = {
    id: 'msg-inbound-1',
    chatId: chat.id,
    senderRole: 'user',
    content: 'Quiero llevar 1',
    createdAt: new Date('2026-09-12T15:00:00Z')
  };
  db.messages.set(inboundMsg.id, inboundMsg);

  // ─────────────────────────────────────────────────────────────────────────
  // TEST A: Producto conocido + "Quiero llevar 1" -> update_commercial_state
  //         -> PRODUCT_SELECTED con quantity = 1, sin orden prematura
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST A: Producto conocido + "Quiero llevar 1" -> PRODUCT_SELECTED con quantity=1', async () => {
    const res = await syncCommercialOrder({
      tenant,
      customer,
      clientNumber: customer.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PRODUCT_SELECTED',
        customerConfirmed: true,
        productId: jblProduct.id,
        productName: jblProduct.name,
        quantity: 1,
        intent: 'purchasing'
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.state.currentStage, 'PRODUCT_SELECTED');
    assert.strictEqual(res.state.productId, jblProduct.id);
    assert.strictEqual(res.state.productName, 'JBL go 4');
    assert.strictEqual(res.state.quantity, 1);
    assert.strictEqual(res.state.customerConfirmed, true);
    assert.strictEqual(res.state.activeOrderId, undefined, 'NO debe crear Order en etapa PRODUCT_SELECTED');

    // Verificar persistencia en Customer
    const updatedCust = await db.customer.findUnique({ where: { id: customer.id } });
    assert.strictEqual(updatedCust.commercialState.currentStage, 'PRODUCT_SELECTED');
    assert.strictEqual(updatedCust.commercialState.productId, jblProduct.id);
    assert.strictEqual(updatedCust.commercialState.quantity, 1);
    assert.strictEqual(db.orders.size, 0, 'Total órdenes debe seguir en 0');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST B: Producto conocido + "Me llevo 2" -> PRODUCT_SELECTED con quantity = 2
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST B: Producto conocido + "Me llevo 2" -> PRODUCT_SELECTED con quantity=2', async () => {
    const customerB = await db.customer.create({
      data: {
        id: 'cust-smoke-b',
        tenantId: tenant.id,
        phone: '51996028791',
        name: 'Cliente Dos Unidades',
        commercialState: null
      }
    });

    const res = await syncCommercialOrder({
      tenant,
      customer: customerB,
      clientNumber: customerB.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PRODUCT_SELECTED',
        customerConfirmed: true,
        productId: jblProduct.id,
        productName: jblProduct.name,
        quantity: 2,
        intent: 'purchasing'
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.state.currentStage, 'PRODUCT_SELECTED');
    assert.strictEqual(res.state.quantity, 2);
    assert.strictEqual(res.state.customerConfirmed, true);

    const updatedCustB = await db.customer.findUnique({ where: { id: customerB.id } });
    assert.strictEqual(updatedCustB.commercialState.quantity, 2);
    assert.strictEqual(updatedCustB.commercialState.currentStage, 'PRODUCT_SELECTED');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST C: Consulta "¿Cuánto cuesta?" -> EXPLORING, NO PRODUCT_SELECTED
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST C: Consulta "¿Cuánto cuesta?" permanece en EXPLORING sin selección', async () => {
    const customerC = await db.customer.create({
      data: {
        id: 'cust-smoke-c',
        tenantId: tenant.id,
        phone: '51996028792',
        name: 'Cliente Pregunta Precio',
        commercialState: null
      }
    });

    const res = await syncCommercialOrder({
      tenant,
      customer: customerC,
      clientNumber: customerC.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'EXPLORING',
        customerConfirmed: false,
        productId: jblProduct.id,
        productName: jblProduct.name,
        intent: 'inquiry'
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.state.currentStage, 'EXPLORING');
    assert.notStrictEqual(res.state.currentStage, 'PRODUCT_SELECTED');
    assert.strictEqual(res.state.productId, undefined, 'EXPLORING limpia el draft efímero');
    assert.strictEqual(res.state.quantity, undefined);

    const updatedCustC = await db.customer.findUnique({ where: { id: customerC.id } });
    assert.strictEqual(updatedCustC.commercialState.currentStage, 'EXPLORING');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST D: Consulta "¿Hay disponible?" -> EXPLORING, NO PRODUCT_SELECTED
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST D: Consulta "¿Hay disponible?" por sí sola permanece en EXPLORING', async () => {
    const customerD = await db.customer.create({
      data: {
        id: 'cust-smoke-d',
        tenantId: tenant.id,
        phone: '51996028793',
        name: 'Cliente Pregunta Stock',
        commercialState: null
      }
    });

    const res = await syncCommercialOrder({
      tenant,
      customer: customerD,
      clientNumber: customerD.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'EXPLORING',
        customerConfirmed: false,
        intent: 'exploring'
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.state.currentStage, 'EXPLORING');
    assert.notStrictEqual(res.state.currentStage, 'PRODUCT_SELECTED');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST E: Preguntar destino después de PRODUCT_SELECTED NO borra ni retrocede estado
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST E: Preguntar destino y recibir ciudad avanza a SHIPPING_COORDINATED preservando producto y cantidad', async () => {
    // Partimos del estado de customerA que ya está en PRODUCT_SELECTED (JBL go 4, cantidad 1)
    const priorCustomer = await db.customer.findUnique({ where: { id: customer.id } });
    assert.strictEqual(priorCustomer.commercialState.currentStage, 'PRODUCT_SELECTED');
    assert.strictEqual(priorCustomer.commercialState.productId, jblProduct.id);
    assert.strictEqual(priorCustomer.commercialState.quantity, 1);

    // El bot preguntó "¿Cuál es tu ciudad?" y el cliente responde "Lima"
    // Gemini llama a update_commercial_state con SHIPPING_COORDINATED y shippingCity
    const res = await syncCommercialOrder({
      tenant,
      customer: priorCustomer,
      clientNumber: priorCustomer.phone,
      currentCommercialState: priorCustomer.commercialState,
      args: {
        currentStage: 'SHIPPING_COORDINATED',
        shippingCity: 'Lima',
        intent: 'purchasing'
      },
      prismaClient: db
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.state.currentStage, 'SHIPPING_COORDINATED');
    assert.strictEqual(res.state.productId, jblProduct.id, 'Debe preservar el productId');
    assert.strictEqual(res.state.productName, 'JBL go 4', 'Debe preservar el productName');
    assert.strictEqual(res.state.quantity, 1, 'Debe preservar la cantidad previa');
    assert.strictEqual(res.state.shippingCity, 'Lima', 'Debe registrar la ciudad');

    const updatedCustomer = await db.customer.findUnique({ where: { id: customer.id } });
    assert.strictEqual(updatedCustomer.commercialState.currentStage, 'SHIPPING_COORDINATED');
    assert.strictEqual(updatedCustomer.commercialState.productId, jblProduct.id);
    assert.strictEqual(updatedCustomer.commercialState.quantity, 1);
    assert.strictEqual(updatedCustomer.commercialState.shippingCity, 'Lima');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST F: PRODUCT_SELECTED válido + Follow-ups habilitado
  //         -> evaluateAndScheduleFollowUp crea exactamente 1 sequence
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST F: PRODUCT_SELECTED válido + Follow-ups habilitado crea exactamente una secuencia', async () => {
    const customerF = await db.customer.create({
      data: {
        id: 'cust-smoke-f',
        tenantId: tenant.id,
        phone: '51996028795',
        name: 'Cliente Para FollowUp',
        commercialState: {
          currentStage: 'PRODUCT_SELECTED',
          productId: jblProduct.id,
          productName: jblProduct.name,
          quantity: 1,
          customerConfirmed: true
        }
      }
    });

    const inboundMsgF = {
      id: 'msg-inbound-f',
      chatId: chat.id,
      senderRole: 'user',
      content: 'Quiero llevar 1',
      createdAt: new Date('2026-09-12T16:00:00Z')
    };
    db.messages.set(inboundMsgF.id, inboundMsgF);

    const res = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customerF.id,
      chatId: chat.id,
      currentStage: 'PRODUCT_SELECTED',
      orderId: null,
      productId: jblProduct.id,
      productName: jblProduct.name,
      lastInboundMessage: inboundMsgF,
      explicitCustomerTiming: null,
      contextSnapshot: {
        customerName: customerF.name,
        currentStage: 'PRODUCT_SELECTED',
        productId: jblProduct.id,
        productName: jblProduct.name,
        orderId: null
      },
      prismaClient: db
    });

    assert.ok(res.sequence, 'Debe retornar la secuencia creada');
    assert.strictEqual(res.sequence.status, 'SCHEDULED');
    assert.strictEqual(res.sequence.stageAtCreation, 'PRODUCT_SELECTED');
    assert.strictEqual(res.sequence.currentAttempt, 0);
    assert.strictEqual(res.sequence.customerId, customerF.id);
    assert.strictEqual(res.sequence.tenantId, tenant.id);
    assert.ok(res.sequence.nextRunAt, 'Debe tener nextRunAt calculado');
    assert.strictEqual(db.followUpSequences.size, 1, 'Debe haber exactamente una secuencia en BD');

    // Llamada idempotente con el mismo inbound no debe crear una segunda secuencia
    const resIdempotent = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customerF.id,
      chatId: chat.id,
      currentStage: 'PRODUCT_SELECTED',
      orderId: null,
      productId: jblProduct.id,
      productName: jblProduct.name,
      lastInboundMessage: inboundMsgF,
      explicitCustomerTiming: null,
      contextSnapshot: {
        customerName: customerF.name,
        currentStage: 'PRODUCT_SELECTED',
        productId: jblProduct.id,
        productName: jblProduct.name,
        orderId: null
      },
      prismaClient: db
    });

    assert.strictEqual(db.followUpSequences.size, 1, 'Idempotencia: no debe crear duplicado de secuencia');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST G: [Estático] Inspección del contrato y directivas en whatsappController.js
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST G: [Estático] Directivas explícitas de PRODUCT_SELECTED y sincronización incremental en whatsappController.js', async () => {
    const controllerPath = path.join(__dirname, 'src/controllers/whatsappController.js');
    const controllerCode = fs.readFileSync(controllerPath, 'utf8');

    // 1. Mandato explícito de sincronización incremental inmediata
    assert.ok(
      controllerCode.includes('SINCRONIZACIÓN INCREMENTAL INMEDIATA'),
      'Debe incluir encabezado o cláusula de SINCRONIZACIÓN INCREMENTAL INMEDIATA'
    );
    assert.ok(
      controllerCode.includes('HITO PRODUCT_SELECTED'),
      'Debe incluir cláusula explícita para HITO PRODUCT_SELECTED'
    );
    assert.ok(
      controllerCode.includes("currentStage='PRODUCT_SELECTED'"),
      'Debe indicar invocar update_commercial_state con currentStage=\'PRODUCT_SELECTED\''
    );
    assert.ok(
      controllerCode.includes('NO necesitas esperar la respuesta de la ciudad para registrar PRODUCT_SELECTED') ||
      controllerCode.includes('sin esperar a recolectar ciudad'),
      'Debe indicar no esperar la respuesta de la ciudad'
    );

    // 2. Definición inequívoca en la tool update_commercial_state
    assert.ok(
      controllerCode.includes('Sincroniza de forma estructurada e INCREMENTAL el estado del proceso de compra'),
      'La descripción de update_commercial_state debe declarar sincronización incremental'
    );
    assert.ok(
      controllerCode.includes('PRODUCT_SELECTED significa que el cliente ya eligió explícitamente un producto/servicio concreto'),
      'La descripción de currentStage debe definir el significado semántico de PRODUCT_SELECTED'
    );

    // 3. Anti-sobreactivación
    assert.ok(
      controllerCode.includes('CONSULTAS NO SON COMPRAS (ANTI-SOBREACTIVACIÓN)'),
      'Debe incluir salvaguarda ANTI-SOBREACTIVACIÓN'
    );

    // 4. Cero palabras prohibidas / PII de marcas en globalGuardrails
    const globalGuardrailsMatch = controllerCode.match(/const globalGuardrails = `([\s\S]*?)`\.trim\(\);/);
    assert.ok(globalGuardrailsMatch, 'Debe encontrarse globalGuardrails');
    const guardrailsText = globalGuardrailsMatch[1].toLowerCase();
    const forbiddenKeywords = ['yape', 'plin', 'shalom', 'olva', 'bcp', 'interbank', 'bbva', 'scotiabank'];
    for (const kw of forbiddenKeywords) {
      assert.strictEqual(
        guardrailsText.includes(kw),
        false,
        `globalGuardrails contiene marca/banco prohibido: "${kw}"`
      );
    }
  });

  console.log('\n======================================================================');
  console.log(`🏁 RESULTADO: ${passedTests}/${totalTests} TESTS PASARON EXITOSAMENTE (100%)`);
  console.log('======================================================================');
}

main().catch(err => {
  console.error('\n❌ ERROR FATAL EN SUITE:', err);
  process.exit(1);
});
