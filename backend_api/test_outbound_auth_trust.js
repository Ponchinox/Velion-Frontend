process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import {
  evaluateAndScheduleFollowUp,
  shouldCreateOrRefreshFollowUp
} from './src/services/followUpService.js';

console.log('======================================================================');
console.log('🧪 OUTBOUND AUTH TRUST + FOLLOW-UP RECOVERY TEST SUITE (TC-AUTH-01 TO TC-AUTH-06)');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;
let prisma = null;

async function runTest(name, fn) {
  totalTests++;
  prisma = createMockPrisma();
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
 * Deterministic In-Memory Prisma Mock (same pattern as test_follow_up_v1_suite.js)
 */
function createMockPrisma() {
  const tenants = new Map();
  const customers = new Map();
  const chats = new Map();
  const contacts = new Map();
  const messages = new Map();
  const orders = new Map();
  const sequences = new Map();
  const attempts = new Map();

  let idCounter = 1;
  const genId = (prefix = 'id') => `${prefix}_${idCounter++}_${Math.random().toString(36).slice(2, 7)}`;

  const mock = {
    tenant: {
      findUnique: async ({ where }) => tenants.get(where.id) || null,
      update: async ({ where, data }) => {
        const t = tenants.get(where.id);
        if (!t) throw new Error('Tenant not found');
        const updated = { ...t, ...data };
        tenants.set(where.id, updated);
        return updated;
      },
      create: async ({ data }) => {
        const id = data.id || genId('tenant');
        const t = { id, followUpEnabled: false, timezone: null, ...data };
        tenants.set(id, t);
        return t;
      }
    },
    customer: {
      findUnique: async ({ where }) => customers.get(where.id) || null,
      findFirst: async ({ where }) => {
        for (const c of customers.values()) {
          if (where.tenantId && c.tenantId !== where.tenantId) continue;
          if (where.phone && c.phone === where.phone) return c;
          if (!where.phone) return c;
        }
        return null;
      },
      update: async ({ where, data }) => {
        const c = customers.get(where.id);
        if (!c) throw new Error('Customer not found');
        const updated = { ...c, ...data };
        customers.set(where.id, updated);
        return updated;
      },
      create: async ({ data }) => {
        const id = data.id || genId('cust');
        const c = { id, followUpSuppressed: false, isBotPaused: false, ...data };
        customers.set(id, c);
        return c;
      }
    },
    contact: {
      findFirst: async ({ where }) => {
        for (const ct of contacts.values()) {
          if (where.tenantId && ct.tenantId !== where.tenantId) continue;
          return ct;
        }
        return null;
      },
      create: async ({ data }) => {
        const id = data.id || genId('contact');
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
          if (where.contactId && ch.contactId !== where.contactId) continue;
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
        if (orderBy?.createdAt === 'desc') {
          list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }
        return list[0] || null;
      },
      create: async ({ data }) => {
        const id = data.id || genId('msg');
        const msg = { id, createdAt: new Date(), ...data };
        messages.set(id, msg);
        return msg;
      }
    },
    order: {
      findUnique: async ({ where }) => orders.get(where.id) || null
    },
    followUpSequence: {
      count: async ({ where }) => {
        let list = Array.from(sequences.values());
        if (where?.tenantId) list = list.filter(s => s.tenantId === where.tenantId);
        if (where?.customerId) list = list.filter(s => s.customerId === where.customerId);
        if (where?.status?.in) list = list.filter(s => where.status.in.includes(s.status));
        else if (where?.status) list = list.filter(s => s.status === where.status);
        return list.length;
      },
      findFirst: async ({ where, include }) => {
        let list = Array.from(sequences.values());
        if (where.tenantId) list = list.filter(s => s.tenantId === where.tenantId);
        if (where.customerId) list = list.filter(s => s.customerId === where.customerId);
        if (where.status) {
          if (typeof where.status === 'object' && where.status.in) {
            list = list.filter(s => where.status.in.includes(s.status));
          } else {
            list = list.filter(s => s.status === where.status);
          }
        }
        const item = list[0] || null;
        if (!item) return null;
        const res = { ...item };
        if (include?.attempts) {
          res.attempts = Array.from(attempts.values()).filter(a => a.sequenceId === item.id);
        }
        return res;
      },
      findMany: async ({ where }) => {
        let list = Array.from(sequences.values());
        if (where?.tenantId) list = list.filter(s => s.tenantId === where.tenantId);
        if (where?.customerId) list = list.filter(s => s.customerId === where.customerId);
        if (where?.status?.in) list = list.filter(s => where.status.in.includes(s.status));
        return list;
      },
      create: async ({ data }) => {
        const activeStatuses = ['SCHEDULED', 'PROCESSING', 'NEUTRALIZED_INBOUND', 'WAITING_NEXT'];
        if (activeStatuses.includes(data.status)) {
          for (const s of sequences.values()) {
            if (s.tenantId === data.tenantId && s.customerId === data.customerId && activeStatuses.includes(s.status)) {
              const err = new Error('Unique constraint failed on the fields: (`tenantId`,`customerId`)');
              err.code = 'P2002';
              throw err;
            }
          }
        }
        const id = data.id || genId('seq');
        const seq = {
          id,
          currentAttempt: 0,
          maxAttempts: 3,
          recoveredAt: null,
          recoveredOrderId: null,
          cancelReason: null,
          claimedAt: null,
          nextRunAt: null,
          lastRunAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data
        };
        sequences.set(id, seq);
        return seq;
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
        for (const [id, s] of sequences.entries()) {
          let match = true;
          if (where.tenantId && s.tenantId !== where.tenantId) match = false;
          if (where.customerId && s.customerId !== where.customerId) match = false;
          if (where.status?.in && !where.status.in.includes(s.status)) match = false;
          if (match) {
            sequences.set(id, { ...s, ...data, updatedAt: new Date() });
            count++;
          }
        }
        return { count };
      }
    },
    followUpAttempt: {
      findUnique: async () => null,
      upsert: async ({ create }) => {
        const id = create.id || genId('att');
        const att = { id, createdAt: new Date(), ...create };
        attempts.set(id, att);
        return att;
      }
    },
    humanHandoffEvent: {
      findFirst: async () => null
    },
    $transaction: async (operations) => {
      const results = [];
      for (const op of (Array.isArray(operations) ? operations : [operations])) {
        results.push(await op);
      }
      return results;
    },
    _sequences: sequences,
    _attempts: attempts,
    _customers: customers,
    _tenants: tenants,
    _chats: chats,
    _messages: messages,
    _contacts: contacts
  };

  return mock;
}

// Shared helpers

function createTestFixture(p) {
  const tenantId = p?.tenantId || 'tenant_auth_test';
  const customerId = p?.customerId || 'cust_auth_test';
  const chatId = p?.chatId || 'chat_auth_test';

  const tenant = {
    id: tenantId,
    name: 'Test Tenant',
    followUpEnabled: true,
    timezone: 'America/Lima',
    active: true,
    aiEnabled: true,
    ...(p?.tenant || {})
  };

  const customer = {
    id: customerId,
    name: 'Test Customer',
    phone: '51984363997@s.whatsapp.net',
    tenantId,
    followUpSuppressed: false,
    followUpOptOutAt: null,
    ...(p?.customer || {})
  };

  const chat = {
    id: chatId,
    tenantId,
    contactId: 'contact_auth_test',
    botPaused: false,
    ...(p?.chat || {})
  };

  const lastInboundMessage = {
    id: 'msg_inbound_test',
    chatId,
    senderRole: 'contact',
    content: 'Si, quiero llevar 1',
    createdAt: new Date(),
    ...(p?.lastInboundMessage || {})
  };

  prisma._tenants.set(tenantId, tenant);
  prisma._customers.set(customerId, customer);
  prisma._chats.set(chatId, chat);
  prisma._messages.set(lastInboundMessage.id, lastInboundMessage);

  return { tenant, customer, chat, lastInboundMessage };
}

// TC-AUTH-01: Inbound webhook key never used for outbound (trust boundary)

await runTest('TC-AUTH-01: gatewayCtx uses process.env.EVOLUTION_API_KEY, not inbound webhook header', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const controllerPath = path.default.resolve('./src/controllers/whatsappController.js');
  const source = fs.default.readFileSync(controllerPath, 'utf8');

  const gatewayCtxMatch = source.match(/const gatewayCtx\s*=\s*\{[^}]+\}/g);
  assert.ok(gatewayCtxMatch, 'gatewayCtx definition found');
  assert.ok(gatewayCtxMatch.length >= 1, 'At least one gatewayCtx definition');

  for (const match of gatewayCtxMatch) {
    assert.ok(
      !match.includes('requestApiKey'),
      `gatewayCtx must NOT use requestApiKey. Found: ${match}`
    );
  }

  assert.ok(
    source.includes("const authoritativeApiKey = (process.env.EVOLUTION_API_KEY || '').trim()"),
    'authoritativeApiKey must be defined from process.env.EVOLUTION_API_KEY'
  );

  const afterGatewayCtx = source.split('const gatewayCtx')[1] || '';
  const sendPresenceSection = afterGatewayCtx.match(/sendPresence[^}]+getEvoHeaders\([^)]*\)/g);
  if (sendPresenceSection) {
    for (const sp of sendPresenceSection) {
      assert.ok(
        !sp.includes('getEvoHeaders(requestApiKey)'),
        `sendPresence must NOT use getEvoHeaders(requestApiKey). Found: ${sp}`
      );
    }
  }
});

// TC-AUTH-02: Gateway failure (401) -> no false "sent", no follow-up creation

await runTest('TC-AUTH-02: Gateway 401 code path: no success log, no false sent, no post-dispatch follow-up', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const controllerPath = path.default.resolve('./src/controllers/whatsappController.js');
  const source = fs.default.readFileSync(controllerPath, 'utf8');

  const outboundTruthGateIdx = source.indexOf('OUTBOUND TRUTH GATE');
  assert.ok(outboundTruthGateIdx > 0, 'OUTBOUND TRUTH GATE comment exists in source');

  const afterSendReply = source.substring(outboundTruthGateIdx, outboundTruthGateIdx + 1500);
  assert.ok(afterSendReply.includes('outboundFailed = true'), 'outboundFailed flag is set on !msgId');
  assert.ok(afterSendReply.includes('break;'), 'break statement stops further dispatch on failure');

  const followUpGateSection = source.match(/FOLLOW-UP EVALUATION POST-DISPATCH[\s\S]{0,200}/);
  assert.ok(followUpGateSection, 'Follow-up post-dispatch section found');
  assert.ok(
    followUpGateSection[0].includes('!outboundFailed'),
    `Follow-up gate must include !outboundFailed check`
  );
});

// TC-AUTH-03: Gateway 200 + providerMessageId -> normal behavior intact

await runTest('TC-AUTH-03: Gateway success path preserved — evaluateAndScheduleFollowUp creates sequence normally', async () => {
  const { tenant, customer, chat, lastInboundMessage } = createTestFixture();

  const result = await evaluateAndScheduleFollowUp({
    tenant,
    customer,
    chat,
    currentStage: 'PRODUCT_SELECTED',
    productId: 'prod_jbl_go4',
    productName: 'JBL go 4',
    lastInboundMessage,
    prismaClient: prisma
  });

  assert.ok(result.scheduled, 'Sequence should be created');
  assert.strictEqual(result.action, 'CREATED', 'Action should be CREATED');
  assert.ok(result.sequenceId, 'Sequence ID should be returned');

  const seq = prisma._sequences.get(result.sequenceId);
  assert.strictEqual(seq.stageAtCreation, 'PRODUCT_SELECTED');
  assert.strictEqual(seq.productId, 'prod_jbl_go4');
  assert.strictEqual(seq.productName, 'JBL go 4');
  assert.strictEqual(seq.status, 'SCHEDULED');
  assert.strictEqual(seq.currentAttempt, 0);
});

// TC-AUTH-04: Sequence with Attempt1 SENT + client responds -> RECOVERED

await runTest('TC-AUTH-04: Existing sequence (attempt1 SENT) + client responds -> old RECOVERED + new SCHEDULED', async () => {
  const { tenant, customer, chat, lastInboundMessage } = createTestFixture();

  const existingSeqId = 'seq_existing_attempt1';
  await prisma.followUpSequence.create({
    data: {
      id: existingSeqId,
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      stageAtCreation: 'PRODUCT_SELECTED',
      status: 'WAITING_NEXT',
      currentAttempt: 1,
      maxAttempts: 3,
      anchorAt: new Date(Date.now() - 6 * 3600000),
      nextRunAt: new Date(Date.now() + 24 * 3600000),
      productId: 'prod_old',
      productName: 'Old Product'
    }
  });

  const result = await evaluateAndScheduleFollowUp({
    tenant,
    customer,
    chat,
    currentStage: 'PRODUCT_SELECTED',
    productId: 'prod_jbl_go4',
    productName: 'JBL go 4',
    lastInboundMessage,
    prismaClient: prisma
  });

  assert.ok(result.scheduled, 'New sequence should be created');
  assert.strictEqual(result.action, 'RECOVERED_AND_NEW_CREATED');

  const oldSeq = prisma._sequences.get(existingSeqId);
  assert.strictEqual(oldSeq.status, 'RECOVERED', 'Old sequence status must be RECOVERED');
  assert.ok(oldSeq.recoveredAt, 'recoveredAt must be set');

  const newSeq = prisma._sequences.get(result.sequenceId);
  assert.strictEqual(newSeq.status, 'SCHEDULED');
  assert.strictEqual(newSeq.currentAttempt, 0);
  assert.strictEqual(newSeq.stageAtCreation, 'PRODUCT_SELECTED', 'stageAtCreation must be PRODUCT_SELECTED');
  assert.strictEqual(newSeq.productId, 'prod_jbl_go4', 'productId preserved');
  assert.strictEqual(newSeq.productName, 'JBL go 4', 'productName preserved');
});

// TC-AUTH-05: RECOVERED -> new sequence uses normalizedCommercialState

await runTest('TC-AUTH-05: RECOVERED path uses normalized state — stageAtCreation always defined, context snapshot correct', async () => {
  const { tenant, customer, chat, lastInboundMessage } = createTestFixture();

  await prisma.followUpSequence.create({
    data: {
      id: 'seq_recover_norm',
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      stageAtCreation: 'DETAILS_PROVIDED',
      status: 'WAITING_NEXT',
      currentAttempt: 2,
      maxAttempts: 3,
      anchorAt: new Date(Date.now() - 48 * 3600000),
      nextRunAt: new Date(Date.now() + 48 * 3600000),
      productId: 'prod_old',
      productName: 'Old Product'
    }
  });

  const result = await evaluateAndScheduleFollowUp({
    tenant,
    customer,
    chat,
    currentStage: 'PRODUCT_SELECTED',
    productId: 'prod_new_123',
    productName: 'New Speaker',
    lastInboundMessage,
    prismaClient: prisma
  });

  assert.ok(result.scheduled, 'New sequence should be created after RECOVERED');
  assert.strictEqual(result.action, 'RECOVERED_AND_NEW_CREATED');

  const newSeq = prisma._sequences.get(result.sequenceId);

  assert.strictEqual(newSeq.stageAtCreation, 'PRODUCT_SELECTED', 'stageAtCreation must come from normalizedCommercialState');
  assert.notStrictEqual(newSeq.stageAtCreation, undefined, 'stageAtCreation must NEVER be undefined');

  assert.strictEqual(newSeq.productId, 'prod_new_123');
  assert.strictEqual(newSeq.productName, 'New Speaker');

  assert.ok(newSeq.contextSnapshot, 'contextSnapshot must exist');
  assert.strictEqual(newSeq.contextSnapshot.productId, 'prod_new_123', 'contextSnapshot.productId must match');
  assert.strictEqual(newSeq.contextSnapshot.productName, 'New Speaker', 'contextSnapshot.productName must match');
});

// TC-AUTH-06: Idempotency — never more than 1 active sequence per customer

await runTest('TC-AUTH-06: Partial unique index — never more than 1 active sequence per customer after RECOVERED cycle', async () => {
  const { tenant, customer, chat, lastInboundMessage } = createTestFixture();

  const r1 = await evaluateAndScheduleFollowUp({
    tenant, customer, chat,
    currentStage: 'PRODUCT_SELECTED',
    productId: 'prod_1',
    productName: 'Product 1',
    lastInboundMessage,
    prismaClient: prisma
  });
  assert.ok(r1.scheduled);

  await prisma.followUpSequence.update({
    where: { id: r1.sequenceId },
    data: { currentAttempt: 1, status: 'WAITING_NEXT' }
  });

  const r2 = await evaluateAndScheduleFollowUp({
    tenant, customer, chat,
    currentStage: 'DETAILS_PROVIDED',
    productId: 'prod_1',
    productName: 'Product 1',
    lastInboundMessage: { ...lastInboundMessage, id: 'msg_2', createdAt: new Date() },
    prismaClient: prisma
  });
  assert.ok(r2.scheduled);
  assert.strictEqual(r2.action, 'RECOVERED_AND_NEW_CREATED');

  const activeCount = await prisma.followUpSequence.count({
    where: {
      tenantId: tenant.id,
      customerId: customer.id,
      status: { in: ['SCHEDULED', 'PROCESSING', 'NEUTRALIZED_INBOUND', 'WAITING_NEXT'] }
    }
  });
  assert.strictEqual(activeCount, 1, 'Exactly 1 active sequence after RECOVERED cycle');

  let p2002Thrown = false;
  try {
    await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        status: 'SCHEDULED',
        stageAtCreation: 'PRODUCT_SELECTED',
        currentAttempt: 0,
        maxAttempts: 3,
        anchorAt: new Date(),
        nextRunAt: new Date()
      }
    });
  } catch (err) {
    if (err.code === 'P2002') p2002Thrown = true;
  }
  assert.ok(p2002Thrown, 'Partial unique index must reject duplicate active sequence');
});

console.log(`\n======================================================================`);
console.log(`🏁 OUTBOUND AUTH + FOLLOW-UP RECOVERY SUITE: ${passedTests}/${totalTests} PASS (${Math.round(100 * passedTests / totalTests)}%)`);
console.log(`======================================================================\n`);

if (passedTests < totalTests) {
  process.exit(1);
}
