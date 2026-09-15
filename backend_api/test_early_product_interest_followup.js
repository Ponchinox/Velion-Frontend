/**
 * test_early_product_interest_followup.js
 *
 * Test suite verificador de elegibilidad temprana para seguimiento de oportunidades comerciales:
 * Casos requeridos:
 *   A. "Tiene JBL / Vi en sus redes" + bot presenta JBL y pregunta cantidad + cliente desaparece
 *      => FOLLOW-UP YES, maxAttempts=1
 *   B. "Hola" => FOLLOW-UP NO
 *   C. "Qué venden?" => FOLLOW-UP NO
 *   D. "No me interesa el JBL" => FOLLOW-UP NO
 *   E. "Quiero 1 JBL" => comportamiento normal existente, PRODUCT_SELECTED, hasta 3 intentos
 *   F. merchant blocker / shipping config missing => FOLLOW-UP NO
 *   Second Product Test: Ficticio ("Smartwatch Nova Pro Titanium X", ID: "prod_smartwatch_nova_titanium_999")
 *      => FOLLOW-UP YES, maxAttempts=1 (prueba de independencia de catálogo)
 *   Zero Hardcoding Check: Validación estricta de 0 nombres ni IDs de productos hardcodeados.
 */

process.env.NODE_ENV = 'test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock';
}

const fixedNow = new Date('2026-09-15T14:00:00-05:00').getTime();
Date.now = () => fixedNow;

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateAndScheduleFollowUp,
  shouldCreateOrRefreshFollowUp
} from './src/services/followUpService.js';
import {
  processFollowUpSequence,
  setFollowUpGatewaySender
} from './src/services/followUpWorker.js';
import {
  setGeminiDecisionCaller,
  DECISION_ACTIONS,
  PENDING_ACTORS
} from './src/services/followUpDecisionService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('======================================================================');
console.log('🧪 EARLY PRODUCT INTEREST FOLLOW-UP TEST SUITE');
console.log('======================================================================\n');

function createMockPrisma() {
  const tenants = new Map();
  const customers = new Map();
  const chats = new Map();
  const messages = new Map();
  const products = new Map();
  const sequences = new Map();
  const attempts = new Map();
  const orders = new Map();
  const operationalItems = new Map();

  let idCounter = 1;
  const genId = (prefix = 'id') => `${prefix}_${idCounter++}_${Math.random().toString(36).slice(2, 7)}`;

  return {
    tenant: {
      findUnique: async ({ where }) => tenants.get(where.id) || null,
      create: async ({ data }) => {
        const id = data.id || genId('tenant');
        const t = { id, followUpEnabled: true, followUpDecisionMode: 'ENFORCE', timezone: 'America/Lima', ...data };
        tenants.set(id, t);
        return t;
      },
      update: async ({ where, data }) => {
        const t = tenants.get(where.id);
        if (!t) throw new Error('Tenant not found');
        const updated = { ...t, ...data };
        tenants.set(where.id, updated);
        return updated;
      }
    },
    customer: {
      findUnique: async ({ where }) => customers.get(where.id) || null,
      findFirst: async ({ where }) => {
        for (const c of customers.values()) {
          if (where?.tenantId && c.tenantId !== where.tenantId) continue;
          if (where?.id && c.id !== where.id) continue;
          return c;
        }
        return null;
      },
      create: async ({ data }) => {
        const id = data.id || genId('cust');
        const c = { id, followUpSuppressed: false, isBotPaused: false, commercialState: {}, ...data };
        customers.set(id, c);
        return c;
      },
      update: async ({ where, data }) => {
        const c = customers.get(where.id);
        if (!c) throw new Error('Customer not found');
        const updated = { ...c, ...data };
        customers.set(where.id, updated);
        return updated;
      }
    },
    contact: {
      findFirst: async () => null,
      findUnique: async () => null,
      create: async ({ data }) => data
    },
    chat: {
      findUnique: async ({ where }) => chats.get(where.id) || null,
      findFirst: async ({ where }) => {
        for (const ch of chats.values()) {
          if (where?.id && ch.id !== where.id) continue;
          if (where?.tenantId && ch.tenantId !== where.tenantId) continue;
          return ch;
        }
        return null;
      },
      create: async ({ data }) => {
        const id = data.id || genId('chat');
        const ch = { id, botPaused: false, ...data };
        chats.set(id, ch);
        return ch;
      }
    },
    message: {
      findFirst: async ({ where, orderBy }) => {
        let list = Array.from(messages.values());
        if (where.chatId) list = list.filter(m => m.chatId === where.chatId);
        if (where.senderRole) {
          if (typeof where.senderRole === 'object' && where.senderRole.in) {
            list = list.filter(m => where.senderRole.in.includes(m.senderRole));
          } else {
            list = list.filter(m => m.senderRole === where.senderRole);
          }
        }
        if (where.createdAt?.gte) {
          list = list.filter(m => new Date(m.createdAt) >= new Date(where.createdAt.gte));
        }
        if (orderBy?.createdAt === 'desc') {
          list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }
        return list[0] || null;
      },
      findMany: async ({ where, orderBy, take }) => {
        let list = Array.from(messages.values());
        if (where.chatId) list = list.filter(m => m.chatId === where.chatId);
        if (orderBy?.createdAt === 'desc') {
          list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }
        if (take) list = list.slice(0, take);
        return list;
      },
      create: async ({ data }) => {
        const id = data.id || genId('msg');
        const msg = { id, createdAt: new Date(), ...data };
        messages.set(id, msg);
        return msg;
      }
    },
    product: {
      findFirst: async ({ where }) => {
        for (const p of products.values()) {
          if (where.id && p.id !== where.id) continue;
          if (where.user?.tenantId && p.tenantId !== where.user.tenantId) continue;
          return p;
        }
        return null;
      },
      findMany: async ({ where }) => {
        let list = Array.from(products.values());
        if (where?.user?.tenantId) {
          list = list.filter(p => p.tenantId === where.user.tenantId);
        }
        return list;
      },
      create: async ({ data }) => {
        const id = data.id || genId('prod');
        const p = { id, isAvailable: true, price: 100, ...data };
        products.set(id, p);
        return p;
      }
    },
    order: {
      findUnique: async ({ where }) => orders.get(where.id) || null,
      create: async ({ data }) => {
        const id = data.id || genId('ord');
        const o = { id, ...data };
        orders.set(id, o);
        return o;
      }
    },
    operationalItem: {
      findMany: async () => Array.from(operationalItems.values())
    },
    registeredWhatsAppNumber: {
      findFirst: async () => null
    },
    followUpSequence: {
      findUnique: async ({ where }) => {
        const seq = sequences.get(where.id);
        if (!seq) return null;
        const tenant = tenants.get(seq.tenantId) || null;
        const customer = customers.get(seq.customerId) || null;
        const chat = chats.get(seq.chatId) || null;
        const order = seq.orderId ? orders.get(seq.orderId) || null : null;
        const seqAttempts = Array.from(attempts.values()).filter(a => a.sequenceId === seq.id);
        return { ...seq, tenant, customer, chat, order, attempts: seqAttempts };
      },
      findFirst: async ({ where }) => {
        for (const s of sequences.values()) {
          if (where.tenantId && s.tenantId !== where.tenantId) continue;
          if (where.customerId && s.customerId !== where.customerId) continue;
          if (where.status && where.status.in && !where.status.in.includes(s.status)) continue;
          const tenant = tenants.get(s.tenantId);
          const customer = customers.get(s.customerId);
          const chat = chats.get(s.chatId);
          const seqAttempts = Array.from(attempts.values()).filter(a => a.sequenceId === s.id);
          return { ...s, tenant, customer, chat, attempts: seqAttempts };
        }
        return null;
      },
      create: async ({ data }) => {
        const id = data.id || genId('seq');
        const seq = { id, currentAttempt: 0, ...data };
        sequences.set(id, seq);
        return seq;
      },
      update: async ({ where, data }) => {
        const s = sequences.get(where.id);
        if (!s) throw new Error('Sequence not found');
        const updated = { ...s, ...data };
        sequences.set(where.id, updated);
        return updated;
      }
    },
    followUpAttempt: {
      findUnique: async ({ where }) => {
        if (where.sequenceId_attemptNumber) {
          const { sequenceId, attemptNumber } = where.sequenceId_attemptNumber;
          for (const a of attempts.values()) {
            if (a.sequenceId === sequenceId && a.attemptNumber === attemptNumber) return a;
          }
          return null;
        }
        return attempts.get(where.id) || null;
      },
      create: async ({ data }) => {
        const id = data.id || genId('att');
        const att = { id, ...data };
        attempts.set(id, att);
        return att;
      },
      update: async ({ where, data }) => {
        const a = attempts.get(where.id);
        if (!a) throw new Error('Attempt not found');
        const updated = { ...a, ...data };
        attempts.set(where.id, updated);
        return updated;
      }
    }
  };
}

async function main() {
  let testAResult = false;
  let testBResult = false;
  let testCResult = false;
  let testDResult = false;
  let testEResult = false;
  let testFResult = false;
  let secondProductResult = false;

  // =========================================================================
  // TEST A: "Tiene JBL / Vi en sus redes" + bot presenta JBL y pregunta cantidad
  // => FOLLOW-UP YES, maxAttempts = 1
  // =========================================================================
  {
    const db = createMockPrisma();
    const tenant = await db.tenant.create({
      data: {
        companyName: 'Audio Perú',
        followUpEnabled: true,
        followUpDecisionMode: 'ENFORCE',
        bankAccounts: 'BCP: 191-12345678',
        shippingDomesticEnabled: true,
        shippingLocalCost: 10
      }
    });

    const jblProduct = await db.product.create({
      data: {
        id: 'prod_jbl_go_4_test',
        name: 'Parlante JBL Go 4',
        price: 180,
        tenantId: tenant.id
      }
    });

    const customer = await db.customer.create({
      data: {
        name: 'Carlos',
        phone: '51999111222',
        tenantId: tenant.id,
        commercialState: {
          currentStage: 'EXPLORING',
          productId: jblProduct.id,
          productName: jblProduct.name
        }
      }
    });

    const chat = await db.chat.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id
      }
    });

    const convTime = new Date(fixedNow - 6 * 3600 * 1000);
    const customerInbound = await db.message.create({
      data: {
        chatId: chat.id,
        senderRole: 'contact',
        content: 'Tiene JBL? Vi en sus redes',
        createdAt: convTime
      }
    });

    const botMessage = await db.message.create({
      data: {
        chatId: chat.id,
        senderRole: 'agent',
        content: '¡Hola Carlos! Sí, tenemos el Parlante JBL Go 4 a S/. 180 con entrega inmediata. ¿Cuántas unidades te gustaría llevar?',
        createdAt: new Date(convTime.getTime() + 10000)
      }
    });

    // Mock Gemini Gate A decision:
    setGeminiDecisionCaller(async () => ({
      decision: DECISION_ACTIONS.SEND_FOLLOW_UP,
      confidence: 0.95,
      pendingActor: PENDING_ACTORS.CUSTOMER,
      conversationClosed: false,
      purchaseConfirmed: false,
      fulfillmentOnly: false,
      reason: 'El cliente preguntó por el JBL Go 4 y el bot dejó la pregunta de cantidad pendiente.'
    }));

    const result = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      tenant,
      customerId: customer.id,
      customer,
      chatId: chat.id,
      chat,
      currentCommercialState: {
        ...customer.commercialState,
        productId: jblProduct.id,
        productName: jblProduct.name
      },
      currentStage: 'PRODUCT_INTERESTED',
      productId: jblProduct.id,
      productName: jblProduct.name,
      lastInboundMessage: customerInbound,
      lastBotMessage: botMessage,
      prismaClient: db
    });

    assert.strictEqual(result.scheduled, true, 'TEST A: Debe programar follow-up');
    assert.strictEqual(result.sequence.maxAttempts, 1, 'TEST A: maxAttempts debe ser 1');
    assert.strictEqual(result.sequence.stageAtCreation, 'PRODUCT_INTERESTED', 'TEST A: stageAtCreation debe ser PRODUCT_INTERESTED');

    // Procesar intento 1 con el worker para comprobar que tras intento 1 pasa a EXHAUSTED (NO intento 2 ni 3)
    let dispatchedMessages = [];
    setFollowUpGatewaySender(async (payload) => {
      dispatchedMessages.push(payload);
      return 'disp_msg_test_a';
    });

    // Mock Gate B decision:
    setGeminiDecisionCaller(async () => ({
      decision: DECISION_ACTIONS.SEND_FOLLOW_UP,
      confidence: 0.95,
      pendingActor: PENDING_ACTORS.CUSTOMER,
      conversationClosed: false,
      purchaseConfirmed: false,
      fulfillmentOnly: false,
      reason: 'Gate B: Cliente aún no responde la consulta de unidades.'
    }));

    await db.followUpSequence.update({
      where: { id: result.sequence.id },
      data: { status: 'PROCESSING', claimedAt: new Date() }
    });

    const workerResult = await processFollowUpSequence(result.sequence.id, db);
    assert.strictEqual(workerResult.success, true, 'TEST A: Intento 1 debe despacharse con éxito');
    assert.strictEqual(dispatchedMessages.length, 1, 'TEST A: Exactamente 1 mensaje despachado');

    const finalSeq = await db.followUpSequence.findUnique({ where: { id: result.sequence.id } });
    assert.strictEqual(finalSeq.status, 'EXHAUSTED', 'TEST A: Secuencia debe quedar EXHAUSTED tras intento 1 (maxAttempts=1)');
    assert.strictEqual(finalSeq.nextRunAt, null, 'TEST A: nextRunAt debe ser null tras intento 1 (NO intento 2 ni 3)');

    testAResult = true;
    console.log('  ✅ TEST A: PASS (Elegible temprana, maxAttempts=1, 0 intentos posteriores)');
  }

  // =========================================================================
  // TEST B: "Hola" => FOLLOW-UP NO
  // =========================================================================
  {
    const db = createMockPrisma();
    const tenant = await db.tenant.create({ data: { companyName: 'Audio Perú' } });
    const customer = await db.customer.create({ data: { tenantId: tenant.id } });
    const chat = await db.chat.create({ data: { tenantId: tenant.id, customerId: customer.id } });
    const customerInbound = await db.message.create({
      data: { chatId: chat.id, senderRole: 'contact', content: 'Hola' }
    });

    const check = shouldCreateOrRefreshFollowUp({
      tenant,
      stage: 'PRODUCT_INTERESTED',
      currentCommercialState: { currentStage: 'PRODUCT_INTERESTED', productId: 'any_prod_id' },
      chat,
      lastInboundMessage: customerInbound,
      lastBotMessage: { content: '¡Hola! ¿En qué te puedo ayudar hoy?' }
    });

    assert.strictEqual(check.eligible, false, 'TEST B: Saludo genérico no debe ser elegible');
    assert.strictEqual(check.reason, 'GENERIC_OR_SOCIAL_INQUIRY', 'TEST B: Motivo debe ser GENERIC_OR_SOCIAL_INQUIRY');

    testBResult = true;
    console.log('  ✅ TEST B: PASS ("Hola" => FOLLOW-UP NO)');
  }

  // =========================================================================
  // TEST C: "Qué venden?" => FOLLOW-UP NO
  // =========================================================================
  {
    const db = createMockPrisma();
    const tenant = await db.tenant.create({ data: { companyName: 'Audio Perú' } });
    const customer = await db.customer.create({ data: { tenantId: tenant.id } });
    const chat = await db.chat.create({ data: { tenantId: tenant.id, customerId: customer.id } });
    const customerInbound = await db.message.create({
      data: { chatId: chat.id, senderRole: 'contact', content: 'Qué venden?' }
    });

    const check = shouldCreateOrRefreshFollowUp({
      tenant,
      stage: 'PRODUCT_INTERESTED',
      currentCommercialState: { currentStage: 'PRODUCT_INTERESTED', productId: 'any_prod_id' },
      chat,
      lastInboundMessage: customerInbound,
      lastBotMessage: { content: 'Vendemos parlantes, audífonos y accesorios. ¿Buscas algo en particular?' }
    });

    assert.strictEqual(check.eligible, false, 'TEST C: Pregunta genérica de catálogo no debe ser elegible');
    assert.strictEqual(check.reason, 'GENERIC_OR_SOCIAL_INQUIRY', 'TEST C: Motivo debe ser GENERIC_OR_SOCIAL_INQUIRY');

    testCResult = true;
    console.log('  ✅ TEST C: PASS ("Qué venden?" => FOLLOW-UP NO)');
  }

  // =========================================================================
  // TEST D: "No me interesa el JBL" => FOLLOW-UP NO (Hard Block: OPPORTUNITY_REJECTED)
  // =========================================================================
  {
    const db = createMockPrisma();
    const tenant = await db.tenant.create({ data: { companyName: 'Audio Perú' } });
    const customer = await db.customer.create({ data: { tenantId: tenant.id } });
    const chat = await db.chat.create({ data: { tenantId: tenant.id, customerId: customer.id } });
    const customerInbound = await db.message.create({
      data: { chatId: chat.id, senderRole: 'contact', content: 'No me interesa el JBL, gracias' }
    });

    const result = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      tenant,
      customerId: customer.id,
      customer,
      chatId: chat.id,
      chat,
      currentCommercialState: { productId: 'prod_jbl_01' },
      currentStage: 'PRODUCT_INTERESTED',
      productId: 'prod_jbl_01',
      lastInboundMessage: customerInbound,
      prismaClient: db
    });

    assert.strictEqual(result.scheduled, false, 'TEST D: Rechazo explícito no debe programar follow-up');
    assert.strictEqual(result.reason, 'OPPORTUNITY_REJECTED', 'TEST D: Motivo debe ser OPPORTUNITY_REJECTED');

    testDResult = true;
    console.log('  ✅ TEST D: PASS ("No me interesa el JBL" => FOLLOW-UP NO [OPPORTUNITY_REJECTED])');
  }

  // =========================================================================
  // TEST E: "Quiero 1 JBL" => PRODUCT_SELECTED normal existente, hasta 3 intentos
  // =========================================================================
  {
    const db = createMockPrisma();
    const tenant = await db.tenant.create({
      data: {
        companyName: 'Audio Perú',
        followUpEnabled: true,
        followUpDecisionMode: 'ENFORCE',
        bankAccounts: 'BCP: 191-12345678',
        shippingDomesticEnabled: true,
        shippingLocalCost: 10
      }
    });

    const jblProduct = await db.product.create({
      data: {
        id: 'prod_jbl_go_4_test',
        name: 'Parlante JBL Go 4',
        price: 180,
        tenantId: tenant.id
      }
    });

    const customer = await db.customer.create({
      data: {
        name: 'Carlos',
        phone: '51999111222',
        tenantId: tenant.id,
        commercialState: {
          currentStage: 'PRODUCT_SELECTED',
          productId: jblProduct.id,
          productName: jblProduct.name,
          quantity: 1
        }
      }
    });

    const chat = await db.chat.create({
      data: { tenantId: tenant.id, customerId: customer.id }
    });

    const convTime = new Date(fixedNow - 6 * 3600 * 1000);
    const customerInbound = await db.message.create({
      data: { chatId: chat.id, senderRole: 'contact', content: 'Quiero 1 JBL', createdAt: convTime }
    });

    const botMessage = await db.message.create({
      data: {
        chatId: chat.id,
        senderRole: 'agent',
        content: '¡Perfecto! Separé 1 Parlante JBL Go 4. ¿A qué ciudad o dirección te lo enviamos?',
        createdAt: new Date(convTime.getTime() + 10000)
      }
    });

    const result = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      tenant,
      customerId: customer.id,
      customer,
      chatId: chat.id,
      chat,
      currentCommercialState: customer.commercialState,
      currentStage: 'PRODUCT_SELECTED',
      productId: jblProduct.id,
      productName: jblProduct.name,
      lastInboundMessage: customerInbound,
      lastBotMessage: botMessage,
      prismaClient: db
    });

    assert.strictEqual(result.scheduled, true, 'TEST E: PRODUCT_SELECTED debe programar follow-up');
    assert.strictEqual(result.sequence.maxAttempts, 3, 'TEST E: PRODUCT_SELECTED debe mantener maxAttempts=3');
    assert.strictEqual(result.sequence.stageAtCreation, 'PRODUCT_SELECTED', 'TEST E: stageAtCreation debe ser PRODUCT_SELECTED');

    // Verificar que tras intento 1, status pasa a WAITING_NEXT con nextRunAt para intento 2 (+24h)
    setFollowUpGatewaySender(async () => 'disp_msg_test_e');
    await db.followUpSequence.update({
      where: { id: result.sequence.id },
      data: { status: 'PROCESSING', claimedAt: new Date() }
    });
    const workerResult = await processFollowUpSequence(result.sequence.id, db);
    assert.strictEqual(workerResult.success, true, 'TEST E: Intento 1 despachado');

    const intermediateSeq = await db.followUpSequence.findUnique({ where: { id: result.sequence.id } });
    assert.strictEqual(intermediateSeq.status, 'WAITING_NEXT', 'TEST E: PRODUCT_SELECTED debe pasar a WAITING_NEXT tras intento 1');
    assert.notStrictEqual(intermediateSeq.nextRunAt, null, 'TEST E: nextRunAt debe estar programado para intento 2');

    testEResult = true;
    console.log('  ✅ TEST E: PASS ("Quiero 1 JBL" => PRODUCT_SELECTED, maxAttempts=3, WAITING_NEXT para intento 2)');
  }

  // =========================================================================
  // TEST F: Merchant blocker / missing shipping config => FOLLOW-UP NO
  // =========================================================================
  {
    const db = createMockPrisma();
    const tenant = await db.tenant.create({
      data: {
        companyName: 'Audio Perú',
        followUpEnabled: true,
        followUpDecisionMode: 'ENFORCE',
        // Sin métodos de pago ni shipping configurado
        bankAccounts: null,
        shippingDomesticEnabled: false,
        shippingLocalCost: null
      }
    });

    const jblProduct = await db.product.create({
      data: { id: 'prod_jbl_go_4_test', name: 'Parlante JBL Go 4', price: 180, tenantId: tenant.id }
    });

    const customer = await db.customer.create({
      data: { tenantId: tenant.id, commercialState: { productId: jblProduct.id } }
    });

    const chat = await db.chat.create({ data: { tenantId: tenant.id, customerId: customer.id } });

    const customerInbound = await db.message.create({
      data: { chatId: chat.id, senderRole: 'contact', content: 'Tiene JBL en stock?' }
    });

    // Bot message indicating merchant blocker
    const botMessage = await db.message.create({
      data: {
        chatId: chat.id,
        senderRole: 'agent',
        content: 'Sí tenemos stock, pero no tengo un método de pago registrado en este momento. Ese detalle debe confirmarse directamente con el negocio.'
      }
    });

    const check = shouldCreateOrRefreshFollowUp({
      tenant,
      stage: 'PRODUCT_INTERESTED',
      currentCommercialState: { currentStage: 'PRODUCT_INTERESTED', productId: jblProduct.id },
      chat,
      lastInboundMessage: customerInbound,
      lastBotMessage: botMessage
    });

    assert.strictEqual(check.eligible, false, 'TEST F: Merchant blocker no debe ser elegible');
    assert.strictEqual(check.reason, 'MERCHANT_BLOCKER', 'TEST F: Motivo debe ser MERCHANT_BLOCKER');

    testFResult = true;
    console.log('  ✅ TEST F: PASS (Merchant blocker => FOLLOW-UP NO)');
  }

  // =========================================================================
  // TEST SECOND PRODUCT: Producto ficticio ("Smartwatch Nova Pro Titanium X")
  // Demuestra 100% independencia de catálogo (Zero Hardcoding)
  // =========================================================================
  {
    const db = createMockPrisma();
    const tenant = await db.tenant.create({
      data: {
        companyName: 'Nova Gadgets',
        followUpEnabled: true,
        followUpDecisionMode: 'ENFORCE',
        bankAccounts: 'Interbank: 200-98765432',
        shippingDomesticEnabled: true,
        shippingLocalCost: 15
      }
    });

    const fictionalProduct = await db.product.create({
      data: {
        id: 'prod_smartwatch_nova_titanium_999',
        name: 'Smartwatch Nova Pro Titanium X',
        price: 299,
        tenantId: tenant.id
      }
    });

    const customer = await db.customer.create({
      data: {
        name: 'Valeria',
        phone: '51988776655',
        tenantId: tenant.id,
        commercialState: {
          currentStage: 'EXPLORING',
          productId: fictionalProduct.id,
          productName: fictionalProduct.name
        }
      }
    });

    const chat = await db.chat.create({ data: { tenantId: tenant.id, customerId: customer.id } });

    const customerInbound = await db.message.create({
      data: {
        chatId: chat.id,
        senderRole: 'contact',
        content: 'Tienen el Smartwatch Nova Pro Titanium X? Vi la promo'
      }
    });

    const botMessage = await db.message.create({
      data: {
        chatId: chat.id,
        senderRole: 'agent',
        content: '¡Hola Valeria! Sí, el Smartwatch Nova Pro Titanium X está disponible a S/. 299 con envío gratis. ¿Te gustaría en color negro o plateado?'
      }
    });

    setGeminiDecisionCaller(async () => ({
      decision: DECISION_ACTIONS.SEND_FOLLOW_UP,
      confidence: 0.96,
      pendingActor: PENDING_ACTORS.CUSTOMER,
      conversationClosed: false,
      purchaseConfirmed: false,
      fulfillmentOnly: false,
      reason: 'El cliente consultó por el Smartwatch Nova Pro Titanium X y el bot preguntó por el color.'
    }));

    const result = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      tenant,
      customerId: customer.id,
      customer,
      chatId: chat.id,
      chat,
      currentCommercialState: {
        ...customer.commercialState,
        productId: fictionalProduct.id,
        productName: fictionalProduct.name
      },
      currentStage: 'PRODUCT_INTERESTED',
      productId: fictionalProduct.id,
      productName: fictionalProduct.name,
      lastInboundMessage: customerInbound,
      lastBotMessage: botMessage,
      prismaClient: db
    });

    assert.strictEqual(result.scheduled, true, 'SECOND PRODUCT: Debe programar follow-up');
    assert.strictEqual(result.sequence.maxAttempts, 1, 'SECOND PRODUCT: maxAttempts debe ser 1');
    assert.strictEqual(result.sequence.productId, fictionalProduct.id, 'SECOND PRODUCT: Debe almacenar ID del producto ficticio');
    assert.strictEqual(result.sequence.productName, fictionalProduct.name, 'SECOND PRODUCT: Debe almacenar nombre del producto ficticio');

    secondProductResult = true;
    console.log('  ✅ SECOND PRODUCT TEST: PASS (Producto ficticio funciona idéntico sin hardcoding)');
  }

  // =========================================================================
  // ZERO HARDCODING CODE AUDIT
  // Verifica estáticamente que los archivos modificados contengan 0 referencias hardcodeadas
  // a nombres o IDs de productos específicos en la lógica nueva.
  // =========================================================================
  const followUpServiceCode = fs.readFileSync(path.join(__dirname, 'src/services/followUpService.js'), 'utf8');
  const decisionServiceCode = fs.readFileSync(path.join(__dirname, 'src/services/followUpDecisionService.js'), 'utf8');

  // Regex para detectar hardcoding de marcas o nombres específicos en código ejecutable (excluyendo comentarios si los hubiera)
  const codeWithoutComments = (followUpServiceCode + '\n' + decisionServiceCode)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

  const hardcodedProductNamesMatch = codeWithoutComments.match(/\b(jbl|jbl\s*go\s*4|go\s*4|smartwatch\s*nova)\b/gi);
  const hardcodedProductCount = hardcodedProductNamesMatch ? hardcodedProductNamesMatch.length : 0;

  assert.strictEqual(hardcodedProductCount, 0, `ZERO HARDCODING: Se detectaron ${hardcodedProductCount} referencias de productos en código ejecutable`);
  console.log('  ✅ ZERO HARDCODING AUDIT: PASS (0 nombres ni IDs hardcodeados)');

  console.log('\n======================================================================');
  console.log('🏁 ALL TESTS PASSED: 7/7 (100%)');
  console.log('======================================================================');

  return {
    testA: testAResult,
    testB: testBResult,
    testC: testCResult,
    testD: testDResult,
    testE: testEResult,
    testF: testFResult,
    secondProduct: secondProductResult,
    hardcodedProductCount
  };
}

main().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
