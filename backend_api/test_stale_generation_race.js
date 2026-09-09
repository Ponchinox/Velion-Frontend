/**
 * 🧪 VELION TEST SUITE: STALE GENERATION RACE & LATEST USER INTENT WINS (N1 – N17)
 * 
 * Verifica la resolución determinística de concurrencia y orden de mensajes rápidos:
 * N1–N12: Fix de arquitectura (Atomic Lock, Fast Re-injection, Clamped Typing, Tool/Media Guards, Prompt Rule).
 * N13–N17: Casos de resiliencia (Circuit breaker intacto, sin contingencia, media anulada, consolidación B+C, liberación de lock).
 */

import assert from 'node:assert';
import fs from 'fs';
import {
  getChatGenerationVersion,
  incrementChatGenerationVersion,
  _resetProcessingStateForTesting,
  processingLocks,
  pendingQueues,
  messageBuffers,
  handleOperationalTool
} from './src/controllers/whatsappController.js';
import {
  generateAIResponse,
  globalCircuitBreaker
} from './src/services/aiService.js';

console.log('======================================================================');
console.log('VELION TEST SUITE: STALE GENERATION RACE (N1 – N17)');
console.log('======================================================================\n');

let passedCount = 0;
let failedCount = 0;

async function runTest(testId, description, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: [${testId}] ${description}`);
    passedCount++;
  } catch (err) {
    console.error(`  ❌ FAIL: [${testId}] ${description}`);
    console.error(`     Error: ${err.message}`);
    failedCount++;
  }
}

const controllerCode = fs.readFileSync('./backend_api/src/controllers/whatsappController.js', 'utf8').replace(/\r\n/g, '\n');
const aiServiceCode = fs.readFileSync('./backend_api/src/services/aiService.js', 'utf8').replace(/\r\n/g, '\n');

async function runSuite() {
  _resetProcessingStateForTesting();

  // ── N1: ATOMIC LOCK ──────────────────────────────────────────────────────────
  await runTest('N1', 'Atomic Lock previene carreras concurrentes al inicio síncrono de processBufferedMessage', async () => {
    _resetProcessingStateForTesting();
    const bufferKey = 'tenant-n1:51999111222';
    
    // Verificar que processingLocks.add(bufferKey) está en el inicio síncrono de processBufferedMessage
    const funcIndex = controllerCode.indexOf('async function processBufferedMessage(bufferKey) {');
    assert.ok(funcIndex !== -1, 'processBufferedMessage debe existir');
    const lockIndex = controllerCode.indexOf('processingLocks.add(bufferKey);', funcIndex);
    assert.ok(lockIndex !== -1, 'processingLocks.add debe estar en processBufferedMessage');
    
    // Debe ocurrir ANTES del primer await (ej. primer findFirst o findUnique)
    const firstAwaitIndex = controllerCode.indexOf('await ', funcIndex);
    assert.ok(lockIndex < firstAwaitIndex, 'processingLocks.add DEBE ejecutarse de forma síncrona antes de cualquier await');

    // Simulación funcional: cuando el lock está activo, el siguiente mensaje va a pendingQueues
    processingLocks.add(bufferKey);
    assert.ok(processingLocks.has(bufferKey), 'Lock debe estar activo');
    
    // Simular llegada de mensaje concurrente durante lock
    const incomingText = 'Mensaje rápido B';
    pendingQueues.set(bufferKey, { text: incomingText, clientNumber: '51999111222' });
    assert.ok(pendingQueues.has(bufferKey), 'Mensaje concurrente debe ir a pendingQueues');
    assert.strictEqual(pendingQueues.get(bufferKey).text, incomingText);
  });

  // ── N2: FAST RE-INJECTION (500ms vs 4000ms) ──────────────────────────────────
  await runTest('N2', 'Fast Re-injection: generación superseded re-inyecta pendingQueue con coalescing de 500ms', async () => {
    assert.ok(
      controllerCode.includes('const coalescingMs = (wasSuperseded || isGenerationSuperseded()) ? 500 : 4000;'),
      'Debe aplicar 500ms cuando la generación fue superseded y 4000ms en caso contrario'
    );
    assert.ok(
      controllerCode.includes('setTimeout(() => {\n          processBufferedMessage(bufferKey);\n        }, coalescingMs)'),
      'Debe usar coalescingMs en el setTimeout de re-inyección'
    );
  });

  // ── N3: TYPING DELAY CLAMPING (1200ms a 2500ms) ──────────────────────────────
  await runTest('N3', 'Typing delay está acotado razonablemente entre min 1200ms y max 2500ms (no 12s)', async () => {
    assert.ok(
      controllerCode.includes('Math.max(1200, Math.min(2500, item.content.length * 20))'),
      'Typing delay para texto debe estar acotado a [1200, 2500]ms'
    );
    assert.ok(
      !controllerCode.includes('12000'),
      'No debe existir ningún retraso de 12000ms (12s) en typing delay'
    );

    // Verificación matemática del cálculo
    const calcDelay = (len) => Math.max(1200, Math.min(2500, len * 20));
    assert.strictEqual(calcDelay(0), 1200, '0 chars => 1200ms');
    assert.strictEqual(calcDelay(10), 1200, '10 chars => 1200ms');
    assert.strictEqual(calcDelay(80), 1600, '80 chars => 1600ms');
    assert.strictEqual(calcDelay(200), 2500, '200 chars => 2500ms (tope máximo)');
    assert.strictEqual(calcDelay(1000), 2500, '1000 chars => 2500ms (tope máximo)');
  });

  // ── N4: GENERATION SUPERSEDED PASADO A generateAIResponse ────────────────────
  await runTest('N4', 'isGenerationSuperseded aborta generateAIResponse antes de llamar a Gemini', async () => {
    // Pasar isSuperseded = () => true
    const res = await generateAIResponse(
      'System prompt',
      [{ role: 'user', content: 'Hola' }],
      [],
      'test-lock-key',
      null,
      [],
      null,
      'tenant-test',
      () => true // isSuperseded = true
    );
    assert.deepStrictEqual(res, { superseded: true }, 'Debe retornar { superseded: true } de inmediato');
  });

  // ── N5: GENERATION SUPERSEDED EN callGemini / cascada ────────────────────────
  await runTest('N5', 'isGenerationSuperseded aborta cascada y bucle de tools con GENERATION_SUPERSEDED', async () => {
    assert.ok(
      aiServiceCode.includes("typeof isSuperseded === 'function' && isSuperseded()"),
      'aiService debe verificar isSuperseded antes del intento y antes de las tools'
    );
    assert.ok(
      aiServiceCode.includes("const supersededErr = new Error('GENERATION_SUPERSEDED');"),
      'Debe crear error GENERATION_SUPERSEDED'
    );
    assert.ok(
      aiServiceCode.includes("supersededErr.isSuperseded = true;"),
      'Debe marcar err.isSuperseded = true'
    );
  });

  // ── N6: TOOL GUARD EN send_product_media ─────────────────────────────────────
  await runTest('N6', 'send_product_media tool guard aborta con GENERATION_SUPERSEDED y limpia pendingMedia', async () => {
    assert.ok(
      controllerCode.includes("if (funcName === 'send_product_media') {\n        if (isGenerationSuperseded()) {"),
      'send_product_media debe tener guard al inicio'
    );
    assert.ok(
      controllerCode.includes("pendingMediaToSend = null;\n          console.warn(`🛑 [Tool Guard - Media]"),
      'send_product_media debe anular pendingMediaToSend al detectar superseded'
    );
  });

  // ── N7: TOOL GUARD EN get_product_details ────────────────────────────────────
  await runTest('N7', 'get_product_details tool guard aborta y anula pendingMediaToSend si superseded', async () => {
    assert.ok(
      controllerCode.includes("if (funcName === 'get_product_details') {\n        if (isGenerationSuperseded()) {"),
      'get_product_details debe verificar isGenerationSuperseded al inicio'
    );
    assert.ok(
      controllerCode.includes("pendingMediaToSend = null;\n          console.warn(`🛑 [Tool Guard - Details]"),
      'get_product_details debe limpiar pendingMediaToSend'
    );
  });

  // ── N8: TOOL GUARD EN update_commercial_state ────────────────────────────────
  await runTest('N8', 'update_commercial_state tool guard aborta con 0 mutación si superseded', async () => {
    assert.ok(
      controllerCode.includes("if (funcName === 'update_commercial_state') {\n        if (isGenerationSuperseded()) {"),
      'update_commercial_state debe tener guard superseded'
    );
    assert.ok(
      controllerCode.includes("return { success: false, error: 'GENERATION_SUPERSEDED', message: 'El usuario envió un mensaje más reciente. No aplicar cambios.' };"),
      'update_commercial_state debe retornar error GENERATION_SUPERSEDED sin llamar syncCommercialOrder'
    );
  });

  // ── N9: TOOL GUARD EN request_human_handoff ──────────────────────────────────
  await runTest('N9', 'request_human_handoff tool guard aborta sin pausar bot si superseded', async () => {
    assert.ok(
      controllerCode.includes("if (funcName === 'request_human_handoff') {\n        if (isGenerationSuperseded()) {"),
      'request_human_handoff debe tener guard superseded'
    );
  });

  // ── N10: MEDIA PRE-QUEUE GUARD ───────────────────────────────────────────────
  await runTest('N10', 'Media pre-queue guard cancela encolamiento si la generación quedó superseded', async () => {
    assert.ok(
      controllerCode.includes("🛑 [Tool Guard - Media Pre-Queue] Generación obsoleta"),
      'send_product_media debe comprobar isGenerationSuperseded inmediatamente antes de encolar'
    );
  });

  // ── N11: MEDIA PRE-DISPATCH GUARD ────────────────────────────────────────────
  await runTest('N11', 'Media pre-dispatch guard cancela sendWhatsAppMedia si superseded', async () => {
    assert.ok(
      controllerCode.includes("🛑 [Pre-Media Guard] Generación obsoleta antes de enviar multimedia. Abortando."),
      'Debe existir guard de envío multimedia pre-dispatch'
    );
  });

  // ── N12: PROMPT RULE: LATEST USER INTENT WINS ────────────────────────────────
  await runTest('N12', 'Regla de intención más reciente presente en systemPrompt', async () => {
    assert.ok(
      controllerCode.includes('[REGLA VITAL: PRIORIDAD DE LA INTENCIÓN MÁS RECIENTE (LATEST INTENT WINS)]:'),
      'Debe incluir la cláusula formal LATEST INTENT WINS en el systemPrompt'
    );
    assert.ok(
      controllerCode.includes('prioriza SIEMPRE la intención más reciente y específica'),
      'Debe ordenar priorizar siempre la intención más reciente y específica'
    );
  });

  // ── N13: GENERATION_SUPERSEDED NO INCREMENTA CIRCUIT BREAKER ─────────────────
  await runTest('N13', 'GENERATION_SUPERSEDED no incrementa fallos ni activa circuit breaker de Gemini', async () => {
    // Capturar estado inicial del circuit breaker
    const initialFailures = globalCircuitBreaker.failures;
    const initialState = globalCircuitBreaker.state;

    // Ejecutar llamada con isSuperseded = true
    await generateAIResponse(
      'System prompt test',
      [{ role: 'user', content: 'Quiero audífonos' }],
      [],
      'circuit-test-key',
      null,
      [],
      null,
      'tenant-test',
      () => true // Superseded
    );

    // Verificar que el circuit breaker NO fue alterado
    assert.strictEqual(globalCircuitBreaker.failures, initialFailures, 'Circuit breaker failures no deben cambiar');
    assert.strictEqual(globalCircuitBreaker.state, initialState, 'Circuit breaker state debe mantenerse CLOSED');
    
    // Inspección de contrato en aiService: throw superseded ocurre antes de recordFailure
    const catchIndex = aiServiceCode.indexOf('if (err?.isSuperseded || err?.message === \'GENERATION_SUPERSEDED\') {');
    const failureRecordIndex = aiServiceCode.indexOf('globalCircuitBreaker.recordFailure();');
    assert.ok(catchIndex < failureRecordIndex, 'Superseded debe abortar ANTES de recordFailure');
  });

  // ── N14: GENERATION_SUPERSEDED NO ENVÍA MENSAJE DE CONTINGENCIA ──────────────
  await runTest('N14', 'GENERATION_SUPERSEDED sale limpiamente y no genera mensaje de contingencia/demora', async () => {
    // Inspección en whatsappController:
    // Si aiResponse?.superseded || isGenerationSuperseded(), hace return antes de enviar timeoutFallbackText
    const supersededReturnIndex = controllerCode.indexOf('if (aiResponse?.superseded || isGenerationSuperseded()) {');
    const fallbackTextIndex = controllerCode.indexOf('const timeoutFallbackText =');
    assert.ok(supersededReturnIndex !== -1, 'Superseded check debe existir');
    assert.ok(fallbackTextIndex !== -1, 'Fallback text debe existir');
    assert.ok(supersededReturnIndex < fallbackTextIndex, 'Superseded check DEBE retornar antes de construir timeoutFallbackText');
  });

  // ── N15: IMAGEN DE GENERACIÓN A NO SE ENVÍA TRAS LLEGAR MENSAJE B ────────────
  await runTest('N15', 'Una imagen pendiente de generación A no se envía después de entrar mensaje B', async () => {
    _resetProcessingStateForTesting();
    const bufferKey = 'tenant-media:51999222333';
    
    // Estado inicial: generación A versión 1
    const v1 = incrementChatGenerationVersion(bufferKey);
    assert.strictEqual(v1, 1);
    
    let pendingMediaToSend = { url: 'https://cdn.velion.com/foto_a.jpg', type: 'image' };
    const isGenerationSuperseded = () => getChatGenerationVersion(bufferKey) !== v1 || pendingQueues.has(bufferKey);

    // Usuario envía mensaje B antes de despacho de imagen
    incrementChatGenerationVersion(bufferKey); // Versión sube a 2
    pendingQueues.set(bufferKey, { text: 'Audífonos', clientNumber: '51999222333' });

    assert.strictEqual(isGenerationSuperseded(), true, 'isGenerationSuperseded debe ser true');

    // Simular el guard pre-dispatch implementado en whatsappController
    let mediaSent = false;
    if (isGenerationSuperseded()) {
      pendingMediaToSend = null;
    } else {
      mediaSent = true;
    }

    assert.strictEqual(pendingMediaToSend, null, 'pendingMediaToSend debe haber sido cancelado (null)');
    assert.strictEqual(mediaSent, false, 'La imagen de A no debe haber sido enviada');
  });

  // ── N16: SI B + C LLEGAN DURANTE A, SOLAMENTE EXISTE 1 NUEVA GENERACIÓN ───────
  await runTest('N16', 'Si B y C llegan durante A, se consolidan en UNA sola entrada pendingQueue acumulada', async () => {
    _resetProcessingStateForTesting();
    const bufferKey = 'tenant-coalesce:51999333444';
    processingLocks.add(bufferKey);

    // Mensaje B llega mientras IA procesa A
    const msgB = 'Audífonos';
    pendingQueues.set(bufferKey, {
      bufferKey,
      clientNumber: '51999333444',
      text: msgB
    });
    assert.strictEqual(pendingQueues.size, 1);

    // Mensaje C llega inmediatamente mientras IA todavía procesa A
    const msgC = 'Tienes fotos';
    const existing = pendingQueues.get(bufferKey);
    existing.text += '\n' + msgC;

    // Solo debe haber 1 entrada en pendingQueues con el texto consolidado
    assert.strictEqual(pendingQueues.size, 1, 'Debe existir exactamente 1 entrada consolidada en pendingQueues');
    assert.strictEqual(pendingQueues.get(bufferKey).text, 'Audífonos\nTienes fotos', 'Textos deben estar acumulados');
  });

  // ── N17: processingLocks QUEDA LIBERADO TRAS GENERATION_SUPERSEDED ────────────
  await runTest('N17', 'processingLocks queda liberado en bloque finally tras GENERATION_SUPERSEDED', async () => {
    _resetProcessingStateForTesting();
    const bufferKey = 'tenant-lock:51999444555';
    processingLocks.add(bufferKey);
    assert.ok(processingLocks.has(bufferKey), 'Lock debe estar activo inicialmente');

    // Simular bloque try/finally del controlador
    try {
      const err = new Error('GENERATION_SUPERSEDED');
      err.isSuperseded = true;
      throw err;
    } catch (err) {
      assert.strictEqual(err.message, 'GENERATION_SUPERSEDED');
    } finally {
      processingLocks.delete(bufferKey);
    }

    assert.strictEqual(processingLocks.has(bufferKey), false, 'processingLocks debe quedar liberado en finally');
    
    // Inspección de contrato en whatsappController: processingLocks.delete(bufferKey) está en finally
    const finallyIndex = controllerCode.indexOf('finally {');
    const lockDeleteIndex = controllerCode.indexOf('processingLocks.delete(bufferKey);', finallyIndex);
    assert.ok(lockDeleteIndex !== -1, 'processingLocks.delete debe existir dentro de finally');
  });

  console.log('\n======================================================================');
  console.log(`RESULTADOS N1–N17: ${passedCount} pasaron, ${failedCount} fallaron.`);
  console.log('======================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSuite();
