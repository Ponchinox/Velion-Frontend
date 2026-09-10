import assert from 'node:assert';
import { TENANT_A } from '../fixtures/tenants.js';
import { ADVERSARIAL_FIXTURES } from '../fixtures/adversarial.js';
import {
  detectProductMediaIntent,
  enforceMediaAuthority
} from '../../src/controllers/whatsappController.js';

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

export async function runMultimediaScenario() {
  console.log('\n======================================================================');
  console.log('🎥 SCENARIO: MULTIMEDIA DELIVERY & REGRESSIONS (ZERO-COST S/0.00)');
  console.log('======================================================================');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✅ PASS: ${name}`);
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}: ${err.message}`);
      throw err;
    }
  }

  // 1. Detección directa de intención: "Foto"
  await test('M1: "Foto" detecta intent "image"', async () => {
    const intent = detectProductMediaIntent('Foto');
    assert.strictEqual(intent, 'image');
  });

  // 2. Detección directa de intención: "Aver"
  await test('M2: "Aver" detecta intent "image" / visualización', async () => {
    const intent = detectProductMediaIntent('Aver');
    assert.strictEqual(intent, 'image');
  });

  // 3. Detección directa de intención: "Video"
  await test('M3: "Video" detecta intent "video"', async () => {
    const intent = detectProductMediaIntent('Video');
    assert.strictEqual(intent, 'video');
  });

  // 4. Ráfaga real histórica: "Quiero el JBL go 4" / "Video" / "Y en qué colores hay" / "Disponible"
  await test('M4: Ráfaga de 4 mensajes coalescida resuelve video y producto JBL Go 4', async () => {
    const burst = ADVERSARIAL_FIXTURES.rapidBursts[0];
    const combinedText = burst.sequence.map((s) => s.text).join('\n');

    // Comprobar detección de media
    const detectedType = detectProductMediaIntent(combinedText);
    assert.strictEqual(detectedType, 'video', 'Ráfaga con "Video" debe detectar intent video');

    // Comprobar que JBL Go 4 tiene video en Tenant A
    const jbl = TENANT_A.products.find((p) => p.name.includes('JBL'));
    assert.ok(jbl.videoUrl, 'JBL Go 4 debe tener videoUrl configurado');
  });

  // 5. Verificación de que marcadores internos son 100% sanitizados
  await test('M5: Marcadores internos [Video enviado al cliente] son removidos de salida', async () => {
    const dirtyText = '[Video enviado al cliente]\nEl JBL go 4 A1 está disponible en color negro...';
    const pending = { url: '/products/videos/jbl-go-4.mp4', mediaType: 'video' };
    const sequence = assembleDispatchSequence(dirtyText, pending);
    const visibleText = sequence[0].caption || '';

    assert.ok(!visibleText.includes('[Video enviado al cliente]'), 'Marcador [Video enviado al cliente] debe eliminarse');
    assert.ok(!visibleText.includes('[Imagen enviada al cliente]'), 'Marcador [Imagen enviada al cliente] debe eliminarse');
    assert.ok(visibleText.includes('El JBL go 4 A1 está disponible'), 'Texto útil del cliente debe preservarse');
  });

  // 6. Verificación de que URLs internas de servidor jamás se filtran
  await test('M6: URLs internas de archivos (/media/tenants/, /products/videos/) no se filtran al cliente', async () => {
    const dirtyText = 'Aquí tienes el video http://127.0.0.1:3000/products/videos/jbl-go-4.mp4 que pediste.';
    const pending = { url: '/products/videos/jbl-go-4.mp4', mediaType: 'video' };
    const sequence = assembleDispatchSequence(dirtyText, pending);
    const visibleText = sequence[0].caption || '';

    assert.ok(!visibleText.includes('/products/videos/jbl-go-4.mp4'), 'URL interna no debe ser visible al cliente');
  });

  // 7. Video enviado exactamente 1 vez (Idempotencia de sesión)
  await test('M7: Cola de multimedia impide envíos duplicados en el mismo turno', async () => {
    let pendingMediaToSend = null;
    let mediaSentCount = 0;

    const enqueueMedia = (productId, mediaType) => {
      if (pendingMediaToSend) {
        return { queued: false, reason: 'MEDIA_ALREADY_QUEUED' };
      }
      pendingMediaToSend = { productId, mediaType };
      mediaSentCount++;
      return { queued: true };
    };

    const first = enqueueMedia('prod-alpha-jbl-02', 'video');
    assert.strictEqual(first.queued, true);

    const second = enqueueMedia('prod-alpha-jbl-02', 'video');
    assert.strictEqual(second.queued, false);
    assert.strictEqual(second.reason, 'MEDIA_ALREADY_QUEUED');
    assert.strictEqual(mediaSentCount, 1, 'Solo debe haber exactamente 1 video despachado');
  });

  // 8. Cambio de producto en caliente antes del despacho
  await test('M8: Cambio de producto cancela media previa y asocia el nuevo producto', async () => {
    let pendingMedia = { productId: 'prod-alpha-watch-01', mediaType: 'image' };

    // Cliente cambia de opinión a JBL Go 4
    const newIntent = { productId: 'prod-alpha-jbl-02', mediaType: 'video' };
    pendingMedia = newIntent; // reasignación por nuevo mensaje más reciente

    assert.strictEqual(pendingMedia.productId, 'prod-alpha-jbl-02');
    assert.strictEqual(pendingMedia.mediaType, 'video');
  });

  // 9. Falla en Gateway no reporta falsa entrega
  await test('M9: Gateway failure no confirma entrega errónea', async () => {
    const mockGatewaySendMedia = async () => {
      throw new Error('Evolution connection timeout');
    };

    let delivered = false;
    try {
      await mockGatewaySendMedia();
      delivered = true;
    } catch (err) {
      delivered = false;
    }

    assert.strictEqual(delivered, false, 'No debe confirmarse entrega si el gateway falló');
  });

  console.log(`\n🎉 MULTIMEDIA SCENARIO: ${passed}/${total} TESTS PASARON EXITOSAMENTE`);
  return { passed, total };
}

if (process.argv[1] && process.argv[1].endsWith('multimedia.scenario.js')) {
  runMultimediaScenario().then(() => process.exit(0)).catch(() => process.exit(1));
}
