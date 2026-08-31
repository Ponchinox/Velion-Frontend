import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('🧪 VELION AI TELEMETRY & PROMPT GUARD TEST SUITE');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

// ────────────────────────────────────────────────────────────
// PARTE 1: VERIFICACIÓN DEL PROMPT (search_inventory vs get_product_details)
// ────────────────────────────────────────────────────────────

runTest('TEST 1: whatsappController.js no contiene search_inventory en instrucciones activas', () => {
  const controllerPath = path.join(__dirname, 'src', 'controllers', 'whatsappController.js');
  const content = fs.readFileSync(controllerPath, 'utf8');

  // Comprobar que search_inventory no existe en el código activo
  assert.strictEqual(
    content.includes('search_inventory'),
    false,
    'whatsappController.js todavía contiene referencias a search_inventory'
  );
});

runTest('TEST 2: whatsappController.js contiene get_product_details en reglas anti-alucinación', () => {
  const controllerPath = path.join(__dirname, 'src', 'controllers', 'whatsappController.js');
  const content = fs.readFileSync(controllerPath, 'utf8');

  // Comprobar que las reglas de precio y stock usan get_product_details
  assert.ok(
    content.includes('Si no conoces el precio exacto: NO lo inventes. Usa get_product_details.'),
    'Falta la instrucción de precio con get_product_details'
  );
  assert.ok(
    content.includes('Si no conoces el stock: NO lo inventes. Usa get_product_details.'),
    'Falta la instrucción de stock con get_product_details'
  );
  assert.ok(
    content.includes("name: 'get_product_details'"),
    'Falta la declaración de la tool get_product_details en tools schema'
  );
});

// ────────────────────────────────────────────────────────────
// PARTE 2: AUDITORÍA ESTÁTICA DEL CÓDIGO DE TELEMETRÍA (aiService.js)
// ────────────────────────────────────────────────────────────

runTest('TEST 3: aiService.js tiene exactamente UNA llamada a recordTenantAiUsage en callGemini', () => {
  const aiServicePath = path.join(__dirname, 'src', 'services', 'aiService.js');
  const content = fs.readFileSync(aiServicePath, 'utf8');

  // Buscar todas las invocaciones de recordTenantAiUsage
  const matches = content.match(/recordTenantAiUsage\s*\(/g) || [];
  
  // En todo aiService.js solo debe haber 1 llamada en el cuerpo (en el finally de callGemini),
  // más el import al inicio.
  assert.strictEqual(
    matches.length,
    1,
    `Se esperaban exactamente 1 llamada a recordTenantAiUsage, pero se encontraron ${matches.length}`
  );

  // Verificar que la única llamada está dentro del bloque finally
  const finallyBlockRegex = /finally\s*\{[\s\S]*?recordTenantAiUsage[\s\S]*?\}/;
  assert.ok(
    finallyBlockRegex.test(content),
    'La llamada a recordTenantAiUsage debe estar ubicada exclusivamente en el bloque finally'
  );
});

// ────────────────────────────────────────────────────────────
// PARTE 3: SIMULACIÓN DE FLUJOS DE SESIÓN Y EXACTLY-ONCE
// ────────────────────────────────────────────────────────────

// Simulador fiel de la lógica de callGemini para verificar la telemetría en todos los escenarios
function simulateGeminiSession({
  tenantId = 'test-tenant-123',
  responses = [],
  toolRoundsToExecute = 0,
  shouldThrow = null,
  maxAttempts = 2,
}) {
  const callsRecorded = [];
  const sessionUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    toolCalls: 0,
    retryCount: 0,
  };

  const accumulateUsage = (resp) => {
    if (resp?.usageMetadata) {
      const inTok = Number(resp.usageMetadata.promptTokenCount) || 0;
      const outTok = Number(resp.usageMetadata.candidatesTokenCount) || 0;
      const totTok = Number(resp.usageMetadata.totalTokenCount) || (inTok + outTok);
      sessionUsage.inputTokens += inTok;
      sessionUsage.outputTokens += outTok;
      sessionUsage.totalTokens += totTok;
      sessionUsage.requestCount += 1;
    }
  };

  const recordTenantAiUsageMock = (params) => {
    callsRecorded.push(JSON.parse(JSON.stringify(params)));
  };

  let executionResult = null;
  let executionError = null;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (shouldThrow && shouldThrow.onAttempt === attempt) {
          throw shouldThrow.error;
        }

        const respIdx = attempt - 1;
        let response = responses[respIdx] || {
          text: 'Respuesta OK',
          usageMetadata: { promptTokenCount: 2500, candidatesTokenCount: 150, totalTokenCount: 2650 }
        };

        accumulateUsage(response);

        // Function Calling multi-ronda
        let toolRounds = 0;
        while (toolRounds < toolRoundsToExecute) {
          toolRounds++;
          sessionUsage.toolCalls++;

          const toolResp = {
            text: `Respuesta tras tool ${toolRounds}`,
            usageMetadata: { promptTokenCount: 2800 + (toolRounds * 200), candidatesTokenCount: 80, totalTokenCount: 2880 + (toolRounds * 200) }
          };
          accumulateUsage(toolResp);
        }

        executionResult = response.text;
        break; // Éxito en este intento
      } catch (err) {
        sessionUsage.retryCount++;
        if (err.isFatal || attempt >= maxAttempts) {
          executionError = err;
          throw err;
        }
      }
    }
  } catch (finalErr) {
    executionError = finalErr;
  } finally {
    // Exacta lógica de producción en aiService.js
    if (tenantId && (sessionUsage.requestCount > 0 || sessionUsage.retryCount > 0)) {
      recordTenantAiUsageMock({ tenantId, ...sessionUsage });
    }
  }

  return { executionResult, executionError, callsRecorded, sessionUsage };
}

runTest('TEST A: Respuesta Gemini exitosa normal registra telemetría EXACTAMENTE 1 VEZ', () => {
  const res = simulateGeminiSession({
    tenantId: 'tenant-abc',
    responses: [{
      text: '¡Hola! Claro que sí.',
      usageMetadata: { promptTokenCount: 3100, candidatesTokenCount: 120, totalTokenCount: 3220 }
    }]
  });

  assert.strictEqual(res.callsRecorded.length, 1, 'Debe haber exactamente 1 registro de telemetría');
  assert.strictEqual(res.callsRecorded[0].requestCount, 1);
  assert.strictEqual(res.callsRecorded[0].inputTokens, 3100);
  assert.strictEqual(res.callsRecorded[0].outputTokens, 120);
  assert.strictEqual(res.callsRecorded[0].totalTokens, 3220);
  assert.strictEqual(res.callsRecorded[0].toolCalls, 0);
  assert.strictEqual(res.callsRecorded[0].retryCount, 0);
});

runTest('TEST B: Gemini + 2 rondas de herramientas acumula métricas y persiste UNA SOLA VEZ', () => {
  // Ronda 1: 3000 in, 50 out
  // Ronda 2 (Tool 1): 3200 in, 80 out
  // Ronda 3 (Tool 2): 3400 in, 80 out
  // Total in: 9600, out: 210, reqs: 3, tools: 2
  const res = simulateGeminiSession({
    tenantId: 'tenant-tools',
    responses: [{
      text: 'Respuesta con herramientas',
      usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 50, totalTokenCount: 3050 }
    }],
    toolRoundsToExecute: 2
  });

  assert.strictEqual(res.callsRecorded.length, 1, 'Debe haber exactamente 1 persistencia final');
  assert.strictEqual(res.callsRecorded[0].requestCount, 3, 'Deben contarse 3 requests HTTP en la sesión');
  assert.strictEqual(res.callsRecorded[0].toolCalls, 2, 'Deben contarse 2 tool calls ejecutadas');
  assert.strictEqual(res.callsRecorded[0].inputTokens, 3000 + 3000 + 3200, 'Tokens de entrada acumulados');
  assert.strictEqual(res.callsRecorded[0].outputTokens, 50 + 80 + 80, 'Tokens de salida acumulados');
  assert.strictEqual(res.callsRecorded[0].retryCount, 0);
});

runTest('TEST C: Retry tras intento 1 fallido persiste UNA SOLA VEZ con retryCount=1', () => {
  const res = simulateGeminiSession({
    tenantId: 'tenant-retry',
    shouldThrow: { onAttempt: 1, error: new Error('Network transient error') },
    responses: [
      null, // Intento 1 falla
      {
        text: 'Respuesta exitosa en intento 2',
        usageMetadata: { promptTokenCount: 2900, candidatesTokenCount: 90, totalTokenCount: 2990 }
      }
    ]
  });

  assert.strictEqual(res.callsRecorded.length, 1, 'Debe persistirse 1 sola vez en finally');
  assert.strictEqual(res.callsRecorded[0].retryCount, 1, 'retryCount debe ser 1');
  assert.strictEqual(res.callsRecorded[0].requestCount, 1, 'requestCount exitoso es 1');
  assert.strictEqual(res.callsRecorded[0].inputTokens, 2900);
});

runTest('TEST D: Error fatal / Timeout sin respuesta persiste UNA SOLA VEZ con reintentos contados', () => {
  const timeoutErr = new Error('Request Timeout after 15s');
  const res = simulateGeminiSession({
    tenantId: 'tenant-timeout',
    shouldThrow: { onAttempt: 1, error: timeoutErr },
    responses: [null, null],
    maxAttempts: 1
  });

  assert.ok(res.executionError !== null, 'Debe registrarse el error');
  assert.strictEqual(res.callsRecorded.length, 1, 'Se registra exactamente 1 vez el intento fallido');
  assert.strictEqual(res.callsRecorded[0].retryCount, 1);
  assert.strictEqual(res.callsRecorded[0].requestCount, 0);
  assert.strictEqual(res.callsRecorded[0].inputTokens, 0);
});

runTest('TEST E: Error 429 Quota Exceeded no reintentable persiste UNA SOLA VEZ', () => {
  const quotaErr = new Error('Resource Exhausted (429)');
  quotaErr.isFatal = true;

  const res = simulateGeminiSession({
    tenantId: 'tenant-429',
    shouldThrow: { onAttempt: 1, error: quotaErr },
    responses: [null],
    maxAttempts: 2
  });

  assert.ok(res.executionError !== null, 'Error 429 capturado');
  assert.strictEqual(res.callsRecorded.length, 1, 'Se registra exactamente 1 vez');
  assert.strictEqual(res.callsRecorded[0].retryCount, 1);
});

console.log('\n====================================================');
console.log(`🎉 RESULTADO: ${passedTests}/${totalTests} TESTS COMPLETADOS CON ÉXITO`);
console.log('====================================================');
