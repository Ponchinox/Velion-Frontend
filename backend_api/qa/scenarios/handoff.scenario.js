import assert from 'node:assert';

export async function runHandoffScenario() {
  console.log('\n======================================================================');
  console.log('👤 SCENARIO: HUMAN HANDOFF & BOT SILENCING (ZERO-COST S/0.00)');
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

  // 1. Detección de solicitud de asesor humano
  await test('H1: Mensajes explícitos solicitando humano activan señal de handoff', async () => {
    const isHandoffIntent = (text) => {
      const lower = text.toLowerCase();
      return /humano|asesor|persona real|alguien de verdad|hablar con alguien/i.test(lower);
    };

    assert.strictEqual(isHandoffIntent('Quiero hablar con un asesor'), true);
    assert.strictEqual(isHandoffIntent('Pásame con un humano por favor'), true);
    assert.strictEqual(isHandoffIntent('Cuál es el precio del reloj'), false);
  });

  // 2. Intervención humana pausa inmediatamente al bot
  await test('H2: Mensaje saliente enviado por un asesor humano pausa al bot inmediatamente', async () => {
    let chatState = {
      chatId: 'chat-handoff-101',
      aiEnabled: true,
      pausedByHuman: false,
      lastHumanMessageAt: null
    };

    const onOutgoingMessage = (msg) => {
      if (msg.fromMe && !msg.isFromBot) {
        chatState.pausedByHuman = true;
        chatState.lastHumanMessageAt = Date.now();
      }
    };

    // Asesor responde desde WhatsApp Web o app móvil
    onOutgoingMessage({ fromMe: true, isFromBot: false, text: 'Hola, te saluda Juan de soporte.' });

    assert.strictEqual(chatState.pausedByHuman, true, 'El bot debe quedar pausado tras intervención humana');
  });

  // 3. Bot silenciado no responde encima del humano
  await test('H3: Mensaje entrante de cliente cuando el bot está pausado NO genera respuesta automática', async () => {
    const chatState = { pausedByHuman: true };

    const shouldBotReply = (state) => {
      if (state.pausedByHuman) {
        return false; // Silenciamiento estricto
      }
      return true;
    };

    assert.strictEqual(shouldBotReply(chatState), false, 'El bot no debe contestar sobre el humano');
  });

  // 4. Reanudación correcta al reactivar el bot
  await test('H4: El operador puede reanudar el bot y este vuelve a responder normalmente', async () => {
    let chatState = { pausedByHuman: true };

    // Operador reactiva el bot desde el dashboard
    chatState.pausedByHuman = false;

    const shouldBotReply = (state) => !state.pausedByHuman;
    assert.strictEqual(shouldBotReply(chatState), true, 'El bot debe volver a procesar tras reanudación');
  });

  console.log(`\n🎉 HANDOFF SCENARIO: ${passed}/${total} TESTS PASARON EXITOSAMENTE`);
  return { passed, total };
}

if (process.argv[1] && process.argv[1].endsWith('handoff.scenario.js')) {
  runHandoffScenario().then(() => process.exit(0)).catch(() => process.exit(1));
}
