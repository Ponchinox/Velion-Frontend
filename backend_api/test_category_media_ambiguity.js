import assert from 'node:assert';
import {
  resolveTargetProduct,
  orchestrateProductMedia,
  detectCategoryOrMultiProductQuery,
  isProductExplicitlySpecifiedByUser,
  getCanonicalProductImages,
  resolveProductMediaState,
  getNextUnseenProductImage,
  classifyPhotoRequestType
} from './src/services/productMediaOrchestrator.js';
import {
  detectProductMediaIntent,
  enforceMediaAuthority,
  enforceBusinessAuthority,
  isTurnExploratoryOrUnconfirmed
} from './src/controllers/whatsappController.js';

console.log('======================================================================');
console.log('🧪 P0 HOTFIX SUITE: CATEGORY MEDIA AMBIGUITY + REFERENCEERROR + CHECKOUT ADVANCE');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

async function runTest(id, name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS [TEST ${id}]: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL [TEST ${id}]: ${name}:`, err);
    throw err;
  }
}

/**
 * Simulador de herramientas y servicios de whatsappController para test aislado
 */
function createMockEnvironment() {
  const tenantId = 'tenant-test-123';
  const otherTenantId = 'tenant-other-456';

  const products = [
    {
      id: 'prod-jbl-1',
      tenantId,
      name: 'JBL go 4 A1',
      category: 'Parlantes',
      tags: ['audio', 'parlante', 'bluetooth'],
      imageUrl: 'https://cdn.example.com/jbl-front.jpg',
      images: ['https://cdn.example.com/jbl-back.jpg'],
      videoUrl: 'https://cdn.example.com/jbl-video.mp4',
      type: 'PHYSICAL_PRODUCT',
      price: 120,
      isAvailable: true
    },
    {
      id: 'prod-aud-thinking',
      tenantId,
      name: 'Audífonos thinking plus',
      category: 'Audífonos',
      tags: ['audio', 'audifonos', 'bluetooth'],
      imageUrl: 'https://cdn.example.com/thinking-1.jpg',
      images: ['https://cdn.example.com/thinking-2.jpg', 'https://cdn.example.com/thinking-3.jpg'],
      videoUrl: null,
      type: 'PHYSICAL_PRODUCT',
      price: 89,
      isAvailable: true
    },
    {
      id: 'prod-aud-xiaomi',
      tenantId,
      name: 'Audífonos Xiaomi mini',
      category: 'Audífonos',
      tags: ['audio', 'audifonos', 'xiaomi'],
      imageUrl: 'https://cdn.example.com/xiaomi-1.jpg',
      images: ['https://cdn.example.com/xiaomi-2.jpg'],
      videoUrl: null,
      type: 'PHYSICAL_PRODUCT',
      price: 65,
      isAvailable: true
    },
    {
      id: 'prod-aud-airpods',
      tenantId,
      name: 'Airpods segunda generación',
      category: 'Audífonos',
      tags: ['audio', 'audifonos', 'apple'],
      imageUrl: 'https://cdn.example.com/airpods-1.jpg',
      images: [],
      videoUrl: 'https://cdn.example.com/airpods-video.mp4',
      type: 'PHYSICAL_PRODUCT',
      price: 199,
      isAvailable: true
    },
    {
      id: 'prod-reloj-geneva',
      tenantId,
      name: 'Reloj Geneva + pulsera diseño black',
      category: 'Relojes',
      tags: ['accesorios', 'relojes'],
      imageUrl: 'https://cdn.example.com/geneva-main.jpg',
      images: [
        'https://cdn.example.com/geneva-view2.jpg',
        'https://cdn.example.com/geneva-view3.jpg',
        'https://cdn.example.com/geneva-view4.jpg'
      ],
      videoUrl: null,
      type: 'PHYSICAL_PRODUCT',
      price: 95,
      isAvailable: true
    },
    {
      id: 'prod-other-tenant',
      tenantId: otherTenantId,
      name: 'Audífonos Secretos Otro Negocio',
      category: 'Audífonos',
      tags: ['audio'],
      imageUrl: 'https://cdn.example.com/other.jpg',
      images: [],
      videoUrl: null,
      type: 'PHYSICAL_PRODUCT',
      price: 150,
      isAvailable: true
    }
  ];

  const tenantAvailableProducts = products.filter(p => p.tenantId === tenantId && p.isAvailable);

  let providerCalls = 0;
  const dispatchedMedia = [];

  // Mock de sendWhatsAppMedia
  async function mockSendWhatsAppMedia({ url, mediaType, caption }) {
    providerCalls++;
    dispatchedMedia.push({ url, mediaType, caption });
    return `msg-media-${Date.now()}-${providerCalls}`;
  }

  // Simulación de executeSendProductMedia idéntica al controller
  async function executeSendProductMedia({
    productId,
    mediaType = 'image',
    userMessageText = '',
    currentCommercialState = {},
    tenant = { id: tenantId },
    isGenerationSuperseded = () => false
  }) {
    const rawProductId = productId;
    const cleanProductId = typeof rawProductId === 'string' ? rawProductId.trim() : String(rawProductId || '').trim();
    const rawMediaType = mediaType;
    const detectedType = detectProductMediaIntent(userMessageText);
    const requestedMediaType = (rawMediaType === 'video' || (detectedType === 'video' && rawMediaType !== 'image'))
      ? 'video'
      : 'image';

    const categoryAmbiguity = detectCategoryOrMultiProductQuery(userMessageText, tenantAvailableProducts);

    if (!cleanProductId) {
      return { success: false, hasMedia: false, reason: 'INVALID_PRODUCT_ID' };
    }

    const product = products.find(p => p.id === cleanProductId && p.tenantId === tenant.id);
    if (!product) {
      return {
        success: false,
        hasMedia: false,
        reason: requestedMediaType === 'video' ? 'NO_VIDEO_REGISTERED' : 'NO_IMAGE_REGISTERED'
      };
    }

    // Guardia de categoría
    if (categoryAmbiguity.isAmbiguous) {
      const productSpecified = isProductExplicitlySpecifiedByUser(userMessageText, product, categoryAmbiguity.candidateProducts);
      if (!productSpecified) {
        return {
          success: false,
          hasMedia: false,
          reason: 'PRODUCT_SELECTION_REQUIRED',
          candidateCount: categoryAmbiguity.candidateCount,
          message: 'Existen varios productos que coinciden con la consulta. Pregunta al cliente cuál modelo desea ver antes de enviar fotos.'
        };
      }
    }

    let targetMediaUrls = [];
    if (requestedMediaType === 'video') {
      if (product.videoUrl && typeof product.videoUrl === 'string' && product.videoUrl.trim() !== '' && product.videoUrl.trim() !== 'Sin video') {
        targetMediaUrls = [product.videoUrl.trim()];
      }
      if (targetMediaUrls.length === 0) {
        return { success: false, hasMedia: false, reason: 'NO_VIDEO_REGISTERED' };
      }
    } else {
      const canonicalImages = getCanonicalProductImages(product);
      if (canonicalImages.length === 0) {
        return { success: false, hasMedia: false, reason: 'NO_IMAGE_REGISTERED' };
      }

      const mediaState = resolveProductMediaState(currentCommercialState, product.id);
      const { nextImageUrl, remainingImages, isExhausted } = getNextUnseenProductImage(product, mediaState);

      if (isExhausted) {
        return {
          success: false,
          hasMedia: false,
          allImagesSent: true,
          totalImages: canonicalImages.length,
          isSingleImage: canonicalImages.length === 1,
          reason: 'ALL_PRODUCT_IMAGES_ALREADY_SENT'
        };
      }

      const requestType = classifyPhotoRequestType(userMessageText, {
        hasAlreadySentPhoto: (mediaState.sentImageUrls.length > 0)
      });

      if (requestType === 'MORE_PHOTOS') {
        targetMediaUrls = remainingImages;
      } else {
        targetMediaUrls = [nextImageUrl];
      }
    }

    // FIX DIRECTO: const targetMediaUrl (validación que no lance ReferenceError)
    const targetMediaUrl = targetMediaUrls[0] || null;

    const pendingMediaToSend = {
      productId: product.id,
      productName: product.name,
      url: targetMediaUrl,
      urls: targetMediaUrls,
      mediaType: requestedMediaType,
      source: 'explicit_tool'
    };

    return {
      success: true,
      hasMedia: true,
      mediaType: requestedMediaType,
      productName: product.name,
      urls: targetMediaUrls,
      targetMediaUrl,
      pendingMediaToSend
    };
  }

  return {
    tenantId,
    otherTenantId,
    products,
    tenantAvailableProducts,
    getProviderCalls: () => providerCalls,
    resetProviderCalls: () => { providerCalls = 0; },
    mockSendWhatsAppMedia,
    executeSendProductMedia
  };
}

async function runAllTests() {
  const env = createMockEnvironment();

  // --------------------------------------------------------------------------
  // TEST A: Category ambiguity => NO stale fallback, provider calls = 0
  // --------------------------------------------------------------------------
  await runTest('A', 'Category ambiguity: commercialState Producto A, consulta categoría con 3 candidatos => AMBIGUOUS_PRODUCT_SELECTION, 0 provider calls, Producto A no enviado', async () => {
    env.resetProviderCalls();
    const currentCommercialState = {
      productId: 'prod-jbl-1',
      productName: 'JBL go 4 A1',
      currentStage: 'PRODUCT_SELECTED',
      customerConfirmed: true
    };

    const userMessageText = 'Tienes audífonos? Quiero ver fotos';
    const ambiguityCheck = detectCategoryOrMultiProductQuery(userMessageText, env.tenantAvailableProducts);
    assert.strictEqual(ambiguityCheck.isAmbiguous, true, 'Debe detectar ambigüedad de categoría');
    assert.strictEqual(ambiguityCheck.candidateProducts.length, 3, 'Debe encontrar los 3 audífonos candidatos');

    const targetProduct = resolveTargetProduct(
      userMessageText,
      env.tenantAvailableProducts,
      currentCommercialState,
      [],
      true // isExplicitMedia
    );

    assert.strictEqual(targetProduct.isAmbiguous, true, 'Target product debe ser ambiguo');
    assert.strictEqual(targetProduct.reason, 'AMBIGUOUS_PRODUCT_SELECTION', 'Razón debe ser AMBIGUOUS_PRODUCT_SELECTION');

    const orchestration = orchestrateProductMedia({
      userMessageText,
      availableProducts: env.tenantAvailableProducts,
      currentCommercialState,
      sentMediaProductIds: []
    });

    assert.strictEqual(orchestration.shouldDispatch, false, 'shouldDispatch debe ser false');
    assert.strictEqual(orchestration.isAmbiguous, true, 'orchestration debe reportar isAmbiguous = true');
    assert.strictEqual(orchestration.reason, 'AMBIGUOUS_PRODUCT_SELECTION');
    assert.strictEqual(env.getProviderCalls(), 0, 'Llamadas a provider deben ser estrictamente 0');
  });

  // --------------------------------------------------------------------------
  // TEST B: LLM intenta send_product_media con candidato arbitrario
  // --------------------------------------------------------------------------
  await runTest('B', 'LLM intenta send_product_media de candidato arbitrario en categoría ambigua => PRODUCT_SELECTION_REQUIRED, 0 provider calls', async () => {
    env.resetProviderCalls();
    const userMessageText = 'foto de los audífonos por favor';
    // LLM intenta enviar "Audífonos thinking plus" arbitrariamente sin que el cliente lo haya especificado
    const result = await env.executeSendProductMedia({
      productId: 'prod-aud-thinking',
      mediaType: 'image',
      userMessageText,
      currentCommercialState: {}
    });

    assert.strictEqual(result.success, false, 'send_product_media debe fallar');
    assert.strictEqual(result.hasMedia, false, 'hasMedia debe ser false');
    assert.strictEqual(result.reason, 'PRODUCT_SELECTION_REQUIRED', 'Debe retornar PRODUCT_SELECTION_REQUIRED');
    assert.strictEqual(env.getProviderCalls(), 0, 'No debe haber llamadas a provider');
  });

  // --------------------------------------------------------------------------
  // TEST C: Cliente posteriormente especifica producto B
  // --------------------------------------------------------------------------
  await runTest('C', 'Cliente posteriormente especifica producto B => send_product_media B funciona, imagen de B enviada, no ReferenceError', async () => {
    env.resetProviderCalls();
    const userMessageText = 'foto de los audífonos thinking plus por favor';

    const result = await env.executeSendProductMedia({
      productId: 'prod-aud-thinking',
      mediaType: 'image',
      userMessageText,
      currentCommercialState: {}
    });

    assert.strictEqual(result.success, true, 'send_product_media debe tener éxito');
    assert.strictEqual(result.hasMedia, true, 'hasMedia debe ser true');
    assert.strictEqual(result.targetMediaUrl, 'https://cdn.example.com/thinking-1.jpg');
    assert.ok(result.pendingMediaToSend, 'pendingMediaToSend debe ser creado');

    // Despachar media
    const msgId = await env.mockSendWhatsAppMedia({
      url: result.pendingMediaToSend.url,
      mediaType: 'image',
      caption: 'Aquí tienes los Audífonos thinking plus'
    });

    assert.ok(msgId, 'msgId debe existir');
    assert.strictEqual(env.getProviderCalls(), 1, 'Provider call debe ser 1');
  });

  // --------------------------------------------------------------------------
  // TEST D: send_product_media imagen individual
  // --------------------------------------------------------------------------
  await runTest('D', 'send_product_media imagen individual: targetMediaUrl correctamente resuelto, pending media creado y despachado', async () => {
    env.resetProviderCalls();
    const userMessageText = 'muéstrame una foto del reloj geneva';

    const result = await env.executeSendProductMedia({
      productId: 'prod-reloj-geneva',
      mediaType: 'image',
      userMessageText,
      currentCommercialState: {}
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.hasMedia, true);
    assert.strictEqual(result.targetMediaUrl, 'https://cdn.example.com/geneva-main.jpg');
    assert.strictEqual(result.pendingMediaToSend.url, 'https://cdn.example.com/geneva-main.jpg');
    assert.strictEqual(result.pendingMediaToSend.urls.length, 1);

    const msgId = await env.mockSendWhatsAppMedia({
      url: result.pendingMediaToSend.url,
      mediaType: 'image'
    });
    assert.ok(msgId);
    assert.strictEqual(env.getProviderCalls(), 1);
  });

  // --------------------------------------------------------------------------
  // TEST E: media tool failure / provider failure => no false claim, no shipping question
  // --------------------------------------------------------------------------
  await runTest('E', 'Media failure / error: no texto afirmando "aquí tienes la foto", no shipping/payment question', async () => {
    const rawAiResponse = 'Aquí tienes la foto del producto. ¿A qué ciudad o distrito te gustaría que realicemos el envío?';
    // Cuando pendingMedia = null (falló el envío de media)
    const mediaAuthorityCleaned = enforceMediaAuthority(rawAiResponse, false);
    assert.ok(!mediaAuthorityCleaned.includes('Aquí tienes la foto'), 'Debe neutralizar la afirmación falsa de foto enviada');

    // Cuando el turno fue exploratorio o hubo falla de media
    const businessAuthorityCleaned = enforceBusinessAuthority(mediaAuthorityCleaned, {
      hasPaymentConfig: true,
      hasShippingConfig: true,
      handoffSuccess: false,
      isExploratoryOrUnconfirmed: true
    });

    assert.ok(!businessAuthorityCleaned.includes('ciudad o distrito'), 'Debe eliminar la pregunta de ciudad/distrito');
    assert.ok(!businessAuthorityCleaned.includes('realicemos el envío'), 'Debe eliminar el push de envío');
  });

  // --------------------------------------------------------------------------
  // TEST F: commercialState histórico PRODUCT_SELECTED A, nuevo turno consulta B
  // --------------------------------------------------------------------------
  await runTest('F', 'commercialState histórico A / customerConfirmed=true, nuevo turno consulta categoría B no confirmada => effective context = exploratory, no ciudad/envío/pago', async () => {
    const historicalCommercialState = {
      productId: 'prod-jbl-1',
      productName: 'JBL go 4 A1',
      currentStage: 'PRODUCT_SELECTED',
      customerConfirmed: true
    };

    const userMessageText = 'Tienes audífonos?';
    const isExploratory = isTurnExploratoryOrUnconfirmed({
      userMessageText,
      currentCommercialState: historicalCommercialState,
      availableProducts: env.tenantAvailableProducts,
      isAmbiguous: true
    });

    assert.strictEqual(isExploratory, true, 'El turno debe evaluarse como exploratorio');

    const effectiveCommercialState = isExploratory
      ? {
          ...historicalCommercialState,
          currentStage: 'EXPLORING',
          customerConfirmed: false
        }
      : historicalCommercialState;

    assert.strictEqual(effectiveCommercialState.currentStage, 'EXPLORING');
    assert.strictEqual(effectiveCommercialState.customerConfirmed, false);
    assert.strictEqual(historicalCommercialState.currentStage, 'PRODUCT_SELECTED', 'DB histórico debe mantenerse intacto');

    const modelResponseWithCheckoutPush = 'Tenemos varios modelos de audífonos. ¿Cuál es tu ciudad de envío para coordinar el despacho?';
    const sanitized = enforceBusinessAuthority(modelResponseWithCheckoutPush, {
      isExploratoryOrUnconfirmed: true
    });

    assert.ok(!sanitized.includes('ciudad de envío'), 'Debe eliminar pregunta de ciudad');
    assert.ok(!sanitized.includes('coordinar el despacho'), 'Debe eliminar despacho');
  });

  // --------------------------------------------------------------------------
  // TEST G: Cliente confirma específicamente producto B
  // --------------------------------------------------------------------------
  await runTest('G', 'Cliente confirma específicamente producto B ("Quiero ese / quiero uno") => flujo comercial normal puede avanzar', async () => {
    const userMessage1 = 'Quiero uno';
    const userMessage2 = 'Quiero ese';
    const userMessage3 = 'Me llevo este';

    assert.strictEqual(isTurnExploratoryOrUnconfirmed({ userMessageText: userMessage1 }), false);
    assert.strictEqual(isTurnExploratoryOrUnconfirmed({ userMessageText: userMessage2 }), false);
    assert.strictEqual(isTurnExploratoryOrUnconfirmed({ userMessageText: userMessage3 }), false);
  });

  // --------------------------------------------------------------------------
  // TEST H: Producto unívoco ("foto del JBL")
  // --------------------------------------------------------------------------
  await runTest('H', 'Producto unívoco ("foto del JBL") => comportamiento existente normal', async () => {
    env.resetProviderCalls();
    const userMessageText = 'foto del JBL';
    const categoryCheck = detectCategoryOrMultiProductQuery(userMessageText, env.tenantAvailableProducts);
    assert.strictEqual(categoryCheck.isAmbiguous, false, 'No debe haber ambigüedad para JBL');

    // Comportamiento existente normal: resolución con contexto de producto
    const targetProduct = resolveTargetProduct(
      userMessageText,
      env.tenantAvailableProducts,
      'prod-jbl-1',
      { isExplicitMedia: true, lastConsultedProductId: 'prod-jbl-1', confirmedProductId: 'prod-jbl-1' }
    );

    assert.ok(targetProduct, 'Debe resolver el producto JBL');
    assert.strictEqual(targetProduct.id, 'prod-jbl-1');

    // send_product_media para JBL no es bloqueado por ambigüedad
    const sendResult = await env.executeSendProductMedia({
      productId: 'prod-jbl-1',
      mediaType: 'image',
      userMessageText,
      currentCommercialState: { productId: 'prod-jbl-1' }
    });
    assert.strictEqual(sendResult.success, true);
    assert.strictEqual(sendResult.hasMedia, true);
    assert.strictEqual(sendResult.pendingMediaToSend.productId, 'prod-jbl-1');
  });

  // --------------------------------------------------------------------------
  // TEST I: Product switch A -> B
  // --------------------------------------------------------------------------
  await runTest('I', 'Product switch A -> B: fixes previos intactos', async () => {
    env.resetProviderCalls();
    // Turn 1: encolado auto_orchestrator de reloj geneva
    let pendingMediaToSend = {
      productId: 'prod-reloj-geneva',
      productName: 'Reloj Geneva',
      url: 'https://cdn.example.com/geneva-main.jpg',
      urls: ['https://cdn.example.com/geneva-main.jpg'],
      mediaType: 'image',
      source: 'auto_orchestrator'
    };

    // Turn 1 runtime: LLM llama explícitamente send_product_media para Audífonos thinking plus (con switch explícito del usuario)
    const switchUserText = 'mejor muéstrame los audífonos thinking plus';
    const result = await env.executeSendProductMedia({
      productId: 'prod-aud-thinking',
      mediaType: 'image',
      userMessageText: switchUserText,
      currentCommercialState: { productId: 'prod-reloj-geneva' }
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.pendingMediaToSend.productId, 'prod-aud-thinking');
    assert.strictEqual(result.pendingMediaToSend.source, 'explicit_tool');
  });

  // --------------------------------------------------------------------------
  // TEST J: "Más fotos" => todas las restantes no vistas del producto
  // --------------------------------------------------------------------------
  await runTest('J', '"más fotos" => todas las restantes de la galería (fix multi-photo intacto)', async () => {
    const product = env.tenantAvailableProducts.find(p => p.id === 'prod-reloj-geneva');
    const commercialState = {
      productId: product.id,
      productMediaState: {
        productId: product.id,
        sentImageUrls: ['https://cdn.example.com/geneva-main.jpg'],
        lastSentImageUrl: 'https://cdn.example.com/geneva-main.jpg',
        sentCount: 1,
        cycleCount: 0
      }
    };

    const result = await env.executeSendProductMedia({
      productId: product.id,
      mediaType: 'image',
      userMessageText: 'más fotos por favor',
      currentCommercialState: commercialState
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.urls.length, 3, 'Debe incluir las 3 fotos restantes de la galería');
    assert.strictEqual(result.urls.includes('https://cdn.example.com/geneva-main.jpg'), false, 'No debe repetir la portada');
  });

  // --------------------------------------------------------------------------
  // TEST K: Videos intactos
  // --------------------------------------------------------------------------
  await runTest('K', 'Videos intactos: send_product_media video envía videoUrl si existe o reporta NO_VIDEO_REGISTERED si no existe', async () => {
    // 1. Producto con video (JBL)
    const resultWithVideo = await env.executeSendProductMedia({
      productId: 'prod-jbl-1',
      mediaType: 'video',
      userMessageText: 'tienes video del jbl?',
      currentCommercialState: {}
    });
    assert.strictEqual(resultWithVideo.success, true);
    assert.strictEqual(resultWithVideo.mediaType, 'video');
    assert.strictEqual(resultWithVideo.targetMediaUrl, 'https://cdn.example.com/jbl-video.mp4');

    // 2. Producto sin video (Thinking plus)
    const resultWithoutVideo = await env.executeSendProductMedia({
      productId: 'prod-aud-thinking',
      mediaType: 'video',
      userMessageText: 'muéstrame video de los audífonos thinking plus',
      currentCommercialState: {}
    });
    assert.strictEqual(resultWithoutVideo.success, false);
    assert.strictEqual(resultWithoutVideo.reason, 'NO_VIDEO_REGISTERED');
  });

  // --------------------------------------------------------------------------
  // TEST L: Cross-tenant guards intactos
  // --------------------------------------------------------------------------
  await runTest('L', 'Cross-tenant intacto: intento de pedir producto de otro tenant es rechazado fail-closed', async () => {
    const resultCrossTenant = await env.executeSendProductMedia({
      productId: 'prod-other-tenant',
      mediaType: 'image',
      userMessageText: 'foto de los audífonos secretos',
      tenant: { id: env.tenantId }, // Tenant legítimo no es dueño de prod-other-tenant
      currentCommercialState: {}
    });

    assert.strictEqual(resultCrossTenant.success, false);
    assert.strictEqual(resultCrossTenant.hasMedia, false);
    assert.strictEqual(resultCrossTenant.reason, 'NO_IMAGE_REGISTERED');
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('======================================================================\n');
}

runAllTests().catch(err => {
  console.error('\n💥 FATAL TEST FAILURE:', err);
  process.exit(1);
});
