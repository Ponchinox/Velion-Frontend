import assert from 'assert';
import {
  isExplicitHandoffRequested,
  isUnknownInfoHandoff
} from './src/services/humanHandoffService.js';
import { REQUEST_HUMAN_HANDOFF_DECLARATION } from './src/controllers/whatsappController.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}\n     ${err.message}`);
    failed++;
  }
}

async function runSuite() {
  console.log('======================================================================');
  console.log('🧪 VELION TEST SUITE: UNKNOWN_INFORMATION VS HUMAN_HANDOFF');
  console.log('======================================================================\n');

  console.log('── SECCIÓN 1: UNKNOWN DATA (NO DEBEN ACTIVAR HANDOFF) ──');

  await test('1.1 Fecha desconocida: "Las clases empiezan el lunes" -> NO handoff', () => {
    const userMsg = 'Las clases empiezan el lunes';
    const reason = 'Cliente consulta fecha exacta de inicio';
    assert.strictEqual(isExplicitHandoffRequested(userMsg), false, 'No debe ser solicitud explícita');
    assert.strictEqual(isUnknownInfoHandoff({ reason, userMessageText: userMsg }), true, 'Debe clasificarse como UNKNOWN_INFORMATION');
  });

  await test('1.2 Fecha desconocida: "¿Cuándo empiezan las clases?" -> NO handoff', () => {
    const userMsg = '¿Cuándo empiezan las clases?';
    const reason = 'Fecha de inicio no confirmada';
    assert.strictEqual(isExplicitHandoffRequested(userMsg), false);
    assert.strictEqual(isUnknownInfoHandoff({ reason, userMessageText: userMsg }), true);
  });

  await test('1.3 Profesor desconocido: "¿Quién será mi profesor?" -> NO handoff', () => {
    const userMsg = '¿Quién será mi profesor?';
    const reason = 'Profesor no asignado en el sistema';
    assert.strictEqual(isExplicitHandoffRequested(userMsg), false);
    assert.strictEqual(isUnknownInfoHandoff({ reason, userMessageText: userMsg }), true);
  });

  await test('1.4 Horario desconocido: "¿A qué hora comienzan?" -> NO handoff', () => {
    const userMsg = '¿A qué hora comienzan?';
    const reason = 'Consulta horario de clases';
    assert.strictEqual(isExplicitHandoffRequested(userMsg), false);
    assert.strictEqual(isUnknownInfoHandoff({ reason, userMessageText: userMsg }), true);
  });

  await test('1.5 Vacantes desconocidas: "¿Hay vacantes mañana?" -> NO handoff', () => {
    const userMsg = '¿Hay vacantes mañana?';
    const reason = 'Consulta vacantes disponibles';
    assert.strictEqual(isExplicitHandoffRequested(userMsg), false);
    assert.strictEqual(isUnknownInfoHandoff({ reason, userMessageText: userMsg }), true);
  });

  await test('1.6 Método de pago desconocido: "¿Puedo pagar con PayPal?" -> NO handoff', () => {
    const userMsg = '¿Puedo pagar con PayPal?';
    const reason = 'Método de pago no disponible en catálogo';
    assert.strictEqual(isExplicitHandoffRequested(userMsg), false);
    assert.strictEqual(isUnknownInfoHandoff({ reason, userMessageText: userMsg }), true);
  });

  await test('1.7 Garantía desconocida: "Además me garantiza que voy a ingresar a la universidad" -> NO handoff', () => {
    const userMsg = 'Además me garantiza que voy a ingresar a la universidad';
    const reason = 'Cliente consulta garantía de ingreso universitario';
    assert.strictEqual(isExplicitHandoffRequested(userMsg), false);
    assert.strictEqual(isUnknownInfoHandoff({ reason, userMessageText: userMsg }), true);
  });

  console.log('\n── SECCIÓN 2: EXPLICIT HANDOFF (SÍ DEBEN ACTIVAR HANDOFF) ──');

  await test('2.1 "Quiero hablar con una persona" -> Handoff REAL', () => {
    const userMsg = 'Quiero hablar con una persona';
    const reason = 'Cliente solicita atención con persona';
    assert.strictEqual(isExplicitHandoffRequested(userMsg), true, 'Debe detectarse como solicitud explícita');
    assert.strictEqual(isUnknownInfoHandoff({ reason, userMessageText: userMsg }), false, 'NUNCA debe bloquearse como unknown info');
  });

  await test('2.2 "Quiero asesor" -> Handoff REAL', () => {
    const userMsg = 'Quiero asesor';
    const reason = 'Solicitud de asesor humano';
    assert.strictEqual(isExplicitHandoffRequested(userMsg), true);
    assert.strictEqual(isUnknownInfoHandoff({ reason, userMessageText: userMsg }), false);
  });

  await test('2.3 "Quiero persona" -> Handoff REAL', () => {
    const userMsg = 'Quiero persona';
    const reason = 'Cliente pide persona real';
    assert.strictEqual(isExplicitHandoffRequested(userMsg), true);
    assert.strictEqual(isUnknownInfoHandoff({ reason, userMessageText: userMsg }), false);
  });

  await test('2.4 "Pásame con un asesor" -> Handoff REAL', () => {
    const userMsg = 'Pásame con un asesor';
    const reason = 'Cliente pide hablar con asesor';
    assert.strictEqual(isExplicitHandoffRequested(userMsg), true);
    assert.strictEqual(isUnknownInfoHandoff({ reason, userMessageText: userMsg }), false);
  });

  await test('2.5 "Comunícame con alguien" -> Handoff REAL', () => {
    const userMsg = 'Comunícame con alguien';
    const reason = 'Cliente pide hablar con alguien del equipo';
    assert.strictEqual(isExplicitHandoffRequested(userMsg), true);
    assert.strictEqual(isUnknownInfoHandoff({ reason, userMessageText: userMsg }), false);
  });

  await test('2.6 "¿Puedes pedirle a un asesor que me confirme cuándo empiezan?" -> Handoff REAL', () => {
    const userMsg = '¿Puedes pedirle a un asesor que me confirme cuándo empiezan?';
    const reason = 'Cliente solicita que un asesor confirme fecha de inicio';
    assert.strictEqual(isExplicitHandoffRequested(userMsg), true, 'El usuario pidió expresamente la intervención de un asesor');
    assert.strictEqual(isUnknownInfoHandoff({ reason, userMessageText: userMsg }), false, 'Debe permitirse el handoff');
  });

  await test('2.7 Reclamo o disputa formal -> Handoff REAL', () => {
    const userMsg = 'Tengo un reclamo con mi pedido, no me ha llegado nada';
    const reason = 'Reclamo de entrega';
    assert.strictEqual(isExplicitHandoffRequested(userMsg), true);
    assert.strictEqual(isUnknownInfoHandoff({ reason, userMessageText: userMsg }), false);
  });

  console.log('\n── SECCIÓN 3: OFFER / ACCEPT (OFERTA PREVIA + ACEPTACIÓN EXPLÍCITA) ──');

  await test('3.1 Aceptación: "Sí, por favor" -> Handoff REAL', () => {
    const userMsg = 'Sí, por favor';
    const reason = 'Cliente acepta transferencia a asesor';
    assert.strictEqual(isExplicitHandoffRequested(userMsg), true, 'Debe reconocerse como aceptación explícita');
    assert.strictEqual(isUnknownInfoHandoff({ reason, userMessageText: userMsg }), false);
  });

  await test('3.2 Aceptación: "Sí, comunícame con el asesor" -> Handoff REAL', () => {
    const userMsg = 'Sí, comunícame con el asesor';
    const reason = 'Cliente confirma transferencia';
    assert.strictEqual(isExplicitHandoffRequested(userMsg), true);
    assert.strictEqual(isUnknownInfoHandoff({ reason, userMessageText: userMsg }), false);
  });

  await test('3.3 Aceptación: "Claro, pásame con alguien" -> Handoff REAL', () => {
    const userMsg = 'Claro, pásame con alguien';
    const reason = 'Cliente acepta hablar con alguien';
    assert.strictEqual(isExplicitHandoffRequested(userMsg), true);
    assert.strictEqual(isUnknownInfoHandoff({ reason, userMessageText: userMsg }), false);
  });

  console.log('\n── SECCIÓN 4: SIMULACIÓN DE FLUJO INTEGRAL (TOOL Y REGEX) ──');

  await test('4.1 Simulador ToolsHandler: request_human_handoff bloqueado ante "Las clases empiezan el lunes"', () => {
    let botPaused = false;
    let handoffExecuted = false;

    const userMessageText = 'Las clases empiezan el lunes';
    const mockToolsHandler = async (funcName, args) => {
      if (funcName === 'request_human_handoff') {
        const cleanReason = String(args?.reason || '').trim();
        if (isUnknownInfoHandoff({ reason: cleanReason, userMessageText })) {
          return { success: false, handoffActive: false, rejectedAsUnknownInfo: true };
        }
        botPaused = true;
        handoffExecuted = true;
        return { success: true, handoffActive: true };
      }
    };

    const res = mockToolsHandler('request_human_handoff', { reason: 'Cliente consulta fecha exacta de inicio' });
    assert.strictEqual(botPaused, false, 'El bot NO debe pausarse');
    assert.strictEqual(handoffExecuted, false, 'No debe ejecutarse activateHumanHandoff');
  });

  await test('4.2 Simulador ToolsHandler: request_human_handoff aceptado ante "Quiero hablar con una persona"', async () => {
    let botPaused = false;
    let handoffExecuted = false;

    const userMessageText = 'Quiero hablar con una persona';
    const mockToolsHandler = async (funcName, args) => {
      if (funcName === 'request_human_handoff') {
        const cleanReason = String(args?.reason || '').trim();
        if (isUnknownInfoHandoff({ reason: cleanReason, userMessageText })) {
          return { success: false, handoffActive: false, rejectedAsUnknownInfo: true };
        }
        botPaused = true;
        handoffExecuted = true;
        return { success: true, handoffActive: true };
      }
    };

    const res = await mockToolsHandler('request_human_handoff', { reason: 'Cliente solicita asesor humano' });
    assert.strictEqual(botPaused, true, 'El bot SÍ debe pausarse ante solicitud explícita');
    assert.strictEqual(handoffExecuted, true, 'Debe ejecutarse activateHumanHandoff');
  });

  await test('4.3 Simulador Post-Gen: [HUMAN_HANDOFF: ...] ignorado y filtrado ante UNKNOWN DATA', () => {
    let botPaused = false;
    const userMessageText = 'Las clases empiezan el lunes';
    const aiResponse = 'No tengo confirmada la fecha exacta de inicio de las clases. Te ayudaré con la información disponible. [HUMAN_HANDOFF: Cliente consulta fecha de inicio]';

    const handoffRegex = /\[HUMAN_HANDOFF:\s*([\s\S]+?)\]/g;
    const handoffMatches = [];
    let m;
    while ((m = handoffRegex.exec(aiResponse)) !== null) {
      if (m[1]) handoffMatches.push(m[1].trim());
    }

    const validMatches = handoffMatches.filter(reason => !isUnknownInfoHandoff({ reason, userMessageText }));
    if (validMatches.length > 0) {
      botPaused = true;
    }

    const visibleText = aiResponse.replace(handoffRegex, '').trim();

    assert.strictEqual(validMatches.length, 0, 'No debe haber matches válidos de handoff');
    assert.strictEqual(botPaused, false, 'El bot no debe pausarse');
    assert.strictEqual(visibleText.includes('[HUMAN_HANDOFF'), false, 'El texto visible no debe contener la etiqueta');
    assert.strictEqual(visibleText.startsWith('No tengo confirmada la fecha'), true, 'El cliente recibe su respuesta normal');
  });

  await test('4.4 Simulador Post-Gen: [HUMAN_HANDOFF: ...] activado ante "Quiero un asesor"', () => {
    let botPaused = false;
    const userMessageText = 'Quiero un asesor';
    const aiResponse = 'Te transfiero con un asesor humano en este momento. [HUMAN_HANDOFF: Solicitud de asesor]';

    const handoffRegex = /\[HUMAN_HANDOFF:\s*([\s\S]+?)\]/g;
    const handoffMatches = [];
    let m;
    while ((m = handoffRegex.exec(aiResponse)) !== null) {
      if (m[1]) handoffMatches.push(m[1].trim());
    }

    const validMatches = handoffMatches.filter(reason => !isUnknownInfoHandoff({ reason, userMessageText }));
    if (validMatches.length > 0) {
      botPaused = true;
    }

    assert.strictEqual(validMatches.length, 1, 'Debe existir 1 match válido');
    assert.strictEqual(botPaused, true, 'El bot SÍ debe pausarse para el asesor humano');
  });

  console.log('\n── SECCIÓN 5: INTEGRIDAD DEL ESQUEMA Y DECLARACIÓN ──');

  await test('5.1 REQUEST_HUMAN_HANDOFF_DECLARATION preserva schema y declara prohibición de unknown info', () => {
    assert.strictEqual(REQUEST_HUMAN_HANDOFF_DECLARATION.name, 'request_human_handoff');
    assert.strictEqual(REQUEST_HUMAN_HANDOFF_DECLARATION.parameters.type, 'OBJECT');
    assert.deepStrictEqual(REQUEST_HUMAN_HANDOFF_DECLARATION.parameters.required, ['reason']);
    assert.ok(REQUEST_HUMAN_HANDOFF_DECLARATION.description.includes('NUNCA'), 'La descripción debe prohibir su uso ante datos desconocidos');
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE UNKNOWN INFO VS HANDOFF: ${passed} PASSED, ${failed} FAILED / ${passed + failed} TOTAL`);
  console.log('======================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite();
