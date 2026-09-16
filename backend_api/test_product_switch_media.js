import assert from 'node:assert';
import {
  resolveTargetProduct,
  orchestrateProductMedia
} from './src/services/productMediaOrchestrator.js';
import {
  detectProductMediaIntent,
  enforceMediaAuthority
} from './src/controllers/whatsappController.js';

console.log('======================================================================');
console.log('🧪 VELION PRODUCT MEDIA SWITCH SUITE: TESTS DIRIGIDOS A - H');
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
 * Implementación de dispatch sequence idéntica al controller
 */
function assembleDispatchSequence(aiResponse, pendingMediaToSend) {
  const textWithoutCommands = (aiResponse || '')
    .replace(/\[MEDIA:.*?\]/gi, '')
    .replace(/\[SHOW_GALLERY:.*?\]/gi, '')
    .replace(/\[(?:Imagen|Video|Media|Multimedia)\s+enviad[ao](?:\s+al\s+cliente)?\]/gi, '')
    .replace(/\[(?:Imagen|Video|Media|Multimedia)\](?::\s*(?:https?:\/\/[^\s\n]+|\/[^\s\n]+)?)?/gi, '')
    .replace(/(?:https?:\/\/[^\s\n]+)?\/(?:media\/tenants|products\/(?:images|videos))\/[^\s\n]+/gi, '')
    .replace(/^\s*[\r\n]+/gm, '\n');

  let cleanedText = textWithoutCommands.trim();
  cleanedText = enforceMediaAuthority(cleanedText, Boolean(pendingMediaToSend));

  let dispatchSequence = [];
  if (cleanedText || pendingMediaToSend) {
    if (pendingMediaToSend && cleanedText.length <= 1000) {
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
      if (cleanedText) {
        dispatchSequence.push({ type: 'text', content: cleanedText });
      }
    }
  }
  return dispatchSequence;
}

/**
 * Contexto de sesión conversacional con soporte de herramientas y actualización contextual
 */
function createConversationSession({ mockPrisma, tenantId, customerId, initialCommercialState = {} }) {
  let customer = { id: customerId, commercialState: { ...initialCommercialState } };
  mockPrisma.customers.set(customerId, customer);

  let currentCommercialState = { ...initialCommercialState };
  let pendingMediaToSend = null;
  let mediaSentInSession = false;
  let userMessageText = '';
  let consultedProduct = null;

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
    if (funcName === 'get_product_details') {
      const { productId } = args || {};
      const product = await mockPrisma.product.findFirst({
        where: { id: productId, user: { tenantId } },
        select: { id: true, name: true, price: true, imageUrl: true, images: true, videoUrl: true, type: true }
      });
      if (!product) {
        return { result: 'Producto no encontrado o no disponible en esta tienda.' };
      }
      consultedProduct = { id: productId, name: product.name };
      await updateLastConsultedProduct(productId, product.name);
      return {
        result: `Nombre: ${product.name}\nPrecio: S/. ${product.price}\nFotos disponibles: ${product.imageUrl ? 1 : 0}`
      };
    }

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
        if (product.imageUrl && typeof product.imageUrl === 'string' && product.imageUrl.trim() !== '' && product.imageUrl.trim() !== 'Sin imagen') {
          targetMediaUrl = product.imageUrl.trim();
        } else if (Array.isArray(product.images) && product.images.length > 0) {
          const firstImg = product.images[0];
          if (firstImg && typeof firstImg === 'string' && firstImg.trim() !== '' && firstImg.trim() !== 'Sin imagen') {
            targetMediaUrl = firstImg.trim();
          }
        }
        if (!targetMediaUrl) {
          return {
            success: false,
            hasMedia: false,
            reason: 'NO_IMAGE_REGISTERED',
            message: `El producto o servicio "${product.name}" no cuenta con una imagen o foto registrada.`
          };
        }
      }

      // Guardia: ya despachado físicamente en este turno (sin pending reemplazable)
      if (mediaSentInSession && !pendingMediaToSend) {
        return {
          success: false,
          hasMedia: false,
          reason: 'MEDIA_ALREADY_QUEUED',
          message: 'Ya se preparó y despachó un elemento multimedia para este turno. No se permiten envíos duplicados.'
        };
      }

      if (pendingMediaToSend) {
        // Caso 1: Mismo producto ya programado
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

        // Caso 2: Producto DISTINTO y previo fue programado por auto_orchestrator => SUPERSEDE
        if (pendingMediaToSend.source === 'auto_orchestrator') {
          pendingMediaToSend = {
            productId: product.id,
            productName: product.name,
            url: targetMediaUrl,
            mediaType: requestedMediaType,
            source: 'explicit_tool'
          };
          mediaSentInSession = true;
          consultedProduct = { id: product.id, name: product.name };
          await updateLastConsultedProduct(product.id, product.name);
          return {
            success: true,
            hasMedia: true,
            mediaType: requestedMediaType,
            productName: product.name,
            message: `La multimedia de "${product.name}" ha reemplazado la anterior.`
          };
        }

        // Caso 3: Producto DISTINTO pero ya programado explícitamente en el mismo turno
        return {
          success: false,
          hasMedia: false,
          reason: 'MEDIA_ALREADY_QUEUED',
          message: 'Ya se preparó un elemento multimedia para este turno. No se permiten envíos duplicados.'
        };
      }

      // Caso 4: No había media previa encolada
      pendingMediaToSend = {
        productId: product.id,
        productName: product.name,
        url: targetMediaUrl,
        mediaType: requestedMediaType,
        source: 'explicit_tool'
      };
      mediaSentInSession = true;
      consultedProduct = { id: product.id, name: product.name };
      await updateLastConsultedProduct(product.id, product.name);

      return {
        success: true,
        hasMedia: true,
        mediaType: requestedMediaType,
        productName: product.name,
        message: `Multimedia de "${product.name}" preparada.`
      };
    }

    return { error: 'Unknown function' };
  };

  return {
    toolsHandler,
    getCommercialState: () => currentCommercialState,
    getPendingMedia: () => pendingMediaToSend,
    setPendingMedia: (m) => { pendingMediaToSend = m; },
    isMediaSent: () => mediaSentInSession,
    markMediaSentAndDispatched: () => {
      mediaSentInSession = true;
      pendingMediaToSend = null;
    },
    setUserMessageText: (txt) => { userMessageText = txt; },
    updateLastConsultedProduct
  };
}

async function runSuite() {
  const tenantAlpha = 'tenant-alpha-uuid';
  const tenantBeta = 'tenant-beta-uuid';

  const productA = {
    id: 'prod-jbl-clip',
    name: 'Parlante JBL Clip 4',
    imageUrl: 'https://cdn.example.com/jbl.jpg',
    videoUrl: 'https://cdn.example.com/jbl.mp4',
    images: [],
    price: 180,
    tenantId: tenantAlpha,
    type: 'PHYSICAL_PRODUCT'
  };

  const productB = {
    id: 'prod-geneva-watch',
    name: 'Reloj Geneva Black',
    imageUrl: 'https://cdn.example.com/geneva.jpg',
    videoUrl: 'https://cdn.example.com/geneva.mp4',
    images: [],
    price: 99,
    tenantId: tenantAlpha,
    type: 'PHYSICAL_PRODUCT'
  };

  const productForeign = {
    id: 'prod-foreign-sneakers',
    name: 'Zapatillas Nike Air',
    imageUrl: 'https://cdn.example.com/nike.jpg',
    videoUrl: 'https://cdn.example.com/nike.mp4',
    images: [],
    price: 250,
    tenantId: tenantBeta, // Otro tenant
    type: 'PHYSICAL_PRODUCT'
  };

  // =============================================================================
  // TEST A: Producto A -> Media A -> Cliente cambia a B -> get_product_details(B)
  //         -> Cliente dice "Fotos" => SOLO media de B + caption de B
  // =============================================================================
  await runTest('TEST A: Cambio A -> B -> get_product_details(B) -> "Fotos" => SOLO media de B + caption de B', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productA.id, productA);
    mockDb.products.set(productB.id, productB);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-101',
      initialCommercialState: {
        productId: productA.id,
        productName: productA.name,
        currentStage: 'DETAILS_PROVIDED',
        customerConfirmed: false
      }
    });

    // 1. Cliente cambia a Producto B ("reloj para hombre")
    // LLM ejecuta get_product_details(productB.id)
    const detailsResult = await session.toolsHandler('get_product_details', { productId: productB.id });
    assert.ok(detailsResult.result.includes('Reloj Geneva Black'));

    // Verificar que lastConsultedProductId se actualizó en commercialState
    const stateAfterDetails = session.getCommercialState();
    assert.strictEqual(stateAfterDetails.lastConsultedProductId, productB.id);
    assert.strictEqual(stateAfterDetails.lastConsultedProductName, productB.name);
    // commercialState.productId sigue siendo productA (no confirmado)
    assert.strictEqual(stateAfterDetails.productId, productA.id);

    // 2. Turno siguiente: Cliente dice elípticamente "Fotos"
    const userMsg = 'Fotos';
    const catalog = [productA, productB];

    // productMediaOrchestrator corre al inicio del turno
    const orchResult = orchestrateProductMedia({
      userMessageText: userMsg,
      availableProducts: catalog,
      currentCommercialState: stateAfterDetails,
      sentMediaProductIds: [productA.id] // ya se había enviado foto de A previamente
    });

    assert.strictEqual(orchResult.shouldDispatch, true);
    assert.strictEqual(orchResult.targetProduct.id, productB.id, 'Debe resolver Producto B, NO Producto A');
    assert.strictEqual(orchResult.url, productB.imageUrl);
    assert.strictEqual(orchResult.mediaType, 'image');

    // Despacho final ensamblado con caption del modelo
    const modelCaption = 'Aquí tienes la foto del Reloj Geneva Black con correa de acero inoxidable.';
    const dispatchSequence = assembleDispatchSequence(modelCaption, {
      productId: orchResult.targetProduct.id,
      productName: orchResult.targetProduct.name,
      url: orchResult.url,
      mediaType: orchResult.mediaType
    });

    assert.strictEqual(dispatchSequence.length, 1);
    assert.strictEqual(dispatchSequence[0].type, 'image');
    assert.strictEqual(dispatchSequence[0].url, productB.imageUrl, 'URL de imagen debe ser la de B');
    assert.ok(!dispatchSequence[0].url.includes('jbl'), 'Cero media de A');
    assert.strictEqual(dispatchSequence[0].caption, modelCaption);
  });

  // =============================================================================
  // TEST B: Mismo flujo pero cliente pide "Video" => video de B
  // =============================================================================
  await runTest('TEST B: Cambio A -> B -> get_product_details(B) -> "Video" => video de B', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productA.id, productA);
    mockDb.products.set(productB.id, productB);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-102',
      initialCommercialState: {
        productId: productA.id,
        productName: productA.name,
        currentStage: 'DETAILS_PROVIDED'
      }
    });

    await session.toolsHandler('get_product_details', { productId: productB.id });
    const cState = session.getCommercialState();

    const orchResult = orchestrateProductMedia({
      userMessageText: 'Video por favor',
      availableProducts: [productA, productB],
      currentCommercialState: cState,
      sentMediaProductIds: []
    });

    assert.strictEqual(orchResult.shouldDispatch, true);
    assert.strictEqual(orchResult.targetProduct.id, productB.id);
    assert.strictEqual(orchResult.mediaType, 'video');
    assert.strictEqual(orchResult.url, productB.videoUrl);
    assert.ok(orchResult.url.includes('geneva.mp4'));
  });

  // =============================================================================
  // TEST C: Producto A ya está pending por auto-orchestrator pero send_product_media(B)
  //         explícito llega antes del dispatch => pending reemplazado por B => un solo media enviado
  // =============================================================================
  await runTest('TEST C: Auto-orchestrator queue A -> explicit send_product_media(B) supersedes -> un solo media de B', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productA.id, productA);
    mockDb.products.set(productB.id, productB);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-103',
      initialCommercialState: {
        productId: productA.id,
        currentStage: 'DETAILS_PROVIDED'
      }
    });

    // Supongamos que auto-orchestrator erróneamente encoló A antes de que el LLM procesara el turno
    session.setPendingMedia({
      productId: productA.id,
      productName: productA.name,
      url: productA.imageUrl,
      mediaType: 'image',
      source: 'auto_orchestrator'
    });

    session.setUserMessageText('Mándame fotos del reloj Geneva');

    // LLM ejecuta send_product_media para Product B
    const toolRes = await session.toolsHandler('send_product_media', {
      productId: productB.id,
      mediaType: 'image'
    });

    assert.strictEqual(toolRes.success, true);
    assert.strictEqual(toolRes.hasMedia, true);

    const pending = session.getPendingMedia();
    assert.ok(pending);
    assert.strictEqual(pending.productId, productB.id, 'Pending debe haber sido reemplazado por B');
    assert.strictEqual(pending.url, productB.imageUrl);
    assert.strictEqual(pending.source, 'explicit_tool');

    // Despacho final: produce exactamente un item
    const dispatchSequence = assembleDispatchSequence('Aquí está la foto del Geneva', pending);
    assert.strictEqual(dispatchSequence.length, 1);
    assert.strictEqual(dispatchSequence[0].url, productB.imageUrl);
    assert.ok(!dispatchSequence[0].url.includes('jbl'));
  });

  // =============================================================================
  // TEST D: Mismo producto ya pending => alreadyQueued => no duplicado
  // =============================================================================
  await runTest('TEST D: Mismo producto ya pending => alreadyQueued => no duplicado', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productB.id, productB);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-104'
    });

    // Se encola B inicialmente
    const res1 = await session.toolsHandler('send_product_media', {
      productId: productB.id,
      mediaType: 'image'
    });
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.alreadyQueued, undefined);

    // LLM llama de nuevo con el MISMO producto en el mismo turno
    const res2 = await session.toolsHandler('send_product_media', {
      productId: productB.id,
      mediaType: 'image'
    });
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.alreadyQueued, true, 'Debe indicar alreadyQueued');
    assert.strictEqual(session.getPendingMedia().productId, productB.id);
  });

  // =============================================================================
  // TEST E: mediaSentInSession = true (ya despachado físicamente) => no permitir segundo media
  // =============================================================================
  await runTest('TEST E: mediaSentInSession = true => no permitir segundo media en el mismo turno', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productA.id, productA);
    mockDb.products.set(productB.id, productB);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-105'
    });

    // Simular que el media ya fue enviado físicamente al gateway en este turno
    session.markMediaSentAndDispatched();

    // LLM intenta llamar a send_product_media
    const res = await session.toolsHandler('send_product_media', {
      productId: productB.id,
      mediaType: 'image'
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.reason, 'MEDIA_ALREADY_QUEUED');
    assert.strictEqual(session.getPendingMedia(), null);
  });

  // =============================================================================
  // TEST F: Producto B pertenece a otro tenant => rechazo => CROSS_TENANT = BLOCKED
  // =============================================================================
  await runTest('TEST F: Producto de otro tenant => rechazo => CROSS_TENANT = BLOCKED', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productForeign.id, productForeign); // tenantBeta

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha, // tenantAlpha intentando acceder a producto de tenantBeta
      customerId: 'cust-106'
    });

    const res = await session.toolsHandler('send_product_media', {
      productId: productForeign.id,
      mediaType: 'image'
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.reason, 'NO_IMAGE_REGISTERED', 'Debe ser bloqueado por aislamiento de tenant');
    assert.strictEqual(session.getPendingMedia(), null);

    // Resolver en orchestrator tampoco debe resolver productos de otro tenant
    const orch = orchestrateProductMedia({
      userMessageText: 'Muéstrame las zapatillas Nike',
      availableProducts: [productA, productB], // Catálogo del tenantAlpha no incluye productForeign
      currentCommercialState: {}
    });
    assert.strictEqual(orch.shouldDispatch, false);
  });

  // =============================================================================
  // TEST G: Cliente cambia A -> B -> A => último producto consultado válido gobierna petición elíptica posterior
  // =============================================================================
  await runTest('TEST G: Cliente cambia A -> B -> A => último consultado gobierna petición elíptica', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productA.id, productA);
    mockDb.products.set(productB.id, productB);

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-107'
    });

    // 1. Consulta A
    await session.toolsHandler('get_product_details', { productId: productA.id });
    assert.strictEqual(session.getCommercialState().lastConsultedProductId, productA.id);

    // 2. Cambia a B
    await session.toolsHandler('get_product_details', { productId: productB.id });
    assert.strictEqual(session.getCommercialState().lastConsultedProductId, productB.id);

    // 3. Vuelve a consultar A
    await session.toolsHandler('get_product_details', { productId: productA.id });
    assert.strictEqual(session.getCommercialState().lastConsultedProductId, productA.id);

    // 4. Petición elíptica "Fotos"
    const orch = orchestrateProductMedia({
      userMessageText: 'Fotos',
      availableProducts: [productA, productB],
      currentCommercialState: session.getCommercialState()
    });

    assert.strictEqual(orch.shouldDispatch, true);
    assert.strictEqual(orch.targetProduct.id, productA.id, 'Debe resolver A porque fue el último consultado');
  });

  // =============================================================================
  // TEST H: Consulta exploratoria de B => lastConsultedProductId = B => commercialState.productId NO se cambia
  // =============================================================================
  await runTest('TEST H: Consulta exploratoria de B => lastConsultedProductId = B pero commercialState.productId INTACTO', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set(productA.id, productA);
    mockDb.products.set(productB.id, productB);

    const initialCommercial = {
      productId: productA.id,
      productName: productA.name,
      currentStage: 'PRODUCT_SELECTED',
      customerConfirmed: true,
      quantity: 1
    };

    const session = createConversationSession({
      mockPrisma: mockDb,
      tenantId: tenantAlpha,
      customerId: 'cust-108',
      initialCommercialState: initialCommercial
    });

    // Consulta exploratoria de B
    await session.toolsHandler('get_product_details', { productId: productB.id });

    // Verificar en memoria de la sesión
    const updatedState = session.getCommercialState();
    assert.strictEqual(updatedState.lastConsultedProductId, productB.id, 'lastConsultedProductId debe ser B');
    assert.strictEqual(updatedState.lastConsultedProductName, productB.name);

    // Semántica de compra intacta
    assert.strictEqual(updatedState.productId, productA.id, 'commercialState.productId DEBE seguir siendo A');
    assert.strictEqual(updatedState.productName, productA.name);
    assert.strictEqual(updatedState.currentStage, 'PRODUCT_SELECTED', 'currentStage no debe alterarse');
    assert.strictEqual(updatedState.customerConfirmed, true, 'customerConfirmed no debe alterarse');

    // Verificar persistencia en base de datos mock
    const persistedCustomer = await mockDb.customer.findUnique({ where: { id: 'cust-108' } });
    assert.strictEqual(persistedCustomer.commercialState.lastConsultedProductId, productB.id);
    assert.strictEqual(persistedCustomer.commercialState.productId, productA.id);
    assert.strictEqual(persistedCustomer.commercialState.customerConfirmed, true);
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE TESTS A - H FINALIZADA: ${passedTests}/${totalTests} TESTS PASARON EXITOSAMENTE`);
  console.log('======================================================================\n');
}

runSuite().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
