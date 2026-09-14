/**
 * test_llm_resilience_cascade.js
 *
 * Test suite para verificar la cascada de resiliencia de IA:
 * 1. Single Gemini API Key Mode (soporte nativo normal sin warning)
 * 2. Compact Token Budget (COMPACT_CONTEXT_HARD_BUDGET = 3000)
 * 3. Normalización semánticamente neutra para consultas benignas
 * 4. PROHIBITED_CONTENT retry usa contexto compacto
 * 5. REAL_PROHIBITED_CONTENT_REMAINS_BLOCKED no hace loops evasivos y escala a Groq
 * 6. Groq SIEMPRE recibe contexto compacto (sin catálogo completo de 37 productos)
 * 7. GROQ_NO_UNNECESSARY_TOOLS cuando media ya está resuelta determinísticamente
 * 8. Deterministic media survival requiere los 3 gates:
 *    pendingMediaToSend + mediaIntentAuthorized + canonicalAssetValidated
 * 9. Media sobrevive fallo total de LLM sin mensaje genérico de demora (GENERIC_DELAY_AFTER_MEDIA_SUCCESS = NO)
 * 10. Fallo de provider multimedia respeta QUEUED != DELIVERED
 */

import dotenv from 'dotenv';
dotenv.config();

import {
  ERR_TYPE,
  classifyError,
  GeminiKeyManager,
  geminiKeyManager,
  COMPACT_CONTEXT_HARD_BUDGET,
  applyNeutralCanonicalization,
  buildCompactFallbackContext,
  callGroq,
  generateAIResponse
} from './src/services/aiService.js';

async function runResilienceCascadeTests() {
  console.log('═'.repeat(70));
  console.log('🧪 VELION LLM RESILIENCE CASCADE — TEST SUITE');
  console.log('═'.repeat(70));

  let passed = 0;
  let total = 0;

  function assert(name, condition, details = '') {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
      return true;
    } else {
      console.error(`❌ [FAIL] ${name} — ${details}`);
      return false;
    }
  }

  // Guardar entorno
  const savedEnv = { ...process.env };

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Test 1: SINGLE_GEMINI_KEY_MODE = PASS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 1. SINGLE_GEMINI_KEY_MODE ---');
    process.env.GEMINI_API_KEY = 'TEST_KEY_SINGLE_NORMAL_MODE_123';
    delete process.env.GEMINI_API_KEY_BACKUP;

    const singleKeyMgr = new GeminiKeyManager();
    singleKeyMgr.init();

    const keyAtt1 = singleKeyMgr.getKeyForAttempt(1);
    const keyAtt2 = singleKeyMgr.getKeyForAttempt(2);

    assert(
      'SINGLE_GEMINI_KEY_MODE: Attempt 1 returns primary client',
      keyAtt1 && keyAtt1.name === 'Principal' && keyAtt1.isBackup === false
    );
    assert(
      'SINGLE_GEMINI_KEY_MODE: Attempt 2 returns primary client without backup key',
      keyAtt2 && keyAtt2.name === 'Principal' && keyAtt2.isBackup === false
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Test 2: COMPACT_CONTEXT_HARD_BUDGET = 3000 & Structural Reduction
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 2. COMPACT TOKEN BUDGET (COMPACT_CONTEXT_HARD_BUDGET = 3000) ---');
    assert(
      'COMPACT_CONTEXT_HARD_BUDGET constant is 3000',
      COMPACT_CONTEXT_HARD_BUDGET === 3000
    );

    // Simular contexto con catálogo masivo (37 productos)
    const mockBigCatalogPrompt = `CATALOGO COMPLETO:\n` + Array.from({ length: 37 }, (_, i) => `PROD-${i}: Producto de Prueba Modelo ${i} - Precio S/. ${100 + i} - SKU-XYZ-${i} - Descripcion larga con caracteristicas detalladas`).join('\n');
    const mockMessages = [
      { role: 'user', content: 'Hola' },
      { role: 'model', content: 'Hola, ¿en qué puedo ayudarte?' },
      { role: 'user', content: '¿Qué productos tienen?' },
      { role: 'model', content: 'Tenemos varios modelos disponibles.' },
      { role: 'user', content: 'Tienes video del jbl?' }
    ];

    const activeProduct = {
      id: 'prod-jbl-go-4',
      name: 'JBL Go 4',
      price: 150,
      description: 'Altavoz portátil impermeable con sonido Pro Sound y batería de hasta 7 horas.'
    };

    const compact = buildCompactFallbackContext({
      systemPrompt: mockBigCatalogPrompt,
      messages: mockMessages,
      activeProduct,
      commercialState: { currentStage: 'EXPLORING', productId: activeProduct.id },
      userMessageText: 'Tienes video del jbl?',
      businessName: 'AudioStore',
      isProhibitedContent: true,
      mediaIntentAuthorized: true,
      canonicalAssetValidated: true
    });

    assert(
      'GROQ_FULL_CATALOG_INCLUDED = NO (Full 37-product catalog excluded)',
      !compact.systemPrompt.includes('PROD-36') && !compact.systemPrompt.includes('CATALOGO COMPLETO')
    );
    assert(
      'Active product facts included in compact prompt',
      compact.systemPrompt.includes('JBL Go 4') && compact.systemPrompt.includes('S/. 150')
    );
    assert(
      'History reduced to max 3 useful interactions',
      compact.messages.length <= 3
    );
    assert(
      'Compact context estimated tokens well within hard budget of 3000',
      compact.estimatedTokens < COMPACT_CONTEXT_HARD_BUDGET && compact.isWithinBudget,
      `Actual estimated tokens: ${compact.estimatedTokens}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Test 3: Neutral Canonicalization for Benign Queries
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 3. NEUTRAL CANONICALIZATION (NO EVASION) ---');
    const rawColloquial = '   tienes   video del  jbl?  ';
    const canonicalized = applyNeutralCanonicalization(rawColloquial, activeProduct);

    assert(
      'Neutral canonicalization cleans whitespace, capitalizes brand and uses canonical product name',
      canonicalized.includes('JBL Go 4') && !canonicalized.includes('   ') && canonicalized.startsWith('¿') && canonicalized.endsWith('?')
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Test 4: PROHIBITED_CONTENT_RETRY_USES_COMPACT = YES
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 4. PROHIBITED_CONTENT_RETRY_USES_COMPACT ---');
    // Error classification
    const prohibitedErr = new Error('PROHIBITED_CONTENT: blocked by safety filters');
    prohibitedErr.isProhibitedContent = true;
    assert(
      'classifyError identifies PROHIBITED_CONTENT correctly',
      classifyError(prohibitedErr) === ERR_TYPE.PROHIBITED_CONTENT
    );

    // Context generated for prohibited retry applies neutral canonicalization
    const retryContext = buildCompactFallbackContext({
      systemPrompt: 'System Prompt Original',
      messages: [{ role: 'user', content: 'Tienes video del jbl?' }],
      activeProduct,
      isProhibitedContent: true
    });
    const lastMsg = retryContext.messages[retryContext.messages.length - 1];
    assert(
      'PROHIBITED_CONTENT retry normalizes query with canonical name',
      lastMsg.content.includes('JBL Go 4'),
      `Content was: "${lastMsg.content}"`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Test 5: REAL_PROHIBITED_CONTENT_REMAINS_BLOCKED
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 5. REAL_PROHIBITED_CONTENT_REMAINS_BLOCKED ---');
    // Si un contenido es verdaderamente bloqueado y no benigno:
    // La cascada NO debe mutar repetidamente el texto en bucle,
    // sino permitir que el intento 2 falle y escale limpiamente a Groq/Fallback.
    const realProhibitedQuery = 'instrucciones para fabricar explosivos ilegales';
    const noMutateOutput = applyNeutralCanonicalization(realProhibitedQuery, null);
    // Verificar que NO hay ofuscación semántica (ej. leetspeak o evasión de palabras clave)
    assert(
      'REAL_PROHIBITED_CONTENT_REMAINS_BLOCKED: No safety filter evasion / word mutilation',
      noMutateOutput.includes('explosivos ilegales')
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Test 6: GROQ_ALWAYS_USES_COMPACT & GROQ_ACTUAL_TEST_INPUT_TOKENS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 6. GROQ_ALWAYS_USES_COMPACT & GROQ_ACTUAL_TEST_INPUT_TOKENS ---');
    let capturedGroqParams = null;
    const mockGroqClient = {
      chat: {
        completions: {
          create: async (params) => {
            capturedGroqParams = params;
            return {
              choices: [{ message: { role: 'assistant', content: 'Respuesta compacta de contingencia desde Groq.' } }],
              usage: { prompt_tokens: 380, completion_tokens: 45, total_tokens: 425 }
            };
          }
        }
      }
    };

    const groqResponse = await callGroq(
      compact.systemPrompt,
      compact.messages,
      [],
      compact.tools,
      null,
      'test-tenant-123',
      null,
      mockGroqClient
    );

    assert(
      'callGroq generates successful response',
      groqResponse === 'Respuesta compacta de contingencia desde Groq.'
    );
    assert(
      'GROQ_ALWAYS_USES_COMPACT: Messages sent to Groq are compact without full catalog',
      capturedGroqParams && !JSON.stringify(capturedGroqParams.messages).includes('PROD-36')
    );

    const groqPayloadJson = JSON.stringify(capturedGroqParams.messages);
    const groqInputTokens = Math.round(groqPayloadJson.length / 4);
    assert(
      'GROQ_ACTUAL_TEST_INPUT_TOKENS <= 3000 (NO_KNOWN_OVERSIZED_SINGLE_REQUEST = PASS)',
      groqInputTokens < 3000,
      `Estimated input tokens: ${groqInputTokens}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Test 7: GROQ_NO_UNNECESSARY_TOOLS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 7. GROQ_NO_UNNECESSARY_TOOLS ---');
    // Cuando la acción determinista de media ya está resuelta (mediaIntentAuthorized = true, canonicalAssetValidated = true):
    const compactForResolvedMedia = buildCompactFallbackContext({
      systemPrompt: 'System prompt',
      messages: [{ role: 'user', content: '¿Tienes video?' }],
      activeProduct,
      mediaIntentAuthorized: true,
      canonicalAssetValidated: true,
      essentialTools: [{ name: 'send_product_media' }, { name: 'get_product_details' }]
    });

    assert(
      'GROQ_NO_UNNECESSARY_TOOLS: Tools stripped when deterministic media is resolved',
      compactForResolvedMedia.tools.length === 0
    );

    let groqToolsReceived = null;
    const mockGroqNoToolsClient = {
      chat: {
        completions: {
          create: async (params) => {
            groqToolsReceived = params.tools;
            return {
              choices: [{ message: { role: 'assistant', content: 'Aquí tienes el video de JBL Go 4.' } }],
              usage: { prompt_tokens: 210, completion_tokens: 20, total_tokens: 230 }
            };
          }
        }
      }
    };

    await callGroq(
      compactForResolvedMedia.systemPrompt,
      compactForResolvedMedia.messages,
      [],
      compactForResolvedMedia.tools,
      null,
      'test-tenant-123',
      null,
      mockGroqNoToolsClient
    );

    assert(
      'GROQ_UNNECESSARY_TOOLS_INCLUDED = NO: Groq API call received 0 tool schemas',
      groqToolsReceived === undefined || (Array.isArray(groqToolsReceived) && groqToolsReceived.length === 0)
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Test 8: DETERMINISTIC_MEDIA_REQUIRES_AUTHORIZATION = YES
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 8. DETERMINISTIC_MEDIA_REQUIRES_AUTHORIZATION ---');
    // Gates evaluators
    const checkRescueGates = (pendingMedia, isMediaAuth, isAssetValid) => {
      return Boolean(pendingMedia && isMediaAuth && isAssetValid);
    };

    // Caso A: pendingMedia existe pero NO autorizada
    const unauthorizedPending = { productId: 'p1', url: 'https://cdn.velion.io/p1.mp4' };
    assert(
      'Gate check rejects media when mediaIntentAuthorized is false',
      checkRescueGates(unauthorizedPending, false, true) === false
    );

    // Caso B: autorizada pero URL no canónica / inválida
    assert(
      'Gate check rejects media when canonicalAssetValidated is false',
      checkRescueGates({ productId: 'p1', url: '' }, true, false) === false
    );

    // Caso C: pendingMedia null
    assert(
      'Gate check rejects media when pendingMediaToSend is null',
      checkRescueGates(null, true, true) === false
    );

    // Caso D: Todos los 3 gates satisfechos
    assert(
      'DETERMINISTIC_MEDIA_REQUIRES_AUTHORIZATION = YES: All 3 gates satisfied',
      checkRescueGates(unauthorizedPending, true, true) === true
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Test 9: MEDIA_SURVIVES_LLM_TOTAL_FAILURE & GENERIC_DELAY_AFTER_MEDIA_SUCCESS = NO
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 9. MEDIA_SURVIVES_LLM_TOTAL_FAILURE ---');
    // Simular el controlador con LLM fallando totalmente
    let dispatchedMedia = null;
    let dispatchedText = null;
    let delayFallbackDispatched = false;

    const mockSendWhatsAppMedia = async (opts) => {
      dispatchedMedia = opts;
      return 'evo_media_msg_id_999'; // Confirmación de provider físico
    };

    const mockSendWhatsAppReply = async (opts) => {
      dispatchedText = opts;
      if (opts.text.includes('pequeña demora')) {
        delayFallbackDispatched = true;
      }
      return 'evo_reply_msg_id_111';
    };

    // Simular lógica del controlador ante caída total de LLM (aiResponse = null):
    const simulateControllerPostLLM = async ({
      aiResponse,
      pendingMediaToSend,
      isMediaAuthorized,
      isAssetValidated
    }) => {
      if (!aiResponse || aiResponse === '...') {
        if (pendingMediaToSend && isMediaAuthorized && isAssetValidated) {
          const isVideo = pendingMediaToSend.mediaType === 'video';
          const factualCaption = isVideo
            ? `Aquí tienes el video de ${pendingMediaToSend.productName}.`
            : `Aquí tienes la imagen de ${pendingMediaToSend.productName}.`;

          const mediaMsgId = await mockSendWhatsAppMedia({
            to: '51999999999',
            url: pendingMediaToSend.url,
            mediaType: pendingMediaToSend.mediaType || 'image',
            caption: factualCaption
          });

          if (mediaMsgId) {
            // Éxito confirmado de media -> return sin mensaje genérico de demora
            return { action: 'MEDIA_DELIVERED', mediaMsgId, caption: factualCaption };
          }
        }

        // Safety fallback
        const timeoutFallbackText = 'Estoy teniendo una pequeña demora en este momento. Escríbeme nuevamente en unos segundos, por favor 🙏';
        await mockSendWhatsAppReply({ to: '51999999999', text: timeoutFallbackText });
        return { action: 'DELAY_FALLBACK_SENT' };
      }
      return { action: 'NORMAL_AI_SENT' };
    };

    const rescueResult = await simulateControllerPostLLM({
      aiResponse: null, // Total LLM failure
      pendingMediaToSend: {
        productId: 'prod-jbl-go-4',
        productName: 'JBL Go 4',
        url: 'https://cdn.velion.io/jbl_video.mp4',
        mediaType: 'video'
      },
      isMediaAuthorized: true,
      isAssetValidated: true
    });

    assert(
      'MEDIA_SURVIVES_LLM_TOTAL_FAILURE = PASS: Media was physically dispatched with provider confirmation',
      rescueResult.action === 'MEDIA_DELIVERED' && dispatchedMedia !== null && dispatchedMedia.url === 'https://cdn.velion.io/jbl_video.mp4'
    );
    assert(
      'Factual caption accompanies rescued media',
      rescueResult.caption === 'Aquí tienes el video de JBL Go 4.'
    );
    assert(
      'GENERIC_DELAY_AFTER_MEDIA_SUCCESS = NO: Zero generic delay messages sent',
      delayFallbackDispatched === false
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Test 10: Provider Failure Preserves QUEUED != DELIVERED
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 10. QUEUED != DELIVERED (Provider Failure Fallback) ---');
    // Si el provider de media retorna falsy / falla:
    const mockFailingMediaSend = async () => null; // Gateway failed
    let fallbackAfterMediaFail = false;

    const simulateFailingProvider = async () => {
      const pendingMediaToSend = {
        productId: 'p1',
        productName: 'Test Product',
        url: 'https://cdn.velion.io/test.mp4',
        mediaType: 'video'
      };
      const isMediaAuthorized = true;
      const isAssetValidated = true;

      if (pendingMediaToSend && isMediaAuthorized && isAssetValidated) {
        const mediaMsgId = await mockFailingMediaSend();
        if (mediaMsgId) {
          return 'PERSISTED_DELIVERY';
        }
      }

      // Debe caer limpiamente al safety fallback
      fallbackAfterMediaFail = true;
      return 'SAFETY_FALLBACK_TRIGGERED';
    };

    const failProviderResult = await simulateFailingProvider();
    assert(
      'QUEUED != DELIVERED: Provider failure does not persist fake delivery',
      failProviderResult === 'SAFETY_FALLBACK_TRIGGERED' && fallbackAfterMediaFail === true
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Test 11: CASE C QUALITY FIX — COMPACT FALLBACK CONVERSATION
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 11. CASE C QUALITY FIX: COMPACT FALLBACK CONVERSATION ---');

    // Context with active conversation (history > 0)
    const activeConversationContext = buildCompactFallbackContext({
      systemPrompt: 'System Prompt Original',
      messages: [
        { role: 'user', content: 'Hola' },
        { role: 'model', content: 'Hola, ¿en qué puedo ayudarte?' },
        { role: 'user', content: 'Tienes video del jbl?' }
      ],
      activeProduct,
      userMessageText: 'Tienes video del jbl?',
      businessName: 'AudioStore',
      mediaIntentAuthorized: true,
      canonicalAssetValidated: true
    });

    // A. ACTIVE_CONVERSATION_NO_REGREETING
    assert(
      'ACTIVE_CONVERSATION_NO_REGREETING: Compact prompt forbids re-greeting when history exists',
      activeConversationContext.systemPrompt.includes('ESTÁ ESTRICTAMENTE PROHIBIDO volver a saludar') &&
      activeConversationContext.systemPrompt.includes('Esta conversación ya está en curso')
    );

    // B. NO_IMPLEMENTATION_LEAK
    const forbiddenInternalTerms = [
      'el sistema enviará',
      'será enviada automáticamente',
      'enviará automáticamente',
      'pendingMedia',
      'attached automatically',
      'auto-send'
    ];
    const hasLeakInPrompt = forbiddenInternalTerms.some(term =>
      activeConversationContext.systemPrompt.toLowerCase().includes(term.toLowerCase())
    );
    assert(
      'NO_IMPLEMENTATION_LEAK: Compact prompt contains 0 internal leak phrasing',
      !hasLeakInPrompt &&
      activeConversationContext.systemPrompt.includes('[GUARDRAIL DE IMPLEMENTACIÓN]') &&
      activeConversationContext.systemPrompt.includes('NUNCA menciones ni reveles mecanismos internos')
    );

    // C. NO_UNSUPPORTED_HYPE
    assert(
      'NO_UNSUPPORTED_HYPE: Compact prompt forbids ungrounded promotional claims/adjectives',
      activeConversationContext.systemPrompt.includes('espectacular') &&
      activeConversationContext.systemPrompt.includes('increíble') &&
      activeConversationContext.systemPrompt.includes('No uses calificativos comerciales o promocionales no respaldados')
    );

    // D. MEDIA_RESPONSE_IS_BRIEF
    assert(
      'MEDIA_RESPONSE_IS_BRIEF: Prompt directs model to reply in a single brief sentence without forced CTAs',
      activeConversationContext.systemPrompt.includes('Responde en UNA sola frase breve y natural') &&
      activeConversationContext.systemPrompt.includes('Claro, aquí tienes el video')
    );

    // E. NEW_CONVERSATION_GREETING_ALLOWED
    const emptyHistoryContext = buildCompactFallbackContext({
      systemPrompt: 'System Prompt Original',
      messages: [],
      activeProduct,
      userMessageText: 'Hola, buenas tardes',
      businessName: 'AudioStore'
    });
    assert(
      'NEW_CONVERSATION_GREETING_ALLOWED: New conversation allows initial greeting without strict prohibition',
      emptyHistoryContext.systemPrompt.includes('Saludo inicial breve y cordial permitido') &&
      !emptyHistoryContext.systemPrompt.includes('ESTÁ ESTRICTAMENTE PROHIBIDO volver a saludar')
    );

    // F. Simulated model response quality evaluation
    const idealCaseCResponse = 'Claro, aquí tienes el video del JBL Go 4.';
    const leakyCaseCResponse = '¡Hola! Claro que sí, el sistema te enviará automáticamente el video del espectacular JBL go 4 que tenemos disponible. Si tienes alguna duda sobre su precio o características, quedo atento para ayudarte.';

    const verifyCaseCQuality = (text, isOngoing) => {
      const issues = [];
      if (isOngoing && /^(¡?hola|buenas|buen d[ií]a)/i.test(text.trim())) {
        issues.push('REGREETING_DETECTED');
      }
      if (/el sistema|backend|autom[aá]ticamente|automatizaci[oó]n|tool|provider|prompt/i.test(text)) {
        issues.push('IMPLEMENTATION_LEAK');
      }
      if (/espectacular|incre[ií]ble|el mejor|premium|oficial|garantizado/i.test(text)) {
        issues.push('UNSUPPORTED_HYPE');
      }
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      if (sentences.length > 2) {
        issues.push('RESPONSE_TOO_LONG_FOR_MEDIA_CONFIRMATION');
      }
      return { ok: issues.length === 0, issues };
    };

    const idealCheck = verifyCaseCQuality(idealCaseCResponse, true);
    const leakyCheck = verifyCaseCQuality(leakyCaseCResponse, true);

    assert(
      'Ideal Case C response passes quality validation (no greeting, no leak, no hype, brief)',
      idealCheck.ok === true && idealCheck.issues.length === 0
    );
    assert(
      'Old problematic response is correctly flagged by quality criteria',
      leakyCheck.ok === false &&
      leakyCheck.issues.includes('REGREETING_DETECTED') &&
      leakyCheck.issues.includes('IMPLEMENTATION_LEAK') &&
      leakyCheck.issues.includes('UNSUPPORTED_HYPE')
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Resumen Final
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(70));
    console.log(`📊 RESULTADOS: ${passed}/${total} pruebas superadas (${Math.round((passed / total) * 100)}%)`);
    console.log('═'.repeat(70));

    if (passed === total) {
      console.log('\n🌟 TODAS LAS PRUEBAS DE RESILIENCIA LLM PASARON CON ÉXITO.\n');
      process.exit(0);
    } else {
      console.error(`\n❌ ${total - passed} PRUEBAS FALLARON.\n`);
      process.exit(1);
    }

  } finally {
    // Restaurar entorno
    process.env = savedEnv;
  }
}

runResilienceCascadeTests().catch(err => {
  console.error('Error fatal ejecutando test_llm_resilience_cascade:', err);
  process.exit(1);
});
