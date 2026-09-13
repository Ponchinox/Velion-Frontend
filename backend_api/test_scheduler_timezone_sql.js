/**
 * test_scheduler_timezone_sql.js
 * ==============================
 * Regression test for PostgreSQL non-UTC session timezone bug in Follow-up scheduler.
 *
 * Verifies that:
 * 1. Under non-UTC session timezone (e.g. Europe/Berlin, UTC+2):
 *    - A sequence with nextRunAt = T0 + 5 min is NOT claimed (evaluates to 0).
 *    - A sequence with nextRunAt <= T0 is claimed (evaluates to 1).
 *    - claimedAt is stored as UTC (not local session time shifted by +2h).
 *    - Stale recovery does not fire prematurely (< 5m threshold).
 *    - Stale recovery fires after real threshold (> 5m threshold).
 *    - Concurrent worker claims are atomic (SKIP LOCKED).
 */

import assert from 'node:assert';
import defaultPrisma from './src/db.js';
import { claimDueSequences, recoverStaleProcessing } from './src/services/followUpWorker.js';

console.log('======================================================================');
console.log('🧪 FOLLOW-UP POSTGRESQL NON-UTC TIMEZONE REGRESSION TEST');
console.log('======================================================================\n');

async function runRegressionSuite(prisma = defaultPrisma) {
  let passed = 0;
  let total = 0;

  async function step(name, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✅ PASS: ${name}`);
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}:`, err);
      throw err;
    }
  }

  // 1. Force session timezone to Europe/Berlin (UTC+2 in summer)
  await prisma.$executeRawUnsafe("SET TIME ZONE 'Europe/Berlin'");
  const [tzResult] = await prisma.$queryRaw`SELECT current_setting('TIMEZONE') as tz;`;
  console.log(`[Database Session] Current TIMEZONE: ${tzResult.tz}\n`);
  assert.strictEqual(tzResult.tz, 'Europe/Berlin', 'Session timezone must be Europe/Berlin');

  // Generate isolated test tenant & customer to avoid affecting production
  const testSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const testTenant = await prisma.tenant.create({
    data: {
      id: `tz_tenant_${testSuffix}`,
      name: `Timezone Test Tenant ${testSuffix}`,
      followUpEnabled: true,
      timezone: 'Europe/Berlin'
    }
  });

  const testCustomer = await prisma.customer.create({
    data: {
      id: `tz_cust_${testSuffix}`,
      tenantId: testTenant.id,
      phone: `519999${Math.floor(10000 + Math.random() * 90000)}@s.whatsapp.net`,
      name: 'Timezone QA'
    }
  });

  let testSeq = null;

  try {
    // ─── TEST 1: Future sequence (NOW + 5m) MUST NOT be claimed under Europe/Berlin ───
    await step('TC-TZ-01: nextRunAt in future (T0 + 5m) returns 0 claims under Europe/Berlin session', async () => {
      const futureDate = new Date(Date.now() + 5 * 60 * 1000);
      testSeq = await prisma.followUpSequence.create({
        data: {
          tenantId: testTenant.id,
          customerId: testCustomer.id,
          status: 'SCHEDULED',
          currentAttempt: 0,
          maxAttempts: 3,
          anchorAt: new Date(),
          nextRunAt: futureDate,
          stageAtCreation: 'PRODUCT_SELECTED'
        }
      });

      const claimed = await claimDueSequences(10, prisma);
      const claimedTestSeq = claimed.find(s => s.id === testSeq.id);
      assert.strictEqual(
        claimedTestSeq,
        undefined,
        'Sequence with nextRunAt in future must NOT be claimed under non-UTC session timezone!'
      );
    });

    // ─── TEST 2: Due sequence (NOW - 5s) MUST be claimed and claimedAt written in UTC ───
    await step('TC-TZ-02: nextRunAt in past (T0 - 5s) is claimed and claimedAt is written in UTC', async () => {
      const pastDate = new Date(Date.now() - 5000);
      await prisma.followUpSequence.update({
        where: { id: testSeq.id },
        data: { nextRunAt: pastDate, status: 'SCHEDULED' }
      });

      const beforeClaimMs = Date.now();
      const claimed = await claimDueSequences(10, prisma);
      const claimedTestSeq = claimed.find(s => s.id === testSeq.id);
      assert.ok(claimedTestSeq, 'Sequence with past nextRunAt MUST be claimed');
      assert.strictEqual(claimedTestSeq.status, 'PROCESSING');

      // Verify claimedAt in database is close to real UTC Date.now() and NOT shifted by +2 hours
      const refreshed = await prisma.followUpSequence.findUnique({
        where: { id: testSeq.id },
        select: { claimedAt: true }
      });

      assert.ok(refreshed.claimedAt, 'claimedAt must be set');
      const diffMs = Math.abs(refreshed.claimedAt.getTime() - beforeClaimMs);
      assert.ok(
        diffMs < 5000,
        `claimedAt must be within 5s of UTC Date.now(). Got diffMs=${diffMs} (refreshed.claimedAt=${refreshed.claimedAt.toISOString()})`
      );
    });

    // ─── TEST 3: Stale recovery does NOT occur prematurely under Europe/Berlin session ───
    await step('TC-TZ-03: Stale recovery does NOT trigger when claimedAt is only 2 min old (< 5 min threshold)', async () => {
      // Set claimedAt = Date.now() - 2 min (threshold is 5 min)
      const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
      await prisma.followUpSequence.update({
        where: { id: testSeq.id },
        data: { status: 'PROCESSING', claimedAt: twoMinAgo }
      });

      const recoveredCount = await recoverStaleProcessing(prisma);
      const seqState = await prisma.followUpSequence.findUnique({
        where: { id: testSeq.id },
        select: { status: true, claimedAt: true }
      });

      assert.strictEqual(seqState.status, 'PROCESSING', 'Sequence must remain in PROCESSING if under 5 min threshold');
      assert.ok(seqState.claimedAt, 'claimedAt must not be cleared prematurely');
    });

    // ─── TEST 4: Stale recovery DOES occur after real 5 min threshold ───
    await step('TC-TZ-04: Stale recovery triggers when claimedAt is 6 min old (> 5 min threshold)', async () => {
      // Set claimedAt = Date.now() - 6 min (threshold is 5 min)
      const sixMinAgo = new Date(Date.now() - 6 * 60 * 1000);
      await prisma.followUpSequence.update({
        where: { id: testSeq.id },
        data: { status: 'PROCESSING', claimedAt: sixMinAgo }
      });

      const recoveredCount = await recoverStaleProcessing(prisma);
      assert.ok(recoveredCount >= 1, 'Stale sequence must be recovered');

      const seqState = await prisma.followUpSequence.findUnique({
        where: { id: testSeq.id },
        select: { status: true, claimedAt: true }
      });

      assert.strictEqual(seqState.status, 'SCHEDULED', 'Sequence must be rescheduled back to SCHEDULED');
      assert.strictEqual(seqState.claimedAt, null, 'claimedAt must be reset to null');
    });

    // ─── TEST 5: Concurrent double worker claim (SKIP LOCKED) idempotency ───
    await step('TC-TZ-05: Double worker parallel claim is strictly atomic (exactly 1 claim)', async () => {
      await prisma.followUpSequence.update({
        where: { id: testSeq.id },
        data: { status: 'SCHEDULED', nextRunAt: new Date(Date.now() - 5000), claimedAt: null }
      });

      const [claim1, claim2] = await Promise.all([
        claimDueSequences(1, prisma),
        claimDueSequences(1, prisma)
      ]);

      const c1Has = claim1.some(s => s.id === testSeq.id);
      const c2Has = claim2.some(s => s.id === testSeq.id);

      assert.ok(
        (c1Has && !c2Has) || (!c1Has && c2Has),
        'Exactly one worker must claim the sequence under FOR UPDATE SKIP LOCKED'
      );
    });

  } finally {
    // Clean up test data completely
    console.log('\n[Cleanup] Cleaning up timezone regression test records...');
    if (testSeq?.id) {
      await prisma.followUpAttempt.deleteMany({ where: { sequenceId: testSeq.id } }).catch(() => {});
      await prisma.followUpSequence.deleteMany({ where: { id: testSeq.id } }).catch(() => {});
    }
    if (testCustomer?.id) {
      await prisma.customer.deleteMany({ where: { id: testCustomer.id } }).catch(() => {});
    }
    if (testTenant?.id) {
      await prisma.tenant.deleteMany({ where: { id: testTenant.id } }).catch(() => {});
    }
    console.log('[Cleanup] Done.\n');
  }

  console.log('======================================================================');
  console.log(`🏁 NON-UTC TIMEZONE SUITE RESULT: ${passed}/${total} PASS (100%)`);
  console.log('======================================================================\n');
}

// Run if executed directly
if (process.argv[1] && process.argv[1].endsWith('test_scheduler_timezone_sql.js')) {
  runRegressionSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export { runRegressionSuite };
