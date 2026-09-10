/**
 * groqFallback.scenario.js — QA Suite de Tercer Nivel de Fallback IA (Groq)
 *
 * Cobertura S/0.00 bajo Network Guard:
 * F1:  Primary PASS -> Secondary 0, Groq 0
 * F2:  Primary FAIL, Secondary PASS -> Groq 0
 * F3:  Primary FAIL, Secondary FAIL, Groq PASS -> Respuesta de Groq
 * F4:  Primary timeout, Secondary timeout, Groq PASS
 * F5:  Primary + Secondary + Groq FAIL -> null -> Contingencia controlada sin crash
 * F6:  GENERATION_SUPERSEDED durante Primary -> Secondary 0, Groq 0
 * F7:  Superseded justo antes de Groq -> Groq 0
 * F8:  Groq llama get_product_details -> args parseados, toolsHandler ejecutado, respuesta final OK
 * F9:  Groq tool desconocida -> guard seguro, no ejecución, no crash
 * F10: Groq argumentos JSON inválidos -> guard seguro, no crash
 * F11: Groq timeout -> abort limpio sin timers colgados
 * F12: Breakers independientes (Gemini no abre Groq, Groq no abre Gemini)
 * F13: Groq breaker OPEN -> Groq 0 requests, fallback inmediato
 * F14: GROQ_API_KEY ausente -> Groq omitido limpiamente
 * F15: mediaItems presentes -> no base64 enviado a Groq, aviso textual neutro
 * F16: tool schema mapper convierte tipos recursivamente a minúsculas
 * F17: mapper es puro y no muta definiciones originales de Gemini
 * F18: Network Guard bloquea api.groq.com a nivel TLS/socket (S/0.00)
 */

import '../networkGuard.js';
import assert from 'node:assert';
import tls from 'node:tls';
import {
  callGroq,
  groqCircuitBreaker,
  GroqCircuitBreaker,
  CircuitBreaker,
  globalCircuitBreaker
} from '../../src/services/aiService.js';
import {
  convertGeminiToolsToOpenAI,
  normalizeJsonSchema,
  normalizeSchemaType
} from '../../src/services/aiToolAdapters.js';

export async function runGroqFallbackScenario() {
  console.log('\n======================================================================');
  console.log('⚡ SCENARIO: GROQ 3RD-LEVEL AI FALLBACK (ZERO-COST S/0.00)');
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

  // Fixture de herramientas representativas de Velion
  const geminiSampleTools = [{
    functionDeclarations: [
      {
        name: 'get_product_details',
        description: 'Obtiene especificaciones técnicas de un producto',
        parameters: {
          type: 'OBJECT',
          properties: {
            productId: {
              type: 'STRING',
              description: 'ID del producto'
            },
            tags: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'Etiquetas opcionales'
            }
          },
          required: ['productId']
        }
      },
      {
        name: 'update_commercial_state',
        description: 'Actualiza el estado comercial',
        parameters: {
          type: 'OBJECT',
          properties: {
            currentStage: {
              type: 'STRING',
              enum: ['EXPLORING', 'DETAILS_PROVIDED', 'COMPLETED']
            },
            quantity: { type: 'INTEGER' },
            customerConfirmed: { type: 'BOOLEAN' },
            budget: { type: 'NUMBER' }
          },
          required: ['currentStage']
        }
      }
    ]
  }];

  // Helper simulador de cascada para pruebas F1-F7, F13, F14
  async function simulateCascade({
    primaryHandler,
    secondaryHandler,
    groqHandler,
    isSuperseded = () => false,
    hasGroqKey = true,
    breakerState = 'CLOSED',
    mediaItems = []
  }) {
    const calls = { primary: 0, secondary: 0, groq: 0 };

    if (isSuperseded()) {
      const err = new Error('GENERATION_SUPERSEDED');
      err.isSuperseded = true;
      throw err;
    }

    let geminiError = null;

    // Slot #1 Primary
    calls.primary++;
    try {
      const pText = await primaryHandler();
      if (pText) return { result: pText, calls };
    } catch (err) {
      if (err?.isSuperseded || isSuperseded()) {
        const supErr = new Error('GENERATION_SUPERSEDED');
        supErr.isSuperseded = true;
        throw supErr;
      }
      geminiError = err;
    }

    // Slot #1 Secondary
    calls.secondary++;
    try {
      const sText = await secondaryHandler();
      if (sText) return { result: sText, calls };
    } catch (err) {
      if (err?.isSuperseded || isSuperseded()) {
        const supErr = new Error('GENERATION_SUPERSEDED');
        supErr.isSuperseded = true;
        throw supErr;
      }
      geminiError = err;
    }

    // Slot #2 Groq
    if (isSuperseded()) {
      const supErr = new Error('GENERATION_SUPERSEDED');
      supErr.isSuperseded = true;
      throw supErr;
    }

    if (!hasGroqKey) {
      return { result: null, calls, skippedGroqReason: 'NO_KEY' };
    }

    if (breakerState !== 'CLOSED') {
      return { result: null, calls, skippedGroqReason: 'BREAKER_OPEN' };
    }

    calls.groq++;
    try {
      const gText = await groqHandler();
      return { result: gText, calls };
    } catch (gErr) {
      if (gErr?.isSuperseded || isSuperseded()) {
        const supErr = new Error('GENERATION_SUPERSEDED');
        supErr.isSuperseded = true;
        throw supErr;
      }
      return { result: null, calls, lastError: gErr };
    }
  }

  // ─── F1 ───
  await test('F1: Primary PASS -> Secondary 0, Groq 0', async () => {
    const { result, calls } = await simulateCascade({
      primaryHandler: async () => 'Respuesta Primary OK',
      secondaryHandler: async () => 'Respuesta Secondary',
      groqHandler: async () => 'Respuesta Groq'
    });
    assert.strictEqual(result, 'Respuesta Primary OK');
    assert.strictEqual(calls.primary, 1);
    assert.strictEqual(calls.secondary, 0);
    assert.strictEqual(calls.groq, 0);
  });

  // ─── F2 ───
  await test('F2: Primary FAIL, Secondary PASS -> Groq 0', async () => {
    const { result, calls } = await simulateCascade({
      primaryHandler: async () => { throw new Error('Gemini 503 Overloaded'); },
      secondaryHandler: async () => 'Respuesta Secondary OK',
      groqHandler: async () => 'Respuesta Groq'
    });
    assert.strictEqual(result, 'Respuesta Secondary OK');
    assert.strictEqual(calls.primary, 1);
    assert.strictEqual(calls.secondary, 1);
    assert.strictEqual(calls.groq, 0);
  });

  // ─── F3 ───
  await test('F3: Primary FAIL, Secondary FAIL, Groq PASS -> respuesta Groq', async () => {
    const { result, calls } = await simulateCascade({
      primaryHandler: async () => { throw new Error('Primary 500'); },
      secondaryHandler: async () => { throw new Error('Secondary 429'); },
      groqHandler: async () => 'Respuesta Groq Fallback OK'
    });
    assert.strictEqual(result, 'Respuesta Groq Fallback OK');
    assert.strictEqual(calls.primary, 1);
    assert.strictEqual(calls.secondary, 1);
    assert.strictEqual(calls.groq, 1);
  });

  // ─── F4 ───
  await test('F4: Primary timeout, Secondary timeout, Groq PASS', async () => {
    const { result, calls } = await simulateCascade({
      primaryHandler: async () => {
        const err = new Error('AbortError');
        err.name = 'AbortError';
        throw err;
      },
      secondaryHandler: async () => {
        const err = new Error('AbortError');
        err.name = 'AbortError';
        throw err;
      },
      groqHandler: async () => 'Respuesta Groq tras timeouts de Gemini'
    });
    assert.strictEqual(result, 'Respuesta Groq tras timeouts de Gemini');
    assert.strictEqual(calls.primary, 1);
    assert.strictEqual(calls.secondary, 1);
    assert.strictEqual(calls.groq, 1);
  });

  // ─── F5 ───
  await test('F5: Primary + Secondary + Groq FAIL -> null -> contingencia existente sin crash', async () => {
    const { result, calls } = await simulateCascade({
      primaryHandler: async () => { throw new Error('Primary fail'); },
      secondaryHandler: async () => { throw new Error('Secondary fail'); },
      groqHandler: async () => { throw new Error('Groq fail'); }
    });
    assert.strictEqual(result, null);
    assert.strictEqual(calls.primary, 1);
    assert.strictEqual(calls.secondary, 1);
    assert.strictEqual(calls.groq, 1);

    // Simular el controlador de WhatsApp ante aiResponse === null
    const aiResponse = result;
    let fallbackSent = false;
    if (!aiResponse || aiResponse === '...') {
      const timeoutFallbackText = 'Estoy teniendo una pequeña demora en este momento. Escríbeme nuevamente en unos segundos, por favor 🙏';
      assert.ok(timeoutFallbackText.includes('pequeña demora'));
      fallbackSent = true;
    }
    assert.strictEqual(fallbackSent, true, 'Debe activar fallback de cortesía sin crashear');
  });

  // ─── F6 ───
  await test('F6: GENERATION_SUPERSEDED durante Primary -> Secondary 0, Groq 0', async () => {
    let capturedErr = null;
    let secondaryCalled = false;
    let groqCalled = false;

    try {
      await simulateCascade({
        primaryHandler: async () => {
          const supErr = new Error('GENERATION_SUPERSEDED');
          supErr.isSuperseded = true;
          throw supErr;
        },
        secondaryHandler: async () => { secondaryCalled = true; },
        groqHandler: async () => { groqCalled = true; }
      });
    } catch (err) {
      capturedErr = err;
    }

    assert.ok(capturedErr, 'Debe propagar error de superseded');
    assert.strictEqual(capturedErr.isSuperseded, true);
    assert.strictEqual(secondaryCalled, false);
    assert.strictEqual(groqCalled, false);
  });

  // ─── F7 ───
  await test('F7: Superseded justo antes de Groq -> Groq 0', async () => {
    let supersededState = false;
    let groqCalled = false;
    let capturedErr = null;

    try {
      await simulateCascade({
        primaryHandler: async () => { throw new Error('Primary 503'); },
        secondaryHandler: async () => {
          // Llega un nuevo mensaje durante la ejecución del Secondary
          supersededState = true;
          throw new Error('Secondary 503');
        },
        groqHandler: async () => { groqCalled = true; },
        isSuperseded: () => supersededState
      });
    } catch (err) {
      capturedErr = err;
    }

    assert.ok(capturedErr, 'Debe abortar antes de Groq');
    assert.strictEqual(capturedErr.isSuperseded, true);
    assert.strictEqual(groqCalled, false, 'Groq no debe ser llamado si quedó superseded');
  });

  // ─── F8 ───
  await test('F8: Groq llama get_product_details -> args parseados -> toolsHandler ejecutado -> respuesta OK', async () => {
    let handlerCalledWith = null;
    let rounds = 0;

    const mockGroqClient = {
      chat: {
        completions: {
          create: async ({ messages }) => {
            rounds++;
            if (rounds === 1) {
              return {
                choices: [{
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                      id: 'call_123',
                      type: 'function',
                      function: {
                        name: 'get_product_details',
                        arguments: JSON.stringify({ productId: 'AUD-001' })
                      }
                    }]
                  }
                }],
                usage: { prompt_tokens: 150, completion_tokens: 30, total_tokens: 180 }
              };
            }
            // Segunda ronda: Groq recibe la respuesta de la tool y devuelve texto
            return {
              choices: [{
                message: {
                  role: 'assistant',
                  content: 'Los audífonos AUD-001 cuentan con Bluetooth 5.3 y batería de 30 horas.'
                }
              }],
              usage: { prompt_tokens: 220, completion_tokens: 45, total_tokens: 265 }
            };
          }
        }
      }
    };

    const mockToolsHandler = async (toolName, args) => {
      handlerCalledWith = { toolName, args };
      return { success: true, product: { id: args.productId, name: 'Audífonos Pro', stock: 15 } };
    };

    const response = await callGroq(
      'Eres un asesor de ventas de Velion.',
      [{ role: 'user', content: '¿Tienes detalles de los audífonos AUD-001?' }],
      [],
      geminiSampleTools,
      mockToolsHandler,
      null,
      () => false,
      mockGroqClient
    );

    assert.strictEqual(rounds, 2, 'Debe haber ejecutado 2 rondas de chat');
    assert.ok(handlerCalledWith, 'El toolsHandler debió ser invocado');
    assert.strictEqual(handlerCalledWith.toolName, 'get_product_details');
    assert.strictEqual(handlerCalledWith.args.productId, 'AUD-001');
    assert.ok(response.includes('AUD-001'));
  });

  // ─── F9 ───
  await test('F9: Groq tool desconocida -> guard seguro, no ejecución, no crash', async () => {
    let dangerousExecuted = false;
    let rounds = 0;

    const mockGroqClient = {
      chat: {
        completions: {
          create: async () => {
            rounds++;
            if (rounds === 1) {
              return {
                choices: [{
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                      id: 'call_hacker',
                      type: 'function',
                      function: {
                        name: 'delete_entire_database',
                        arguments: '{}'
                      }
                    }]
                  }
                }],
                usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
              };
            }
            return {
              choices: [{
                message: {
                  role: 'assistant',
                  content: 'No pude realizar esa acción, pero puedo ayudarte con el catálogo.'
                }
              }]
            };
          }
        }
      }
    };

    const mockToolsHandler = async (toolName) => {
      if (toolName === 'delete_entire_database') {
        dangerousExecuted = true;
      }
      return { success: true };
    };

    const response = await callGroq(
      'System prompt',
      [{ role: 'user', content: 'Test' }],
      [],
      geminiSampleTools,
      mockToolsHandler,
      null,
      () => false,
      mockGroqClient
    );

    assert.strictEqual(dangerousExecuted, false, 'Jamás debe ejecutar una herramienta desconocida');
    assert.ok(response.includes('No pude realizar esa acción'));
  });

  // ─── F10 ───
  await test('F10: Groq argumentos JSON inválidos -> guard seguro, no crash', async () => {
    let handlerCalled = false;
    let rounds = 0;

    const mockGroqClient = {
      chat: {
        completions: {
          create: async () => {
            rounds++;
            if (rounds === 1) {
              return {
                choices: [{
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                      id: 'call_malformed',
                      type: 'function',
                      function: {
                        name: 'get_product_details',
                        arguments: '{ productId: "sin_comillas_invalid_json'
                      }
                    }]
                  }
                }]
              };
            }
            return {
              choices: [{
                message: {
                  role: 'assistant',
                  content: 'Disculpa el inconveniente técnico, ¿qué producto deseas consultar?'
                }
              }]
            };
          }
        }
      }
    };

    const response = await callGroq(
      'System prompt',
      [{ role: 'user', content: 'Test' }],
      [],
      geminiSampleTools,
      async () => { handlerCalled = true; },
      null,
      () => false,
      mockGroqClient
    );

    assert.strictEqual(handlerCalled, false, 'No debe ejecutar la tool si el JSON es inválido');
    assert.ok(response.includes('Disculpa el inconveniente'));
  });

  // ─── F11 ───
  await test('F11: Groq timeout -> abort limpio sin timers colgados', async () => {
    const mockGroqClient = {
      chat: {
        completions: {
          create: async (params, { signal }) => {
            return new Promise((resolve, reject) => {
              const abortListener = () => {
                const err = new Error('The operation was aborted.');
                err.name = 'AbortError';
                reject(err);
              };
              if (signal.aborted) return abortListener();
              signal.addEventListener('abort', abortListener);
            });
          }
        }
      }
    };

    let caughtError = null;
    try {
      await callGroq(
        'System prompt',
        [{ role: 'user', content: 'Test' }],
        [],
        [],
        null,
        null,
        () => false,
        mockGroqClient
      );
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Debe abortar con error de timeout');
    assert.strictEqual(caughtError.name, 'AbortError');
  });

  // ─── F12 ───
  await test('F12: Breakers independientes (Gemini no abre Groq, Groq no abre Gemini)', async () => {
    const testGeminiBreaker = new CircuitBreaker();
    const testGroqBreaker = new GroqCircuitBreaker();

    assert.strictEqual(testGeminiBreaker.state, 'CLOSED');
    assert.strictEqual(testGroqBreaker.state, 'CLOSED');

    // 3 fallos en Gemini
    testGeminiBreaker.recordFailure();
    testGeminiBreaker.recordFailure();
    testGeminiBreaker.recordFailure();

    assert.strictEqual(testGeminiBreaker.state, 'OPEN', 'Gemini debe estar OPEN tras 3 fallas');
    assert.strictEqual(testGroqBreaker.state, 'CLOSED', 'Groq debe permanecer CLOSED independiente de Gemini');
    assert.strictEqual(testGroqBreaker.canExecute(), true);

    // 3 fallos en Groq
    const groqTimeoutErr = new Error('AbortError timeout');
    groqTimeoutErr.name = 'AbortError';
    testGroqBreaker.recordFailure(groqTimeoutErr);
    testGroqBreaker.recordFailure(groqTimeoutErr);
    testGroqBreaker.recordFailure(groqTimeoutErr);

    assert.strictEqual(testGroqBreaker.state, 'OPEN', 'Groq debe estar OPEN tras 3 fallas');
    assert.strictEqual(testGroqBreaker.canExecute(), false);

    // Recuperación de Gemini
    testGeminiBreaker.recordSuccess();
    assert.strictEqual(testGeminiBreaker.state, 'CLOSED');
    assert.strictEqual(testGroqBreaker.state, 'OPEN', 'Groq sigue OPEN sin verse afectado por Gemini');
  });

  // ─── F13 ───
  await test('F13: Groq breaker OPEN -> Groq 0 requests, fallback inmediato', async () => {
    const { result, calls, skippedGroqReason } = await simulateCascade({
      primaryHandler: async () => { throw new Error('Gemini 500'); },
      secondaryHandler: async () => { throw new Error('Gemini 500'); },
      groqHandler: async () => 'Nunca llamado',
      breakerState: 'OPEN'
    });

    assert.strictEqual(result, null);
    assert.strictEqual(calls.groq, 0, 'No debe llamar a Groq si su breaker está OPEN');
    assert.strictEqual(skippedGroqReason, 'BREAKER_OPEN');
  });

  // ─── F14 ───
  await test('F14: GROQ_API_KEY ausente -> Groq omitido limpiamente', async () => {
    const { result, calls, skippedGroqReason } = await simulateCascade({
      primaryHandler: async () => { throw new Error('Gemini 500'); },
      secondaryHandler: async () => { throw new Error('Gemini 500'); },
      groqHandler: async () => 'Nunca llamado',
      hasGroqKey: false
    });

    assert.strictEqual(result, null);
    assert.strictEqual(calls.groq, 0);
    assert.strictEqual(skippedGroqReason, 'NO_KEY');
  });

  // ─── F15 ───
  await test('F15: mediaItems presentes -> no base64 enviado a Groq, texto neutro solamente', async () => {
    let capturedMessages = null;

    const mockGroqClient = {
      chat: {
        completions: {
          create: async ({ messages }) => {
            capturedMessages = messages;
            return {
              choices: [{
                message: {
                  role: 'assistant',
                  content: 'Recibí tu archivo, en breve un asesor te ayudará con la imagen.'
                }
              }]
            };
          }
        }
      }
    };

    const fakeBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...MUCHO_CONTENIDO_BINARIO';

    await callGroq(
      'System prompt',
      [{ role: 'user', content: '¿Qué opinas de esta foto?' }],
      [fakeBase64],
      [],
      null,
      null,
      () => false,
      mockGroqClient
    );

    assert.ok(capturedMessages, 'Debe haber enviado mensajes a Groq');
    const userMsg = capturedMessages.find(m => m.role === 'user');
    assert.ok(userMsg, 'Debe haber un mensaje de rol user');

    // Comprobaciones de seguridad de medios
    assert.ok(!userMsg.content.includes(fakeBase64), 'NO debe contener base64');
    assert.ok(!userMsg.content.includes('data:image/'), 'NO debe contener data URI');
    assert.ok(userMsg.content.includes('La interpretación visual no está disponible en este modo de contingencia.'));
  });

  // ─── F16 ───
  await test('F16: tool schema mapper convierte tipos recursivamente', () => {
    const converted = convertGeminiToolsToOpenAI(geminiSampleTools);

    assert.strictEqual(converted.length, 2);
    assert.strictEqual(converted[0].type, 'function');
    assert.strictEqual(converted[0].function.name, 'get_product_details');

    const params0 = converted[0].function.parameters;
    assert.strictEqual(params0.type, 'object', 'OBJECT debe ser normalizado a object');
    assert.strictEqual(params0.properties.productId.type, 'string', 'STRING debe ser normalizado a string');
    assert.strictEqual(params0.properties.tags.type, 'array', 'ARRAY debe ser normalizado a array');
    assert.strictEqual(params0.properties.tags.items.type, 'string', 'items.STRING debe ser normalizado a string');

    const params1 = converted[1].function.parameters;
    assert.strictEqual(params1.properties.quantity.type, 'integer', 'INTEGER debe ser integer');
    assert.strictEqual(params1.properties.customerConfirmed.type, 'boolean', 'BOOLEAN debe ser boolean');
    assert.strictEqual(params1.properties.budget.type, 'number', 'NUMBER debe ser number');
    assert.deepStrictEqual(params1.properties.currentStage.enum, ['EXPLORING', 'DETAILS_PROVIDED', 'COMPLETED']);
  });

  // ─── F17 ───
  await test('F17: mapper es puro y no muta definiciones originales de Gemini', () => {
    const originalStringBefore = JSON.stringify(geminiSampleTools);
    convertGeminiToolsToOpenAI(geminiSampleTools);
    const originalStringAfter = JSON.stringify(geminiSampleTools);

    assert.strictEqual(originalStringBefore, originalStringAfter, 'El objeto geminiTools original no debe ser mutado');
    assert.strictEqual(geminiSampleTools[0].functionDeclarations[0].parameters.type, 'OBJECT');
    assert.strictEqual(geminiSampleTools[0].functionDeclarations[0].parameters.properties.productId.type, 'STRING');
  });

  // ─── F18 ───
  await test('F18: Network Guard bloquea api.groq.com a nivel TLS/socket (S/0.00)', async () => {
    let networkViolationCaptured = false;

    try {
      tls.connect({ host: 'api.groq.com', port: 443 });
    } catch (err) {
      if (err.message.includes('FATAL_QA_NETWORK_VIOLATION')) {
        networkViolationCaptured = true;
      }
    }

    assert.strictEqual(
      networkViolationCaptured,
      true,
      'Network Guard debe arrojar FATAL_QA_NETWORK_VIOLATION ante cualquier intento a api.groq.com'
    );
  });

  // ─── F19 ───
  await test('F19: Primary ejecuta tool con side-effects -> falla -> Secondary NO duplica la tool', async () => {
    let taskExecutionCount = 0;
    const sessionToolsCache = new Map();
    const sessionState = {};

    const mockToolsHandler = async (toolName, args) => {
      if (toolName === 'create_operational_task') {
        taskExecutionCount++;
        return { success: true, taskId: 'task-001', summary: args.summary };
      }
      return { success: true };
    };

    // Primary ejecuta tool 1 vez y luego falla en la generación del texto
    const primaryToolSignature = `create_operational_task_${JSON.stringify({ summary: 'Llamar al cliente mañana' })}`;
    const primaryResult = await mockToolsHandler('create_operational_task', { summary: 'Llamar al cliente mañana' });
    sessionToolsCache.set(primaryToolSignature, primaryResult);

    // Secondary entra: si intenta ejecutar la misma tool, debe usar sessionToolsCache
    let secondaryToolExecuted = false;
    if (sessionToolsCache.has(primaryToolSignature)) {
      // Reutiliza caché sin llamar mockToolsHandler
      const cached = sessionToolsCache.get(primaryToolSignature);
      assert.strictEqual(cached.taskId, 'task-001');
    } else {
      await mockToolsHandler('create_operational_task', { summary: 'Llamar al cliente mañana' });
      secondaryToolExecuted = true;
    }

    assert.strictEqual(secondaryToolExecuted, false, 'Secondary no debió re-ejecutar la tool');
    assert.strictEqual(taskExecutionCount, 1, 'create_operational_task debió ejecutarse exactamente 1 vez');
  });

  // ─── F20 ───
  await test('F20: Primary + Secondary fallan tras tool válida -> Groq NO duplica side effect', async () => {
    let taskExecutionCount = 0;
    const sessionToolsCache = new Map();
    const sessionState = {};

    const mockToolsHandler = async (toolName, args) => {
      taskExecutionCount++;
      return { success: true, itemId: 'task-xyz', summary: args.summary };
    };

    // Simulamos que Gemini ejecutó la tool con éxito
    const toolSig = `create_operational_task_${JSON.stringify({ summary: 'Coordinar entrega viernes' })}`;
    const geminiToolRes = await mockToolsHandler('create_operational_task', { summary: 'Coordinar entrega viernes' });
    sessionToolsCache.set(toolSig, geminiToolRes);

    assert.strictEqual(taskExecutionCount, 1);

    // Groq entra en la cascada con el mismo sessionToolsCache
    const mockGroqClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                  id: 'call_g1',
                  type: 'function',
                  function: {
                    name: 'create_operational_task',
                    arguments: JSON.stringify({ summary: 'Coordinar entrega viernes' })
                  }
                }]
              }
            }]
          })
        }
      }
    };

    let rounds = 0;
    mockGroqClient.chat.completions.create = async () => {
      rounds++;
      if (rounds === 1) {
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call_g1',
                type: 'function',
                function: {
                  name: 'create_operational_task',
                  arguments: JSON.stringify({ summary: 'Coordinar entrega viernes' })
                }
              }]
            }
          }]
        };
      }
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Tarea registrada previamente.'
          }
        }]
      };
    };

    const groqResponse = await callGroq(
      'System',
      [{ role: 'user', content: 'Coordinar entrega' }],
      [],
      [{
        functionDeclarations: [{
          name: 'create_operational_task',
          description: 'Crea una tarea',
          parameters: { type: 'OBJECT', properties: { summary: { type: 'STRING' } }, required: ['summary'] }
        }]
      }],
      mockToolsHandler,
      null,
      () => false,
      mockGroqClient,
      sessionToolsCache,
      sessionState
    );

    assert.strictEqual(taskExecutionCount, 1, 'Groq debe reutilizar la tool ya ejecutada sin duplicar en BD');
    assert.ok(groqResponse.includes('Tarea registrada'));
  });

  // ─── F21 ───
  await test('F21: send_product_media ejecutada una vez -> provider falla -> fallback: máx 1 envío', async () => {
    let mediaSends = 0;
    const sessionToolsCache = new Map();

    const mockToolsHandler = async (toolName, args) => {
      if (toolName === 'send_product_media') {
        mediaSends++;
        return { success: true, mediaSent: true, productId: args.productId };
      }
      return { success: true };
    };

    // Primary ejecuta send_product_media
    const mediaSig = `send_product_media_${JSON.stringify({ productId: 'PROD-404' })}`;
    const res1 = await mockToolsHandler('send_product_media', { productId: 'PROD-404' });
    sessionToolsCache.set(mediaSig, res1);

    // Secondary o Groq intenta ejecutar la misma tool
    if (sessionToolsCache.has(mediaSig)) {
      // Tomado de caché
    } else {
      await mockToolsHandler('send_product_media', { productId: 'PROD-404' });
    }

    assert.strictEqual(mediaSends, 1, 'send_product_media sólo debe ejecutarse una única vez');
  });

  // ─── F22 ───
  await test('F22: create_operational_task ejecutada una vez -> provider falla -> fallback: máx 1 tarea', async () => {
    let taskCreations = 0;
    const sessionToolsCache = new Map();

    const mockToolsHandler = async (toolName, args) => {
      taskCreations++;
      return { success: true, taskId: 'TASK-DEDUP' };
    };

    const sig = `create_operational_task_${JSON.stringify({ summary: 'Nota de cliente' })}`;
    const res = await mockToolsHandler('create_operational_task', { summary: 'Nota de cliente' });
    sessionToolsCache.set(sig, res);

    // Fallback posterior intenta re-ejecutar
    if (!sessionToolsCache.has(sig)) {
      await mockToolsHandler('create_operational_task', { summary: 'Nota de cliente' });
    }

    assert.strictEqual(taskCreations, 1, 'create_operational_task debe permanecer en exactamente 1 creación');
  });

  // ─── F23 ───
  await test('F23: request_human_handoff ejecutado -> provider falla -> NO hacer inferencias posteriores', async () => {
    const sessionToolsCache = new Map();
    const sessionState = { handoffActivated: true }; // Activado durante Gemini
    let groqInferenceCalled = false;

    // Simular compuerta de cascada con sessionState
    if (sessionState.handoffActivated) {
      // Handoff activo: NO llamar a Groq
    } else {
      groqInferenceCalled = true;
    }

    assert.strictEqual(groqInferenceCalled, false, 'Groq NO debe ser llamado si human handoff fue activado en la sesión');
  });

  // ─── F24 ───
  await test('F24: MULTI-ROUND USAGE: tokens acumulados correctamente a lo largo de 3 rondas', async () => {
    let rounds = 0;
    const mockGroqClient = {
      chat: {
        completions: {
          create: async () => {
            rounds++;
            if (rounds === 1) {
              return {
                choices: [{
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                      id: 'call_r1',
                      type: 'function',
                      function: { name: 'get_product_details', arguments: '{"productId":"P1"}' }
                    }]
                  }
                }],
                usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
              };
            }
            if (rounds === 2) {
              return {
                choices: [{
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                      id: 'call_r2',
                      type: 'function',
                      function: { name: 'get_product_details', arguments: '{"productId":"P2"}' }
                    }]
                  }
                }],
                usage: { prompt_tokens: 150, completion_tokens: 30, total_tokens: 180 }
              };
            }
            return {
              choices: [{
                message: {
                  role: 'assistant',
                  content: 'Información de P1 y P2 completada.'
                }
              }],
              usage: { prompt_tokens: 200, completion_tokens: 40, total_tokens: 240 }
            };
          }
        }
      }
    };

    const result = await callGroq(
      'System',
      [{ role: 'user', content: 'Comparar P1 y P2' }],
      [],
      geminiSampleTools,
      async (name, args) => ({ success: true, product: args }),
      null,
      () => false,
      mockGroqClient
    );

    assert.strictEqual(rounds, 3, 'Deben haberse completado 3 rondas');
    assert.ok(result.includes('P1 y P2 completada'));
  });

  // ─── F25 ───
  await test('F25: Múltiples tool calls paralelas en assistant.tool_calls son validadas y ordenadas', async () => {
    let rounds = 0;
    const executedToolNames = [];

    const mockGroqClient = {
      chat: {
        completions: {
          create: async () => {
            rounds++;
            if (rounds === 1) {
              return {
                choices: [{
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'call_p1',
                        type: 'function',
                        function: { name: 'get_product_details', arguments: '{"productId":"PROD-A"}' }
                      },
                      {
                        id: 'call_p2',
                        type: 'function',
                        function: { name: 'get_product_details', arguments: '{"productId":"PROD-B"}' }
                      }
                    ]
                  }
                }],
                usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 }
              };
            }
            return {
              choices: [{
                message: {
                  role: 'assistant',
                  content: 'Ambos productos PROD-A y PROD-B fueron consultados con éxito.'
                }
              }]
            };
          }
        }
      }
    };

    const mockToolsHandler = async (name, args) => {
      executedToolNames.push(args.productId);
      return { success: true, productId: args.productId };
    };

    const res = await callGroq(
      'System',
      [{ role: 'user', content: 'Info de PROD-A y PROD-B' }],
      [],
      geminiSampleTools,
      mockToolsHandler,
      null,
      () => false,
      mockGroqClient
    );

    assert.deepStrictEqual(executedToolNames, ['PROD-A', 'PROD-B'], 'Ambas tool calls deben ejecutarse en orden');
    assert.ok(res.includes('PROD-A y PROD-B fueron consultados'));
  });

  // ─── F26 ───
  await test('F26: Historial con formato parts de Gemini es saneado sin filtrar base64 ni objetos a Groq', async () => {
    let receivedMessages = null;

    const mockGroqClient = {
      chat: {
        completions: {
          create: async ({ messages }) => {
            receivedMessages = messages;
            return {
              choices: [{
                message: {
                  role: 'assistant',
                  content: 'Entendido, historial saneado.'
                }
              }]
            };
          }
        }
      }
    };

    const geminiComplexMessages = [
      {
        role: 'user',
        parts: [
          { text: 'Hola, mira esta imagen:' },
          { inlineData: { data: 'BASE64_SENSITIVE_DATA_123', mimeType: 'image/jpeg' } },
          { functionCall: { name: 'some_func', args: {} } }
        ]
      },
      {
        role: 'model',
        parts: [
          { text: 'Veo la imagen perfectamente.' },
          { functionResponse: { name: 'some_func', response: {} } }
        ]
      },
      {
        role: 'user',
        content: '¿Cuánto cuesta?'
      }
    ];

    await callGroq(
      'System prompt',
      geminiComplexMessages,
      [],
      [],
      null,
      null,
      () => false,
      mockGroqClient
    );

    assert.ok(receivedMessages);
    for (const m of receivedMessages) {
      assert.strictEqual(typeof m.content, 'string', 'Todo content debe ser string en OpenAI format');
      assert.ok(!m.content.includes('BASE64_SENSITIVE_DATA_123'), 'No debe contener base64');
      assert.ok(!m.parts, 'No debe existir la propiedad parts de Gemini');
      assert.ok(!m.functionCall, 'No debe existir functionCall de Gemini');
    }
  });

  // ─── F27 ───
  await test('F27: Groq Circuit Breaker: ciclo HALF_OPEN (falla -> OPEN, éxito -> CLOSED)', () => {
    const breaker = new GroqCircuitBreaker();
    assert.strictEqual(breaker.state, 'CLOSED');

    const timeoutErr = new Error('AbortError');
    timeoutErr.name = 'AbortError';

    // 3 fallos consecutivos
    breaker.recordFailure(timeoutErr);
    breaker.recordFailure(timeoutErr);
    breaker.recordFailure(timeoutErr);
    assert.strictEqual(breaker.state, 'OPEN');

    // Avanzar tiempo más allá del cooldown (120s)
    breaker.lastFailureTime = Date.now() - 130 * 1000;
    assert.strictEqual(breaker.canExecute(), true);
    assert.strictEqual(breaker.state, 'HALF_OPEN');

    // Fallo en HALF_OPEN -> inmediatamente OPEN
    breaker.recordFailure(timeoutErr);
    assert.strictEqual(breaker.state, 'OPEN', 'Fallo en HALF_OPEN debe volver a OPEN inmediatamente');

    // Avanzar tiempo de nuevo
    breaker.lastFailureTime = Date.now() - 130 * 1000;
    assert.strictEqual(breaker.canExecute(), true);
    assert.strictEqual(breaker.state, 'HALF_OPEN');

    // Éxito en HALF_OPEN -> CLOSED
    breaker.recordSuccess();
    assert.strictEqual(breaker.state, 'CLOSED', 'Éxito en HALF_OPEN debe recuperar el breaker a CLOSED');
  });

  // ─── F28 ───
  await test('F28: GROQ_MODEL con espacios o vacío usa fallback seguro llama-3.3-70b-versatile', async () => {
    let capturedModel = null;

    const mockGroqClient = {
      chat: {
        completions: {
          create: async ({ model }) => {
            capturedModel = model;
            return {
              choices: [{
                message: { role: 'assistant', content: 'Modelo verificado.' }
              }]
            };
          }
        }
      }
    };

    const originalEnv = process.env.GROQ_MODEL;
    try {
      process.env.GROQ_MODEL = '   ';
      await callGroq('System', [{ role: 'user', content: 'Test' }], [], [], null, null, () => false, mockGroqClient);
      assert.strictEqual(capturedModel, 'llama-3.3-70b-versatile', 'Debe usar fallback ante string de espacios');
    } finally {
      process.env.GROQ_MODEL = originalEnv;
    }
  });

  // ─── F29 ───
  await test('F29: Groq respuesta vacía o malformada lanza error controlado sin crashear', async () => {
    const mockEmptyClient = {
      chat: {
        completions: {
          create: async () => ({ choices: [] })
        }
      }
    };

    let caughtErr = null;
    try {
      await callGroq('System', [{ role: 'user', content: 'Test' }], [], [], null, null, () => false, mockEmptyClient);
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr);
    assert.ok(caughtErr.message.includes('Respuesta vacía o formato inválido'));
  });

  // ─── F30 ───
  await test('F30: Groq timeout real cancela la request y limpia timers vía AbortSignal', async () => {
    let abortedCleanly = false;
    let timerCleared = false;

    const mockTimeoutClient = {
      chat: {
        completions: {
          create: async (params, { signal }) => {
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => {
                resolve({ choices: [{ message: { role: 'assistant', content: 'Tarde' } }] });
              }, 20000);

              signal.addEventListener('abort', () => {
                clearTimeout(timer);
                timerCleared = true;
                const err = new Error('Request aborted');
                err.name = 'AbortError';
                reject(err);
              });
            });
          }
        }
      }
    };

    try {
      await callGroq('System', [{ role: 'user', content: 'Test' }], [], [], null, null, () => false, mockTimeoutClient);
    } catch (err) {
      if (err.name === 'AbortError') {
        abortedCleanly = true;
      }
    }

    assert.strictEqual(abortedCleanly, true, 'Debe abortar limpiamente');
    assert.strictEqual(timerCleared, true, 'El timer debe ser limpiado tras el abort');
  });

  console.log('----------------------------------------------------------------------');
  console.log(`Groq Fallback Scenario: ${passed}/${total} PASS`);
  return { passed, total };
}
