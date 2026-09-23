/**
 * test_media_product_resolution_regression.js
 * 
 * Regression suite for Product Media Resolution and Dispatch (Tests 1 - 10).
 * Constraints:
 * - REAL_WHATSAPP_MESSAGES_SENT_DURING_TESTS = 0
 * - PRODUCTION_DATA_MODIFIED = NO
 */

import {
  isExplicitProductVideoIntent,
  isExplicitProductPhotoIntent,
  detectProductMediaIntent,
  enforceMediaAuthority
} from './src/controllers/whatsappController.js';

import {
  getCanonicalProductMedia,
  getCanonicalProductImages,
  resolveTargetProduct,
  orchestrateProductMedia,
  isGenericProductReference,
  isUserProductDisavowal,
  detectCategoryOrMultiProductQuery
} from './src/services/productMediaOrchestrator.js';

// ─── FIXTURES DE PRUEBA (EN MEMORIA, 0 BD MUTATION) ───
const FIXTURE_PRODUCTS = [
  {
    id: 'prod-jbl-go4',
    name: 'JBL Go 4 A1',
    category: 'Audio',
    imageUrl: 'https://cdn.example.com/products/jbl-go4.jpg',
    images: ['https://cdn.example.com/products/jbl-go4.jpg'],
    videoUrl: null,
    videos: [],
    tags: ['parlante', 'bluetooth', 'jbl']
  },
  {
    id: 'prod-lentes-camara',
    name: 'Lentes de sol con cámara HD',
    category: 'Gadgets',
    imageUrl: 'https://cdn.example.com/products/lentes-1.jpg',
    images: '["https://cdn.example.com/products/lentes-1.jpg", "https://cdn.example.com/products/lentes-2.jpg"]', // serialized JSON
    videoUrl: 'https://cdn.example.com/videos/lentes-demo.mp4',
    videos: ['https://cdn.example.com/videos/lentes-demo.mp4'],
    tags: ['lentes', 'camara', 'gafas']
  },
  {
    id: 'prod-reloj-ultra',
    name: 'Smartwatch Ultra Pro',
    category: 'Relojes',
    imageUrl: 'https://cdn.example.com/products/reloj-ultra.jpg',
    images: ['https://cdn.example.com/products/reloj-ultra.jpg'],
    videoUrl: '',
    videos: [],
    tags: ['smartwatch', 'reloj']
  },
  {
    id: 'prod-reloj-fit',
    name: 'Smartwatch Fit Band',
    category: 'Relojes',
    imageUrl: 'https://cdn.example.com/products/reloj-fit.jpg',
    images: ['https://cdn.example.com/products/reloj-fit.jpg'],
    videoUrl: null,
    videos: [],
    tags: ['smartwatch', 'band']
  },
  {
    id: 'prod-dron-video-only',
    name: 'Dron Explorer 4K',
    category: 'Drones',
    imageUrl: null,
    images: [],
    videoUrl: 'https://cdn.example.com/videos/dron-flight.mp4',
    videos: ['https://cdn.example.com/videos/dron-flight.mp4'],
    tags: ['dron', 'video']
  },
  {
    id: 'prod-curso-no-media',
    name: 'Asesoría Digital Avanzada',
    category: 'Servicios',
    imageUrl: null,
    images: [],
    videoUrl: null,
    videos: [],
    tags: ['asesoria', 'servicio']
  }
];

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (!condition) {
    testsFailed++;
    console.error(`  ❌ FAILED: ${message}`);
    throw new Error(message);
  } else {
    console.log(`  ✓ PASS: ${message}`);
  }
}

async function runAllTests() {
  console.log('====================================================');
  console.log('EJECUTANDO SUITE DE REGRESIÓN: RESOLUCIÓN Y MEDIOS');
  console.log('====================================================\n');

  // ----------------------------------------------------
  // TEST 1: Generic request without product -> clarification, media sent = 0
  // ----------------------------------------------------
  console.log('TEST 1: Generic request without product');
  {
    const userText = 'Puedes enviarme foto y video de un producto que me ha interesado';
    const isGeneric = isGenericProductReference(userText);
    assert(isGeneric === true, 'Detecta referencia genérica a producto');

    const resolved = resolveTargetProduct(userText, FIXTURE_PRODUCTS, null, {
      isExplicitMedia: true,
      confirmedProductId: null,
      isProductConfirmed: false
    });
    assert(resolved === null, 'No adivina ningún producto del catálogo si no está confirmado');

    const orchestration = orchestrateProductMedia({
      userMessageText: userText,
      availableProducts: FIXTURE_PRODUCTS,
      currentCommercialState: { isProductConfirmed: false, confirmedProductId: null },
      sentMediaProductIds: []
    });

    assert(orchestration.shouldDispatch === false, 'shouldDispatch es false');
    assert(orchestration.reason === 'PRODUCT_CLARIFICATION_REQUIRED', 'Razón es PRODUCT_CLARIFICATION_REQUIRED');
    assert(orchestration.mediaItems.length === 0, '0 medios encolados');
    testsPassed++;
  }

  // ----------------------------------------------------
  // TEST 2: Disavowal -> cleans context, no JBL reuse
  // ----------------------------------------------------
  console.log('\nTEST 2: Disavowal cleans context');
  {
    const disavowalText = 'Pero no te he mencionado el producto';
    const isDisavowal = isUserProductDisavowal(disavowalText);
    assert(isDisavowal === true, 'Detecta desmentido explícito del cliente');

    // Contexto previo tenía JBL Go 4
    let commercialState = {
      productId: 'prod-jbl-go4',
      productName: 'JBL Go 4 A1',
      lastConsultedProductId: 'prod-jbl-go4',
      confirmedProductId: 'prod-jbl-go4',
      isProductConfirmed: true
    };

    // Simulamos la limpieza ejecutada en la guarda del controlador
    if (isDisavowal) {
      commercialState = {
        ...commercialState,
        lastConsultedProductId: null,
        lastConsultedProductName: null,
        lastConsultedProductAt: null,
        productId: null,
        productName: null,
        candidateProductId: null,
        isProductConfirmed: false,
        confirmedProductId: null
      };
    }

    assert(commercialState.lastConsultedProductId === null, 'lastConsultedProductId reseteado a null');
    assert(commercialState.confirmedProductId === null, 'confirmedProductId reseteado a null');
    assert(commercialState.isProductConfirmed === false, 'isProductConfirmed es false');

    // Próxima llamada genérica no reusa JBL
    const nextText = 'Mándame las fotos y el video del producto';
    const resolvedNext = resolveTargetProduct(nextText, FIXTURE_PRODUCTS, commercialState.lastConsultedProductId, {
      isExplicitMedia: true,
      confirmedProductId: commercialState.confirmedProductId,
      isProductConfirmed: commercialState.isProductConfirmed
    });
    assert(resolvedNext === null, 'No reusa JBL Go 4 tras el desmentido');
    testsPassed++;
  }

  // ----------------------------------------------------
  // TEST 3: Confirmed context -> "Envíame foto y video" sends both
  // ----------------------------------------------------
  console.log('\nTEST 3: Confirmed context sends both image and video');
  {
    const userText = 'Envíame foto y video del producto';
    const confirmedState = {
      confirmedProductId: 'prod-lentes-camara',
      isProductConfirmed: true,
      lastConsultedProductId: 'prod-lentes-camara'
    };

    const targetProduct = resolveTargetProduct(userText, FIXTURE_PRODUCTS, confirmedState.lastConsultedProductId, {
      isExplicitMedia: true,
      confirmedProductId: confirmedState.confirmedProductId,
      isProductConfirmed: confirmedState.isProductConfirmed
    });
    assert(targetProduct !== null && targetProduct.id === 'prod-lentes-camara', 'Resuelve producto confirmado por contexto');

    const orchestration = orchestrateProductMedia({
      userMessageText: userText,
      availableProducts: FIXTURE_PRODUCTS,
      currentCommercialState: confirmedState,
      sentMediaProductIds: []
    });

    assert(orchestration.shouldDispatch === true, 'shouldDispatch es true');
    assert(orchestration.mediaType === 'both', 'mediaType es both');
    assert(orchestration.mediaItems.length === 2, '2 items en mediaItems');
    assert(orchestration.mediaItems[0].type === 'image', 'Item 0 es image');
    assert(orchestration.mediaItems[1].type === 'video', 'Item 1 es video');
    testsPassed++;
  }

  // ----------------------------------------------------
  // TEST 4: "Lentes de sol con cámara" (has img + vid) -> sends both, 0 false negatives
  // ----------------------------------------------------
  console.log('\nTEST 4: "Lentes de sol con cámara" explicit both media');
  {
    const userText = 'puedes enviarme foto y video de los lentes con camara';
    const videoIntent = isExplicitProductVideoIntent(userText);
    const photoIntent = isExplicitProductPhotoIntent(userText);
    const combinedIntent = detectProductMediaIntent(userText);

    assert(videoIntent === true, 'Detecta intención de video');
    assert(photoIntent === true, 'Detecta intención de foto');
    assert(combinedIntent === 'both', 'detectProductMediaIntent retorna both');

    const orchestration = orchestrateProductMedia({
      userMessageText: userText,
      availableProducts: FIXTURE_PRODUCTS,
      currentCommercialState: {},
      sentMediaProductIds: []
    });

    assert(orchestration.shouldDispatch === true, 'Orquestación despacha');
    assert(orchestration.targetProduct.id === 'prod-lentes-camara', 'Identifica Lentes de sol con cámara');
    assert(orchestration.mediaType === 'both', 'mediaType es both');
    assert(orchestration.hasImage === true && orchestration.hasVideo === true, 'Ambos medios presentes');

    // Verificar sanitización de falsa negativa por enforceMediaAuthority
    const llmOutputWithFalseNegative = 'Aquí tienes el producto. Por el momento no disponemos de un video registrado.';
    const cleaned = enforceMediaAuthority(llmOutputWithFalseNegative, true, {
      hasVideo: orchestration.hasVideo,
      hasImage: orchestration.hasImage
    });
    assert(!cleaned.toLowerCase().includes('no disponemos de un video'), 'enforceMediaAuthority elimina la falsa negación de video');
    testsPassed++;
  }

  // ----------------------------------------------------
  // TEST 5: Product only with image -> image sent = YES, video = NO, coherent text
  // ----------------------------------------------------
  console.log('\nTEST 5: Product only with image');
  {
    const userText = 'envíame foto y video del JBL Go 4';
    const orchestration = orchestrateProductMedia({
      userMessageText: userText,
      availableProducts: FIXTURE_PRODUCTS,
      currentCommercialState: {},
      sentMediaProductIds: []
    });

    assert(orchestration.shouldDispatch === true, 'shouldDispatch es true porque tiene foto');
    assert(orchestration.mediaType === 'image', 'mediaType se ajusta a image');
    assert(orchestration.hasImage === true, 'hasImage es true');
    assert(orchestration.hasVideo === false, 'hasVideo es false');
    assert(orchestration.mediaItems.length === 1 && orchestration.mediaItems[0].type === 'image', 'Solo encola imagen');
    assert(orchestration.reason === 'EXPLICIT_BOTH_REQUESTED_ONLY_IMAGE_AVAILABLE', 'Razón indica solo foto disponible');
    testsPassed++;
  }

  // ----------------------------------------------------
  // TEST 6: Product only with video -> image sent = NO, video = YES, coherent text
  // ----------------------------------------------------
  console.log('\nTEST 6: Product only with video');
  {
    const userText = 'pásame foto y video del Dron Explorer 4K';
    const orchestration = orchestrateProductMedia({
      userMessageText: userText,
      availableProducts: FIXTURE_PRODUCTS,
      currentCommercialState: {},
      sentMediaProductIds: []
    });

    assert(orchestration.shouldDispatch === true, 'shouldDispatch es true porque tiene video');
    assert(orchestration.mediaType === 'video', 'mediaType se ajusta a video');
    assert(orchestration.hasImage === false, 'hasImage es false');
    assert(orchestration.hasVideo === true, 'hasVideo es true');
    assert(orchestration.mediaItems.length === 1 && orchestration.mediaItems[0].type === 'video', 'Solo encola video');
    assert(orchestration.reason === 'EXPLICIT_BOTH_REQUESTED_ONLY_VIDEO_AVAILABLE', 'Razón indica solo video disponible');
    testsPassed++;
  }

  // ----------------------------------------------------
  // TEST 7: Product without media -> media sent = 0, informs cleanly
  // ----------------------------------------------------
  console.log('\nTEST 7: Product without media');
  {
    const userText = 'puedes enviarme foto de la asesoría digital';
    const orchestration = orchestrateProductMedia({
      userMessageText: userText,
      availableProducts: FIXTURE_PRODUCTS,
      currentCommercialState: {},
      sentMediaProductIds: []
    });

    assert(orchestration.shouldDispatch === false, 'shouldDispatch es false');
    assert(orchestration.mediaItems.length === 0, '0 medios encolados');
    assert(orchestration.reason === 'NO_IMAGE_REGISTERED', 'Razón NO_IMAGE_REGISTERED');
    testsPassed++;
  }

  // ----------------------------------------------------
  // TEST 8: Ambiguous category/models -> asks disambiguation, media sent = 0
  // ----------------------------------------------------
  console.log('\nTEST 8: Ambiguous category/models');
  {
    const userText = 'muéstrame fotos de los smartwatches';
    const categoryCheck = detectCategoryOrMultiProductQuery(userText, FIXTURE_PRODUCTS);
    assert(categoryCheck.isAmbiguous === true, 'Detecta consulta ambigua de categoría');
    assert(categoryCheck.candidateProducts.length === 2, 'Encuentra 2 modelos candidatos');

    const orchestration = orchestrateProductMedia({
      userMessageText: userText,
      availableProducts: FIXTURE_PRODUCTS,
      currentCommercialState: {},
      sentMediaProductIds: []
    });

    assert(orchestration.shouldDispatch === false, 'shouldDispatch es false');
    assert(orchestration.mediaItems.length === 0, '0 medios enviados');
    assert(orchestration.reason === 'AMBIGUOUS_PRODUCT_SELECTION', 'Razón es AMBIGUOUS_PRODUCT_SELECTION');
    testsPassed++;
  }

  // ----------------------------------------------------
  // TEST 9: Voice note transcribed -> enters same resolver and media dispatcher
  // ----------------------------------------------------
  console.log('\nTEST 9: Transcribed voice note handling');
  {
    // Una nota de voz transcrita produce el mismo userMessageText que un mensaje de texto
    const voiceTranscribedText1 = 'Hola, por favor envíame foto y video de los lentes de sol con cámara';
    const orchVoice1 = orchestrateProductMedia({
      userMessageText: voiceTranscribedText1,
      availableProducts: FIXTURE_PRODUCTS,
      currentCommercialState: {},
      sentMediaProductIds: []
    });

    assert(orchVoice1.shouldDispatch === true, 'Nota de voz transcrita despacha medios correctamente');
    assert(orchVoice1.mediaType === 'both', 'Despacha both para nota de voz con solicitud de foto y video');
    assert(orchVoice1.targetProduct.id === 'prod-lentes-camara', 'Resuelve producto exacto');

    // Nota de voz genérica sin especificar producto
    const voiceTranscribedText2 = 'Hola, me mandas fotos y videos de un producto que vi en su tienda?';
    const orchVoice2 = orchestrateProductMedia({
      userMessageText: voiceTranscribedText2,
      availableProducts: FIXTURE_PRODUCTS,
      currentCommercialState: { isProductConfirmed: false },
      sentMediaProductIds: []
    });

    assert(orchVoice2.shouldDispatch === false, 'Nota de voz genérica no envía fotos arbitrarias');
    assert(orchVoice2.reason === 'PRODUCT_CLARIFICATION_REQUIRED', 'Requiere aclaración exactamente igual que texto');
    testsPassed++;
  }

  // ----------------------------------------------------
  // TEST 10: Canonical truth override -> LLM false negation sanitized/corrected
  // ----------------------------------------------------
  console.log('\nTEST 10: Canonical truth override');
  {
    // Escenario A: LLM afirma que envía foto cuando no hay media programada
    const llmFalseDelivery = '¡Por supuesto! Aquí te adjunto la foto del producto para que la puedas apreciar:';
    const sanitizedDelivery = enforceMediaAuthority(llmFalseDelivery, false);
    assert(sanitizedDelivery.includes('No tengo una imagen disponible'), 'Sustituye promesa falsa por indisponibilidad real');

    // Escenario B: LLM afirma erróneamente que no dispone de video cuando el video SÍ fue despachado
    const llmFalseNegation = 'Te adjunto los detalles. Por el momento no disponemos de video registrado del producto.';
    const sanitizedNegation = enforceMediaAuthority(llmFalseNegation, true, { hasVideo: true, hasImage: true });
    assert(!sanitizedNegation.includes('no disponemos de video'), 'Elimina la falsa negación de video cuando hasVideo es true');

    // Escenario C: getCanonicalProductMedia normaliza todas las fuentes del modelo Product
    const testProductComplexSources = {
      id: 'prod-complex',
      name: 'Producto Complejo',
      imageUrl: ' https://cdn.example.com/p1.jpg ',
      images: '["https://cdn.example.com/p1.jpg", "https://cdn.example.com/p2.jpg"]',
      videoUrl: 'https://cdn.example.com/v1.mp4',
      videos: ['https://cdn.example.com/v1.mp4', 'https://cdn.example.com/v2.mp4']
    };
    const canonical = getCanonicalProductMedia(testProductComplexSources);
    assert(canonical.images.length === 2, 'Normaliza y deduplica imágenes (2 únicas)');
    assert(canonical.videos.length === 2, 'Normaliza y deduplica videos (2 únicos)');
    assert(canonical.hasImage === true && canonical.hasVideo === true, 'Flags booleanas correctas');
    testsPassed++;
  }

  console.log('\n====================================================');
  console.log(`RESULTADOS: ${testsPassed} PASARON | ${testsFailed} FALLARON`);
  console.log('====================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Fatal error running regression tests:', err);
  process.exit(1);
});
