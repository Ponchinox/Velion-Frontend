/**
 * test_structured_media_planner.js
 * 
 * Regresiones completas para el Planificador Estructurado de Multimedia:
 * TEST 1: "Envíame foto de todos los smartwatch y los audífonos que tengas"
 *         -> todos los smartwatches + audífonos reales, sin JBL fuera de categoría
 * TEST 2: "Muéstrame todos los smartwatch"
 *         -> N smartwatches, N imágenes
 * TEST 3: "Muéstrame el smartwatch"
 *         -> AMBIGUOUS_PRODUCT_SELECTION si hay varios modelos (0 medios)
 * TEST 4: "Foto y video de los lentes"
 *         -> 1 producto, 2 medios (regresión monoproducto)
 * TEST 5: "Foto del JBL y foto de los AirPods"
 *         -> 2 productos explícitos, 2 medios (regresión multiproducto)
 * TEST 6: "Envíame foto y video de un producto que me interesa"
 *         -> PRODUCT_CLARIFICATION_REQUIRED (0 medios)
 * TEST 7: Contexto previo = JBL. Luego: "Muéstrame todos los smartwatch"
 *         -> JBL no aparece por fallback estale de contexto
 * TEST 8: "Foto de todos los smartwatch y video de los lentes"
 *         -> grupo smartwatch (imágenes) + lentes (video canónico)
 * TEST 9: Nota de voz equivalente al TEST 1
 *         -> mismo plan estructurado y resolución
 * TEST 10: Contexto = JBL. Usuario: "¿Tienes smartwatch?"
 *         -> NO enviar JBL, NO enviar todos los smartwatch automáticamente, 0 medios
 * TEST 11: Contexto = JBL. Usuario: "Quiero ver los smartwatch que tengas"
 *         -> scope=all, todos los smartwatch válidos, 0 JBL
 * TEST 12: "Muéstrame todos los audífonos"
 *         -> resolver según clasificación REAL del catálogo (incluye AirPods en audífonos)
 */

import assert from 'assert';
import {
  orchestrateProductMedia,
  detectTargetScope,
  resolveProductsByCategory,
  CANONICAL_CATEGORY_TAXONOMY
} from './src/services/productMediaOrchestrator.js';

// Catálogo idéntico a la base de datos de producción (tenant dfe020e6-5e08-404c-9b89-ef3f08f2b150)
// donde category es null en todos los registros
const REAL_CATALOG_FIXTURES = [
  {
    id: 'airpods-uuid-001',
    name: 'Airpods segunda generación ',
    category: null,
    imageUrl: 'https://cdn.velion.io/media/airpods_cover.jpg',
    images: ['https://cdn.velion.io/media/airpods_cover.jpg'],
    videoUrl: null,
    isAvailable: true
  },
  {
    id: 'xiaomi-uuid-002',
    name: 'Audífonos Xiaomi mini ',
    category: null,
    imageUrl: 'https://cdn.velion.io/media/xiaomi_cover.jpg',
    images: ['https://cdn.velion.io/media/xiaomi_cover.jpg'],
    videoUrl: null,
    isAvailable: true
  },
  {
    id: 'cargador-uuid-003',
    name: 'Cabeza de cargador apple USB C ',
    category: null,
    imageUrl: 'https://cdn.velion.io/media/cargador_cover.jpg',
    images: ['https://cdn.velion.io/media/cargador_cover.jpg'],
    videoUrl: null,
    isAvailable: true
  },
  {
    id: 'thinking-uuid-004',
    name: 'Audífonos thinking plus ',
    category: null,
    imageUrl: 'https://cdn.velion.io/media/thinking_cover.jpg',
    images: ['https://cdn.velion.io/media/thinking_cover.jpg'],
    videoUrl: null,
    isAvailable: true
  },
  {
    id: 'hw10-uuid-005',
    name: 'Reloj smartwatch HW 10 pro',
    category: null,
    imageUrl: 'https://cdn.velion.io/media/hw10.jpg',
    images: ['https://cdn.velion.io/media/hw10.jpg'],
    videoUrl: null,
    isAvailable: true
  },
  {
    id: 'hiwatch-uuid-006',
    name: 'Smartwatch Hi Watch pro ',
    category: null,
    imageUrl: 'https://cdn.velion.io/media/hiwatch.jpg',
    images: ['https://cdn.velion.io/media/hiwatch.jpg'],
    videoUrl: null,
    isAvailable: true
  },
  {
    id: 'jbl-uuid-007',
    name: 'JBL go 4 A1 ',
    category: null,
    imageUrl: 'https://cdn.velion.io/media/jbl_cover.jpg',
    images: ['https://cdn.velion.io/media/jbl_cover.jpg'],
    videoUrl: 'https://cdn.velion.io/media/jbl_video.mp4',
    isAvailable: true
  },
  {
    id: 'geneva-uuid-008',
    name: 'Reloj Geneva + pulsera diseño black ',
    category: null,
    imageUrl: 'https://cdn.velion.io/media/geneva.jpg',
    images: ['https://cdn.velion.io/media/geneva.jpg'],
    videoUrl: null,
    isAvailable: true
  },
  {
    id: 'lentes-uuid-009',
    name: 'Lentes de sol con cámara',
    category: null,
    imageUrl: 'https://cdn.velion.io/media/lentes_cover.jpg',
    images: ['https://cdn.velion.io/media/lentes_cover.jpg'],
    videoUrl: 'https://cdn.velion.io/media/lentes_video.mp4',
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
console.log('🧪 SUITE: STRUCTURED MEDIA PLANNER REGRESSION TESTS (12 TESTS)');
console.log('════════════════════════════════════════════════════════════════\n');

// ── TEST 1: CASO REAL OBLIGATORIO ───────────────────────────────────────────
runTest('TEST 1: "Envíame foto de todos los smartwatch y los audífonos que tengas" -> productos válidos sin JBL', () => {
  const userText = 'Envíame foto de todos los smartwatch y los audífonos que tengas';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: REAL_CATALOG_FIXTURES,
    currentCommercialState: { lastConsultedProductId: 'jbl-uuid-007' }
  });

  assert.strictEqual(result.shouldDispatch, true, 'Debe despachar los medios');
  assert.strictEqual(result.isMultiProduct, true, 'Debe ser multiproducto');

  // Verificar que NO exista ningún medio de JBL
  const jblItems = result.mediaItems.filter(m => m.productId === 'jbl-uuid-007');
  assert.strictEqual(jblItems.length, 0, 'JBL speaker NO debe aparecer en el despacho');

  // Verificar smartwatches resueltos
  const hw10 = result.mediaItems.find(m => m.productId === 'hw10-uuid-005');
  const hiwatch = result.mediaItems.find(m => m.productId === 'hiwatch-uuid-006');
  assert.ok(hw10, 'HW 10 pro debe estar encolado');
  assert.ok(hiwatch, 'Hi Watch pro debe estar encolado');

  // Verificar audífonos resueltos
  const xiaomi = result.mediaItems.find(m => m.productId === 'xiaomi-uuid-002');
  const thinking = result.mediaItems.find(m => m.productId === 'thinking-uuid-004');
  const airpods = result.mediaItems.find(m => m.productId === 'airpods-uuid-001');
  assert.ok(xiaomi, 'Audífonos Xiaomi mini deben estar encolados');
  assert.ok(thinking, 'Audífonos thinking plus deben estar encolados');
  assert.ok(airpods, 'AirPods deben estar incluidos en audífonos');

  // 1 imagen por producto
  for (const item of result.mediaItems) {
    assert.strictEqual(item.type, 'image', 'Cada ítem solicitado debe ser de tipo imagen');
  }
});

// ── TEST 2: CATEGORY ALL SMARTWATCH ─────────────────────────────────────────
runTest('TEST 2: "Muéstrame todos los smartwatch" -> N productos, N imágenes', () => {
  const userText = 'Muéstrame todos los smartwatch';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: REAL_CATALOG_FIXTURES,
    currentCommercialState: {}
  });

  assert.strictEqual(result.shouldDispatch, true, 'Debe despachar');
  const smartwatches = result.mediaItems.filter(m => m.productId === 'hw10-uuid-005' || m.productId === 'hiwatch-uuid-006');
  assert.strictEqual(smartwatches.length, 2, 'Deben haber 2 smartwatches encolados');
  assert.strictEqual(result.mediaItems.length, 2, 'Total de ítems debe ser exactamente 2');
});

// ── TEST 3: CATEGORY SINGLE WITH MULTIPLE CANDIDATES ────────────────────────
runTest('TEST 3: "Muéstrame el smartwatch" -> AMBIGUOUS_PRODUCT_SELECTION (0 medios)', () => {
  const userText = 'Muéstrame el smartwatch';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: REAL_CATALOG_FIXTURES,
    currentCommercialState: {}
  });

  assert.strictEqual(result.shouldDispatch, false, 'No debe despachar arbitrariamente');
  assert.strictEqual(result.isAmbiguous, true, 'Debe marcar ambigüedad');
  assert.strictEqual(result.reason, 'AMBIGUOUS_PRODUCT_SELECTION');
  assert.strictEqual(result.mediaItems.length, 0, '0 medios despachados');
});

// ── TEST 4: MONOPRODUCTO FOTO Y VIDEO ───────────────────────────────────────
runTest('TEST 4: "Foto y video de los lentes" -> mantener comportamiento actual', () => {
  const userText = 'Foto y video de los lentes';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: REAL_CATALOG_FIXTURES,
    currentCommercialState: {}
  });

  assert.strictEqual(result.shouldDispatch, true, 'Debe despachar');
  assert.strictEqual(result.mediaType, 'both', 'Debe ser both');
  assert.strictEqual(result.mediaItems.length, 2, 'Debe tener 2 items (foto y video)');
  assert.ok(result.mediaItems.some(m => m.type === 'image'), 'Tiene imagen');
  assert.ok(result.mediaItems.some(m => m.type === 'video'), 'Tiene video');
});

// ── TEST 5: MULTIPRODUCTO FOTO JBL + FOTO AIRPODS ───────────────────────────
runTest('TEST 5: "Foto del JBL y foto de los AirPods" -> mantener multiproducto actual', () => {
  const userText = 'Foto del JBL y foto de los AirPods';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: REAL_CATALOG_FIXTURES,
    currentCommercialState: {}
  });

  assert.strictEqual(result.shouldDispatch, true, 'Debe despachar');
  assert.strictEqual(result.mediaItems.length, 2, 'Debe tener 2 imágenes');
  assert.ok(result.mediaItems.some(m => m.productId === 'jbl-uuid-007'));
  assert.ok(result.mediaItems.some(m => m.productId === 'airpods-uuid-001'));
});

// ── TEST 6: REFERENCIA GENÉRICA GUARD ───────────────────────────────────────
runTest('TEST 6: "Envíame foto y video de un producto que me interesa" -> PRODUCT_CLARIFICATION_REQUIRED', () => {
  const userText = 'Envíame foto y video de un producto que me interesa';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: REAL_CATALOG_FIXTURES,
    currentCommercialState: {}
  });

  assert.strictEqual(result.shouldDispatch, false, 'No debe despachar');
  assert.strictEqual(result.reason, 'PRODUCT_CLARIFICATION_REQUIRED');
  assert.strictEqual(result.mediaItems.length, 0);
});

// ── TEST 7: CONTEXTO PREVIO JBL + "Muéstrame todos los smartwatch" ──────────
runTest('TEST 7: Contexto previo = JBL -> "Muéstrame todos los smartwatch" (sin JBL por contexto)', () => {
  const userText = 'Muéstrame todos los smartwatch';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: REAL_CATALOG_FIXTURES,
    currentCommercialState: {
      productId: 'jbl-uuid-007',
      lastConsultedProductId: 'jbl-uuid-007',
      isProductConfirmed: true,
      confirmedProductId: 'jbl-uuid-007'
    }
  });

  assert.strictEqual(result.shouldDispatch, true, 'Debe despachar');
  const jblItems = result.mediaItems.filter(m => m.productId === 'jbl-uuid-007');
  assert.strictEqual(jblItems.length, 0, 'JBL NO debe aparecer bajo ninguna circunstancia');
  assert.ok(result.mediaItems.some(m => m.productId === 'hw10-uuid-005'), 'HW10 presente');
  assert.ok(result.mediaItems.some(m => m.productId === 'hiwatch-uuid-006'), 'HiWatch presente');
});

// ── TEST 8: GRUPO CATEGORÍA FOTO + PRODUCTO EXPLÍCITO VIDEO ─────────────────
runTest('TEST 8: "Foto de todos los smartwatch y video de los lentes" -> smartwatches img + lentes vid', () => {
  const userText = 'Foto de todos los smartwatch y video de los lentes';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: REAL_CATALOG_FIXTURES,
    currentCommercialState: {}
  });

  assert.strictEqual(result.shouldDispatch, true, 'Debe despachar');
  const hw10 = result.mediaItems.find(m => m.productId === 'hw10-uuid-005');
  const hiwatch = result.mediaItems.find(m => m.productId === 'hiwatch-uuid-006');
  const lentes = result.mediaItems.find(m => m.productId === 'lentes-uuid-009');

  assert.ok(hw10 && hw10.type === 'image', 'HW 10 debe ser imagen');
  assert.ok(hiwatch && hiwatch.type === 'image', 'Hi Watch debe ser imagen');
  assert.ok(lentes && lentes.type === 'video', 'Lentes debe ser video');
});

// ── TEST 9: NOTA DE VOZ EQUIVALENTE AL TEST 1 ───────────────────────────────
runTest('TEST 9: Transcripción de nota de voz equivalente al TEST 1', () => {
  const voiceNoteText = 'Hola, por favor envíame foto de todos los smartwatch que tengas y también de los audífonos disponibles';
  const result = orchestrateProductMedia({
    userMessageText: voiceNoteText,
    availableProducts: REAL_CATALOG_FIXTURES,
    currentCommercialState: { lastConsultedProductId: 'jbl-uuid-007' }
  });

  assert.strictEqual(result.shouldDispatch, true, 'Debe despachar');
  const jblItems = result.mediaItems.filter(m => m.productId === 'jbl-uuid-007');
  assert.strictEqual(jblItems.length, 0, 'Cero JBL en transcripción de nota de voz');
  assert.ok(result.mediaItems.some(m => m.productId === 'hw10-uuid-005'), 'HW10 presente');
  assert.ok(result.mediaItems.some(m => m.productId === 'xiaomi-uuid-002'), 'Xiaomi presente');
});

// ── TEST 10: CONTEXTO JBL + "¿Tienes smartwatch?" (EXISTENCIA, NO ALL) ──────
runTest('TEST 10: Contexto = JBL. Usuario: "¿Tienes smartwatch?" -> 0 JBL, 0 auto-dispatch masivo', () => {
  const userText = '¿Tienes smartwatch?';
  const scope = detectTargetScope(userText);
  assert.strictEqual(scope, 'single', 'Una consulta de existencia no debe ser scope="all"');

  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: REAL_CATALOG_FIXTURES,
    currentCommercialState: { lastConsultedProductId: 'jbl-uuid-007' }
  });

  // No debe enviar JBL por contexto viejo
  const jblItems = result.mediaItems ? result.mediaItems.filter(m => m.productId === 'jbl-uuid-007') : [];
  assert.strictEqual(jblItems.length, 0, 'NO enviar JBL');
  // No debe enviar fotos automáticamente porque es una pregunta de existencia
  assert.strictEqual(result.shouldDispatch, false, 'No debe auto-despachar fotos ante pregunta de existencia');
});

// ── TEST 11: CONTEXTO JBL + "Quiero ver los smartwatch que tengas" ───────────
runTest('TEST 11: Contexto = JBL. Usuario: "Quiero ver los smartwatch que tengas" -> scope=all, 0 JBL', () => {
  const userText = 'Quiero ver los smartwatch que tengas';
  const scope = detectTargetScope(userText);
  assert.strictEqual(scope, 'all', 'Debe detectar scope="all" para "los ... que tengas"');

  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: REAL_CATALOG_FIXTURES,
    currentCommercialState: { lastConsultedProductId: 'jbl-uuid-007' }
  });

  assert.strictEqual(result.shouldDispatch, true, 'Debe despachar');
  const jblItems = result.mediaItems.filter(m => m.productId === 'jbl-uuid-007');
  assert.strictEqual(jblItems.length, 0, 'Cero JBL');
  assert.ok(result.mediaItems.some(m => m.productId === 'hw10-uuid-005'), 'HW10 presente');
  assert.ok(result.mediaItems.some(m => m.productId === 'hiwatch-uuid-006'), 'HiWatch presente');
});

// ── TEST 12: "Muéstrame todos los audífonos" (INCLUYE AIRPODS EN AUDÍFONOS) ──
runTest('TEST 12: "Muéstrame todos los audífonos" -> resolver según clasificación real (AirPods incluido)', () => {
  const userText = 'Muéstrame todos los audífonos';
  const result = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: REAL_CATALOG_FIXTURES,
    currentCommercialState: {}
  });

  assert.strictEqual(result.shouldDispatch, true, 'Debe despachar');
  const airpods = result.mediaItems.find(m => m.productId === 'airpods-uuid-001');
  assert.ok(airpods, 'AirPods forma parte del grupo audífonos según la taxonomía real');
  assert.ok(result.mediaItems.some(m => m.productId === 'xiaomi-uuid-002'), 'Xiaomi presente');
  assert.ok(result.mediaItems.some(m => m.productId === 'thinking-uuid-004'), 'thinking plus presente');
  assert.strictEqual(result.mediaItems.length, 3, 'Exactamente 3 audífonos en el catálogo');
});

console.log('\n════════════════════════════════════════════════════════════════');
console.log(`🏁 RESULTADOS: ${passedCount}/${totalCount} tests pasaron con éxito`);
console.log('════════════════════════════════════════════════════════════════\n');

if (passedCount < totalCount) {
  process.exit(1);
}
