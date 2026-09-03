import assert from 'node:assert';
import { isHandoffActive } from './src/services/humanHandoffGate.js';
import { isAutomatedMessage, markMessageAsSentByAi } from './src/services/aiMessageTracker.js';

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
