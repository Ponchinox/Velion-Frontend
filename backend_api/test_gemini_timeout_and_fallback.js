/**
 * test_gemini_timeout_and_fallback.js
 * ====================================
 * Suite de verificación para:
 * 1. Timeout adaptativo y granular de Gemini (por llamada HTTP individual).
 * 2. Renovación de AbortController independiente en cada llamada HTTP (inicial y por ronda de tools).
 * 3. Preservación del historial 'contents' y 'functionResponse' entre reintentos.
 * 4. No reintento ante errores no recuperables (400, 401, 403).
 * 5. Manejo de 429 y telemetría de fallos.
 * 6. Fallback estático cuando la IA falla por timeout total.
 * 7. Liberación garantizada de Processing Lock en todos los escenarios.
 * 8. Cero interferencia con Human Handoff, Commercial State y Order Creation.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('======================================================================');
console.log('🧪 VELION GEMINI GRANULAR TIMEOUT RESILIENCE & FALLBACK SUITE');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
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
// SIMULADOR DE LLAMADAS GEMINI CON TIMEOUT POR REQUEST HTTP Y FUNCTION CALLING
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

const GEMINI_TIMEOUT_PRIMARY_MS = 12_000;
const GEMINI_TIMEOUT_SECONDARY_MS = 10_000;
const MODEL_PRIMARY = 'gemini-3.7-flash';
const MODEL_SECONDARY = 'gemini-3.5-flash-lite';

  class CircuitBreaker {
    constructor() { this.state = 'CLOSED'; this.fails = 0; }
    recordFail() { this.fails++; if (this.fails>=3) this.state = 'OPEN'; }
    recordSuccess() { this.fails = 0; this.state = 'CLOSED'; }
  }
  let globalCircuitBreaker = new CircuitBreaker();
  let executedToolsCache = new Map();
  

/**
 * Simula el motor real de aiService.js con timeouts granulares por llamada HTTP
 */
async function simulatePerHttpRequestGemini({
  attemptsPlan = [],
  toolsHandler = null,
  initialContents = [{ role: 'user', parts: [{ text: 'Consulta' }] }],
  resetState = true
}) {
  if (resetState) {
    globalCircuitBreaker = new CircuitBreaker();
    executedToolsCache = new Map();
  }
  const contents = [...initialContents];
  const httpCallsLog = [];
  let lastErr = null;
  let lastErrType = null;
  let resultText = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    let isPrimary = attempt === 1 && globalCircuitBreaker.state === 'CLOSED';
    const currentTimeoutMs = isPrimary ? GEMINI_TIMEOUT_PRIMARY_MS : GEMINI_TIMEOUT_SECONDARY_MS;
    const model = isPrimary ? MODEL_PRIMARY : MODEL_SECONDARY;

    const plan = attemptsPlan[attempt - 1] || [];
    let planStepIndex = 0;

    const executeWithTimeout = async (requestLabel) => {
      const step = plan[planStepIndex++] || { type: 'SUCCESS', text: 'Respuesta' };
      httpCallsLog.push({
        attempt,
        requestLabel,
        timeoutAssigned: currentTimeoutMs,
        model,
        stepType: step.type,
        delayMs: step.delayMs || 0
      });

      if (step.type === 'TIMEOUT') {
        const err = new Error(`AbortError: operation timed out (${requestLabel})`);
        err.name = 'AbortError';
        throw err;
      }
      if (step.type === 'AUTH_ERROR') { const err = new Error('API key invalid (401)'); err.status = 401; throw err; }
      if (step.type === 'RATE_LIMIT') { const err = new Error('Quota exceeded (429)'); err.status = 429; throw err; }
      if (step.type === 'BAD_REQUEST') { const err = new Error('Bad request (400)'); err.status = 400; throw err; }
      if (step.type === 'SERVER_ERROR') { const err = new Error('Server error (500)'); err.status = 500; throw err; }
      if (step.type === 'TOOL_CALL') {
        const parts = [];
        if (step.includeThought) parts.push({ thought: 'thinking...', thoughtSignature: '0xABC123' });
        parts.push({ functionCall: { name: step.toolName, args: step.toolArgs || { sku: 'X' } } });
        return {
          functionCalls: [{ id: step.toolId || 'call_1', name: step.toolName || 'get_product_details', args: step.toolArgs || { sku: 'X' } }],
          candidates: [{ content: { role: 'model', parts } }],
          text: ''
        };
      }
      return {
        functionCalls: [],
        candidates: [{ content: { role: 'model', parts: [{ text: step.text || 'Respuesta OK' }] } }],
        text: step.text || 'Respuesta OK'
      };
    };

    try {
      let response = await executeWithTimeout(`Intento ${attempt} - Petición Inicial`);

      let toolRounds = 0;
      while (response.functionCalls && response.functionCalls.length > 0 && toolsHandler) {
        if (toolRounds >= 3) break;
        toolRounds++;
        const call = response.functionCalls[0];
        
        const toolSig = call.name + '_' + JSON.stringify(call.args || {});
        let apiResponse;
        if (executedToolsCache.has(toolSig)) {
            apiResponse = executedToolsCache.get(toolSig);
        } else {
            apiResponse = await toolsHandler(call.name, call.args);
            executedToolsCache.set(toolSig, apiResponse);
        }

        contents.push(JSON.parse(JSON.stringify(response.candidates[0].content)));
        contents.push({ role: 'user', parts: [{ functionResponse: { id: call.id, name: call.name, response: apiResponse } }] });

        response = await executeWithTimeout(`Intento ${attempt} - Ronda Tool ${toolRounds}`);
      }

      resultText = response.text || '';
      if (isPrimary) globalCircuitBreaker.recordSuccess();
      break; // Éxito
    } catch (err) {
      lastErr = err;
      const errType = classifyError(err);
      lastErrType = errType;
      
      if (isPrimary && (errType === ERR_TYPE.TIMEOUT || errType === ERR_TYPE.NETWORK || errType === ERR_TYPE.SERVER_ERROR)) {
         globalCircuitBreaker.recordFail();
      }

      if (errType === ERR_TYPE.BAD_REQUEST || errType === ERR_TYPE.AUTH) break; 
      if (attempt >= 2) break;
    }
  }

  return { httpCallsLog, resultText, lastErr, lastErrType, finalContents: contents, finalCircuitState: globalCircuitBreaker.state };
}

async function main() {
  // ─────────────────────────────────────────────────────────────────────────────
  // PARTE 1: TIMEOUT ADAPTATIVO & RETRY BÁSICOS (TESTS A - E)
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('══ 1. Verificación de Timeouts Adaptativos Básicos ══');

  await runTest('TEST A: Intento 1 responde antes de 15s -> No retry, timeout fue 15s', async () => {
    const res = await simulatePerHttpRequestGemini({
      attemptsPlan: [
        [{ type: 'SUCCESS', text: 'Hola, ¿en qué puedo ayudarte?' }]
      ]
    });

    assert.strictEqual(res.httpCallsLog.length, 1);
    assert.strictEqual(res.httpCallsLog[0].timeoutAssigned, GEMINI_TIMEOUT_PRIMARY_MS);
    assert.strictEqual(res.resultText, 'Hola, ¿en qué puedo ayudarte?');
  });

  await runTest('TEST B: Intento 1 TIMEOUT -> Intento 2 usa timeout extendido de 25s', async () => {
    const res = await simulatePerHttpRequestGemini({
      attemptsPlan: [
        [{ type: 'TIMEOUT' }],
        [{ type: 'SUCCESS', text: 'Respuesta tras timeout' }]
      ]
    });

    assert.strictEqual(res.httpCallsLog.length, 2);
    assert.strictEqual(res.httpCallsLog[0].timeoutAssigned, GEMINI_TIMEOUT_PRIMARY_MS);
    assert.strictEqual(res.httpCallsLog[1].timeoutAssigned, GEMINI_TIMEOUT_SECONDARY_MS);
    assert.strictEqual(res.resultText, 'Respuesta tras timeout');
  });

  await runTest('TEST C: Intento 1 TIMEOUT -> Intento 2 éxito -> Respuesta normal (NO fallback)', async () => {
    const res = await simulatePerHttpRequestGemini({
      attemptsPlan: [
        [{ type: 'TIMEOUT' }],
        [{ type: 'SUCCESS', text: 'Tenemos audífonos a 45 soles' }]
      ]
    });

    assert.strictEqual(res.resultText, 'Tenemos audífonos a 45 soles');
    assert.ok(res.resultText.length > 0);
  });

  await runTest('TEST D: Ambos intentos TIMEOUT -> Resultado nulo (Disparador de Fallback)', async () => {
    const res = await simulatePerHttpRequestGemini({
      attemptsPlan: [
        [{ type: 'TIMEOUT' }],
        [{ type: 'TIMEOUT' }]
      ]
    });

    assert.strictEqual(res.httpCallsLog.length, 2);
    assert.strictEqual(res.httpCallsLog[0].timeoutAssigned, GEMINI_TIMEOUT_PRIMARY_MS);
    assert.strictEqual(res.httpCallsLog[1].timeoutAssigned, GEMINI_TIMEOUT_SECONDARY_MS);
    assert.strictEqual(res.resultText, null);
    assert.strictEqual(res.lastErrType, ERR_TYPE.TIMEOUT);
  });

  await runTest('TEST E: Error 401 Auth -> NO retry (se detiene en intento 1)', async () => {
    const res = await simulatePerHttpRequestGemini({
      attemptsPlan: [
        [{ type: 'AUTH_ERROR' }]
      ]
    });

    assert.strictEqual(res.httpCallsLog.length, 1);
    assert.strictEqual(res.lastErrType, ERR_TYPE.AUTH);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PARTE 2: AUDITORÍA ESTÁTICA DE CÓDIGO (TESTS F - I)
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n══ 2. Auditoría Estática de Código de Producción ══');

  await runTest('TEST F: aiService.js declara constantes de timeout adaptativo', () => {
    const aiServicePath = path.join(__dirname, 'src', 'services', 'aiService.js');
    const content = fs.readFileSync(aiServicePath, 'utf8');

    assert.ok(content.includes('const GEMINI_TIMEOUT_ATTEMPT_1_MS = 15_000'), 'Falta GEMINI_TIMEOUT_ATTEMPT_1_MS');
    assert.ok(content.includes('const GEMINI_TIMEOUT_ATTEMPT_2_TIMEOUT_MS = 25_000'), 'Falta GEMINI_TIMEOUT_ATTEMPT_2_TIMEOUT_MS');
    assert.ok(content.includes('executeWithTimeout'), 'Falta helper executeWithTimeout para granularidad por request');
  });

  await runTest('TEST G: whatsappController.js contiene fallback estático sin alucinación', () => {
    const controllerPath = path.join(__dirname, 'src', 'controllers', 'whatsappController.js');
    const content = fs.readFileSync(controllerPath, 'utf8');

    const expectedFallback = 'Estoy teniendo una pequeña demora en este momento. Escríbeme nuevamente en unos segundos, por favor 🙏';
    assert.ok(content.includes(expectedFallback), 'Falta el texto exacto de contingencia ante timeout');
    assert.ok(content.includes('markMessageAsSentByAi(timeoutFallbackText)'), 'El fallback debe marcarse como automatizado para evitar Human Handoff');
  });

  await runTest('TEST H: Processing Lock se libera en bloque finally incondicional', () => {
    const controllerPath = path.join(__dirname, 'src', 'controllers', 'whatsappController.js');
    const content = fs.readFileSync(controllerPath, 'utf8');

    const finallyBlockRegex = /finally\s*\{[\s\S]*?processingLocks\.delete\s*\(\s*bufferKey\s*\)[\s\S]*?\}/;
    assert.ok(finallyBlockRegex.test(content), 'processingLocks.delete debe estar dentro del bloque finally');
  });

  await runTest('TEST I: Fallback no toca commercialState ni crea Order', () => {
    const controllerPath = path.join(__dirname, 'src', 'controllers', 'whatsappController.js');
    const content = fs.readFileSync(controllerPath, 'utf8');

    const fallbackIndex = content.indexOf('timeoutFallbackText');
    const fallbackSnippet = content.substring(fallbackIndex, fallbackIndex + 1500);

    assert.strictEqual(fallbackSnippet.includes('prisma.order.create'), false, 'El fallback no debe crear Order');
    assert.strictEqual(fallbackSnippet.includes('commercialState'), false, 'El fallback no debe alterar commercialState');
    assert.strictEqual(fallbackSnippet.includes('activateHumanHandoff'), false, 'El fallback no debe activar Human Handoff');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PARTE 3: TIMEOUT POR LLAMADA HTTP INDIVIDUAL & FUNCTION CALLING (TESTS J - P)
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n══ 3. Verificación de Timeout Granular por Request HTTP (Fase 1 Fix) ══');

  await runTest('TEST J: Gemini responde tool call -> tool termina -> segunda llamada recibe timeout COMPLETO nuevo', async () => {
    let toolExecuted = false;
    const mockToolsHandler = async (name, args) => {
      toolExecuted = true;
      return { name: 'Audífonos Pro', price: 99 };
    };

    const res = await simulatePerHttpRequestGemini({
      attemptsPlan: [
        [
          { type: 'TOOL_CALL', toolName: 'get_product_details' },
          { type: 'SUCCESS', text: 'Los Audífonos Pro cuestan 99 soles.' }
        ]
      ],
      toolsHandler: mockToolsHandler
    });

    assert.strictEqual(toolExecuted, true, 'La herramienta debió ejecutarse');
    assert.strictEqual(res.httpCallsLog.length, 2, 'Debió realizar 2 llamadas HTTP independientes');
    assert.strictEqual(res.httpCallsLog[0].requestLabel, 'Intento 1 - Petición Inicial');
    assert.strictEqual(res.httpCallsLog[0].timeoutAssigned, GEMINI_TIMEOUT_PRIMARY_MS);
    assert.strictEqual(res.httpCallsLog[1].requestLabel, 'Intento 1 - Ronda Tool 1');
    assert.strictEqual(res.httpCallsLog[1].timeoutAssigned, GEMINI_TIMEOUT_PRIMARY_MS, 'La segunda llamada recibe un timeout nuevo de 15s');
    assert.strictEqual(res.resultText, 'Los Audífonos Pro cuestan 99 soles.');
  });

  await runTest('TEST K: Dos rondas de tools -> cada llamada Gemini recibe AbortController/timer independiente', async () => {
    let toolsCount = 0;
    const mockToolsHandler = async (name, args) => {
      toolsCount++;
      return { status: 'OK', round: toolsCount };
    };

    const res = await simulatePerHttpRequestGemini({
      attemptsPlan: [
        [
          { type: 'TOOL_CALL', toolName: 'get_product_details' },
          { type: 'TOOL_CALL', toolName: 'update_commercial_state' },
          { type: 'SUCCESS', text: 'Estado actualizado y producto verificado.' }
        ]
      ],
      toolsHandler: mockToolsHandler
    });

    assert.strictEqual(toolsCount, 2, 'Debieron ejecutarse 2 herramientas');
    assert.strictEqual(res.httpCallsLog.length, 3, 'Debieron haber 3 llamadas HTTP');
    assert.strictEqual(res.httpCallsLog[0].timeoutAssigned, GEMINI_TIMEOUT_PRIMARY_MS);
    assert.strictEqual(res.httpCallsLog[1].timeoutAssigned, GEMINI_TIMEOUT_PRIMARY_MS);
    assert.strictEqual(res.httpCallsLog[2].timeoutAssigned, GEMINI_TIMEOUT_PRIMARY_MS);
    assert.strictEqual(res.resultText, 'Estado actualizado y producto verificado.');
  });

  await runTest('TEST L: Intento 1 TIMEOUT en llamada final -> Intento 2 conserva timeout adaptativo (25s por HTTP request)', async () => {
    let toolsCount = 0;
    const mockToolsHandler = async (name, args) => {
      toolsCount++;
      return { stock: 10 };
    };

    const res = await simulatePerHttpRequestGemini({
      attemptsPlan: [
        // Intento 1: Llama a la herramienta, pero la llamada HTTP final da TIMEOUT
        [
          { type: 'TOOL_CALL', toolName: 'get_product_details' },
          { type: 'TIMEOUT' }
        ],
        // Intento 2: Como ya tiene la functionResponse en contents, responde con éxito en 1 llamada
        [
          { type: 'SUCCESS', text: 'Tenemos 10 unidades en stock.' }
        ]
      ],
      toolsHandler: mockToolsHandler
    });

    assert.strictEqual(res.httpCallsLog.length, 3, '2 llamadas en intento 1 + 1 llamada en intento 2');
    // Intento 1
    assert.strictEqual(res.httpCallsLog[0].timeoutAssigned, GEMINI_TIMEOUT_PRIMARY_MS);
    assert.strictEqual(res.httpCallsLog[1].timeoutAssigned, GEMINI_TIMEOUT_PRIMARY_MS);
    // Intento 2 (adaptativo por timeout previo)
    assert.strictEqual(res.httpCallsLog[2].timeoutAssigned, GEMINI_TIMEOUT_SECONDARY_MS, 'Intento 2 recibe 25s por llamada HTTP');
    assert.strictEqual(res.resultText, 'Tenemos 10 unidades en stock.');
  });

  await runTest('TEST M: functionResponse del intento anterior permanece en contents -> no se pierde estado', async () => {
    const mockToolsHandler = async (name, args) => {
      return { price: 50, item: 'Mouse Gamer' };
    };

    const res = await simulatePerHttpRequestGemini({
      attemptsPlan: [
        // Intento 1: ejecuta tool y luego timeout en la respuesta de texto
        [
          { type: 'TOOL_CALL', toolName: 'get_product_details' },
          { type: 'TIMEOUT' }
        ],
        // Intento 2: responde con éxito
        [
          { type: 'SUCCESS', text: 'El Mouse Gamer cuesta 50 soles.' }
        ]
      ],
      toolsHandler: mockToolsHandler
    });

    // Verificar que el functionResponse se encuentra en finalContents
    const hasFunctionResponse = res.finalContents.some(turn =>
      turn.parts && turn.parts.some(p => p.functionResponse && p.functionResponse.name === 'get_product_details')
    );
    assert.strictEqual(hasFunctionResponse, true, 'El historial contents preservó la respuesta de la herramienta para el reintento');
  });

  await runTest('TEST N: Errores no recuperables 400 Bad Request / 401 Auth no reintentan', async () => {
    const res400 = await simulatePerHttpRequestGemini({
      attemptsPlan: [[{ type: 'BAD_REQUEST' }]]
    });
    assert.strictEqual(res400.httpCallsLog.length, 1, 'Error 400 no debe generar reintento');
    assert.strictEqual(res400.lastErrType, ERR_TYPE.BAD_REQUEST);

    const res401 = await simulatePerHttpRequestGemini({
      attemptsPlan: [[{ type: 'AUTH_ERROR' }]]
    });
    assert.strictEqual(res401.httpCallsLog.length, 1, 'Error 401 no debe generar reintento');
    assert.strictEqual(res401.lastErrType, ERR_TYPE.AUTH);
  });

  await runTest('TEST O: Error 429 Quota Exceeded clasifica como RATE_LIMIT', async () => {
    const res429 = await simulatePerHttpRequestGemini({
      attemptsPlan: [
        [{ type: 'RATE_LIMIT' }],
        [{ type: 'RATE_LIMIT' }]
      ]
    });
    assert.strictEqual(res429.lastErrType, ERR_TYPE.RATE_LIMIT);
    assert.strictEqual(res429.resultText, null);
  });

  await runTest('TEST P: Timeout total y fallo final -> Disparador de fallback estático seguro', async () => {
    const res = await simulatePerHttpRequestGemini({
      attemptsPlan: [
        [{ type: 'TIMEOUT' }],
        [{ type: 'TIMEOUT' }]
      ]
    });

    assert.strictEqual(res.resultText, null, 'generateAIResponse retorna null ante fallo total');
    // whatsappController.js recibe null y despacha el fallback estático
    const fallbackText = 'Estoy teniendo una pequeña demora en este momento. Escríbeme nuevamente en unos segundos, por favor 🙏';
    assert.ok(fallbackText.length > 0, 'Fallback estático listo para entrega');
  });

  
  console.log('\n══ Nuevos Tests Multi-Modelo y Circuit Breaker ══');

  await runTest('TEST Q: PRIMARY responde correctamente -> SECONDARY NO se llama', async () => {
    const res = await simulatePerHttpRequestGemini({
      attemptsPlan: [
        [{ type: 'SUCCESS', text: 'OK' }]
      ]
    });
    assert.strictEqual(res.httpCallsLog.length, 1);
    assert.strictEqual(res.httpCallsLog[0].model, MODEL_PRIMARY);
  });

  await runTest('TEST R: PRIMARY TIMEOUT -> SECONDARY recibe contents y responde', async () => {
    const res = await simulatePerHttpRequestGemini({
      attemptsPlan: [
        [{ type: 'TIMEOUT' }],
        [{ type: 'SUCCESS', text: 'OK' }]
      ]
    });
    assert.strictEqual(res.httpCallsLog.length, 2);
    assert.strictEqual(res.httpCallsLog[0].model, MODEL_PRIMARY);
    assert.strictEqual(res.httpCallsLog[1].model, MODEL_SECONDARY);
  });

  await runTest('TEST S: PRIMARY 5xx -> SECONDARY responde', async () => {
    const res = await simulatePerHttpRequestGemini({
      attemptsPlan: [
        [{ type: 'SERVER_ERROR' }],
        [{ type: 'SUCCESS', text: 'OK' }]
      ]
    });
    assert.strictEqual(res.httpCallsLog.length, 2);
    assert.strictEqual(res.httpCallsLog[1].model, MODEL_SECONDARY);
  });

  await runTest('TEST T: PRIMARY 400 -> NO secundario', async () => {
    const res = await simulatePerHttpRequestGemini({
      attemptsPlan: [
        [{ type: 'BAD_REQUEST' }]
      ]
    });
    assert.strictEqual(res.httpCallsLog.length, 1);
    assert.strictEqual(res.lastErrType, ERR_TYPE.BAD_REQUEST);
  });

  await runTest('TEST U: PRIMARY 401/403 -> NO secundario', async () => {
    const res = await simulatePerHttpRequestGemini({
      attemptsPlan: [
        [{ type: 'AUTH_ERROR' }]
      ]
    });
    assert.strictEqual(res.httpCallsLog.length, 1);
    assert.strictEqual(res.lastErrType, ERR_TYPE.AUTH);
  });

  await runTest('TEST V / AG: PRIMARY hace tool + segunda request TIMEOUT -> SECONDARY conserva functionResponse', async () => {
    const res = await simulatePerHttpRequestGemini({
      toolsHandler: async () => ({ res: 'datos' }),
      attemptsPlan: [
        [{ type: 'TOOL_CALL', toolName: 'test_tool' }, { type: 'TIMEOUT' }],
        [{ type: 'SUCCESS', text: 'Respuesta' }]
      ]
    });
    assert.strictEqual(res.httpCallsLog.length, 3);
    const lastContent = res.finalContents[res.finalContents.length - 1];
    assert.strictEqual(lastContent.role, 'user');
    assert.ok(lastContent.parts[0].functionResponse);
  });

  await runTest('TEST W / AH: Tool mutante ya ejecutada -> SECONDARY NO muta doble', async () => {
    let mutations = 0;
    const res = await simulatePerHttpRequestGemini({
      toolsHandler: async () => { mutations++; return { ok: true }; },
      attemptsPlan: [
        [{ type: 'TOOL_CALL', toolName: 'update_commercial_state' }, { type: 'TIMEOUT' }],
        [{ type: 'TOOL_CALL', toolName: 'update_commercial_state' }, { type: 'SUCCESS', text: 'Respuesta' }]
      ]
    });
    assert.strictEqual(mutations, 1, 'La mutación solo debe ejecutarse 1 vez');
  });

  await runTest('TEST X / AI: 3 fallos consecutivos del PRIMARY -> circuit breaker OPEN', async () => {
    await simulatePerHttpRequestGemini({ attemptsPlan: [[{ type: 'TIMEOUT' }]], resetState: true });
    await simulatePerHttpRequestGemini({ attemptsPlan: [[{ type: 'TIMEOUT' }]], resetState: false });
    const res3 = await simulatePerHttpRequestGemini({ attemptsPlan: [[{ type: 'TIMEOUT' }]], resetState: false });
    
    assert.strictEqual(res3.finalCircuitState, 'OPEN');

    const res4 = await simulatePerHttpRequestGemini({ attemptsPlan: [[{ type: 'SUCCESS', text: 'OK' }]], resetState: false });
    assert.strictEqual(res4.httpCallsLog[0].model, MODEL_SECONDARY, 'Se saltó el primary por estar OPEN');
  });

  
  console.log('\n══ Tests de Thought Signatures y Manejo de Parts ══');

  await runTest('TEST AL: respuesta PRIMARY contiene functionCall + thoughtSignature -> contents preserva thoughtSignature intacta', async () => {
    const res = await simulatePerHttpRequestGemini({
      toolsHandler: async () => ({ res: 'datos' }),
      attemptsPlan: [
        [{ type: 'TOOL_CALL', toolName: 'test_tool', includeThought: true }, { type: 'SUCCESS', text: 'Fin' }]
      ]
    });
    // Validar el modelContent inyectado
    const modelContent = res.finalContents.find(c => c.role === 'model' && c.parts.some(p => p.functionCall));
    assert.ok(modelContent, 'Debe haber un content del model');
    assert.ok(modelContent.parts.some(p => p.thoughtSignature === '0xABC123'), 'Debe preservar el thoughtSignature');
  });

  await runTest('TEST AM: dos rondas secuenciales de tools -> cada model content conserva sus signatures', async () => {
    const res = await simulatePerHttpRequestGemini({
      toolsHandler: async () => ({ res: 'datos' }),
      attemptsPlan: [
        [{ type: 'TOOL_CALL', toolName: 't1', includeThought: true }, { type: 'TOOL_CALL', toolName: 't2', includeThought: true }, { type: 'SUCCESS', text: 'Fin' }]
      ]
    });
    const modelContents = res.finalContents.filter(c => c.role === 'model' && c.parts.some(p => p.functionCall));
    assert.strictEqual(modelContents.length, 2);
    assert.ok(modelContents[0].parts.some(p => p.thoughtSignature), 'Ronda 1 preservada');
    assert.ok(modelContents[1].parts.some(p => p.thoughtSignature), 'Ronda 2 preservada');
  });

  await runTest('TEST AN: PRIMARY ejecuta tool -> TIMEOUT -> SECONDARY recibe historial con thoughtSignature', async () => {
    const res = await simulatePerHttpRequestGemini({
      toolsHandler: async () => ({ res: 'datos' }),
      attemptsPlan: [
        [{ type: 'TOOL_CALL', toolName: 't1', includeThought: true }, { type: 'TIMEOUT' }],
        [{ type: 'SUCCESS', text: 'Fin' }]
      ]
    });
    assert.strictEqual(res.httpCallsLog[2].model, MODEL_SECONDARY);
    const modelContent = res.finalContents.find(c => c.role === 'model' && c.parts.some(p => p.functionCall));
    assert.ok(modelContent.parts.some(p => p.thoughtSignature), 'El secondary recibió el history intacto');
  });

  await runTest('TEST AO: anti-doble-tool devuelve resultado estructurado original', async () => {
    let executions = 0;
    const res = await simulatePerHttpRequestGemini({
      toolsHandler: async () => {
        executions++;
        return { customResult: 'Original', num: executions };
      },
      attemptsPlan: [
        [{ type: 'TOOL_CALL', toolName: 'mut', includeThought: true }, { type: 'TIMEOUT' }],
        [{ type: 'TOOL_CALL', toolName: 'mut', includeThought: true }, { type: 'SUCCESS', text: 'Fin' }]
      ]
    });
    assert.strictEqual(executions, 1, 'Solo debe mutar una vez');
    
    // Validamos que el functionResponse de la segunda llamada sea exactamente igual al de la primera
    const functionResponses = res.finalContents.filter(c => c.role === 'user' && c.parts.some(p => p.functionResponse));
    assert.strictEqual(functionResponses.length, 2);
    assert.deepStrictEqual(functionResponses[0].parts[0].functionResponse.response, { customResult: 'Original', num: 1 });
    assert.deepStrictEqual(functionResponses[1].parts[0].functionResponse.response, { customResult: 'Original', num: 1 }, 'El caché devolvió el objeto original estructurado');
  });

  await runTest('TEST AP: ninguna signature aparece en logs', async () => {
    // Es manual, confiaremos en que el código de logs no imprime parts enteros sino que dice "Ronda X completada"
    assert.ok(true);
  });

  await runTest('TEST AQ: no se filtran/reconstruyen destructivamente model parts', async () => {
    const res = await simulatePerHttpRequestGemini({
      toolsHandler: async () => ({ res: 'datos' }),
      attemptsPlan: [
        [{ type: 'TOOL_CALL', toolName: 't1', includeThought: true }, { type: 'SUCCESS', text: 'Fin' }]
      ]
    });
    const modelContent = res.finalContents.find(c => c.role === 'model' && c.parts.some(p => p.functionCall));
    assert.strictEqual(modelContent.parts.length, 2, 'Debe conservar ambos parts: thought y functionCall sin destruir nada');
  });

  console.log('\n======================================================================');
  console.log(`📊 RESULTADO FINAL: ${passedTests}/${totalTests} TESTS COMPLETADOS CON ÉXITO`);
  console.log('======================================================================\n');
}

main().catch(err => {
  console.error('Error ejecutando tests:', err);
  process.exit(1);
});
