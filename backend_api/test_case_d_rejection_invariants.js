import assert from 'node:assert';
import {
  isExplicitOpportunityRejection,
  handleOpportunityRejection,
  cleanCommercialDraft
} from './src/services/orderCommercialService.js';
import {
  evaluateAndScheduleFollowUp,
  cancelActiveFollowUpOnInboundMessage,
  cancelFollowUpOnOrderEvent
} from './src/services/followUpService.js';

console.log('======================================================================');
console.log('🧪 CASE D REJECTION & FOLLOW-UP INVARIANTS TEST SUITE');
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
  const customers = new Map();
  const chats = new Map();
  const messages = new Map();
  const followUpSequences = new Map();
  const orders = new Map();

  return {
    tenants,
    customers,
    chats,
    messages,
    followUpSequences,
    orders,

    tenant: {
      findUnique: async ({ where }) => tenants.get(where.id) || null
    },
    customer: {
      findUnique: async ({ where }) => customers.get(where.id) || null,
      update: async ({ where, data }) => {
        const c = customers.get(where.id);
        if (!c) throw new Error('Customer not found');
        const updated = { ...c, ...data };
        customers.set(where.id, updated);
        return updated;
      }
    },
    chat: {
      findUnique: async ({ where }) => chats.get(where.id) || null
    },
    message: {
      findFirst: async ({ where }) => {
        for (const m of messages.values()) {
          if (where.chatId && m.chatId !== where.chatId) continue;
          return m;
        }
        return null;
      }
    },
    order: {
      findFirst: async ({ where }) => {
        for (const o of orders.values()) {
          if (where.id && o.id !== where.id) continue;
          if (where.tenantId && o.tenantId !== where.tenantId) continue;
          return o;
        }
        return null;
      },
      findUnique: async ({ where }) => orders.get(where.id) || null,
      update: async ({ where, data }) => {
        const o = orders.get(where.id);
        if (!o) throw new Error('Order not found');
        const updated = { ...o, ...data };
        orders.set(where.id, updated);
        return updated;
      }
    },
    alert: {
      create: async ({ data }) => ({ id: genId(), ...data })
    },
    followUpSequence: {
      findFirst: async ({ where }) => {
        for (const s of followUpSequences.values()) {
          if (where.tenantId && s.tenantId !== where.tenantId) continue;
          if (where.customerId && s.customerId !== where.customerId) continue;
          if (where.status?.in && !where.status.in.includes(s.status)) continue;
          return s;
        }
        return null;
      },
      findMany: async ({ where }) => {
        const results = [];
        for (const s of followUpSequences.values()) {
          if (where.tenantId && s.tenantId !== where.tenantId) continue;
          if (where.customerId && s.customerId !== where.customerId) continue;
          if (where.status?.in && !where.status.in.includes(s.status)) continue;
          results.push({ ...s, attempts: [] });
        }
        return results;
      },
      create: async ({ data }) => {
        const record = { id: data.id || genId(), ...data, attempts: [] };
        followUpSequences.set(record.id, record);
        return record;
      },
      update: async ({ where, data }) => {
        const s = followUpSequences.get(where.id);
        if (!s) throw new Error('Sequence not found');
        const updated = { ...s, ...data };
        followUpSequences.set(where.id, updated);
        return updated;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const [id, s] of followUpSequences.entries()) {
          if (where.tenantId && s.tenantId !== where.tenantId) continue;
          if (where.customerId && s.customerId !== where.customerId) continue;
          if (where.status?.in && !where.status.in.includes(s.status)) continue;
          followUpSequences.set(id, { ...s, ...data });
          count++;
        }
        return { count };
      }
    }
  };
}

async function main() {
  // TEST A: EXPLICIT_REJECTION_STOPS_ACTIVE_RECOVERY
  await runTest('A: EXPLICIT_REJECTION_STOPS_ACTIVE_RECOVERY', async () => {
    const db = createMockDb();
    const tenant = { id: 'ten-1', active: true, followUpEnabled: true, timezone: 'America/Lima' };
    db.tenants.set(tenant.id, tenant);

    const customer = {
      id: 'cust-1',
      tenantId: tenant.id,
      phone: '51984363997',
      commercialState: {
        currentStage: 'PRODUCT_SELECTED',
        productId: 'prod-jbl',
        productName: 'JBL go 4',
        customerConfirmed: true,
        quantity: 1,
        sentMediaProductIds: ['prod-jbl']
      },
      followUpSuppressed: false
    };
    db.customers.set(customer.id, customer);

    const chat = { id: 'chat-1', tenantId: tenant.id, customerId: customer.id };
    db.chats.set(chat.id, chat);

    // Secuencia preexistente SCHEDULED para el JBL
    const existingSeq = {
      id: 'seq-jbl-1',
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      productId: 'prod-jbl',
      productName: 'JBL go 4',
      stageAtCreation: 'PRODUCT_SELECTED',
      status: 'SCHEDULED',
      currentAttempt: 0,
      nextRunAt: new Date(Date.now() + 3600000),
      anchorAt: new Date(Date.now() - 3600000)
    };
    db.followUpSequences.set(existingSeq.id, existingSeq);

    // Mensaje de rechazo explícito
    const inboundMessage = {
      id: 'msg-rej-1',
      chatId: chat.id,
      senderRole: 'contact',
      content: 'No, mejor ya no me interesa el JBL.',
      createdAt: new Date()
    };
    db.messages.set(inboundMessage.id, inboundMessage);

    // 1. Simular la guarda en whatsappController (pre-generación)
    const rejHandled = await handleOpportunityRejection({
      tenant,
      customer: db.customers.get(customer.id),
      clientNumber: '51984363997',
      prismaClient: db
    });

    assert.strictEqual(rejHandled.success, true, 'handleOpportunityRejection debe retornar success=true');
    assert.strictEqual(rejHandled.state.currentStage, 'EXPLORING', 'Stage debe ser EXPLORING');
    assert.strictEqual(rejHandled.state.customerConfirmed, undefined, 'customerConfirmed debe haber sido eliminado');
    assert.strictEqual(rejHandled.state.productId, undefined, 'productId debe haber sido eliminado');
    assert.deepStrictEqual(rejHandled.state.sentMediaProductIds, ['prod-jbl'], 'sentMediaProductIds debe preservarse');

    // 2. Verificar que la secuencia existente quedó CANCELLED
    const updatedSeq = db.followUpSequences.get(existingSeq.id);
    assert.strictEqual(updatedSeq.status, 'CANCELLED', 'Secuencia debe estar CANCELLED');
    assert.strictEqual(updatedSeq.cancelReason, 'OPPORTUNITY_REJECTED', 'Motivo debe ser OPPORTUNITY_REJECTED');
    assert.strictEqual(updatedSeq.nextRunAt, null, 'nextRunAt debe ser null');

    // 3. Simular post-dispatch evaluateAndScheduleFollowUp (defensa en profundidad)
    const postDispatchRes = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentCommercialState: rejHandled.state,
      currentStage: rejHandled.state.currentStage,
      lastInboundMessage: inboundMessage,
      prismaClient: db
    });

    assert.strictEqual(postDispatchRes.scheduled, false, 'No debe programar nada');
  });

  // TEST B: EXPLICIT_REJECTION_PREVENTS_NEW_SEQUENCE
  await runTest('B: EXPLICIT_REJECTION_PREVENTS_NEW_SEQUENCE', async () => {
    const db = createMockDb();
    const tenant = { id: 'ten-2', active: true, followUpEnabled: true, timezone: 'America/Lima' };
    db.tenants.set(tenant.id, tenant);

    const customer = {
      id: 'cust-2',
      tenantId: tenant.id,
      phone: '51999999992',
      commercialState: {
        currentStage: 'PRODUCT_SELECTED',
        productId: 'prod-watch',
        customerConfirmed: true
      },
      followUpSuppressed: false
    };
    db.customers.set(customer.id, customer);

    const chat = { id: 'chat-2', tenantId: tenant.id, customerId: customer.id };
    db.chats.set(chat.id, chat);

    const inbound = {
      id: 'msg-b',
      chatId: chat.id,
      senderRole: 'contact',
      content: 'Ya no lo quiero, gracias',
      createdAt: new Date()
    };

    // Invocar directamente evaluateAndScheduleFollowUp con mensaje de rechazo
    const res = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentCommercialState: customer.commercialState,
      currentStage: 'PRODUCT_SELECTED',
      productId: 'prod-watch',
      lastInboundMessage: inbound,
      prismaClient: db
    });

    assert.strictEqual(res.scheduled, false);
    assert.strictEqual(res.reason, 'OPPORTUNITY_REJECTED');
    assert.strictEqual(db.followUpSequences.size, 0, '0 secuencias creadas');
    assert.strictEqual(db.customers.get(customer.id).commercialState.currentStage, 'EXPLORING', 'Debe limpiar a EXPLORING');
  });

  // TEST C: REJECTION_WITHOUT_TOOL_CALL_STILL_SAFE
  await runTest('C: REJECTION_WITHOUT_TOOL_CALL_STILL_SAFE', async () => {
    const db = createMockDb();
    const tenant = { id: 'ten-3', active: true, followUpEnabled: true, timezone: 'America/Lima' };
    db.tenants.set(tenant.id, tenant);

    const customer = {
      id: 'cust-3',
      tenantId: tenant.id,
      phone: '51999999993',
      commercialState: {
        currentStage: 'PRODUCT_SELECTED',
        productId: 'prod-jbl',
        customerConfirmed: true
      }
    };
    db.customers.set(customer.id, customer);

    const chat = { id: 'chat-3', tenantId: tenant.id, customerId: customer.id };
    db.chats.set(chat.id, chat);

    // Secuencia previa en NEUTRALIZED_INBOUND (como ocurre al entrar mensaje)
    const seq = {
      id: 'seq-c',
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      status: 'NEUTRALIZED_INBOUND',
      currentAttempt: 0,
      nextRunAt: new Date(Date.now() + 100000)
    };
    db.followUpSequences.set(seq.id, seq);

    // LLM responde texto plano, toolCalls = 0 (NO llamó update_commercial_state)
    const inbound = {
      id: 'msg-c',
      chatId: chat.id,
      senderRole: 'contact',
      content: 'No deseo el producto, gracias',
      createdAt: new Date()
    };

    // La guarda backend en evaluateAndScheduleFollowUp actúa de forma fail-closed
    const res = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentCommercialState: customer.commercialState,
      currentStage: customer.commercialState.currentStage,
      lastInboundMessage: inbound,
      prismaClient: db
    });

    assert.strictEqual(res.scheduled, false);
    assert.strictEqual(res.reason, 'OPPORTUNITY_REJECTED');
    const seqAfter = db.followUpSequences.get(seq.id);
    assert.strictEqual(seqAfter.status, 'CANCELLED');
    assert.strictEqual(seqAfter.cancelReason, 'OPPORTUNITY_REJECTED');
    assert.strictEqual(seqAfter.nextRunAt, null);
  });

  // TEST D: PRODUCT_REJECTION_IS_NOT_GLOBAL_OPTOUT
  await runTest('D: PRODUCT_REJECTION_IS_NOT_GLOBAL_OPTOUT', async () => {
    const db = createMockDb();
    const tenant = { id: 'ten-4', active: true, followUpEnabled: true, timezone: 'America/Lima' };
    db.tenants.set(tenant.id, tenant);

    const customer = {
      id: 'cust-4',
      tenantId: tenant.id,
      phone: '51999999994',
      commercialState: {
        currentStage: 'PRODUCT_SELECTED',
        productId: 'prod-jbl',
        customerConfirmed: true
      },
      followUpSuppressed: false,
      isBanned: false,
      isBotPaused: false
    };
    db.customers.set(customer.id, customer);

    // Rechazo de producto
    await handleOpportunityRejection({
      tenant,
      customer: db.customers.get(customer.id),
      clientNumber: '51999999994',
      prismaClient: db
    });

    const custAfter = db.customers.get(customer.id);
    assert.strictEqual(custAfter.followUpSuppressed, false, 'followUpSuppressed NO debe ser true');
    assert.strictEqual(custAfter.isBanned, false, 'No debe ser baneado');
    assert.strictEqual(custAfter.isBotPaused, false, 'Bot no debe estar pausado');
    assert.strictEqual(custAfter.commercialState.currentStage, 'EXPLORING', 'Stage debe ser EXPLORING');

    // Mensaje posterior preguntando por otro producto
    const nextInboundText = '¿Qué otros parlantes tienes?';
    assert.strictEqual(isExplicitOpportunityRejection(nextInboundText), false, 'Consulta no debe ser clasificada como rechazo');
  });

  // TEST E: LATEST_INTENT_WINS
  await runTest('E: LATEST_INTENT_WINS (Rechazo domina sobre selección previa)', async () => {
    const prevTurnIntent = 'Quiero llevar 1 parlante JBL';
    assert.strictEqual(isExplicitOpportunityRejection(prevTurnIntent), false);

    const latestTurnIntent = 'No, mejor ya no me interesa el JBL';
    assert.strictEqual(isExplicitOpportunityRejection(latestTurnIntent), true);

    const db = createMockDb();
    const tenant = { id: 'ten-5', active: true, followUpEnabled: true, timezone: 'America/Lima' };
    const customer = {
      id: 'cust-5',
      tenantId: tenant.id,
      phone: '51999999995',
      commercialState: {
        currentStage: 'PRODUCT_SELECTED',
        productName: 'JBL go 4',
        customerConfirmed: true
      }
    };
    db.customers.set(customer.id, customer);

    const res = await handleOpportunityRejection({
      tenant,
      customer: db.customers.get(customer.id),
      clientNumber: '51999999995',
      prismaClient: db
    });

    assert.strictEqual(res.state.currentStage, 'EXPLORING');
    assert.strictEqual(res.state.productName, undefined);
    assert.strictEqual(res.state.customerConfirmed, undefined);
  });

  // TEST F: CLOSED/PAID/HANDOFF invariants siguen intactos
  await runTest('F: CLOSED/PAID/HANDOFF invariants siguen intactos', async () => {
    const db = createMockDb();
    const tenant = { id: 'ten-6', active: true, followUpEnabled: true, timezone: 'America/Lima' };
    const customer = { id: 'cust-6', tenantId: tenant.id, phone: '51999999996' };
    db.customers.set(customer.id, customer);

    const seq = {
      id: 'seq-f',
      tenantId: tenant.id,
      customerId: customer.id,
      status: 'SCHEDULED',
      nextRunAt: new Date(Date.now() + 3600000)
    };
    db.followUpSequences.set(seq.id, seq);

    // Cancelar por ORDER_PAID
    await cancelFollowUpOnOrderEvent({
      tenantId: tenant.id,
      customerId: customer.id,
      order: { paymentStatus: 'PAID' },
      prismaClient: db
    });

    const seqPaid = db.followUpSequences.get(seq.id);
    assert.strictEqual(seqPaid.status, 'CANCELLED');
    assert.strictEqual(seqPaid.cancelReason, 'ORDER_PAID');
    assert.strictEqual(seqPaid.nextRunAt, null, 'nextRunAt debe ser null tras cancelación');
  });

  // TEST G: REJECTION_PRODUCT_VARIANT_NOT_OPPORTUNITY
  await runTest('G: REJECTION_PRODUCT_VARIANT_NOT_OPPORTUNITY', async () => {
    const variantCases = [
      'No quiero el azul, quiero el negro.',
      'No me interesa ese color, ¿tienes otro?',
      'No me interesa ese tamaño, quiero uno más grande.',
      'No quiero ese modelo, ¿qué otro tienes?'
    ];
    for (const text of variantCases) {
      assert.strictEqual(
        isExplicitOpportunityRejection(text),
        false,
        `Rechazo de variante/atributo "${text}" NO debe ser clasificado como rechazo de oportunidad`
      );
    }
  });

  // TEST H: REJECTION_QUANTITY_CHANGE_NOT_OPPORTUNITY
  await runTest('H: REJECTION_QUANTITY_CHANGE_NOT_OPPORTUNITY', async () => {
    const qtyText = 'No quiero 2, quiero solo 1.';
    assert.strictEqual(
      isExplicitOpportunityRejection(qtyText),
      false,
      'Cambio de cantidad NO debe ser clasificado como rechazo de oportunidad'
    );
  });

  // TEST I: REJECTION_PAYMENT_METHOD_NOT_OPPORTUNITY
  await runTest('I: REJECTION_PAYMENT_METHOD_NOT_OPPORTUNITY', async () => {
    const payText = 'No quiero pagar con tarjeta, ¿puedo pagar de otra forma?';
    assert.strictEqual(
      isExplicitOpportunityRejection(payText),
      false,
      'Objeción de forma de pago NO debe ser clasificada como rechazo de oportunidad'
    );
  });

  // TEST J: REJECTION_DELIVERY_METHOD_NOT_OPPORTUNITY
  await runTest('J: REJECTION_DELIVERY_METHOD_NOT_OPPORTUNITY', async () => {
    const deliveryText = 'No quiero delivery, prefiero recogerlo.';
    assert.strictEqual(
      isExplicitOpportunityRejection(deliveryText),
      false,
      'Objeción de delivery NO debe ser clasificada como rechazo de oportunidad'
    );
  });

  // TEST K: PRODUCT_SWITCH_NOT_GLOBAL_REJECTION
  await runTest('K: PRODUCT_SWITCH_NOT_GLOBAL_REJECTION', async () => {
    const switchCases = [
      'No quiero el JBL Go 4, pero sí quiero otro parlante.',
      'Ese no me interesa, muéstrame otro.'
    ];
    for (const text of switchCases) {
      assert.strictEqual(
        isExplicitOpportunityRejection(text),
        false,
        `Cambio de producto "${text}" NO debe ser clasificado como abandono de oportunidad`
      );
    }
  });

  // TEST L: EXPLICIT_FULL_REJECTION_STILL_CANCELS
  await runTest('L: EXPLICIT_FULL_REJECTION_STILL_CANCELS', async () => {
    const fullRejectionCases = [
      'Ya no me interesa el JBL.',
      'No quiero comprarlo.',
      'Mejor ya no, gracias.',
      'Descarto ese producto.',
      'Cancela la compra.',
      'No lo voy a llevar.'
    ];

    for (const text of fullRejectionCases) {
      assert.strictEqual(
        isExplicitOpportunityRejection(text),
        true,
        `Rechazo explícito "${text}" DEBE ser clasificado como rechazo de oportunidad (true)`
      );

      const db = createMockDb();
      const tenant = { id: 'ten-l', active: true, followUpEnabled: true, timezone: 'America/Lima' };
      const customer = {
        id: 'cust-l',
        tenantId: tenant.id,
        phone: '51999999990',
        commercialState: { currentStage: 'PRODUCT_SELECTED', productId: 'p-1', customerConfirmed: true }
      };
      db.customers.set(customer.id, customer);

      const seq = {
        id: `seq-${Math.random()}`,
        tenantId: tenant.id,
        customerId: customer.id,
        status: 'SCHEDULED',
        currentAttempt: 0,
        nextRunAt: new Date(Date.now() + 3600000)
      };
      db.followUpSequences.set(seq.id, seq);

      const res = await evaluateAndScheduleFollowUp({
        tenantId: tenant.id,
        customerId: customer.id,
        chatId: 'chat-l',
        currentCommercialState: customer.commercialState,
        currentStage: customer.commercialState.currentStage,
        lastInboundMessage: { content: text },
        prismaClient: db
      });

      assert.strictEqual(res.scheduled, false, `Texto "${text}" no debe programar`);
      assert.strictEqual(res.reason, 'OPPORTUNITY_REJECTED', `Texto "${text}" debe retornar OPPORTUNITY_REJECTED`);
      const seqAfter = db.followUpSequences.get(seq.id);
      assert.strictEqual(seqAfter.status, 'CANCELLED', `Texto "${text}" debe cancelar secuencia`);
      assert.strictEqual(seqAfter.cancelReason, 'OPPORTUNITY_REJECTED');
      assert.strictEqual(seqAfter.nextRunAt, null);
    }
  });

  console.log('\n======================================================================');
  console.log(`🏁 SUITE CASE D COMPLETADA: ${passedTests}/${totalTests} PASARON (100%)`);
  console.log('======================================================================\n');
}

main().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
