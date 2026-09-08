process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import http from 'node:http';
import { 
  resolvePort, 
  resolveHost, 
  areBackgroundJobsEnabled, 
  startBackgroundJobsIfEnabled 
} from './src/config/serverConfig.js';
import { app, io, PORT, HOST } from './server.js';

console.log('======================================================================');
console.log('🧪 SUITE FASE 2C-0: BACKGROUND JOBS GATING Y BINDING HOST (H1 - H10)');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ PASS: [${name}]`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: [${name}]`);
    console.error(err);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS: [${name}]`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: [${name}]`);
    console.error(err);
    throw err;
  }
}

// ── H1: BACKGROUND_JOBS_ENABLED undefined => jobs habilitados ─────────────────
runTest('H1: BACKGROUND_JOBS_ENABLED undefined => jobs habilitados por defecto', () => {
  assert.strictEqual(areBackgroundJobsEnabled(undefined), true, 'undefined debe resolver a true');
  assert.strictEqual(areBackgroundJobsEnabled(null), true, 'null debe resolver a true');
  assert.strictEqual(areBackgroundJobsEnabled(''), true, 'string vacío debe resolver a true');
});

// ── H2: BACKGROUND_JOBS_ENABLED=true => habilitados ──────────────────────────
runTest('H2: BACKGROUND_JOBS_ENABLED="true" => habilitados', () => {
  assert.strictEqual(areBackgroundJobsEnabled('true'), true, '"true" debe resolver a true');
  assert.strictEqual(areBackgroundJobsEnabled('TRUE'), true, '"TRUE" en mayúsculas debe resolver a true');
  assert.strictEqual(areBackgroundJobsEnabled(' true '), true, '" true " con espacios debe resolver a true');
});

// ── H3: BACKGROUND_JOBS_ENABLED=false => deshabilitados ───────────────────────
runTest('H3: BACKGROUND_JOBS_ENABLED="false" => deshabilitados', () => {
  assert.strictEqual(areBackgroundJobsEnabled('false'), false, '"false" debe resolver a false');
  assert.strictEqual(areBackgroundJobsEnabled('FALSE'), false, '"FALSE" en mayúsculas debe resolver a false');
  assert.strictEqual(areBackgroundJobsEnabled(' false '), false, '" false " con espacios debe resolver a false');
  assert.strictEqual(areBackgroundJobsEnabled('0'), false, '"0" debe resolver a false');
});

// ── H4: Cuando false no se invoca initCampaignWorkerV2 ────────────────────────
runTest('H4: Cuando backgroundJobsEnabled es false, NO se invoca initCampaignWorkerV2', () => {
  let campaignWorkerCalled = false;
  let backupSchedulerCalled = false;
  const capturedLogs = [];

  const mockLogger = {
    log: (msg) => capturedLogs.push(msg),
    error: (msg) => capturedLogs.push(msg)
  };

  const result = startBackgroundJobsIfEnabled({
    backgroundJobsEnabled: false,
    initCampaignWorkerV2: () => { campaignWorkerCalled = true; return Promise.resolve(); },
    initBackupScheduler: () => { backupSchedulerCalled = true; },
    logger: mockLogger
  });

  assert.strictEqual(result.started, false, 'El resultado debe indicar started: false');
  assert.strictEqual(campaignWorkerCalled, false, 'initCampaignWorkerV2 NO debe ser llamado');
  assert.ok(
    capturedLogs.some(l => l.includes('Background jobs disabled for this process')),
    'Debe registrar el log de jobs deshabilitados sin datos sensibles'
  );
});

// ── H5: Cuando false no se invoca initBackupScheduler ─────────────────────────
runTest('H5: Cuando backgroundJobsEnabled es false, NO se invoca initBackupScheduler', () => {
  let backupSchedulerCalled = false;

  startBackgroundJobsIfEnabled({
    backgroundJobsEnabled: false,
    initCampaignWorkerV2: () => Promise.resolve(),
    initBackupScheduler: () => { backupSchedulerCalled = true; },
    logger: { log: () => {}, error: () => {} }
  });

  assert.strictEqual(backupSchedulerCalled, false, 'initBackupScheduler NO debe ser llamado');
});

// ── Control positivo: cuando true SÍ se invocan ambos workers ────────────────
runTest('Control Positivo: Cuando backgroundJobsEnabled es true, SÍ se invocan ambos workers', () => {
  let campaignWorkerCalled = false;
  let backupSchedulerCalled = false;

  const result = startBackgroundJobsIfEnabled({
    backgroundJobsEnabled: true,
    initCampaignWorkerV2: () => { campaignWorkerCalled = true; return Promise.resolve(); },
    initBackupScheduler: () => { backupSchedulerCalled = true; },
    logger: { log: () => {}, error: () => {} }
  });

  assert.strictEqual(result.started, true, 'El resultado debe indicar started: true');
  assert.strictEqual(campaignWorkerCalled, true, 'initCampaignWorkerV2 DEBE ser llamado');
  assert.strictEqual(backupSchedulerCalled, true, 'initBackupScheduler DEBE ser llamado');
});

// ── H6: API/server puede inicializarse conceptualmente con background jobs false ──
await runAsyncTest('H6: API/server Express responde peticiones HTTP con background jobs en false', async () => {
  const testServer = http.createServer(app);
  
  await new Promise((resolve) => {
    testServer.listen(0, '127.0.0.1', resolve);
  });

  const assignedPort = testServer.address().port;
  assert.ok(assignedPort > 0, 'Servidor efímero debe tener un puerto asignado');

  try {
    const res = await fetch(`http://127.0.0.1:${assignedPort}/ping`);
    assert.strictEqual(res.status, 200, '/ping debe responder HTTP 200');
    const body = await res.text();
    assert.strictEqual(body, 'pong', '/ping debe responder "pong"');
  } finally {
    await new Promise((resolve) => testServer.close(resolve));
  }
});

// ── H7: HOST no definido => 0.0.0.0 ──────────────────────────────────────────
runTest('H7: HOST no definido => resuelve a "0.0.0.0" por defecto', () => {
  assert.strictEqual(resolveHost(undefined), '0.0.0.0', 'undefined debe resolver a 0.0.0.0');
  assert.strictEqual(resolveHost(''), '0.0.0.0', 'string vacío debe resolver a 0.0.0.0');
  assert.strictEqual(resolveHost(null), '0.0.0.0', 'null debe resolver a 0.0.0.0');
});

// ── H8: HOST=127.0.0.1 => 127.0.0.1 ──────────────────────────────────────────
runTest('H8: HOST="127.0.0.1" => resuelve a "127.0.0.1"', () => {
  assert.strictEqual(resolveHost('127.0.0.1'), '127.0.0.1');
  assert.strictEqual(resolveHost(' 127.0.0.1 '), '127.0.0.1', 'debe recortar espacios');
  assert.strictEqual(resolveHost('0.0.0.0'), '0.0.0.0');
});

// ── H9: PORT continúa respetándose ───────────────────────────────────────────
runTest('H9: PORT continúa respetándose con fallback 3000', () => {
  assert.strictEqual(resolvePort(undefined), 3000, 'undefined debe ser 3000');
  assert.strictEqual(resolvePort(''), 3000, 'vacío debe ser 3000');
  assert.strictEqual(resolvePort('8080'), 8080, '"8080" debe ser número 8080');
  assert.strictEqual(resolvePort('4000'), 4000, '"4000" debe ser número 4000');
  assert.strictEqual(resolvePort(5000), 5000, '5000 numérico debe ser 5000');
  assert.strictEqual(resolvePort('invalido'), 3000, 'valor no numérico debe caer a fallback 3000');
});

// ── H10: No se altera Socket.IO/Express por el gating ─────────────────────────
runTest('H10: No se altera Socket.IO ni Express por el gating', () => {
  assert.ok(app, 'Instancia de Express app debe existir');
  assert.ok(io, 'Instancia de Socket.IO io debe existir');
  assert.strictEqual(global.io, io, 'global.io debe estar sincronizado');
  
  // Verificar que los middlewares de autenticación de Socket.IO sigan presentes
  assert.strictEqual(typeof io.use, 'function', 'io.use debe ser función de middleware');
  
  // Verificar que Express tenga las rutas montadas
  const routeStack = app._router ? app._router.stack : [];
  assert.ok(routeStack.length > 5, 'Express router debe tener sus middlewares y rutas cargadas');
  
  const hasPing = routeStack.some(layer => layer.route && layer.route.path === '/ping');
  assert.ok(hasPing, 'Ruta /ping debe estar registrada en la app');
});

console.log(`\n======================================================================`);
console.log(`🎉 SUITE FASE 2C-0 FINALIZADA: ${passedTests}/${totalTests} TESTS PASARON EXITOSAMENTE`);
console.log(`======================================================================\n`);

process.exit(0);
