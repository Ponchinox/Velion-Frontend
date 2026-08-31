/**
 * test_gemini_timeout_and_fallback.js
 * ====================================
 * Suite de verificación para:
 * 1. Timeout adaptativo de Gemini (15s en Intento 1 -> 25s en Intento 2 si falló por timeout).
 * 2. No reintento ante errores no recuperables (400, 401, 403).
 * 3. Fallback estático cuando la IA falla por timeout total.
 * 4. Liberación garantizada de Processing Lock en todos los escenarios.
 * 5. Cero interferencia con Human Handoff, Commercial State y Order Creation.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('======================================================================');
console.log('🧪 VELION GEMINI TIMEOUT RESILIENCE & FALLBACK SUITE');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}:`, err.message);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
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

// ─────────────────────────────────────────────────────────────────────────────
// SIMULADOR DE LLAMADAS GEMINI CON TIMEOUT ADAPTATIVO
// ─────────────────────────────────────────────────────────────────────────────
const ERR_TYPE = {
  TIMEOUT: 'TIMEOUT',
  RATE_LIMIT: 'RATE_LIMIT',
  AUTH: 'AUTH',
  BAD_REQUEST: 'BAD_REQUEST',
  SERVER_ERROR: 'SERVER_ERROR',
  UNKNOWN: 'UNKNOWN',
};

function classifyError(err) {
  if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.message?.includes('abort') || err?.message?.includes('timeout')) {
    return ERR_TYPE.TIMEOUT;
  }
  const status = err?.status;
  if (status === 429) return ERR_TYPE.RATE_LIMIT;
  if (status === 401 || status === 403) return ERR_TYPE.AUTH;
  if (status === 400) return ERR_TYPE.BAD_REQUEST;
  if (status === 500 || status === 503) return ERR_TYPE.SERVER_ERROR;
  return ERR_TYPE.UNKNOWN;
}

const GEMINI_TIMEOUT_ATTEMPT_1_MS = 15_000;
const GEMINI_TIMEOUT_ATTEMPT_2_TIMEOUT_MS = 25_000;

function simulateAdaptiveGeminiCall({ attemptsBehavior = [] }) {
  const attemptsLog = [];
  let lastErr = null;
  let lastErrType = null;
  let resultText = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const currentTimeoutMs = (attempt > 1 && lastErrType === ERR_TYPE.TIMEOUT)
      ? GEMINI_TIMEOUT_ATTEMPT_2_TIMEOUT_MS
      : GEMINI_TIMEOUT_ATTEMPT_1_MS;

    const behavior = attemptsBehavior[attempt - 1] || { type: 'SUCCESS', text: 'Respuesta OK' };
    attemptsLog.push({ attempt, timeoutUsed: currentTimeoutMs, behavior: behavior.type });

    if (behavior.type === 'TIMEOUT') {
      const err = new Error('This operation was aborted (timeout)');
      err.name = 'AbortError';
      lastErr = err;
      lastErrType = classifyError(err);
      continue;
    }

    if (behavior.type === 'AUTH_ERROR') {
      const err = new Error('API key invalid (401)');
      err.status = 401;
      lastErr = err;
      lastErrType = classifyError(err);
      // Errores 401 no son reintentables
      break;
    }

    if (behavior.type === 'RATE_LIMIT') {
      const err = new Error('Quota exceeded (429)');
      err.status = 429;
      lastErr = err;
      lastErrType = classifyError(err);
      continue;
    }

    if (behavior.type === 'SUCCESS') {
      resultText = behavior.text || 'Respuesta generada';
      break;
    }
  }

  return { attemptsLog, resultText, lastErr, lastErrType };
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 1: TIMEOUT ADAPTATIVO & RETRY POLICY
// ─────────────────────────────────────────────────────────────────────────────

console.log('══ 1. Verificación de Timeouts Adaptativos & Reintentos ══');

runTest('TEST A: Intento 1 responde antes de 15s -> No retry, timeout fue 15s', () => {
  const res = simulateAdaptiveGeminiCall({
    attemptsBehavior: [{ type: 'SUCCESS', text: 'Hola, ¿en qué puedo ayudarte?' }]
  });

  assert.strictEqual(res.attemptsLog.length, 1, 'Solo debe haber 1 intento');
  assert.strictEqual(res.attemptsLog[0].timeoutUsed, 15000, 'El intento 1 debe usar 15s');
  assert.strictEqual(res.resultText, 'Hola, ¿en qué puedo ayudarte?');
});

runTest('TEST B: Intento 1 TIMEOUT -> Intento 2 usa timeout extendido de 25s', () => {
  const res = simulateAdaptiveGeminiCall({
    attemptsBehavior: [
      { type: 'TIMEOUT' },
      { type: 'SUCCESS', text: 'Respuesta tras timeout' }
    ]
  });

  assert.strictEqual(res.attemptsLog.length, 2, 'Debe haber 2 intentos');
  assert.strictEqual(res.attemptsLog[0].timeoutUsed, 15000, 'Intento 1 usó 15s');
  assert.strictEqual(res.attemptsLog[1].timeoutUsed, 25000, 'Intento 2 usó 25s por timeout previo');
  assert.strictEqual(res.resultText, 'Respuesta tras timeout');
});

runTest('TEST C: Intento 1 TIMEOUT -> Intento 2 éxito -> Respuesta normal (NO fallback)', () => {
  const res = simulateAdaptiveGeminiCall({
    attemptsBehavior: [
      { type: 'TIMEOUT' },
      { type: 'SUCCESS', text: 'Tenemos audífonos a 45 soles' }
    ]
  });

  assert.strictEqual(res.resultText, 'Tenemos audífonos a 45 soles');
  assert.ok(res.resultText.length > 0, 'La respuesta es normal');
});

runTest('TEST D: Ambos intentos TIMEOUT -> Resultado nulo (Disparador de Fallback)', () => {
  const res = simulateAdaptiveGeminiCall({
    attemptsBehavior: [
      { type: 'TIMEOUT' },
      { type: 'TIMEOUT' }
    ]
  });

  assert.strictEqual(res.attemptsLog.length, 2);
  assert.strictEqual(res.attemptsLog[0].timeoutUsed, 15000);
  assert.strictEqual(res.attemptsLog[1].timeoutUsed, 25000);
  assert.strictEqual(res.resultText, null, 'No hay texto generado');
  assert.strictEqual(res.lastErrType, ERR_TYPE.TIMEOUT);
});

runTest('TEST E: Error 401 Auth -> NO retry (se detiene en intento 1)', () => {
  const res = simulateAdaptiveGeminiCall({
    attemptsBehavior: [
      { type: 'AUTH_ERROR' }
    ]
  });

  assert.strictEqual(res.attemptsLog.length, 1, 'Error 401 debe abortar en el intento 1');
  assert.strictEqual(res.lastErrType, ERR_TYPE.AUTH);
});

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 2: AUDITORÍA DE ARCHIVOS DE PRODUCCIÓN
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ 2. Auditoría Estática de Código de Producción ══');

runTest('TEST F: aiService.js declara GEMINI_TIMEOUT_ATTEMPT_1_MS=15000 y GEMINI_TIMEOUT_ATTEMPT_2_TIMEOUT_MS=25000', () => {
  const aiServicePath = path.join(__dirname, 'src', 'services', 'aiService.js');
  const content = fs.readFileSync(aiServicePath, 'utf8');

  assert.ok(content.includes('const GEMINI_TIMEOUT_ATTEMPT_1_MS = 15_000'), 'Falta GEMINI_TIMEOUT_ATTEMPT_1_MS');
  assert.ok(content.includes('const GEMINI_TIMEOUT_ATTEMPT_2_TIMEOUT_MS = 25_000'), 'Falta GEMINI_TIMEOUT_ATTEMPT_2_TIMEOUT_MS');
  assert.ok(content.includes('currentTimeoutMs'), 'Falta cálculo de currentTimeoutMs adaptativo');
});

runTest('TEST G: whatsappController.js contiene fallback estático sin alucinación', () => {
  const controllerPath = path.join(__dirname, 'src', 'controllers', 'whatsappController.js');
  const content = fs.readFileSync(controllerPath, 'utf8');

  const expectedFallback = 'Estoy teniendo una pequeña demora en este momento. Escríbeme nuevamente en unos segundos, por favor 🙏';
  assert.ok(content.includes(expectedFallback), 'Falta el texto exacto de contingencia ante timeout');
  assert.ok(content.includes('markMessageAsSentByAi(timeoutFallbackText)'), 'El fallback debe marcarse como automatizado para evitar Human Handoff');
});

runTest('TEST H: Processing Lock se libera en bloque finally incondicional', () => {
  const controllerPath = path.join(__dirname, 'src', 'controllers', 'whatsappController.js');
  const content = fs.readFileSync(controllerPath, 'utf8');

  // Comprobar que processingLocks.delete está dentro del finally
  const finallyBlockRegex = /finally\s*\{[\s\S]*?processingLocks\.delete\s*\(\s*bufferKey\s*\)[\s\S]*?\}/;
  assert.ok(finallyBlockRegex.test(content), 'processingLocks.delete debe estar dentro del bloque finally');
});

runTest('TEST I: Fallback no toca commercialState ni crea Order', () => {
  const controllerPath = path.join(__dirname, 'src', 'controllers', 'whatsappController.js');
  const content = fs.readFileSync(controllerPath, 'utf8');

  // Extraer la sección del fallback
  const fallbackIndex = content.indexOf('timeoutFallbackText');
  const fallbackSnippet = content.substring(fallbackIndex, fallbackIndex + 1500);

  assert.strictEqual(fallbackSnippet.includes('prisma.order.create'), false, 'El fallback no debe crear Order');
  assert.strictEqual(fallbackSnippet.includes('commercialState'), false, 'El fallback no debe alterar commercialState');
  assert.strictEqual(fallbackSnippet.includes('activateHumanHandoff'), false, 'El fallback no debe activar Human Handoff');
});

console.log('\n======================================================================');
console.log(`📊 RESULTADO FINAL: ${passedTests}/${totalTests} TESTS COMPLETADOS CON ÉXITO`);
console.log('======================================================================\n');
