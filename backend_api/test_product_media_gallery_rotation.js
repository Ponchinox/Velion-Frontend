import assert from 'node:assert';
import {
  getCanonicalProductImages,
  getCanonicalProductImageUrl,
  resolveProductMediaState,
  getRemainingProductImages,
  getNextUnseenProductImage,
  classifyPhotoRequestType,
  orchestrateProductMedia
} from './src/services/productMediaOrchestrator.js';
import {
  detectProductMediaIntent,
  enforceMediaAuthority
} from './src/controllers/whatsappController.js';

console.log('======================================================================');
console.log('🧪 VELION PRODUCT MEDIA GALLERY ROTATION SUITE: TESTS A - J');
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
 * Simulador de Prisma en memoria para aislar la base de datos
 */
function createMockPrisma() {
  const products = new Map();
  const customers = new Map();

  return {
    products,
    customers,
    product: {
      async findFirst({ where, select }) {
        for (const prod of products.values()) {
          if (where.id && prod.id !== where.id) continue;
          if (where.user?.tenantId && prod.tenantId !== where.user.tenantId) continue;

          const result = {};
          if (select.id) result.id = prod.id;
          if (select.name) result.name = prod.name;
          if (select.imageUrl !== undefined) result.imageUrl = prod.imageUrl;
          if (select.images !== undefined) result.images = prod.images || [];
          if (select.videoUrl !== undefined) result.videoUrl = prod.videoUrl;
          if (select.type) result.type = prod.type;
          if (select.price !== undefined) result.price = prod.price;
          if (select.isAvailable !== undefined) result.isAvailable = prod.isAvailable ?? true;
          return result;
        }
        return null;
      }
    },
    customer: {
      async findUnique({ where }) {
        return customers.get(where.id) || null;
      },
      async update({ where, data }) {
        const existing = customers.get(where.id) || { id: where.id, commercialState: {} };
        const updated = {
          ...existing,
          commercialState: data.commercialState !== undefined ? data.commercialState : existing.commercialState
        };
        customers.set(where.id, updated);
        return updated;
      }
    }
  };
}

/**
 * Simula el ciclo de vida del controlador con send_product_media y persistencia tras entrega
 */
function createConversationSession({ mockPrisma, tenantId, customerId, initialCommercialState = {} }) {
  let customer = { id: customerId, commercialState: { ...initialCommercialState } };
  mockPrisma.customers.set(customerId, customer);

  let currentCommercialState = { ...initialCommercialState };
  let pendingMediaToSend = null;
  let mediaSentInSession = false;
  let userMessageText = '';
  let providerCallsCount = 0;

  const updateLastConsultedProduct = async (prodId, prodName) => {
    if (!prodId) return;
    currentCommercialState.lastConsultedProductId = prodId;
    if (prodName) currentCommercialState.lastConsultedProductName = prodName;
    if (customer?.id) {
      const refreshed = await mockPrisma.customer.findUnique({ where: { id: customer.id } });
      const cState = (typeof refreshed?.commercialState === 'object' && refreshed?.commercialState !== null)
        ? { ...refreshed.commercialState }
        : { ...currentCommercialState };
      cState.lastConsultedProductId = prodId;
      if (prodName) cState.lastConsultedProductName = prodName;
      await mockPrisma.customer.update({
        where: { id: customer.id },
        data: { commercialState: cState }
      });
      currentCommercialState = cState;
    }
  };

  const toolsHandler = async (funcName, args) => {
    if (funcName === 'send_product_media') {
      const rawProductId = args?.productId;
      const productId = typeof rawProductId === 'string' ? rawProductId.trim() : String(rawProductId || '').trim();
      const rawMediaType = args?.mediaType;
      const detectedType = detectProductMediaIntent(userMessageText);
      const requestedMediaType = (rawMediaType === 'video' || (detectedType === 'video' && rawMediaType !== 'image'))
        ? 'video'
        : 'image';

      if (!productId) {
        return { success: false, hasMedia: false, reason: 'INVALID_PRODUCT_ID', message: 'Se requiere un productId válido.' };
      }

      const product = await mockPrisma.product.findFirst({
        where: { id: productId, user: { tenantId } },
        select: { id: true, name: true, imageUrl: true, images: true, videoUrl: true, type: true }
      });

      if (!product) {
        return {
          success: false,
          hasMedia: false,
          reason: requestedMediaType === 'video' ? 'NO_VIDEO_REGISTERED' : 'NO_IMAGE_REGISTERED',
          message: 'El producto no fue encontrado en esta tienda. Informa con amabilidad al cliente.'
        };
      }

      let targetMediaUrls = [];
      if (requestedMediaType === 'video') {
        if (product.videoUrl && typeof product.videoUrl === 'string' && product.videoUrl.trim() !== '' && product.videoUrl.trim() !== 'Sin video') {
          targetMediaUrls = [product.videoUrl.trim()];
        }
        if (targetMediaUrls.length === 0) {
          return {
            success: false,
            hasMedia: false,
            reason: 'NO_VIDEO_REGISTERED',
            message: `El producto o servicio "${product.name}" no cuenta con un video registrado.`
          };
        }
      } else {
        const canonicalImages = getCanonicalProductImages(product);
        if (canonicalImages.length === 0) {
          return {
            success: false,
            hasMedia: false,
            reason: 'NO_IMAGE_REGISTERED',
            message: `El producto o servicio "${product.name}" no cuenta con una imagen o foto registrada.`
          };
        }

        const mediaState = resolveProductMediaState(currentCommercialState, product.id);
        const { nextImageUrl, remainingImages, isExhausted } = getNextUnseenProductImage(product, mediaState);

        if (isExhausted) {
          const isSingleImageProduct = canonicalImages.length === 1;
          const exhaustionMessage = isSingleImageProduct
            ? `Por el momento solo contamos con esta foto de "${product.name}".`
            : `Ya se compartieron todas las fotos disponibles de "${product.name}" en el catálogo digital (${canonicalImages.length} de ${canonicalImages.length}).`;

          return {
            success: false,
            hasMedia: false,
            allImagesSent: true,
            totalImages: canonicalImages.length,
            isSingleImage: isSingleImageProduct,
            reason: 'ALL_PRODUCT_IMAGES_ALREADY_SENT',
            message: exhaustionMessage
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

      if (mediaSentInSession && !pendingMediaToSend) {
        return {
          success: false,
          hasMedia: false,
          reason: 'MEDIA_ALREADY_QUEUED',
          message: 'Ya se preparó y despachó un elemento multimedia para este turno. No se permiten envíos duplicados.'
        };
      }

      if (pendingMediaToSend) {
        if (pendingMediaToSend.productId === product.id) {
          return {
            success: true,
            hasMedia: true,
            alreadyQueued: true,
            mediaType: pendingMediaToSend.mediaType,
            productName: pendingMediaToSend.productName,
            urls: pendingMediaToSend.urls,
            message: `La multimedia oficial de "${pendingMediaToSend.productName}" ya está programada.`
          };
        }

        if (pendingMediaToSend.source === 'auto_orchestrator') {
          pendingMediaToSend = {
            productId: product.id,
            productName: product.name,
            url: targetMediaUrls[0],
            urls: targetMediaUrls,
            mediaType: requestedMediaType,
            source: 'explicit_tool'
          };
          mediaSentInSession = true;
          await updateLastConsultedProduct(product.id, product.name);
          return {
            success: true,
            hasMedia: true,
            mediaType: requestedMediaType,
            productName: product.name,
            urls: targetMediaUrls,
            message: `La multimedia de "${product.name}" ha reemplazado la anterior.`
          };
        }

        return {
          success: false,
          hasMedia: false,
          reason: 'MEDIA_ALREADY_QUEUED',
          message: 'Ya se preparó un elemento multimedia para este turno. No se permiten envíos duplicados.'
        };
      }

      pendingMediaToSend = {
        productId: product.id,
        productName: product.name,
        url: targetMediaUrls[0],
        urls: targetMediaUrls,
        mediaType: requestedMediaType,
        source: 'explicit_tool'
      };
      mediaSentInSession = true;
      await updateLastConsultedProduct(product.id, product.name);

      return {
        success: true,
        hasMedia: true,
        mediaType: requestedMediaType,
        productName: product.name,
        url: targetMediaUrls[0],
        urls: targetMediaUrls,
        itemCount: targetMediaUrls.length,
        message: targetMediaUrls.length > 1
          ? 'Claro, te comparto las demás fotos que tenemos de este modelo.'
          : `Multimedia de "${product.name}" preparada.`
      };
    }

    return { error: 'Unknown function' };
  };

  /**
   * Simula el dispatch físico hacia el provider/gateway de cada asset en urls.
   * SOLO persiste en DB las URLs cuyo despacho físico haya sido exitoso.
   */
  const simulateDispatch = async ({ providerSuccess = true } = {}) => {
    if (!pendingMediaToSend) return { dispatched: false, providerCalls: 0 };

    const item = pendingMediaToSend;
    pendingMediaToSend = null;

    const urls = (Array.isArray(item.urls) && item.urls.length > 0)
      ? item.urls
      : (item.url ? [item.url] : []);

    let successCount = 0;
    let failCount = 0;

    const refreshedCustomer = await mockPrisma.customer.findUnique({ where: { id: customer.id } });
    const cState = (typeof refreshedCustomer?.commercialState === 'object' && refreshedCustomer?.commercialState !== null)
      ? { ...refreshedCustomer.commercialState }
      : { ...currentCommercialState };

    const curSent = Array.isArray(cState.sentMediaProductIds) ? [...cState.sentMediaProductIds] : [];
    let pMediaState = (cState.productMediaState && cState.productMediaState.productId === item.productId && Array.isArray(cState.productMediaState.sentImageUrls))
      ? { ...cState.productMediaState, sentImageUrls: [...cState.productMediaState.sentImageUrls] }
      : { productId: item.productId, sentImageUrls: [], updatedAt: new Date().toISOString() };

    for (let i = 0; i < urls.length; i++) {
      providerCallsCount++;
      const currentUrl = urls[i];
      const isSuccess = typeof providerSuccess === 'function'
        ? providerSuccess(currentUrl, i)
        : Boolean(providerSuccess);

      if (isSuccess) {
        successCount++;
        if (!curSent.includes(item.productId)) {
          curSent.push(item.productId);
          cState.sentMediaProductIds = curSent;
        }
        if (item.mediaType === 'image' && !pMediaState.sentImageUrls.includes(currentUrl)) {
          pMediaState.sentImageUrls.push(currentUrl);
          pMediaState.updatedAt = new Date().toISOString();
          cState.productMediaState = pMediaState;
        }
      } else {
        failCount++;
      }
    }

    if (successCount > 0) {
      await mockPrisma.customer.update({
        where: { id: customer.id },
        data: { commercialState: cState }
      });
      currentCommercialState = cState;
    }

    return {
      dispatched: successCount > 0,
      providerCalls: urls.length,
      successCount,
      failCount,
      sentItem: item
    };
  };

  const startNewTurn = (userText = '') => {
    userMessageText = userText;
    pendingMediaToSend = null;
    mediaSentInSession = false;
  };

  return {
    toolsHandler,
    simulateDispatch,
    startNewTurn,
    getCommercialState: () => currentCommercialState,
    getPendingMedia: () => pendingMediaToSend,
    setPendingMedia: (m) => { pendingMediaToSend = m; },
    getProviderCallsCount: () => providerCallsCount,
    updateLastConsultedProduct
  };
}

async function runSuite() {
  const tenantAlpha = 'tenant-alpha-uuid';
  const tenantBeta = 'tenant-beta-uuid';

  const productWith4Images = {
    id: 'prod-reloj-geneva',
    name: 'Reloj Geneva + pulsera diseño black',
    imageUrl: 'https://cdn.example.com/portada_geneva.jpg',
    images: [
      'https://cdn.example.com/galeria_geneva_1.jpg',
      'https://cdn.example.com/galeria_geneva_2.jpg',
      'https://cdn.example.com/galeria_geneva_3.jpg'
    ],
    videoUrl: 'https://cdn.example.com/video_geneva.mp4',
    price: 99,
    tenantId: tenantAlpha,
    type: 'PHYSICAL_PRODUCT'
  };

  const productSingleImage = {
    id: 'prod-single-img',
    name: 'Cargador Rápido 20W',
    imageUrl: 'https://cdn.example.com/cargador_portada.jpg',
    images: [],
    videoUrl: null,
    price: 45,
    tenantId: tenantAlpha,
    type: 'PHYSICAL_PRODUCT'
  };

  const productForeign = {
    id: 'prod-foreign-shoes',
    name: 'Zapatos de Otro Tenant',
    imageUrl: 'https://cdn.example.com/shoes.jpg',
    images: ['https://cdn.example.com/shoes_2.jpg'],
    tenantId: tenantBeta,
    type: 'PHYSICAL_PRODUCT'
  };

  // =============================================================================
  // TEST A: 4 imágenes, ninguna enviada. "foto" => portada solamente.
  // =============================================================================
  await runTest('TEST A: 4 imágenes, ninguna enviada. "foto" => portada solamente', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productWith4Images.id, productWith4Images);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-test-a'
    });

    session.startNewTurn('foto');
    const result = await session.toolsHandler('send_product_media', { productId: productWith4Images.id, mediaType: 'image' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.hasMedia, true);
    assert.strictEqual(result.urls.length, 1, 'Petición inicial genérica de foto debe enviar exactamente 1 imagen');
    assert.strictEqual(result.urls[0], productWith4Images.imageUrl, 'Debe ser la portada (índice 0)');

    const dispatchRes = await session.simulateDispatch({ providerSuccess: true });
    assert.strictEqual(dispatchRes.dispatched, true);
    assert.strictEqual(dispatchRes.providerCalls, 1);

    const cState = session.getCommercialState();
    assert.deepStrictEqual(cState.productMediaState.sentImageUrls, [productWith4Images.imageUrl]);
  });

  // =============================================================================
  // TEST B: portada ya enviada. "otra foto" => Gallery 1 solamente.
  // =============================================================================
  await runTest('TEST B: portada ya enviada. "otra foto" => Gallery 1 solamente', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productWith4Images.id, productWith4Images);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-test-b',
      initialCommercialState: {
        lastConsultedProductId: productWith4Images.id,
        sentMediaProductIds: [productWith4Images.id],
        productMediaState: {
          productId: productWith4Images.id,
          sentImageUrls: [productWith4Images.imageUrl],
          updatedAt: new Date().toISOString()
        }
      }
    });

    session.startNewTurn('otra foto');
    const result = await session.toolsHandler('send_product_media', { productId: productWith4Images.id, mediaType: 'image' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.urls.length, 1, '"otra foto" debe enviar ÚNICAMENTE 1 siguiente asset');
    assert.strictEqual(result.urls[0], productWith4Images.images[0], 'Debe ser Gallery 1');
    assert.notStrictEqual(result.urls[0], productWith4Images.imageUrl);

    await session.simulateDispatch({ providerSuccess: true });
    const cState = session.getCommercialState();
    assert.deepStrictEqual(cState.productMediaState.sentImageUrls, [
      productWith4Images.imageUrl,
      productWith4Images.images[0]
    ]);
  });

  // =============================================================================
  // TEST C: portada ya enviada. "más fotos" => Gallery 1 + Gallery 2 + Gallery 3
  //         => 3 assets distintos => portada no repetida.
  // =============================================================================
  await runTest('TEST C: portada ya enviada. "más fotos" => Gallery 1 + 2 + 3 (3 assets, sin repetir portada)', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productWith4Images.id, productWith4Images);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-test-c',
      initialCommercialState: {
        lastConsultedProductId: productWith4Images.id,
        sentMediaProductIds: [productWith4Images.id],
        productMediaState: {
          productId: productWith4Images.id,
          sentImageUrls: [productWith4Images.imageUrl],
          updatedAt: new Date().toISOString()
        }
      }
    });

    session.startNewTurn('más fotos por favor');
    const result = await session.toolsHandler('send_product_media', { productId: productWith4Images.id, mediaType: 'image' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.urls.length, 3, '"más fotos" debe enviar todas las restantes (3 imágenes)');
    assert.deepStrictEqual(result.urls, productWith4Images.images);
    assert.ok(!result.urls.includes(productWith4Images.imageUrl), 'La portada NO debe volver a incluirse');
    assert.ok(result.message.includes('demás fotos'));

    const dispatchRes = await session.simulateDispatch({ providerSuccess: true });
    assert.strictEqual(dispatchRes.dispatched, true);
    assert.strictEqual(dispatchRes.providerCalls, 3);

    const cState = session.getCommercialState();
    assert.deepStrictEqual(cState.productMediaState.sentImageUrls, [
      productWith4Images.imageUrl,
      ...productWith4Images.images
    ]);
  });

  // =============================================================================
  // TEST D: portada + Gallery 1 enviadas. "más fotos" => Gallery 2 + Gallery 3 solamente.
  // =============================================================================
  await runTest('TEST D: portada + Gallery 1 enviadas. "más fotos" => Gallery 2 + Gallery 3 solamente', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productWith4Images.id, productWith4Images);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-test-d',
      initialCommercialState: {
        lastConsultedProductId: productWith4Images.id,
        sentMediaProductIds: [productWith4Images.id],
        productMediaState: {
          productId: productWith4Images.id,
          sentImageUrls: [productWith4Images.imageUrl, productWith4Images.images[0]],
          updatedAt: new Date().toISOString()
        }
      }
    });

    session.startNewTurn('¿tienes más fotos?');
    const result = await session.toolsHandler('send_product_media', { productId: productWith4Images.id, mediaType: 'image' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.urls.length, 2, 'Debe enviar exactamente las 2 restantes');
    assert.strictEqual(result.urls[0], productWith4Images.images[1], 'Gallery 2');
    assert.strictEqual(result.urls[1], productWith4Images.images[2], 'Gallery 3');

    await session.simulateDispatch({ providerSuccess: true });
    const cState = session.getCommercialState();
    assert.deepStrictEqual(cState.productMediaState.sentImageUrls, [
      productWith4Images.imageUrl,
      productWith4Images.images[0],
      productWith4Images.images[1],
      productWith4Images.images[2]
    ]);
  });

  // =============================================================================
  // TEST E: todas enviadas. "más fotos" => provider calls 0
  //         => ALL_PRODUCT_IMAGES_ALREADY_SENT => texto explícito de galería agotada.
  // =============================================================================
  await runTest('TEST E: todas enviadas. "más fotos" => provider calls 0 + ALL_PRODUCT_IMAGES_ALREADY_SENT', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productWith4Images.id, productWith4Images);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-test-e',
      initialCommercialState: {
        lastConsultedProductId: productWith4Images.id,
        sentMediaProductIds: [productWith4Images.id],
        productMediaState: {
          productId: productWith4Images.id,
          sentImageUrls: [
            productWith4Images.imageUrl,
            productWith4Images.images[0],
            productWith4Images.images[1],
            productWith4Images.images[2]
          ],
          updatedAt: new Date().toISOString()
        }
      }
    });

    session.startNewTurn('más fotos');
    const result = await session.toolsHandler('send_product_media', { productId: productWith4Images.id, mediaType: 'image' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.hasMedia, false);
    assert.strictEqual(result.allImagesSent, true);
    assert.strictEqual(result.reason, 'ALL_PRODUCT_IMAGES_ALREADY_SENT');
    assert.ok(result.message.includes('Ya se compartieron todas las fotos disponibles'));

    const dispatchRes = await session.simulateDispatch();
    assert.strictEqual(dispatchRes.providerCalls, 0, 'Provider calls deben ser exactamente 0');
  });

  // =============================================================================
  // TEST F: producto con una sola imagen ya enviada. "más fotos" => provider calls 0
  //         => texto indica que solo existe esa foto.
  // =============================================================================
  await runTest('TEST F: producto con 1 sola imagen ya enviada. "más fotos" => provider calls 0 + texto foto única', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productSingleImage.id, productSingleImage);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-test-f',
      initialCommercialState: {
        lastConsultedProductId: productSingleImage.id,
        sentMediaProductIds: [productSingleImage.id],
        productMediaState: {
          productId: productSingleImage.id,
          sentImageUrls: [productSingleImage.imageUrl],
          updatedAt: new Date().toISOString()
        }
      }
    });

    session.startNewTurn('más fotos');
    const result = await session.toolsHandler('send_product_media', { productId: productSingleImage.id, mediaType: 'image' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.allImagesSent, true);
    assert.strictEqual(result.isSingleImage, true);
    assert.strictEqual(result.reason, 'ALL_PRODUCT_IMAGES_ALREADY_SENT');
    assert.ok(result.message.includes('solo contamos con esta foto'));

    const dispatchRes = await session.simulateDispatch();
    assert.strictEqual(dispatchRes.providerCalls, 0);
  });

  // =============================================================================
  // TEST G: durante multi-send falla Gallery 2:
  //         => Gallery 1 y 3 exitosas se registran si fueron entregadas
  //         => Gallery 2 NO se consume
  //         => petición posterior puede reenviar Gallery 2.
  // =============================================================================
  await runTest('TEST G: durante multi-send falla Gallery 2 => 1 y 3 registradas, 2 NO consumida y reintentable', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productWith4Images.id, productWith4Images);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-test-g',
      initialCommercialState: {
        lastConsultedProductId: productWith4Images.id,
        sentMediaProductIds: [productWith4Images.id],
        productMediaState: {
          productId: productWith4Images.id,
          sentImageUrls: [productWith4Images.imageUrl],
          updatedAt: new Date().toISOString()
        }
      }
    });

    // 1. Cliente pide más fotos (intenta enviar Gallery 1, 2 y 3)
    session.startNewTurn('más fotos');
    const result1 = await session.toolsHandler('send_product_media', { productId: productWith4Images.id, mediaType: 'image' });
    assert.strictEqual(result1.urls.length, 3);

    // 2. Simular que falla la segunda imagen (Gallery 2)
    const dispatchRes = await session.simulateDispatch({
      providerSuccess: (url) => url !== productWith4Images.images[1] // Falla Gallery 2
    });

    assert.strictEqual(dispatchRes.successCount, 2);
    assert.strictEqual(dispatchRes.failCount, 1);

    // Verificar que sentImageUrls contiene cover, Gallery 1 y Gallery 3, pero NO Gallery 2
    const cState = session.getCommercialState();
    assert.deepStrictEqual(cState.productMediaState.sentImageUrls, [
      productWith4Images.imageUrl,
      productWith4Images.images[0],
      productWith4Images.images[2]
    ]);

    // 3. Petición posterior: el cliente vuelve a pedir foto
    session.startNewTurn('otra foto');
    const result2 = await session.toolsHandler('send_product_media', { productId: productWith4Images.id, mediaType: 'image' });
    assert.strictEqual(result2.success, true);
    assert.strictEqual(result2.urls[0], productWith4Images.images[1], 'Debe volver a seleccionar Gallery 2');
  });

  // =============================================================================
  // TEST H: "otra foto" => nunca manda múltiples imágenes.
  // =============================================================================
  await runTest('TEST H: "otra foto" => nunca manda múltiples imágenes', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productWith4Images.id, productWith4Images);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-test-h',
      initialCommercialState: {
        lastConsultedProductId: productWith4Images.id,
        sentMediaProductIds: [productWith4Images.id],
        productMediaState: {
          productId: productWith4Images.id,
          sentImageUrls: [productWith4Images.imageUrl],
          updatedAt: new Date().toISOString()
        }
      }
    });

    const testPhrases = ['otra foto', 'muéstrame otra', 'una más', 'otra'];
    for (const phrase of testPhrases) {
      session.startNewTurn(phrase);
      const res = await session.toolsHandler('send_product_media', { productId: productWith4Images.id, mediaType: 'image' });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.urls.length, 1, `La frase "${phrase}" debe devolver exactamente 1 imagen, no múltiples`);
    }
  });

  // =============================================================================
  // TEST I: Video request => comportamiento existente intacto.
  // =============================================================================
  await runTest('TEST I: Video request => comportamiento existente intacto', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productWith4Images.id, productWith4Images);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-test-i',
      initialCommercialState: {
        productMediaState: {
          productId: productWith4Images.id,
          sentImageUrls: [productWith4Images.imageUrl],
          updatedAt: new Date().toISOString()
        }
      }
    });

    session.startNewTurn('¿Tienes video del Reloj Geneva?');
    const result = await session.toolsHandler('send_product_media', { productId: productWith4Images.id, mediaType: 'video' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.mediaType, 'video');
    assert.strictEqual(result.url, productWith4Images.videoUrl);

    await session.simulateDispatch({ providerSuccess: true });
    const cState = session.getCommercialState();
    assert.deepStrictEqual(cState.productMediaState.sentImageUrls, [productWith4Images.imageUrl], 'No debe mutar sentImageUrls con videos');
  });

  // =============================================================================
  // TEST J: Cross-tenant product => bloqueado igual que actualmente.
  // =============================================================================
  await runTest('TEST J: Cross-tenant product => bloqueado fail-closed', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productForeign.id, productForeign);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha, // Tenant Alpha no posee productForeign (Beta)
      customerId: 'cust-test-j'
    });

    session.startNewTurn('más fotos de los zapatos');
    const result = await session.toolsHandler('send_product_media', { productId: productForeign.id, mediaType: 'image' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.hasMedia, false);
    assert.strictEqual(result.reason, 'NO_IMAGE_REGISTERED');
    assert.strictEqual(session.getPendingMedia(), null);
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE MULTI-PHOTO GALLERY UX: ${passedTests}/${totalTests} TESTS PASARON EXITOSAMENTE`);
  console.log('======================================================================\n');
}

runSuite().catch(err => {
  console.error('\n❌ ERROR FATAL EN SUITE DE TESTS:\n', err);
  process.exit(1);
});
