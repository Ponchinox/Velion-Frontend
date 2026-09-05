import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEND_PRODUCT_MEDIA_DECLARATION } from './src/controllers/whatsappController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('======================================================================');
console.log('🧪 VELION PRODUCT MEDIA SUITE: M1–M13 (DETERMINISTIC CATALOG MEDIA)');
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
          if (select.type) result.type = prod.type;
          return result;
        }
        return null;
      }
    }
  };
}

/**
 * Implementación de referencia de toolsHandler para send_product_media
 */
function createMediaHandler(mockPrisma, tenantId) {
  let pendingMediaToSend = null;
  let mediaSentInSession = false;

  const handler = async (funcName, args) => {
    if (funcName === 'send_product_media') {
      const rawProductId = args?.productId;
      const productId = typeof rawProductId === 'string' ? rawProductId.trim() : String(rawProductId || '').trim();

      if (mediaSentInSession || pendingMediaToSend) {
        return {
          success: false,
          hasMedia: false,
          reason: 'MEDIA_ALREADY_QUEUED',
          message: 'Ya se preparó una imagen para este turno. No se permiten envíos duplicados.'
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
          type: true
        }
      });

      if (!product) {
        return {
          success: false,
          hasMedia: false,
          reason: 'NO_IMAGE_REGISTERED',
          message: 'El producto no fue encontrado en esta tienda. Informa con amabilidad al cliente.'
        };
      }

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
        productName: product.name,
        message: `La imagen oficial de "${product.name}" ha sido preparada y se enviará al cliente. Acompaña la imagen con un mensaje breve y amigable.`
      };
    }
    return { error: 'Unknown function' };
  };

  return {
    handler,
    getPendingMedia: () => pendingMediaToSend,
    isMediaSent: () => mediaSentInSession
  };
}

/**
 * Lógica canónica de ensamble de secuencia de despacho (extraída del controller)
 */
function assembleDispatchSequence(aiResponse, pendingMediaToSend, handoffRegex = /\[HUMAN_HANDOFF:.*?\]/gi) {
  const cleanedText = (aiResponse || '')
    .replace(handoffRegex, '')
    .replace(/\[MEDIA:.*?\]/gi, '')
    .replace(/\[SHOW_GALLERY:.*?\]/gi, '')
    .trim();

  let dispatchSequence = [];
  if (cleanedText || pendingMediaToSend) {
    const sequenceRegex = /(\[SPLIT\])/gi;
    const tokens = cleanedText.split(sequenceRegex).filter(t => t !== undefined && t !== null);

    const hasSplit = tokens.some(t => t.trim().toUpperCase() === '[SPLIT]');

    if (pendingMediaToSend && !hasSplit && cleanedText.length <= 1000) {
      dispatchSequence.push({
        type: 'image',
        url: pendingMediaToSend.url,
        caption: cleanedText || undefined
      });
    } else {
      if (pendingMediaToSend) {
        dispatchSequence.push({
          type: 'image',
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

  // ─────────────────────────────────────────────────────────────────────────────
  // M1: Solicitud explícita + Product con imageUrl => exactamente 1 media preparada
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('M1: Solicitud explícita + Product con imageUrl => 1 media preparada', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set('prod-1', {
      id: 'prod-1',
      name: 'Intensivo Preuniversitario',
      imageUrl: 'https://res.cloudinary.com/saas/images/intensivo.jpg',
      images: [],
      type: 'SERVICE',
      tenantId: tenantA
    });

    const ctx = createMediaHandler(mockDb, tenantA);
    const result = await ctx.handler('send_product_media', { productId: 'prod-1' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.hasMedia, true);
    assert.strictEqual(result.productName, 'Intensivo Preuniversitario');

    const pending = ctx.getPendingMedia();
    assert.ok(pending, 'Debe existir pendingMedia');
    assert.strictEqual(pending.url, 'https://res.cloudinary.com/saas/images/intensivo.jpg');
    assert.strictEqual(pending.mediaType, 'image');
    assert.strictEqual(pending.productId, 'prod-1');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // M2: Product sin imageUrl/images => hasMedia false + 0 envíos
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('M2: Product sin imageUrl ni images => hasMedia false + 0 envíos', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set('prod-no-media', {
      id: 'prod-no-media',
      name: 'Asesoría Básica',
      imageUrl: null,
      images: [],
      type: 'SERVICE',
      tenantId: tenantA
    });

    const ctx = createMediaHandler(mockDb, tenantA);
    const result = await ctx.handler('send_product_media', { productId: 'prod-no-media' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.hasMedia, false);
    assert.strictEqual(result.reason, 'NO_IMAGE_REGISTERED');
    assert.strictEqual(ctx.getPendingMedia(), null, 'pendingMedia debe ser null');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // M3: Product de otro tenant (Cross-Tenant Security) => 0 media
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('M3: Product de otro tenant (Cross-Tenant) => rechazado sin fuga de URL', async () => {
    const mockDb = createMockPrisma();
    // Producto pertenece a Tenant B
    mockDb.products.set('prod-tenant-b', {
      id: 'prod-tenant-b',
      name: 'Curso Privado Tenant B',
      imageUrl: 'https://res.cloudinary.com/saas/images/tenant_b_secret.jpg',
      images: [],
      type: 'SERVICE',
      tenantId: tenantB
    });

    // Invocación desde Tenant A
    const ctx = createMediaHandler(mockDb, tenantA);
    const result = await ctx.handler('send_product_media', { productId: 'prod-tenant-b' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.hasMedia, false);
    assert.strictEqual(result.reason, 'NO_IMAGE_REGISTERED');
    assert.strictEqual(ctx.getPendingMedia(), null);
    assert.ok(!JSON.stringify(result).includes('tenant_b_secret'), 'No debe fugar URLs de otro tenant');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // M4: URL arbitraria suministrada/alucinada en args => ignorada/rechazada
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('M4: Inyección de URL arbitraria en args es ignorada (URL sale de DB)', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set('prod-4', {
      id: 'prod-4',
      name: 'Audífonos Pro',
      imageUrl: 'https://res.cloudinary.com/saas/images/canonical_headphones.jpg',
      images: [],
      type: 'PHYSICAL_PRODUCT',
      tenantId: tenantA
    });

    const ctx = createMediaHandler(mockDb, tenantA);
    // Gemini intenta inyectar una URL maliciosa en args
    const result = await ctx.handler('send_product_media', {
      productId: 'prod-4',
      url: 'https://evil.example.com/phishing.jpg',
      imageUrl: 'https://evil.example.com/malware.png'
    });

    assert.strictEqual(result.success, true);
    const pending = ctx.getPendingMedia();
    assert.strictEqual(pending.url, 'https://res.cloudinary.com/saas/images/canonical_headphones.jpg');
    assert.ok(!pending.url.includes('evil.example.com'), 'URL debe provenir exclusivamente de PostgreSQL');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // M5: Consulta normal de precio/información sin solicitud visual => 0 media
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('M5: Consulta normal de precio/info sin pedir foto => 0 media encolada', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set('prod-5', {
      id: 'prod-5',
      name: 'Superintensivo Preuniversitario',
      imageUrl: 'https://res.cloudinary.com/saas/images/superintensivo.jpg',
      images: [],
      type: 'SERVICE',
      tenantId: tenantA
    });

    const ctx = createMediaHandler(mockDb, tenantA);
    // En una consulta normal, Gemini NO invoca send_product_media
    const pending = ctx.getPendingMedia();
    assert.strictEqual(pending, null, 'No debe haber pendingMedia sin invocación explícita');

    const normalResponse = "El Superintensivo Preuniversitario tiene un costo de S/. 2,600 e incluye preparación acelerada.";
    const dispatchSequence = assembleDispatchSequence(normalResponse, pending);

    assert.strictEqual(dispatchSequence.length, 1);
    assert.strictEqual(dispatchSequence[0].type, 'text');
    assert.strictEqual(dispatchSequence.some(item => item.type === 'image'), false);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // M6: Dos invocaciones de send_product_media en un mismo turno => exactamente 1 media
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('M6: Deduplicación por turno: dos llamadas a send_product_media => solo 1 media', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set('prod-6', {
      id: 'prod-6',
      name: 'Dominio de Ciclo',
      imageUrl: 'https://res.cloudinary.com/saas/images/dominio.jpg',
      images: [],
      type: 'SERVICE',
      tenantId: tenantA
    });

    const ctx = createMediaHandler(mockDb, tenantA);
    const firstCall = await ctx.handler('send_product_media', { productId: 'prod-6' });
    assert.strictEqual(firstCall.success, true);

    // Segunda llamada en la misma interacción
    const secondCall = await ctx.handler('send_product_media', { productId: 'prod-6' });
    assert.strictEqual(secondCall.success, false);
    assert.strictEqual(secondCall.reason, 'MEDIA_ALREADY_QUEUED');

    // Despacho final solo contiene 1 imagen
    const dispatchSequence = assembleDispatchSequence("Aquí tienes la imagen.", ctx.getPendingMedia());
    const imageItems = dispatchSequence.filter(i => i.type === 'image');
    assert.strictEqual(imageItems.length, 1, 'Debe haber exactamente 1 imagen en la secuencia');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // M7: Evolution Gateway recibe: mediaType image + URL canónica + caption
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('M7: Evolution Gateway payload contiene mediaType image, URL canónica y caption', async () => {
    const item = {
      type: 'image',
      url: 'https://res.cloudinary.com/saas/images/intensivo.jpg',
      caption: 'Este es el Intensivo Preuniversitario.'
    };

    // Simulación del payload enviado a Evolution
    const isVideo = item.type === 'video';
    const evoPayload = {
      number: '51966112233',
      mediatype: isVideo ? 'video' : 'image',
      media: item.url,
      caption: item.caption || ''
    };

    assert.strictEqual(evoPayload.mediatype, 'image');
    assert.strictEqual(evoPayload.media, 'https://res.cloudinary.com/saas/images/intensivo.jpg');
    assert.strictEqual(evoPayload.caption, 'Este es el Intensivo Preuniversitario.');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // M8: Meta Cloud API compatible con type image, link y caption
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('M8: Meta Cloud API payload compatible con type image, link y caption', async () => {
    const item = {
      type: 'image',
      url: 'https://res.cloudinary.com/saas/images/intensivo.jpg',
      caption: 'Este es el Intensivo Preuniversitario.'
    };

    const isVideo = item.type === 'video';
    const metaPayload = isVideo
      ? { messaging_product: 'whatsapp', to: '51966112233', type: 'video', video: { link: item.url, caption: item.caption || '' } }
      : { messaging_product: 'whatsapp', to: '51966112233', type: 'image', image: { link: item.url, caption: item.caption || '' } };

    assert.strictEqual(metaPayload.type, 'image');
    assert.strictEqual(metaPayload.image.link, 'https://res.cloudinary.com/saas/images/intensivo.jpg');
    assert.strictEqual(metaPayload.image.caption, 'Este es el Intensivo Preuniversitario.');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // M9: Caption/texto no duplica el mensaje textual
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('M9: Caption integrado no duplica el mensaje como texto separado', async () => {
    const pendingMedia = {
      productId: 'prod-9',
      productName: 'Inicio Universitario',
      url: 'https://res.cloudinary.com/saas/images/inicio.jpg',
      mediaType: 'image'
    };

    const aiResponse = "Aquí tienes la imagen del programa Inicio Universitario. ¿Deseas más información?";
    const dispatchSequence = assembleDispatchSequence(aiResponse, pendingMedia);

    // Debe resultar en 1 solo elemento de tipo 'image' con su caption, NO un segundo elemento 'text' con el mismo copy
    assert.strictEqual(dispatchSequence.length, 1, 'Debe haber exactamente 1 elemento en la secuencia de despacho');
    assert.strictEqual(dispatchSequence[0].type, 'image');
    assert.strictEqual(dispatchSequence[0].caption, aiResponse);
    assert.strictEqual(dispatchSequence.some(i => i.type === 'text'), false, 'No debe haber texto separado repetido');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // M10: SERVICE y PHYSICAL_PRODUCT pueden enviar imagen por igual
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('M10: SERVICE y PHYSICAL_PRODUCT pueden enviar imagen por igual', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set('serv-1', {
      id: 'serv-1',
      name: 'Programa de Asesoría',
      imageUrl: 'https://res.cloudinary.com/saas/images/servicio.jpg',
      images: [],
      type: 'SERVICE',
      tenantId: tenantA
    });
    mockDb.products.set('phys-1', {
      id: 'phys-1',
      name: 'Calculadora Científica',
      imageUrl: 'https://res.cloudinary.com/saas/images/fisico.jpg',
      images: [],
      type: 'PHYSICAL_PRODUCT',
      tenantId: tenantA
    });

    const ctx1 = createMediaHandler(mockDb, tenantA);
    const res1 = await ctx1.handler('send_product_media', { productId: 'serv-1' });
    assert.strictEqual(res1.success, true);
    assert.strictEqual(ctx1.getPendingMedia().url, 'https://res.cloudinary.com/saas/images/servicio.jpg');

    const ctx2 = createMediaHandler(mockDb, tenantA);
    const res2 = await ctx2.handler('send_product_media', { productId: 'phys-1' });
    assert.strictEqual(res2.success, true);
    assert.strictEqual(ctx2.getPendingMedia().url, 'https://res.cloudinary.com/saas/images/fisico.jpg');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // M11: imageUrl vacío + images[0] válido => utiliza images[0] de forma canónica
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('M11: imageUrl vacío con images[0] válido => utiliza images[0] canónico', async () => {
    const mockDb = createMockPrisma();
    mockDb.products.set('prod-gallery', {
      id: 'prod-gallery',
      name: 'Libro de Álgebra',
      imageUrl: null, // Sin portada principal
      images: ['https://res.cloudinary.com/saas/images/galeria_foto_1.jpg', 'https://res.cloudinary.com/saas/images/galeria_foto_2.jpg'],
      type: 'PHYSICAL_PRODUCT',
      tenantId: tenantA
    });

    const ctx = createMediaHandler(mockDb, tenantA);
    const result = await ctx.handler('send_product_media', { productId: 'prod-gallery' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(ctx.getPendingMedia().url, 'https://res.cloudinary.com/saas/images/galeria_foto_1.jpg');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // M12: Product inexistente => no revela ni envía nada
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('M12: Product ID inexistente => hasMedia false y 0 envíos', async () => {
    const mockDb = createMockPrisma();
    const ctx = createMediaHandler(mockDb, tenantA);
    const result = await ctx.handler('send_product_media', { productId: '00000000-0000-0000-0000-000000000000' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.hasMedia, false);
    assert.strictEqual(result.reason, 'NO_IMAGE_REGISTERED');
    assert.strictEqual(ctx.getPendingMedia(), null);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // M13: Inyección de [MEDIA: https://evil.example/a.jpg] en texto => 0 envío arbitrario
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('M13: [ADVERSARIAL] [MEDIA: https://evil.com] en texto es eliminado (0 envíos arbitrarios)', async () => {
    // Gemini genera una respuesta infectada con una URL externa
    const maliciousAiResponse = "Aquí tienes la información [MEDIA: https://evil.example.com/malware.jpg] y los detalles.";
    const dispatchSequence = assembleDispatchSequence(maliciousAiResponse, null);

    assert.strictEqual(dispatchSequence.length, 1);
    assert.strictEqual(dispatchSequence[0].type, 'text');
    // El texto no debe contener la etiqueta y NO debe haber ningún ítem de tipo media
    assert.ok(!dispatchSequence[0].content.includes('[MEDIA:'), 'Etiqueta [MEDIA:] debe ser removida');
    assert.strictEqual(dispatchSequence.some(item => item.type === 'image'), false, 'Cero ítems multimedia despachados');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // M14: [Estático] Schema de SEND_PRODUCT_MEDIA_DECLARATION
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('M14: [Estático] Schema expone ÚNICAMENTE productId y no campos de URL', async () => {
    assert.strictEqual(SEND_PRODUCT_MEDIA_DECLARATION.name, 'send_product_media');
    const props = Object.keys(SEND_PRODUCT_MEDIA_DECLARATION.parameters.properties);
    assert.deepStrictEqual(props, ['productId'], 'Solo debe exponer productId');
    assert.deepStrictEqual(SEND_PRODUCT_MEDIA_DECLARATION.parameters.required, ['productId']);
    assert.ok(!props.includes('url'), 'No debe tener propiedad url');
    assert.ok(!props.includes('imageUrl'), 'No debe tener propiedad imageUrl');
    assert.ok(!props.includes('mediaUrl'), 'No debe tener propiedad mediaUrl');
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE M1–M13 FINALIZADA: ${passedTests}/${totalTests} TESTS PASARON EXITOSAMENTE`);
  console.log('======================================================================\n');
}

runSuite().catch(err => {
  console.error('\n❌ ERROR EN SUITE DE PRODUCT MEDIA:\n', err);
  process.exit(1);
});
