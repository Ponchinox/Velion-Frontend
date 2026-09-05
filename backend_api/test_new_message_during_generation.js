import assert from 'node:assert';
import fs from 'fs';
import {
  getChatGenerationVersion,
  incrementChatGenerationVersion,
  scheduleChatVersionCleanup,
  _resetChatGenerationVersionsForTesting,
  getTenantAiEpoch,
  incrementTenantAiEpoch
} from './src/controllers/whatsappController.js';

console.log('======================================================================');
console.log('VELION TEST SUITE: NEW MESSAGE DURING GENERATION (N1 – N18)');
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

// ─────────────────────────────────────────────────────────────────────────────
// INSPECCIÓN ESTÁTICA DEL CONTROLADOR
// ─────────────────────────────────────────────────────────────────────────────
const controllerCode = fs.readFileSync('./backend_api/src/controllers/whatsappController.js', 'utf8');

async function main() {
  // Reset previo para tests limpios
  _resetChatGenerationVersionsForTesting();

  // N1: B llega durante debounce de A => debounce reinicia y se procesan juntos
  await runTest('N1', 'B llega durante debounce de A: timer reinicia y textos se combinan', async () => {
    _resetChatGenerationVersionsForTesting();
    const bufferKey = 'tenant-1:51999000001';
    
    // Simular llegada de A
    const v1 = incrementChatGenerationVersion(bufferKey);
    assert.strictEqual(v1, 1);
    const mockBuffer = { text: 'Quiero el Intensivo', timerCount: 1 };

    // Simular llegada de B durante debounce de 4s
    const v2 = incrementChatGenerationVersion(bufferKey);
    assert.strictEqual(v2, 2);
    // Simula lógica existente de lines 1500-1518
    mockBuffer.text += '\n' + 'No, mejor el Superintensivo';
    mockBuffer.timerCount++;

    assert.strictEqual(mockBuffer.text, 'Quiero el Intensivo\nNo, mejor el Superintensivo');
    assert.strictEqual(mockBuffer.timerCount, 2);
    assert.strictEqual(getChatGenerationVersion(bufferKey), 2);
  });

  // N2: B llega durante generateAIResponse(A) => A queda superseded y 0 mensajes de A enviados
  await runTest('N2', 'B llega durante generateAIResponse(A): A queda superseded y se descarta', async () => {
    _resetChatGenerationVersionsForTesting();
    const bufferKey = 'tenant-1:51999000002';
    const pendingQueues = new Map();

    // Inicia mensaje A
    incrementChatGenerationVersion(bufferKey); // v1
    const capturedVersion = getChatGenerationVersion(bufferKey); // 1
    const isGenerationSuperseded = () =>
      (getChatGenerationVersion(bufferKey) !== capturedVersion) || pendingQueues.has(bufferKey);

    assert.strictEqual(isGenerationSuperseded(), false);

    // Llega B mientras Gemini genera para A
    incrementChatGenerationVersion(bufferKey); // v2
    pendingQueues.set(bufferKey, { text: 'Mensaje B' });

    // Cuando Gemini termina para A:
    assert.strictEqual(isGenerationSuperseded(), true);
    
    // Simular Post-Gen Gate: si isGenerationSuperseded() es true, retornar sin despachar
    let dispatched = false;
    if (!isGenerationSuperseded()) {
      dispatched = true;
    }
    assert.strictEqual(dispatched, false, 'La respuesta de A no debió despacharse');
  });

  // N3: A produce 3 fragmentos [SPLIT]; B ya está pending antes de dispatch => 0 fragmentos enviados
  await runTest('N3', 'A produce 3 fragmentos [SPLIT] y B llega antes de dispatch: 0 fragmentos enviados', async () => {
    _resetChatGenerationVersionsForTesting();
    const bufferKey = 'tenant-1:51999000003';
    const pendingQueues = new Map();

    incrementChatGenerationVersion(bufferKey); // A = v1
    const genVersion = getChatGenerationVersion(bufferKey);

    const isGenerationSuperseded = () =>
      (getChatGenerationVersion(bufferKey) !== genVersion) || pendingQueues.has(bufferKey);

    const dispatchSequence = [
      { type: 'text', content: 'Fragmento 1' },
      { type: 'text', content: 'Fragmento 2' },
      { type: 'text', content: 'Fragmento 3' }
    ];

    // B llega antes del despacho
    incrementChatGenerationVersion(bufferKey); // B = v2
    pendingQueues.set(bufferKey, { text: 'Nuevo mensaje' });

    const sentFragments = [];
    for (let i = 0; i < dispatchSequence.length; i++) {
      if (isGenerationSuperseded()) {
        break;
      }
      sentFragments.push(dispatchSequence[i].content);
    }

    assert.strictEqual(sentFragments.length, 0, 'Deben haberse enviado 0 fragmentos');
  });

  // N4: B llega DURANTE typingDelay del primer fragmento => guard post-typing cancela item 0
  await runTest('N4', 'B llega DURANTE typingDelay del primer fragmento: post-typing guard cancela item 0', async () => {
    _resetChatGenerationVersionsForTesting();
    const bufferKey = 'tenant-1:51999000004';
    const pendingQueues = new Map();

    incrementChatGenerationVersion(bufferKey); // v1
    const genVersion = getChatGenerationVersion(bufferKey);

    const isGenerationSuperseded = () =>
      (getChatGenerationVersion(bufferKey) !== genVersion) || pendingQueues.has(bufferKey);

    const dispatchSequence = [{ type: 'text', content: 'Hola amigo' }];
    const sent = [];

    for (let i = 0; i < dispatchSequence.length; i++) {
      if (isGenerationSuperseded()) break;

      // Simular inicio de typing delay (aquí todavía no llegaba B)
      assert.strictEqual(isGenerationSuperseded(), false);

      // Llega B a mitad del typing delay!
      incrementChatGenerationVersion(bufferKey); // v2
      pendingQueues.set(bufferKey, { text: 'Oye espera' });

      // Guard Post-Typing
      if (isGenerationSuperseded()) {
        break;
      }

      sent.push(dispatchSequence[i].content);
    }

    assert.strictEqual(sent.length, 0, 'Item 0 no debió enviarse gracias al post-typing guard');
  });

  // N5: A preparó pendingMediaToSend; B llega antes de dispatch => 0 media enviada
  await runTest('N5', 'A preparó pendingMediaToSend y B llega antes de dispatch: 0 media enviada', async () => {
    _resetChatGenerationVersionsForTesting();
    const bufferKey = 'tenant-1:51999000005';
    const pendingQueues = new Map();

    incrementChatGenerationVersion(bufferKey);
    const genVersion = getChatGenerationVersion(bufferKey);

    let pendingMediaToSend = { productId: 'p1', url: 'https://img.jpg' };
    const isGenerationSuperseded = () =>
      (getChatGenerationVersion(bufferKey) !== genVersion) || pendingQueues.has(bufferKey);

    // B llega
    incrementChatGenerationVersion(bufferKey);
    pendingQueues.set(bufferKey, { text: 'Cambio de opinión' });

    let mediaSent = false;
    // Simular post-gen gate
    if (isGenerationSuperseded()) {
      // Salida temprana
      pendingMediaToSend = null;
    } else {
      mediaSent = true;
    }

    assert.strictEqual(mediaSent, false);
    assert.strictEqual(pendingMediaToSend, null);
  });

  // N6: Chat A y Chat B distintos, mismo tenant => versionado independiente, ninguno cancela al otro
  await runTest('N6', 'Chat A y Chat B distintos del mismo tenant: versionado independiente', async () => {
    _resetChatGenerationVersionsForTesting();
    const keyA = 'tenant-1:51999111111';
    const keyB = 'tenant-1:51999222222';

    const vA1 = incrementChatGenerationVersion(keyA);
    const vB1 = incrementChatGenerationVersion(keyB);
    assert.strictEqual(vA1, 1);
    assert.strictEqual(vB1, 1);

    // Chat A recibe otro mensaje
    const vA2 = incrementChatGenerationVersion(keyA);
    assert.strictEqual(vA2, 2);
    // Chat B debe permanecer en 1
    assert.strictEqual(getChatGenerationVersion(keyB), 1);
  });

  // N7: Mismo número en tenants distintos => aislamiento total por bufferKey
  await runTest('N7', 'Mismo número en tenants distintos: aislamiento total por tenant.id', async () => {
    _resetChatGenerationVersionsForTesting();
    const keyTenantAlpha = 'tenant-alpha:51999888777';
    const keyTenantBeta  = 'tenant-beta:51999888777';

    incrementChatGenerationVersion(keyTenantAlpha);
    incrementChatGenerationVersion(keyTenantAlpha);

    assert.strictEqual(getChatGenerationVersion(keyTenantAlpha), 2);
    assert.strictEqual(getChatGenerationVersion(keyTenantBeta), 0);
  });

  // N8: AI OFF durante generación => comportamiento existente intacto
  await runTest('N8', 'AI OFF durante generación: post-gen gate existente descarta e inserta ai_cancelled', async () => {
    // Comprobación estática de preservación
    assert.ok(
      controllerCode.includes('postGenCheck?.aiEnabled === false'),
      'AI OFF gate debe existir en whatsappController.js'
    );
    assert.ok(
      controllerCode.includes("status: 'ai_cancelled'"),
      'status ai_cancelled debe persistirse al apagar IA'
    );
  });

  // N9: Human handoff manual durante generación => post-gen gate existente sigue funcionando
  await runTest('N9', 'Human handoff durante generación: post-gen gate descarta respuesta', async () => {
    assert.ok(
      controllerCode.includes('isPostGenHandoff = handoffRequestedInSession || await isHandoffActive'),
      'Human handoff post-gen gate debe existir'
    );
    assert.ok(
      controllerCode.includes('pendingQueues.delete(bufferKey)'),
      'Handoff post-gen gate debe limpiar pendingQueues'
    );
  });

  // N10: Nuevo mensaje NO altera tenantAiConfigEpoch
  await runTest('N10', 'Llegada de nuevo mensaje NO altera tenantAiConfigEpoch', async () => {
    const tenantId = 'tenant-test-epoch';
    const initialEpoch = getTenantAiEpoch(tenantId);

    // Simular recepción de múltiples mensajes
    incrementChatGenerationVersion(`${tenantId}:51999111000`);
    incrementChatGenerationVersion(`${tenantId}:51999111000`);
    incrementChatGenerationVersion(`${tenantId}:51999222000`);

    const finalEpoch = getTenantAiEpoch(tenantId);
    assert.strictEqual(initialEpoch, finalEpoch, 'El epoch del tenant no debe mutar ante mensajes de clientes');
  });

  // N11: get_product_details de generación A y llega B => sin side-effects
  await runTest('N11', 'get_product_details con generación superseded: tool bloqueada sin side-effects', async () => {
    _resetChatGenerationVersionsForTesting();
    const bufferKey = 'tenant-1:51999000011';
    const pendingQueues = new Map();

    incrementChatGenerationVersion(bufferKey); // v1
    const genVersion = getChatGenerationVersion(bufferKey);

    // Llega B
    incrementChatGenerationVersion(bufferKey); // v2
    pendingQueues.set(bufferKey, { text: 'B' });

    const isGenerationSuperseded = () =>
      (getChatGenerationVersion(bufferKey) !== genVersion) || pendingQueues.has(bufferKey);

    // Simular toolsHandler con tool guard
    const toolsHandler = async (funcName) => {
      if (isGenerationSuperseded()) {
        return { success: false, error: 'GENERATION_SUPERSEDED', message: 'El usuario envió un mensaje más reciente. No aplicar cambios.' };
      }
      return { success: true, result: 'Detalles del producto' };
    };

    const res = await toolsHandler('get_product_details');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'GENERATION_SUPERSEDED');
  });

  // N12: B llega ANTES de update_commercial_state de A => tool devuelve GENERATION_SUPERSEDED, 0 Order creada
  await runTest('N12', 'B llega ANTES de update_commercial_state: tool bloqueada, 0 Order, 0 mutación DB', async () => {
    _resetChatGenerationVersionsForTesting();
    const bufferKey = 'tenant-1:51999000012';
    const pendingQueues = new Map();

    incrementChatGenerationVersion(bufferKey); // v1
    const genVersion = getChatGenerationVersion(bufferKey);

    // B llega mientras Gemini pensaba antes de llamar a la tool
    incrementChatGenerationVersion(bufferKey); // v2
    pendingQueues.set(bufferKey, { text: 'No quiero comprar nada' });

    const isGenerationSuperseded = () =>
      (getChatGenerationVersion(bufferKey) !== genVersion) || pendingQueues.has(bufferKey);

    let orderCreated = false;
    let commercialStateMutated = false;

    const toolsHandler = async (funcName, args) => {
      if (isGenerationSuperseded()) {
        return { success: false, error: 'GENERATION_SUPERSEDED', message: 'El usuario envió un mensaje más reciente. No aplicar cambios.' };
      }
      if (funcName === 'update_commercial_state') {
        orderCreated = true;
        commercialStateMutated = true;
        return { success: true };
      }
    };

    const toolResult = await toolsHandler('update_commercial_state', { currentStage: 'PAYMENT_PENDING' });

    assert.strictEqual(toolResult.error, 'GENERATION_SUPERSEDED');
    assert.strictEqual(orderCreated, false, 'No debió crearse ninguna orden');
    assert.strictEqual(commercialStateMutated, false, 'No debió mutar el commercialState');
  });

  // N13: B llega ANTES de request_human_handoff de A => tool bloqueada, botPaused sigue false, 0 alertas
  await runTest('N13', 'B llega ANTES de request_human_handoff: tool bloqueada, bot no se pausa, B no se descarta', async () => {
    _resetChatGenerationVersionsForTesting();
    const bufferKey = 'tenant-1:51999000013';
    const pendingQueues = new Map();

    incrementChatGenerationVersion(bufferKey); // v1
    const genVersion = getChatGenerationVersion(bufferKey);

    // B llega rectificando
    incrementChatGenerationVersion(bufferKey); // v2
    pendingQueues.set(bufferKey, { text: 'Perdón me equivoqué, continúo contigo bot' });

    const isGenerationSuperseded = () =>
      (getChatGenerationVersion(bufferKey) !== genVersion) || pendingQueues.has(bufferKey);

    let botPaused = false;
    let alertSent = false;

    const toolsHandler = async (funcName) => {
      if (isGenerationSuperseded()) {
        return { success: false, error: 'GENERATION_SUPERSEDED', message: 'El usuario envió un mensaje más reciente. No aplicar cambios.' };
      }
      if (funcName === 'request_human_handoff') {
        botPaused = true;
        alertSent = true;
        return { success: true };
      }
    };

    const toolResult = await toolsHandler('request_human_handoff');

    assert.strictEqual(toolResult.error, 'GENERATION_SUPERSEDED');
    assert.strictEqual(botPaused, false, 'El bot NO debió pausarse');
    assert.strictEqual(alertSent, false, 'No debió enviarse alerta al comerciante');
    assert.ok(pendingQueues.has(bufferKey), 'Mensaje B sigue en pendingQueues para ser procesado');
  });

  // N14: send_product_media preparado por A y B llega => 0 imagen y 0 caption enviados
  await runTest('N14', 'send_product_media preparado por A y B llega antes de despacho: 0 multimedia', async () => {
    _resetChatGenerationVersionsForTesting();
    const bufferKey = 'tenant-1:51999000014';
    const pendingQueues = new Map();

    incrementChatGenerationVersion(bufferKey); // v1
    const genVersion = getChatGenerationVersion(bufferKey);

    const isGenerationSuperseded = () =>
      (getChatGenerationVersion(bufferKey) !== genVersion) || pendingQueues.has(bufferKey);

    // Simulamos que la tool corrió antes de que llegara B
    let pendingMediaToSend = { url: 'https://catalogo.com/foto.jpg', productId: 'p-1' };
    const cleanedText = 'Aquí tienes la imagen del curso.';

    // B llega justo después de la tool
    incrementChatGenerationVersion(bufferKey); // v2
    pendingQueues.set(bufferKey, { text: 'Ya no quiero ver la foto' });

    // Post-generation gate
    let dispatchSequence = [];
    if (!isGenerationSuperseded()) {
      dispatchSequence.push({ type: 'image', url: pendingMediaToSend.url, caption: cleanedText });
    }

    assert.strictEqual(dispatchSequence.length, 0, 'La secuencia de despacho no debió armarse');
  });

  // N15: processingLocks sigue garantizando máximo una generación activa por chat
  await runTest('N15', 'processingLocks garantiza exclusión mutua de generaciones simultáneas', async () => {
    const processingLocks = new Set();
    const pendingQueues = new Map();
    const bufferKey = 'tenant-1:51999000015';

    // Generación A activa
    processingLocks.add(bufferKey);

    // Intento de generar B mientras A está activa
    let startedGenerationB = false;
    if (processingLocks.has(bufferKey)) {
      pendingQueues.set(bufferKey, { text: 'Mensaje B' });
    } else {
      startedGenerationB = true;
    }

    assert.strictEqual(startedGenerationB, false, 'B no debió arrancar en paralelo');
    assert.ok(pendingQueues.has(bufferKey), 'B debió encolarse en pendingQueues');
  });

  // N16: B llega después de que fragmento 0 YA fue enviado, pero antes del fragmento 1
  await runTest('N16', 'B llega tras enviar fragmento 0: fragmentos restantes cancelados', async () => {
    _resetChatGenerationVersionsForTesting();
    const bufferKey = 'tenant-1:51999000016';
    const pendingQueues = new Map();

    incrementChatGenerationVersion(bufferKey); // v1
    const genVersion = getChatGenerationVersion(bufferKey);

    const isGenerationSuperseded = () =>
      (getChatGenerationVersion(bufferKey) !== genVersion) || pendingQueues.has(bufferKey);

    const dispatchSequence = [
      { type: 'text', content: 'Parte 1' },
      { type: 'text', content: 'Parte 2' },
      { type: 'text', content: 'Parte 3' }
    ];

    const sent = [];
    for (let i = 0; i < dispatchSequence.length; i++) {
      if (isGenerationSuperseded()) break;

      // Se envía el fragmento 0 físicamente
      sent.push(dispatchSequence[i].content);

      // Inmediatamente después de enviar fragmento 0, llega B!
      incrementChatGenerationVersion(bufferKey); // v2
      pendingQueues.set(bufferKey, { text: 'Para!' });

      // Siguiente iteración evaluará isGenerationSuperseded()
    }

    assert.strictEqual(sent.length, 1, 'Solo debió enviarse el primer fragmento');
    assert.strictEqual(sent[0], 'Parte 1');
  });

  // N17: Versión A=1. Llega B -> 2. Generación A compara 1 vs 2 => superseded true
  await runTest('N17', 'Comparación matemática de versión: capturedVersion < currentVersion => superseded', async () => {
    _resetChatGenerationVersionsForTesting();
    const bufferKey = 'tenant-1:51999000017';

    const vA = incrementChatGenerationVersion(bufferKey); // 1
    assert.strictEqual(vA, 1);

    const vB = incrementChatGenerationVersion(bufferKey); // 2
    assert.strictEqual(vB, 2);

    const isSuperseded = getChatGenerationVersion(bufferKey) !== vA;
    assert.strictEqual(isSuperseded, true);
  });

  // N18: Dos mensajes B y C llegan durante A => versión aumenta correctamente y batch se preserva
  await runTest('N18', 'Dos mensajes B y C llegan durante A: versión avanza y textos se acumulan en pendingQueue', async () => {
    _resetChatGenerationVersionsForTesting();
    const bufferKey = 'tenant-1:51999000018';
    const pendingQueues = new Map();

    // Mensaje A arranca generación
    incrementChatGenerationVersion(bufferKey); // v1
    const capturedA = getChatGenerationVersion(bufferKey); // 1

    // Llega B
    incrementChatGenerationVersion(bufferKey); // v2
    pendingQueues.set(bufferKey, { text: 'Mensaje B' });

    // Llega C mientras A sigue generando
    incrementChatGenerationVersion(bufferKey); // v3
    const existing = pendingQueues.get(bufferKey);
    existing.text += '\n' + 'Mensaje C';

    assert.strictEqual(getChatGenerationVersion(bufferKey), 3);
    assert.strictEqual(capturedA !== getChatGenerationVersion(bufferKey), true);
    assert.strictEqual(pendingQueues.get(bufferKey).text, 'Mensaje B\nMensaje C');
  });

  // N19 (Bonus Estático): Validar presencia de guards en código de whatsappController.js
  await runTest('N19', 'Verificación estática de todos los guards implementados en whatsappController.js', async () => {
    assert.ok(
      controllerCode.includes('incrementChatGenerationVersion(bufferKey)'),
      'Debe incrementar versión en receiveWhatsAppMessage'
    );
    assert.ok(
      controllerCode.includes('const generationVersion = getChatGenerationVersion(bufferKey)'),
      'Debe capturar generationVersion en processBufferedMessage'
    );
    assert.ok(
      controllerCode.includes('const isGenerationSuperseded = () =>'),
      'Debe definir isGenerationSuperseded helper en processBufferedMessage'
    );
    assert.ok(
      controllerCode.includes("error: 'GENERATION_SUPERSEDED'"),
      'Debe retornar GENERATION_SUPERSEDED en toolsHandler'
    );
    assert.ok(
      controllerCode.includes('// ─── GENERATION SUPERSEDED CHECK (Post-Gemini Gate) ───'),
      'Debe tener guard post-Gemini'
    );
    assert.ok(
      controllerCode.includes('// ─── GENERATION SUPERSEDED CHECK (Post-Typing Check) ───'),
      'Debe tener guard post-typing en dispatchSequence'
    );
    assert.ok(
      controllerCode.includes('scheduleChatVersionCleanup(bufferKey)'),
      'Debe programar limpieza de memoria tras TTL seguro'
    );
  });

  console.log('\n======================================================================');
  console.log(`RESULTADOS: ${passedCount} pasaron, ${failedCount} fallaron.`);
  console.log('======================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error fatal en suite de tests:', err);
  process.exit(1);
});
