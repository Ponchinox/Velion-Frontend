import assert from 'node:assert';
import {
  getCanonicalProductImages,
  getCanonicalProductImageUrl,
  resolveProductMediaState,
  getNextUnseenProductImage,
  orchestrateProductMedia
} from './src/services/productMediaOrchestrator.js';
import {
  detectProductMediaIntent,
  enforceMediaAuthority
} from './src/controllers/whatsappController.js';

console.log('======================================================================');
console.log('🧪 VELION PRODUCT MEDIA GALLERY ROTATION SUITE: TESTS A - K');
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

      let targetMediaUrl = null;
      if (requestedMediaType === 'video') {
        if (product.videoUrl && typeof product.videoUrl === 'string' && product.videoUrl.trim() !== '' && product.videoUrl.trim() !== 'Sin video') {
          targetMediaUrl = product.videoUrl.trim();
        }
        if (!targetMediaUrl) {
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
        const { nextImageUrl, isExhausted } = getNextUnseenProductImage(product, mediaState);

        if (isExhausted) {
          return {
            success: false,
            hasMedia: false,
            allImagesSent: true,
            reason: 'ALL_PRODUCT_IMAGES_ALREADY_SENT',
            message: `Ya se compartieron todas las fotos disponibles de "${product.name}" en el catálogo digital (${canonicalImages.length} de ${canonicalImages.length}). Explica amablemente al cliente que ya le mostraste todas las fotos registradas de este producto. NO afirmes que vas a enviar otra foto ni que adjuntas una nueva vista.`
          };
        }

        targetMediaUrl = nextImageUrl;
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
            message: `La multimedia oficial de "${pendingMediaToSend.productName}" ya está programada.`
          };
        }

        if (pendingMediaToSend.source === 'auto_orchestrator') {
          pendingMediaToSend = {
            productId: product.id,
            productName: product.name,
            url: targetMediaUrl,
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
        url: targetMediaUrl,
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
        url: targetMediaUrl,
        message: `Multimedia de "${product.name}" preparada.`
      };
    }

    return { error: 'Unknown function' };
  };

  /**
   * Simula el dispatch físico hacia el provider/gateway.
   * SOLO persiste en DB si providerSuccess es true.
   */
  const simulateDispatch = async ({ providerSuccess = true } = {}) => {
    if (!pendingMediaToSend) return { dispatched: false, providerCalls: 0 };

    providerCallsCount++;
    if (!providerSuccess) {
      // Fallo de red/gateway: NO persistir como enviado
      const itemToClear = pendingMediaToSend;
      pendingMediaToSend = null;
      return { dispatched: false, providerCalls: 1, failedItem: itemToClear };
    }

    const item = pendingMediaToSend;
    pendingMediaToSend = null;

    // Persistir exactamente como en el controller
    const refreshedCustomer = await mockPrisma.customer.findUnique({ where: { id: customer.id } });
    const cState = (typeof refreshedCustomer?.commercialState === 'object' && refreshedCustomer?.commercialState !== null)
      ? { ...refreshedCustomer.commercialState }
      : { ...currentCommercialState };

    const curSent = Array.isArray(cState.sentMediaProductIds) ? [...cState.sentMediaProductIds] : [];
    if (!curSent.includes(item.productId)) {
      curSent.push(item.productId);
      cState.sentMediaProductIds = curSent;
    }

    if (item.mediaType === 'image') {
      let pMediaState = (cState.productMediaState && cState.productMediaState.productId === item.productId && Array.isArray(cState.productMediaState.sentImageUrls))
        ? { ...cState.productMediaState, sentImageUrls: [...cState.productMediaState.sentImageUrls] }
        : { productId: item.productId, sentImageUrls: [], updatedAt: new Date().toISOString() };

      if (item.url && !pMediaState.sentImageUrls.includes(item.url)) {
        pMediaState.sentImageUrls.push(item.url);
        pMediaState.updatedAt = new Date().toISOString();
        cState.productMediaState = pMediaState;
      }
    }

    await mockPrisma.customer.update({
      where: { id: customer.id },
      data: { commercialState: cState }
    });
    currentCommercialState = cState;

    return { dispatched: true, providerCalls: 1, sentItem: item };
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

  const productB = {
    id: 'prod-smartwatch-v9',
    name: 'Smartwatch V9 Pro',
    imageUrl: 'https://cdn.example.com/portada_watch_v9.jpg',
    images: [
      'https://cdn.example.com/galeria_watch_v9_1.jpg'
    ],
    videoUrl: null,
    price: 150,
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
  // TEST A: Producto con portada + 3 imágenes. Primera solicitud => portada.
  // =============================================================================
  await runTest('TEST A: Producto con portada + 3 imágenes. Primera solicitud => portada', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productWith4Images.id, productWith4Images);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-test-a'
    });

    session.startNewTurn('¿Tienes fotos del Reloj Geneva?');
    const result = await session.toolsHandler('send_product_media', { productId: productWith4Images.id, mediaType: 'image' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.hasMedia, true);
    assert.strictEqual(result.url, productWith4Images.imageUrl, 'La primera solicitud debe resolver la portada (índice 0)');

    // Despachar exitosamente
    const dispatchRes = await session.simulateDispatch({ providerSuccess: true });
    assert.strictEqual(dispatchRes.dispatched, true);

    const cState = session.getCommercialState();
    assert.ok(cState.productMediaState, 'productMediaState debe existir');
    assert.strictEqual(cState.productMediaState.productId, productWith4Images.id);
    assert.deepStrictEqual(cState.productMediaState.sentImageUrls, [productWith4Images.imageUrl]);
  });

  // =============================================================================
  // TEST B: Mismo producto. "Más fotos" => Galería 1 (!= portada).
  // =============================================================================
  await runTest('TEST B: Mismo producto. "Más fotos" => Galería 1 (!= portada)', async () => {
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

    session.startNewTurn('Más fotos por favor');
    const result = await session.toolsHandler('send_product_media', { productId: productWith4Images.id, mediaType: 'image' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.hasMedia, true);
    assert.strictEqual(result.url, productWith4Images.images[0], 'Debe resolver la primera imagen de la galería');
    assert.notStrictEqual(result.url, productWith4Images.imageUrl, 'Galería 1 debe ser diferente a la portada');

    await session.simulateDispatch({ providerSuccess: true });
    const cState = session.getCommercialState();
    assert.deepStrictEqual(cState.productMediaState.sentImageUrls, [
      productWith4Images.imageUrl,
      productWith4Images.images[0]
    ]);
  });

  // =============================================================================
  // TEST C: Otra solicitud => Galería 2.
  // =============================================================================
  await runTest('TEST C: Otra solicitud => Galería 2', async () => {
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
          sentImageUrls: [productWith4Images.imageUrl, productWith4Images.images[0]],
          updatedAt: new Date().toISOString()
        }
      }
    });

    session.startNewTurn('¿Tienes otra foto?');
    const result = await session.toolsHandler('send_product_media', { productId: productWith4Images.id, mediaType: 'image' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.hasMedia, true);
    assert.strictEqual(result.url, productWith4Images.images[1], 'Debe resolver la segunda imagen de la galería');

    await session.simulateDispatch({ providerSuccess: true });
    const cState = session.getCommercialState();
    assert.deepStrictEqual(cState.productMediaState.sentImageUrls, [
      productWith4Images.imageUrl,
      productWith4Images.images[0],
      productWith4Images.images[1]
    ]);
  });

  // =============================================================================
  // TEST D: Otra solicitud => Galería 3.
  // =============================================================================
  await runTest('TEST D: Otra solicitud => Galería 3', async () => {
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
          sentImageUrls: [
            productWith4Images.imageUrl,
            productWith4Images.images[0],
            productWith4Images.images[1]
          ],
          updatedAt: new Date().toISOString()
        }
      }
    });

    session.startNewTurn('Muéstrame otra');
    const result = await session.toolsHandler('send_product_media', { productId: productWith4Images.id, mediaType: 'image' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.hasMedia, true);
    assert.strictEqual(result.url, productWith4Images.images[2], 'Debe resolver la tercera imagen de la galería');

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
  // TEST E: Quinta solicitud después de las 4 => ALL_PRODUCT_IMAGES_ALREADY_SENT
  //         => provider calls = 0 => no portada repetida.
  // =============================================================================
  await runTest('TEST E: Quinta solicitud después de las 4 => ALL_PRODUCT_IMAGES_ALREADY_SENT => provider calls = 0', async () => {
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

    session.startNewTurn('¿Tienes alguna foto más?');
    const initialCalls = session.getProviderCallsCount();

    // 1. send_product_media tool invocation
    const toolResult = await session.toolsHandler('send_product_media', { productId: productWith4Images.id, mediaType: 'image' });

    assert.strictEqual(toolResult.success, false);
    assert.strictEqual(toolResult.hasMedia, false);
    assert.strictEqual(toolResult.allImagesSent, true);
    assert.strictEqual(toolResult.reason, 'ALL_PRODUCT_IMAGES_ALREADY_SENT');
    assert.ok(toolResult.message.includes('Ya se compartieron todas las fotos disponibles'));

    // 2. No pendingMediaToSend should exist
    assert.strictEqual(session.getPendingMedia(), null);

    // 3. Provider calls must remain 0
    const dispatchRes = await session.simulateDispatch();
    assert.strictEqual(dispatchRes.dispatched, false);
    assert.strictEqual(session.getProviderCallsCount() - initialCalls, 0, 'Provider calls deben ser exactamente 0');

    // 4. orchestrateProductMedia also returns exhausted
    const orchResult = orchestrateProductMedia({
      userMessageText: '¿Tienes alguna foto más?',
      availableProducts: [productWith4Images],
      currentCommercialState: session.getCommercialState(),
      sentMediaProductIds: [productWith4Images.id]
    });
    assert.strictEqual(orchResult.shouldDispatch, false);
    assert.strictEqual(orchResult.reason, 'ALL_PRODUCT_IMAGES_ALREADY_SENT');
    assert.strictEqual(orchResult.url, null, 'No debe retornar la portada');
  });

  // =============================================================================
  // TEST F: Falla provider enviando Galería 1 => Galería 1 NO queda marcada como enviada
  //         => siguiente intento puede seleccionar Galería 1.
  // =============================================================================
  await runTest('TEST F: Falla provider enviando Galería 1 => Galería 1 NO queda marcada como enviada', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productWith4Images.id, productWith4Images);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-test-f',
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

    // Intento 1: se resuelve Galería 1
    session.startNewTurn('Más fotos por favor');
    const result1 = await session.toolsHandler('send_product_media', { productId: productWith4Images.id, mediaType: 'image' });
    assert.strictEqual(result1.url, productWith4Images.images[0]);

    // Provider FALLA
    const dispatchRes = await session.simulateDispatch({ providerSuccess: false });
    assert.strictEqual(dispatchRes.dispatched, false);

    // Verificar que NO se persistió Galería 1
    const cStateAfterFail = session.getCommercialState();
    assert.deepStrictEqual(cStateAfterFail.productMediaState.sentImageUrls, [productWith4Images.imageUrl], 'Galería 1 no debe haberse guardado');

    // Intento 2 (reintento del cliente): vuelve a seleccionar Galería 1
    session.startNewTurn('Reintento foto');
    const result2 = await session.toolsHandler('send_product_media', { productId: productWith4Images.id, mediaType: 'image' });
    assert.strictEqual(result2.url, productWith4Images.images[0], 'Debe volver a ofrecer Galería 1 porque no se consumió');
  });

  // =============================================================================
  // TEST G: Producto A portada enviada -> cambio a Producto B -> "Más fotos"
  //         => únicamente assets B => cero assets A.
  // =============================================================================
  await runTest('TEST G: Producto A portada enviada -> cambio a Producto B -> "Más fotos" => únicamente assets B (cero de A)', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productWith4Images.id, productWith4Images);
    mockDb.products.set(productB.id, productB);

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

    // 1. Cliente cambia a Producto B y pide fotos de B
    session.startNewTurn('Ahora quiero ver el Smartwatch V9 Pro');
    const resB1 = await session.toolsHandler('send_product_media', { productId: productB.id, mediaType: 'image' });
    assert.strictEqual(resB1.url, productB.imageUrl, 'Debe enviar portada de B');
    await session.simulateDispatch({ providerSuccess: true });

    // productMediaState debe haber reseteado y cambiado a B
    const stateB = session.getCommercialState();
    assert.strictEqual(stateB.productMediaState.productId, productB.id);
    assert.deepStrictEqual(stateB.productMediaState.sentImageUrls, [productB.imageUrl]);

    // 2. Cliente pide "Más fotos"
    session.startNewTurn('Más fotos');
    const resB2 = await session.toolsHandler('send_product_media', { productId: productB.id, mediaType: 'image' });
    assert.strictEqual(resB2.url, productB.images[0], 'Debe enviar Galería 1 de B');
    assert.ok(!resB2.url.includes('geneva'), 'NUNCA debe enviar una imagen de A');
  });

  // =============================================================================
  // TEST H: product.imageUrl también aparece dentro de product.images[]
  //         => canonicalImages deduplicado => no falso asset adicional.
  // =============================================================================
  await runTest('TEST H: product.imageUrl duplicado en product.images[] => canonicalImages deduplicado', async () => {
    const productWithDuplicates = {
      id: 'prod-dup',
      name: 'Audífonos con imagen repetida',
      imageUrl: 'https://cdn.example.com/earbuds_cover.jpg',
      images: [
        'https://cdn.example.com/earbuds_cover.jpg', // DUPLICADO de imageUrl
        'https://cdn.example.com/earbuds_angle2.jpg',
        '   ', // vacío
        null,
        'Sin imagen'
      ]
    };

    const canonical = getCanonicalProductImages(productWithDuplicates);
    assert.strictEqual(canonical.length, 2, 'Debe haber exactamente 2 imágenes únicas válidas');
    assert.strictEqual(canonical[0], 'https://cdn.example.com/earbuds_cover.jpg');
    assert.strictEqual(canonical[1], 'https://cdn.example.com/earbuds_angle2.jpg');
  });

  // =============================================================================
  // TEST I: Cross-tenant product => bloqueado igual que actualmente.
  // =============================================================================
  await runTest('TEST I: Cross-tenant product => bloqueado fail-closed', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productForeign.id, productForeign);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha, // Tenant Alpha no es dueño de productForeign (Beta)
      customerId: 'cust-test-i'
    });

    session.startNewTurn('Quiero ver los zapatos');
    const result = await session.toolsHandler('send_product_media', { productId: productForeign.id, mediaType: 'image' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.hasMedia, false);
    assert.strictEqual(result.reason, 'NO_IMAGE_REGISTERED');
    assert.strictEqual(session.getPendingMedia(), null);
  });

  // =============================================================================
  // TEST J: Video request => comportamiento existente intacto.
  // =============================================================================
  await runTest('TEST J: Video request => comportamiento existente intacto', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productWith4Images.id, productWith4Images);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-test-j',
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
    // sentImageUrls solo debe rastrear imágenes, no URLs de videos
    assert.deepStrictEqual(cState.productMediaState.sentImageUrls, [productWith4Images.imageUrl]);
  });

  // =============================================================================
  // TEST K: Mismo turno intenta auto_orchestrator + explicit_tool para mismo asset
  //         => protecciones actuales evitan doble dispatch.
  // =============================================================================
  await runTest('TEST K: Mismo turno auto_orchestrator + explicit_tool => protecciones evitan doble dispatch', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productWith4Images.id, productWith4Images);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-test-k'
    });

    session.startNewTurn('Quiero ver el Reloj Geneva + pulsera diseño black');

    // 1. auto_orchestrator se ejecuta al inicio del turno y encola pendingMedia
    const orch = orchestrateProductMedia({
      userMessageText: 'Quiero ver el Reloj Geneva + pulsera diseño black',
      availableProducts: [productWith4Images],
      currentCommercialState: {}
    });
    assert.strictEqual(orch.shouldDispatch, true);

    session.setPendingMedia({
      productId: orch.targetProduct.id,
      productName: orch.targetProduct.name,
      url: orch.url,
      mediaType: orch.mediaType,
      source: 'auto_orchestrator'
    });

    // 2. Gemini dentro del mismo turno ejecuta explícitamente send_product_media para el mismo producto
    const toolResult = await session.toolsHandler('send_product_media', { productId: productWith4Images.id, mediaType: 'image' });

    // Debe reconocer que ya está programado y no duplicar
    assert.strictEqual(toolResult.success, true);
    assert.strictEqual(toolResult.alreadyQueued, true);

    // 3. Al despachar el turno, solo se realiza 1 llamada al provider
    const dispatchRes = await session.simulateDispatch({ providerSuccess: true });
    assert.strictEqual(dispatchRes.dispatched, true);
    assert.strictEqual(session.getProviderCallsCount(), 1, 'Debe haber exactamente 1 llamada al provider en el turno');
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE ROTACIÓN DE GALERÍA: ${passedTests}/${totalTests} TESTS PASARON EXITOSAMENTE`);
  console.log('======================================================================\n');
}

runSuite().catch(err => {
  console.error('\n❌ ERROR FATAL EN SUITE DE TESTS:\n', err);
  process.exit(1);
});
