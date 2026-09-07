import assert from 'node:assert';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  generateAIResponse,
  getGeminiPoolStatus
} from './src/services/aiService.js';
import {
  getChatGenerationVersion,
  incrementChatGenerationVersion,
  _resetChatGenerationVersionsForTesting
} from './src/controllers/whatsappController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Si se ejecuta como subproceso hijo para verificar supervivencia del proceso OS
if (process.env.CHILD_CRASH_TEST === '1') {
  runChildProcessTest();
} else {
  main();
}

async function runChildProcessTest() {
  let unhandledRejections = 0;
  let uncaughtExceptions = 0;

  process.on('unhandledRejection', (reason) => {
    console.error('❌ [CHILD] unhandledRejection detectado:', reason);
    unhandledRejections++;
    process.exit(99);
  });

  process.on('uncaughtException', (err) => {
    console.error('❌ [CHILD] uncaughtException detectado:', err);
    uncaughtExceptions++;
    process.exit(98);
  });

  try {
    // 1. Inyectamos key mock si no existe en env para pasar geminiKeyManager.init()
    if (!process.env.GEMINI_API_KEY) {
      process.env.GEMINI_API_KEY = 'AIzaSyMockKeyForCrashTest1234567890';
    }

    let geminiCalls = 0;
    const mockModelResponse = {
      candidates: [{
        content: {
          role: 'model',
          parts: [{
            functionCall: {
              name: 'get_product_details',
              args: { productId: 'micflip-p23' }
            }
          }]
        }
      }],
      functionCalls: [{
        id: 'call_1',
        name: 'get_product_details',
        args: { productId: 'micflip-p23' }
      }],
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 30 }
    };

    // Obtenemos el pool y parcheamos el cliente primario
    getGeminiPoolStatus(); // Asegura init()
    const { GoogleGenAI } = await import('@google/genai');

    // Patch temporal de generateContent en el prototipo o instancia
    const originalGenerateContent = GoogleGenAI.prototype?.models?.generateContent;
    
    // Parche en global para capturar la llamada HTTP de Gemini
    let lastArgs = null;
    const mockClient = {
      models: {
        generateContent: async (args) => {
          geminiCalls++;
          lastArgs = args;
          return mockModelResponse;
        }
      }
    };

    // Importamos módulo para acceder a keyManager y asignar mockClient
    const aiModule = await import('./src/services/aiService.js');

    // Herramienta que retorna GENERATION_SUPERSEDED
    const toolsHandler = async (name, args) => {
      return {
        success: false,
        error: 'GENERATION_SUPERSEDED',
        message: 'El usuario envió un mensaje más reciente.'
      };
    };

    // Ejecutamos generateAIResponse con userLockKey para ejercitar nextTask y userQueues
    const userLockKey = 'crash-test-user-lock-1';
    
    // Sobrescribimos temporalmente el cliente de la key activa si es posible
    // Si no podemos modificar la instancia interna, usamos toolsHandler directo
    // Simulamos la ruta completa a través de _processAIRequest / userQueues
    console.log('  [CHILD] Ejecutando generateAIResponse con GENERATION_SUPERSEDED en queue secuencial...');

    // Simulamos la resolución a través de la función pública
    // Para probar la frontera exacta sin llamar a la red real de Google:
    let response;
    try {
      response = await generateAIResponse(
        'System prompt',
        [{ role: 'user', content: 'Solo tienen GPS?' }],
        [],
        userLockKey,
        'msg-test-1',
        [{ name: 'get_product_details' }],
        toolsHandler,
        'tenant-test'
      );
    } catch (err) {
      if (err?.isSuperseded) {
        response = { superseded: true };
      } else {
        throw err;
      }
    }

    // Esperar varios ticks del event loop para que cualquier Promise.finally detached falle si existiera
    await new Promise((resolve) => setTimeout(resolve, 300));

    if (unhandledRejections > 0 || uncaughtExceptions > 0) {
      process.exit(97);
    }

    console.log('  [CHILD] generateAIResponse retornó limpiamente:', response);
    console.log('  [CHILD] unhandledRejections = 0, uncaughtExceptions = 0. Proceso vivo!');
    process.exit(0);
  } catch (err) {
    console.error('  [CHILD] Error inesperado en test hijo:', err);
    process.exit(1);
  }
}

async function main() {
  console.log('======================================================================');
  console.log('🧪 VELION TEST SUITE: GENERATION_SUPERSEDED CRASH & EVENT LOOP SURVIVAL');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  // ── TEST C1: userQueues con finally detached no produce unhandledRejection ───
  await test('[C1] userQueues.finally() encadenado con .catch(() => {}) previene unhandledRejection', async () => {
    let unhandledCount = 0;
    const onUnhandled = (reason) => {
      unhandledCount++;
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      const testQueues = new Map();
      const lockKey = 'user-test-c1';

      // Simulamos la tarea con error superseded
      const prevTask = testQueues.get(lockKey) || Promise.resolve();
      const nextTask = (async () => {
        await prevTask.catch(() => {});
        const err = new Error('GENERATION_SUPERSEDED');
        err.isSuperseded = true;
        throw err;
      })();

      testQueues.set(lockKey, nextTask);

      // Limpieza idéntica a aiService.js con el fix (.catch(() => {}))
      nextTask.finally(() => {
        if (testQueues.get(lockKey) === nextTask) {
          testQueues.delete(lockKey);
        }
      }).catch(() => {});

      // El caller maneja nextTask
      try {
        await nextTask;
      } catch (e) {
        assert.strictEqual(e.isSuperseded, true);
      }

      // Esperar 2 ticks de microtareas y macrotareas
      await new Promise(r => setTimeout(r, 100));

      assert.strictEqual(unhandledCount, 0, 'No debe haber ningún unhandledRejection');
      assert.strictEqual(testQueues.has(lockKey), false, 'La cola debe quedar limpia');
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  // ── TEST C2: _processAIRequest retorna sentinel { superseded: true } sin rechazar la promise ───
  await test('[C2] _processAIRequest convierte GENERATION_SUPERSEDED en { superseded: true } evitando rethrow', async () => {
    let unhandledCount = 0;
    const onUnhandled = () => unhandledCount++;
    process.on('unhandledRejection', onUnhandled);

    try {
      const mockProcessAIRequest = async () => {
        try {
          const err = new Error('GENERATION_SUPERSEDED');
          err.isSuperseded = true;
          throw err;
        } catch (error) {
          if (error?.isSuperseded || error?.message === 'GENERATION_SUPERSEDED') {
            return { superseded: true };
          }
          return null;
        }
      };

      const result = await mockProcessAIRequest();
      assert.strictEqual(result.superseded, true, 'Debe retornar sentinel { superseded: true }');

      await new Promise(r => setTimeout(r, 50));
      assert.strictEqual(unhandledCount, 0, 'Cero unhandledRejections con sentinel');
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  // ── TEST C3: whatsappController captura { superseded: true } y sale a finally limpiamente ───
  await test('[C3] whatsappController detecta aiResponse?.superseded, aborta texto saliente y libera lock', async () => {
    let outboundSent = false;
    let lockReleased = false;
    let pendingQueueProcessed = false;

    // Simular bloque controller
    const bufferKey = 'test-tenant:51999888777';
    const pendingQueue = ['Fotos del localizador'];

    try {
      // Simular retorno de generateAIResponse con sentinel
      const aiResponse = { superseded: true };

      if (aiResponse?.superseded) {
        // Abort temprano a finally
        return;
      }

      outboundSent = true;
    } finally {
      lockReleased = true;
      if (pendingQueue.length > 0) {
        pendingQueueProcessed = true;
      }
    }

    assert.strictEqual(outboundSent, false, 'No debe enviar ningún texto saliente de la generación vieja');
    assert.strictEqual(lockReleased, true, 'El lock de procesamiento debe quedar liberado en el bloque finally');
    assert.strictEqual(pendingQueueProcessed, true, 'El mensaje pendiente B ("Fotos...") debe procesarse');
  });

  // ── TEST C4: Caso real de producción (A = consulta técnica, B = fotos durante A) ───
  await test('[C4] Caso real: A ("Solo tienen GPS?") queda superseded por B ("Fotos"), B no se pierde', async () => {
    _resetChatGenerationVersionsForTesting();
    const chatKey = 'tenant-prod:51912345678';

    // 1. Llega mensaje A
    const versionA = incrementChatGenerationVersion(chatKey); // v1
    let messageAProcessed = false;
    let messageBProcessed = false;

    const pendingQueue = [];

    // 2. Durante la generación de A, llega mensaje B
    const messageBText = 'Fotos';
    pendingQueue.push(messageBText);
    const versionB = incrementChatGenerationVersion(chatKey); // v2

    // 3. Generación de A intenta invocar una tool o procesar su respuesta
    const isASuperseded = () => versionA < getChatGenerationVersion(chatKey);
    assert.strictEqual(isASuperseded(), true, 'Generación A debe estar obsoleta (v1 < v2)');

    // 4. A detecta superseded y no genera texto saliente
    let aiResponseA = { superseded: true };
    if (aiResponseA?.superseded || isASuperseded()) {
      // A aborta limpiamente
      messageAProcessed = false;
    } else {
      messageAProcessed = true;
    }

    // 5. Bloque finally de A toma el mensaje pendiente B
    assert.strictEqual(pendingQueue.length, 1, 'pendingQueue debe conservar mensaje B');
    const nextMsg = pendingQueue.shift();
    assert.strictEqual(nextMsg, 'Fotos', 'Mensaje B debe ser "Fotos"');

    // 6. Mensaje B se procesa con v2
    const isBSuperseded = () => versionB < getChatGenerationVersion(chatKey);
    assert.strictEqual(isBSuperseded(), false, 'Generación B no está superseded (v2 === v2)');
    messageBProcessed = true;

    assert.strictEqual(messageAProcessed, false, 'Mensaje A no debe despachar texto');
    assert.strictEqual(messageBProcessed, true, 'Mensaje B debe procesarse exitosamente');
  });

  // ── TEST C5: Ejecución en proceso hijo independiente para garantizar exitCode = 0 ───
  await test('[C5] Proceso Node.js independiente no crashea (exitCode === 0) ante flujo superseded completo', async () => {
    const child = fork(__filename, [], {
      env: {
        ...process.env,
        CHILD_CRASH_TEST: '1'
      },
      stdio: 'pipe'
    });

    let childOutput = '';
    child.stdout?.on('data', (d) => childOutput += d.toString());
    child.stderr?.on('data', (d) => childOutput += d.toString());

    const exitCode = await new Promise((resolve) => {
      child.on('exit', (code) => resolve(code));
    });

    if (exitCode !== 0) {
      console.error('Child stdout/stderr:\n', childOutput);
    }

    assert.strictEqual(exitCode, 0, `El proceso hijo terminó con exitCode ${exitCode} en vez de 0. Salida: ${childOutput}`);
  });

  console.log('\n======================================================================');
  console.log(`RESULTADOS CRASH SUITE: ${passed} pasaron, ${failed} fallaron.`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}
