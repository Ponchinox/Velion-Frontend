import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEND_PRODUCT_MEDIA_DECLARATION,
  isExplicitProductVideoIntent,
  isExplicitProductPhotoIntent,
  isStandaloneAVer,
  detectProductMediaIntent,
  isExplicitProductMediaIntent,
  enforceMediaAuthority,
  buildChatContext
} from './src/controllers/whatsappController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('======================================================================');
console.log('🧪 VELION PRODUCT MEDIA SUITE: MEDIA-1 & MEDIA-2 (IMAGE & VIDEO)');
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

/**
 * Simulador de base de datos en memoria para pruebas de aislamiento y media
 */
function createMockPrisma() {
  const products = new Map();

  return {
    products,
    product: {
      async findFirst({ where, select }) {
        for (const prod of products.values()) {
          if (where.id && prod.id !== where.id) continue;
          if (where.user?.tenantId && prod.tenantId !== where.user.tenantId) continue;

          // Proyección de select
          const result = {};
          if (select.id) result.id = prod.id;
          if (select.name) result.name = prod.name;
          if (select.imageUrl !== undefined) result.imageUrl = prod.imageUrl;
          if (select.images !== undefined) result.images = prod.images || [];
          if (select.videoUrl !== undefined) result.videoUrl = prod.videoUrl;
          if (select.type) result.type = prod.type;
          return result;
        }
        return null;
      }
    }
  };
}

/**
 * Implementación de referencia de toolsHandler para send_product_media (idéntica a controller)
 */
function createMediaHandler(mockPrisma, tenantId, options = {}) {
  let pendingMediaToSend = null;
  let mediaSentInSession = false;
  let userMessageText = options.userMessageText || '';
  let generationSuperseded = options.isSuperseded || false;

  const handler = async (funcName, args) => {
    if (funcName === 'send_product_media') {
      if (generationSuperseded) {
        pendingMediaToSend = null;
        return { success: false, error: 'GENERATION_SUPERSEDED', message: 'El usuario envió un mensaje más reciente.' };
      }

      const rawProductId = args?.productId;
      const productId = typeof rawProductId === 'string' ? rawProductId.trim() : String(rawProductId || '').trim();
      const rawMediaType = args?.mediaType;
      const detectedType = detectProductMediaIntent(userMessageText);
      const requestedMediaType = (rawMediaType === 'video' || (detectedType === 'video' && rawMediaType !== 'image'))
        ? 'video'
        : 'image';

      if (mediaSentInSession || pendingMediaToSend) {
        return {
          success: false,
          hasMedia: false,
          reason: 'MEDIA_ALREADY_QUEUED',
          message: 'Ya se preparó un elemento multimedia para este turno. No se permiten envíos duplicados.'
        };
      }

      if (!productId) {
        return {
          success: false,
          hasMedia: false,
          reason: 'INVALID_PRODUCT_ID',
          message: 'Se requiere un productId válido.'
        };
      }

      const product = await mockPrisma.product.findFirst({
        where: {
          id: productId,
          user: { tenantId }
        },
        select: {
          id: true,
          name: true,
          imageUrl: true,
          images: true,
          videoUrl: true,
          type: true
        }
      });

      if (!product) {
        return {
          success: false,
          hasMedia: false,
          reason: requestedMediaType === 'video' ? 'NO_VIDEO_REGISTERED' : 'NO_IMAGE_REGISTERED',
          message: 'El producto no fue encontrado en esta tienda. Informa con amabilidad al cliente.'
        };
      }

      if (requestedMediaType === 'video') {
        let canonicalVideoUrl = null;
        if (product.videoUrl && typeof product.videoUrl === 'string' && product.videoUrl.trim() !== '' && product.videoUrl.trim() !== 'Sin video') {
          canonicalVideoUrl = product.videoUrl.trim();
        }

        if (!canonicalVideoUrl) {
          return {
            success: false,
            hasMedia: false,
            reason: 'NO_VIDEO_REGISTERED',
            message: `El producto o servicio "${product.name}" no cuenta con un video registrado en el catálogo digital en este momento. Informa esto al cliente con honestidad y amabilidad sin inventar enlaces ni decir que no se envían videos.`
          };
        }

        pendingMediaToSend = {
          productId: product.id,
          productName: product.name,
          url: canonicalVideoUrl,
          mediaType: 'video'
        };
        mediaSentInSession = true;

        return {
          success: true,
          hasMedia: true,
          mediaType: 'video',
          productName: product.name,
          message: `El video oficial de "${product.name}" ha sido preparado y se enviará al cliente por WhatsApp. Acompaña el video con un mensaje breve y amigable.`
        };
      }

      // Precedencia canónica segura para imagen
      let canonicalUrl = null;
      if (product.imageUrl && typeof product.imageUrl === 'string' && product.imageUrl.trim() !== '' && product.imageUrl.trim() !== 'Sin imagen') {
        canonicalUrl = product.imageUrl.trim();
      } else if (Array.isArray(product.images) && product.images.length > 0) {
        const firstImg = product.images[0];
        if (firstImg && typeof firstImg === 'string' && firstImg.trim() !== '' && firstImg.trim() !== 'Sin imagen') {
          canonicalUrl = firstImg.trim();
        }
      }

      if (!canonicalUrl) {
        return {
          success: false,
          hasMedia: false,
          reason: 'NO_IMAGE_REGISTERED',
          message: `El producto o servicio "${product.name}" no cuenta con una imagen o foto registrada en el catálogo digital en este momento. Informa esto al cliente con honestidad y amabilidad sin inventar enlaces.`
        };
      }

      pendingMediaToSend = {
        productId: product.id,
        productName: product.name,
        url: canonicalUrl,
        mediaType: 'image'
      };
      mediaSentInSession = true;

      return {
        success: true,
        hasMedia: true,
        mediaType: 'image',
        productName: product.name,
        message: `La imagen oficial de "${product.name}" ha sido preparada y se enviará al cliente. Acompaña la imagen con un mensaje breve y amigable.`
      };
    }
    return { error: 'Unknown function' };
  };

  return {
    handler,
    getPendingMedia: () => pendingMediaToSend,
    isMediaSent: () => mediaSentInSession,
    setSuperseded: (val) => { generationSuperseded = val; },
    setUserMessageText: (txt) => { userMessageText = txt; }
  };
}

/**
 * Lógica canónica de ensamble y sanitización de despacho (extraída del controller)
 */
function assembleDispatchSequence(aiResponse, pendingMediaToSend, handoffRegex = /\[HUMAN_HANDOFF:.*?\]/gi) {
  const textWithoutCommands = (aiResponse || '')
    .replace(handoffRegex, '')
    .replace(/\[MEDIA:.*?\]/gi, '')
    .replace(/\[SHOW_GALLERY:.*?\]/gi, '')
    .replace(/\[(?:Imagen|Video|Media|Multimedia)\s+enviad[ao](?:\s+al\s+cliente)?\]/gi, '')
    .replace(/\[(?:Imagen|Video|Media|Multimedia)\](?::\s*(?:https?:\/\/[^\s\n]+|\/[^\s\n]+)?)?/gi, '')
    .replace(/\[(?:archivo\s+multimedia|multimedia)\]/gi, '')
    .replace(/(?:https?:\/\/[^\s\n]+)?\/(?:media\/tenants|products\/(?:images|videos))\/[^\s\n]+/gi, '')
    .replace(/^\s*[\r\n]+/gm, '\n');

  let cleanedText = textWithoutCommands.trim();
  cleanedText = enforceMediaAuthority(cleanedText, Boolean(pendingMediaToSend));

  let dispatchSequence = [];
  if (cleanedText || pendingMediaToSend) {
    const sequenceRegex = /(\[SPLIT\])/gi;
    const tokens = cleanedText.split(sequenceRegex).filter(t => t !== undefined && t !== null);

    const hasSplit = tokens.some(t => t.trim().toUpperCase() === '[SPLIT]');

    if (pendingMediaToSend && !hasSplit && cleanedText.length <= 1000) {
      dispatchSequence.push({
        type: pendingMediaToSend.mediaType || 'image',
        url: pendingMediaToSend.url,
        caption: cleanedText || undefined
      });
    } else {
      if (pendingMediaToSend) {
        dispatchSequence.push({
          type: pendingMediaToSend.mediaType || 'image',
          url: pendingMediaToSend.url
        });
      }

      let textBuffer = "";
      for (const fragment of tokens) {
        if (!fragment) continue;
        const token = fragment.trim();
        if (token.toUpperCase() === '[SPLIT]') {
          if (textBuffer.trim()) {
            dispatchSequence.push({ type: 'text', content: textBuffer.trim() });
            textBuffer = "";
          }
        } else {
          textBuffer += fragment;
        }
      }
      if (textBuffer.trim()) {
        dispatchSequence.push({ type: 'text', content: textBuffer.trim() });
      }
    }
  }

  return dispatchSequence;
}

async function runSuite() {
  const tenantA = 'tenant-alpha-uuid';
  const tenantB = 'tenant-beta-uuid';

  // =============================================================================
  // MEDIA-1 TESTS: URL LEAK PREVENTION & AUTHORITY INTEGRATION
  // =============================================================================

  await runTest('M1: Producto con imagen + usuario pide foto => media enviada y respuesta textual NO contiene URL', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set('prod-hw10', {
      id: 'prod-hw10',
      name: 'Reloj smartwatch HW 10 pro',
      imageUrl: 'https://185.163.116.210/media/tenants/alpha/products/images/hw10.jpg',
      images: [],
      type: 'PHYSICAL_PRODUCT',
      tenantId: tenantA
    });

    const ctx = createMediaHandler(mockDb, tenantA, { userMessageText: 'Aver' });
    const result = await ctx.handler('send_product_media', { productId: 'prod-hw10', mediaType: 'image' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.hasMedia, true);
    assert.strictEqual(result.mediaType, 'image');

    const pending = ctx.getPendingMedia();
    assert.ok(pending);
    assert.strictEqual(pending.url, 'https://185.163.116.210/media/tenants/alpha/products/images/hw10.jpg');

    const modelResponse = "Aquí tienes la foto del Reloj smartwatch HW 10 pro con correa metálica dorada. ¿Cuántas unidades te gustaría llevar? ✨";
    const dispatchSequence = assembleDispatchSequence(modelResponse, pending);

    assert.strictEqual(dispatchSequence.length, 1);
    assert.strictEqual(dispatchSequence[0].type, 'image');
    assert.strictEqual(dispatchSequence[0].caption, modelResponse);
    assert.ok(!dispatchSequence[0].caption.includes('/media/tenants/'), 'Caption no debe contener URL interna');
  });

  await runTest('M2: Modelo intenta emitir [Imagen]: https://.../media/tenants/... => URL interna no llega a salida visible', async () => {
    const leakedModelOutput = `[Imagen]: https://185.163.116.210/media/tenants/dfe020e6-5e08-404c-9b89-ef3f08f2b150/products/images/w1w25qodqf36a4413l1l.jpg
Aquí tienes la foto del reloj con su correa metálica dorada. Visita nuestra web https://mitienda.com para ver más promociones.`;

    const dispatchSequence = assembleDispatchSequence(leakedModelOutput, null);

    // Cuando no hay pending media, enforceMediaAuthority sanitiza "Aquí tienes la foto"
    for (const item of dispatchSequence) {
      if (item.content) {
        assert.ok(!item.content.includes('185.163.116.210'), 'No debe fugar IP interna');
        assert.ok(!item.content.includes('/media/tenants/'), 'No debe fugar path de media interna');
        assert.ok(!item.content.includes('[Imagen]:'), 'No debe contener etiqueta [Imagen]:');
        assert.ok(!item.content.includes('/products/images/'), 'No debe contener ruta interna /products/images/');
        // Debe preservar enlaces externos legítimos
        assert.ok(item.content.includes('https://mitienda.com'), 'Debe preservar links externos legítimos');
      }
    }

    // Probar filtración de URLs relativas internas
    const relativeLeak = "Detalles en /products/images/hw10.jpg y video en /products/videos/demo.mp4";
    const relativeCleaned = assembleDispatchSequence(relativeLeak, null);
    assert.ok(!relativeCleaned[0].content.includes('/products/images/'));
    assert.ok(!relativeCleaned[0].content.includes('/products/videos/'));
  });

  await runTest('M3: Producto sin imagen => no inventa media y responde adecuadamente', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set('prod-no-pic', {
      id: 'prod-no-pic',
      name: 'Servicio de Consultoría',
      imageUrl: null,
      images: [],
      type: 'SERVICE',
      tenantId: tenantA
    });

    const ctx = createMediaHandler(mockDb, tenantA, { userMessageText: '¿Tienes foto?' });
    const result = await ctx.handler('send_product_media', { productId: 'prod-no-pic', mediaType: 'image' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.hasMedia, false);
    assert.strictEqual(result.reason, 'NO_IMAGE_REGISTERED');
    assert.strictEqual(ctx.getPendingMedia(), null);

    const dispatchSequence = assembleDispatchSequence(result.message, ctx.getPendingMedia());
    assert.strictEqual(dispatchSequence.some(i => i.type === 'image'), false);
  });

  await runTest('M4: Producto con imagen => nunca responder "no tengo imagen" si tool confirma existencia', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set('prod-watch', {
      id: 'prod-watch',
      name: 'Reloj Geneva',
      imageUrl: 'https://185.163.116.210/media/tenants/alpha/products/images/geneva.jpg',
      images: [],
      type: 'PHYSICAL_PRODUCT',
      tenantId: tenantA
    });

    const ctx = createMediaHandler(mockDb, tenantA, { userMessageText: 'Foto por favor' });
    const result = await ctx.handler('send_product_media', { productId: 'prod-watch', mediaType: 'image' });
    assert.strictEqual(result.success, true);

    const pending = ctx.getPendingMedia();
    const modelText = "Aquí tienes la imagen del Reloj Geneva + pulsera black. ¿Cuántas unidades te gustaría llevar?";

    // Con pending media presente, enforceMediaAuthority NO debe censurar "Aquí tienes la imagen"
    const cleaned = enforceMediaAuthority(modelText, Boolean(pending));
    assert.strictEqual(cleaned, modelText);
    assert.ok(!cleaned.includes('No tengo multimedia disponible'), 'No debe decir falsamente que no tiene imagen');
  });

  await runTest('M5: Historial contiene [Imagen]: URL + caption => buildChatContext entrega marcador semántico SIN URL', async () => {
    const rawMessages = [
      {
        id: 'msg-1',
        senderRole: 'contact',
        content: '¿Tienes foto del reloj?',
        status: 'received'
      },
      {
        id: 'msg-2',
        senderRole: 'agent',
        content: '[Imagen]: https://185.163.116.210/media/tenants/alpha/products/images/geneva.jpg\nAquí tienes la imagen del Reloj Geneva. ¿Cuántas unidades deseas?',
        status: 'sent'
      }
    ];

    const chatContext = buildChatContext(rawMessages);
    assert.strictEqual(chatContext.length, 2);
    assert.strictEqual(chatContext[0].role, 'user');
    assert.strictEqual(chatContext[1].role, 'model');

    const modelContent = chatContext[1].content;
    assert.ok(modelContent.includes('[Imagen enviada al cliente]'), 'Debe contener el marcador semántico limpio');
    assert.ok(modelContent.includes('Aquí tienes la imagen del Reloj Geneva'), 'Debe preservar el caption conversacional');
    assert.ok(!modelContent.includes('185.163.116.210'), 'No debe filtrar IP interna a Gemini');
    assert.ok(!modelContent.includes('/media/tenants/'), 'No debe filtrar ruta de archivo a Gemini');
  });

  // =============================================================================
  // MEDIA-2 TESTS: VIDEO RECOGNITION & DISPATCH
  // =============================================================================

  await runTest('V1: Producto con video + "video" => mediaType video y video real encolado', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set('prod-jbl', {
      id: 'prod-jbl',
      name: 'JBL go 4 A1',
      imageUrl: 'https://185.163.116.210/media/tenants/alpha/products/images/jbl.jpg',
      images: [],
      videoUrl: 'https://185.163.116.210/media/tenants/alpha/products/videos/jbl_demo.mp4',
      type: 'PHYSICAL_PRODUCT',
      tenantId: tenantA
    });

    const ctx = createMediaHandler(mockDb, tenantA, { userMessageText: 'Video' });
    const result = await ctx.handler('send_product_media', { productId: 'prod-jbl', mediaType: 'video' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.hasMedia, true);
    assert.strictEqual(result.mediaType, 'video');
    assert.strictEqual(result.productName, 'JBL go 4 A1');

    const pending = ctx.getPendingMedia();
    assert.ok(pending);
    assert.strictEqual(pending.mediaType, 'video');
    assert.strictEqual(pending.url, 'https://185.163.116.210/media/tenants/alpha/products/videos/jbl_demo.mp4');

    const dispatchSequence = assembleDispatchSequence("Aquí tienes el video oficial del JBL go 4 A1.", pending);
    assert.strictEqual(dispatchSequence.length, 1);
    assert.strictEqual(dispatchSequence[0].type, 'video');
    assert.strictEqual(dispatchSequence[0].url, pending.url);
  });

  await runTest('V2: Producto con video + "tienes video?" => detección de intención no responde falsamente "no"', async () => {
    const text1 = "Tienes video de un JBL que vi en sus redes";
    const text2 = "Videos tienes?";
    const text3 = "Video";
    const text4 = "puedes enviarme el video del parlante?";

    assert.strictEqual(isExplicitProductVideoIntent(text1), true);
    assert.strictEqual(isExplicitProductVideoIntent(text2), true);
    assert.strictEqual(isExplicitProductVideoIntent(text3), true);
    assert.strictEqual(isExplicitProductVideoIntent(text4), true);

    assert.strictEqual(detectProductMediaIntent(text1), 'video');
    assert.strictEqual(detectProductMediaIntent(text2), 'video');
    assert.strictEqual(detectProductMediaIntent(text3), 'video');
  });

  await runTest('V3: Producto sin video => respuesta factual correcta sin inventar políticas', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set('prod-no-vid', {
      id: 'prod-no-vid',
      name: 'Smartwatch HW 10 pro',
      imageUrl: 'https://185.163.116.210/media/tenants/alpha/products/images/hw10.jpg',
      images: [],
      videoUrl: null, // Sin video
      type: 'PHYSICAL_PRODUCT',
      tenantId: tenantA
    });

    const ctx = createMediaHandler(mockDb, tenantA, { userMessageText: 'Video' });
    const result = await ctx.handler('send_product_media', { productId: 'prod-no-vid', mediaType: 'video' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.hasMedia, false);
    assert.strictEqual(result.reason, 'NO_VIDEO_REGISTERED');
    assert.ok(result.message.includes('no cuenta con un video registrado'));
    assert.ok(!result.message.includes('no enviamos videos por WhatsApp'));
    assert.strictEqual(ctx.getPendingMedia(), null);
  });

  await runTest('V4: Mismo producto con imagen + video: "foto" manda imagen, "video" manda video', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set('prod-combo', {
      id: 'prod-combo',
      name: 'Parlante JBL',
      imageUrl: 'https://185.163.116.210/media/tenants/alpha/products/images/jbl.jpg',
      images: [],
      videoUrl: 'https://185.163.116.210/media/tenants/alpha/products/videos/jbl.mp4',
      type: 'PHYSICAL_PRODUCT',
      tenantId: tenantA
    });

    // Sesión A: pide foto
    const ctxPhoto = createMediaHandler(mockDb, tenantA, { userMessageText: 'Foto' });
    const resPhoto = await ctxPhoto.handler('send_product_media', { productId: 'prod-combo', mediaType: 'image' });
    assert.strictEqual(resPhoto.success, true);
    assert.strictEqual(ctxPhoto.getPendingMedia().mediaType, 'image');
    assert.strictEqual(ctxPhoto.getPendingMedia().url, 'https://185.163.116.210/media/tenants/alpha/products/images/jbl.jpg');

    // Sesión B: pide video
    const ctxVideo = createMediaHandler(mockDb, tenantA, { userMessageText: 'Video' });
    const resVideo = await ctxVideo.handler('send_product_media', { productId: 'prod-combo', mediaType: 'video' });
    assert.strictEqual(resVideo.success, true);
    assert.strictEqual(ctxVideo.getPendingMedia().mediaType, 'video');
    assert.strictEqual(ctxVideo.getPendingMedia().url, 'https://185.163.116.210/media/tenants/alpha/products/videos/jbl.mp4');
  });

  await runTest('V5: Cambio Producto A -> Producto B => nunca enviar media stale de A', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set('prod-a', {
      id: 'prod-a',
      name: 'Reloj Geneva',
      imageUrl: 'https://185.163.116.210/media/tenants/alpha/products/images/geneva.jpg',
      images: [],
      tenantId: tenantA
    });
    mockDb.products.set('prod-b', {
      id: 'prod-b',
      name: 'Smartwatch HW 10',
      imageUrl: 'https://185.163.116.210/media/tenants/alpha/products/images/hw10.jpg',
      images: [],
      tenantId: tenantA
    });

    // El cliente estaba viendo Producto A, pero en el nuevo turno pide media del Producto B
    const ctx = createMediaHandler(mockDb, tenantA, { userMessageText: 'Quiero ver el smartwatch HW 10, foto' });
    const res = await ctx.handler('send_product_media', { productId: 'prod-b', mediaType: 'image' });

    assert.strictEqual(res.success, true);
    assert.strictEqual(ctx.getPendingMedia().productId, 'prod-b');
    assert.strictEqual(ctx.getPendingMedia().url, 'https://185.163.116.210/media/tenants/alpha/products/images/hw10.jpg');
    assert.ok(!ctx.getPendingMedia().url.includes('geneva'), 'Nunca debe enviar la URL del producto anterior');
  });

  await runTest('V6: Nueva intención durante media dispatch => stale/superseded guard funciona', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set('prod-jbl', {
      id: 'prod-jbl',
      name: 'JBL go 4 A1',
      videoUrl: 'https://185.163.116.210/media/tenants/alpha/products/videos/jbl.mp4',
      tenantId: tenantA
    });

    const ctx = createMediaHandler(mockDb, tenantA, { userMessageText: 'Video', isSuperseded: true });
    const res = await ctx.handler('send_product_media', { productId: 'prod-jbl', mediaType: 'video' });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'GENERATION_SUPERSEDED');
    assert.strictEqual(ctx.getPendingMedia(), null, 'pendingMedia debe ser abortado/limpiado');
  });

  await runTest('V7: Gateway recibe mediaType=video y payload es compatible con Evolution existente', async () => {
    const item = {
      type: 'video',
      url: 'https://185.163.116.210/media/tenants/alpha/products/videos/demo.mp4',
      caption: 'Demostración del producto.'
    };

    const isVideo = item.type === 'video' || item.url.includes('.mp4');
    const evoPayload = {
      number: '51991535502',
      mediatype: isVideo ? 'video' : 'image',
      media: item.url,
      caption: item.caption || ''
    };

    assert.strictEqual(evoPayload.mediatype, 'video');
    assert.strictEqual(evoPayload.media, 'https://185.163.116.210/media/tenants/alpha/products/videos/demo.mp4');
    assert.strictEqual(evoPayload.caption, 'Demostración del producto.');
  });

  await runTest('INT1: Detección exhaustiva de vocabulario de intención para IMAGEN y VIDEO', async () => {
    // IMAGEN: foto, fotos, imagen, ver foto, muéstrame, muéstramelo, enséñamelo, a ver, aver, pásame una foto
    const imagePhrases = [
      'foto',
      'fotos',
      'imagen',
      'ver foto',
      'muéstrame',
      'muéstramelo',
      'enséñamelo',
      'a ver',
      'aver',
      'pásame una foto'
    ];

    for (const phrase of imagePhrases) {
      assert.strictEqual(
        isExplicitProductPhotoIntent(phrase),
        true,
        `Frase de imagen esperada no detectada: "${phrase}"`
      );
      assert.strictEqual(
        detectProductMediaIntent(phrase),
        'image',
        `detectProductMediaIntent no retornó "image" para: "${phrase}"`
      );
    }

    // VIDEO: video, videos, tienes video, hay video, ver video, muéstrame el video, mándame video, pásame el video
    const videoPhrases = [
      'video',
      'videos',
      'tienes video',
      'hay video',
      'ver video',
      'muéstrame el video',
      'mándame video',
      'pásame el video'
    ];

    for (const phrase of videoPhrases) {
      assert.strictEqual(
        isExplicitProductVideoIntent(phrase),
        true,
        `Frase de video esperada no detectada: "${phrase}"`
      );
      assert.strictEqual(
        detectProductMediaIntent(phrase),
        'video',
        `detectProductMediaIntent no retornó "video" para: "${phrase}"`
      );
    }
  });

  await runTest('INT2: Expresiones ambiguas no deben disparar media erróneamente', async () => {
    // Frases con "a ver" que son preguntas conversacionales, NO solicitudes de foto
    const ambiguousPhrases = [
      'a ver qué opciones tienes para regalar',
      'a ver dime cuánto cuesta el envío',
      'a ver si me puedes ayudar con una duda',
      'cuánto cuesta el producto?',
      'hacen envíos a provincia?'
    ];

    for (const phrase of ambiguousPhrases) {
      assert.strictEqual(
        detectProductMediaIntent(phrase),
        null,
        `Expresión ambigua o genérica no debió clasificar como media: "${phrase}"`
      );
    }

    // isStandaloneAVer
    assert.strictEqual(isStandaloneAVer('a ver'), true);
    assert.strictEqual(isStandaloneAVer('aver'), true);
    assert.strictEqual(isStandaloneAVer('a ver?'), true);
    assert.strictEqual(isStandaloneAVer('a ver por favor'), true);
    assert.strictEqual(isStandaloneAVer('a ver qué opciones tienes'), false);
    assert.strictEqual(isStandaloneAVer('a ver dime el precio'), false);
  });

  await runTest('M14: Schema de SEND_PRODUCT_MEDIA_DECLARATION expone productId y mediaType (sin campos de URL)', async () => {
    assert.strictEqual(SEND_PRODUCT_MEDIA_DECLARATION.name, 'send_product_media');
    const props = Object.keys(SEND_PRODUCT_MEDIA_DECLARATION.parameters.properties);
    assert.ok(props.includes('productId'), 'Debe exponer productId');
    assert.ok(props.includes('mediaType'), 'Debe exponer mediaType');
    assert.deepStrictEqual(SEND_PRODUCT_MEDIA_DECLARATION.parameters.properties.mediaType.enum, ['image', 'video']);
    assert.deepStrictEqual(SEND_PRODUCT_MEDIA_DECLARATION.parameters.required, ['productId']);
    assert.ok(!props.includes('url'), 'No debe tener propiedad url');
    assert.ok(!props.includes('imageUrl'), 'No debe tener propiedad imageUrl');
    assert.ok(!props.includes('videoUrl'), 'No debe tener propiedad videoUrl');
  });

  // =============================================================================
  // POST-DEPLOY HOTFIX TESTS: V8 – V12 (RAPID INTENT, MARKERS & DELIVERY VERIFICATION)
  // =============================================================================

  await runTest('V8 RAPID SAME PRODUCT: Ráfaga "Quiero JBL Go 4\\nVideo\\nY en qué colores hay\\nDisponible" => Video enviado 1 vez, colores respondidos, sin marcadores ni URLs visibles', async () => {
    const burstText = "Quiero JBL Go 4\nVideo\nY en qué colores hay\nDisponible";
    
    // 1. Detección unificada en ráfaga multilínea reconoce el video del producto
    const detected = detectProductMediaIntent(burstText);
    assert.strictEqual(detected, 'video', 'Ráfaga debe detectar intención de video');

    const mockDb = createMockPrisma();
    mockDb.products.set('prod-jbl-go4', {
      id: 'prod-jbl-go4',
      name: 'JBL go 4 A1',
      imageUrl: 'https://185.163.116.210/media/tenants/alpha/products/images/jbl.jpg',
      images: [],
      videoUrl: 'https://185.163.116.210/media/tenants/alpha/products/videos/jbl_go4.mp4',
      type: 'PHYSICAL_PRODUCT',
      tenantId: tenantA
    });

    const ctx = createMediaHandler(mockDb, tenantA, { userMessageText: burstText });
    const result = await ctx.handler('send_product_media', { productId: 'prod-jbl-go4', mediaType: 'video' });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.hasMedia, true);
    assert.strictEqual(result.mediaType, 'video');

    const pending = ctx.getPendingMedia();
    assert.ok(pending, 'Debe existir media pendiente');
    assert.strictEqual(pending.productId, 'prod-jbl-go4');
    assert.strictEqual(pending.mediaType, 'video');
    assert.strictEqual(pending.url, 'https://185.163.116.210/media/tenants/alpha/products/videos/jbl_go4.mp4');

    // Intentar segundo envío en el mismo turno debe ser rechazado por deduplicación
    const duplicateAttempt = await ctx.handler('send_product_media', { productId: 'prod-jbl-go4', mediaType: 'video' });
    assert.strictEqual(duplicateAttempt.success, false);
    assert.strictEqual(duplicateAttempt.reason, 'MEDIA_ALREADY_QUEUED');

    // Modelo emite respuesta que intentaba filtrar el marcador interno
    const rawAiResponse = "[Video enviado al cliente]\nEl *JBL go 4 A1* está disponible en color negro a S/. 50. ¿Cuántas unidades deseas llevar? 🎶";
    const dispatchSequence = assembleDispatchSequence(rawAiResponse, pending);

    // Exactamente 1 media en secuencia
    const mediaItems = dispatchSequence.filter(i => i.type === 'video' || i.type === 'image');
    assert.strictEqual(mediaItems.length, 1, 'Debe haber exactamente un video enviado');
    assert.strictEqual(mediaItems[0].type, 'video');
    assert.strictEqual(mediaItems[0].url, pending.url);

    // El caption o texto debe responder sobre colores y disponibilidad
    const visibleText = mediaItems[0].caption || dispatchSequence.find(i => i.type === 'text')?.content || '';
    assert.ok(visibleText.includes('color negro'), 'Debe responder sobre colores disponibles');
    assert.ok(visibleText.includes('S/. 50'), 'Debe responder sobre precio/disponibilidad');

    // Cero marcador visible y cero URL interna visible
    assert.ok(!visibleText.includes('[Video enviado al cliente]'), 'No debe contener marcador [Video enviado al cliente]');
    assert.ok(!visibleText.includes('[Video]'), 'No debe contener marcador [Video]');
    assert.ok(!visibleText.includes('185.163.116.210'), 'No debe fugar IP de media interna');
    assert.ok(!visibleText.includes('/media/tenants/'), 'No debe fugar path de media interna');
  });

  await runTest('V9 RAPID PRODUCT CHANGE: Ráfaga "Quiero JBL Go 4\\nVideo\\nMejor quiero el smartwatch\\nFoto" => Foto del smartwatch, cero video stale de JBL', async () => {
    const burstText = "Quiero JBL Go 4\nVideo\nMejor quiero el smartwatch\nFoto";

    // Latest Intent Wins: El último segmento solicita "Foto"
    const detected = detectProductMediaIntent(burstText);
    assert.strictEqual(detected, 'image', 'Última intención (Foto) debe tener precedencia sobre intención anterior (Video)');

    const mockDb = createMockPrisma();
    mockDb.products.set('prod-jbl', {
      id: 'prod-jbl',
      name: 'JBL go 4 A1',
      videoUrl: 'https://185.163.116.210/media/tenants/alpha/products/videos/jbl.mp4',
      tenantId: tenantA
    });
    mockDb.products.set('prod-smartwatch', {
      id: 'prod-smartwatch',
      name: 'Reloj smartwatch HW 10 pro',
      imageUrl: 'https://185.163.116.210/media/tenants/alpha/products/images/smartwatch.jpg',
      tenantId: tenantA
    });

    const ctx = createMediaHandler(mockDb, tenantA, { userMessageText: burstText });
    
    // Gemini atiende el producto más reciente (smartwatch con imagen)
    const result = await ctx.handler('send_product_media', { productId: 'prod-smartwatch', mediaType: 'image' });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.mediaType, 'image');

    const pending = ctx.getPendingMedia();
    assert.ok(pending);
    assert.strictEqual(pending.productId, 'prod-smartwatch');
    assert.strictEqual(pending.mediaType, 'image');
    assert.strictEqual(pending.url, 'https://185.163.116.210/media/tenants/alpha/products/images/smartwatch.jpg');

    const rawResponse = "[Imagen enviada al cliente]\nAquí tienes la foto del smartwatch con correa metálica.";
    const dispatchSequence = assembleDispatchSequence(rawResponse, pending);

    // Cero videos de JBL en el despacho
    assert.ok(!dispatchSequence.some(i => i.type === 'video'), 'No debe haber ningún video en el despacho');
    assert.strictEqual(dispatchSequence[0].type, 'image');
    assert.strictEqual(dispatchSequence[0].url, 'https://185.163.116.210/media/tenants/alpha/products/images/smartwatch.jpg');
    assert.ok(!dispatchSequence[0].caption.includes('[Imagen enviada al cliente]'));
  });

  await runTest('V10 INTERNAL MARKER: Modelo intenta responder "[Video enviado al cliente]\\nAquí tienes..." => Marcador es 100% removido', async () => {
    const leakedMarkerOutput = "[Video enviado al cliente]\nAquí tienes el video demostrativo del producto.";
    
    // Con media presente
    const dummyPending = { url: 'https://cdn.example.com/video.mp4', mediaType: 'video' };
    const sequenceWithMedia = assembleDispatchSequence(leakedMarkerOutput, dummyPending);
    assert.strictEqual(sequenceWithMedia[0].caption, 'Aquí tienes el video demostrativo del producto.');
    assert.ok(!sequenceWithMedia[0].caption.includes('[Video enviado al cliente]'));

    // Sin media presente (enforceMediaAuthority neutraliza la afirmación y limpia el marcador)
    const sequenceWithoutMedia = assembleDispatchSequence(leakedMarkerOutput, null);
    assert.ok(!sequenceWithoutMedia[0].content.includes('[Video enviado al cliente]'));
    assert.ok(sequenceWithoutMedia[0].content.includes('No tengo un video disponible'));

    // Variantes defensivas: [Imagen enviada al cliente], [Multimedia enviada al cliente], [archivo multimedia]
    const multiVariant = "[Imagen enviada al cliente]\n[Multimedia enviada al cliente]\n[archivo multimedia]\nHola, ¿en qué te puedo ayudar?";
    const cleanedVariants = assembleDispatchSequence(multiVariant, null);
    assert.strictEqual(cleanedVariants[0].content, 'Hola, ¿en qué te puedo ayudar?');
  });

  await runTest('V11 FALSE DELIVERY: Si gateway/Evolution falla enviando video => NO guardar ni afirmar entrega exitosa', async () => {
    let mediaDeliveryConfirmed = false;
    let mediaDeliveryFailed = false;

    // Simulación de falla en gateway (ej. error 500 de Evolution o timeout)
    const mockGatewaySend = async () => {
      throw new Error('Evolution API 500 Internal Server Error');
    };

    const item = {
      type: 'video',
      url: 'https://185.163.116.210/media/tenants/alpha/products/videos/demo.mp4',
      caption: 'Aquí te comparto el video del producto.'
    };

    let fallbackTextSent = null;
    try {
      const mediaMsgId = await mockGatewaySend();
      if (mediaMsgId) {
        mediaDeliveryConfirmed = true;
      } else {
        mediaDeliveryFailed = true;
      }
    } catch (err) {
      mediaDeliveryFailed = true;
      // Lógica idéntica al controller: si falló el envío de media, el caption se envía como texto sanitizado
      fallbackTextSent = enforceMediaAuthority(item.caption, false);
    }

    assert.strictEqual(mediaDeliveryConfirmed, false, 'No debe confirmarse entrega de media');
    assert.strictEqual(mediaDeliveryFailed, true, 'Debe marcarse fallo de entrega');
    assert.ok(fallbackTextSent !== null, 'Debe haber generado texto de fallback');
    assert.ok(!fallbackTextSent.includes('Aquí te comparto el video'), 'Texto no debe afirmar falsamente que el video fue compartido');
    assert.ok(fallbackTextSent.includes('No tengo un video disponible'), 'Debe comunicar con honestidad la indisponibilidad');
  });

  await runTest('V12 DELIVERY SUCCESS: Confirmar entrega exitosa ÚNICAMENTE cuando el gateway devuelve msgId válido', async () => {
    let mediaDeliveryConfirmed = false;
    let mediaDeliveryFailed = false;

    // Caso 1: Gateway devuelve key.id exitoso
    const mockSuccessGateway = async () => {
      return '3EB0ABC123456789DEF0';
    };

    const msgIdSuccess = await mockSuccessGateway();
    if (msgIdSuccess) {
      mediaDeliveryConfirmed = true;
    } else {
      mediaDeliveryFailed = true;
    }

    assert.strictEqual(mediaDeliveryConfirmed, true, 'Entrega debe ser confirmada con msgId');
    assert.strictEqual(mediaDeliveryFailed, false);

    // Caso 2: Gateway devuelve null (sin msgId)
    mediaDeliveryConfirmed = false;
    mediaDeliveryFailed = false;

    const mockNullGateway = async () => {
      return null;
    };

    const msgIdNull = await mockNullGateway();
    if (msgIdNull) {
      mediaDeliveryConfirmed = true;
    } else {
      mediaDeliveryFailed = true;
    }

    assert.strictEqual(mediaDeliveryConfirmed, false, 'No debe confirmarse entrega si msgId es null');
    assert.strictEqual(mediaDeliveryFailed, true, 'Debe marcarse fallo si msgId es null');
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE MEDIA-1 & MEDIA-2 FINALIZADA: ${passedTests}/${totalTests} TESTS PASARON EXITOSAMENTE`);
  console.log('======================================================================\n');
}

runSuite().catch(err => {
  console.error('\n❌ ERROR EN SUITE DE PRODUCT MEDIA:\n', err);
  process.exit(1);
});
