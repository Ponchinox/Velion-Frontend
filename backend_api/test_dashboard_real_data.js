process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import {
  getFollowUps,
  getFollowUpSummary,
  cancelFollowUp,
  updateSettings
} from './src/controllers/followUpController.js';
import {
  CANCEL_REASON_LABELS,
  formatCancelReason,
  formatCustomerDisplay,
  formatFollowUpDate
} from '../src/utils/followUpFormatters.js';

console.log('======================================================================');
console.log('🧪 FOLLOW-UPS DASHBOARD REAL DATA TEST SUITE (TC-DASH-01 TO TC-DASH-15)');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

/**
 * Mock Prisma factory for Dashboard unit testing
 */
function createMockPrisma() {
  const tenants = new Map();
  const customers = new Map();
  const sequences = new Map();
  const attempts = new Map();
  const orders = new Map();

  let idCounter = 1;
  const genId = (prefix) => `${prefix}_${idCounter++}_${Date.now()}`;

  function matchesFilter(val, condition) {
    if (condition === undefined) return true;
    if (val === undefined) return false;
    if (condition === null) return val === null;
    if (typeof condition === 'object' && condition !== null) {
      if (condition.in && Array.isArray(condition.in)) {
        return condition.in.includes(val);
      }
      if (condition.not !== undefined) {
        if (condition.not === null) return val !== null;
        return val !== condition.not;
      }
    }
    return val === condition;
  }

  const mock = {
    _data: { tenants, customers, sequences, attempts, orders },

    tenant: {
      findUnique: async ({ where }) => tenants.get(where.id) || null,
      create: async ({ data }) => {
        const id = data.id || genId('tenant');
        const row = { id, followUpEnabled: false, timezone: null, ...data };
        tenants.set(id, row);
        return row;
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
      create: async ({ data }) => {
        const id = data.id || genId('cust');
        const row = { id, name: null, phone: '519990001', followUpSuppressed: false, ...data };
        customers.set(id, row);
        return row;
      },
      findUnique: async ({ where }) => customers.get(where.id) || null
    },

    order: {
      create: async ({ data }) => {
        const id = data.id || genId('ord');
        const row = { id, status: 'PAID', totalAmount: 100, ...data };
        orders.set(id, row);
        return row;
      },
      findMany: async ({ where = {} }) => {
        return Array.from(orders.values()).filter(o => {
          if (where.id?.in && !where.id.in.includes(o.id)) return false;
          if (where.status?.in && !where.status.in.includes(o.status)) return false;
          return true;
        });
      }
    },

    followUpSequence: {
      create: async ({ data }) => {
        const id = data.id || genId('seq');
        const row = {
          id,
          status: 'SCHEDULED',
          currentAttempt: 0,
          maxAttempts: 3,
          nextRunAt: new Date(),
          anchorAt: new Date(),
          recoveredAt: null,
          cancelReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data
        };
        sequences.set(id, row);
        return row;
      },

      findFirst: async ({ where = {} }) => {
        const list = Array.from(sequences.values());
        return list.find(s => {
          if (where.id && s.id !== where.id) return false;
          if (where.tenantId && s.tenantId !== where.tenantId) return false;
          return true;
        }) || null;
      },

      update: async ({ where, data }) => {
        const s = sequences.get(where.id);
        if (!s) throw new Error('Sequence not found');
        const updated = { ...s, ...data };
        sequences.set(where.id, updated);
        return updated;
      },

      count: async ({ where = {} }) => {
        const list = Array.from(sequences.values());
        return list.filter(s => {
          if (where.tenantId && s.tenantId !== where.tenantId) return false;
          if (!matchesFilter(s.status, where.status)) return false;
          if (where.attempts?.some?.status) {
            const seqAttempts = Array.from(attempts.values()).filter(a => a.sequenceId === s.id);
            const hasStatus = seqAttempts.some(a => a.status === where.attempts.some.status);
            if (!hasStatus) return false;
          }
          return true;
        }).length;
      },

      findMany: async ({ where = {}, skip = 0, take = 50, include = {} }) => {
        let list = Array.from(sequences.values()).filter(s => {
          if (where.tenantId && s.tenantId !== where.tenantId) return false;
          if (!matchesFilter(s.status, where.status)) return false;
          if (where.orderId && !matchesFilter(s.orderId, where.orderId)) return false;
          if (where.attempts?.some?.status) {
            const seqAttempts = Array.from(attempts.values()).filter(a => a.sequenceId === s.id);
            const hasStatus = seqAttempts.some(a => a.status === where.attempts.some.status);
            if (!hasStatus) return false;
          }
          return true;
        });

        const sliced = list.slice(skip, skip + take);

        return sliced.map(s => {
          const res = { ...s };
          if (include.customer) {
            res.customer = customers.get(s.customerId) || null;
          }
          if (include.attempts) {
            res.attempts = Array.from(attempts.values())
              .filter(a => a.sequenceId === s.id)
              .sort((a, b) => a.attemptNumber - b.attemptNumber);
          }
          return res;
        });
      }
    },

    followUpAttempt: {
      create: async ({ data }) => {
        const id = data.id || genId('att');
        const row = {
          id,
          attemptNumber: 1,
          status: 'SENT',
          deliveryStatus: 'DELIVERED',
          deliveredAt: new Date(),
          readAt: null,
          sentAt: new Date(),
          ...data
        };
        attempts.set(id, row);
        return row;
      },

      count: async ({ where = {} }) => {
        return Array.from(attempts.values()).filter(a => {
          if (where.status && a.status !== where.status) return false;
          if (where.sequence?.tenantId) {
            const seq = sequences.get(a.sequenceId);
            if (!seq || seq.tenantId !== where.sequence.tenantId) return false;
          }
          return true;
        }).length;
      }
    }
  };

  return mock;
}

/**
 * Mock HTTP response helper
 */
function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
}

async function runTest(name, fn) {
  totalTests++;
  const prisma = createMockPrisma();
  try {
    await fn(prisma);
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}:`, err.message);
    throw err;
  }
}

async function main() {
  // TC-DASH-01: active endpoint excludes CANCELLED
  await runTest('TC-DASH-01: active endpoint excludes CANCELLED', async (prisma) => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const cust = await prisma.customer.create({ data: { tenantId: tenant.id } });
    await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: cust.id, status: 'CANCELLED', cancelReason: 'MANUAL_CANCEL' }
    });

    const req = { user: { tenantId: tenant.id }, query: { view: 'active' }, prismaClient: prisma };
    const res = createMockRes();
    await getFollowUps(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.length, 0, 'Cancelled sequence must not appear in active view');
  });

  // TC-DASH-02: active endpoint excludes RECOVERED
  await runTest('TC-DASH-02: active endpoint excludes RECOVERED', async (prisma) => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const cust = await prisma.customer.create({ data: { tenantId: tenant.id } });
    await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: cust.id, status: 'RECOVERED', recoveredAt: new Date() }
    });

    const req = { user: { tenantId: tenant.id }, query: { view: 'active' }, prismaClient: prisma };
    const res = createMockRes();
    await getFollowUps(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.length, 0, 'Recovered sequence must not appear in active view');
  });

  // TC-DASH-03: active endpoint includes SCHEDULED
  await runTest('TC-DASH-03: active endpoint includes SCHEDULED', async (prisma) => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const cust = await prisma.customer.create({ data: { tenantId: tenant.id } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: cust.id, status: 'SCHEDULED', currentAttempt: 0 }
    });

    const req = { user: { tenantId: tenant.id }, query: { view: 'active' }, prismaClient: prisma };
    const res = createMockRes();
    await getFollowUps(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.length, 1);
    assert.strictEqual(res.body.data[0].id, seq.id);
    assert.strictEqual(res.body.data[0].status, 'SCHEDULED');
  });

  // TC-DASH-04: active endpoint includes WAITING_NEXT
  await runTest('TC-DASH-04: active endpoint includes WAITING_NEXT', async (prisma) => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const cust = await prisma.customer.create({ data: { tenantId: tenant.id } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: cust.id, status: 'WAITING_NEXT', currentAttempt: 1 }
    });

    const req = { user: { tenantId: tenant.id }, query: { view: 'active' }, prismaClient: prisma };
    const res = createMockRes();
    await getFollowUps(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.length, 1);
    assert.strictEqual(res.body.data[0].id, seq.id);
    assert.strictEqual(res.body.data[0].status, 'WAITING_NEXT');
  });

  // TC-DASH-05: recovered endpoint includes RECOVERED
  await runTest('TC-DASH-05: recovered endpoint includes RECOVERED', async (prisma) => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const cust = await prisma.customer.create({ data: { tenantId: tenant.id } });
    const seq = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: cust.id, status: 'RECOVERED', recoveredAt: new Date() }
    });
    await prisma.followUpAttempt.create({
      data: { sequenceId: seq.id, attemptNumber: 1, status: 'SENT' }
    });

    const req = { user: { tenantId: tenant.id }, query: { view: 'recovered' }, prismaClient: prisma };
    const res = createMockRes();
    await getFollowUps(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.length, 1);
    assert.strictEqual(res.body.data[0].id, seq.id);
    assert.strictEqual(res.body.data[0].status, 'RECOVERED');
  });

  // TC-DASH-06: recovered endpoint excludes CANCELLED
  await runTest('TC-DASH-06: recovered endpoint excludes CANCELLED', async (prisma) => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const cust = await prisma.customer.create({ data: { tenantId: tenant.id } });
    // Cancelled sequence
    await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: cust.id, status: 'CANCELLED', cancelReason: 'MANUAL_CANCEL' }
    });
    // Recovered sequence WITHOUT any SENT attempt (should also be excluded)
    await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: cust.id, status: 'RECOVERED' }
    });

    const req = { user: { tenantId: tenant.id }, query: { view: 'recovered' }, prismaClient: prisma };
    const res = createMockRes();
    await getFollowUps(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.length, 0, 'Cancelled and non-sent sequences must not be in recovered view');
  });

  // TC-DASH-07: history includes terminal statuses
  await runTest('TC-DASH-07: history includes terminal statuses', async (prisma) => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const cust = await prisma.customer.create({ data: { tenantId: tenant.id } });

    await prisma.followUpSequence.create({ data: { tenantId: tenant.id, customerId: cust.id, status: 'RECOVERED' } });
    await prisma.followUpSequence.create({ data: { tenantId: tenant.id, customerId: cust.id, status: 'EXHAUSTED' } });
    await prisma.followUpSequence.create({ data: { tenantId: tenant.id, customerId: cust.id, status: 'CANCELLED' } });
    await prisma.followUpSequence.create({ data: { tenantId: tenant.id, customerId: cust.id, status: 'NEUTRALIZED_INBOUND' } });
    // Active sequence that should NOT be in history
    await prisma.followUpSequence.create({ data: { tenantId: tenant.id, customerId: cust.id, status: 'SCHEDULED' } });

    const req = { user: { tenantId: tenant.id }, query: { view: 'history' }, prismaClient: prisma };
    const res = createMockRes();
    await getFollowUps(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.length, 4, 'History must include all 4 terminal statuses and exclude SCHEDULED');
    const statuses = res.body.data.map(s => s.status);
    assert(statuses.includes('RECOVERED'));
    assert(statuses.includes('EXHAUSTED'));
    assert(statuses.includes('CANCELLED'));
    assert(statuses.includes('NEUTRALIZED_INBOUND'));
    assert(!statuses.includes('SCHEDULED'));
  });

  // TC-DASH-08: terminal next send serializes/display as null
  await runTest('TC-DASH-08: terminal next send serializes/display as null', async (prisma) => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const cust = await prisma.customer.create({ data: { tenantId: tenant.id } });

    const futureDate = new Date(Date.now() + 86400000);
    await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: cust.id, status: 'CANCELLED', nextRunAt: futureDate }
    });
    await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: cust.id, status: 'RECOVERED', nextRunAt: futureDate }
    });
    await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: cust.id, status: 'SCHEDULED', nextRunAt: futureDate }
    });

    const req = { user: { tenantId: tenant.id }, query: { status: 'all' }, prismaClient: prisma };
    const res = createMockRes();
    await getFollowUps(req, res);

    assert.strictEqual(res.statusCode, 200);
    const cancelledSeq = res.body.data.find(s => s.status === 'CANCELLED');
    const recoveredSeq = res.body.data.find(s => s.status === 'RECOVERED');
    const scheduledSeq = res.body.data.find(s => s.status === 'SCHEDULED');

    assert.strictEqual(cancelledSeq.nextRunAt, null, 'Cancelled sequence nextRunAt must serialize as null');
    assert.strictEqual(recoveredSeq.nextRunAt, null, 'Recovered sequence nextRunAt must serialize as null');
    assert.notStrictEqual(scheduledSeq.nextRunAt, null, 'Active sequence nextRunAt must remain intact');
  });

  // TC-DASH-09: KPI active count matches active dataset
  await runTest('TC-DASH-09: KPI active count matches active dataset', async (prisma) => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const cust = await prisma.customer.create({ data: { tenantId: tenant.id } });

    await prisma.followUpSequence.create({ data: { tenantId: tenant.id, customerId: cust.id, status: 'SCHEDULED' } });
    await prisma.followUpSequence.create({ data: { tenantId: tenant.id, customerId: cust.id, status: 'SCHEDULED' } });
    await prisma.followUpSequence.create({ data: { tenantId: tenant.id, customerId: cust.id, status: 'WAITING_NEXT' } });
    await prisma.followUpSequence.create({ data: { tenantId: tenant.id, customerId: cust.id, status: 'CANCELLED' } });
    await prisma.followUpSequence.create({ data: { tenantId: tenant.id, customerId: cust.id, status: 'RECOVERED' } });

    // Check Summary KPI
    const sumReq = { user: { tenantId: tenant.id }, prismaClient: prisma };
    const sumRes = createMockRes();
    await getFollowUpSummary(sumReq, sumRes);

    assert.strictEqual(sumRes.statusCode, 200);
    const activeKpi = sumRes.body.metrics.activeSequences;
    assert.strictEqual(activeKpi, 3, 'Active KPI must count SCHEDULED and WAITING_NEXT (3)');

    // Check active view dataset
    const listReq = { user: { tenantId: tenant.id }, query: { view: 'active' }, prismaClient: prisma };
    const listRes = createMockRes();
    await getFollowUps(listReq, listRes);

    assert.strictEqual(listRes.body.data.length, activeKpi, 'Active dataset length must match KPI active count');
  });

  // TC-DASH-10: KPI recovered matches recovery definition
  await runTest('TC-DASH-10: KPI recovered matches recovery definition', async (prisma) => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const cust = await prisma.customer.create({ data: { tenantId: tenant.id } });

    // Valid recovery (status = RECOVERED + attempt SENT)
    const seq1 = await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: cust.id, status: 'RECOVERED', recoveredAt: new Date() }
    });
    await prisma.followUpAttempt.create({
      data: { sequenceId: seq1.id, attemptNumber: 1, status: 'SENT' }
    });

    // Invalid recovery (status = RECOVERED with NO sent attempt)
    await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: cust.id, status: 'RECOVERED' }
    });

    // Cancelled
    await prisma.followUpSequence.create({
      data: { tenantId: tenant.id, customerId: cust.id, status: 'CANCELLED' }
    });

    const sumReq = { user: { tenantId: tenant.id }, prismaClient: prisma };
    const sumRes = createMockRes();
    await getFollowUpSummary(sumReq, sumRes);

    assert.strictEqual(sumRes.statusCode, 200);
    assert.strictEqual(sumRes.body.metrics.recoveredConversations, 1, 'Only genuine recoveries with SENT attempts count');
    assert.strictEqual(sumRes.body.data.recoveredCount, 1);

    // Matches recovered view length
    const listReq = { user: { tenantId: tenant.id }, query: { view: 'recovered' }, prismaClient: prisma };
    const listRes = createMockRes();
    await getFollowUps(listReq, listRes);

    assert.strictEqual(listRes.body.data.length, 1);
  });

  // TC-DASH-11: tenant isolation
  await runTest('TC-DASH-11: tenant isolation', async (prisma) => {
    const tenantA = await prisma.tenant.create({ data: { id: 'tenant_a', followUpEnabled: true, timezone: 'America/Lima' } });
    const tenantB = await prisma.tenant.create({ data: { id: 'tenant_b', followUpEnabled: true, timezone: 'America/Lima' } });

    const custA = await prisma.customer.create({ data: { tenantId: tenantA.id, phone: '519991111' } });
    const custB = await prisma.customer.create({ data: { tenantId: tenantB.id, phone: '519992222' } });

    await prisma.followUpSequence.create({ data: { tenantId: tenantA.id, customerId: custA.id, status: 'SCHEDULED' } });
    await prisma.followUpSequence.create({ data: { tenantId: tenantB.id, customerId: custB.id, status: 'SCHEDULED' } });

    // Request as Tenant A
    const reqA = { user: { tenantId: tenantA.id }, query: { view: 'active' }, prismaClient: prisma };
    const resA = createMockRes();
    await getFollowUps(reqA, resA);

    assert.strictEqual(resA.body.data.length, 1);
    assert.strictEqual(resA.body.data[0].tenantId, tenantA.id);

    // Cancel attempt on Tenant B sequence from Tenant A must 404
    const seqB = (await prisma.followUpSequence.findMany({ where: { tenantId: tenantB.id } }))[0];
    const cancelReq = { user: { tenantId: tenantA.id }, params: { id: seqB.id }, prismaClient: prisma };
    const cancelRes = createMockRes();
    await cancelFollowUp(cancelReq, cancelRes);

    assert.strictEqual(cancelRes.statusCode, 404, 'Cannot cancel another tenant sequence');
  });

  // TC-DASH-12: JID formatter never changes stored identifier
  await runTest('TC-DASH-12: JID formatter never changes stored identifier', async () => {
    const customerObj = {
      id: 'cust_test_1',
      name: 'Carlos Perez',
      phone: '51987654321@s.whatsapp.net'
    };

    const formatted = formatCustomerDisplay(customerObj);

    // Display values are cleaned
    assert.strictEqual(formatted.displayName, 'Carlos Perez');
    assert.strictEqual(formatted.displayPhone, '+51 987 654 321');
    assert.strictEqual(formatted.isRawJid, true);

    // Stored object is strictly unmodified
    assert.strictEqual(customerObj.phone, '51987654321@s.whatsapp.net', 'Original stored phone must not be mutated');

    // Display fallback without name
    const phoneOnlyCustomer = {
      id: 'cust_test_2',
      name: null,
      phone: '51912345678@s.whatsapp.net'
    };
    const formattedPhoneOnly = formatCustomerDisplay(phoneOnlyCustomer);
    assert.strictEqual(formattedPhoneOnly.displayName, '+51 912 345 678');
    assert.strictEqual(phoneOnlyCustomer.phone, '51912345678@s.whatsapp.net');

    // Strip @c.us and @lid
    const cusCustomer = { name: null, phone: '51900000000@c.us' };
    assert.strictEqual(formatCustomerDisplay(cusCustomer).displayPhone, '+51 900 000 000');
  });

  // TC-DASH-13: cancel reasons map to Spanish labels
  await runTest('TC-DASH-13: cancel reasons map to Spanish labels', async () => {
    assert(CANCEL_REASON_LABELS.MANUAL_CANCEL === 'Cancelado manualmente');
    assert.strictEqual(formatCancelReason('MANUAL_CANCEL'), 'Cancelado manualmente');
    assert.strictEqual(formatCancelReason('HUMAN_HANDOFF'), 'Atención humana transferida');
    assert.strictEqual(formatCancelReason('USER_REQUEST'), 'Solicitud del cliente');
    assert.strictEqual(formatCancelReason('PRODUCT_UNAVAILABLE'), 'Producto no disponible');
    assert.strictEqual(formatCancelReason('META_WINDOW_CLOSED'), 'Ventana de WhatsApp cerrada');
    assert.strictEqual(formatCancelReason('ORDER_PAID'), 'Pedido pagado');
    assert.strictEqual(formatCancelReason('ORDER_COMPLETED'), 'Pedido completado');
    assert.strictEqual(formatCancelReason('ORDER_CANCELED'), 'Pedido cancelado');
    assert.strictEqual(formatCancelReason('PAYMENT_VERIFYING'), 'Comprobante en verificación');

    // Unknown reason fallback produces human label, not raw snake_case
    const fallback = formatCancelReason('CUSTOM_UNKNOWN_REASON');
    assert.strictEqual(fallback, 'Custom Unknown Reason');
    assert(!fallback.includes('_'));
  });

  // TC-DASH-14: timezone formatting uses tenant timezone
  await runTest('TC-DASH-14: timezone formatting uses tenant timezone', async () => {
    // 2026-09-13 19:00:00 UTC = 14:00:00 in America/Lima (UTC-5)
    const utcIso = '2026-09-13T19:00:00.000Z';
    const formattedLima = formatFollowUpDate(utcIso, 'America/Lima');

    assert(formattedLima.includes('14:00'), `Expected 14:00 in America/Lima, got ${formattedLima}`);
    assert(formattedLima.includes('13/09/2026') || formattedLima.includes('13/9/2026'));

    // Different timezone (e.g. America/Santiago UTC-3 in September)
    const formattedSantiago = formatFollowUpDate(utcIso, 'America/Santiago');
    assert(!formattedSantiago.includes('14:00'), 'Different timezone must produce different local time');
  });

  // TC-DASH-15: zero denominator recovery rate = 0%
  await runTest('TC-DASH-15: zero denominator recovery rate = 0%', async (prisma) => {
    const tenant = await prisma.tenant.create({ data: { followUpEnabled: true, timezone: 'America/Lima' } });
    const cust = await prisma.customer.create({ data: { tenantId: tenant.id } });

    // Only scheduled sequences, 0 sent attempts
    await prisma.followUpSequence.create({ data: { tenantId: tenant.id, customerId: cust.id, status: 'SCHEDULED' } });

    const req = { user: { tenantId: tenant.id }, prismaClient: prisma };
    const res = createMockRes();
    await getFollowUpSummary(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.metrics.recoveryRate, 0, 'Zero denominator must evaluate to 0% strictly');
    assert.strictEqual(res.body.data.recoveryRatePercent, 0);
    assert(!Number.isNaN(res.body.metrics.recoveryRate));

    // Also verify dynamic settings update persistence
    const setReq = {
      user: { tenantId: tenant.id },
      body: { timezone: 'America/Lima', followUpEnabled: true },
      prismaClient: prisma
    };
    const setRes = createMockRes();
    await updateSettings(setReq, setRes);
    assert.strictEqual(setRes.statusCode, 200);
    assert.strictEqual(setRes.body.data.followUpEnabled, true);
    assert.strictEqual(setRes.body.data.timezone, 'America/Lima');
  });

  console.log('\n======================================================================');
  console.log(`🏁 DASHBOARD SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (100%)`);
  console.log('======================================================================\n');
}

main().catch(err => {
  console.error('\n💥 Fatal test failure:', err);
  process.exit(1);
});
