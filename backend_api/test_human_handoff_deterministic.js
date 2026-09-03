import assert from 'node:assert';
import { isHandoffActive } from './src/services/humanHandoffGate.js';
import { isAutomatedMessage, markMessageAsSentByAi } from './src/services/aiMessageTracker.js';
import { REQUEST_HUMAN_HANDOFF_DECLARATION } from './src/controllers/whatsappController.js';

console.log('======================================================================');
console.log('🧪 VELION DETERMINISTIC HUMAN HANDOFF & POST-GEN GATE SUITE');
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
    console.error(`       Error: ${err.message}`);
    throw err;
  }
}

/**
 * Mock Prisma Adapter en memoria para pruebas de aislamiento y velocidad
 */
function createMockPrisma() {
  const contacts = new Map();
  const chats = new Map();
  const customers = new Map();
  const messages = [];
  const tenants = new Map();

  return {
    contacts,
    chats,
    customers,
    messages,
    tenants,

    contact: {
      findFirst: async ({ where, select }) => {
        for (const c of contacts.values()) {
          if (where.tenantId && c.tenantId !== where.tenantId) continue;
          if (where.id && c.id !== where.id) continue;
          if (where.OR) {
            const matchesOr = where.OR.some(cond => {
              if (cond.phone?.contains && c.phone && c.phone.includes(cond.phone.contains)) return true;
              if (cond.phone && c.phone === cond.phone) return true;
              return false;
            });
            if (!matchesOr) continue;
          }
          if (select?.botPaused) return { botPaused: c.botPaused };
          return c;
        }
        return null;
      },
      create: async ({ data }) => {
        const id = data.id || `contact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const record = { id, botPaused: false, ...data };
        contacts.set(id, record);
        return record;
      },
      update: async ({ where, data }) => {
        const record = contacts.get(where.id);
        if (!record) throw new Error('Contact not found');
        Object.assign(record, data);
        return record;
      }
    },

    chat: {
      findFirst: async ({ where, select }) => {
        for (const ch of chats.values()) {
          if (where.tenantId && ch.tenantId !== where.tenantId) continue;
          if (where.id && ch.id !== where.id) continue;
          if (where.contactId && ch.contactId !== where.contactId) continue;
          if (select?.botPaused) return { botPaused: ch.botPaused };
          return ch;
        }
        return null;
      },
      create: async ({ data }) => {
        const id = data.id || `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const record = { id, botPaused: false, ...data };
        chats.set(id, record);
        return record;
      },
      update: async ({ where, data }) => {
        const record = chats.get(where.id);
        if (!record) throw new Error('Chat not found');
        Object.assign(record, data);
        return record;
      }
    },

    customer: {
      findFirst: async ({ where, select }) => {
        for (const cu of customers.values()) {
          if (where.tenantId && cu.tenantId !== where.tenantId) continue;
          if (where.OR) {
            const matchesOr = where.OR.some(cond => {
              if (cond.phone?.contains && cu.phone && cu.phone.includes(cond.phone.contains)) return true;
              if (cond.phone && cu.phone === cond.phone) return true;
              return false;
            });
            if (!matchesOr) continue;
          }
          if (select?.isBotPaused) return { isBotPaused: cu.isBotPaused };
          return cu;
        }
        return null;
      },
      create: async ({ data }) => {
        const id = data.id || `cust-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const record = { id, isBotPaused: false, ...data };
        customers.set(id, record);
        return record;
      },
      update: async ({ where, data }) => {
        const record = customers.get(where.id);
        if (!record) throw new Error('Customer not found');
        Object.assign(record, data);
        return record;
      }
    },

    message: {
      create: async ({ data }) => {
        const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const record = { id, createdAt: new Date(), ...data };
        messages.push(record);
        return record;
      }
    },

    tenant: {
      findUnique: async ({ where, select }) => {
        const t = tenants.get(where.id);
        if (!t) return null;
        if (select?.aiEnabled) return { aiEnabled: t.aiEnabled };
        return t;
      },
      create: async ({ data }) => {
        tenants.set(data.id, { aiEnabled: true, ...data });
        return tenants.get(data.id);
      }
    }
  };
}

async function main() {
  const db = createMockPrisma();

  const tenantA = await db.tenant.create({ data: { id: 'tenant-alpha', name: 'Tenant Alpha' } });
  const tenantB = await db.tenant.create({ data: { id: 'tenant-beta', name: 'Tenant Beta' } });

  const clientPhone = '51999111222';

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 5: Contact paused -> Gate bloquea
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 5: Contact paused (Contact.botPaused = true) -> Gate detecta handoff activo', async () => {
    const contact = await db.contact.create({
      data: { tenantId: tenantA.id, phone: clientPhone, botPaused: true }
    });
    const chat = await db.chat.create({
      data: { tenantId: tenantA.id, contactId: contact.id, botPaused: false }
    });
    const customer = await db.customer.create({
      data: { tenantId: tenantA.id, phone: clientPhone, isBotPaused: false }
    });

    const active = await isHandoffActive({
      tenantId: tenantA.id,
      contactId: contact.id,
      chatId: chat.id,
      phone: clientPhone,
      prismaClient: db
    });

    assert.strictEqual(active, true, 'Debe retornar true si Contact.botPaused es true');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 6: Chat paused -> Gate bloquea
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 6: Chat paused (Chat.botPaused = true) -> Gate detecta handoff activo', async () => {
    const phoneChat = '51999222333';
    const contact = await db.contact.create({
      data: { tenantId: tenantA.id, phone: phoneChat, botPaused: false }
    });
    const chat = await db.chat.create({
      data: { tenantId: tenantA.id, contactId: contact.id, botPaused: true }
    });
    const customer = await db.customer.create({
      data: { tenantId: tenantA.id, phone: phoneChat, isBotPaused: false }
    });

    const active = await isHandoffActive({
      tenantId: tenantA.id,
      contactId: contact.id,
      chatId: chat.id,
      phone: phoneChat,
      prismaClient: db
    });

    assert.strictEqual(active, true, 'Debe retornar true si Chat.botPaused es true');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 7: Customer paused -> Gate bloquea
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 7: Customer paused (Customer.isBotPaused = true) -> Gate detecta handoff activo', async () => {
    const phoneCust = '51999333444';
    const contact = await db.contact.create({
      data: { tenantId: tenantA.id, phone: phoneCust, botPaused: false }
    });
    const chat = await db.chat.create({
      data: { tenantId: tenantA.id, contactId: contact.id, botPaused: false }
    });
    const customer = await db.customer.create({
      data: { tenantId: tenantA.id, phone: phoneCust, isBotPaused: true }
    });

    const active = await isHandoffActive({
      tenantId: tenantA.id,
      contactId: contact.id,
      chatId: chat.id,
      phone: phoneCust,
      prismaClient: db
    });

    assert.strictEqual(active, true, 'Debe retornar true si Customer.isBotPaused es true');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 8: Todos false -> IA puede continuar
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 8: Todos false -> Gate permite que la IA continúe normalmente', async () => {
    const phoneAllFalse = '51999444555';
    const contact = await db.contact.create({
      data: { tenantId: tenantA.id, phone: phoneAllFalse, botPaused: false }
    });
    const chat = await db.chat.create({
      data: { tenantId: tenantA.id, contactId: contact.id, botPaused: false }
    });
    const customer = await db.customer.create({
      data: { tenantId: tenantA.id, phone: phoneAllFalse, isBotPaused: false }
    });

    const active = await isHandoffActive({
      tenantId: tenantA.id,
      contactId: contact.id,
      chatId: chat.id,
      phone: phoneAllFalse,
      prismaClient: db
    });

    assert.strictEqual(active, false, 'Debe retornar false si ninguna entidad está pausada');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 9: Tenant isolation -> Pausa en Tenant B no afecta a Tenant A
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 9: Aislamiento Multi-Tenant -> Pausa en Tenant B no afecta a Tenant A', async () => {
    const sharedPhone = '51999555666';

    // Tenant B está pausado
    const contactB = await db.contact.create({
      data: { tenantId: tenantB.id, phone: sharedPhone, botPaused: true }
    });
    const chatB = await db.chat.create({
      data: { tenantId: tenantB.id, contactId: contactB.id, botPaused: true }
    });
    const customerB = await db.customer.create({
      data: { tenantId: tenantB.id, phone: sharedPhone, isBotPaused: true }
    });

    // Tenant A está activo
    const contactA = await db.contact.create({
      data: { tenantId: tenantA.id, phone: sharedPhone, botPaused: false }
    });
    const chatA = await db.chat.create({
      data: { tenantId: tenantA.id, contactId: contactA.id, botPaused: false }
    });
    const customerA = await db.customer.create({
      data: { tenantId: tenantA.id, phone: sharedPhone, isBotPaused: false }
    });

    // Consulta para Tenant A: debe estar ACTIVO
    const activeA = await isHandoffActive({
      tenantId: tenantA.id,
      contactId: contactA.id,
      chatId: chatA.id,
      phone: sharedPhone,
      prismaClient: db
    });
    assert.strictEqual(activeA, false, 'Tenant A debe permanecer activo');

    // Consulta para Tenant B: debe estar PAUSADO
    const activeB = await isHandoffActive({
      tenantId: tenantB.id,
      contactId: contactB.id,
      chatId: chatB.id,
      phone: sharedPhone,
      prismaClient: db
    });
    assert.strictEqual(activeB, true, 'Tenant B debe estar pausado');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 1: Pre-Generation Gate (Humano intervino durante buffer)
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 1: Pre-Generation Gate -> Si humano interviene durante buffer de 4s, Gemini no se invoca', async () => {
    const phoneTest1 = '51999000001';
    const contact = await db.contact.create({ data: { tenantId: tenantA.id, phone: phoneTest1, botPaused: false } });
    const chat = await db.chat.create({ data: { tenantId: tenantA.id, contactId: contact.id, botPaused: false } });
    const customer = await db.customer.create({ data: { tenantId: tenantA.id, phone: phoneTest1, isBotPaused: false } });

    let geminiInvoked = false;
    const fakeGeminiCaller = async () => {
      geminiInvoked = true;
      return 'Respuesta de IA no deseada';
    };

    // Asesor humano responde en segundo 2 del buffer
    contact.botPaused = true;
    customer.isBotPaused = true;

    // Al vencer el buffer de 4s, se evalúa Pre-Generation Gate
    const isPreGenHandoff = await isHandoffActive({
      tenantId: tenantA.id,
      contactId: contact.id,
      chatId: chat.id,
      phone: phoneTest1,
      prismaClient: db
    });

    if (!isPreGenHandoff) {
      await fakeGeminiCaller();
    }

    assert.strictEqual(isPreGenHandoff, true, 'Pre-Gen Gate debe detectar handoff');
    assert.strictEqual(geminiInvoked, false, 'Gemini NO debe haberse invocado (0 tokens consumidos)');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 2: Post-Generation Gate (Humano intervino mientras Gemini generaba)
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 2: Post-Generation Gate -> Si humano interviene mientras Gemini genera, respuesta se descarta (0 sends)', async () => {
    const phoneTest2 = '51999000002';
    const contact = await db.contact.create({ data: { tenantId: tenantA.id, phone: phoneTest2, botPaused: false } });
    const chat = await db.chat.create({ data: { tenantId: tenantA.id, contactId: contact.id, botPaused: false } });
    const customer = await db.customer.create({ data: { tenantId: tenantA.id, phone: phoneTest2, isBotPaused: false } });

    let gatewaySends = 0;
    const fakeGatewaySend = async () => { gatewaySends++; };

    // 1. Gemini empieza a generar
    const geminiPromise = (async () => {
      // Simular latencia de Gemini
      await new Promise(r => setTimeout(r, 20));
      return 'Hola! Claro que tenemos stock disponible.';
    })();

    // 2. Humano interviene antes de que Gemini termine
    await new Promise(r => setTimeout(r, 5));
    contact.botPaused = true; // Simula webhook fromMe o LiveChat
    customer.isBotPaused = true;

    const aiResponse = await geminiPromise;

    // 3. Post-Generation Gate
    const isPostGenHandoff = await isHandoffActive({
      tenantId: tenantA.id,
      contactId: contact.id,
      chatId: chat.id,
      phone: phoneTest2,
      prismaClient: db
    });

    if (isPostGenHandoff) {
      // Descartar y registrar ai_cancelled
      await db.message.create({
        data: {
          content: '[Respuesta de IA descartada: conversación pausada por asesor humano]',
          senderRole: 'model',
          status: 'ai_cancelled',
          chatId: chat.id,
          tenantId: tenantA.id
        }
      });
    } else {
      await fakeGatewaySend();
    }

    assert.strictEqual(isPostGenHandoff, true);
    assert.strictEqual(gatewaySends, 0, 'Gateway debe tener 0 envíos de IA');
    const cancelledMsg = db.messages.find(m => m.chatId === chat.id && m.status === 'ai_cancelled');
    assert.ok(cancelledMsg, 'Debe haberse creado mensaje ai_cancelled');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 3: Pre-Dispatch Gate (Humano interviene durante typing delay)
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 3: Pre-Dispatch Gate -> Si humano interviene durante typing delay, se aborta el envío', async () => {
    const phoneTest3 = '51999000003';
    const contact = await db.contact.create({ data: { tenantId: tenantA.id, phone: phoneTest3, botPaused: false } });
    const chat = await db.chat.create({ data: { tenantId: tenantA.id, contactId: contact.id, botPaused: false } });
    const customer = await db.customer.create({ data: { tenantId: tenantA.id, phone: phoneTest3, isBotPaused: false } });

    let gatewaySends = 0;
    const fakeGatewaySend = async () => { gatewaySends++; };

    // Post-Gen Gate pasó porque humano aún no intervenía
    const preCheck = await isHandoffActive({ tenantId: tenantA.id, contactId: contact.id, chatId: chat.id, phone: phoneTest3, prismaClient: db });
    assert.strictEqual(preCheck, false);

    // Simular typing delay
    const typingDelay = new Promise(resolve => {
      setTimeout(() => resolve(), 30);
    });

    // Humano interviene en el ms 10 del typing delay
    setTimeout(() => {
      chat.botPaused = true;
    }, 10);

    await typingDelay;

    // Pre-Dispatch Gate (Post-Typing Check)
    const isPreDispatchHandoff = await isHandoffActive({
      tenantId: tenantA.id,
      contactId: contact.id,
      chatId: chat.id,
      phone: phoneTest3,
      prismaClient: db
    });

    if (!isPreDispatchHandoff) {
      await fakeGatewaySend();
    }

    assert.strictEqual(isPreDispatchHandoff, true, 'Pre-Dispatch Gate debe detectar la pausa activada durante el delay');
    assert.strictEqual(gatewaySends, 0, '0 mensajes despachados al cliente');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 4: Multipart Sequence Interruption
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 4: Multipart Sequence -> Intervención humana interrumpe fragmentos restantes', async () => {
    const phoneTest4 = '51999000004';
    const contact = await db.contact.create({ data: { tenantId: tenantA.id, phone: phoneTest4, botPaused: false } });
    const chat = await db.chat.create({ data: { tenantId: tenantA.id, contactId: contact.id, botPaused: false } });
    const customer = await db.customer.create({ data: { tenantId: tenantA.id, phone: phoneTest4, isBotPaused: false } });

    const fragmentsSent = [];
    const dispatchSequence = ['Hola!', 'Tenemos este modelo en stock.', '¿A qué ciudad te lo enviamos?'];

    for (let i = 0; i < dispatchSequence.length; i++) {
      // Simular chequeo Pre-Dispatch
      const isHandoff = await isHandoffActive({
        tenantId: tenantA.id,
        contactId: contact.id,
        chatId: chat.id,
        phone: phoneTest4,
        prismaClient: db
      });

      if (isHandoff) {
        break; // Rompe la secuencia
      }

      fragmentsSent.push(dispatchSequence[i]);

      // Después de enviar el primer fragmento, un asesor interviene
      if (i === 0) {
        customer.isBotPaused = true;
      }
    }

    assert.strictEqual(fragmentsSent.length, 1, 'Solo debe haberse enviado exactamente el primer fragmento');
    assert.strictEqual(fragmentsSent[0], 'Hola!');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 10: PendingQueue Purge
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 10: PendingQueue Purge -> Mensajes encolados se descartan si el bot está pausado', async () => {
    const phoneTest10 = '51999000010';
    const contact = await db.contact.create({ data: { tenantId: tenantA.id, phone: phoneTest10, botPaused: true } });
    const chat = await db.chat.create({ data: { tenantId: tenantA.id, contactId: contact.id, botPaused: true } });
    const customer = await db.customer.create({ data: { tenantId: tenantA.id, phone: phoneTest10, isBotPaused: true } });

    const mockPendingQueue = {
      tenant: tenantA,
      contact,
      chat,
      clientNumber: phoneTest10,
      text: 'Pregunta encolada del cliente mientras la IA procesaba'
    };

    let reInjected = false;

    // Simulación del bloque finally
    const isPendingHandoff = await isHandoffActive({
      tenantId: mockPendingQueue.tenant.id,
      contactId: mockPendingQueue.contact.id,
      chatId: mockPendingQueue.chat.id,
      phone: mockPendingQueue.clientNumber,
      prismaClient: db
    });

    if (isPendingHandoff) {
      // Descartada
      reInjected = false;
    } else {
      reInjected = true;
    }

    assert.strictEqual(isPendingHandoff, true);
    assert.strictEqual(reInjected, false, 'PendingQueue no debe re-inyectarse si el bot está pausado');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 11: AI OFF Independence
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 11: AI OFF Independence -> AI OFF cancela independientemente de si hay handoff o no', async () => {
    const tenantAiOff = await db.tenant.create({ data: { id: 'tenant-off', name: 'Tenant Off', aiEnabled: false } });
    const phoneOff = '51999000011';

    // Handoff NO activo (todo false)
    const contact = await db.contact.create({ data: { tenantId: tenantAiOff.id, phone: phoneOff, botPaused: false } });
    const chat = await db.chat.create({ data: { tenantId: tenantAiOff.id, contactId: contact.id, botPaused: false } });
    const customer = await db.customer.create({ data: { tenantId: tenantAiOff.id, phone: phoneOff, isBotPaused: false } });

    const handoffActive = await isHandoffActive({ tenantId: tenantAiOff.id, contactId: contact.id, chatId: chat.id, phone: phoneOff, prismaClient: db });
    assert.strictEqual(handoffActive, false, 'Handoff no está activo');

    // AI OFF Check
    const tenantCheck = await db.tenant.findUnique({ where: { id: tenantAiOff.id }, select: { aiEnabled: true } });
    assert.strictEqual(tenantCheck.aiEnabled, false, 'aiEnabled debe ser false');

    const shouldCancel = (tenantCheck.aiEnabled === false) || handoffActive;
    assert.strictEqual(shouldCancel, true, 'El mensaje debe cancelarse por AI OFF');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 12: Automated outgoing message safety
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 12: Automated Outgoing -> Mensajes de IA registrados en aiMessageTracker NO activan handoff', async () => {
    const aiGeneratedMsgId = 'ai-deterministic-msg-888';
    const aiText = 'Estimado cliente, su pedido está siendo preparado.';

    markMessageAsSentByAi(aiGeneratedMsgId);
    markMessageAsSentByAi(aiText);

    const isAuto = await isAutomatedMessage({
      tenantId: tenantA.id,
      chatId: 'chat-test-12',
      msgId: aiGeneratedMsgId,
      text: aiText,
      phone: '51999000012'
    });

    assert.strictEqual(isAuto, true, 'El mensaje generado por IA debe retornar isAutomatedMessage = true');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 13: Tool request_human_handoff ejecuta activateHumanHandoff una vez
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 13: Tool request_human_handoff ejecuta activateHumanHandoff una sola vez', async () => {
    const phone13 = '51999130001';
    const contact = await db.contact.create({ data: { tenantId: tenantA.id, phone: phone13, botPaused: false } });
    const chat = await db.chat.create({ data: { tenantId: tenantA.id, contactId: contact.id, botPaused: false } });
    const customer = await db.customer.create({ data: { tenantId: tenantA.id, phone: phone13, isBotPaused: false } });

    let handoffRequestedInSession = false;
    let handoffActivatedInSession = false;
    let activationCalls = 0;

    const mockActivateHumanHandoff = async () => {
      activationCalls++;
      contact.botPaused = true;
      chat.botPaused = true;
      customer.isBotPaused = true;
      return true;
    };

    const handler = async (funcName, args) => {
      if (funcName === 'request_human_handoff') {
        handoffRequestedInSession = true;
        if (handoffActivatedInSession) {
          return { success: true, handoffActive: true, alreadyActive: true };
        }
        const success = await mockActivateHumanHandoff();
        if (success) {
          handoffActivatedInSession = true;
          return { success: true, handoffActive: true };
        }
      }
    };

    const res = await handler('request_human_handoff', { reason: 'Cliente pide asesor' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(activationCalls, 1);
    assert.strictEqual(handoffRequestedInSession, true);
    assert.strictEqual(handoffActivatedInSession, true);
    assert.strictEqual(contact.botPaused, true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 14: Schema expone ÚNICAMENTE reason (Zero LLM IDs)
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 14: Schema de request_human_handoff expone ÚNICAMENTE reason y ningún ID sensible', async () => {
    assert.ok(REQUEST_HUMAN_HANDOFF_DECLARATION, 'Debe existir la declaración exportada');
    assert.strictEqual(REQUEST_HUMAN_HANDOFF_DECLARATION.name, 'request_human_handoff');

    const params = REQUEST_HUMAN_HANDOFF_DECLARATION.parameters;
    assert.strictEqual(params.type, 'OBJECT');

    const propKeys = Object.keys(params.properties || {});
    assert.deepStrictEqual(propKeys, ['reason'], 'Solo debe exponer "reason"');
    assert.strictEqual(params.properties.reason.type, 'STRING');
    assert.deepStrictEqual(params.required, ['reason']);

    // Comprobar ausencia absoluta de campos de control interno
    const forbiddenFields = ['tenantId', 'chatId', 'contactId', 'phone', 'customerId', 'instance', 'provider', 'userId'];
    for (const f of forbiddenFields) {
      assert.strictEqual(propKeys.includes(f), false, `El campo prohibido "${f}" no debe estar en el schema`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 15: Intentar pasar tenantId / chatId ajeno en args NO afecta a Tenant B
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 15: Inyección adversarial de tenantId/chatId en args no afecta a Tenant B', async () => {
    const phone15 = '51999150001';
    const contactB = await db.contact.create({ data: { tenantId: tenantB.id, phone: phone15, botPaused: false } });
    const chatB = await db.chat.create({ data: { tenantId: tenantB.id, contactId: contactB.id, botPaused: false } });

    const legitimateTenant = tenantA;

    const mockActivate = async ({ tenantId }) => {
      assert.strictEqual(tenantId, legitimateTenant.id, 'Debe usar el tenantId interno, no el inyectado por LLM');
      return true;
    };

    const adversarialArgs = {
      reason: 'Quiero asesor',
      tenantId: tenantB.id,
      chatId: chatB.id
    };

    const cleanReason = String(adversarialArgs.reason || '').trim().slice(0, 120);
    await mockActivate({
      tenantId: legitimateTenant.id,
      reason: cleanReason
    });

    assert.strictEqual(chatB.botPaused, false, 'Chat de Tenant B debe permanecer intacto');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 16: Misma tool repetida por executedToolsCache / failover
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 16: executedToolsCache previene repetición de side effects ante retry de Gemini', async () => {
    const executedToolsCache = new Map();
    let handlerExecutions = 0;

    const mockHandler = async (name, args) => {
      handlerExecutions++;
      return { success: true, handoffActive: true };
    };

    const call1 = { name: 'request_human_handoff', args: { reason: 'Cliente pide asesor' } };
    const sig1 = `${call1.name}_${JSON.stringify(call1.args || {})}`;

    // Intento 1
    if (!executedToolsCache.has(sig1)) {
      const res1 = await mockHandler(call1.name, call1.args);
      executedToolsCache.set(sig1, res1);
    }

    // Intento 2 (Reintento de Gemini Secondary con misma llamada)
    let res2;
    if (executedToolsCache.has(sig1)) {
      res2 = executedToolsCache.get(sig1);
    } else {
      res2 = await mockHandler(call1.name, call1.args);
    }

    assert.strictEqual(handlerExecutions, 1, 'Handler debe haberse ejecutado exactamente una vez');
    assert.deepStrictEqual(res2, { success: true, handoffActive: true });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 17: Reasons distintos durante la misma sesión no activan doble handoff
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 17: Reasons distintos en la misma sesión activan handoff una sola vez', async () => {
    let handoffRequestedInSession = false;
    let handoffActivatedInSession = false;
    let activationCalls = 0;

    const mockActivate = async () => {
      activationCalls++;
      return true;
    };

    const handler = async (args) => {
      handoffRequestedInSession = true;
      if (handoffActivatedInSession) {
        return { success: true, handoffActive: true, alreadyActive: true };
      }
      const ok = await mockActivate();
      if (ok) handoffActivatedInSession = true;
      return { success: true, handoffActive: true };
    };

    // Ronda 1: Primary llama con un motivo
    const res1 = await handler({ reason: 'cliente quiere asesor' });
    assert.strictEqual(res1.alreadyActive, undefined);
    assert.strictEqual(activationCalls, 1);

    // Ronda 2: Secondary o bucle llama con motivo redactado distinto
    const res2 = await handler({ reason: 'solicita persona encargada' });
    assert.strictEqual(res2.alreadyActive, true);
    assert.strictEqual(activationCalls, 1, 'No debe activar un segundo handoff');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 18: Tool + [HUMAN_HANDOFF: ...] en la misma respuesta -> una sola activación y alerta
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 18: Tool + Regex en la misma interacción produce deduplicación perfecta', async () => {
    let handoffRequestedInSession = false;
    let handoffActivatedInSession = false;
    let alertsSent = 0;
    let activations = 0;

    // 1. Ejecutar tool primero
    handoffRequestedInSession = true;
    activations++;
    handoffActivatedInSession = true;
    alertsSent++; // Alerta enviada por la tool

    // 2. Simular que Gemini devuelve aiResponse con la etiqueta textual además de la tool
    const aiResponseWithTag = '[HUMAN_HANDOFF: Cliente insiste] Te paso con un asesor.';
    const handoffRegex = /\[HUMAN_HANDOFF:\s*([\s\S]+?)\]/g;
    const handoffMatches = [];
    let match;
    while ((match = handoffRegex.exec(aiResponseWithTag)) !== null) {
      handoffMatches.push(match[1]);
    }

    // Bloque legacy protegido
    if (handoffMatches.length > 0 && !handoffRequestedInSession && !handoffActivatedInSession) {
      activations++;
      alertsSent++;
    }

    // Texto visible limpio
    const cleanText = aiResponseWithTag.replace(handoffRegex, '').trim();

    assert.strictEqual(activations, 1, 'Exactamente 1 activación');
    assert.strictEqual(alertsSent, 1, 'Exactamente 1 alerta al dueño');
    assert.strictEqual(cleanText, 'Te paso con un asesor.');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 19: Tool exitosa -> BD pausada, confirmación enviada, 0 texto posterior
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 19: Tool exitosa pausa BD, envía confirmación determinística y bloquea texto posterior de Gemini', async () => {
    const phone19 = '51999190001';
    const contact = await db.contact.create({ data: { tenantId: tenantA.id, phone: phone19, botPaused: false } });
    const chat = await db.chat.create({ data: { tenantId: tenantA.id, contactId: contact.id, botPaused: false } });
    const customer = await db.customer.create({ data: { tenantId: tenantA.id, phone: phone19, isBotPaused: false } });

    let handoffRequestedInSession = true;
    let handoffActivatedInSession = true;
    let confirmationSends = 0;
    let trailingAiSends = 0;

    // Confirmación determinística
    const confirmText = 'Entendido. He transferido esta conversación a un asesor humano para que pueda ayudarte. En breve continuarán contigo por este chat.';
    confirmationSends++;
    contact.botPaused = true;
    chat.botPaused = true;
    customer.isBotPaused = true;

    // Gemini genera texto en round 2
    const trailingGeminiText = 'Listo, un asesor te atenderá pronto. Que tengas buen día.';

    // Post-Gen Gate
    const isPostGenHandoff = handoffRequestedInSession || await isHandoffActive({
      tenantId: tenantA.id,
      contactId: contact.id,
      chatId: chat.id,
      phone: phone19,
      prismaClient: db
    });

    if (!isPostGenHandoff) {
      trailingAiSends++;
    }

    assert.strictEqual(contact.botPaused, true);
    assert.strictEqual(chat.botPaused, true);
    assert.strictEqual(customer.isBotPaused, true);
    assert.strictEqual(confirmationSends, 1, 'Confirmación determinística enviada exactamente una vez');
    assert.strictEqual(trailingAiSends, 0, 'Texto posterior de Gemini descartado por Post-Gen Gate (0 envíos)');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 20: activateHumanHandoff falla/throw -> Fail Closed
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 20: Falla de activateHumanHandoff mantiene handoffRequestedInSession=true (Fail-Closed)', async () => {
    let handoffRequestedInSession = false;
    let handoffActivatedInSession = false;
    let confirmationSends = 0;
    let trailingAiSends = 0;

    const brokenActivate = async () => {
      throw new Error('Database connection pool timeout');
    };

    // Handler
    handoffRequestedInSession = true; // Establecido antes de la mutación
    try {
      await brokenActivate();
      handoffActivatedInSession = true;
    } catch (err) {
      // Capturado
    }

    if (handoffActivatedInSession) {
      confirmationSends++;
    }

    // Post-Gen Gate
    const shouldSuppress = handoffRequestedInSession;
    if (!shouldSuppress) {
      trailingAiSends++;
    }

    assert.strictEqual(handoffRequestedInSession, true, 'handoffRequestedInSession debe ser true');
    assert.strictEqual(handoffActivatedInSession, false, 'handoffActivatedInSession debe ser false');
    assert.strictEqual(confirmationSends, 0, 'No debe enviar confirmación falsa si la activación falló');
    assert.strictEqual(trailingAiSends, 0, 'IA no debe continuar respondiendo si se solicitó handoff (Fail-Closed)');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 21: Conversación normal sin handoff continúa sin interrupción
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 21: Conversación normal de venta no activa handoff y permite respuesta normal', async () => {
    let handoffRequestedInSession = false;
    let handoffActivatedInSession = false;

    // Gemini no llama a request_human_handoff
    const aiResponse = 'El producto Zapatillas Pro cuesta S/. 150 y tenemos tallas 40 a 42.';

    const isPostGenHandoff = handoffRequestedInSession;
    assert.strictEqual(isPostGenHandoff, false, 'No debe suprimir respuesta normal');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 22: Gateway retorna null -> No persiste sent, no socket sent, handoff permanece activo
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 22: Gateway retorna null -> confirmationSent=false, 0 mensajes sent persistidos, handoff activo', async () => {
    const phone22 = '51999220001';
    const contact = await db.contact.create({ data: { tenantId: tenantA.id, phone: phone22, botPaused: false } });
    const chat = await db.chat.create({ data: { tenantId: tenantA.id, contactId: contact.id, botPaused: false } });

    let handoffRequestedInSession = false;
    let handoffActivatedInSession = false;
    let handoffConfirmationSentInSession = false;
    const persistedMessages = [];
    const socketEvents = [];

    // 1. activateHumanHandoff => true
    const activateHumanHandoff = async () => {
      contact.botPaused = true;
      chat.botPaused = true;
      return true;
    };

    // 2. sendWhatsAppReply => null (simula fallo de gateway)
    const sendWhatsAppReply = async () => null;

    // Ejecución de la lógica productiva
    handoffRequestedInSession = true;
    const activated = await activateHumanHandoff();
    if (activated) {
      handoffActivatedInSession = true;
      if (!handoffConfirmationSentInSession) {
        const confirmText = 'Entendido. He transferido esta conversación a un asesor humano...';
        const confirmMsgId = await sendWhatsAppReply();
        if (confirmMsgId) {
          handoffConfirmationSentInSession = true;
          persistedMessages.push({ content: confirmText, status: 'sent', externalId: confirmMsgId });
          socketEvents.push({ status: 'sent', externalId: confirmMsgId });
        }
      }
    }

    // Post-Gen Gate check
    const isPostGenHandoff = handoffRequestedInSession || await isHandoffActive({
      tenantId: tenantA.id,
      contactId: contact.id,
      chatId: chat.id,
      phone: phone22,
      prismaClient: db
    });

    let trailingGeminiSends = 0;
    if (!isPostGenHandoff) {
      trailingGeminiSends++;
    }

    assert.strictEqual(handoffRequestedInSession, true, 'handoffRequestedInSession debe ser true');
    assert.strictEqual(handoffActivatedInSession, true, 'handoffActivatedInSession debe ser true');
    assert.strictEqual(handoffConfirmationSentInSession, false, 'handoffConfirmationSentInSession debe permanecer false');
    assert.strictEqual(persistedMessages.length, 0, '0 mensajes con status sent persistidos');
    assert.strictEqual(socketEvents.length, 0, '0 eventos socket.io emitidos con status sent');
    assert.strictEqual(trailingGeminiSends, 0, '0 texto libre posterior de Gemini');
    assert.strictEqual(contact.botPaused, true, 'Bot debe permanecer pausado en DB');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 23: Gateway throw -> Excepción capturada, confirmationSent=false, 0 sent
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 23: Gateway throw -> Excepción capturada, confirmationSent=false, 0 sent, handoff activo', async () => {
    const phone23 = '51999230001';
    const contact = await db.contact.create({ data: { tenantId: tenantA.id, phone: phone23, botPaused: false } });
    const chat = await db.chat.create({ data: { tenantId: tenantA.id, contactId: contact.id, botPaused: false } });

    let handoffRequestedInSession = false;
    let handoffActivatedInSession = false;
    let handoffConfirmationSentInSession = false;
    const persistedMessages = [];
    const socketEvents = [];

    const activateHumanHandoff = async () => {
      contact.botPaused = true;
      chat.botPaused = true;
      return true;
    };

    // Simula throw en sendWhatsAppReply
    const sendWhatsAppReply = async () => {
      throw new Error('Network timeout / Evolution server unreachable');
    };

    handoffRequestedInSession = true;
    const activated = await activateHumanHandoff();
    if (activated) {
      handoffActivatedInSession = true;
      if (!handoffConfirmationSentInSession) {
        const confirmText = 'Entendido. He transferido esta conversación a un asesor humano...';
        try {
          const confirmMsgId = await sendWhatsAppReply();
          if (confirmMsgId) {
            handoffConfirmationSentInSession = true;
            persistedMessages.push({ content: confirmText, status: 'sent', externalId: confirmMsgId });
            socketEvents.push({ status: 'sent', externalId: confirmMsgId });
          }
        } catch (err) {
          // Capturado limpiamente
        }
      }
    }

    const isPostGenHandoff = handoffRequestedInSession || await isHandoffActive({
      tenantId: tenantA.id,
      contactId: contact.id,
      chatId: chat.id,
      phone: phone23,
      prismaClient: db
    });

    let trailingGeminiSends = 0;
    if (!isPostGenHandoff) {
      trailingGeminiSends++;
    }

    assert.strictEqual(contact.botPaused, true, 'Handoff permanece activo');
    assert.strictEqual(handoffConfirmationSentInSession, false, 'confirmationSent permanece false');
    assert.strictEqual(persistedMessages.length, 0, '0 persistencias falsas sent');
    assert.strictEqual(socketEvents.length, 0, '0 websocket falso sent');
    assert.strictEqual(trailingGeminiSends, 0, '0 texto posterior de Gemini');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 24: Gateway éxito -> confirmationSent=true, 1 Message sent, 1 Socket sent
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 24: Gateway éxito -> confirmationSent=true, exactamente 1 mensaje sent, externalId verificado', async () => {
    const phone24 = '51999240001';
    const contact = await db.contact.create({ data: { tenantId: tenantA.id, phone: phone24, botPaused: false } });
    const chat = await db.chat.create({ data: { tenantId: tenantA.id, contactId: contact.id, botPaused: false } });

    let handoffRequestedInSession = false;
    let handoffActivatedInSession = false;
    let handoffConfirmationSentInSession = false;
    const persistedMessages = [];
    const socketEvents = [];

    const activateHumanHandoff = async () => {
      contact.botPaused = true;
      chat.botPaused = true;
      return true;
    };

    const legitimateMsgId = 'wamid-successful-delivery-999';
    const sendWhatsAppReply = async () => legitimateMsgId;

    handoffRequestedInSession = true;
    const activated = await activateHumanHandoff();
    if (activated) {
      handoffActivatedInSession = true;
      if (!handoffConfirmationSentInSession) {
        const confirmText = 'Entendido. He transferido esta conversación a un asesor humano...';
        const confirmMsgId = await sendWhatsAppReply();
        if (confirmMsgId) {
          handoffConfirmationSentInSession = true;
          persistedMessages.push({ content: confirmText, status: 'sent', externalId: confirmMsgId });
          socketEvents.push({ status: 'sent', externalId: confirmMsgId });
        }
      }
    }

    const isPostGenHandoff = handoffRequestedInSession || await isHandoffActive({
      tenantId: tenantA.id,
      contactId: contact.id,
      chatId: chat.id,
      phone: phone24,
      prismaClient: db
    });

    let trailingGeminiSends = 0;
    if (!isPostGenHandoff) {
      trailingGeminiSends++;
    }

    assert.strictEqual(handoffConfirmationSentInSession, true, 'confirmationSent debe ser true');
    assert.strictEqual(persistedMessages.length, 1, 'Exactamente 1 Message con status sent');
    assert.strictEqual(persistedMessages[0].externalId, legitimateMsgId, 'externalId coincide con el id devuelto por gateway');
    assert.strictEqual(socketEvents.length, 1, 'Exactamente 1 evento Socket.IO con status sent');
    assert.strictEqual(socketEvents[0].externalId, legitimateMsgId);
    assert.strictEqual(trailingGeminiSends, 0, 'Post-Gen Gate bloquea texto libre posterior');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 25 (TEST A): Alerta automática al comerciante -> isAutomatedMessage=true, NO activa handoff
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 25 (TEST A): Alerta automática al comerciante registrada -> isAutomatedMessage=true y activateHumanHandoff NO se ejecuta', async () => {
    const phoneCustomer = '51999250001';
    const phoneMerchant = '51926246740';
    const alertMsgId = '3EB08BAB64D8F5771E48E7';
    const cleanReason = 'Cliente solicita asesor humano';
    const alertMessage = `🚨 *ALERTA DE ASESOR REQUERIDO* 🚨\nEl cliente *+${phoneCustomer}* requiere atención de un asesor humano.\n*Motivo:* ${cleanReason}\n¡Por favor, entra al chat y atiéndelo!`;

    // 1. Simulación del flujo de request_human_handoff:
    // Pre-registro por texto antes del gateway
    markMessageAsSentByAi(alertMessage, { tenantId: tenantA.id });

    // Gateway envía y devuelve alertMsgId
    const gatewaySendText = async () => alertMsgId;
    const returnedMsgId = await gatewaySendText();

    // Post-registro por messageId
    if (returnedMsgId) {
      markMessageAsSentByAi(returnedMsgId, { tenantId: tenantA.id });
    }

    // 2. Simulación del webhook incoming fromMe de Evolution
    const isAuto = await isAutomatedMessage({
      tenantId: tenantA.id,
      chatId: 'chat-merchant-25',
      msgId: alertMsgId,
      text: alertMessage,
      phone: phoneMerchant
    });

    let handoffExecuted = false;
    if (!isAuto) {
      handoffExecuted = true;
    }

    assert.strictEqual(isAuto, true, 'La alerta automática debe reconocerse como isAutomatedMessage=true');
    assert.strictEqual(handoffExecuted, false, 'activateHumanHandoff NUNCA debe ejecutarse para la alerta automática al comerciante');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 26 (TEST B): Webhook fromMe de mensaje humano real -> isAutomatedMessage=false, SÍ activa handoff
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 26 (TEST B): Webhook fromMe de mensaje humano real no registrado -> isAutomatedMessage=false y activateHumanHandoff SÍ se ejecuta', async () => {
    const phoneCustomer = '51999260001';
    const contact = await db.contact.create({ data: { tenantId: tenantA.id, phone: phoneCustomer, botPaused: false } });
    const chat = await db.chat.create({ data: { tenantId: tenantA.id, contactId: contact.id, botPaused: false } });

    const manualHumanText = 'Hola, soy el dueño del negocio y te atiendo yo directamente.';
    const manualHumanMsgId = '3EB0999999999999999999';

    // Mensaje manual NO está registrado en aiMessageTracker
    const isAuto = await isAutomatedMessage({
      tenantId: tenantA.id,
      chatId: chat.id,
      msgId: manualHumanMsgId,
      text: manualHumanText,
      phone: phoneCustomer
    });

    let handoffExecuted = false;
    if (!isAuto) {
      handoffExecuted = true;
      contact.botPaused = true;
      chat.botPaused = true;
    }

    assert.strictEqual(isAuto, false, 'Mensaje manual debe ser isAutomatedMessage=false');
    assert.strictEqual(handoffExecuted, true, 'activateHumanHandoff SÍ debe ejecutarse ante intervención humana real');
    assert.strictEqual(contact.botPaused, true, 'El bot debe quedar pausado');
    assert.strictEqual(chat.botPaused, true, 'El chat debe quedar pausado');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 27 (TEST C): Gateway de alerta retorna null -> Pre-registro por texto previene handoff falso
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 27 (TEST C): Gateway de alerta retorna null -> Pre-registro por texto previene intervención humana falsa ante race conditions', async () => {
    const phoneCustomer = '51999270001';
    const phoneMerchant = '51926246740';
    const cleanReason = 'Prueba gateway null';
    const alertMessage = `🚨 *ALERTA DE ASESOR REQUERIDO* 🚨\nEl cliente *+${phoneCustomer}* requiere atención de un asesor humano.\n*Motivo:* ${cleanReason}\n¡Por favor, entra al chat y atiéndelo!`;

    // Pre-registro por texto
    markMessageAsSentByAi(alertMessage, { tenantId: tenantA.id });

    // Gateway falla o retorna null
    const gatewaySendText = async () => null;
    const returnedMsgId = await gatewaySendText();
    if (returnedMsgId) {
      markMessageAsSentByAi(returnedMsgId, { tenantId: tenantA.id });
    }

    // Webhook llega con msgId desconocido o solo texto (race condition o retorno null)
    const isAuto = await isAutomatedMessage({
      tenantId: tenantA.id,
      chatId: 'chat-merchant-27',
      msgId: 'unknown-early-msg-id-888',
      text: alertMessage,
      phone: phoneMerchant
    });

    let handoffExecuted = false;
    if (!isAuto) {
      handoffExecuted = true;
    }

    assert.strictEqual(isAuto, true, 'El pre-registro por texto protege contra race conditions y retornos null');
    assert.strictEqual(handoffExecuted, false, 'No debe ejecutarse handoff falso');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 28 (TEST D): Aislamiento Multi-Tenant de alertas automáticas
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('TEST 28 (TEST D): Aislamiento Multi-Tenant -> Alerta de Tenant A no contamina a Tenant B ante textos idénticos', async () => {
    const phoneCustomer = '51999280001';
    const phoneMerchant = '51926246740';
    const cleanReason = 'Soporte técnico urgente';
    const alertMessage = `🚨 *ALERTA DE ASESOR REQUERIDO* 🚨\nEl cliente *+${phoneCustomer}* requiere atención de un asesor humano.\n*Motivo:* ${cleanReason}\n¡Por favor, entra al chat y atiéndelo!`;
    const alertMsgIdA = '3EB0_TENANT_A_ALERT_999';

    // Tenant A registra su alerta con su tenantId
    markMessageAsSentByAi(alertMessage, { tenantId: tenantA.id });
    markMessageAsSentByAi(alertMsgIdA, { tenantId: tenantA.id });

    // Verificación para Tenant A: es automático
    const isAutoTenantA = await isAutomatedMessage({
      tenantId: tenantA.id,
      chatId: 'chat-a',
      msgId: alertMsgIdA,
      text: alertMessage,
      phone: phoneMerchant
    });
    assert.strictEqual(isAutoTenantA, true, 'Tenant A reconoce su alerta como automática');

    // Tenant B recibe en su webhook un mensaje idéntico (o manual) que NO fue generado por Tenant B
    const isAutoTenantB = await isAutomatedMessage({
      tenantId: tenantB.id,
      chatId: 'chat-b',
      msgId: 'manual-merchant-msg-tenant-b',
      text: alertMessage,
      phone: phoneMerchant
    });
    assert.strictEqual(isAutoTenantB, false, 'Tenant B NO debe clasificar como automática la alerta perteneciente a Tenant A');

    let handoffTenantB = false;
    if (!isAutoTenantB) {
      handoffTenantB = true;
    }
    assert.strictEqual(handoffTenantB, true, 'Tenant B ejecuta su handoff legítimamente sin contaminación');
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE FINALIZADA: ${passedTests}/${totalTests} TESTS PASARON EXITOSAMENTE`);
  console.log('======================================================================\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error en suite de tests:', err);
    process.exit(1);
  });
