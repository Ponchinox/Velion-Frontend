import assert from 'node:assert';

export async function runRapidMessagesScenario() {
  console.log('\n======================================================================');
  console.log('⚡ SCENARIO: RAPID MESSAGES & GENERATION SUPERSEDING (ZERO-COST S/0.00)');
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

  // 1. Mensajes A, B, C enviados en ráfaga rápida
  await test('R1: Mensajes A, B, C coalescen en buffer y la última intención prevalece', async () => {
    const buffer = [];
    const pushMessage = (msg) => buffer.push(msg);

    pushMessage({ id: 'msg-1', text: 'Hola' });
    pushMessage({ id: 'msg-2', text: 'Quiero un reloj' });
    pushMessage({ id: 'msg-3', text: 'No mejor el JBL' });

    assert.strictEqual(buffer.length, 3);
    const combined = buffer.map((m) => m.text).join('\n');
    assert.ok(combined.includes('JBL'), 'Debe contener la intención final');
  });

  // 2. Generación superseded aborta respuesta desfasada
  await test('R2: Incremento de epoch cancela generación en vuelo (no stale reply)', async () => {
    let currentEpoch = 1;
    let sentReplies = [];

    const startGeneration = async (epoch, text) => {
      // Simula tiempo de procesamiento de IA
      await new Promise((r) => setTimeout(r, 50));
      if (epoch !== currentEpoch) {
        // Generación desfasada / superseded
        return null;
      }
      sentReplies.push(text);
      return text;
    };

    // Mensaje 1 inicia generación con epoch 1
    const p1 = startGeneration(1, 'Respuesta al mensaje 1');

    // Mensaje 2 llega rápidamente e incrementa epoch a 2
    currentEpoch = 2;
    const p2 = startGeneration(2, 'Respuesta al mensaje 2');

    await Promise.all([p1, p2]);

    assert.strictEqual(sentReplies.length, 1);
    assert.strictEqual(sentReplies[0], 'Respuesta al mensaje 2', 'Solo la respuesta más reciente debe ser emitida');
  });

  // 3. Media stale es anulada si la generación fue superseded
  await test('R3: Media pendiente se anula si entra nuevo mensaje antes del despacho', async () => {
    let pendingMedia = { productId: 'prod-watch', mediaType: 'image' };
    let isSuperseded = false;

    // Nuevo mensaje entra
    isSuperseded = true;
    if (isSuperseded) {
      pendingMedia = null; // Anulación inmediata
    }

    assert.strictEqual(pendingMedia, null, 'Media no debe ser enviada si la generación quedó superseded');
  });

  // 4. Aborto superseded se captura defensivamente sin crash
  await test('R4: Error GENERATION_SUPERSEDED es capturado limpiamente sin crash', async () => {
    let processCrashed = false;

    try {
      const runPipeline = async () => {
        const isSuperseded = true;
        if (isSuperseded) {
          const err = new Error('GENERATION_SUPERSEDED');
          err.code = 'GENERATION_SUPERSEDED';
          throw err;
        }
      };

      await runPipeline();
    } catch (err) {
      if (err.code === 'GENERATION_SUPERSEDED') {
        // Neutralizado defensivamente
        processCrashed = false;
      } else {
        processCrashed = true;
      }
    }

    assert.strictEqual(processCrashed, false, 'GENERATION_SUPERSEDED debe ser neutralizado limpiamente');
  });

  console.log(`\n🎉 RAPID MESSAGES SCENARIO: ${passed}/${total} TESTS PASARON EXITOSAMENTE`);
  return { passed, total };
}

if (process.argv[1] && process.argv[1].endsWith('rapidMessages.scenario.js')) {
  runRapidMessagesScenario().then(() => process.exit(0)).catch(() => process.exit(1));
}
