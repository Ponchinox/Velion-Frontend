/**
 * test_multi_product_media.js
 * 
 * Valida los 7 casos requeridos de multimedia multiproducto:
 * TEST 1: "Lentes con cámara: foto y video + AirPods: foto" -> 3 items (lentes img+vid, airpods img)
 * TEST 2: "Envíame foto del JBL y foto de los AirPods" -> 2 productos, 2 imágenes
 * TEST 3: "Video de los lentes y foto del JBL" -> lentes video, JBL image
 * TEST 4: "Foto y video de los lentes" -> 1 producto, 2 medios (regresión monoproducto)
 * TEST 5: "Envíame foto y video de un producto que me interesa" -> PRODUCT_CLARIFICATION_REQUIRED, 0 medios
 * TEST 6: Dos productos donde uno no tiene video -> medios existentes se envían, no bloquea el válido
 * TEST 7: Producto ambiguo + producto explícito -> no adivinar ambiguo, no sustituye ni mezcla el explícito
 */

import assert from 'assert';
import {
  orchestrateProductMedia,
  resolveMultiProductMediaRequests,
  findMentionedProducts,
  extractProductSegments,
  getCanonicalProductMedia
} from './src/services/productMediaOrchestrator.js';

const FIXTURE_PRODUCTS = [
  {
    id: 'lentes-uuid-001',
    name: 'Lentes de sol con cámara',
    imageUrl: 'https://cdn.velion.io/media/lentes_cover.jpg',
    images: ['https://cdn.velion.io/media/lentes_cover.jpg'],
    videoUrl: 'https://cdn.velion.io/media/lentes_video.mp4',
    isAvailable: true
  },
  {
    id: 'airpods-uuid-002',
    name: 'Airpods segunda generación',
    imageUrl: 'https://cdn.velion.io/media/airpods_cover.jpg',
    images: ['https://cdn.velion.io/media/airpods_cover.jpg'],
    videoUrl: null,
    isAvailable: true
  },
  {
    id: 'jbl-uuid-003',
    name: 'JBL go 4 A1',
    imageUrl: 'https://cdn.velion.io/media/jbl_cover.jpg',
    images: ['https://cdn.velion.io/media/jbl_cover.jpg'],
    videoUrl: 'https://cdn.velion.io/media/jbl_video.mp4',
    isAvailable: true
  },
  {
    id: 'reloj-hw10-004',
    name: 'Reloj smartwatch HW 10 pro',
    imageUrl: 'https://cdn.velion.io/media/hw10.jpg',
    images: ['https://cdn.velion.io/media/hw10.jpg'],
    videoUrl: null,
    isAvailable: true
  },
  {
    id: 'reloj-geneva-005',
    name: 'Reloj Geneva + pulsera diseño black',
    imageUrl: 'https://cdn.velion.io/media/geneva.jpg',
    images: ['https://cdn.velion.io/media/geneva.jpg'],
    videoUrl: null,
    isAvailable: true
  }
];

let passedCount = 0;
let totalCount = 0;

function runTest(name, fn) {
  totalCount++;
  try {
    fn();
    console.log(`✅ [PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`❌ [FAIL] ${name}`);
    console.error(err);
  }
}

console.log('════════════════════════════════════════════════════════════════');
console.log('🧪 SUITE: MULTI-PRODUCT MEDIA REQUESTS REGRESSION TESTS');
console.log('════════════════════════════════════════════════════════════════\n');

// ── TEST 1 ──────────────────────────────────────────────────────────────────
runTest('TEST 1: "Lentes con cámara: foto y video + AirPods: foto" -> TOTAL_MEDIA_ITEMS = 3', () => {
  const userText = 'Lentes con cámara: foto y video + AirPods: foto';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: FIXTURE_PRODUCTS,
    currentCommercialState: {}
  });

  assert.strictEqual(result.shouldDispatch, true, 'Debe despachar');
  assert.strictEqual(result.isMultiProduct, true, 'Debe marcar isMultiProduct');
  assert.strictEqual(result.mediaItems.length, 3, `Debe tener 3 mediaItems, tuvo ${result.mediaItems.length}`);

  const lentesItems = result.mediaItems.filter(m => m.productId === 'lentes-uuid-001');
  const airpodsItems = result.mediaItems.filter(m => m.productId === 'airpods-uuid-002');

  assert.strictEqual(lentesItems.length, 2, 'Lentes debe tener 2 items (foto y video)');
  assert.ok(lentesItems.some(m => m.type === 'image'), 'Lentes image = YES');
  assert.ok(lentesItems.some(m => m.type === 'video'), 'Lentes video = YES');

  assert.strictEqual(airpodsItems.length, 1, 'AirPods debe tener 1 item (foto)');
  assert.ok(airpodsItems.some(m => m.type === 'image'), 'AirPods image = YES');
  assert.ok(!airpodsItems.some(m => m.type === 'video'), 'AirPods video = NO');

  // Orden lógico del mensaje
  assert.strictEqual(result.mediaItems[0].productId, 'lentes-uuid-001', 'Primer producto en orden debe ser Lentes');
  assert.strictEqual(result.mediaItems[2].productId, 'airpods-uuid-002', 'Último producto en orden debe ser AirPods');
});

// ── TEST 1B: CASO REAL DEL USUARIO ──────────────────────────────────────────
runTest('TEST 1B: "Ahora envíame una foto y video de los lentes con cámara, pero también quiero una foto de los AirPods"', () => {
  const userText = 'Ahora envíame una foto y video de los lentes con cámara, pero también quiero una foto de los AirPods';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: FIXTURE_PRODUCTS,
    currentCommercialState: {}
  });

  assert.strictEqual(result.shouldDispatch, true);
  assert.strictEqual(result.isMultiProduct, true);
  assert.strictEqual(result.mediaItems.length, 3, `Debe contener 3 items, tuvo ${result.mediaItems.length}`);

  const lentesImage = result.mediaItems.find(m => m.productId === 'lentes-uuid-001' && m.type === 'image');
  const lentesVideo = result.mediaItems.find(m => m.productId === 'lentes-uuid-001' && m.type === 'video');
  const airpodsImage = result.mediaItems.find(m => m.productId === 'airpods-uuid-002' && m.type === 'image');

  assert.ok(lentesImage, 'lentes image = YES');
  assert.ok(lentesVideo, 'lentes video = YES');
  assert.ok(airpodsImage, 'airpods image = YES');
});

// ── TEST 2 ──────────────────────────────────────────────────────────────────
runTest('TEST 2: "Envíame foto del JBL y foto de los AirPods" -> 2 productos, 2 imágenes', () => {
  const userText = 'Envíame foto del JBL y foto de los AirPods';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: FIXTURE_PRODUCTS,
    currentCommercialState: {}
  });

  assert.strictEqual(result.shouldDispatch, true);
  assert.strictEqual(result.isMultiProduct, true);
  assert.strictEqual(result.mediaItems.length, 2, `Debe tener 2 items, tuvo ${result.mediaItems.length}`);
  assert.strictEqual(result.mediaItems.every(m => m.type === 'image'), true, 'Todos los items deben ser imagen');

  const jblItem = result.mediaItems.find(m => m.productId === 'jbl-uuid-003');
  const airpodsItem = result.mediaItems.find(m => m.productId === 'airpods-uuid-002');

  assert.ok(jblItem, 'JBL image presente');
  assert.ok(airpodsItem, 'AirPods image presente');
});

// ── TEST 3 ──────────────────────────────────────────────────────────────────
runTest('TEST 3: "Video de los lentes y foto del JBL" -> lentes video, JBL image', () => {
  const userText = 'Video de los lentes y foto del JBL';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: FIXTURE_PRODUCTS,
    currentCommercialState: {}
  });

  assert.strictEqual(result.shouldDispatch, true);
  assert.strictEqual(result.isMultiProduct, true);
  assert.strictEqual(result.mediaItems.length, 2, `Debe tener 2 items, tuvo ${result.mediaItems.length}`);

  const lentesItem = result.mediaItems.find(m => m.productId === 'lentes-uuid-001');
  const jblItem = result.mediaItems.find(m => m.productId === 'jbl-uuid-003');

  assert.ok(lentesItem, 'Lentes presente');
  assert.strictEqual(lentesItem.type, 'video', 'Lentes debe ser video');

  assert.ok(jblItem, 'JBL presente');
  assert.strictEqual(jblItem.type, 'image', 'JBL debe ser image');
});

// ── TEST 4 ──────────────────────────────────────────────────────────────────
runTest('TEST 4: "Foto y video de los lentes" -> mantener comportamiento actual correcto (1 producto, 2 medios)', () => {
  const userText = 'Foto y video de los lentes';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: FIXTURE_PRODUCTS,
    currentCommercialState: {}
  });

  assert.strictEqual(result.shouldDispatch, true);
  assert.strictEqual(Boolean(result.isMultiProduct), false, 'Monoproducto NO debe ser isMultiProduct');
  assert.strictEqual(result.targetProduct.id, 'lentes-uuid-001', 'Producto objetivo debe ser Lentes');
  assert.strictEqual(result.mediaType, 'both', 'mediaType debe ser both');
  assert.strictEqual(result.urls.length, 2, 'Debe tener 2 URLs (foto y video)');
  assert.strictEqual(result.hasImage, true);
  assert.strictEqual(result.hasVideo, true);
});

// ── TEST 5 ──────────────────────────────────────────────────────────────────
runTest('TEST 5: "Envíame foto y video de un producto que me interesa" -> PRODUCT_CLARIFICATION_REQUIRED, 0 medios', () => {
  const userText = 'Envíame foto y video de un producto que me interesa';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: FIXTURE_PRODUCTS,
    currentCommercialState: {}
  });

  assert.strictEqual(result.shouldDispatch, false, 'No debe despachar');
  assert.strictEqual(result.reason, 'PRODUCT_CLARIFICATION_REQUIRED');
  assert.strictEqual(result.mediaItems.length, 0, '0 medios despachados');
});

// ── TEST 6 ──────────────────────────────────────────────────────────────────
runTest('TEST 6: Dos productos donde uno no tiene video -> medios existentes se envían correctamente, no bloquea el válido', () => {
  // Lentes tiene video y foto. AirPods solo tiene foto.
  const userText = 'Video de los lentes y video de los airpods';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: FIXTURE_PRODUCTS,
    currentCommercialState: {}
  });

  assert.strictEqual(result.shouldDispatch, true, 'Debe despachar lo disponible');
  assert.strictEqual(result.isMultiProduct, true);

  // Lentes sí tiene video
  const lentesItem = result.mediaItems.find(m => m.productId === 'lentes-uuid-001');
  assert.ok(lentesItem, 'Video de Lentes debe enviarse');
  assert.strictEqual(lentesItem.type, 'video');

  // AirPods no tiene video
  const airpodsReq = result.mediaRequests.find(r => r.productId === 'airpods-uuid-002');
  assert.ok(airpodsReq, 'AirPods debe estar registrado en las peticiones');
  assert.ok(airpodsReq.missingMedia.includes('video'), 'AirPods debe reportar falta de video');
  assert.strictEqual(result.mediaItems.filter(m => m.productId === 'airpods-uuid-002').length, 0, 'No se inventa video para AirPods');
});

// ── TEST 7 ──────────────────────────────────────────────────────────────────
runTest('TEST 7: Producto ambiguo + producto explícito -> no adivinar ambiguo, confirmar explícito sin sustitución', () => {
  // "reloj" es ambiguo (HW 10 pro y Geneva). "JBL" es explícito (JBL go 4 A1).
  const userText = 'Envíame foto del reloj y foto del JBL';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: FIXTURE_PRODUCTS,
    currentCommercialState: {}
  });

  assert.strictEqual(result.shouldDispatch, true, 'Debe despachar el producto explícito válido');
  assert.strictEqual(result.hasAmbiguousProducts, true, 'Debe registrar que hay productos ambiguos');
  assert.strictEqual(result.ambiguousGroups.length, 1, 'Debe haber 1 grupo ambiguo ("reloj")');

  // El producto explícito (JBL) debe enviarse correctamente
  const jblItems = result.mediaItems.filter(m => m.productId === 'jbl-uuid-003');
  assert.strictEqual(jblItems.length, 1, 'JBL debe tener 1 imagen');
  assert.strictEqual(jblItems[0].type, 'image');

  // No debe existir ningún item de los relojes ambiguos despachado arbitrariamente
  const hw10Items = result.mediaItems.filter(m => m.productId === 'reloj-hw10-004');
  const genevaItems = result.mediaItems.filter(m => m.productId === 'reloj-geneva-005');
  assert.strictEqual(hw10Items.length, 0, 'No debe haber enviado HW 10');
  assert.strictEqual(genevaItems.length, 0, 'No debe haber enviado Geneva');
});

// ── TEST 8: DEDUPLICACIÓN DE URLS (REGLA 5) ─────────────────────────────────
runTest('TEST 8: Deduplicación de URLs (Regla 5)', () => {
  // Dos solicitudes que apunten a la misma URL no deben duplicarla
  const userText = 'Foto del JBL y otra foto del JBL';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: FIXTURE_PRODUCTS,
    currentCommercialState: {}
  });

  const uniqueUrls = new Set(result.urls);
  assert.strictEqual(uniqueUrls.size, result.urls.length, 'No deben existir URLs duplicadas en urls');
});

console.log(`\n════════════════════════════════════════════════════════════════`);
console.log(`🏁 RESULTADOS: ${passedCount}/${totalCount} tests pasaron con éxito`);
console.log('════════════════════════════════════════════════════════════════');

if (passedCount < totalCount) {
  process.exit(1);
}
