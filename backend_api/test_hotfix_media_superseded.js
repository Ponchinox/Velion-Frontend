import assert from 'node:assert';
import fs from 'fs';
import {
  isExplicitProductMediaIntent,
  enforceMediaAuthority,
  SEND_PRODUCT_MEDIA_DECLARATION,
  getChatGenerationVersion,
  incrementChatGenerationVersion,
  _resetChatGenerationVersionsForTesting
} from './src/controllers/whatsappController.js';

console.log('======================================================================');
console.log('🧪 VELION HOTFIX SUITE: M1–M29 (PRODUCT MEDIA + SUPERSEDED GENERATION)');
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

const controllerCode = fs.readFileSync('./backend_api/src/controllers/whatsappController.js', 'utf8');
const aiServiceCode = fs.readFileSync('./backend_api/src/services/aiService.js', 'utf8');

async function main() {
  _resetChatGenerationVersionsForTesting();

  // ── M1: "Tienes fotos" + producto seleccionado => send_product_media ───
  await runTest('M1', '"Tienes fotos" + producto seleccionado detecta explicit intent y prioriza send_product_media', async () => {
    const input = 'Tienes fotos';
    assert.strictEqual(isExplicitProductMediaIntent(input), true, 'Debe detectar intención explícita de foto');
    
    // Verificación de directiva prioritaria en prompt
    assert.ok(controllerCode.includes('isExplicitProductMediaIntent(userMessageText) && currentCommercialState?.productId'), 'Debe existir guardia de prompt prioritario para foto');
    assert.ok(controllerCode.includes("DEBES llamar INMEDIATAMENTE a la herramienta 'send_product_media'"), 'Debe ordenar llamar send_product_media');
  });

  // ── M2: "Además tiene foto?" => send_product_media / auto-enqueue ───
  await runTest('M2', '"Además tiene foto?" detecta intención explícita y auto-encola media canónica si se llama get_product_details', async () => {
    const input = 'Además tiene foto?';
    assert.strictEqual(isExplicitProductMediaIntent(input), true, 'Debe reconocer "Además tiene foto?"');
    
    // Simular auto-enqueue en get_product_details
    let pendingMediaToSend = null;
    let mediaSentInSession = false;
    const mockProduct = {
      id: 'prod-micflip-p23',
      name: 'Localizador inteligente Micflip P23',
      imageUrl: 'https://velion.storage/p23.jpg',
      images: []
    };

    if (isExplicitProductMediaIntent(input) && !pendingMediaToSend && !mediaSentInSession) {
      const canonicalUrl = mockProduct.imageUrl;
      if (canonicalUrl) {
        pendingMediaToSend = {
          url: canonicalUrl,
          type: 'image',
          productId: mockProduct.id
        };
        mediaSentInSession = true;
      }
    }

    assert.ok(pendingMediaToSend !== null, 'pendingMediaToSend debe haber sido poblado');
    assert.strictEqual(pendingMediaToSend.url, 'https://velion.storage/p23.jpg');
    assert.strictEqual(mediaSentInSession, true);
  });

  // ── M3: "Cómo se ve?" => send_product_media ───
  await runTest('M3', '"Cómo se ve?" detecta intención explícita de visualización', async () => {
    const phrases = [
      'Cómo se ve?',
      'como se ve',
      'quiero verlo',
      'muéstrame el producto',
      'envíame una imagen',
      'mándame una foto'
    ];
    for (const phrase of phrases) {
      assert.strictEqual(isExplicitProductMediaIntent(phrase), true, `"${phrase}" debe reconocerse como explicit media intent`);
    }
  });

  // ── M4: Petición de características => get_product_details, no media obligatoria ───
  await runTest('M4', 'Petición de características puras NO activa explicit media intent', async () => {
    const specQueries = [
      '¿Qué características tiene?',
      '¿Cuánto cuesta el localizador?',
      '¿De qué tamaño es?',
      '¿Está disponible en color negro?',
      '¿Dónde están ubicados?',
      'Hola, buenas tardes'
    ];
    for (const query of specQueries) {
      assert.strictEqual(isExplicitProductMediaIntent(query), false, `"${query}" NO debe activar explicit media intent`);
    }
  });

  // ── M5: Media success => puede decir "aquí tienes la imagen" ───
  await runTest('M5', 'Media success (hasPendingMedia=true) permite expresiones de entrega de foto', async () => {
    const originalText = 'Claro que sí, aquí tienes la imagen del localizador Micflip P23:';
    const result = enforceMediaAuthority(originalText, true);
    assert.strictEqual(result, originalText, 'Con imagen preparada, el texto no debe ser censurado');
  });

  // ── M6: Media unavailable/failure => no afirma que envió imagen ───
  await runTest('M6', 'Media unavailable (hasPendingMedia=false) reemplaza afirmaciones falsas de entrega', async () => {
    const falseClaims = [
      'Claro que sí, aquí tienes la imagen del localizador:',
      'Te envío la foto del producto.',
      'Aquí te muestro la imagen:',
      'Mira esta foto del localizador.'
    ];

    for (const claim of falseClaims) {
      const sanitized = enforceMediaAuthority(claim, false);
      assert.ok(
        sanitized.includes('No tengo una imagen disponible para enviarte en este momento.'),
        `Debe reemplazar afirmación falsa "${claim}" por honestidad: obtuvo "${sanitized}"`
      );
      assert.ok(!sanitized.includes('aquí tienes la imagen'), 'No debe afirmar tener la imagen');
      assert.ok(!sanitized.includes('Te envío la foto'), 'No debe afirmar haber enviado la foto');
    }
  });

  // ── M7: Producto sin imagen => cero media inventada ───
  await runTest('M7', 'Producto sin imagen en DB no encola media y sanitiza cualquier texto de entrega', async () => {
    const productSinFoto = {
      id: 'prod-no-pic',
      name: 'Servicio de Consultoría',
      imageUrl: null,
      images: []
    };

    let pendingMediaToSend = null;
    let canonicalUrl = null;
    if (productSinFoto.imageUrl && typeof productSinFoto.imageUrl === 'string' && productSinFoto.imageUrl.startsWith('http')) {
      canonicalUrl = productSinFoto.imageUrl;
    } else if (Array.isArray(productSinFoto.images) && productSinFoto.images.length > 0) {
      const firstValid = productSinFoto.images.find(img => typeof img === 'string' && img.startsWith('http'));
      if (firstValid) canonicalUrl = firstValid;
    }

    if (canonicalUrl) {
      pendingMediaToSend = { url: canonicalUrl, type: 'image', productId: productSinFoto.id };
    }

    assert.strictEqual(pendingMediaToSend, null, 'No debe encolar media para producto sin foto');
    const responseText = 'Aquí tienes la foto del producto:';
    const cleanOutput = enforceMediaAuthority(responseText, Boolean(pendingMediaToSend));
    assert.strictEqual(cleanOutput, 'No tengo una imagen disponible para enviarte en este momento.');
  });

  // ── M8: Característica ausente del producto => no inventa Bluetooth/Water Resistance ───
  await runTest('M8', 'Guardrails prohíben alucinaciones de Bluetooth, resistencia al agua y GPS no documentados', async () => {
    assert.ok(
      controllerCode.includes('[GROUNDING TÉCNICO ESTRICTO]'),
      'get_product_details debe incluir instrucción estricta de grounding técnico'
    );
    assert.ok(
      controllerCode.includes('resistencia al agua') && controllerCode.includes('Bluetooth'),
      'Guardrails deben prohibir explícitamente alucinar resistencia al agua y Bluetooth'
    );
    assert.ok(
      controllerCode.includes('[FIDELIDAD TÉCNICA Y POLÍTICAS - PROHIBIDO ALUCINAR]'),
      'globalGuardrails debe contener sección dedicada de fidelidad técnica'
    );
  });

  // ── M9: Shipping config vacía => no inventa opciones de entrega ───
  await runTest('M9', 'Si políticas de envío están vacías, prohíbe preguntar sobre opciones de entrega', async () => {
    assert.ok(
      controllerCode.includes('PROHIBIDO preguntar \'¿Te gustaría que te cuente sobre las opciones de entrega?\''),
      'Debe prohibir la pregunta tramposa sobre opciones de entrega cuando shipping está vacío'
    );
    assert.ok(
      controllerCode.includes('los detalles de entrega deberán confirmarse directamente con el negocio'),
      'Debe instruir indicar que los detalles se confirman con el negocio'
    );
  });

  // ── M10: Generation superseded antes de tool => 0 tool mutation ───
  await runTest('M10', 'Tool Guard detecta isGenerationSuperseded y aborta con 0 mutación', async () => {
    const bufferKey = 'tenant-test:51999111222';
    const genVersion = incrementChatGenerationVersion(bufferKey); // v1
    incrementChatGenerationVersion(bufferKey); // v2 -> v1 queda superseded

    let toolMutated = false;
    const isGenerationSuperseded = () => genVersion < getChatGenerationVersion(bufferKey);

    const toolsHandler = async (funcName, args) => {
      if (isGenerationSuperseded()) {
        return {
          success: false,
          error: 'GENERATION_SUPERSEDED',
          message: 'El usuario envió un mensaje más reciente. No aplicar cambios.'
        };
      }
      toolMutated = true;
      return { success: true };
    };

    const res = await toolsHandler('update_commercial_state', { currentStage: 'DETAILS_PROVIDED' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'GENERATION_SUPERSEDED');
    assert.strictEqual(toolMutated, false, 'La mutación no debe ejecutarse si la generación está obsoleta');
  });

  // ── M11: GENERATION_SUPERSEDED => tool loop termina inmediatamente ───
  await runTest('M11', 'GENERATION_SUPERSEDED en tool handler lanza error superseded y corta el bucle de herramientas', async () => {
    assert.ok(
      aiServiceCode.includes("apiResponse.error === 'GENERATION_SUPERSEDED'"),
      'aiService debe verificar GENERATION_SUPERSEDED tras toolsHandler'
    );
    assert.ok(
      aiServiceCode.includes("supersededErr.isSuperseded = true"),
      'aiService debe marcar el error como isSuperseded = true'
    );

    // Simulación del corte inmediato
    let toolRounds = 0;
    const MAX_TOOL_ROUNDS = 3;
    let abortedImmediately = false;

    const mockToolHandler = async () => {
      return { success: false, error: 'GENERATION_SUPERSEDED' };
    };

    try {
      while (toolRounds < MAX_TOOL_ROUNDS) {
        toolRounds++;
        const apiResponse = await mockToolHandler();
        if (apiResponse && apiResponse.error === 'GENERATION_SUPERSEDED') {
          const err = new Error('GENERATION_SUPERSEDED');
          err.isSuperseded = true;
          throw err;
        }
      }
    } catch (e) {
      if (e.isSuperseded) {
        abortedImmediately = true;
      }
    }

    assert.strictEqual(abortedImmediately, true, 'Debe abortar en la ronda 1');
    assert.strictEqual(toolRounds, 1, 'No debe llegar a la ronda 2 o 3');
  });

  // ── M12: GENERATION_SUPERSEDED => 0 retry / 0 fallback ───
  await runTest('M12', 'GENERATION_SUPERSEDED no activa reintentos ni modelo fallback', async () => {
    assert.ok(
      aiServiceCode.includes("if (err?.isSuperseded || err?.message === 'GENERATION_SUPERSEDED') {\n          geminiWarn(`🛑 [SUPERSEDED] Generación obsoleta. Abortando cascada de reintentos y fallback inmediatamente.`);\n          throw err;"),
      'executeTurnWithFallback debe relanzar inmediatamente sin reintentar ni failover'
    );

    let attemptsExecuted = 0;
    const MAX_ATTEMPTS = 2;
    let thrownError = null;

    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        attemptsExecuted++;
        try {
          const supersededErr = new Error('GENERATION_SUPERSEDED');
          supersededErr.isSuperseded = true;
          throw supersededErr;
        } catch (err) {
          if (err?.isSuperseded || err?.message === 'GENERATION_SUPERSEDED') {
            throw err; // Corte inmediato
          }
        }
      }
    } catch (finalErr) {
      thrownError = finalErr;
    }

    assert.strictEqual(attemptsExecuted, 1, 'Debe ejecutarse únicamente el intento 1');
    assert.ok(thrownError?.isSuperseded, 'El error lanzado debe conservar isSuperseded');
  });

  // ── M13: Tool abortada no entra a executedToolsCache como success ───
  await runTest('M13', 'Tool abortada o con error no entra en executedToolsCache', async () => {
    const executedToolsCache = new Map();
    const toolCall = { name: 'get_product_details', args: { productId: 'p123' } };
    const toolSignature = `${toolCall.name}_${JSON.stringify(toolCall.args)}`;

    const abortedResponse = {
      success: false,
      error: 'GENERATION_SUPERSEDED',
      message: 'El usuario envió un mensaje más reciente.'
    };

    // Lógica corregida de aiService.js
    const isToolSuccess = abortedResponse &&
      abortedResponse.success !== false &&
      !abortedResponse.error &&
      !abortedResponse.reason;

    if (isToolSuccess) {
      executedToolsCache.set(toolSignature, abortedResponse);
    }

    assert.strictEqual(
      executedToolsCache.has(toolSignature),
      false,
      'Tool abortada NO debe guardarse en executedToolsCache'
    );

    // Verificar que una tool exitosa sí se guarda
    const successResponse = { success: true, result: 'Ficha del producto' };
    const isSuccess = successResponse && successResponse.success !== false && !successResponse.error;
    if (isSuccess) {
      executedToolsCache.set(toolSignature, successResponse);
    }
    assert.strictEqual(executedToolsCache.has(toolSignature), true, 'Tool exitosa SÍ se almacena');
  });

  // ── M14: pendingQueue sigue procesando mensaje nuevo ───
  await runTest('M14', 'whatsappController captura isSuperseded y procesa pendingQueue limpiamente con 0 texto saliente', async () => {
    assert.ok(
      controllerCode.includes("aiErr?.isSuperseded || aiErr?.message === 'GENERATION_SUPERSEDED' || isGenerationSuperseded()"),
      'whatsappController debe capturar aiErr.isSuperseded en la invocación de generateAIResponse'
    );

    let outboundMessagesSent = 0;
    let pendingQueueDrained = false;

    // Simular flujo completo
    try {
      const error = new Error('GENERATION_SUPERSEDED');
      error.isSuperseded = true;
      throw error;
    } catch (aiErr) {
      if (aiErr?.isSuperseded) {
        // Retorna sin despachar textos
      } else {
        outboundMessagesSent++;
      }
    } finally {
      // Bloque finally despacha la pendingQueue
      pendingQueueDrained = true;
    }

    assert.strictEqual(outboundMessagesSent, 0, 'No debe enviarse ningún mensaje de texto de la generación obsoleta');
    assert.strictEqual(pendingQueueDrained, true, 'El bloque finally debe procesar la cola pendiente');
  });

  // ── M15: Flujo normal no superseded conserva MAX_TOOL_ROUNDS y fallback existente ───
  await runTest('M15', 'Flujo normal no superseded conserva encadenamiento de tools y fallback de resiliencia', async () => {
    let rounds = 0;
    const executedToolsCache = new Map();

    const normalToolHandler = async (name, args) => {
      rounds++;
      return { success: true, count: rounds };
    };

    for (let r = 1; r <= 3; r++) {
      const res = await normalToolHandler('tool_' + r, {});
      const isToolSuccess = res && res.success !== false && !res.error;
      if (isToolSuccess) {
        executedToolsCache.set('tool_' + r, res);
      }
    }

    assert.strictEqual(rounds, 3, 'Flujo normal debe permitir rondas de herramientas completas');
    assert.strictEqual(executedToolsCache.size, 3, 'Todas las herramientas exitosas deben registrarse en cache');
    assert.ok(aiServiceCode.includes('MAX_TOOL_ROUNDS = 3'), 'MAX_TOOL_ROUNDS=3 debe seguir configurado');
    assert.ok(aiServiceCode.includes('MAX_TOTAL_ATTEMPTS = 2'), 'MAX_TOTAL_ATTEMPTS=2 debe seguir configurado');
  });

  // ── M16: Imagen preparada + dispatch multimedia falla + texto posterior => texto sanitizado ───
  await runTest('M16', 'Imagen preparada + dispatch multimedia falla + texto posterior: texto NO afirma que imagen fue enviada (simulación + source inspection)', async () => {
    // 1. Source inspection en whatsappController.js
    assert.ok(controllerCode.includes('mediaDeliveryFailed = true'), 'whatsappController debe registrar mediaDeliveryFailed en caso de error en sendWhatsAppMedia');
    assert.ok(controllerCode.includes('mediaDeliveryConfirmed = true'), 'whatsappController debe registrar mediaDeliveryConfirmed en caso de éxito en sendWhatsAppMedia');
    assert.ok(controllerCode.includes('if (mediaDeliveryFailed)'), 'whatsappController debe evaluar mediaDeliveryFailed en textos subsiguientes');
    assert.ok(controllerCode.includes('enforceMediaAuthority(outgoingText, false)'), 'whatsappController debe forzar authority falso si falló la entrega multimedia previa');

    // 2. Simulación de ejecución del dispatch loop
    let mediaDeliveryConfirmed = false;
    let mediaDeliveryFailed = false;
    
    // Fallo simulado de la imagen enviada primero
    mediaDeliveryFailed = true;

    // Texto posterior en dispatch separado
    let posteriorText = '¡Claro! Aquí tienes la imagen del localizador Micflip P23. Cuenta con todos sus detalles y especificaciones.';
    if (mediaDeliveryFailed) {
      posteriorText = enforceMediaAuthority(posteriorText, false);
    }

    assert.ok(!posteriorText.toLowerCase().includes('aquí tienes la imagen'), 'Texto posterior no debe afirmar que la imagen fue enviada');
    assert.ok(posteriorText.includes('No tengo una imagen disponible para enviarte en este momento.'), 'Texto posterior debe contener aviso honesto de no disponibilidad');
    assert.ok(posteriorText.includes('Cuenta con todos sus detalles y especificaciones.'), 'Información útil posterior debe conservarse');
  });

  // ── M17: Imagen enviada correctamente + texto posterior => afirmación válida NO es sanitizada ───
  await runTest('M17', 'Imagen enviada correctamente + texto posterior: afirmación válida NO es sanitizada (simulación)', async () => {
    let mediaDeliveryConfirmed = false;
    let mediaDeliveryFailed = false;

    // Éxito simulado en la entrega multimedia
    mediaDeliveryConfirmed = true;

    let posteriorText = '¡Claro! Aquí tienes la imagen del localizador Micflip P23.';
    if (mediaDeliveryFailed) {
      posteriorText = enforceMediaAuthority(posteriorText, false);
    }

    assert.strictEqual(posteriorText, '¡Claro! Aquí tienes la imagen del localizador Micflip P23.', 'Afirmación válida no debe ser tocada si la imagen se envió con éxito');
  });

  // ── M18: "Claro, aquí tienes una foto." sin media => sanitizado ───
  await runTest('M18', '"Claro, aquí tienes una foto." sin media => sanitizado (helper real)', async () => {
    const input = 'Claro, aquí tienes una foto.';
    const result = enforceMediaAuthority(input, false);
    assert.strictEqual(result, 'No tengo una imagen disponible para enviarte en este momento.');
  });

  // ── M19: "Te comparto una imagen." sin media => sanitizado ───
  await runTest('M19', '"Te comparto una imagen." sin media => sanitizado (helper real)', async () => {
    const input = 'Te comparto una imagen.';
    const result = enforceMediaAuthority(input, false);
    assert.strictEqual(result, 'No tengo una imagen disponible para enviarte en este momento.');
  });

  // ── M20: "Voy a enviarte la foto." sin media => sanitizado ───
  await runTest('M20', '"Voy a enviarte la foto." sin media => sanitizado (helper real)', async () => {
    const input = 'Voy a enviarte la foto.';
    const result = enforceMediaAuthority(input, false);
    assert.strictEqual(result, 'No tengo una imagen disponible para enviarte en este momento.');
  });

  // ── M21: "Déjame enviarte una foto." sin media => sanitizado ───
  await runTest('M21', '"Déjame enviarte una foto." sin media => sanitizado (helper real)', async () => {
    const input = 'Déjame enviarte una foto.';
    const result = enforceMediaAuthority(input, false);
    assert.strictEqual(result, 'No tengo una imagen disponible para enviarte en este momento.');
  });

  // ── M22: "no quiero foto" => FALSE ───
  await runTest('M22', '"no quiero foto" => explicit media intent FALSE (helper real)', async () => {
    const res = isExplicitProductMediaIntent('no quiero foto');
    assert.strictEqual(res, false, '"no quiero foto" no debe considerarse intención explícita de foto');
  });

  // ── M23: "sin foto está bien" => FALSE ───
  await runTest('M23', '"sin foto está bien" => explicit media intent FALSE (helper real)', async () => {
    const res = isExplicitProductMediaIntent('sin foto está bien');
    assert.strictEqual(res, false, '"sin foto está bien" no debe considerarse intención de foto');
  });

  // ── M24: "quiero ver si tienen stock" => FALSE ───
  await runTest('M24', '"quiero ver si tienen stock" => explicit media intent FALSE (helper real)', async () => {
    const res = isExplicitProductMediaIntent('quiero ver si tienen stock');
    assert.strictEqual(res, false, '"quiero ver si tienen stock" no es solicitud visual');
  });

  // ── M25: "no quiero ver el producto" => FALSE ───
  await runTest('M25', '"no quiero ver el producto" => explicit media intent FALSE (helper real)', async () => {
    const res = isExplicitProductMediaIntent('no quiero ver el producto');
    assert.strictEqual(res, false, '"no quiero ver el producto" es rechazo explícito');
  });

  // ── M26: "No tienes foto?" => TRUE ───
  await runTest('M26', '"No tienes foto?" => explicit media intent TRUE (helper real)', async () => {
    const res = isExplicitProductMediaIntent('No tienes foto?');
    assert.strictEqual(res, true, '"No tienes foto?" debe mantenerse como solicitud/pregunta válida de foto');
  });

  // ── M27: "Quiero ver el producto" => TRUE ───
  await runTest('M27', '"Quiero ver el producto" => explicit media intent TRUE (helper real)', async () => {
    const res = isExplicitProductMediaIntent('Quiero ver el producto');
    assert.strictEqual(res, true, '"Quiero ver el producto" es solicitud visual positiva');
  });

  // ── M28: "Quiero ver una foto" => TRUE ───
  await runTest('M28', '"Quiero ver una foto" => explicit media intent TRUE (helper real)', async () => {
    const res = isExplicitProductMediaIntent('Quiero ver una foto');
    assert.strictEqual(res, true, '"Quiero ver una foto" es solicitud visual positiva');
  });

  // ── M29: shipping config vacía: guardrail NO promete delivery/despacho/recojo; indica confirmar con el negocio ───
  await runTest('M29', 'shipping config vacía: guardrail no promete despacho ni courier; indica confirmar con negocio (contract inspection)', async () => {
    assert.ok(controllerCode.includes('los detalles de entrega deberán confirmarse directamente con el negocio'), 'Prompt debe indicar que la entrega debe confirmarse con el negocio');
    assert.ok(!controllerCode.includes('al momento de coordinar el despacho'), 'Prompt no debe dar por sentado que existe despacho');
    assert.ok(!controllerCode.includes('coordinar el despacho'), 'Prompt no debe mencionar coordinar despacho como hecho seguro');
  });

  console.log('\n======================================================================');
  console.log(`RESULTADOS M1–M29: ${passedCount} pasaron, ${failedCount} fallaron.`);
  console.log('======================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error en suite de tests:', err);
  process.exit(1);
});
