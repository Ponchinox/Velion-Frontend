import assert from 'node:assert';
import axios from 'axios';
import { sendMedia } from './src/services/whatsappGateway.js';

// Desactivar modo de prueba estricto del gateway para permitir ejecución con mock de axios
delete process.env.NODE_ENV;
delete process.env.CAMPAIGN_TEST_MODE;
// Usar delay de 5ms para que los retries en tests sean instantáneos
process.env.GATEWAY_MEDIA_RETRY_DELAY_MS = '5';

console.log('======================================================================');
console.log('🧪 VELION EVOLUTION MEDIA RETRY SUITE: R1–R8');
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

const originalPost = axios.post;

function createMockAxios(responses) {
  let callIndex = 0;
  const recordedCalls = [];

  axios.post = async (url, payload, config) => {
    const currentCall = callIndex++;
    recordedCalls.push({ url, payload, config });
    const behavior = responses[currentCall];

    if (!behavior) {
      throw new Error(`Mock axios.post llamado sin respuesta configurada en intento ${currentCall + 1}`);
    }

    if (behavior.error) {
      throw behavior.error;
    }

    return behavior.response;
  };

  return {
    getCalls: () => recordedCalls,
    getCallCount: () => recordedCalls.length,
    restore: () => { axios.post = originalPost; }
  };
}

(async () => {
  try {
    // -------------------------------------------------------------------------
    // R1. Evolution media éxito en primer intento => 1 llamada
    // -------------------------------------------------------------------------
    await runTest('R1: Evolution media éxito en primer intento (1 llamada)', async () => {
      const mock = createMockAxios([
        { response: { data: { key: { id: 'evo_msg_r1_001' } } } }
      ]);
      try {
        const msgId = await sendMedia({
          provider: 'EVOLUTION',
          instance: 'bot_test_inst',
          apiKey: 'key_123',
          to: '51999999999',
          url: 'https://res.cloudinary.com/demo/image/upload/prod1.jpg',
          caption: 'Producto 1 - $50.00'
        });

        assert.strictEqual(msgId, 'evo_msg_r1_001', 'Debe retornar el msgId de Evolution');
        assert.strictEqual(mock.getCallCount(), 1, 'Debe realizar exactamente 1 llamada HTTP');
        const call = mock.getCalls()[0];
        assert.ok(call.url.includes('/message/sendMedia/bot_test_inst'), 'Debe llamar al endpoint de sendMedia');
        assert.strictEqual(call.payload.number, '51999999999');
        assert.strictEqual(call.payload.mediatype, 'image');
        assert.strictEqual(call.payload.media, 'https://res.cloudinary.com/demo/image/upload/prod1.jpg');
        assert.strictEqual(call.payload.caption, 'Producto 1 - $50.00');
      } finally {
        mock.restore();
      }
    });

    // -------------------------------------------------------------------------
    // R2. Evolution 503 en primer intento + éxito segundo => exactamente 2 llamadas y retorna msgId
    // -------------------------------------------------------------------------
    await runTest('R2: Evolution 503 en primer intento + éxito en segundo (2 llamadas)', async () => {
      const err503 = new Error('Request failed with status code 503');
      err503.response = { status: 503, data: 'Service Unavailable' };

      const mock = createMockAxios([
        { error: err503 },
        { response: { data: { key: { id: 'evo_msg_r2_002' } } } }
      ]);
      try {
        const msgId = await sendMedia({
          provider: 'EVOLUTION',
          instance: 'bot_test_inst',
          apiKey: 'key_123',
          to: '51999999999',
          url: 'https://res.cloudinary.com/demo/image/upload/prod2.jpg',
          caption: 'Producto 2 - $75.00'
        });

        assert.strictEqual(msgId, 'evo_msg_r2_002', 'Debe retornar el msgId exitoso del segundo intento');
        assert.strictEqual(mock.getCallCount(), 2, 'Debe haber realizado exactamente 2 llamadas (1 inicial + 1 retry)');
      } finally {
        mock.restore();
      }
    });

    // -------------------------------------------------------------------------
    // R3. Evolution ECONNRESET + éxito posterior => retry y éxito
    // -------------------------------------------------------------------------
    await runTest('R3: Evolution ECONNRESET + éxito posterior (retry y éxito)', async () => {
      const errConn = new Error('read ECONNRESET');
      errConn.code = 'ECONNRESET';

      const mock = createMockAxios([
        { error: errConn },
        { response: { data: { key: { id: 'evo_msg_r3_003' } } } }
      ]);
      try {
        const msgId = await sendMedia({
          provider: 'EVOLUTION',
          instance: 'bot_test_inst',
          apiKey: 'key_123',
          to: '51999999999',
          url: 'https://res.cloudinary.com/demo/image/upload/prod3.jpg',
          caption: 'Producto 3'
        });

        assert.strictEqual(msgId, 'evo_msg_r3_003', 'Debe recuperarse del ECONNRESET y retornar el msgId');
        assert.strictEqual(mock.getCallCount(), 2, 'Debe haber reintentado tras ECONNRESET');
      } finally {
        mock.restore();
      }
    });

    // -------------------------------------------------------------------------
    // R4. Evolution 400 => no retry (falla inmediatamente)
    // -------------------------------------------------------------------------
    await runTest('R4: Evolution 400 Bad Request => no retry (falla inmediatamente)', async () => {
      const err400 = new Error('Request failed with status code 400');
      err400.response = { status: 400, data: { message: 'Invalid phone number or media payload' } };

      const mock = createMockAxios([
        { error: err400 },
        { response: { data: { key: { id: 'should_not_happen' } } } }
      ]);
      try {
        let threw = false;
        try {
          await sendMedia({
            provider: 'EVOLUTION',
            instance: 'bot_test_inst',
            apiKey: 'key_123',
            to: '51999999999',
            url: 'https://res.cloudinary.com/demo/image/upload/bad.jpg',
            caption: 'Bad payload'
          });
        } catch (e) {
          threw = true;
          assert.strictEqual(e.response?.status, 400, 'Debe propagar el error 400 original');
        }

        assert.ok(threw, 'sendMedia debió lanzar error ante HTTP 400');
        assert.strictEqual(mock.getCallCount(), 1, 'HTTP 400 NO debe reintentarse (máx 1 llamada)');
      } finally {
        mock.restore();
      }
    });

    // -------------------------------------------------------------------------
    // R5. Evolution 401/403 => no retry (falla inmediatamente)
    // -------------------------------------------------------------------------
    await runTest('R5: Evolution 401/403 Auth Error => no retry (falla inmediatamente)', async () => {
      // Probar 401
      const err401 = new Error('Request failed with status code 401');
      err401.response = { status: 401, data: { message: 'Unauthorized API key' } };

      let mock = createMockAxios([
        { error: err401 },
        { response: { data: { key: { id: 'should_not_reach' } } } }
      ]);
      try {
        let threw401 = false;
        try {
          await sendMedia({
            provider: 'EVOLUTION',
            instance: 'bot_test_inst',
            apiKey: 'bad_key',
            to: '51999999999',
            url: 'https://res.cloudinary.com/demo/image/upload/auth.jpg'
          });
        } catch (e) {
          threw401 = true;
          assert.strictEqual(e.response?.status, 401);
        }
        assert.ok(threw401, 'Debe lanzar error 401');
        assert.strictEqual(mock.getCallCount(), 1, 'HTTP 401 NO debe reintentarse (1 llamada)');
      } finally {
        mock.restore();
      }

      // Probar 403
      const err403 = new Error('Request failed with status code 403');
      err403.response = { status: 403, data: { message: 'Forbidden' } };

      mock = createMockAxios([
        { error: err403 },
        { response: { data: { key: { id: 'should_not_reach' } } } }
      ]);
      try {
        let threw403 = false;
        try {
          await sendMedia({
            provider: 'EVOLUTION',
            instance: 'bot_test_inst',
            apiKey: 'forbidden_key',
            to: '51999999999',
            url: 'https://res.cloudinary.com/demo/image/upload/forbidden.jpg'
          });
        } catch (e) {
          threw403 = true;
          assert.strictEqual(e.response?.status, 403);
        }
        assert.ok(threw403, 'Debe lanzar error 403');
        assert.strictEqual(mock.getCallCount(), 1, 'HTTP 403 NO debe reintentarse (1 llamada)');
      } finally {
        mock.restore();
      }
    });

    // -------------------------------------------------------------------------
    // R6. Tres errores transitorios consecutivos => máximo 3 intentos y finalmente lanza error
    // -------------------------------------------------------------------------
    await runTest('R6: Tres errores transitorios consecutivos => máx 3 intentos y lanza error', async () => {
      const err502 = new Error('Bad Gateway');
      err502.response = { status: 502, data: 'Bad Gateway' };

      const errTimeout = new Error('Connection timeout');
      errTimeout.code = 'ETIMEDOUT';

      const err500 = new Error('Internal Server Error');
      err500.response = { status: 500, data: 'Crash' };

      const mock = createMockAxios([
        { error: err502 },
        { error: errTimeout },
        { error: err500 },
        { response: { data: { key: { id: 'attempt_4_should_never_happen' } } } }
      ]);
      try {
        let threw = false;
        try {
          await sendMedia({
            provider: 'EVOLUTION',
            instance: 'bot_test_inst',
            apiKey: 'key_123',
            to: '51999999999',
            url: 'https://res.cloudinary.com/demo/image/upload/fail.jpg',
            caption: 'Fail test'
          });
        } catch (e) {
          threw = true;
          assert.strictEqual(e.response?.status, 500, 'Debe propagar el error final del 3er intento');
        }

        assert.ok(threw, 'Debe lanzar error definitivo tras agotar retries');
        assert.strictEqual(mock.getCallCount(), 3, 'Debe realizar exactamente 3 intentos (1 inicial + 2 retries)');
      } finally {
        mock.restore();
      }
    });

    // -------------------------------------------------------------------------
    // R7. Meta sigue funcionando sin regresión
    // -------------------------------------------------------------------------
    await runTest('R7: Meta Cloud API sigue funcionando sin regresión (1 llamada directa)', async () => {
      const mock = createMockAxios([
        { response: { data: { messages: [{ id: 'wamid_meta_media_777' }] } } }
      ]);
      try {
        const msgId = await sendMedia({
          provider: 'META',
          metaPhoneNumberId: '10987654321',
          metaAccessToken: 'meta_secret_token',
          to: '51999999999',
          url: 'https://res.cloudinary.com/demo/image/upload/meta_prod.jpg',
          caption: 'Producto Meta Oficial - $120.00'
        });

        assert.strictEqual(msgId, 'wamid_meta_media_777', 'Debe retornar el ID de mensaje wamid de Meta');
        assert.strictEqual(mock.getCallCount(), 1, 'Meta debe realizar 1 llamada directa');

        const call = mock.getCalls()[0];
        assert.strictEqual(call.url, 'https://graph.facebook.com/v20.0/10987654321/messages');
        assert.strictEqual(call.payload.messaging_product, 'whatsapp');
        assert.strictEqual(call.payload.to, '51999999999');
        assert.strictEqual(call.payload.type, 'image');
        assert.strictEqual(call.payload.image.link, 'https://res.cloudinary.com/demo/image/upload/meta_prod.jpg');
        assert.strictEqual(call.payload.image.caption, 'Producto Meta Oficial - $120.00');
        assert.strictEqual(call.config.headers.Authorization, 'Bearer meta_secret_token');
      } finally {
        mock.restore();
      }
    });

    // -------------------------------------------------------------------------
    // R8. PRODUCT MEDIA sigue usando URL canónica y caption correctamente
    // -------------------------------------------------------------------------
    await runTest('R8: PRODUCT MEDIA envía URL canónica y caption exactos (imagen y video)', async () => {
      // Prueba con imagen
      let mock = createMockAxios([
        { response: { data: { key: { id: 'evo_canonical_img_01' } } } }
      ]);
      try {
        const canonicalUrl = 'https://res.cloudinary.com/my-shop/image/upload/v12345/products/camisa-lino-blanca.jpg';
        const formattedCaption = 'Camisa de Lino Blanca\nPrecio: $45.00\nDisponibilidad inmediata.';

        const msgId = await sendMedia({
          provider: 'EVOLUTION',
          instance: 'bot_test_inst',
          apiKey: 'key_123',
          to: '+51 999 888 777',
          url: canonicalUrl,
          caption: formattedCaption
        });

        assert.strictEqual(msgId, 'evo_canonical_img_01');
        assert.strictEqual(mock.getCallCount(), 1);

        const call = mock.getCalls()[0];
        assert.strictEqual(call.payload.number, '51999888777', 'Debe limpiar el número destino');
        assert.strictEqual(call.payload.mediatype, 'image', 'Debe inferir mediatype image');
        assert.strictEqual(call.payload.media, canonicalUrl, 'Debe preservar URL canónica exacta sin mutación');
        assert.strictEqual(call.payload.caption, formattedCaption, 'Debe preservar el caption íntegro');
      } finally {
        mock.restore();
      }

      // Prueba con video
      mock = createMockAxios([
        { response: { data: { key: { id: 'evo_canonical_vid_02' } } } }
      ]);
      try {
        const videoUrl = 'https://res.cloudinary.com/my-shop/video/upload/v12345/products/demo-video.mp4';
        const msgId = await sendMedia({
          provider: 'EVOLUTION',
          instance: 'bot_test_inst',
          apiKey: 'key_123',
          to: '51999888777',
          url: videoUrl,
          caption: 'Video Demo'
        });

        assert.strictEqual(msgId, 'evo_canonical_vid_02');
        assert.strictEqual(mock.getCallCount(), 1);

        const call = mock.getCalls()[0];
        assert.strictEqual(call.payload.mediatype, 'video', 'Debe detectar automáticamente video por extensión .mp4');
        assert.strictEqual(call.payload.media, videoUrl);
      } finally {
        mock.restore();
      }
    });

    console.log(`\n======================================================================`);
    console.log(`🎯 RESULTADO FINAL SUITE EVOLUTION MEDIA RETRY: ${passedTests}/${totalTests} PASADOS`);
    console.log(`======================================================================\n`);
  } catch (fatalErr) {
    console.error('\n💥 ERROR FATAL EN SUITE DE TESTS:', fatalErr);
    process.exit(1);
  }
})();
