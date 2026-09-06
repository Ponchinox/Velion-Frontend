import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  deriveCustomerRelationship,
  buildChatContext,
  getChatGenerationVersion,
  incrementChatGenerationVersion,
  _resetChatGenerationVersionsForTesting,
  REQUEST_HUMAN_HANDOFF_DECLARATION,
  SEND_PRODUCT_MEDIA_DECLARATION
} from './src/controllers/whatsappController.js';
import {
  syncCommercialOrder,
  isPaymentMethodAuthorized,
  isPseudoPaymentMethod,
  cleanCommercialDraft
} from './src/services/orderCommercialService.js';
import { isHandoffActive } from './src/services/humanHandoffGate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('======================================================================');
console.log('🧪 VELION BUSINESS AGENT CORE — SUITE DE PRUEBAS B1–B25');
console.log('======================================================================\n');

let totalTests = 0;
let passedTests = 0;

async function runTest(id, name, type, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: [${id}] [${type}] ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: [${id}] [${type}] ${name}`);
    console.error(`       Error: ${err.message}`);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LECTURA ESTÁTICA Y EXTRACTORES DE CONTROLADOR
// ─────────────────────────────────────────────────────────────────────────────
const controllerPath = path.join(__dirname, 'src/controllers/whatsappController.js');
const controllerSource = fs.readFileSync(controllerPath, 'utf8');

const roleCoreMatch = controllerSource.match(/const roleCore = `([\s\S]*?)`\.trim\(\);/);
assert.ok(roleCoreMatch, 'Debe existir roleCore en whatsappController.js');
const roleCore = roleCoreMatch[1];

const guardrailsMatch = controllerSource.match(/const globalGuardrails = `([\s\S]*?)`\.trim\(\);/);
assert.ok(guardrailsMatch, 'Debe existir globalGuardrails en whatsappController.js');
const globalGuardrails = guardrailsMatch[1];

function genId() {
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Mock Prisma Adapter en memoria completo
 */
function createMockPrisma() {
  const tenants = new Map();
  const users = new Map();
  const customers = new Map();
  const contacts = new Map();
  const chats = new Map();
  const orders = new Map();
  const orderItems = new Map();
  const products = new Map();
  const alerts = [];

  const mockDb = {
    tenants,
    users,
    customers,
    contacts,
    chats,
    orders,
    orderItems,
    products,
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
      count: async ({ where }) => {
        let cnt = 0;
        for (const o of orders.values()) {
          if (where.customerId && o.customerId !== where.customerId) continue;
          if (where.tenantId && o.tenantId !== where.tenantId) continue;
          cnt++;
        }
        return cnt;
      },
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
          if (where.customerId && o.customerId !== where.customerId) continue;
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
        Object.assign(o, data, { updatedAt: new Date() });
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

    contact: {
      findFirst: async ({ where }) => {
        for (const c of contacts.values()) {
          if (where.id && c.id !== where.id) continue;
          if (where.tenantId && c.tenantId !== where.tenantId) continue;
          return c;
        }
        return null;
      }
    },

    chat: {
      findFirst: async ({ where }) => {
        for (const ch of chats.values()) {
          if (where.id && ch.id !== where.id) continue;
          if (where.tenantId && ch.tenantId !== where.tenantId) continue;
          return ch;
        }
        return null;
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
        return await ops(mockDb);
      }
      return ops;
    }
  };

  return mockDb;
}

async function main() {
  const db = createMockPrisma();

  // Tenant A: Academia Preuniversitaria
  const tenantA = {
    id: 'tenant-academia-a',
    name: 'Academia Matemática Gauss',
    bankAccounts: 'BCP: 191-000111-0-12, Yape: 987654321'
  };
  // Tenant B: Tienda Retail
  const tenantB = {
    id: 'tenant-retail-b',
    name: 'Tienda Deportiva Olimpo',
    bankAccounts: 'Interbank: 200-333444-0-55, Plin: 911222333'
  };
  db.tenants.set(tenantA.id, tenantA);
  db.tenants.set(tenantB.id, tenantB);

  const userA = { id: 'user-a', tenantId: tenantA.id };
  const userB = { id: 'user-b', tenantId: tenantB.id };
  db.users.set(userA.id, userA);
  db.users.set(userB.id, userB);

  // Products
  const serviceProd = await db.product.create({
    data: {
      id: 'prod-serv-b12',
      name: 'Ciclo Intensivo Verano',
      price: 200,
      type: 'SERVICE',
      userId: userA.id,
      isAvailable: true
    }
  });

  const physicalProd = await db.product.create({
    data: {
      id: 'prod-phys-b13',
      name: 'Camiseta Deportiva Pro',
      price: 90,
      type: 'PHYSICAL_PRODUCT',
      userId: userB.id,
      isAvailable: true
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B1 [Contrato + Integración]: "¿Cuánto cuesta el Intensivo?" => SALES
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B1', 'Consulta explícita de precio activa modo SALES y preserva venta', 'Contrato / Integración', async () => {
    assert.ok(roleCore.includes('1. SALES: Consultas directas de precios, catálogo'), 'roleCore debe tipificar SALES');
    assert.ok(globalGuardrails.includes('[MODO VENTAS - ACTIVACIÓN EXCLUSIVA ANTE INTENCIÓN COMERCIAL]'), 'Guardrails debe tener sección Modo Ventas');
    assert.ok(globalGuardrails.includes('CONSULTA: Responde directo, destaca 1 beneficio y el precio.'), 'Debe mantener regla consultiva de precio/beneficio');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B2 [Funcional + Contrato]: Caso Gustavito - Coordinación Operacional
  // "Profesor, hoy Gustavito quiere practicar álgebra."
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B2', 'Caso Gustavito: Coordinación operacional no dispara catálogo ni venta forzada', 'Funcional / Contrato', async () => {
    assert.ok(roleCore.includes('OPERATIONAL_COORDINATION'), 'roleCore debe tipificar OPERATIONAL_COORDINATION');
    assert.ok(roleCore.includes('Gustavito'), 'roleCore debe incluir caso de coordinación (Gustavito)');
    assert.ok(globalGuardrails.includes('COORDINACIÓN OPERACIONAL ("Hoy Gustavito no asiste"'), 'Guardrails debe tener directiva de Gustavito');
    assert.ok(globalGuardrails.includes('NO inicies embudo comercial, NO ofrezcas catálogo'), 'Prohíbe venta forzada');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B3 [Contrato]: "Hoy Juancito no va a poder asistir" => 0 Venta
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B3', 'Aviso de inasistencia: Reconocido como coordinación sin venta ni catálogo', 'Contrato', async () => {
    assert.ok(roleCore.includes('Juancito no asiste') || roleCore.includes('asistencia, tardanzas, recados'), 'roleCore debe tipificar inasistencias/tardanzas');
    assert.ok(roleCore.includes('PRINCIPIO CARDINAL: NO conviertas automáticamente cada conversación en una venta.'), 'Debe incluir Principio Cardinal');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B4 [Contrato]: "¿Cómo ha estado profesor?" => Cordial / 0 Catálogo
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B4', 'Saludo cordial a profesor: Respuesta humana breve sin volcar catálogo comercial', 'Contrato', async () => {
    assert.ok(roleCore.includes('8. CASUAL_OR_GREETING: Saludos de cortesía ("Hola", "Buen día profesor"'), 'roleCore debe incluir CASUAL_OR_GREETING con saludos');
    assert.ok(globalGuardrails.includes('CASUAL / SALUDO ("Hola", "Profesor buen día"): Responde de forma cordial, corta y atenta. NO menciones precios ni productos.'), 'Guardrails debe prohibir precios en saludos');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B5 [Funcional Real]: Cliente Existente comprando nuevo producto => SALES
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B5', 'Cliente existente con intención de compra deriva EXISTING_CUSTOMER pero activa SALES', 'Funcional Real', async () => {
    const derived = deriveCustomerRelationship({ orderCount: 2, currentStage: 'COMPLETED', messageCount: 15 });
    assert.strictEqual(derived.relationship, 'EXISTING_CUSTOMER');
    assert.ok(derived.evidence.includes('2 pedido(s)'), 'Evidencia debe citar órdenes previas');

    assert.ok(roleCore.includes('REGLA CRÍTICA: INTENCIÓN > RELACIÓN'), 'Debe definir INTENCIÓN > RELACIÓN');
    assert.ok(roleCore.includes('Un cliente existente (EXISTING_CUSTOMER) también puede comprar (SALES).'), 'Cliente existente puede comprar');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B6 [Contrato]: "Mi pedido no llegó" => SOPORTE / STATUS (0 Venta)
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B6', 'Reclamo o retraso de entrega: Tratado como soporte/estado, prohibiendo venta', 'Contrato', async () => {
    assert.ok(roleCore.includes('3. SUPPORT_AND_AFTER_SALES: Inconvenientes con pedidos recibidos'), 'roleCore debe tipificar SUPPORT_AND_AFTER_SALES');
    assert.ok(globalGuardrails.includes('SOPORTE Y ESTADO ("Mi pedido no llegó"'), 'Guardrails debe cubrir reclamos de pedidos');
    assert.ok(globalGuardrails.includes('NO vendas.'), 'Debe prohibir expresamente la venta en reclamos');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B7 [Contrato]: "Quiero hablar con una persona" => HUMAN_REQUEST
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B7', 'Solicitud humana explícita preserva tool declaration de request_human_handoff', 'Contrato', async () => {
    assert.strictEqual(REQUEST_HUMAN_HANDOFF_DECLARATION.name, 'request_human_handoff');
    assert.ok(REQUEST_HUMAN_HANDOFF_DECLARATION.parameters.required.includes('reason'));
    assert.ok(roleCore.includes('7. HUMAN_REQUEST: Solicitud expresa de hablar con el dueño, profesor, asesor'), 'roleCore debe clasificar HUMAN_REQUEST');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B8 [Contrato]: "¿Puedo tener cita mañana a las 6?" sin agenda => NO Falsa Confirmación
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B8', 'Consulta de cita sin agenda integrada: Prohíbe afirmar falsamente confirmación', 'Contrato / Authority', async () => {
    assert.ok(roleCore.includes('[PROHIBICIÓN ABSOLUTA DE FALSA EJECUCIÓN (ANTI-ALUCINACIÓN OPERATIVA)]'), 'Debe incluir sección anti-falsa ejecución');
    assert.ok(roleCore.includes('ESTÁ TERMINANTEMENTE PROHIBIDO afirmar:'), 'Debe listar prohibiciones explícitas');
    assert.ok(roleCore.includes('"Ya quedó agendada la clase"') && roleCore.includes('"Ya confirmé tu cita"'), 'Prohíbe afirmar cita agendada');
    assert.ok(globalGuardrails.includes('SOLICITUD DE AGENDA ("¿Puedo tener clase mañana a las 6?"): Recuerda que no tienes integración de agenda activa'), 'Guardrail de agenda presente');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B9 [Estático / Arquitectura]: Capacidad futura de agenda no bloqueada
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B9', 'Arquitectura del Authority Model permite EXECUTE cuando exista tool autorizada', 'Estático / Arquitectura', async () => {
    assert.ok(roleCore.includes('2. EXECUTE (Ejecutar Acción Real): Solo puedes afirmar que una acción fue realizada si una herramienta autorizada la ejecutó con éxito.'), 'Debe definir nivel EXECUTE');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B10 [Contrato + Funcional]: "Sí, el Intensivo" => Preserva Ambiguous Yes Fix
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B10', 'Preservación de Ambiguous Yes: "Sí, el [producto]" es selección explícita', 'Contrato + Funcional', async () => {
    assert.ok(globalGuardrails.includes('RESPUESTAS CON CONTENIDO EXPLÍCITO'), 'Debe incluir RESPUESTAS CON CONTENIDO EXPLÍCITO');
    assert.ok(globalGuardrails.includes('selección explícita (no ambigua)'), 'Debe marcar como selección explícita');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B11 [Contrato]: "Muéstrame foto" => Product Media permanece
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B11', 'Preservación de Product Media: send_product_media tool declaration intacta', 'Contrato', async () => {
    assert.strictEqual(SEND_PRODUCT_MEDIA_DECLARATION.name, 'send_product_media');
    assert.ok(globalGuardrails.includes('Si dice "Sí, muéstrame la foto", llama a send_product_media'), 'Regla de invocación de media presente');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B12 [Integración Real]: SERVICE no genera shipping
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B12', 'Preservación de SERVICE: Ciudad no se almacena como dirección ni flete', 'Integración Real', async () => {
    const customerMock = { id: 'cust-b12', phone: '51999111222' };
    db.customers.set(customerMock.id, customerMock);

    const res = await syncCommercialOrder({
      tenant: tenantA,
      customer: customerMock,
      clientNumber: customerMock.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: serviceProd.id,
        shippingCity: 'Lima Cercado',
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });
    assert.strictEqual(res.success, true);
    const order = await db.order.findFirst({ where: { customerId: customerMock.id } });
    assert.strictEqual(order.shippingCity, null, 'shippingCity debe ser null para SERVICE');
    assert.strictEqual(order.shippingAddress, null, 'shippingAddress debe ser null para SERVICE');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B13 [Integración Real]: PHYSICAL_PRODUCT exige quantity y shipping
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B13', 'Preservación de PHYSICAL_PRODUCT: Exige cantidad válida para crear orden', 'Integración Real', async () => {
    const customerMock = { id: 'cust-b13', phone: '51999222333' };
    db.customers.set(customerMock.id, customerMock);

    const resWithoutQty = await syncCommercialOrder({
      tenant: tenantB,
      customer: customerMock,
      clientNumber: customerMock.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: physicalProd.id,
        shippingCity: 'Arequipa',
        paymentMethod: 'Plin'
        // quantity omitida
      },
      prismaClient: db
    });
    assert.strictEqual(resWithoutQty.success, true);
    assert.strictEqual(resWithoutQty.state.activeOrderId, undefined, 'No debe crear orden sin cantidad válida');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B14 [Integración Real]: "Ya pagué" => IA NUNCA marca PAID ni COMPLETED
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B14', 'Preservación de Payment Guards: "Ya pagué" marca PAYMENT_VERIFIED / VERIFYING pero NUNCA PAID', 'Integración Real', async () => {
    const customerMock = { id: 'cust-b14', phone: '51999333444' };
    db.customers.set(customerMock.id, customerMock);

    const res = await syncCommercialOrder({
      tenant: tenantA,
      customer: customerMock,
      clientNumber: customerMock.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_VERIFIED',
        customerConfirmed: true,
        productId: serviceProd.id,
        paymentMethod: 'Yape'
      },
      prismaClient: db
    });
    assert.strictEqual(res.success, true);
    const order = await db.order.findFirst({ where: { customerId: customerMock.id } });
    assert.strictEqual(order.paymentStatus, 'VERIFYING', 'paymentStatus debe ser VERIFYING');
    assert.notStrictEqual(order.paymentStatus, 'PAID', 'paymentStatus JAMÁS debe ser PAID');
    assert.strictEqual(order.status, 'PENDING', 'status de la orden debe ser PENDING');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B15 [Funcional Real]: Nuevo mensaje durante generación => Guard presente
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B15', 'Preservación de Commit 8b6e2ed: Versioning de generación por chat sigue operativo', 'Funcional Real', async () => {
    _resetChatGenerationVersionsForTesting();
    const key = 'tenant-a:chat-123';
    assert.strictEqual(getChatGenerationVersion(key), 0);
    const v1 = incrementChatGenerationVersion(key);
    assert.strictEqual(v1, 1);
    assert.strictEqual(getChatGenerationVersion(key), 1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B16 [Integración Real]: Human Handoff Tenant Isolation
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B16', 'Preservación de Tenant Isolation en Handoff: Pausa en Tenant A no afecta a Tenant B', 'Integración Real', async () => {
    const phone = '51999444555';
    const contactA = { id: 'contact-a', tenantId: tenantA.id, phone, botPaused: true };
    const contactB = { id: 'contact-b', tenantId: tenantB.id, phone, botPaused: false };
    db.contacts.set(contactA.id, contactA);
    db.contacts.set(contactB.id, contactB);

    const activeInA = await isHandoffActive({ tenantId: tenantA.id, contactId: contactA.id, phone, prismaClient: db });
    assert.strictEqual(activeInA, true, 'Tenant A debe estar pausado');

    const activeInB = await isHandoffActive({ tenantId: tenantB.id, contactId: contactB.id, phone, prismaClient: db });
    assert.strictEqual(activeInB, false, 'Tenant B debe estar activo');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B17 [Contrato]: Mensaje ambiguo => Pide aclaración sin forzar venta
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B17', 'Mensaje ambiguo sin contexto: Pide aclaración sin asumir compra o catálogo', 'Contrato', async () => {
    assert.ok(roleCore.includes('9. UNKNOWN: Mensajes ambiguos, incompletos o poco claros.'), 'roleCore debe clasificar UNKNOWN');
    assert.ok(globalGuardrails.includes('AMBIGÜEDAD ("Álgebra, por favor" sin contexto previo): Pide una breve aclaración amable'), 'Guardrails debe manejar ambigüedad');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B18 [Contrato + Funcional]: Cliente existente pregunta precio => SALES
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B18', 'Cliente existente que pregunta precio es atendido con cotización de ventas', 'Contrato + Funcional', async () => {
    assert.ok(roleCore.includes('Un cliente existente (EXISTING_CUSTOMER) también puede comprar (SALES).'), 'Regla explícita presente en roleCore');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B19 [Funcional Real]: Número nuevo ("Hola profe") => Cordial / 0 Venta
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B19', 'Contacto nuevo sin compras previas: Deriva UNKNOWN y no fuerza venta por número desconocido', 'Funcional Real', async () => {
    const derived = deriveCustomerRelationship({ orderCount: 0, currentStage: null, messageCount: 1 });
    assert.strictEqual(derived.relationship, 'UNKNOWN');
    assert.ok(roleCore.includes('NO fuerces ventas solo porque el número no tiene compras registradas'), 'Prohíbe forzar venta a números no registrados');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B20 [Funcional Real]: Dos tenants con configuraciones distintas
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B20', 'Multi-tenant: Derivación de relación e información institucional 100% aisladas', 'Funcional Real', async () => {
    const custA = { id: 'cust-ta-1', tenantId: tenantA.id };
    const custB = { id: 'cust-tb-1', tenantId: tenantB.id };

    // Tenant A tiene 1 orden
    await db.order.create({ data: { id: 'ord-1', customerId: custA.id, tenantId: tenantA.id, total: 100 } });

    // Consulta para Tenant A:
    const countA = await db.order.count({ where: { customerId: custA.id, tenantId: tenantA.id } });
    const relA = deriveCustomerRelationship({ orderCount: countA });
    assert.strictEqual(relA.relationship, 'EXISTING_CUSTOMER');

    // Consulta para Tenant B:
    const countB = await db.order.count({ where: { customerId: custB.id, tenantId: tenantB.id } });
    const relB = deriveCustomerRelationship({ orderCount: countB });
    assert.strictEqual(relB.relationship, 'UNKNOWN');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B21 [Contrato / Authority]: "Hoy Gustavito no va" => PROHIBIDO "ya lo registré"
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B21', 'Anti-Alucinación Operativa: PROHIBIDO afirmar "Ya lo registré en el sistema"', 'Contrato / Authority', async () => {
    assert.ok(roleCore.includes('Por lo tanto, ESTÁ TERMINANTEMENTE PROHIBIDO afirmar:'), 'Debe incluir cláusula restrictiva');
    assert.ok(roleCore.includes('"Ya lo registré en el sistema"'), 'Prohíbe "Ya lo registré en el sistema"');
    assert.ok(roleCore.includes('"Entendido, queda registrado aquí en el chat para que el profesor/equipo lo revise."'), 'Ofrece fórmula verídica alternativa');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B22 [Contrato / Authority]: "Agenda mañana a las 6" => PROHIBIDO "listo, agendado"
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B22', 'Anti-Alucinación Operativa: PROHIBIDO afirmar "Ya quedó agendada la clase"', 'Contrato / Authority', async () => {
    assert.ok(roleCore.includes('"Ya quedó agendada la clase"') || roleCore.includes('"Ya confirmé tu cita"'), 'Prohíbe falsa confirmación de cita');
    assert.ok(globalGuardrails.includes('no confirmes citas falsas y explica con amabilidad que el equipo o profesor deberá confirmar la disponibilidad'), 'Guardrail prohíbe cita falsa');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B23 [Contrato / Authority]: "El profesor dijo que me devuelve S/500" => No compromiso financiero
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B23', 'Authority Model: Prohíbe inventar compromisos financieros o acuerdos privados', 'Contrato / Authority', async () => {
    assert.ok(roleCore.includes('3. HUMAN_REQUIRED (Derivación o Espera Humana): Si se requiere una decisión fuera de tu alcance (evaluación pedagógica, acuerdos privados, autorizaciones especiales'), 'Exige HUMAN_REQUIRED ante acuerdos privados/especiales');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B24 [Funcional Real]: "Álgebra, por favor" con turno anterior sobre Gustavito
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B24', 'Historial conversacional conserva contexto operacional previo con buildChatContext', 'Funcional Real', async () => {
    const rawMsgs = [
      { senderRole: 'contact', content: 'Hoy le puedes enseñar a Gustavito.' },
      { senderRole: 'agent', content: 'Entendido, tomo nota de que hoy coordinan clase para Gustavito.' },
      { senderRole: 'contact', content: 'Álgebra, por favor.' }
    ];
    const ctx = buildChatContext(rawMsgs);
    assert.strictEqual(ctx.length, 3);
    assert.strictEqual(ctx[0].role, 'user');
    assert.ok(ctx[0].content.includes('Gustavito'));
    assert.strictEqual(ctx[1].role, 'model');
    assert.strictEqual(ctx[2].role, 'user');
    assert.ok(ctx[2].content.includes('Álgebra, por favor.'));
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B25 [Contrato]: "Álgebra, por favor" sin contexto previo => Aclaración razonable
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('B25', 'Turno aislado ambiguo: Pide aclaración sin asumir compra o catálogo forzado', 'Contrato', async () => {
    assert.ok(globalGuardrails.includes('AMBIGÜEDAD ("Álgebra, por favor" sin contexto previo): Pide una breve aclaración amable sobre a qué se refiere, sin asumir automáticamente una compra o matrícula.'), 'Regla explícita para "Álgebra, por favor" sin contexto previo');
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE B1–B25 FINALIZADA EXITOSAMENTE: ${passedTests}/${totalTests} TESTS PASARON`);
  console.log('======================================================================\n');
}

main().catch(err => {
  console.error('\n❌ ERROR EN SUITE B1–B25:\n', err);
  process.exit(1);
});
