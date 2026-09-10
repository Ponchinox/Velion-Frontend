import assert from 'node:assert';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import child_process from 'node:child_process';
import './networkGuard.js';
import { networkGuardMetrics } from './networkGuard.js';

export async function runNetworkGuardSuite() {
  console.log('\n======================================================================');
  console.log('🔒 SUITE: VELION NETWORK GUARD & ADVERSARIAL DEFENSE (S/0.00)');
  console.log('======================================================================');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✅ PASS: ${name}`);
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}: ${err.message}`);
      throw err;
    }
  }

  // 1. fetch bloqueado ante dominio externo
  await test('1. fetch() a dominio externo (Gemini) es bloqueado antes de la conexión', async () => {
    let blocked = false;
    try {
      await fetch('https://generativelanguage.googleapis.com/v1beta/models');
    } catch (err) {
      blocked = err.message.includes('FATAL_QA_NETWORK_VIOLATION');
    }
    assert.strictEqual(blocked, true, 'fetch debe arrojar FATAL_QA_NETWORK_VIOLATION');
  });

  // 2. https.request bloqueado ante WAN
  await test('2. https.request() a example.com es interceptado inmediatamente', async () => {
    let blocked = false;
    try {
      https.request('https://example.com');
    } catch (err) {
      blocked = err.message.includes('FATAL_QA_NETWORK_VIOLATION');
    }
    assert.strictEqual(blocked, true, 'https.request debe arrojar FATAL_QA_NETWORK_VIOLATION');
  });

  // 3. net.connect bloqueado ante IP WAN
  await test('3. net.connect() a IP WAN (8.8.8.8:53) falla a nivel socket', async () => {
    let blocked = false;
    try {
      net.connect({ host: '8.8.8.8', port: 53 });
    } catch (err) {
      blocked = err.message.includes('FATAL_QA_NETWORK_VIOLATION');
    }
    assert.strictEqual(blocked, true, 'net.connect WAN debe arrojar FATAL_QA_NETWORK_VIOLATION');
  });

  // 4. tls.connect bloqueado ante host WAN
  await test('4. tls.connect() a host WAN (api.groq.com:443) falla a nivel TLS', async () => {
    let blocked = false;
    try {
      tls.connect({ host: 'api.groq.com', port: 443 });
    } catch (err) {
      blocked = err.message.includes('FATAL_QA_NETWORK_VIOLATION');
    }
    assert.strictEqual(blocked, true, 'tls.connect WAN debe arrojar FATAL_QA_NETWORK_VIOLATION');
  });

  // 5. Accidental Evolution WAN call
  await test('5. Llamada accidental a Evolution API externo es abortada sin socket', async () => {
    let blocked = false;
    try {
      http.request('http://evolution-vps-externo.com/message/sendMedia');
    } catch (err) {
      blocked = err.message.includes('FATAL_QA_NETWORK_VIOLATION');
    }
    assert.strictEqual(blocked, true, 'Llamada externa a Evolution debe ser bloqueada');
  });

  // 6. Conexión a PostgreSQL real (puerto 5432) bloqueada en 127.0.0.1
  await test('6. Conexión a PostgreSQL real (127.0.0.1:5432) es bloqueada', async () => {
    let blocked = false;
    try {
      net.connect({ host: '127.0.0.1', port: 5432 });
    } catch (err) {
      blocked = err.message.includes('FATAL_QA_DATABASE_ACCESS_VIOLATION');
    }
    assert.strictEqual(blocked, true, '127.0.0.1:5432 debe arrojar FATAL_QA_DATABASE_ACCESS_VIOLATION');
  });

  // 7. Conexión a PostgreSQL real en localhost:5432
  await test('7. Conexión a PostgreSQL real (localhost:5432) es bloqueada', async () => {
    let blocked = false;
    try {
      net.connect({ host: 'localhost', port: 5432 });
    } catch (err) {
      blocked = err.message.includes('FATAL_QA_DATABASE_ACCESS_VIOLATION');
    }
    assert.strictEqual(blocked, true, 'localhost:5432 debe arrojar FATAL_QA_DATABASE_ACCESS_VIOLATION');
  });

  // 8. Conexión a PostgreSQL real en ::1:5432
  await test('8. Conexión a PostgreSQL real (::1:5432) es bloqueada', async () => {
    let blocked = false;
    try {
      net.connect({ host: '::1', port: 5432 });
    } catch (err) {
      blocked = err.message.includes('FATAL_QA_DATABASE_ACCESS_VIOLATION');
    }
    assert.strictEqual(blocked, true, '::1:5432 debe arrojar FATAL_QA_DATABASE_ACCESS_VIOLATION');
  });

  // 9. Escape vía binarios CLI externos (curl, wget)
  await test('9. Escape vía subproceso OS (curl / wget) es bloqueado inmediatamente', async () => {
    let curlBlocked = false;
    try {
      child_process.exec('curl https://example.com');
    } catch (err) {
      curlBlocked = err.message.includes('FATAL_QA_NETWORK_VIOLATION');
    }
    assert.strictEqual(curlBlocked, true, 'curl debe ser bloqueado');

    let wgetBlocked = false;
    try {
      child_process.spawn('wget', ['https://example.com']);
    } catch (err) {
      wgetBlocked = err.message.includes('FATAL_QA_NETWORK_VIOLATION');
    }
    assert.strictEqual(wgetBlocked, true, 'wget debe ser bloqueado');
  });

  // 10. Escape vía PowerShell Invoke-WebRequest
  await test('10. Escape vía PowerShell Invoke-WebRequest es bloqueado', async () => {
    let psBlocked = false;
    try {
      child_process.exec('powershell -Command Invoke-WebRequest https://example.com');
    } catch (err) {
      psBlocked = err.message.includes('FATAL_QA_NETWORK_VIOLATION');
    }
    assert.strictEqual(psBlocked, true, 'PowerShell con web request debe ser bloqueado');
  });

  // 11. Loopback local autorizado funciona
  await test('11. Conexión loopback local autorizada (mock HTTP) funciona correctamente', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'mock_ok', cost: '0.00' }));
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const resp = await fetch(`http://127.0.0.1:${port}/mock-endpoint`);
      const data = await resp.json();
      assert.strictEqual(data.status, 'mock_ok');
      assert.strictEqual(data.cost, '0.00');
    } finally {
      server.close();
    }
  });

  // 12. Credenciales de entorno neutralizadas
  await test('12. Credenciales reales de producción están neutralizadas con dummies', async () => {
    assert.ok(process.env.GEMINI_API_KEY.startsWith('MOCK_QA_BLOCKED_'));
    assert.ok(process.env.GROQ_API_KEY.startsWith('MOCK_QA_BLOCKED_'));
    assert.ok(process.env.EVOLUTION_API_KEY.startsWith('MOCK_QA_BLOCKED_'));
    assert.ok(process.env.STRIPE_SECRET_KEY.startsWith('MOCK_QA_BLOCKED_'));
    assert.strictEqual(process.env.QA_MODE, 'true');
    assert.ok(process.env.DATABASE_URL.includes('mock_qa_blocked'));
  });

  console.log(`\n🎉 NETWORK GUARD SUITE: ${passed}/${total} TESTS PASARON EXITOSAMENTE`);
  return { passed, total };
}

if (process.argv[1] && process.argv[1].endsWith('networkGuard.test.js')) {
  runNetworkGuardSuite().then(() => process.exit(0)).catch(() => process.exit(1));
}
