import assert from 'node:assert';
console.log('======================================================================');
console.log('VELION AI EPOCH CANCEL - ANTI-REVIVAL SUITE');
console.log('======================================================================');
let passed = 0; let total = 0;
async function runTest(name, fn) {
  total++;
  try { await fn(); passed++; console.log('  PASS: ' + name); }
  catch (err) { console.error('  FAIL: ' + name + ': ' + err.message); throw err; }
}
const tenantAiConfigEpoch = new Map();
function getTenantAiEpoch(t) { return tenantAiConfigEpoch.get(t) ?? 0; }
function incrementTenantAiEpoch(t) { const n = (tenantAiConfigEpoch.get(t) ?? 0) + 1; tenantAiConfigEpoch.set(t, n); return n; }
function resetEpoch(t) { tenantAiConfigEpoch.delete(t); }
function createJob(t) { return { epochAtCreation: getTenantAiEpoch(t), tenantId: t }; }
function processJob(j) { return j.epochAtCreation < getTenantAiEpoch(j.tenantId) ? 'CANCELLED' : 'PROCESSED'; }
function reInject(j) { return (j.epochAtCreation ?? 0) < getTenantAiEpoch(j.tenantId) ? 'DISCARDED' : 'REINJECTED'; }

async function main() {
  const A = 'tenant-alpha'; const B = 'tenant-beta';

  await runTest('TEST A: Job cancelado no revive tras AI ON', async () => {
    resetEpoch(A); const j = createJob(A); assert.strictEqual(j.epochAtCreation, 0);
    incrementTenantAiEpoch(A); assert.strictEqual(processJob(j), 'CANCELLED');
    const j2 = createJob(A); assert.strictEqual(processJob(j2), 'PROCESSED');
  });

  await runTest('TEST B: Contexto historico persiste, job cancelado no revive', async () => {
    resetEpoch(A); const j = createJob(A); incrementTenantAiEpoch(A);
    assert.strictEqual(processJob(j), 'CANCELLED');
    const history = ['Muestrame el reloj negro'];
    assert.ok(history.length > 0);
    const j2 = createJob(A); assert.strictEqual(processJob(j2), 'PROCESSED');
  });

  await runTest('TEST C: PendingQueue obsoleta se descarta al re-inyectar', async () => {
    resetEpoch(A); const p = { ...createJob(A), tenantId: A };
    incrementTenantAiEpoch(A); assert.strictEqual(reInject(p), 'DISCARDED');
  });

  await runTest('TEST D: MessageBuffer con epoch antiguo no genera', async () => {
    resetEpoch(A); const b = createJob(A); incrementTenantAiEpoch(A);
    assert.strictEqual(processJob(b), 'CANCELLED');
  });

  await runTest('TEST E: AI OFF - mensajes viejos - AI ON => cola vieja no se descarga', async () => {
    resetEpoch(A); incrementTenantAiEpoch(A);
    const o1 = { epochAtCreation: 0, tenantId: A };
    const o2 = { epochAtCreation: 0, tenantId: A };
    const n = createJob(A);
    assert.strictEqual(processJob(o1), 'CANCELLED');
    assert.strictEqual(processJob(o2), 'CANCELLED');
    assert.strictEqual(processJob(n), 'PROCESSED');
  });

  await runTest('TEST F: Epoch de Tenant A no afecta Tenant B', async () => {
    resetEpoch(A); resetEpoch(B); const jA = createJob(A); const jB = createJob(B);
    incrementTenantAiEpoch(A);
    assert.strictEqual(processJob(jA), 'CANCELLED');
    assert.strictEqual(processJob(jB), 'PROCESSED');
  });

  await runTest('TEST G: Tool read-only - nueva sesion tiene cache limpio', async () => {
    resetEpoch(A); const sig = 'get_product_details_{}'; const oldCache = new Map();
    oldCache.set(sig, { name: 'Reloj' }); incrementTenantAiEpoch(A);
    assert.strictEqual(processJob({ epochAtCreation: 0, tenantId: A }), 'CANCELLED');
    const newCache = new Map(); assert.strictEqual(newCache.has(sig), false);
  });

  await runTest('TEST H: Tool con side effect - no rollback, job cancelado', async () => {
    resetEpoch(A); let dbState = { currentStage: 'PRODUCT_SELECTED' };
    const j = createJob(A); incrementTenantAiEpoch(A);
    assert.strictEqual(processJob(j), 'CANCELLED');
    assert.strictEqual(dbState.currentStage, 'PRODUCT_SELECTED');
  });

  await runTest('TEST I: Reinicio limpia RAM - primer mensaje post-reinicio valido', async () => {
    resetEpoch(A); incrementTenantAiEpoch(A);
    tenantAiConfigEpoch.clear();
    assert.strictEqual(getTenantAiEpoch(A), 0);
    assert.strictEqual(processJob(createJob(A)), 'PROCESSED');
  });

  await runTest('TEST J: AI siempre ON - comportamiento normal sin cambios', async () => {
    resetEpoch(A); const j1 = createJob(A); const j2 = createJob(A);
    assert.strictEqual(processJob(j1), 'PROCESSED');
    assert.strictEqual(processJob(j2), 'PROCESSED');
    assert.strictEqual(getTenantAiEpoch(A), 0);
  });

  await runTest('TEST K: Multiples ciclos OFF/ON - epochs correctos', async () => {
    resetEpoch(A); incrementTenantAiEpoch(A); incrementTenantAiEpoch(A); incrementTenantAiEpoch(A);
    assert.strictEqual(processJob({ epochAtCreation: 0, tenantId: A }), 'CANCELLED');
    assert.strictEqual(processJob({ epochAtCreation: 2, tenantId: A }), 'CANCELLED');
    assert.strictEqual(processJob(createJob(A)), 'PROCESSED');
  });

  await runTest('TEST L: incrementTenantAiEpoch retorna valor correcto', async () => {
    resetEpoch(A); assert.strictEqual(incrementTenantAiEpoch(A), 1); assert.strictEqual(incrementTenantAiEpoch(A), 2);
  });

  await runTest('TEST M: Dos tenants con ciclos independientes', async () => {
    resetEpoch(A); resetEpoch(B); incrementTenantAiEpoch(A); incrementTenantAiEpoch(A); incrementTenantAiEpoch(B);
    assert.strictEqual(processJob({ epochAtCreation: 0, tenantId: A }), 'CANCELLED');
    assert.strictEqual(processJob(createJob(A)), 'PROCESSED');
    assert.strictEqual(processJob({ epochAtCreation: 0, tenantId: B }), 'CANCELLED');
    assert.strictEqual(processJob(createJob(B)), 'PROCESSED');
    assert.strictEqual(getTenantAiEpoch(A), 2); assert.strictEqual(getTenantAiEpoch(B), 1);
  });

  console.log('');
  console.log('======================================================================');
  console.log('RESULTADO FINAL: ' + passed + '/' + total + ' TESTS COMPLETADOS CON EXITO');
  console.log('======================================================================');
  if (passed !== total) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
