/**
 * test_follow_up_stale_product_switch.js
 *
 * Test suite dirigido para validar la corrección de:
 *   - Stale commercial state entre sesiones (Caso 1)
 *   - Superseding atómico de secuencias activas ante cambio de producto (Caso 2)
 *   - Hard guard pre-dispatch determinista en worker (incluso con decisionMode=OFF)
 *   - Respeto de temporal freshness (Test I)
 *   - Aislamiento cross-tenant (Test H)
 */

process.env.NODE_ENV = 'test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock';
}

const fixedNow = new Date('2026-09-16T14:00:00-05:00').getTime();
Date.now = () => fixedNow;

import assert from 'node:assert';
import {
  evaluateAndScheduleFollowUp,
  shouldCreateOrRefreshFollowUp
} from './src/services/followUpService.js';
import {
  processFollowUpSequence,
  setFollowUpGatewaySender
} from './src/services/followUpWorker.js';
import {
  setGeminiDecisionCaller
} from './src/services/followUpDecisionService.js';

console.log('======================================================================');
console.log('🧪 FOLLOW-UP STALE PRODUCT / PRODUCT SWITCH TEST SUITE');
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

  let idCounter = 1;
  const genId = (prefix = 'id') => `${prefix}_${idCounter++}_${Math.random().toString(36).slice(2, 7)}`;

  return {
    tenant: {
      findUnique: async ({ where }) => tenants.get(where.id) || null,
      create: async ({ data }) => {
        const id = data.id || genId('tenant');
        const t = { id, followUpEnabled: true, followUpDecisionMode: 'OFF', timezone: 'America/Lima', ...data };
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
        const all = Array.from(messages.values()).filter(m => {
          if (where?.chatId && m.chatId !== where.chatId) return false;
          if (where?.tenantId && m.tenantId !== where.tenantId) return false;
          if (where?.senderRole?.in && !where.senderRole.in.includes(m.senderRole)) return false;
          return true;
        });
        if (orderBy?.createdAt === 'desc') {
          all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        } else {
          all.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        }
        return all[0] || null;
      },
      findMany: async ({ where, orderBy, take }) => {
        let all = Array.from(messages.values()).filter(m => {
          if (where?.chatId && m.chatId !== where.chatId) return false;
          return true;
        });
        if (orderBy?.createdAt === 'desc') {
          all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        } else {
          all.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        }
        if (take) all = all.slice(0, take);
        return all;
      },
      create: async ({ data }) => {
        const id = data.id || genId('msg');
        const m = { id, createdAt: new Date(), ...data };
        messages.set(id, m);
        return m;
      }
    },
    product: {
      findFirst: async ({ where }) => {
        for (const p of products.values()) {
          if (where?.id && p.id !== where.id) continue;
          if (where?.user?.tenantId && p.tenantId !== where.user.tenantId) continue;
          if (where?.isAvailable !== undefined && p.isAvailable !== where.isAvailable) continue;
          return p;
        }
        return null;
      },
      findMany: async ({ where }) => {
        const res = [];
        for (const p of products.values()) {
          if (where?.user?.tenantId && p.tenantId !== where.user.tenantId) continue;
          res.push(p);
        }
        return res;
      },
      create: async ({ data }) => {
        const id = data.id || genId('prod');
        const p = { id, isAvailable: true, price: 50, ...data };
        products.set(id, p);
        return p;
      }
    },
    followUpSequence: {
      findUnique: async ({ where, include }) => {
        const s = sequences.get(where.id);
        if (!s) return null;
        const res = { ...s };
        if (include?.tenant) res.tenant = tenants.get(s.tenantId);
        if (include?.customer) res.customer = customers.get(s.customerId);
        if (include?.chat) res.chat = chats.get(s.chatId);
        if (include?.order) res.order = orders.get(s.orderId);
        if (include?.attempts) {
          res.attempts = Array.from(attempts.values()).filter(a => a.sequenceId === s.id);
        }
        return res;
      },
      findFirst: async ({ where }) => {
        for (const s of sequences.values()) {
          if (where?.tenantId && s.tenantId !== where.tenantId) continue;
          if (where?.customerId && s.customerId !== where.customerId) continue;
          if (where?.status?.in && !where.status.in.includes(s.status)) continue;
          if (where?.status && typeof where.status === 'string' && s.status !== where.status) continue;
          return s;
        }
        return null;
      },
      findMany: async ({ where }) => {
        const res = [];
        for (const s of sequences.values()) {
          if (where?.tenantId && s.tenantId !== where.tenantId) continue;
          if (where?.customerId && s.customerId !== where.customerId) continue;
          if (where?.status?.in && !where.status.in.includes(s.status)) continue;
          res.push(s);
        }
        return res;
      },
      create: async ({ data }) => {
        const id = data.id || genId('seq');
        const s = {
          id,
          status: 'SCHEDULED',
          currentAttempt: 0,
          maxAttempts: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data
        };
        sequences.set(id, s);
        return s;
      },
      update: async ({ where, data }) => {
        const s = sequences.get(where.id);
        if (!s) throw new Error('Sequence not found');
        const updated = { ...s, ...data, updatedAt: new Date() };
        sequences.set(where.id, updated);
        return updated;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const s of sequences.values()) {
          if (where?.tenantId && s.tenantId !== where.tenantId) continue;
          if (where?.customerId && s.customerId !== where.customerId) continue;
          if (where?.status?.in && !where.status.in.includes(s.status)) continue;
          const updated = { ...s, ...data, updatedAt: new Date() };
          sequences.set(s.id, updated);
          count++;
        }
        return { count };
      }
    },
    followUpAttempt: {
      findUnique: async ({ where }) => {
        if (where?.sequenceId_attemptNumber) {
          const key = `${where.sequenceId_attemptNumber.sequenceId}_${where.sequenceId_attemptNumber.attemptNumber}`;
          for (const a of attempts.values()) {
            if (`${a.sequenceId}_${a.attemptNumber}` === key) return a;
          }
          return null;
        }
        return attempts.get(where.id) || null;
      },
      findFirst: async ({ where, orderBy }) => {
        const all = Array.from(attempts.values()).filter(a => {
          if (where?.sequenceId && a.sequenceId !== where.sequenceId) return false;
          if (where?.status && a.status !== where.status) return false;
          return true;
        });
        if (orderBy?.sentAt === 'desc') {
          all.sort((a, b) => new Date(b.sentAt || 0).getTime() - new Date(a.sentAt || 0).getTime());
        }
        return all[0] || null;
      },
      create: async ({ data }) => {
        const id = data.id || genId('att');
        const a = { id, status: 'PENDING', createdAt: new Date(), ...data };
        attempts.set(id, a);
        return a;
      },
      update: async ({ where, data }) => {
        const a = attempts.get(where.id);
        if (!a) throw new Error('Attempt not found');
        const updated = { ...a, ...data, updatedAt: new Date() };
        attempts.set(where.id, updated);
        return updated;
      },
      upsert: async ({ where, create, update }) => {
        let existing = null;
        if (where?.sequenceId_attemptNumber) {
          const key = `${where.sequenceId_attemptNumber.sequenceId}_${where.sequenceId_attemptNumber.attemptNumber}`;
          for (const a of attempts.values()) {
            if (`${a.sequenceId}_${a.attemptNumber}` === key) { existing = a; break; }
          }
        }
        if (existing) {
          const updated = { ...existing, ...update, updatedAt: new Date() };
          attempts.set(existing.id, updated);
          return updated;
        }
        const id = genId('att');
        const created = { id, ...create, createdAt: new Date() };
        attempts.set(id, created);
        return created;
      }
    },
    order: {
      findUnique: async ({ where }) => orders.get(where.id) || null,
      create: async ({ data }) => {
        const id = data.id || genId('ord');
        const o = { id, status: 'PENDING', paymentStatus: 'UNPAID', ...data };
        orders.set(id, o);
        return o;
      }
    },
    systemConfig: {
      findUnique: async () => null
    },
    registeredWhatsAppNumber: {
      findFirst: async () => null
    },
    _stores: { tenants, customers, chats, messages, products, sequences, attempts, orders }
  };
}

let passedCount = 0;
let totalTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    console.error(err.stack);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EJECUCIÓN DE CASOS DE PRUEBA A - I
// ─────────────────────────────────────────────────────────────────────────────

async function runSuite() {
  // Configurar gateway mock para no enviar mensajes de red
  let providerCalls = 0;
  setFollowUpGatewaySender(async () => {
    providerCalls++;
    return { success: true, messageId: 'mock_msg_123' };
  });

  // TEST A: commercialState A avanzado pero viejo -> nueva consulta canónica B => sequence B / PRODUCT_INTERESTED / maxAttempts 1
  await runTest('TEST A: Old advanced stage A overridden by fresh canonical inquiry B -> sequence B / PRODUCT_INTERESTED / maxAttempts 1', async () => {
    const db = createMockPrisma();
    const tenant = await db.tenant.create({ data: { name: 'Test Shop' } });
    const prodA = await db.product.create({ data: { name: 'Audífonos Xiaomi mini', tenantId: tenant.id } });
    const prodB = await db.product.create({ data: { name: 'JBL go 4 A1', tenantId: tenant.id } });

    // Cliente con commercialState viejo (hace 16 días) de Prod A en SHIPPING_COORDINATED
    const customer = await db.customer.create({
      data: {
        name: 'Velion',
        tenantId: tenant.id,
        commercialState: {
          productId: prodA.id,
          productName: prodA.name,
          currentStage: 'SHIPPING_COORDINATED',
          shippingCity: 'Tarapoto',
          lastConsultedProductId: prodB.id,
          lastConsultedProductName: prodB.name,
          lastConsultedProductAt: new Date().toISOString()
        }
      }
    });

    const chat = await db.chat.create({ data: { tenantId: tenant.id, customerId: customer.id } });
    const lastInbound = await db.message.create({
      data: {
        chatId: chat.id,
        tenantId: tenant.id,
        senderRole: 'contact',
        content: 'Tiene jbl go 4?'
      }
    });
    const lastBotMsg = await db.message.create({
      data: {
        chatId: chat.id,
        tenantId: tenant.id,
        senderRole: 'agent',
        content: '¡Sí, tenemos el JBL go 4 A1 disponible a S/. 50! ¿Te gustaría llevar una unidad?'
      }
    });

    const res = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentCommercialState: customer.commercialState,
      currentStage: customer.commercialState.currentStage,
      productId: customer.commercialState.productId,
      productName: customer.commercialState.productName,
      lastInboundMessage: lastInbound,
      lastBotMessage: lastBotMsg,
      prismaClient: db
    });

    assert.strictEqual(res.scheduled, true, 'Sequence should be scheduled');
    assert.strictEqual(res.action, 'CREATED', 'Sequence should be CREATED');

    const createdSeq = await db.followUpSequence.findUnique({ where: { id: res.sequenceId } });
    assert.strictEqual(createdSeq.productId, prodB.id, 'Sequence must have Product B (JBL), NOT Product A (Xiaomi)');
    assert.strictEqual(createdSeq.productName, prodB.name);
    assert.strictEqual(createdSeq.stageAtCreation, 'PRODUCT_INTERESTED', 'Stage must be PRODUCT_INTERESTED, not inherited SHIPPING_COORDINATED');
    assert.strictEqual(createdSeq.maxAttempts, 1, 'maxAttempts must be 1 for early product interest');
  });

  // TEST B: sequence A currentAttempt=0 -> cliente cambia a B => misma sequence superseded a B => no A
  await runTest('TEST B: Active sequence A (attempt 0) superseded atomically to B on product switch', async () => {
    const db = createMockPrisma();
    const tenant = await db.tenant.create({ data: { name: 'Test Shop' } });
    const prodA = await db.product.create({ data: { name: 'JBL go 4 A1', tenantId: tenant.id } });
    const prodB = await db.product.create({ data: { name: 'Reloj Geneva black', tenantId: tenant.id } });

    const customer = await db.customer.create({
      data: {
        name: 'Carlos',
        tenantId: tenant.id,
        commercialState: {
          productId: prodA.id,
          productName: prodA.name,
          currentStage: 'PRODUCT_SELECTED'
        }
      }
    });
    const chat = await db.chat.create({ data: { tenantId: tenant.id, customerId: customer.id } });

    // 1. Crear secuencia inicial para Prod A (JBL)
    const initialInbound = await db.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Tiene JBL?' }
    });
    const res1 = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentCommercialState: customer.commercialState,
      currentStage: 'PRODUCT_SELECTED',
      productId: prodA.id,
      productName: prodA.name,
      lastInboundMessage: initialInbound,
      prismaClient: db
    });

    assert.strictEqual(res1.scheduled, true);
    assert.strictEqual(res1.action, 'CREATED');
    const seq1 = await db.followUpSequence.findUnique({ where: { id: res1.sequenceId } });
    assert.strictEqual(seq1.productId, prodA.id);
    assert.strictEqual(seq1.maxAttempts, 3);

    // 2. Cliente cambia a Prod B (Reloj): "y reloj para hombre?"
    const switchInbound = await db.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Y reloj negro para hombre? Fotos por favor' }
    });
    const lastBotMsg = await db.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'agent', content: 'Aquí tienes la foto del Reloj Geneva. ¿Te gustaría llevarlo?' }
    });

    // CommercialState actualizado con B en lastConsultedProductId
    const updatedCommercialState = {
      ...customer.commercialState,
      lastConsultedProductId: prodB.id,
      lastConsultedProductName: prodB.name,
      lastConsultedProductAt: new Date().toISOString()
    };
    await db.customer.update({ where: { id: customer.id }, data: { commercialState: updatedCommercialState } });

    const res2 = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentCommercialState: updatedCommercialState,
      currentStage: 'PRODUCT_SELECTED', // cState de compra aún no cambió
      productId: prodA.id,              // cState.productId aún era A
      productName: prodA.name,
      lastInboundMessage: switchInbound,
      lastBotMessage: lastBotMsg,
      prismaClient: db
    });

    assert.strictEqual(res2.scheduled, true);
    assert.strictEqual(res2.action, 'REFRESHED');
    assert.strictEqual(res2.sequenceId, seq1.id, 'Must be the EXACT SAME sequence (no second sequence created)');

    // Verificar que la secuencia fue superseded a B
    const refreshedSeq = await db.followUpSequence.findUnique({ where: { id: seq1.id } });
    assert.strictEqual(refreshedSeq.productId, prodB.id, 'Sequence must now be Product B (Reloj)');
    assert.strictEqual(refreshedSeq.productName, prodB.name);
    assert.strictEqual(refreshedSeq.stageAtCreation, 'PRODUCT_INTERESTED', 'Stage must be PRODUCT_INTERESTED');
    assert.strictEqual(refreshedSeq.maxAttempts, 1, 'maxAttempts must be 1 for exploratory switch');
  });

  // TEST C: sequence A -> sin cambio de producto => A permanece
  await runTest('TEST C: Sequence A remains A with original maxAttempts when no product switch occurs', async () => {
    const db = createMockPrisma();
    const tenant = await db.tenant.create({ data: { name: 'Test Shop' } });
    const prodA = await db.product.create({ data: { name: 'JBL go 4 A1', tenantId: tenant.id } });

    const customer = await db.customer.create({
      data: {
        name: 'Carlos',
        tenantId: tenant.id,
        commercialState: {
          productId: prodA.id,
          productName: prodA.name,
          currentStage: 'PRODUCT_SELECTED',
          lastConsultedProductId: prodA.id,
          lastConsultedProductName: prodA.name
        }
      }
    });
    const chat = await db.chat.create({ data: { tenantId: tenant.id, customerId: customer.id } });

    const inbound1 = await db.message.create({ data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Tiene JBL?' } });
    const res1 = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentCommercialState: customer.commercialState,
      currentStage: 'PRODUCT_SELECTED',
      productId: prodA.id,
      productName: prodA.name,
      lastInboundMessage: inbound1,
      prismaClient: db
    });

    // Cliente sigue preguntando sobre el mismo producto A: "Tiene video del JBL?"
    const inbound2 = await db.message.create({ data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Tiene video?' } });
    const res2 = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentCommercialState: customer.commercialState,
      currentStage: 'PRODUCT_SELECTED',
      productId: prodA.id,
      productName: prodA.name,
      lastInboundMessage: inbound2,
      prismaClient: db
    });

    assert.strictEqual(res2.action, 'REFRESHED');
    const seq = await db.followUpSequence.findUnique({ where: { id: res1.sequenceId } });
    assert.strictEqual(seq.productId, prodA.id, 'Product A must remain');
    assert.strictEqual(seq.stageAtCreation, 'PRODUCT_SELECTED', 'Stage PRODUCT_SELECTED must remain');
    assert.strictEqual(seq.maxAttempts, 3, 'maxAttempts must remain 3');
  });

  // TEST D: sequence A stale llega al worker, lastConsultedProductId = B más reciente, decisionMode = OFF => provider calls = 0, STALE_PRODUCT_CONTEXT
  await runTest('TEST D: Pre-dispatch hard guard blocks stale sequence A when fresher B is consulted (decisionMode=OFF)', async () => {
    const db = createMockPrisma();
    providerCalls = 0;

    const tenant = await db.tenant.create({ data: { name: 'Test Shop', followUpDecisionMode: 'OFF' } });
    const prodA = await db.product.create({ data: { name: 'JBL go 4 A1', tenantId: tenant.id } });
    const prodB = await db.product.create({ data: { name: 'Reloj Geneva black', tenantId: tenant.id } });

    const anchorTime = new Date('2026-09-16T01:00:00.000Z');
    const freshConsultedTime = new Date('2026-09-16T01:30:00.000Z').toISOString(); // 30 minutos DESPUÉS del anchor

    const customer = await db.customer.create({
      data: {
        name: 'Carlos',
        phone: '51999999999',
        tenantId: tenant.id,
        commercialState: {
          productId: prodA.id,
          lastConsultedProductId: prodB.id,
          lastConsultedProductName: prodB.name,
          lastConsultedProductAt: freshConsultedTime
        }
      }
    });
    const chat = await db.chat.create({ data: { tenantId: tenant.id, customerId: customer.id } });

    // Secuencia antigua congelada en Prod A
    const seqA = await db.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        chatId: chat.id,
        productId: prodA.id,
        productName: prodA.name,
        stageAtCreation: 'PRODUCT_SELECTED',
        status: 'PROCESSING',
        currentAttempt: 0,
        anchorAt: anchorTime,
        nextRunAt: new Date(Date.now() - 1000)
      }
    });

    const processRes = await processFollowUpSequence(seqA, db);

    assert.strictEqual(processRes.success, false);
    assert.strictEqual(processRes.status, 'CANCELLED');
    assert.strictEqual(processRes.reason, 'STALE_PRODUCT_CONTEXT');
    assert.strictEqual(providerCalls, 0, 'Provider must NOT be called (0 messages sent)');

    const updatedSeq = await db.followUpSequence.findUnique({ where: { id: seqA.id } });
    assert.strictEqual(updatedSeq.status, 'CANCELLED');
    assert.strictEqual(updatedSeq.cancelReason, 'STALE_PRODUCT_CONTEXT');
  });

  // TEST E: mismo caso D con decisionMode = ENFORCE => hard guard + Gate B compatibles => provider calls = 0, STALE_PRODUCT_CONTEXT
  await runTest('TEST E: Pre-dispatch hard guard takes precedence and cancels before Gate B when decisionMode=ENFORCE', async () => {
    const db = createMockPrisma();
    providerCalls = 0;

    let geminiCalled = 0;
    setGeminiDecisionCaller(async () => {
      geminiCalled++;
      return { decision: 'SEND_FOLLOW_UP', confidence: 0.9 };
    });

    const tenant = await db.tenant.create({ data: { name: 'Test Shop', followUpDecisionMode: 'ENFORCE' } });
    const prodA = await db.product.create({ data: { name: 'JBL go 4 A1', tenantId: tenant.id } });
    const prodB = await db.product.create({ data: { name: 'Reloj Geneva black', tenantId: tenant.id } });

    const anchorTime = new Date('2026-09-16T01:00:00.000Z');
    const freshConsultedTime = new Date('2026-09-16T01:30:00.000Z').toISOString();

    const customer = await db.customer.create({
      data: {
        name: 'Carlos',
        phone: '51999999999',
        tenantId: tenant.id,
        commercialState: {
          productId: prodA.id,
          lastConsultedProductId: prodB.id,
          lastConsultedProductName: prodB.name,
          lastConsultedProductAt: freshConsultedTime
        }
      }
    });
    const chat = await db.chat.create({ data: { tenantId: tenant.id, customerId: customer.id } });

    const seqA = await db.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        chatId: chat.id,
        productId: prodA.id,
        productName: prodA.name,
        stageAtCreation: 'PRODUCT_SELECTED',
        status: 'PROCESSING',
        currentAttempt: 0,
        anchorAt: anchorTime,
        nextRunAt: new Date(Date.now() - 1000)
      }
    });

    const processRes = await processFollowUpSequence(seqA, db);

    assert.strictEqual(processRes.success, false);
    assert.strictEqual(processRes.reason, 'STALE_PRODUCT_CONTEXT');
    assert.strictEqual(providerCalls, 0, 'Provider calls must be 0');
    assert.strictEqual(geminiCalled, 0, 'Gate B does not need to run because deterministic hard guard intercepted it');
  });

  // TEST F: PRODUCT_SELECTED B posteriormente => maxAttempts escala 1 -> 3 según comportamiento existente
  await runTest('TEST F: Sequence superseded to B (PRODUCT_INTERESTED, 1 attempt) upgrades to 3 attempts when advancing to PRODUCT_SELECTED', async () => {
    const db = createMockPrisma();
    const tenant = await db.tenant.create({ data: { name: 'Test Shop' } });
    const prodA = await db.product.create({ data: { name: 'JBL go 4 A1', tenantId: tenant.id } });
    const prodB = await db.product.create({ data: { name: 'Reloj Geneva black', tenantId: tenant.id } });

    const customer = await db.customer.create({
      data: {
        name: 'Carlos',
        tenantId: tenant.id,
        commercialState: {
          productId: prodA.id,
          productName: prodA.name,
          currentStage: 'PRODUCT_SELECTED'
        }
      }
    });
    const chat = await db.chat.create({ data: { tenantId: tenant.id, customerId: customer.id } });

    // Secuencia inicial para A
    const inb1 = await db.message.create({ data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Tiene JBL?' } });
    const res1 = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id, customerId: customer.id, chatId: chat.id,
      currentCommercialState: customer.commercialState, currentStage: 'PRODUCT_SELECTED',
      productId: prodA.id, productName: prodA.name, lastInboundMessage: inb1, prismaClient: db
    });

    // Superseded a B en PRODUCT_INTERESTED
    const inb2 = await db.message.create({ data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Y el reloj?' } });
    const cStateB = { ...customer.commercialState, lastConsultedProductId: prodB.id, lastConsultedProductName: prodB.name, lastConsultedProductAt: new Date().toISOString() };
    await evaluateAndScheduleFollowUp({
      tenantId: tenant.id, customerId: customer.id, chatId: chat.id,
      currentCommercialState: cStateB, currentStage: 'PRODUCT_INTERESTED',
      productId: prodB.id, productName: prodB.name, lastInboundMessage: inb2, prismaClient: db
    });

    const seqInter = await db.followUpSequence.findUnique({ where: { id: res1.sequenceId } });
    assert.strictEqual(seqInter.productId, prodB.id);
    assert.strictEqual(seqInter.stageAtCreation, 'PRODUCT_INTERESTED');
    assert.strictEqual(seqInter.maxAttempts, 1);

    // Cliente avanza a PRODUCT_SELECTED para B: "Quiero comprar 1 unidad del reloj"
    const inb3 = await db.message.create({ data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Quiero 1 unidad del reloj' } });
    const cStateConfirmed = {
      productId: prodB.id,
      productName: prodB.name,
      currentStage: 'PRODUCT_SELECTED',
      customerConfirmed: true,
      lastConsultedProductId: prodB.id,
      lastConsultedProductName: prodB.name,
      lastConsultedProductAt: new Date().toISOString()
    };
    await db.customer.update({ where: { id: customer.id }, data: { commercialState: cStateConfirmed } });

    await evaluateAndScheduleFollowUp({
      tenantId: tenant.id, customerId: customer.id, chatId: chat.id,
      currentCommercialState: cStateConfirmed, currentStage: 'PRODUCT_SELECTED',
      productId: prodB.id, productName: prodB.name, lastInboundMessage: inb3, prismaClient: db
    });

    const seqUpgraded = await db.followUpSequence.findUnique({ where: { id: res1.sequenceId } });
    assert.strictEqual(seqUpgraded.productId, prodB.id);
    assert.strictEqual(seqUpgraded.stageAtCreation, 'PRODUCT_SELECTED');
    assert.strictEqual(seqUpgraded.maxAttempts, 3, 'maxAttempts must upgrade from 1 to 3 upon reaching PRODUCT_SELECTED');
  });

  // TEST G: rechazo / optout / merchant blocker => siguen bloqueando
  await runTest('TEST G: Hard blocks (rejection, optout, merchant blocker) remain fully functional', async () => {
    const db = createMockPrisma();
    const tenant = await db.tenant.create({ data: { name: 'Test Shop' } });
    const prod = await db.product.create({ data: { name: 'JBL go 4 A1', tenantId: tenant.id } });

    const customer = await db.customer.create({
      data: {
        name: 'Carlos',
        tenantId: tenant.id,
        commercialState: { productId: prod.id, productName: prod.name, currentStage: 'PRODUCT_SELECTED' }
      }
    });
    const chat = await db.chat.create({ data: { tenantId: tenant.id, customerId: customer.id } });

    // 1. Rechazo explícito
    const rejectInbound = await db.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'No gracias, no quiero comprar nada' }
    });
    const rejectRes = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id, customerId: customer.id, chatId: chat.id,
      currentCommercialState: customer.commercialState, currentStage: 'PRODUCT_SELECTED',
      productId: prod.id, lastInboundMessage: rejectInbound, prismaClient: db
    });
    assert.strictEqual(rejectRes.scheduled, false);
    assert.strictEqual(rejectRes.reason, 'OPPORTUNITY_REJECTED');

    // 2. Opt-out
    await db.customer.update({ where: { id: customer.id }, data: { followUpSuppressed: true } });
    const normalInbound = await db.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Tiene JBL?' }
    });
    const optOutRes = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id, customerId: customer.id, chatId: chat.id,
      currentCommercialState: customer.commercialState, currentStage: 'PRODUCT_SELECTED',
      productId: prod.id, lastInboundMessage: normalInbound, prismaClient: db
    });
    assert.strictEqual(optOutRes.scheduled, false);
    assert.strictEqual(optOutRes.reason, 'CUSTOMER_SUPPRESSED');

    // 3. Merchant blocker
    await db.customer.update({ where: { id: customer.id }, data: { followUpSuppressed: false } });
    const blockerBotMsg = await db.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'agent', content: 'Los detalles de entrega deben confirmarse directamente con el negocio. ¿Deseas esperar?' }
    });
    const check = shouldCreateOrRefreshFollowUp({
      tenant,
      customer,
      currentCommercialState: { currentStage: 'PRODUCT_INTERESTED', productId: prod.id },
      lastInboundMessage: normalInbound,
      lastBotMessage: blockerBotMsg
    });
    assert.strictEqual(check.eligible, false);
    assert.strictEqual(check.reason, 'MERCHANT_BLOCKER');
  });

  // TEST H: cross-tenant productId => nunca aceptado como lastConsulted válido
  await runTest('TEST H: Cross-tenant lastConsultedProductId is rejected and cannot overwrite sequence product', async () => {
    const db = createMockPrisma();
    const tenant1 = await db.tenant.create({ data: { name: 'Tenant 1' } });
    const tenant2 = await db.tenant.create({ data: { name: 'Tenant 2' } });

    const prodTenant1 = await db.product.create({ data: { name: 'Prod T1', tenantId: tenant1.id } });
    const prodTenant2 = await db.product.create({ data: { name: 'Prod T2', tenantId: tenant2.id } });

    const customer = await db.customer.create({
      data: {
        name: 'Alice',
        tenantId: tenant1.id,
        commercialState: {
          productId: prodTenant1.id,
          productName: prodTenant1.name,
          currentStage: 'PRODUCT_SELECTED',
          // Intento de inyección cross-tenant en lastConsultedProductId
          lastConsultedProductId: prodTenant2.id,
          lastConsultedProductName: prodTenant2.name,
          lastConsultedProductAt: new Date().toISOString()
        }
      }
    });
    const chat = await db.chat.create({ data: { tenantId: tenant1.id, customerId: customer.id } });

    const inbound = await db.message.create({
      data: { chatId: chat.id, tenantId: tenant1.id, senderRole: 'contact', content: 'Tiene ese otro producto?' }
    });

    const res = await evaluateAndScheduleFollowUp({
      tenantId: tenant1.id,
      customerId: customer.id,
      chatId: chat.id,
      currentCommercialState: customer.commercialState,
      currentStage: customer.commercialState.currentStage,
      productId: prodTenant1.id,
      productName: prodTenant1.name,
      lastInboundMessage: inbound,
      prismaClient: db
    });

    assert.strictEqual(res.scheduled, true);
    const seq = await db.followUpSequence.findUnique({ where: { id: res.sequenceId } });
    assert.strictEqual(seq.productId, prodTenant1.id, 'Cross-tenant product must be rejected; sequence keeps Tenant 1 product');
    assert.notStrictEqual(seq.productId, prodTenant2.id, 'Must NEVER adopt cross-tenant product');
  });

  // TEST I (ADDENDUM): lastConsultedProductId = B con timestamp antiguo, producto A seleccionado posteriormente => sequence A no es cancelada y sigue válida
  await runTest('TEST I (Addendum Freshness): Older consultation B does NOT cancel newer selection sequence A', async () => {
    const db = createMockPrisma();
    providerCalls = 0;

    const tenant = await db.tenant.create({ data: { name: 'Test Shop', followUpDecisionMode: 'OFF' } });
    const prodA = await db.product.create({ data: { name: 'JBL go 4 A1', tenantId: tenant.id } });
    const prodB = await db.product.create({ data: { name: 'Reloj Geneva black', tenantId: tenant.id } });

    // Escenario temporal:
    // 1. Cliente consultó Prod B a las 10:00 AM (timestamp antiguo)
    const oldConsultedTime = new Date('2026-09-16T10:00:00.000Z').toISOString();
    // 2. Posteriormente, a las 11:00 AM, el cliente seleccionó Prod A y se creó sequence A
    const seqContextTime = new Date('2026-09-16T11:00:00.000Z');

    const customer = await db.customer.create({
      data: {
        name: 'Carlos',
        phone: '51999999999',
        tenantId: tenant.id,
        commercialState: {
          productId: prodA.id,
          productName: prodA.name,
          currentStage: 'PRODUCT_SELECTED',
          // lastConsultedProductId retuvo B de una consulta más antigua
          lastConsultedProductId: prodB.id,
          lastConsultedProductName: prodB.name,
          lastConsultedProductAt: oldConsultedTime
        }
      }
    });
    const chat = await db.chat.create({ data: { tenantId: tenant.id, customerId: customer.id } });

    const seqA = await db.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        chatId: chat.id,
        productId: prodA.id,
        productName: prodA.name,
        stageAtCreation: 'PRODUCT_SELECTED',
        status: 'PROCESSING',
        currentAttempt: 0,
        anchorAt: seqContextTime,
        createdAt: seqContextTime,
        nextRunAt: new Date(Date.now() - 1000)
      }
    });

    // Worker procesa sequence A
    const processRes = await processFollowUpSequence(seqA, db);

    // Esperado: NO debe cancelarse por STALE_PRODUCT_CONTEXT porque la consulta B es más antigua que sequence A
    assert.notStrictEqual(processRes?.reason, 'STALE_PRODUCT_CONTEXT', 'Old consultation must NOT trigger STALE_PRODUCT_CONTEXT');
    assert.strictEqual(providerCalls, 1, 'Sequence A must proceed to normal generation/send');

    const finalSeq = await db.followUpSequence.findUnique({ where: { id: seqA.id } });
    assert.strictEqual(finalSeq.productId, prodA.id, 'Sequence A remains product A');
    assert.notStrictEqual(finalSeq.cancelReason, 'STALE_PRODUCT_CONTEXT');
  });

  console.log('\n======================================================================');
  console.log(`📊 RESULTS: ${passedCount}/${totalTests} tests passed`);
  console.log('======================================================================');

  if (passedCount < totalTests) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Unhandled failure in test suite:', err);
  process.exit(1);
});
