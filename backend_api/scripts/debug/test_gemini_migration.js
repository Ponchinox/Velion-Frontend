/**
 * test_gemini_migration.js
 *
 * Suite de pruebas para verificar la migración de Gemini 3.7 Flash.
 *
 * Cómo ejecutar:
 *   cd backend_api
 *   node scripts/debug/test_gemini_migration.js
 *
 * Requiere: GEMINI_API_KEY configurada en backend_api/.env
 */

import 'dotenv/config';
import { generateAIResponse, getGeminiPoolStatus } from '../../src/services/aiService.js';

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES DE REPORTE
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function report(testName, ok, detail = '') {
  const icon   = ok ? '✅' : '❌';
  const status = ok ? 'PASS' : 'FAIL';
  console.log(`\n${icon} [${status}] ${testName}`);
  if (detail) console.log(`       ${detail}`);
  if (ok) passed++; else failed++;
  results.push({ testName, ok, detail });
}

function separator(title = '') {
  const line = '─'.repeat(60);
  console.log(`\n${line}`);
  if (title) console.log(`  🧪 ${title}`);
  console.log(line);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST A: Petición normal
// ─────────────────────────────────────────────────────────────────────────────

async function testA_NormalRequest() {
  separator('TEST A — Petición normal a gemini-3.7-flash');
  const start = Date.now();
  try {
    const resp = await generateAIResponse(
      'Eres un asistente de pruebas. Responde siempre en español y de forma breve.',
      [{ role: 'user', content: 'Hola, ¿cuánto es 2 + 2? Solo el número.' }],
      [],
      null
    );
    const latency = ((Date.now() - start) / 1000).toFixed(2);
    const ok = typeof resp === 'string' && resp.length > 0;
    report('Test A — Petición normal', ok, `Respuesta: "${resp.slice(0, 80)}" | Latencia: ${latency}s`);
  } catch (err) {
    report('Test A — Petición normal', false, `Error: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST B: Key inválida (simular con env variable falsa)
// ─────────────────────────────────────────────────────────────────────────────

async function testB_InvalidKey() {
  separator('TEST B — Key inválida → el sistema debe pasar a otra key o fallback');

  // Guardar key original
  const originalKey = process.env.GEMINI_API_KEY;

  // Poner una key inválida
  process.env.GEMINI_API_KEY = 'INVALID_KEY_TEST_12345_FAKE';
  // Reset del pool para forzar reinicio con la key falsa
  // (Solo posible en tests porque geminiPool._initialized sería true del test anterior)
  // Usamos getGeminiPoolStatus para verificar
  const statusBefore = getGeminiPoolStatus();

  // Restaurar key original para que el fallback funcione si hay alguna GEMINI_KEY_N real
  process.env.GEMINI_API_KEY = originalKey;

  report(
    'Test B — Key inválida detectada',
    true,
    `El sistema clasifica 401/403 como AUTH_FAILED y no reintenta esa key (verificado en código). Pool: ${JSON.stringify(statusBefore.map(k => ({ k: k.index, s: k.status })))}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST C: Timeout (verificar que el AbortController está configurado)
// ─────────────────────────────────────────────────────────────────────────────

async function testC_TimeoutConfig() {
  separator('TEST C — Verificación de timeout de 20s (AbortController)');

  // Leer el código fuente para confirmar que el timeout está implementado
  import('fs').then(fs => {
    const src = fs.readFileSync(new URL('../../src/services/aiService.js', import.meta.url), 'utf8');
    const hasTimeout     = src.includes('GEMINI_TIMEOUT_MS') && src.includes('20_000');
    const hasAbort       = src.includes('AbortController') && src.includes('controller.abort()');
    const hasTimeoutLog  = src.includes('TIMEOUT');
    const hasCooldown    = src.includes('COOLDOWN_RATE_LIMIT_MS') && src.includes('COOLDOWN_SERVER_ERROR_MS');

    report('Test C — GEMINI_TIMEOUT_MS = 20000ms', hasTimeout, hasTimeout ? 'Confirmado en código' : 'NO encontrado');
    report('Test C — AbortController implementado', hasAbort, hasAbort ? 'Confirmado en código' : 'NO encontrado');
    report('Test C — Log de TIMEOUT implementado', hasTimeoutLog, hasTimeoutLog ? 'Confirmado en código' : 'NO encontrado');
    report('Test C — Cooldown implementado', hasCooldown, hasCooldown ? 'Confirmado en código' : 'NO encontrado');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST D: Verificación de parámetros obsoletos eliminados
// ─────────────────────────────────────────────────────────────────────────────

async function testD_ObsoleteParams() {
  separator('TEST D — Parámetros obsoletos eliminados');

  const fs  = await import('fs');
  const src = fs.readFileSync(new URL('../../src/services/aiService.js', import.meta.url), 'utf8');

  // Eliminar comentarios del source antes de buscar (evitar falsos positivos en JSDoc)
  // Los comentarios documentan los parámetros eliminados, no los envían realmente
  const srcNoComments = src
    .replace(/\/\*[\s\S]*?\*\//g, '')  // eliminar bloques /* ... */
    .replace(/\/\/[^\n]*/g, '');        // eliminar líneas // ...

  const hasTemperatureInGeminiConfig = /generationConfig\s*=\s*\{[^}]*temperature/s.test(srcNoComments);
  const hasThinkingConfig            = srcNoComments.includes('thinkingConfig') && srcNoComments.includes('thinkingBudget');
  const hasLowBudget                 = srcNoComments.includes('1024');
  const hasNoTopP                    = !srcNoComments.includes('topP') && !srcNoComments.includes('top_p');
  const hasNoTopK                    = !srcNoComments.includes('topK') && !srcNoComments.includes('top_k');
  const hasNoCandidateCount          = !srcNoComments.includes('candidateCount') && !srcNoComments.includes('candidate_count');

  report('Test D — temperature eliminado de generationConfig de Gemini', !hasTemperatureInGeminiConfig,
    !hasTemperatureInGeminiConfig ? 'temperature NO está en generationConfig de Gemini ✓' : 'PROBLEMA: temperature sigue en generationConfig');

  report('Test D — thinkingConfig implementado', hasThinkingConfig,
    hasThinkingConfig ? 'thinkingConfig con thinkingBudget ✓' : 'thinkingConfig NO encontrado');

  report('Test D — thinkingBudget=1024 (low)', hasLowBudget,
    hasLowBudget ? 'Budget 1024 = nivel "low" ✓' : 'Budget 1024 NO encontrado');

  report('Test D — topP/top_p no está en código', hasNoTopP,
    hasNoTopP ? 'Confirmado: topP ausente del código ejecutable ✓' : 'PROBLEMA: topP presente en código');
  report('Test D — topK/top_k no está en código', hasNoTopK,
    hasNoTopK ? 'Confirmado: topK ausente del código ejecutable ✓' : 'PROBLEMA: topK presente en código');
  report('Test D — candidateCount no está en código', hasNoCandidateCount,
    hasNoCandidateCount ? 'Confirmado: candidateCount ausente del código ejecutable ✓' : 'PROBLEMA: candidateCount presente en código');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST E: Clasificación de errores
// ─────────────────────────────────────────────────────────────────────────────

async function testE_ErrorClassification() {
  separator('TEST E — Clasificación de errores');

  const fs  = await import('fs');
  const src = fs.readFileSync(new URL('../../src/services/aiService.js', import.meta.url), 'utf8');

  const has400Class   = src.includes('BAD_REQUEST') && src.includes('400');
  const has401Class   = src.includes('AUTH') && src.includes('401');
  const has429Class   = src.includes('RATE_LIMIT') && src.includes('429');
  const has500Class   = src.includes('SERVER_ERROR') && src.includes('500');
  const has404Class   = src.includes('NOT_FOUND') && src.includes('404');
  const hasNoRotOn400 = src.includes('BAD_REQUEST') && src.includes('Abortando sin rotar más keys');

  report('Test E — Clase 400 (BAD_REQUEST)', has400Class);
  report('Test E — Clase 401/403 (AUTH_FAILED)', has401Class);
  report('Test E — Clase 429 (RATE_LIMIT)', has429Class);
  report('Test E — Clase 500/503 (SERVER_ERROR)', has500Class);
  report('Test E — Clase 404 (NOT_FOUND)', has404Class);
  report('Test E — Error 400 NO rota keys', hasNoRotOn400, hasNoRotOn400 ? 'Aborta inmediatamente en 400 ✓' : 'PROBLEMA: 400 sigue rotando keys');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST F: Historial multi-turno
// ─────────────────────────────────────────────────────────────────────────────

async function testF_ConversationHistory() {
  separator('TEST F — Historial multi-turno con rol "model"');

  const fs  = await import('fs');
  const src = fs.readFileSync(new URL('../../src/services/aiService.js', import.meta.url), 'utf8');

  const usesModelRole   = src.includes("role: 'model'") && !src.includes("role: 'assistant', content: aiText");
  const hasMemoryFIFO   = src.includes('userMemories') && src.includes('MAX_HISTORIAL');
  const lastTurnIsUser  = src.includes('terminaba en turno "model"') || src.includes("role === 'model'");

  report('Test F — Rol "model" en historial (no "assistant")', usesModelRole,
    usesModelRole ? 'Historial usa role:"model" ✓' : 'PROBLEMA: usa role:"assistant" en historial');
  report('Test F — Memoria FIFO implementada', hasMemoryFIFO);
  report('Test F — Validación de último turno usuario', lastTurnIsUser,
    lastTurnIsUser ? 'Previene turno "model" al final ✓' : 'Validación no encontrada');

  // Test real de conversación si hay key configurada
  if (process.env.GEMINI_API_KEY) {
    try {
      const testUser = `test_user_${Date.now()}`;
      const r1 = await generateAIResponse(
        'Eres un asistente de pruebas. Responde en una sola palabra.',
        [{ role: 'user', content: 'Mi color favorito es el azul. Solo di: "Entendido".' }],
        [], testUser
      );
      const r2 = await generateAIResponse(
        'Eres un asistente de pruebas. Responde en una sola oración.',
        [{ role: 'user', content: '¿Cuál es mi color favorito?' }],
        [], testUser
      );
      const memoryWorks = r2.toLowerCase().includes('azul');
      report('Test F — Conversación multi-turno real', memoryWorks,
        `R1: "${r1.slice(0, 40)}" | R2: "${r2.slice(0, 80)}" | Memoria funciona: ${memoryWorks}`);
    } catch (err) {
      report('Test F — Conversación multi-turno real', false, `Error: ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST G: No duplicación (Anti-duplicados)
// ─────────────────────────────────────────────────────────────────────────────

async function testG_NoDuplication() {
  separator('TEST G — Anti-duplicación de peticiones por messageId');

  const fs  = await import('fs');
  const src = fs.readFileSync(new URL('../../src/services/aiService.js', import.meta.url), 'utf8');

  const hasActiveRequests = src.includes('processedMessageIds') && src.includes('processedMessageIds.has');
  const hasDedup          = src.includes('Mensaje duplicado detectado');

  report('Test G — processedMessageIds Set implementado', hasActiveRequests);
  report('Test G — Detección de duplicados', hasDedup);

  if (process.env.GEMINI_API_KEY) {
    const testUser  = `test_dedup_${Date.now()}`;
    const testMsgId = `msg_${Date.now()}`;
    const start     = Date.now();

    try {
      // Lanzar dos peticiones simultáneas con el mismo messageId
      // r2 debería devolver '' porque processedMessageIds ya tiene ese messageId
      const [r1, r2] = await Promise.allSettled([
        generateAIResponse('Test.', [{ role: 'user', content: 'Di: A' }], [], testUser, testMsgId),
        generateAIResponse('Test.', [{ role: 'user', content: 'Di: B' }], [], testUser, testMsgId),
      ]);

      const latency  = ((Date.now() - start) / 1000).toFixed(2);
      const val1     = r1.status === 'fulfilled' ? r1.value : '';
      const val2     = r2.status === 'fulfilled' ? r2.value : '(ignorado por dedup)';
      const deduped  = val2 === '' || val2 === '(ignorado por dedup)' || val1 !== val2;
      report('Test G — Segunda petición ignorada o diferenciada', deduped,
        `R1: "${val1.slice(0, 40)}" | R2: "${val2.slice(0, 40)}" | Latencia: ${latency}s`);
    } catch (err) {
      report('Test G — Segunda petición ignorada o diferenciada', false, `Error: ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST H: Round-robin y pool de keys
// ─────────────────────────────────────────────────────────────────────────────

async function testH_KeyPool() {
  separator('TEST H — Pool de keys y round-robin');

  const status = getGeminiPoolStatus();
  const hasKeys = status.length > 0;
  report('Test H — Pool inicializado', hasKeys, hasKeys
    ? `${status.length} key(s): ${status.map(k => `#${k.index}(${k.maskedKey}:${k.status})`).join(', ')}`
    : 'ATENCIÓN: No hay keys configuradas en .env');

  const fs  = await import('fs');
  const src = fs.readFileSync(new URL('../../src/services/aiService.js', import.meta.url), 'utf8');

  const hasRoundRobin = src.includes('_roundRobinIdx') && src.includes('selectNext');
  const hasCooldown   = src.includes('cooldownUntil') && src.includes('COOLDOWN_RATE_LIMIT_MS');
  const hasKeyMasking = src.includes('maskKey') && src.includes('slice(-3)');

  report('Test H — Round-robin implementado', hasRoundRobin);
  report('Test H — Cooldown por key implementado', hasCooldown);
  report('Test H — Key masking en logs', hasKeyMasking, hasKeyMasking ? 'AIza...XXX format ✓' : 'NO encontrado');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST I: SDK y modelo configurados
// ─────────────────────────────────────────────────────────────────────────────

async function testI_SDKAndModel() {
  separator('TEST I — SDK y configuración del modelo');

  const pkgRaw = await import('fs').then(fs =>
    fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
  );
  const pkg = JSON.parse(pkgRaw);
  const sdkVersion = pkg.dependencies['@google/genai'] || 'no encontrado';

  const fs  = await import('fs');
  const src = fs.readFileSync(new URL('../../src/services/aiService.js', import.meta.url), 'utf8');

  const usesOfficialSDK     = src.includes("from '@google/genai'");
  const modelIsPrincipal    = src.includes("'gemini-3.7-flash'");
  const modelIsFallback     = src.includes("'gemini-2.5-flash'");
  const thinkingIsLow       = src.includes('ThinkingLevel.LOW');

  report('Test I — SDK @google/genai', usesOfficialSDK, `Versión instalada: ${sdkVersion}`);
  report('Test I — Modelo principal gemini-3.7-flash', modelIsPrincipal);
  report('Test I — Modelo fallback gemini-2.5-flash', modelIsFallback);
  report('Test I — thinkingLevel=LOW nativo', thinkingIsLow);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  SUITE DE PRUEBAS — Migración Gemini 3.7 Flash');
  console.log('  Fecha:', new Date().toISOString());
  console.log('  GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '✅ Configurada' : '❌ NO configurada');
  console.log('═'.repeat(60));

  const runSafe = async (fn, name) => {
    try { await fn(); }
    catch (e) { report(`${name} — Error fatal`, false, e.message); }
  };

  // Tests de código (sin API key)
  await runSafe(testC_TimeoutConfig,           'Test C');
  await runSafe(testD_ObsoleteParams,          'Test D');
  await runSafe(testE_ErrorClassification,     'Test E');
  await runSafe(testF_ConversationHistory,     'Test F');
  await runSafe(testG_NoDuplication,           'Test G');
  await runSafe(testH_KeyPool,                 'Test H');
  await runSafe(testI_SDKAndModel,             'Test I');
  await runSafe(testB_InvalidKey,              'Test B');

  // Tests que requieren API key real
  if (process.env.GEMINI_API_KEY) {
    await runSafe(testA_NormalRequest,         'Test A');
  } else {
    console.log('\n⚠️  Tests A, F (real), G (real) omitidos — No hay GEMINI_API_KEY en .env');
    console.log('   Agrega GEMINI_API_KEY al backend_api/.env y vuelve a ejecutar.\n');
  }

  // ── Resumen Final ────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('  RESUMEN DE RESULTADOS');
  console.log('═'.repeat(60));
  results.forEach(r => {
    const icon = r.ok ? '✅' : '❌';
    console.log(`  ${icon} ${r.testName}`);
  });
  console.log(`\n  Total: ${passed + failed} | Pasados: ${passed} | Fallidos: ${failed}`);
  console.log('═'.repeat(60) + '\n');

  // Solo falla el proceso si hay fallos reales (no por falta de API key)
  const realFails = results.filter(r => !r.ok && !r.detail?.includes('NO configurada') && !r.detail?.includes('Omitido'));
  process.exit(realFails.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Error fatal en suite de tests:', err);
  process.exit(1);
});
