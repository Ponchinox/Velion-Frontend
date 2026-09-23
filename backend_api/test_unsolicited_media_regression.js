/**
 * SUITE DE REGRESIÓN: REGLA DE AUTORIDAD MULTIMEDIA Y PREVENCIÓN DE MEDIOS NO SOLICITADOS
 * ========================================================================================
 * Valida de forma estricta que una imagen/video SOLO se despache ante un MEDIA INTENT
 * explícito o elíptico válido en el turno actual, y NUNCA ante frases coloquiales o
 * expresiones de contexto histórico ("Mañana te paso un sol", "gracias", "ok", etc.).
 */

import assert from 'node:assert';
import {
  orchestrateProductMedia,
  resolveTargetProduct,
  isEllipticalProductFollowUp
} from './src/services/productMediaOrchestrator.js';

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}:`, err.message);
    throw err;
  }
}

// Catálogo fixture de prueba
const CATALOG = [
  {
    id: 'prod-lentes',
    name: 'Lentes de sol con cámara',
    imageUrl: 'https://cdn.velion.io/images/lentes-camara.jpg',
    images: ['https://cdn.velion.io/images/lentes-camara.jpg'],
    videoUrl: 'https://cdn.velion.io/videos/lentes-demo.mp4',
    videos: ['https://cdn.velion.io/videos/lentes-demo.mp4']
  },
  {
    id: 'prod-jbl',
    name: 'JBL Go 4',
    imageUrl: 'https://cdn.velion.io/images/jbl-go-4.jpg',
    images: ['https://cdn.velion.io/images/jbl-go-4.jpg']
  },
  {
    id: 'prod-airpods',
    name: 'AirPods Pro',
    imageUrl: 'https://cdn.velion.io/images/airpods-pro.jpg',
    images: ['https://cdn.velion.io/images/airpods-pro.jpg']
  }
];

console.log('======================================================================');
console.log('🧪 SUITE DE REGRESIÓN: AUTORIDAD MULTIMEDIA Y CONTEXTO HISTÓRICO');
console.log('======================================================================\n');

// ── TEST 1: Contexto previo = Lentes | Cliente = "Mañana te paso un sol" ───
runTest('TEST 1: Contexto previo Lentes + "Mañana te paso un sol" -> 0 media, 0 lentes', () => {
  const userText = 'Mañana te paso un sol';
  const state = {
    productId: 'prod-lentes',
    lastConsultedProductId: 'prod-lentes',
    isProductConfirmed: true,
    confirmedProductId: 'prod-lentes'
  };

  const resolved = resolveTargetProduct(userText, CATALOG, state.productId, {
    lastConsultedProductId: state.lastConsultedProductId,
    isProductConfirmed: state.isProductConfirmed,
    confirmedProductId: state.confirmedProductId
  });
  assert.strictEqual(resolved, null, 'No debe resolver Lentes ni ningún producto ante "Mañana te paso un sol"');

  const media = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: CATALOG,
    currentCommercialState: state,
    sentMediaProductIds: []
  });

  assert.strictEqual(media.shouldDispatch, false, 'shouldDispatch debe ser false');
  assert.strictEqual(media.mediaItems.length, 0, '0 media items');
  assert.strictEqual(media.targetProduct, null, '0 producto target');
});

// ── TEST 2: Contexto previo = JBL | Cliente = "gracias" ────────────────────
runTest('TEST 2: Contexto previo JBL + "gracias" -> 0 media', () => {
  const userText = 'gracias';
  const state = {
    productId: 'prod-jbl',
    lastConsultedProductId: 'prod-jbl'
  };

  const media = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: CATALOG,
    currentCommercialState: state,
    sentMediaProductIds: []
  });

  assert.strictEqual(media.shouldDispatch, false, 'shouldDispatch debe ser false');
  assert.strictEqual(media.mediaItems.length, 0, '0 media items');
});

// ── TEST 3: Contexto previo = AirPods | Cliente = "2+3" ────────────────────
runTest('TEST 3: Contexto previo AirPods + "2+3" -> 0 media', () => {
  const userText = '2+3';
  const state = {
    productId: 'prod-airpods',
    lastConsultedProductId: 'prod-airpods',
    isProductConfirmed: true,
    confirmedProductId: 'prod-airpods'
  };

  const media = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: CATALOG,
    currentCommercialState: state,
    sentMediaProductIds: []
  });

  assert.strictEqual(media.shouldDispatch, false, 'shouldDispatch debe ser false');
  assert.strictEqual(media.mediaItems.length, 0, '0 media items');
});

// ── TEST 4: Contexto previo = Lentes | Cliente = "¿y su foto?" ─────────────
runTest('TEST 4: Contexto previo Lentes + "¿y su foto?" -> foto Lentes (1 media request)', () => {
  const userText = '¿y su foto?';
  const state = {
    productId: 'prod-lentes',
    lastConsultedProductId: 'prod-lentes',
    isProductConfirmed: true,
    confirmedProductId: 'prod-lentes'
  };

  assert.strictEqual(isEllipticalProductFollowUp(userText), true, 'Debe detectar seguimiento elíptico');

  const resolved = resolveTargetProduct(userText, CATALOG, state.productId, {
    isExplicitMedia: true,
    lastConsultedProductId: state.lastConsultedProductId,
    isProductConfirmed: state.isProductConfirmed,
    confirmedProductId: state.confirmedProductId
  });
  assert.ok(resolved !== null, 'Debe resolver producto previo por elipsis');
  assert.strictEqual(resolved.id, 'prod-lentes');

  const media = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: CATALOG,
    currentCommercialState: state,
    sentMediaProductIds: []
  });

  assert.strictEqual(media.shouldDispatch, true, 'shouldDispatch debe ser true');
  assert.strictEqual(media.mediaType, 'image', 'mediaType debe ser image');
  assert.strictEqual(media.targetProduct.id, 'prod-lentes', 'target debe ser Lentes');
  assert.strictEqual(media.mediaItems.length, 1, 'Exactamente 1 item de foto');
});

// ── TEST 5: Contexto previo = Lentes | Cliente = "¿y el video?" ────────────
runTest('TEST 5: Contexto previo Lentes + "¿y el video?" -> video Lentes', () => {
  const userText = '¿y el video?';
  const state = {
    productId: 'prod-lentes',
    lastConsultedProductId: 'prod-lentes'
  };

  assert.strictEqual(isEllipticalProductFollowUp(userText), true, 'Debe detectar seguimiento elíptico');

  const media = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: CATALOG,
    currentCommercialState: state,
    sentMediaProductIds: []
  });

  assert.strictEqual(media.shouldDispatch, true, 'shouldDispatch debe ser true');
  assert.strictEqual(media.mediaType, 'video', 'mediaType debe ser video');
  assert.strictEqual(media.targetProduct.id, 'prod-lentes', 'target debe ser Lentes');
  assert.strictEqual(media.mediaItems.length, 1, 'Exactamente 1 item de video');
  assert.strictEqual(media.mediaItems[0].type, 'video');
});

// ── TEST 6: Contexto previo = Lentes | Cliente = "Mañana te confirmo" ──────
runTest('TEST 6: Contexto previo Lentes + "Mañana te confirmo" -> 0 media', () => {
  const userText = 'Mañana te confirmo';
  const state = {
    productId: 'prod-lentes',
    lastConsultedProductId: 'prod-lentes',
    isProductConfirmed: true,
    confirmedProductId: 'prod-lentes'
  };

  const media = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: CATALOG,
    currentCommercialState: state,
    sentMediaProductIds: []
  });

  assert.strictEqual(media.shouldDispatch, false, 'shouldDispatch debe ser false');
  assert.strictEqual(media.mediaItems.length, 0, '0 media items');
});

// ── TEST 7: Sin contexto previo | Cliente = "mándame foto de los lentes" ────
runTest('TEST 7: Sin contexto previo + "mándame foto de los lentes" -> foto Lentes', () => {
  const userText = 'mándame foto de los lentes';
  const state = {};

  const media = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: CATALOG,
    currentCommercialState: state,
    sentMediaProductIds: []
  });

  assert.strictEqual(media.shouldDispatch, true, 'shouldDispatch debe ser true');
  assert.strictEqual(media.mediaType, 'image', 'mediaType debe ser image');
  assert.strictEqual(media.targetProduct.id, 'prod-lentes', 'target debe ser Lentes');
  assert.strictEqual(media.mediaItems.length, 1, 'Exactamente 1 item de foto');
});

// ── TEST 8: Contexto previo = JBL | Cliente = "mándame foto de los lentes" ──
runTest('TEST 8: Contexto previo JBL + "mándame foto de los lentes" -> foto Lentes, 0 JBL', () => {
  const userText = 'mándame foto de los lentes';
  const state = {
    productId: 'prod-jbl',
    lastConsultedProductId: 'prod-jbl',
    confirmedProductId: 'prod-jbl',
    isProductConfirmed: true
  };

  const media = orchestrateProductMedia({
    userMessageText: userText,
    availableProducts: CATALOG,
    currentCommercialState: state,
    sentMediaProductIds: []
  });

  assert.strictEqual(media.shouldDispatch, true, 'shouldDispatch debe ser true');
  assert.strictEqual(media.mediaType, 'image', 'mediaType debe ser image');
  assert.strictEqual(media.targetProduct.id, 'prod-lentes', 'target debe ser Lentes y NO JBL');
  assert.strictEqual(media.mediaItems.length, 1, '1 item de foto');
  assert.notStrictEqual(media.targetProduct.id, 'prod-jbl', 'No debe contaminar con JBL');
});

// ── TEST 9: Batería exhaustiva de mensajes cotidianos con contexto activo ──
runTest('TEST 9: Batería de mensajes cotidianos con contexto activo -> 0 media para todos', () => {
  const state = {
    productId: 'prod-lentes',
    lastConsultedProductId: 'prod-lentes',
    confirmedProductId: 'prod-lentes',
    isProductConfirmed: true
  };

  const messages = [
    'ok',
    'ya',
    'hola',
    'te aviso mañana',
    'voy a comer',
    'cállate',
    'cuánto es',
    'me llamo Carlos',
    'perfecto',
    'de acuerdo',
    'buenas tardes',
    '¿hacen envíos a Lima?',
    'tengo una duda'
  ];

  for (const msg of messages) {
    const media = orchestrateProductMedia({
      userMessageText: msg,
      availableProducts: CATALOG,
      currentCommercialState: state,
      sentMediaProductIds: []
    });

    assert.strictEqual(
      media.shouldDispatch,
      false,
      `Mensaje "${msg}" no debe disparar multimedia (shouldDispatch=false)`
    );
    assert.strictEqual(
      media.mediaItems.length,
      0,
      `Mensaje "${msg}" debe tener 0 media items`
    );
  }
});

console.log(`\n======================================================================`);
console.log(`🏁 SUITE DE REGRESIÓN: ${passedTests}/${totalTests} TESTS PASARON EXITOSAMENTE`);
console.log('======================================================================\n');
