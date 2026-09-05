import assert from 'node:assert';
import { isTestTenantFixture } from './scripts/cleanup_test_tenants.js';

console.log('======================================================================');
console.log('🧪 TEST SUITE: TENANT CLEANUP PROTECTION & FIXTURE DETECTION');
console.log('======================================================================\n');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${name}:`, err.message);
  }
}

// ── 1. FIXTURE LEGÍTIMO DE SUITE TEST ───────────────────────────────────────
runTest('1. Fixture creado por suite cumple todos los criterios de test', () => {
  const fixture = {
    id: 'camp-t-52-1788590944493',
    name: 'Tenant camp-t-52-1788590944493',
    users: [],
    orders: [],
    messages: [],
    registeredNumbers: [
      { phoneNumber: 'meta-camp-t-52-1788590944493' }
    ]
  };
  const result = isTestTenantFixture(fixture);
  assert.strictEqual(result.isFixture, true);
});

// ── 2. TENANT REAL SIMULADO (PROTECCIÓN ESTRICTA) ───────────────────────────
runTest('2A. Tenant de producción en lista blanca protegida JAMÁS se toca', () => {
  const realVelion = {
    id: 'dfe020e6-5e08-404c-9b89-ef3f08f2b150',
    name: 'Velion Oficial',
    users: [],
    orders: [],
    messages: [],
    registeredNumbers: []
  };
  const result = isTestTenantFixture(realVelion);
  assert.strictEqual(result.isFixture, false);
  assert.ok(result.reason.includes('lista blanca'));
});

runTest('2B. Tenant con usuarios registrados en tabla User JAMÁS se toca', () => {
  const tenantWithUser = {
    id: 'camp-t-fake-with-user',
    name: 'Tenant camp-t-fake-with-user',
    users: [{ id: 'u-1', email: 'owner@empresa.com' }],
    orders: [],
    messages: [],
    registeredNumbers: []
  };
  const result = isTestTenantFixture(tenantWithUser);
  assert.strictEqual(result.isFixture, false);
  assert.ok(result.reason.includes('usuarios'));
});

runTest('2C. Tenant con órdenes comerciales JAMÁS se toca', () => {
  const tenantWithOrders = {
    id: 'camp-t-with-orders',
    name: 'Tenant camp-t-with-orders',
    users: [],
    orders: [{ id: 'o-1', totalAmount: 150 }],
    messages: [],
    registeredNumbers: []
  };
  const result = isTestTenantFixture(tenantWithOrders);
  assert.strictEqual(result.isFixture, false);
  assert.ok(result.reason.includes('órdenes'));
});

runTest('2D. Tenant con mensajes en chat JAMÁS se toca', () => {
  const tenantWithMsgs = {
    id: 'camp-t-with-messages',
    name: 'Tenant camp-t-with-messages',
    users: [],
    orders: [],
    messages: [{ id: 'm-1' }],
    registeredNumbers: []
  };
  const result = isTestTenantFixture(tenantWithMsgs);
  assert.strictEqual(result.isFixture, false);
  assert.ok(result.reason.includes('mensajes'));
});

runTest('2E. Tenant con número de WhatsApp real (no sintético) JAMÁS se toca', () => {
  const tenantWithRealWA = {
    id: 'camp-t-real-wa',
    name: 'Tenant camp-t-real-wa',
    users: [],
    orders: [],
    messages: [],
    registeredNumbers: [{ phoneNumber: '51984363997' }]
  };
  const result = isTestTenantFixture(tenantWithRealWA);
  assert.strictEqual(result.isFixture, false);
  assert.ok(result.reason.includes('WhatsApp real'));
});

// ── 3. TENANT CON NOMBRE PARECIDO PERO NO EXACTO ────────────────────────────
runTest('3A. ID parecido pero sin prefijo camp-t- se conserva', () => {
  const similarId = {
    id: 'campaign-test-tenant-1',
    name: 'Tenant camp-t-1',
    users: [],
    orders: [],
    messages: [],
    registeredNumbers: []
  };
  const result = isTestTenantFixture(similarId);
  assert.strictEqual(result.isFixture, false);
  assert.ok(result.reason.includes('ID no comienza'));
});

runTest('3B. ID camp-t- pero nombre de negocio real se conserva', () => {
  const similarName = {
    id: 'camp-t-999',
    name: 'Zapatería El Sol SAC',
    users: [],
    orders: [],
    messages: [],
    registeredNumbers: []
  };
  const result = isTestTenantFixture(similarName);
  assert.strictEqual(result.isFixture, false);
  assert.ok(result.reason.includes('Nombre no comienza'));
});

// ── 4. RESILIENCIA ANTE FALLOS (TRY / FINALLY PATTERN) ──────────────────────
runTest('4. Patrón try/finally garantiza registro y limpieza ante excepciones', () => {
  const trackedTenants = new Set();
  const deletedTenants = [];

  function simulatedMakeTenant(id) {
    trackedTenants.add(id);
    return { id, name: `Tenant ${id}` };
  }

  function simulatedCleanup() {
    for (const id of trackedTenants) {
      if (id.startsWith('camp-t-')) {
        deletedTenants.push(id);
      }
    }
    trackedTenants.clear();
  }

  let errorCaught = false;
  try {
    simulatedMakeTenant('camp-t-fail-1');
    simulatedMakeTenant('camp-t-fail-2');
    throw new Error('Crash simulado en mitad de la prueba');
  } catch (e) {
    errorCaught = true;
  } finally {
    simulatedCleanup();
  }

  assert.strictEqual(errorCaught, true);
  assert.strictEqual(deletedTenants.length, 2);
  assert.strictEqual(trackedTenants.size, 0);
});

// ── 5. MÚLTIPLES TENANTS DE TEST EN BATCH ───────────────────────────────────
runTest('5. Múltiples tenants de test se identifican sin omitir ninguno', () => {
  const batch = [
    { id: 'camp-t-1', name: 'Tenant camp-t-1', users: [], orders: [], messages: [], registeredNumbers: [] },
    { id: 'camp-t-2', name: 'Tenant camp-t-2', users: [], orders: [], messages: [], registeredNumbers: [] },
    { id: 'camp-t-3', name: 'Tenant camp-t-3', users: [], orders: [], messages: [], registeredNumbers: [] },
    { id: 'real-tenant-xyz', name: 'Comercio Real', users: [], orders: [], messages: [], registeredNumbers: [] }
  ];

  const fixtures = batch.filter(t => isTestTenantFixture(t).isFixture);
  assert.strictEqual(fixtures.length, 3);
  assert.strictEqual(fixtures.map(f => f.id).join(','), 'camp-t-1,camp-t-2,camp-t-3');
});

console.log('\n======================================================================');
console.log(`📊 RESULTADO CLEANUP GUARD TESTS: ${passed}/${passed + failed} pasados`);
console.log('======================================================================');

if (failed > 0) process.exit(1);
