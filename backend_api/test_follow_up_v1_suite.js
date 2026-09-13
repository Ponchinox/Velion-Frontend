process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  isValidIanaTimezone,
  applyQuietHours,
  calculateAttemptTimestamp,
  parseCustomerExplicitTiming,
  isFollowUpOptOutRequested,
  shouldCreateOrRefreshFollowUp,
  evaluateAndScheduleFollowUp,
  cancelActiveFollowUpOnInboundMessage,
  cancelFollowUpOnHandoff,
  cancelFollowUpOnOrderEvent,
  handleFollowUpOptOut
} from './src/services/followUpService.js';
import {
  getTenantVerifiedProduct,
  getDeterministicFallbackMessage,
  generateFollowUpMessage
} from './src/services/followUpAiService.js';
import {
  claimDueSequence,
  recoverStaleProcessing,
  processFollowUpSequence as processSingleSequence,
  setFollowUpGatewaySender
} from './src/services/followUpWorker.js';
import { getFollowUpSummary } from './src/controllers/followUpController.js';

console.log('======================================================================');
console.log('🧪 FOLLOW-UP V1 DETERMINISTIC TEST SUITE (TC-01 TO TC-66)');
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
 * Deterministic In-Memory Prisma Mock for Follow-up testing
 */
function createMockPrisma() {
  const tenants = new Map();
  const customers = new Map();
  const chats = new Map();
  const contacts = new Map();
  const messages = new Map();
  const orders = new Map();
  const products = new Map();
  const users = new Map();
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
      findUnique: async ({ where }) => {
        if (where.id) return customers.get(where.id) || null;
        if (where.tenantId_phone) {
          for (const c of customers.values()) {
            if (c.tenantId === where.tenantId_phone.tenantId && c.phone === where.tenantId_phone.phone) {
              return c;
            }
          }
        }
        return null;
      },
      findFirst: async ({ where }) => {
        for (const c of customers.values()) {
          if (where.tenantId && c.tenantId !== where.tenantId) continue;
          if (where.phone && c.phone === where.phone) return c;
          if (where.OR) {
            const matchesOr = where.OR.some(cond => cond.phone && (c.phone === cond.phone || c.phone.includes(cond.phone?.contains || '')));
            if (matchesOr) return c;
          }
          if (!where.phone && !where.OR) return c;
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
          if (where.id && ct.id !== where.id) continue;
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
        if (where.tenantId) list = list.filter(m => m.tenantId === where.tenantId);
        if (where.senderRole) {
          if (typeof where.senderRole === 'object' && where.senderRole.in) {
            list = list.filter(m => where.senderRole.in.includes(m.senderRole));
          } else {
            list = list.filter(m => m.senderRole === where.senderRole);
          }
        }
        if (where.createdAt?.gt) {
          list = list.filter(m => new Date(m.createdAt) > new Date(where.createdAt.gt));
        }
        if (where.createdAt?.gte) {
          list = list.filter(m => new Date(m.createdAt) >= new Date(where.createdAt.gte));
        }
        if (orderBy?.createdAt === 'desc') {
          list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        } else {
          list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
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
      findUnique: async ({ where }) => orders.get(where.id) || null,
      findMany: async ({ where }) => {
        let list = Array.from(orders.values());
        if (where?.tenantId) list = list.filter(o => o.tenantId === where.tenantId);
        if (where?.paymentStatus) list = list.filter(o => o.paymentStatus === where.paymentStatus);
        if (where?.id?.in) list = list.filter(o => where.id.in.includes(o.id));
        return list;
      },
      create: async ({ data }) => {
        const id = data.id || genId('ord');
        const ord = { id, status: 'PENDING', paymentStatus: 'PENDING', totalAmount: 100, ...data };
        orders.set(id, ord);
        return ord;
      },
      update: async ({ where, data }) => {
        const ord = orders.get(where.id);
        if (!ord) throw new Error('Order not found');
        const updated = { ...ord, ...data };
        orders.set(where.id, updated);
        return updated;
      }
    },
    product: {
      findFirst: async ({ where }) => {
        for (const p of products.values()) {
          let match = true;
          if (where.id && p.id !== where.id) match = false;
          if (where.name && p.name !== where.name) match = false;
          if (where.user?.tenantId && p.tenantId !== where.user.tenantId) match = false;
          if (match) return p;
        }
        return null;
      },
      findUnique: async ({ where }) => {
        if (where.id) return products.get(where.id) || null;
        return null;
      },
      create: async ({ data }) => {
        const id = data.id || genId('prod');
        const prod = { id, isAvailable: true, ...data };
        products.set(id, prod);
        return prod;
      }
    },
    followUpSequence: {
      count: async ({ where }) => {
        let list = Array.from(sequences.values());
        if (where?.tenantId) list = list.filter(s => s.tenantId === where.tenantId);
        if (where?.status?.in) list = list.filter(s => where.status.in.includes(s.status));
        else if (where?.status) list = list.filter(s => s.status === where.status);
        return list.length;
      },
      findFirst: async ({ where, include, orderBy }) => {
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
        if (orderBy?.createdAt === 'desc') {
          list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }
        const item = list[0] || null;
        if (!item) return null;
        const res = { ...item };
        if (include?.attempts) {
          res.attempts = Array.from(attempts.values()).filter(a => a.sequenceId === item.id);
        }
        if (include?.tenant) res.tenant = tenants.get(item.tenantId) || null;
        if (include?.customer) res.customer = customers.get(item.customerId) || null;
        return res;
      },
      findUnique: async ({ where, include }) => {
        const s = sequences.get(where.id) || null;
        if (!s) return null;
        const res = { ...s };
        if (include?.attempts) {
          res.attempts = Array.from(attempts.values()).filter(a => a.sequenceId === s.id);
        }
        if (include?.tenant) res.tenant = tenants.get(s.tenantId) || null;
        if (include?.customer) res.customer = customers.get(s.customerId) || null;
        return res;
      },
      findMany: async ({ where, include, select, orderBy }) => {
        let list = Array.from(sequences.values());
        if (where?.status?.in) list = list.filter(s => where.status.in.includes(s.status));
        if (where?.status && typeof where.status === 'string') list = list.filter(s => s.status === where.status);
        if (where?.tenantId) list = list.filter(s => s.tenantId === where.tenantId);
        if (where?.claimedAt?.lt) list = list.filter(s => s.claimedAt && new Date(s.claimedAt) < new Date(where.claimedAt.lt));
        if (where?.recoveredOrderId && where.recoveredOrderId.not === null) {
          list = list.filter(s => s.recoveredOrderId !== null && s.recoveredOrderId !== undefined);
        }
        return list.map(s => {
          const item = { ...s };
          if (include?.tenant) item.tenant = tenants.get(s.tenantId) || null;
          if (include?.customer) item.customer = customers.get(s.customerId) || null;
          const attOptions = include?.attempts || select?.attempts;
          if (attOptions) {
            let attList = Array.from(attempts.values()).filter(a => a.sequenceId === s.id);
            if (attOptions.where?.status) attList = attList.filter(a => a.status === attOptions.where.status);
            if (attOptions.orderBy?.sentAt === 'desc') {
              attList.sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0));
            }
            item.attempts = attList;
          }
          return item;
        });
      },
      create: async ({ data }) => {
        // Enforce Partial Unique Index: only 1 active per tenantId + customerId
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
      findUnique: async ({ where }) => {
        if (where.id) return attempts.get(where.id) || null;
        if (where.sequenceId_attemptNumber) {
          for (const a of attempts.values()) {
            if (a.sequenceId === where.sequenceId_attemptNumber.sequenceId && a.attemptNumber === where.sequenceId_attemptNumber.attemptNumber) {
              return a;
            }
          }
        }
        return null;
      },
      upsert: async ({ where, create, update }) => {
        let existing = null;
        if (where.id) existing = attempts.get(where.id);
        if (!existing && where.sequenceId_attemptNumber) {
          for (const a of attempts.values()) {
            if (a.sequenceId === where.sequenceId_attemptNumber.sequenceId && a.attemptNumber === where.sequenceId_attemptNumber.attemptNumber) {
              existing = a;
              break;
            }
          }
        }
        if (existing) {
          const updated = { ...existing, ...update, updatedAt: new Date() };
          attempts.set(existing.id, updated);
          return updated;
        } else {
          const id = create.id || genId('att');
          const created = { id, createdAt: new Date(), updatedAt: new Date(), ...create };
          attempts.set(id, created);
          return created;
        }
      },
      findFirst: async ({ where, orderBy }) => {
        let list = Array.from(attempts.values());
        if (where.sequenceId) list = list.filter(a => a.sequenceId === where.sequenceId);
        if (where.attemptNumber) list = list.filter(a => a.attemptNumber === where.attemptNumber);
        if (where.status) {
          if (typeof where.status === 'object' && where.status.in) {
            list = list.filter(a => where.status.in.includes(a.status));
          } else {
            list = list.filter(a => a.status === where.status);
          }
        }
        if (orderBy?.attemptNumber === 'desc') {
          list.sort((a, b) => b.attemptNumber - a.attemptNumber);
        }
        return list[0] || null;
      },
      findMany: async ({ where }) => {
        let list = Array.from(attempts.values());
        if (where.sequenceId) list = list.filter(a => a.sequenceId === where.sequenceId);
        return list;
      },
      create: async ({ data }) => {
        // Enforce @@unique([sequenceId, attemptNumber])
        for (const a of attempts.values()) {
          if (a.sequenceId === data.sequenceId && a.attemptNumber === data.attemptNumber) {
            const err = new Error('Unique constraint failed on the fields: (`sequenceId`,`attemptNumber`)');
            err.code = 'P2002';
            throw err;
          }
        }
        const id = data.id || genId('att');
        const att = { id, createdAt: new Date(), updatedAt: new Date(), ...data };
        attempts.set(id, att);
        return att;
      },
      count: async ({ where }) => {
        let list = Array.from(attempts.values());
        if (where?.status) list = list.filter(a => a.status === where.status);
        if (where?.sequence?.tenantId) {
          list = list.filter(a => {
            const seq = sequences.get(a.sequenceId);
            return seq && seq.tenantId === where.sequence.tenantId;
          });
        }
        return list.length;
      },
      update: async ({ where, data }) => {
        const a = attempts.get(where.id);
        if (!a) throw new Error('Attempt not found');
        const updated = { ...a, ...data, updatedAt: new Date() };
        attempts.set(where.id, updated);
        return updated;
      }
    },
    registeredWhatsAppNumber: {
      findFirst: async () => null
    },
    $queryRaw: async (query, ...params) => {
      // Mock claim query with FOR UPDATE SKIP LOCKED
      const now = new Date();
      const active = Array.from(sequences.values()).filter(s =>
        ['SCHEDULED', 'WAITING_NEXT'].includes(s.status) &&
        s.nextRunAt && new Date(s.nextRunAt) <= now
      );
      if (active.length === 0) return [];
      const seq = active[0];
      seq.status = 'PROCESSING';
      seq.claimedAt = now;
      sequences.set(seq.id, seq);
      return [seq];
    },
    $executeRaw: async (query, ...params) => {
      return 1;
    },
    $transaction: async (ops) => {
      if (typeof ops === 'function') {
        return ops(mock);
      }
      if (Array.isArray(ops)) {
        return Promise.all(ops.map(op => typeof op === 'function' ? op(mock) : op));
      }
      return ops;
    }
  };

  return mock;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST CASES
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // TC-01: Inbound message starts sequence in valid stage (PRODUCT_SELECTED)
  await runTest('TC-01: Inbound message starts sequence in valid stage (PRODUCT_SELECTED) at anchorAt + 6h', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990001' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    const inbound = await prisma.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Quiero el reloj negro', createdAt: new Date('2026-09-12T10:00:00Z') }
    });

    const result = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentStage: 'PRODUCT_SELECTED',
      productName: 'Reloj Negro Elegance',
      lastInboundMessage: inbound,
      prismaClient: prisma
    });

    assert(result.scheduled, 'Debe haber programado');
    assert.strictEqual(result.sequence.stageAtCreation, 'PRODUCT_SELECTED');
    assert.strictEqual(result.sequence.status, 'SCHEDULED');
    assert.strictEqual(result.sequence.currentAttempt, 0);
    assert(result.sequence.nextRunAt, 'Debe tener nextRunAt');
  });

  // TC-02: Exploring stage excluded from follow-up creation
  await runTest('TC-02: Exploring stage excluded from follow-up creation', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990002' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    const inbound = await prisma.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Hola buenas tardes' }
    });

    const result = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentStage: 'EXPLORING',
      lastInboundMessage: inbound,
      prismaClient: prisma
    });

    assert.strictEqual(result.scheduled, false);
    assert.strictEqual(result.reason, 'STAGE_NOT_ELIGIBLE');
  });

  // TC-03: Completed or Paid order excludes follow-up creation
  await runTest('TC-03: Completed or Paid order excludes follow-up creation', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990003' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    const order = await prisma.order.create({ data: { tenantId: tenant.id, customerId: customer.id, paymentStatus: 'PAID' } });
    const inbound = await prisma.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Ya pagué' }
    });

    const result = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentStage: 'PAYMENT_PENDING',
      orderId: order.id,
      lastInboundMessage: inbound,
      prismaClient: prisma
    });

    assert.strictEqual(result.scheduled, false);
    assert.strictEqual(result.reason, 'ORDER_ALREADY_PAID_OR_COMPLETED');
  });

  // TC-04: Existing active sequence refreshed with latest anchorAt instead of creating second row
  await runTest('TC-04: Existing active sequence refreshed with latest anchorAt instead of creating second row', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990004' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    const inbound1 = await prisma.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Me interesa', createdAt: new Date('2026-09-12T10:00:00Z') }
    });

    await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentStage: 'PRODUCT_SELECTED',
      lastInboundMessage: inbound1,
      prismaClient: prisma
    });

    const inbound2 = await prisma.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Tienes talla M?', createdAt: new Date('2026-09-12T12:00:00Z') }
    });

    const result2 = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentStage: 'DETAILS_PROVIDED',
      lastInboundMessage: inbound2,
      prismaClient: prisma
    });

    assert.strictEqual(result2.scheduled, true);
    assert.strictEqual(result2.isRefresh, true);

    const allSeq = await prisma.followUpSequence.findMany({ where: { tenantId: tenant.id, customerId: customer.id } });
    assert.strictEqual(allSeq.length, 1, 'No debe haber creado una segunda secuencia');
  });

  // TC-05: Absolute offset calculation for attempt 1 (+6h)
  await runTest('TC-05: Absolute offset calculation for attempt 1 (+6h)', async () => {
    const anchor = new Date('2026-09-12T10:00:00Z');
    const target = calculateAttemptTimestamp(anchor, 1);
    const diffHours = (target.getTime() - anchor.getTime()) / (1000 * 60 * 60);
    assert.strictEqual(diffHours, 6);
  });

  // TC-06: Absolute offset calculation for attempt 2 (+24h)
  await runTest('TC-06: Absolute offset calculation for attempt 2 (+24h)', async () => {
    const anchor = new Date('2026-09-12T10:00:00Z');
    const target = calculateAttemptTimestamp(anchor, 2);
    const diffHours = (target.getTime() - anchor.getTime()) / (1000 * 60 * 60);
    assert.strictEqual(diffHours, 24);
  });

  // TC-07: Absolute offset calculation for attempt 3 (+48h)
  await runTest('TC-07: Absolute offset calculation for attempt 3 (+48h)', async () => {
    const anchor = new Date('2026-09-12T10:00:00Z');
    const target = calculateAttemptTimestamp(anchor, 3);
    const diffHours = (target.getTime() - anchor.getTime()) / (1000 * 60 * 60);
    assert.strictEqual(diffHours, 48);
  });

  // TC-08: Quiet hours rollover (21:00 rolls over to 09:00 next day in local timezone)
  await runTest('TC-08: Quiet hours rollover (21:00 rolls over to 09:00 next day in local timezone)', async () => {
    // 21:00 in America/Lima (UTC-5) is 02:00 UTC next day
    const nightDate = new Date('2026-09-12T21:30:00-05:00');
    const adjusted = applyQuietHours(nightDate, 'America/Lima');
    assert(adjusted.getTime() > nightDate.getTime(), 'Debe posponer al futuro');
    // Check that adjusted hour in America/Lima is 09:00
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', hour: 'numeric', hour12: false });
    assert.strictEqual(Number(formatter.format(adjusted)), 9);
  });

  // TC-09: Quiet hours early morning rollover (04:00 rolls over to 09:00 same day in local timezone)
  await runTest('TC-09: Quiet hours early morning rollover (04:00 rolls over to 09:00 same day)', async () => {
    const morningDate = new Date('2026-09-12T04:30:00-05:00');
    const adjusted = applyQuietHours(morningDate, 'America/Lima');
    assert(adjusted.getTime() > morningDate.getTime(), 'Debe posponer a las 09:00');
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', hour: 'numeric', hour12: false });
    assert.strictEqual(Number(formatter.format(adjusted)), 9);
  });

  // TC-10: Inbound message neutralizes active sequence (SCHEDULED -> NEUTRALIZED_INBOUND)
  await runTest('TC-10: Inbound message neutralizes active sequence (SCHEDULED -> NEUTRALIZED_INBOUND)', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990010' } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, status: 'SCHEDULED', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date() }
    });

    await cancelActiveFollowUpOnInboundMessage({ tenantId: tenant.id, customerId: customer.id, prismaClient: prisma });
    const updated = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(updated.status, 'NEUTRALIZED_INBOUND');
  });

  // TC-11: Inbound message neutralizes WAITING_NEXT sequence
  await runTest('TC-11: Inbound message neutralizes WAITING_NEXT sequence', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990011' } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, status: 'WAITING_NEXT', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date() }
    });

    await cancelActiveFollowUpOnInboundMessage({ tenantId: tenant.id, customerId: customer.id, prismaClient: prisma });
    const updated = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(updated.status, 'NEUTRALIZED_INBOUND');
  });

  // TC-12: Human handoff cancels active sequence (status -> CANCELLED, reason -> HUMAN_HANDOFF)
  await runTest('TC-12: Human handoff cancels active sequence (status -> CANCELLED, reason -> HUMAN_HANDOFF)', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990012' } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, status: 'SCHEDULED', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date() }
    });

    await cancelFollowUpOnHandoff({ tenantId: tenant.id, customerId: customer.id, prismaClient: prisma });
    const updated = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(updated.status, 'CANCELLED');
    assert.strictEqual(updated.cancelReason, 'HUMAN_HANDOFF');
  });

  // TC-13: Expired human handoff does NOT auto-resume cancelled sequence
  await runTest('TC-13: Expired human handoff does NOT auto-resume cancelled sequence', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990013' } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, status: 'CANCELLED', cancelReason: 'HUMAN_HANDOFF', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date() }
    });

    // Verify status remains CANCELLED
    const current = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(current.status, 'CANCELLED');
  });

  // TC-14: Order PAID cancels active sequence with ORDER_PAID
  await runTest('TC-14: Order PAID cancels active sequence with ORDER_PAID', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990014' } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, status: 'SCHEDULED', stageAtCreation: 'PAYMENT_PENDING', anchorAt: new Date() }
    });

    await cancelFollowUpOnOrderEvent({ tenantId: tenant.id, customerId: customer.id, reason: 'ORDER_PAID', orderId: 'ord_14', prismaClient: prisma });
    const updated = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(updated.status, 'CANCELLED');
    assert.strictEqual(updated.cancelReason, 'ORDER_PAID');
    assert.strictEqual(updated.recoveredOrderId, null, 'No atribuye si no hubo intento SENT previo');
  });

  // TC-15: Order COMPLETED cancels active sequence with ORDER_COMPLETED
  await runTest('TC-15: Order COMPLETED cancels active sequence with ORDER_COMPLETED', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990015' } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, status: 'WAITING_NEXT', stageAtCreation: 'PAYMENT_PENDING', anchorAt: new Date() }
    });

    await cancelFollowUpOnOrderEvent({ tenantId: tenant.id, customerId: customer.id, reason: 'ORDER_COMPLETED', prismaClient: prisma });
    const updated = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(updated.status, 'CANCELLED');
    assert.strictEqual(updated.cancelReason, 'ORDER_COMPLETED');
  });

  // TC-16: Order CANCELED cancels active sequence with ORDER_CANCELED
  await runTest('TC-16: Order CANCELED cancels active sequence with ORDER_CANCELED', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990016' } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, status: 'SCHEDULED', stageAtCreation: 'PAYMENT_PENDING', anchorAt: new Date() }
    });

    await cancelFollowUpOnOrderEvent({ tenantId: tenant.id, customerId: customer.id, reason: 'ORDER_CANCELED', prismaClient: prisma });
    const updated = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(updated.status, 'CANCELLED');
    assert.strictEqual(updated.cancelReason, 'ORDER_CANCELED');
  });

  // TC-17: Opt-out request ("no me escriban más") cancels sequence and sets customer.followUpSuppressed = true
  await runTest('TC-17: Opt-out request cancels sequence and sets customer.followUpSuppressed = true', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990017' } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, status: 'SCHEDULED', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date() }
    });

    const isOptOut = isFollowUpOptOutRequested('Por favor no me escriban más');
    assert.strictEqual(isOptOut, true);

    await handleFollowUpOptOut({ tenantId: tenant.id, customerId: customer.id, reason: 'USER_REQUEST', prismaClient: prisma });
    const updatedCust = await prisma.customer.findUnique({ where: { id: customer.id } });
    assert.strictEqual(updatedCust.followUpSuppressed, true);
    assert.strictEqual(updatedCust.followUpSuppressionReason, 'USER_REQUEST');

    const updatedSeq = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(updatedSeq.status, 'CANCELLED');
    assert.strictEqual(updatedSeq.cancelReason, 'CUSTOMER_OPT_OUT');
  });

  // TC-18: Suppressed customer rejects future sequence creation
  await runTest('TC-18: Suppressed customer rejects future sequence creation', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990018', followUpSuppressed: true } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    const inbound = await prisma.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Quiero información' }
    });

    const result = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentStage: 'PRODUCT_SELECTED',
      lastInboundMessage: inbound,
      prismaClient: prisma
    });

    assert.strictEqual(result.scheduled, false);
    assert.strictEqual(result.reason, 'CUSTOMER_SUPPRESSED');
  });

  // TC-19: Worker claims sequence atomically (SKIP LOCKED) and sets PROCESSING
  await runTest('TC-19: Worker claims sequence atomically (SKIP LOCKED) and sets PROCESSING', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990019' } });
    const pastRun = new Date(Date.now() - 60000);
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, status: 'SCHEDULED', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date(), nextRunAt: pastRun }
    });

    const claimed = await claimDueSequence(prisma);
    assert(claimed, 'Debe reclamar la secuencia');
    assert.strictEqual(claimed.id, seq.id);
    assert.strictEqual(claimed.status, 'PROCESSING');
    assert(claimed.claimedAt, 'Debe registrar claimedAt');
  });

  // TC-20: Pre-flight Gate 1 fails closed if tenant.followUpEnabled is false
  await runTest('TC-20: Pre-flight Gate 1 fails closed if tenant.followUpEnabled is false', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: false, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990020' } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, status: 'PROCESSING', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date() }
    });

    const res = await processSingleSequence(seq.id, prisma);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.status, 'CANCELLED');
    assert.strictEqual(res.reason, 'FOLLOW_UP_DISABLED');
  });

  // TC-21: Pre-flight Gate 1 reschedules if run time is in quiet hours
  await runTest('TC-21: Pre-flight Gate 1 reschedules if run time is in quiet hours', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990021' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    await prisma.message.create({ data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Info' } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, chatId: chat.id, status: 'PROCESSING', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date() }
    });

    // Mock Date.now to 23:00 local time
    const origNow = Date.now;
    try {
      // 23:00 in Lima is 04:00 UTC
      Date.now = () => new Date('2026-09-12T23:00:00-05:00').getTime();
      const res = await processSingleSequence(seq.id, prisma);
      assert.strictEqual(res.status, 'SCHEDULED');
      assert.strictEqual(res.reason, 'QUIET_HOURS_RESCHEDULED');
    } finally {
      Date.now = origNow;
    }
  });

  // TC-22: Meta 24h window open sends successfully
  await runTest('TC-22: Meta 24h window open sends successfully', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990022' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    // Inbound 2 hours ago
    await prisma.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Quiero el producto', createdAt: new Date(Date.now() - 2 * 3600 * 1000) }
    });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, chatId: chat.id, status: 'PROCESSING', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date() }
    });

    setFollowUpGatewaySender(async (ctx, to, text) => 'meta_msg_id_123');

    // Mock 14:00 local time (inside quiet hours)
    const origNow = Date.now;
    try {
      Date.now = () => new Date('2026-09-12T14:00:00-05:00').getTime();
      const res = await processSingleSequence(seq.id, prisma);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'WAITING_NEXT');
    } finally {
      Date.now = origNow;
    }
  });

  // TC-23: Evolution gateway sends text without templates
  await runTest('TC-23: Evolution gateway sends text without templates', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990023' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    await prisma.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Hola', createdAt: new Date() }
    });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, chatId: chat.id, status: 'PROCESSING', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date() }
    });

    let sentText = null;
    setFollowUpGatewaySender(async (ctx, to, text) => {
      sentText = text;
      return 'evo_msg_id_456';
    });

    const origNow = Date.now;
    try {
      Date.now = () => new Date('2026-09-12T14:00:00-05:00').getTime();
      const res = await processSingleSequence(seq.id, prisma);
      assert.strictEqual(res.success, true);
      assert(sentText && sentText.length > 0, 'Debe haber enviado texto no nulo');
    } finally {
      Date.now = origNow;
    }
  });

  // TC-24: Provider success creates SENT attempt and transitions attempt 1/2 to WAITING_NEXT
  await runTest('TC-24: Provider success creates SENT attempt and transitions attempt 1/2 to WAITING_NEXT', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990024' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    await prisma.message.create({ data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Info' } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, chatId: chat.id, currentAttempt: 0, status: 'PROCESSING', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date() }
    });

    setFollowUpGatewaySender(async () => 'evo_msg_789');

    const origNow = Date.now;
    try {
      Date.now = () => new Date('2026-09-12T14:00:00-05:00').getTime();
      const res = await processSingleSequence(seq.id, prisma);
      assert.strictEqual(res.success, true);
      const updatedSeq = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
      assert.strictEqual(updatedSeq.status, 'WAITING_NEXT');
      assert.strictEqual(updatedSeq.currentAttempt, 1);

      const attempt = await prisma.followUpAttempt.findFirst({ where: { sequenceId: seq.id, attemptNumber: 1 } });
      assert(attempt, 'Debe existir attempt row');
      assert.strictEqual(attempt.status, 'SENT');
      assert.strictEqual(attempt.providerMessageId, 'evo_msg_789');
    } finally {
      Date.now = origNow;
    }
  });

  // TC-25: Attempt 3 success transitions sequence to EXHAUSTED
  await runTest('TC-25: Attempt 3 success transitions sequence to EXHAUSTED', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990025' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    await prisma.message.create({ data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Info' } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, chatId: chat.id, currentAttempt: 2, status: 'PROCESSING', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date() }
    });

    setFollowUpGatewaySender(async () => 'evo_msg_att3');

    const origNow = Date.now;
    try {
      Date.now = () => new Date('2026-09-12T14:00:00-05:00').getTime();
      const res = await processSingleSequence(seq.id, prisma);
      assert.strictEqual(res.success, true);
      const updatedSeq = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
      assert.strictEqual(updatedSeq.status, 'EXHAUSTED');
      assert.strictEqual(updatedSeq.currentAttempt, 3);
    } finally {
      Date.now = origNow;
    }
  });

  // TC-26: WAITING_NEXT vencido puede ser reclamado directamente por worker y ejecutar attempt 2
  await runTest('TC-26: WAITING_NEXT vencido puede ser reclamado directamente por worker y ejecutar attempt 2', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990026' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    await prisma.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Info', createdAt: new Date(Date.now() - 3600000) }
    });
    const pastRun = new Date(Date.now() - 5000);
    const seq = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        chatId: chat.id,
        currentAttempt: 1,
        status: 'WAITING_NEXT',
        nextRunAt: pastRun,
        stageAtCreation: 'PRODUCT_SELECTED',
        anchorAt: new Date()
      }
    });

    const claimed = await claimDueSequence(prisma);
    assert(claimed, 'Worker debe poder reclamar directamente en WAITING_NEXT');
    assert.strictEqual(claimed.id, seq.id);
    assert.strictEqual(claimed.status, 'PROCESSING');

    setFollowUpGatewaySender(async () => 'evo_att2_ok');

    const origNow = Date.now;
    try {
      Date.now = () => new Date('2026-09-12T14:00:00-05:00').getTime();
      const res = await processSingleSequence(claimed.id, prisma);
      assert.strictEqual(res.success, true);
      const updated = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
      assert.strictEqual(updated.currentAttempt, 2);
      assert.strictEqual(updated.status, 'WAITING_NEXT');
    } finally {
      Date.now = origNow;
    }
  });

  // TC-27: attempt 2 y 3 realmente ejecutan usando offsets absolutos anchorAt+24 y anchorAt+48
  await runTest('TC-27: attempt 2 y 3 ejecutan usando offsets absolutos anchorAt+24 y anchorAt+48', async () => {
    const anchor = new Date('2026-09-12T10:00:00Z');
    const att1Time = calculateAttemptTimestamp(anchor, 1);
    const att2Time = calculateAttemptTimestamp(anchor, 2);
    const att3Time = calculateAttemptTimestamp(anchor, 3);

    assert.strictEqual((att2Time.getTime() - anchor.getTime()) / 3600000, 24);
    assert.strictEqual((att3Time.getTime() - anchor.getTime()) / 3600000, 48);
    // att2 is 18 hours after att1 (+6 to +24)
    assert.strictEqual((att2Time.getTime() - att1Time.getTime()) / 3600000, 18);
  });

  // TC-28: sequence PROCESSING sin FollowUpAttempt tras crash se recupera y no queda congelada
  await runTest('TC-28: sequence PROCESSING sin FollowUpAttempt tras crash se recupera y no queda congelada', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990028' } });
    const staleTime = new Date(Date.now() - 15 * 60 * 1000); // 15m ago (> 10m threshold)
    const seq = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        status: 'PROCESSING',
        currentAttempt: 0,
        claimedAt: staleTime,
        stageAtCreation: 'PRODUCT_SELECTED',
        anchorAt: new Date()
      }
    });

    const recovered = await recoverStaleProcessing(prisma);
    assert(recovered > 0, 'Debe haber recuperado la secuencia');

    const refreshed = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(refreshed.status, 'SCHEDULED', 'Debe volver a SCHEDULED');
    assert.strictEqual(refreshed.claimedAt, null);
  });

  // TC-29: PROCESSING attempt con dispatchStartedAt == null se puede reencolar de forma segura sin crear otro attemptNumber
  await runTest('TC-29: PROCESSING attempt con dispatchStartedAt == null se puede reencolar de forma segura sin crear otro attemptNumber', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990029' } });
    const staleTime = new Date(Date.now() - 15 * 60 * 1000);
    const seq = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        status: 'PROCESSING',
        currentAttempt: 0,
        claimedAt: staleTime,
        stageAtCreation: 'PRODUCT_SELECTED',
        anchorAt: new Date()
      }
    });
    // Attempt created but crashed before dispatchStartedAt
    const att = await prisma.followUpAttempt.create({
      data: {
        sequenceId: seq.id,
        attemptNumber: 1,
        status: 'PROCESSING',
        scheduledAt: staleTime,
        claimedAt: staleTime,
        dispatchStartedAt: null,
        provider: 'EVOLUTION'
      }
    });

    const recovered = await recoverStaleProcessing(prisma);
    assert(recovered > 0);

    const refreshedSeq = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(refreshedSeq.status, 'SCHEDULED');

    const refreshedAtt = await prisma.followUpAttempt.findFirst({ where: { id: att.id } });
    assert.strictEqual(refreshedAtt.status, 'PENDING', 'Debe reencolarse como PENDING');
    assert.strictEqual(refreshedAtt.attemptNumber, 1, 'Mismo attemptNumber');

    const allAtts = await prisma.followUpAttempt.findMany({ where: { sequenceId: seq.id } });
    assert.strictEqual(allAtts.length, 1, 'No debe crear otro row');
  });

  // TC-30: PROCESSING attempt con dispatchStartedAt != null se convierte a UNKNOWN_DELIVERY y NO se reintenta
  await runTest('TC-30: PROCESSING attempt con dispatchStartedAt != null se convierte a UNKNOWN_DELIVERY y NO se reintenta', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990030' } });
    const staleTime = new Date(Date.now() - 15 * 60 * 1000);
    const seq = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        status: 'PROCESSING',
        currentAttempt: 0,
        claimedAt: staleTime,
        stageAtCreation: 'PRODUCT_SELECTED',
        anchorAt: new Date()
      }
    });
    const att = await prisma.followUpAttempt.create({
      data: {
        sequenceId: seq.id,
        attemptNumber: 1,
        status: 'PROCESSING',
        scheduledAt: staleTime,
        claimedAt: staleTime,
        dispatchStartedAt: new Date(staleTime.getTime() + 1000), // Dispatched!
        provider: 'EVOLUTION'
      }
    });

    const recovered = await recoverStaleProcessing(prisma);
    assert(recovered > 0);

    const refreshedAtt = await prisma.followUpAttempt.findFirst({ where: { id: att.id } });
    assert.strictEqual(refreshedAtt.status, 'UNKNOWN_DELIVERY', 'Debe ser UNKNOWN_DELIVERY');

    const refreshedSeq = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(refreshedSeq.status, 'WAITING_NEXT', 'Avanza la secuencia a WAITING_NEXT');
    assert.strictEqual(refreshedSeq.currentAttempt, 1, 'Intento 1 consumido');
  });

  // TC-31: product lookup es tenant-scoped y Tenant A nunca puede leer producto de Tenant B
  await runTest('TC-31: product lookup es tenant-scoped y Tenant A nunca puede leer producto de Tenant B', async () => {
    const tenantA = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const tenantB = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });

    const prodB = await prisma.product.create({
      data: { id: 'prod_b_secret', name: 'Plan Secreto Tenant B', tenantId: tenantB.id, price: 999 }
    });

    // Tenant A attempts to get Tenant B's product
    const lookedUp = await getTenantVerifiedProduct(tenantA.id, prodB.id, prisma);
    assert.strictEqual(lookedUp, null, 'Tenant A NUNCA debe ver el producto de Tenant B');

    // Tenant B can see it
    const lookedUpB = await getTenantVerifiedProduct(tenantB.id, prodB.id, prisma);
    assert(lookedUpB !== null, 'Tenant B sí debe ver su propio producto');
    assert.strictEqual(lookedUpB.name, 'Plan Secreto Tenant B');
  });

  // TC-32: paymentStatus VERIFYING cancela follow-up pero NO registra venta recuperada
  await runTest('TC-32: paymentStatus VERIFYING cancela follow-up pero NO registra venta recuperada', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990032' } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, status: 'SCHEDULED', stageAtCreation: 'PAYMENT_PENDING', anchorAt: new Date() }
    });

    await cancelFollowUpOnOrderEvent({
      tenantId: tenant.id,
      customerId: customer.id,
      reason: 'PAYMENT_VERIFYING',
      orderId: 'ord_verif_32',
      prismaClient: prisma
    });

    const updated = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(updated.status, 'CANCELLED');
    assert.strictEqual(updated.cancelReason, 'PAYMENT_VERIFYING');
    assert.strictEqual(updated.recoveredAt, null, 'NO debe tener recoveredAt');
    assert.strictEqual(updated.recoveredOrderId, null, 'NO debe tener recoveredOrderId');
  });

  // TC-33: opt-out no se activa solo por profanity
  await runTest('TC-33: opt-out no se activa solo por profanity', async () => {
    const profanity1 = 'Carajo que caro esta eso';
    const profanity2 = 'Mierda no me alcanza';
    const cleanOptOut = 'Por favor ya no me escriban, gracias';

    assert.strictEqual(isFollowUpOptOutRequested(profanity1), false);
    assert.strictEqual(isFollowUpOptOutRequested(profanity2), false);
    assert.strictEqual(isFollowUpOptOutRequested(cleanOptOut), true);
  });

  // TC-34: tenant sin timezone no puede activar Follow-ups / envío fail-closed
  await runTest('TC-34: tenant sin timezone no puede activar Follow-ups / worker fail-closed', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: null } }); // null timezone!
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990034' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    await prisma.message.create({ data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Info' } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, chatId: chat.id, status: 'PROCESSING', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date() }
    });

    let gatewayCalled = false;
    setFollowUpGatewaySender(async () => {
      gatewayCalled = true;
      return 'sent_id';
    });

    const res = await processSingleSequence(seq.id, prisma);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.reason, 'INVALID_TIMEZONE');
    assert.strictEqual(gatewayCalled, false, '0 llamadas de envío si timezone es null/inválida');
  });

  // TC-35: no existe inbound Message real => no follow-up, aunque sessionUpdatedAt exista
  await runTest('TC-35: no existe inbound Message real => no follow-up, aunque sessionUpdatedAt exista', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({
      data: { tenantId: tenant.id, phone: '519990035', sessionUpdatedAt: new Date() }
    });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });

    // evaluateAndScheduleFollowUp called without inbound message
    const res = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentStage: 'PRODUCT_SELECTED',
      lastInboundMessage: null, // NO INBOUND MESSAGE!
      prismaClient: prisma
    });

    assert.strictEqual(res.scheduled, false);
    assert.strictEqual(res.reason, 'NO_INBOUND_ANCHOR');
  });

  // TC-36: Meta window cerrada produce 0 provider calls y cierre terminal seguro de esa secuencia en V1
  await runTest('TC-36: Meta window cerrada produce 0 provider calls y cierre terminal seguro de esa secuencia', async () => {
    const origNow = Date.now;
    try {
      const mockNow = new Date('2026-09-12T14:00:00-05:00');
      Date.now = () => mockNow.getTime();

      const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
      const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990036' } });
      const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
      // Inbound 24 hours ago (window closed!)
      await prisma.message.create({
        data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Info', createdAt: new Date(mockNow.getTime() - 24 * 3600 * 1000) }
      });
      const seq = await prisma.followUpSequence.create({
        data: { tenantId: tenant.id, customerId: customer.id, chatId: chat.id, status: 'PROCESSING', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date(mockNow.getTime() - 24 * 3600 * 1000) }
      });

      let gatewayCalled = false;
      setFollowUpGatewaySender(async () => {
        gatewayCalled = true;
        return 'sent_id';
      });

      const res = await processSingleSequence(seq.id, prisma, { providerOverride: 'META' });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.status, 'CANCELLED');
      assert.strictEqual(res.reason, 'META_WINDOW_CLOSED');
      assert.strictEqual(gatewayCalled, false, '0 llamadas al provider');

      const attempt = await prisma.followUpAttempt.findFirst({ where: { sequenceId: seq.id, attemptNumber: 1 } });
      assert.strictEqual(attempt.status, 'SKIPPED_POLICY');
    } finally {
      Date.now = origNow;
    }
  });

  // TC-37: inbound persistido antes de Gate 2 => 0 provider call
  await runTest('TC-37: inbound persistido antes de Gate 2 => 0 provider call', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990037' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    await prisma.message.create({ data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Info inicial' } });
    const seq = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        chatId: chat.id,
        status: 'PROCESSING',
        claimedAt: new Date(Date.now() - 5000),
        stageAtCreation: 'PRODUCT_SELECTED',
        anchorAt: new Date()
      }
    });

    // New inbound arrives during AI generation (after claimedAt, before Gate 2)
    await prisma.message.create({
      data: {
        chatId: chat.id,
        tenantId: tenant.id,
        senderRole: 'contact',
        content: 'Ya no lo necesito gracias',
        createdAt: new Date()
      }
    });

    let gatewayCalled = false;
    setFollowUpGatewaySender(async () => {
      gatewayCalled = true;
      return 'sent_id';
    });

    const origNow = Date.now;
    try {
      Date.now = () => new Date('2026-09-12T14:00:00-05:00').getTime();
      const res = await processSingleSequence(seq.id, prisma);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reason, 'INBOUND_ARRIVED_DURING_PROCESSING');
      assert.strictEqual(gatewayCalled, false, '0 llamadas al provider tras Gate 2 abort');
    } finally {
      Date.now = origNow;
    }
  });

  // TC-38: inbound que ocurre después de dispatchStartedAt no se modela falsamente como "garantía de cancelación"
  await runTest('TC-38: inbound después de dispatchStartedAt no retrocede el dispatch ya iniciado', async () => {
    // If dispatchStartedAt is set, the attempt must resolve to SENT or UNKNOWN_DELIVERY, never revoked
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: 'c38', status: 'PROCESSING', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date() }
    });
    const att = await prisma.followUpAttempt.create({
      data: {
        sequenceId: seq.id,
        attemptNumber: 1,
        status: 'PROCESSING',
        scheduledAt: new Date(),
        dispatchStartedAt: new Date(),
        provider: 'EVOLUTION'
      }
    });

    // Inbound arrives after dispatchStartedAt
    // The attempt record must preserve dispatchStartedAt and cannot be cleanly cancelled
    const currentAtt = await prisma.followUpAttempt.findFirst({ where: { id: att.id } });
    assert(currentAtt.dispatchStartedAt !== null);
    assert.notStrictEqual(currentAtt.status, 'CANCELLED');
  });

  // TC-39: partial unique race crea exactamente una secuencia activa
  await runTest('TC-39: partial unique race crea exactamente una secuencia activa', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990039' } });

    await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, status: 'SCHEDULED', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date() }
    });

    // Attempting to create a second active sequence must throw P2002
    let errorThrown = false;
    try {
      await prisma.followUpSequence.create({
        data: { tenantId: tenant.id, customerId: customer.id, status: 'WAITING_NEXT', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date() }
      });
    } catch (err) {
      if (err.code === 'P2002') {
        errorThrown = true;
      }
    }
    assert.strictEqual(errorThrown, true, 'Debe lanzar error P2002 en race condition');
  });

  // TC-40: old terminal sequence no impide futura nueva oportunidad
  await runTest('TC-40: old terminal sequence no impide futura nueva oportunidad', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990040' } });

    // Past terminal sequence
    await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, status: 'RECOVERED', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date('2026-09-01T10:00:00Z') }
    });

    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    const newInbound = await prisma.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Hola quiero comprar otro modelo', createdAt: new Date() }
    });

    const res = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentStage: 'PRODUCT_SELECTED',
      lastInboundMessage: newInbound,
      prismaClient: prisma
    });

    assert.strictEqual(res.scheduled, true, 'Debe permitir agendar nueva oportunidad');
    assert.strictEqual(res.isRefresh, false, 'Es una nueva secuencia');
    assert.strictEqual(res.sequence.status, 'SCHEDULED');
  });

  // TC-41: SENT attempt1 + stale Sequence PROCESSING => recovery WAITING_NEXT +24h
  await runTest('TC-41: SENT attempt1 + stale Sequence PROCESSING => recovery WAITING_NEXT +24h', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990041' } });
    const anchorAt = new Date('2026-09-12T10:00:00-05:00');
    const staleClaimedAt = new Date(Date.now() - 10 * 60 * 1000); // 10m ago
    const seq = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        status: 'PROCESSING',
        currentAttempt: 0,
        claimedAt: staleClaimedAt,
        stageAtCreation: 'PRODUCT_SELECTED',
        anchorAt
      }
    });
    await prisma.followUpAttempt.create({
      data: {
        sequenceId: seq.id,
        attemptNumber: 1,
        status: 'SENT',
        scheduledAt: new Date(anchorAt.getTime() + 6 * 3600 * 1000),
        sentAt: staleClaimedAt,
        dispatchStartedAt: staleClaimedAt,
        provider: 'EVOLUTION'
      }
    });

    const recoveredCount = await recoverStaleProcessing(prisma);
    assert.strictEqual(recoveredCount, 1);

    const updated = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(updated.status, 'WAITING_NEXT');
    assert.strictEqual(updated.currentAttempt, 1);
    assert.strictEqual(updated.claimedAt, null);
    assert(updated.nextRunAt !== null);
    // Offset +24h from anchorAt
    const expectedAttempt2 = calculateAttemptTimestamp(anchorAt, 2, 'America/Lima');
    assert.strictEqual(new Date(updated.nextRunAt).toISOString(), expectedAttempt2.toISOString());
  });

  // TC-42: SENT attempt3 + stale Sequence PROCESSING => recovery EXHAUSTED
  await runTest('TC-42: SENT attempt3 + stale Sequence PROCESSING => recovery EXHAUSTED', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990042' } });
    const anchorAt = new Date('2026-09-12T10:00:00-05:00');
    const staleClaimedAt = new Date(Date.now() - 10 * 60 * 1000);
    const seq = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        status: 'PROCESSING',
        currentAttempt: 2,
        maxAttempts: 3,
        claimedAt: staleClaimedAt,
        stageAtCreation: 'PRODUCT_SELECTED',
        anchorAt
      }
    });
    await prisma.followUpAttempt.create({
      data: {
        sequenceId: seq.id,
        attemptNumber: 3,
        status: 'SENT',
        scheduledAt: new Date(anchorAt.getTime() + 48 * 3600 * 1000),
        sentAt: staleClaimedAt,
        dispatchStartedAt: staleClaimedAt,
        provider: 'EVOLUTION'
      }
    });

    const recoveredCount = await recoverStaleProcessing(prisma);
    assert.strictEqual(recoveredCount, 1);

    const updated = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(updated.status, 'EXHAUSTED');
    assert.strictEqual(updated.currentAttempt, 3);
    assert.strictEqual(updated.claimedAt, null);
    assert.strictEqual(updated.nextRunAt, null);
  });

  // TC-43: transacción de success path actualiza Attempt + Sequence coherentemente
  await runTest('TC-43: transacción de success path actualiza Attempt + Sequence coherentemente', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990043' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    await prisma.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Info', createdAt: new Date(Date.now() - 3600000) }
    });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: customer.id, chatId: chat.id, currentAttempt: 0, status: 'PROCESSING', stageAtCreation: 'PRODUCT_SELECTED', anchorAt: new Date() }
    });

    setFollowUpGatewaySender(async () => 'provider_msg_tc43');

    const origNow = Date.now;
    try {
      Date.now = () => new Date('2026-09-12T14:00:00-05:00').getTime();
      const res = await processSingleSequence(seq.id, prisma);
      assert.strictEqual(res.success, true);

      const updatedSeq = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
      assert.strictEqual(updatedSeq.status, 'WAITING_NEXT');
      assert.strictEqual(updatedSeq.currentAttempt, 1);
      assert.strictEqual(updatedSeq.claimedAt, null);
      assert(updatedSeq.lastRunAt !== null);
      assert(updatedSeq.nextRunAt !== null);

      const att = await prisma.followUpAttempt.findFirst({ where: { sequenceId: seq.id, attemptNumber: 1 } });
      assert.strictEqual(att.status, 'SENT');
      assert.strictEqual(att.providerMessageId, 'provider_msg_tc43');
      assert(att.sentAt !== null);
      assert(att.sentMessage && att.sentMessage.length > 0);
    } finally {
      Date.now = origNow;
    }
  });

  // TC-44: explicit timing "mañana te confirmo"
  await runTest('TC-44: explicit timing "mañana te confirmo" programa para mañana en quiet hours', async () => {
    const baseDate = new Date('2026-09-12T11:00:00-05:00'); // Saturday 11am Lima
    const parsedIso = parseCustomerExplicitTiming('mañana te confirmo', 'America/Lima', baseDate);
    assert(parsedIso !== null, 'Debe parsear mañana te confirmo');
    const parsedDate = new Date(parsedIso);
    const limaDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(parsedDate);
    assert.strictEqual(limaDateStr, '2026-09-13');

    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990044' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    const inbound = await prisma.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'mañana te confirmo', createdAt: baseDate }
    });

    const res = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentStage: 'PRODUCT_SELECTED',
      explicitCustomerTiming: 'mañana te confirmo',
      lastInboundMessage: inbound,
      prismaClient: prisma
    });

    assert.strictEqual(res.scheduled, true);
    assert(res.sequence.explicitTimingIso !== null);
    assert.strictEqual(new Date(res.sequence.nextRunAt).toISOString(), new Date(res.sequence.explicitTimingIso).toISOString());
  });

  // TC-45: explicit timing inválido/pasado no agenda fecha pasada
  await runTest('TC-45: explicit timing inválido/pasado no agenda fecha pasada', async () => {
    const baseDate = new Date('2026-09-12T11:00:00-05:00');
    const parsedPast = parseCustomerExplicitTiming('ayer te pagué', 'America/Lima', baseDate);
    assert.strictEqual(parsedPast, null, 'No debe aceptar timing pasado');

    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990045' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    const inbound = await prisma.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'ayer te pagué', createdAt: baseDate }
    });

    const res = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentStage: 'PRODUCT_SELECTED',
      explicitCustomerTiming: 'ayer te pagué',
      lastInboundMessage: inbound,
      prismaClient: prisma
    });

    assert.strictEqual(res.scheduled, true);
    assert.strictEqual(res.sequence.explicitTimingIso, null, 'Debe descartar timing pasado');
    const expectedNextRun = calculateAttemptTimestamp(baseDate, 1, 'America/Lima');
    assert.strictEqual(new Date(res.sequence.nextRunAt).toISOString(), expectedNextRun.toISOString());
  });

  // TC-46: explicit timing >14 días rechazado
  await runTest('TC-46: explicit timing >14 días rechazado', async () => {
    const baseDate = new Date('2026-09-12T11:00:00-05:00');
    const parsed20Days = parseCustomerExplicitTiming('en 20 días te aviso', 'America/Lima', baseDate);
    assert.strictEqual(parsed20Days, null, 'Timing >14 días debe ser rechazado');

    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990046' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    const inbound = await prisma.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'en 20 días', createdAt: baseDate }
    });

    const res = await evaluateAndScheduleFollowUp({
      tenantId: tenant.id,
      customerId: customer.id,
      chatId: chat.id,
      currentStage: 'PRODUCT_SELECTED',
      explicitCustomerTiming: 'en 20 días te aviso',
      lastInboundMessage: inbound,
      prismaClient: prisma
    });

    assert.strictEqual(res.scheduled, true);
    assert.strictEqual(res.sequence.explicitTimingIso, null, 'Debe caer en fallback seguro');
  });

  // TC-47: PAID <=72h tras SENT => venta atribuida
  await runTest('TC-47: PAID <=72h tras SENT => venta atribuida', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990047' } });
    const sentTime = new Date(Date.now() - 3600 * 1000); // 1h ago
    const seq = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        status: 'WAITING_NEXT',
        currentAttempt: 1,
        stageAtCreation: 'PRODUCT_SELECTED',
        anchorAt: new Date(Date.now() - 7 * 3600 * 1000)
      }
    });
    await prisma.followUpAttempt.create({
      data: {
        sequenceId: seq.id,
        attemptNumber: 1,
        status: 'SENT',
        sentAt: sentTime,
        dispatchStartedAt: sentTime,
        scheduledAt: sentTime,
        provider: 'EVOLUTION'
      }
    });

    const order = await prisma.order.create({
      data: { tenantId: tenant.id, customerId: customer.id, paymentStatus: 'PAID', totalAmount: 250 }
    });

    await cancelFollowUpOnOrderEvent({
      tenantId: tenant.id,
      customerId: customer.id,
      orderId: order.id,
      reason: 'ORDER_PAID',
      prismaClient: prisma
    });

    const updatedSeq = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(updatedSeq.status, 'CANCELLED');
    assert.strictEqual(updatedSeq.cancelReason, 'ORDER_PAID');
    assert.strictEqual(updatedSeq.recoveredOrderId, order.id);

    let responseBody = null;
    const mockRes = {
      json: (data) => { responseBody = data; return mockRes; },
      status: () => mockRes
    };
    await getFollowUpSummary({ user: { tenantId: tenant.id }, prismaClient: prisma }, mockRes);
    assert(responseBody !== null);
    assert.strictEqual(responseBody.metrics.attributedSalesCount, 1);
    assert.strictEqual(responseBody.metrics.attributedSalesTotal, 250);
  });

  // TC-48: PAID >72h tras SENT => NO atribuida
  await runTest('TC-48: PAID >72h tras SENT => NO atribuida', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990048' } });
    const sentTime = new Date(Date.now() - 75 * 3600 * 1000); // 75h ago (outside 72h window)
    const seq = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        status: 'WAITING_NEXT',
        currentAttempt: 1,
        stageAtCreation: 'PRODUCT_SELECTED',
        anchorAt: new Date(Date.now() - 80 * 3600 * 1000)
      }
    });
    await prisma.followUpAttempt.create({
      data: {
        sequenceId: seq.id,
        attemptNumber: 1,
        status: 'SENT',
        sentAt: sentTime,
        dispatchStartedAt: sentTime,
        scheduledAt: sentTime,
        provider: 'EVOLUTION'
      }
    });

    const order = await prisma.order.create({
      data: { tenantId: tenant.id, customerId: customer.id, paymentStatus: 'PAID', totalAmount: 180 }
    });

    await cancelFollowUpOnOrderEvent({
      tenantId: tenant.id,
      customerId: customer.id,
      orderId: order.id,
      reason: 'ORDER_PAID',
      prismaClient: prisma
    });

    const updatedSeq = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(updatedSeq.status, 'CANCELLED');
    assert.strictEqual(updatedSeq.cancelReason, 'ORDER_PAID');
    assert.strictEqual(updatedSeq.recoveredOrderId, null, 'No debe atribuir si pasaron >72h desde SENT');

    let responseBody = null;
    const mockRes = {
      json: (data) => { responseBody = data; return mockRes; },
      status: () => mockRes
    };
    await getFollowUpSummary({ user: { tenantId: tenant.id }, prismaClient: prisma }, mockRes);
    assert.strictEqual(responseBody.metrics.attributedSalesCount, 0);
    assert.strictEqual(responseBody.metrics.attributedSalesTotal, 0);
  });

  // TC-49: UNKNOWN_DELIVERY + PAID => NO venta atribuida
  await runTest('TC-49: UNKNOWN_DELIVERY + PAID => NO venta atribuida', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990049' } });
    const seq = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        status: 'WAITING_NEXT',
        currentAttempt: 1,
        stageAtCreation: 'PRODUCT_SELECTED',
        anchorAt: new Date(Date.now() - 7 * 3600 * 1000)
      }
    });
    await prisma.followUpAttempt.create({
      data: {
        sequenceId: seq.id,
        attemptNumber: 1,
        status: 'UNKNOWN_DELIVERY',
        failureReason: 'CRASH_AFTER_DISPATCH_STARTED',
        scheduledAt: new Date(),
        provider: 'EVOLUTION'
      }
    });

    const order = await prisma.order.create({
      data: { tenantId: tenant.id, customerId: customer.id, paymentStatus: 'PAID', totalAmount: 300 }
    });

    await cancelFollowUpOnOrderEvent({
      tenantId: tenant.id,
      customerId: customer.id,
      orderId: order.id,
      reason: 'ORDER_PAID',
      prismaClient: prisma
    });

    const updatedSeq = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(updatedSeq.recoveredOrderId, null, 'UNKNOWN_DELIVERY no cuenta como SENT para atribuir');
  });

  // TC-50: PAID después de SENT sin inbound de respuesta => venta atribuida pero no CONVERSATION_RECOVERED
  await runTest('TC-50: PAID después de SENT sin inbound de respuesta => venta atribuida pero no CONVERSATION_RECOVERED', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990050' } });
    const sentTime = new Date(Date.now() - 2 * 3600 * 1000);
    const seq = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        status: 'WAITING_NEXT',
        currentAttempt: 1,
        stageAtCreation: 'PRODUCT_SELECTED',
        anchorAt: new Date(Date.now() - 8 * 3600 * 1000)
      }
    });
    await prisma.followUpAttempt.create({
      data: {
        sequenceId: seq.id,
        attemptNumber: 1,
        status: 'SENT',
        sentAt: sentTime,
        dispatchStartedAt: sentTime,
        scheduledAt: sentTime,
        provider: 'EVOLUTION'
      }
    });

    const order = await prisma.order.create({
      data: { tenantId: tenant.id, customerId: customer.id, paymentStatus: 'PAID', totalAmount: 420 }
    });

    await cancelFollowUpOnOrderEvent({
      tenantId: tenant.id,
      customerId: customer.id,
      orderId: order.id,
      reason: 'ORDER_PAID',
      prismaClient: prisma
    });

    const updatedSeq = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
    assert.strictEqual(updatedSeq.status, 'CANCELLED');
    assert.notStrictEqual(updatedSeq.status, 'RECOVERED');
    assert.strictEqual(updatedSeq.recoveredOrderId, order.id);

    let responseBody = null;
    const mockRes = {
      json: (data) => { responseBody = data; return mockRes; },
      status: () => mockRes
    };
    await getFollowUpSummary({ user: { tenantId: tenant.id }, prismaClient: prisma }, mockRes);
    assert.strictEqual(responseBody.metrics.attributedSalesCount, 1);
    assert.strictEqual(responseBody.metrics.attributedSalesTotal, 420);
    assert.strictEqual(responseBody.metrics.recoveredConversations, 0, 'No hubo conversación recuperada');
  });

  // TC-51: producto con productId borrado => SKIPPED_POLICY + PRODUCT_UNAVAILABLE + 0 provider
  await runTest('TC-51: producto con productId borrado => SKIPPED_POLICY + PRODUCT_UNAVAILABLE + 0 provider', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990051' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    await prisma.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Info', createdAt: new Date(Date.now() - 3600000) }
    });

    const seq = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        chatId: chat.id,
        productId: 'deleted_product_999',
        productName: 'Reloj Vintage',
        status: 'PROCESSING',
        stageAtCreation: 'PRODUCT_SELECTED',
        anchorAt: new Date()
      }
    });

    let providerCalled = false;
    setFollowUpGatewaySender(async () => {
      providerCalled = true;
      return 'should_not_be_called';
    });

    const origNow = Date.now;
    try {
      Date.now = () => new Date('2026-09-12T14:00:00-05:00').getTime();
      const res = await processSingleSequence(seq.id, prisma);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reason, 'PRODUCT_UNAVAILABLE');
      assert.strictEqual(providerCalled, false, '0 llamadas al provider si el producto fue borrado');

      const updatedSeq = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
      assert.strictEqual(updatedSeq.status, 'CANCELLED');
      assert.strictEqual(updatedSeq.cancelReason, 'PRODUCT_UNAVAILABLE');

      const attempt = await prisma.followUpAttempt.findFirst({ where: { sequenceId: seq.id, attemptNumber: 1 } });
      assert(attempt !== null);
      assert.strictEqual(attempt.status, 'SKIPPED_POLICY');
      assert.strictEqual(attempt.errorMessage, 'PRODUCT_UNAVAILABLE');
    } finally {
      Date.now = origNow;
    }
  });

  // TC-52: producto no disponible => 0 provider
  await runTest('TC-52: producto no disponible (isAvailable: false) => 0 provider', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990052' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });
    await prisma.message.create({
      data: { chatId: chat.id, tenantId: tenant.id, senderRole: 'contact', content: 'Info', createdAt: new Date(Date.now() - 3600000) }
    });

    const prod = await prisma.product.create({
      data: { id: 'prod_unavailable_52', tenantId: tenant.id, name: 'Zapatos Oxford', isAvailable: false }
    });

    const seq = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        chatId: chat.id,
        productId: prod.id,
        productName: prod.name,
        status: 'PROCESSING',
        stageAtCreation: 'PRODUCT_SELECTED',
        anchorAt: new Date()
      }
    });

    let providerCalled = false;
    setFollowUpGatewaySender(async () => {
      providerCalled = true;
      return 'should_not_be_called';
    });

    const origNow = Date.now;
    try {
      Date.now = () => new Date('2026-09-12T14:00:00-05:00').getTime();
      const res = await processSingleSequence(seq.id, prisma);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reason, 'PRODUCT_UNAVAILABLE');
      assert.strictEqual(providerCalled, false, '0 llamadas al provider si el producto no está disponible');

      const updatedSeq = await prisma.followUpSequence.findUnique({ where: { id: seq.id } });
      assert.strictEqual(updatedSeq.status, 'CANCELLED');
      assert.strictEqual(updatedSeq.cancelReason, 'PRODUCT_UNAVAILABLE');
    } finally {
      Date.now = origNow;
    }
  });

  // TC-53: 09:00 permitido
  await runTest('TC-53: 09:00:00 exacto local está permitido (sin rollover)', async () => {
    const t0900 = new Date('2026-09-12T09:00:00-05:00');
    const res = applyQuietHours(t0900, 'America/Lima');
    assert.strictEqual(res.getTime(), t0900.getTime(), '09:00:00 debe mantenerse sin cambios');
  });

  // TC-54: 19:59:59 permitido
  await runTest('TC-54: 19:59:59 local está permitido (sin rollover)', async () => {
    const t195959 = new Date('2026-09-12T19:59:59-05:00');
    const res = applyQuietHours(t195959, 'America/Lima');
    assert.strictEqual(res.getTime(), t195959.getTime(), '19:59:59 debe mantenerse sin cambios');
  });

  // TC-55: 20:00:00 bloqueado/rollover
  await runTest('TC-55: 20:00:00 y 20:00:01 bloqueados y hacen rollover a 09:00 del día siguiente', async () => {
    const t200000 = new Date('2026-09-12T20:00:00-05:00');
    const res200000 = applyQuietHours(t200000, 'America/Lima');
    assert.strictEqual(res200000.toISOString(), '2026-09-13T14:00:00.000Z', '20:00:00 debe pasar a 09:00 del día siguiente');

    const t200001 = new Date('2026-09-12T20:00:01-05:00');
    const res200001 = applyQuietHours(t200001, 'America/Lima');
    assert.strictEqual(res200001.toISOString(), '2026-09-13T14:00:00.000Z', '20:00:01 debe pasar a 09:00 del día siguiente');

    const t085959 = new Date('2026-09-12T08:59:59-05:00');
    const res085959 = applyQuietHours(t085959, 'America/Lima');
    assert.strictEqual(res085959.toISOString(), '2026-09-12T14:00:00.000Z', '08:59:59 debe pasar a 09:00 del mismo día');
  });

  // TC-56: Gate 2 detecta inbound dentro del margen de reloj seguro (2 segundos)
  await runTest('TC-56: Gate 2 detecta inbound dentro del margen de reloj seguro (2 segundos)', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990056' } });
    const chat = await prisma.chat.create({ data: { tenantId: tenant.id } });

    const claimTime = new Date('2026-09-12T14:00:00.000Z');
    const seq = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        chatId: chat.id,
        status: 'PROCESSING',
        claimedAt: claimTime,
        stageAtCreation: 'PRODUCT_SELECTED',
        anchorAt: new Date(claimTime.getTime() - 6 * 3600 * 1000)
      }
    });

    // Message created 1 second before claimedAt (within the 2-second safe clock margin)
    await prisma.message.create({
      data: {
        chatId: chat.id,
        tenantId: tenant.id,
        senderRole: 'contact',
        content: 'Ya no lo quiero',
        createdAt: new Date(claimTime.getTime() - 1000)
      }
    });

    let providerCalled = false;
    setFollowUpGatewaySender(async () => {
      providerCalled = true;
      return 'sent';
    });

    const origNow = Date.now;
    try {
      Date.now = () => claimTime.getTime();
      const res = await processSingleSequence(seq.id, prisma);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reason, 'INBOUND_ARRIVED_DURING_PROCESSING');
      assert.strictEqual(providerCalled, false, '0 llamadas al provider por margen de reloj seguro de 2s');
    } finally {
      Date.now = origNow;
    }
  });

  // TC-57: MobileNav contiene /seguimientos
  await runTest('TC-57: MobileNav contiene /seguimientos y Seguimientos', async () => {
    const mobileNavPath = path.resolve(process.cwd(), 'src/components/layout/MobileNav.jsx');
    assert(fs.existsSync(mobileNavPath), 'MobileNav.jsx debe existir');
    const content = fs.readFileSync(mobileNavPath, 'utf8');
    assert(content.includes('/seguimientos'), 'MobileNav debe incluir ruta /seguimientos');
    assert(content.includes('Seguimientos'), 'MobileNav debe incluir label Seguimientos');
  });

  // TC-58: Sequence ord_A + PAID ord_B => NO cancel => NO recoveredOrderId => NO attributed sale
  await runTest('TC-58: Sequence ord_A + PAID ord_B => NO cancel, NO recoveredOrderId, NO attributed sale', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990058' } });
    const sentTime = new Date(Date.now() - 3600 * 1000);
    const seqA = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: 'ord_A',
        status: 'WAITING_NEXT',
        currentAttempt: 1,
        stageAtCreation: 'PAYMENT_PENDING',
        anchorAt: new Date(Date.now() - 7 * 3600 * 1000)
      }
    });
    await prisma.followUpAttempt.create({
      data: {
        sequenceId: seqA.id,
        attemptNumber: 1,
        status: 'SENT',
        sentAt: sentTime,
        dispatchStartedAt: sentTime,
        scheduledAt: sentTime,
        provider: 'EVOLUTION'
      }
    });

    const orderB = await prisma.order.create({
      data: { id: 'ord_B', tenantId: tenant.id, customerId: customer.id, paymentStatus: 'PAID', totalAmount: 500 }
    });

    const count = await cancelFollowUpOnOrderEvent({
      tenantId: tenant.id,
      customerId: customer.id,
      orderId: orderB.id,
      reason: 'ORDER_PAID',
      prismaClient: prisma
    });

    assert.strictEqual(count, 0, 'No debe cancelar la secuencia vinculada a orden distinta');
    const checkSeqA = await prisma.followUpSequence.findUnique({ where: { id: seqA.id } });
    assert.strictEqual(checkSeqA.status, 'WAITING_NEXT', 'Secuencia A debe seguir activa');
    assert.strictEqual(checkSeqA.cancelReason, null);
    assert.strictEqual(checkSeqA.recoveredOrderId, null);

    let summaryRes = null;
    const mockRes = { json: (d) => { summaryRes = d; return mockRes; }, status: () => mockRes };
    await getFollowUpSummary({ user: { tenantId: tenant.id }, prismaClient: prisma }, mockRes);
    assert.strictEqual(summaryRes.metrics.attributedSalesCount, 0, 'Cero ventas atribuidas');
    assert.strictEqual(summaryRes.metrics.attributedSalesTotal, 0);
  });

  // TC-59: Sequence ord_A + VERIFYING ord_B => NO cancel
  await runTest('TC-59: Sequence ord_A + VERIFYING ord_B => NO cancel', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990059' } });
    const seqA = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: 'ord_A_59',
        status: 'SCHEDULED',
        stageAtCreation: 'PAYMENT_PENDING',
        anchorAt: new Date()
      }
    });

    const count = await cancelFollowUpOnOrderEvent({
      tenantId: tenant.id,
      customerId: customer.id,
      order: { id: 'ord_B_59', paymentStatus: 'VERIFYING' },
      prismaClient: prisma
    });

    assert.strictEqual(count, 0);
    const checkSeqA = await prisma.followUpSequence.findUnique({ where: { id: seqA.id } });
    assert.strictEqual(checkSeqA.status, 'SCHEDULED');
  });

  // TC-60: Sequence ord_A + COMPLETED ord_B => NO cancel
  await runTest('TC-60: Sequence ord_A + COMPLETED ord_B => NO cancel', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990060' } });
    const seqA = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: 'ord_A_60',
        status: 'SCHEDULED',
        stageAtCreation: 'PAYMENT_PENDING',
        anchorAt: new Date()
      }
    });

    const count = await cancelFollowUpOnOrderEvent({
      tenantId: tenant.id,
      customerId: customer.id,
      order: { id: 'ord_B_60', status: 'COMPLETED' },
      prismaClient: prisma
    });

    assert.strictEqual(count, 0);
    const checkSeqA = await prisma.followUpSequence.findUnique({ where: { id: seqA.id } });
    assert.strictEqual(checkSeqA.status, 'SCHEDULED');
  });

  // TC-61: Sequence ord_A + CANCELED ord_B => NO cancel
  await runTest('TC-61: Sequence ord_A + CANCELED ord_B => NO cancel', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990061' } });
    const seqA = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: 'ord_A_61',
        status: 'SCHEDULED',
        stageAtCreation: 'PAYMENT_PENDING',
        anchorAt: new Date()
      }
    });

    const count = await cancelFollowUpOnOrderEvent({
      tenantId: tenant.id,
      customerId: customer.id,
      order: { id: 'ord_B_61', status: 'CANCELED' },
      prismaClient: prisma
    });

    assert.strictEqual(count, 0);
    const checkSeqA = await prisma.followUpSequence.findUnique({ where: { id: seqA.id } });
    assert.strictEqual(checkSeqA.status, 'SCHEDULED');
  });

  // TC-62: Sequence ord_A + PAID ord_A dentro 72h y SENT => ORDER_PAID => attributed sale
  await runTest('TC-62: Sequence ord_A + PAID ord_A dentro 72h y SENT => ORDER_PAID => attributed sale', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990062' } });
    const sentTime = new Date(Date.now() - 3600 * 1000);
    const orderA = await prisma.order.create({
      data: { id: 'ord_A_62', tenantId: tenant.id, customerId: customer.id, paymentStatus: 'PAID', totalAmount: 350 }
    });
    const seqA = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: orderA.id,
        status: 'WAITING_NEXT',
        currentAttempt: 1,
        stageAtCreation: 'PAYMENT_PENDING',
        anchorAt: new Date(Date.now() - 7 * 3600 * 1000)
      }
    });
    await prisma.followUpAttempt.create({
      data: {
        sequenceId: seqA.id,
        attemptNumber: 1,
        status: 'SENT',
        sentAt: sentTime,
        dispatchStartedAt: sentTime,
        scheduledAt: sentTime,
        provider: 'EVOLUTION'
      }
    });

    const count = await cancelFollowUpOnOrderEvent({
      tenantId: tenant.id,
      customerId: customer.id,
      orderId: orderA.id,
      order: orderA,
      prismaClient: prisma
    });

    assert.strictEqual(count, 1);
    const checkSeqA = await prisma.followUpSequence.findUnique({ where: { id: seqA.id } });
    assert.strictEqual(checkSeqA.status, 'CANCELLED');
    assert.strictEqual(checkSeqA.cancelReason, 'ORDER_PAID');
    assert.strictEqual(checkSeqA.recoveredOrderId, 'ord_A_62');
    assert(checkSeqA.recoveredAt !== null);

    let summaryRes = null;
    const mockRes = { json: (d) => { summaryRes = d; return mockRes; }, status: () => mockRes };
    await getFollowUpSummary({ user: { tenantId: tenant.id }, prismaClient: prisma }, mockRes);
    assert.strictEqual(summaryRes.metrics.attributedSalesCount, 1);
    assert.strictEqual(summaryRes.metrics.attributedSalesTotal, 350);
  });

  // TC-63: Sequence ord_A + VERIFYING ord_A => PAYMENT_VERIFYING
  await runTest('TC-63: Sequence ord_A + VERIFYING ord_A => PAYMENT_VERIFYING', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990063' } });
    const seqA = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: 'ord_A_63',
        status: 'SCHEDULED',
        stageAtCreation: 'PAYMENT_PENDING',
        anchorAt: new Date()
      }
    });

    const count = await cancelFollowUpOnOrderEvent({
      tenantId: tenant.id,
      customerId: customer.id,
      order: { id: 'ord_A_63', paymentStatus: 'VERIFYING' },
      prismaClient: prisma
    });

    assert.strictEqual(count, 1);
    const checkSeqA = await prisma.followUpSequence.findUnique({ where: { id: seqA.id } });
    assert.strictEqual(checkSeqA.status, 'CANCELLED');
    assert.strictEqual(checkSeqA.cancelReason, 'PAYMENT_VERIFYING');
    assert.strictEqual(checkSeqA.recoveredOrderId, null);
  });

  // TC-64: Sequence orderId definido + event sin effectiveOrderId => fail-closed => NO mutation
  await runTest('TC-64: Sequence orderId definido + event sin effectiveOrderId => fail-closed => NO mutation', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990064' } });
    const seqA = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: 'ord_A_64',
        status: 'SCHEDULED',
        stageAtCreation: 'PAYMENT_PENDING',
        anchorAt: new Date()
      }
    });

    const count = await cancelFollowUpOnOrderEvent({
      tenantId: tenant.id,
      customerId: customer.id,
      reason: 'ORDER_PAID',
      prismaClient: prisma
    });

    assert.strictEqual(count, 0, 'Debe omitir secuencia vinculada si el evento no especifica orden');
    const checkSeqA = await prisma.followUpSequence.findUnique({ where: { id: seqA.id } });
    assert.strictEqual(checkSeqA.status, 'SCHEDULED');
  });

  // TC-65: Sequence orderId null + PAID del mismo tenant/customer dentro de regla V1 => atribuida
  await runTest('TC-65: Sequence orderId null + PAID del mismo tenant/customer dentro de regla V1 => atribuida', async () => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, phone: '519990065' } });
    const sentTime = new Date(Date.now() - 3600 * 1000);
    const seqEarly = await prisma.followUpSequence.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: null,
        status: 'WAITING_NEXT',
        currentAttempt: 1,
        stageAtCreation: 'PRODUCT_SELECTED',
        anchorAt: new Date(Date.now() - 7 * 3600 * 1000)
      }
    });
    await prisma.followUpAttempt.create({
      data: {
        sequenceId: seqEarly.id,
        attemptNumber: 1,
        status: 'SENT',
        sentAt: sentTime,
        dispatchStartedAt: sentTime,
        scheduledAt: sentTime,
        provider: 'EVOLUTION'
      }
    });

    const orderX = await prisma.order.create({
      data: { id: 'ord_X_65', tenantId: tenant.id, customerId: customer.id, paymentStatus: 'PAID', totalAmount: 220 }
    });

    const count = await cancelFollowUpOnOrderEvent({
      tenantId: tenant.id,
      customerId: customer.id,
      orderId: orderX.id,
      reason: 'ORDER_PAID',
      prismaClient: prisma
    });

    assert.strictEqual(count, 1);
    const checkSeq = await prisma.followUpSequence.findUnique({ where: { id: seqEarly.id } });
    assert.strictEqual(checkSeq.status, 'CANCELLED');
    assert.strictEqual(checkSeq.cancelReason, 'ORDER_PAID');
    assert.strictEqual(checkSeq.recoveredOrderId, 'ord_X_65');
  });

  // TC-66: Tenant A ord_A nunca puede ser afectada por Order de Tenant B
  await runTest('TC-66: Tenant A ord_A nunca puede ser afectada por Order de Tenant B', async () => {
    const tenantA = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const tenantB = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const customerA = await prisma.customer.create({ data: { tenantId: tenantA.id, phone: '519990066' } });
    const customerB = await prisma.customer.create({ data: { tenantId: tenantB.id, phone: '519990066' } });

    const seqA = await prisma.followUpSequence.create({
      data: {
        tenantId: tenantA.id,
        customerId: customerA.id,
        orderId: 'common_order_id',
        status: 'SCHEDULED',
        stageAtCreation: 'PAYMENT_PENDING',
        anchorAt: new Date()
      }
    });

    const count = await cancelFollowUpOnOrderEvent({
      tenantId: tenantB.id,
      customerId: customerB.id,
      orderId: 'common_order_id',
      reason: 'ORDER_PAID',
      prismaClient: prisma
    });

    assert.strictEqual(count, 0);
    const checkSeqA = await prisma.followUpSequence.findUnique({ where: { id: seqA.id } });
    assert.strictEqual(checkSeqA.status, 'SCHEDULED');
  });

  console.log('\n======================================================================');
  console.log(`🏁 FOLLOW-UP V1 SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (100%)`);
  console.log('======================================================================\n');
}

main().catch(err => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
