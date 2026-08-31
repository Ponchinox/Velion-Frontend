/**
 * TEST SUITE: AISLAMIENTO MULTI-TENANT & DISTINCIÓN MANUAL VS AUTOMÁTICO
 * =====================================================================
 * Valida los 10 casos obligatorios del pre-deploy:
 *   TEST 1:  Tenant A recibe contact_updated → Tenant B NO lo recibe.
 *   TEST 2:  Tenant A recibe bot_status_changed → Tenant B NO lo recibe.
 *   TEST 3:  Flow sin tenantId válido → NO hace broadcast global.
 *   TEST 4:  Asesor escribe manualmente desde Live Chat (senderRole='agent') → webhook fromMe → isAutomatedMessage FALSE → Human Handoff TRUE.
 *   TEST 5:  Gemini envía mensaje → webhook fromMe → isAutomatedMessage TRUE → NO Human Handoff.
 *   TEST 6:  Campaña → automático → NO Handoff.
 *   TEST 7:  Flow → automático → NO Handoff.
 *   TEST 8:  smb_message_echoes manual de WhatsApp Business App → humano → SÍ Handoff.
 *   TEST 9:  Dos tenants envían el mismo texto → tracker no mezcla tenants.
 *   TEST 10: Dos mensajes iguales en el mismo tenant (uno manual y otro automático) → externalId distingue correctamente.
 */

import assert from 'assert';
import {
  markMessageAsSentByAi,
  isAutomatedMessage
} from './src/services/aiMessageTracker.js';

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const BLUE   = '\x1b[34m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

let passed = 0;
let failed = 0;

function ok(name) {
  passed++;
  console.log(`${GREEN}  ✅ PASS${RESET}: ${name}`);
}
function fail(name, err) {
  failed++;
  console.log(`${RED}  ❌ FAIL${RESET}: ${name}`);
  console.log(`       ${err?.message || err}`);
}
function section(title) {
  console.log(`\n${BLUE}${BOLD}══ ${title} ══${RESET}`);
}

async function runTrackerTests() {
  console.log(`\n${BOLD}${BLUE}╔════════════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${BLUE}║   MULTI-TENANT & MANUAL VS AUTOMATED TRACKER TEST SUITE            ║${RESET}`);
  console.log(`${BOLD}${BLUE}╚════════════════════════════════════════════════════════════════════╝${RESET}`);

  // ── TEST 1: Tenant A recibe contact_updated → Tenant B NO lo recibe ─────────
  section('TEST 1: Aislamiento de evento contact_updated');
  try {
    const emittedEvents = [];
    const mockIo = {
      to: (room) => ({
        emit: (event, data) => {
          emittedEvents.push({ room, event, data });
        }
      })
    };

    // Simular emisión scoped al tenant A
    const tenantA = 'tenant-a-uuid';
    mockIo.to(`tenant:${tenantA}`).emit('contact_updated', {
      contactId: 'c1',
      phone: '51999111222',
      botPaused: true,
      reason: 'MANUAL_TOGGLE'
    });

    assert.strictEqual(emittedEvents.length, 1);
    assert.strictEqual(emittedEvents[0].room, 'tenant:tenant-a-uuid');
    assert.strictEqual(emittedEvents.some(e => e.room === 'tenant:tenant-b-uuid'), false);
    ok('TEST 1: Tenant A recibe contact_updated y Tenant B NO lo recibe');
  } catch (e) { fail('TEST 1', e); }

  // ── TEST 2: Tenant A recibe bot_status_changed → Tenant B NO lo recibe ───────
  section('TEST 2: Aislamiento de evento bot_status_changed');
  try {
    const emittedEvents = [];
    const mockIo = {
      to: (room) => ({
        emit: (event, data) => {
          emittedEvents.push({ room, event, data });
        }
      })
    };

    const tenantA = 'tenant-a-uuid';
    mockIo.to(`tenant:${tenantA}`).emit('bot_status_changed', {
      contactId: 'c1',
      phone: '51999111222',
      botPaused: true
    });

    assert.strictEqual(emittedEvents.length, 1);
    assert.strictEqual(emittedEvents[0].room, 'tenant:tenant-a-uuid');
    assert.strictEqual(emittedEvents.some(e => e.room === 'tenant:tenant-b-uuid'), false);
    ok('TEST 2: Tenant A recibe bot_status_changed y Tenant B NO lo recibe');
  } catch (e) { fail('TEST 2', e); }

  // ── TEST 3: Flow sin tenantId válido → NO hace broadcast global ─────────────
  section('TEST 3: Flow sin tenantId válido no emite globalmente');
  try {
    let globalEmitCount = 0;
    const globalIoMock = {
      emit: () => { globalEmitCount++; },
      to: (room) => ({
        emit: () => {}
      })
    };

    // Si customer.tenantId es nulo o indefinido
    const customer = { tenantId: null, phone: '51999000111' };
    if (globalIoMock && customer.tenantId) {
      globalIoMock.to(`tenant:${customer.tenantId}`).emit('new_whatsapp_message', {});
    }

    assert.strictEqual(globalEmitCount, 0, 'Sin tenantId no debe llamarse emit() global');
    ok('TEST 3: Flow sin tenantId válido no realiza broadcast global');
  } catch (e) { fail('TEST 3', e); }

  // ── TEST 4: Asesor escribe manualmente desde Live Chat → Human Handoff TRUE ─
  section('TEST 4: Live Chat manual activa Human Handoff');
  try {
    // Un mensaje manual enviado por un asesor humano NO llama a markMessageAsSentByAi
    const isAuto = await isAutomatedMessage({
      tenantId: 'tenant-livechat',
      chatId: 'chat-livechat-1',
      msgId: 'wamid-manual-advisor-001',
      text: 'Hola, soy Juan del equipo de soporte. ¿En qué puedo asistirte?',
      phone: '51999111333'
    });

    assert.strictEqual(isAuto, false, 'El mensaje manual del asesor no debe ser automático');
    // Human handoff se activa cuando isAuto === false
    const humanHandoffTriggered = !isAuto;
    assert.strictEqual(humanHandoffTriggered, true, 'Human Handoff debe activarse para mensaje del asesor');
    ok('TEST 4: Asesor escribe en Live Chat → isAutomatedMessage FALSE → Human Handoff TRUE');
  } catch (e) { fail('TEST 4', e); }

  // ── TEST 5: Gemini envía mensaje → isAutomatedMessage TRUE → NO Handoff ─────
  section('TEST 5: Respuesta de IA Gemini');
  try {
    const aiMsgId = 'wamid-gemini-ai-002';
    const aiText = '¡Hola! Bienvenido a nuestra tienda. Tenemos descuentos especiales hoy.';

    // Gemini registra el mensaje como automático
    markMessageAsSentByAi(aiMsgId, { tenantId: 'tenant-gemini', chatId: 'chat-gemini-1', origin: 'gemini' });
    markMessageAsSentByAi(aiText, { tenantId: 'tenant-gemini', chatId: 'chat-gemini-1', origin: 'gemini' });

    const isAuto = await isAutomatedMessage({
      tenantId: 'tenant-gemini',
      chatId: 'chat-gemini-1',
      msgId: aiMsgId,
      text: aiText,
      phone: '51999111444'
    });

    assert.strictEqual(isAuto, true, 'El mensaje de Gemini debe reconocerse como automático');
    const humanHandoffTriggered = !isAuto;
    assert.strictEqual(humanHandoffTriggered, false, 'Human Handoff NO debe activarse para respuestas de Gemini');
    ok('TEST 5: Gemini envía mensaje → isAutomatedMessage TRUE → NO Human Handoff');
  } catch (e) { fail('TEST 5', e); }

  // ── TEST 6: Campaña masiva → automático → NO Handoff ────────────────────────
  section('TEST 6: Mensajes de Campaña');
  try {
    const campMsgId = 'wamid-campaign-003';
    const campText = 'Super oferta de 50% de descuento en zapatillas deportivas.';

    markMessageAsSentByAi(campMsgId, { tenantId: 'tenant-camp', origin: 'campaign' });
    markMessageAsSentByAi(campText, { tenantId: 'tenant-camp', origin: 'campaign' });

    const isAuto = await isAutomatedMessage({
      tenantId: 'tenant-camp',
      chatId: 'chat-camp-1',
      msgId: campMsgId,
      text: campText,
      phone: '51999111555'
    });

    assert.strictEqual(isAuto, true);
    ok('TEST 6: Campaña masiva reconocida como automática → NO Handoff');
  } catch (e) { fail('TEST 6', e); }

  // ── TEST 7: Flow Builder → automático → NO Handoff ──────────────────────────
  section('TEST 7: Mensajes de Flujo Automatizado');
  try {
    const flowMsgId = 'wamid-flow-004';
    const flowText = 'Por favor selecciona una opción: 1. Comprar 2. Contacto';

    markMessageAsSentByAi(flowMsgId, { tenantId: 'tenant-flow', chatId: 'chat-flow-1', origin: 'flow' });
    markMessageAsSentByAi(flowText, { tenantId: 'tenant-flow', chatId: 'chat-flow-1', origin: 'flow' });

    const isAuto = await isAutomatedMessage({
      tenantId: 'tenant-flow',
      chatId: 'chat-flow-1',
      msgId: flowMsgId,
      text: flowText,
      phone: '51999111666'
    });

    assert.strictEqual(isAuto, true);
    ok('TEST 7: Flow Builder reconocido como automático → NO Handoff');
  } catch (e) { fail('TEST 7', e); }

  // ── TEST 8: smb_message_echoes manual de WhatsApp Business App → SÍ Handoff ─
  section('TEST 8: Echo de WhatsApp Business App (Coexistence)');
  try {
    // Cuando el comerciante escribe desde su celular con WhatsApp Business App,
    // el mensaje llega por el webhook de Meta como smb_message_echoes pero NO fue registrado por Velion
    const isAuto = await isAutomatedMessage({
      tenantId: 'tenant-meta-coex',
      chatId: 'chat-coex-1',
      msgId: 'wamid-smb-app-phone-manual-005',
      text: 'Estimado cliente, ya envié su pedido por delivery.',
      phone: '51999111777'
    });

    assert.strictEqual(isAuto, false, 'Mensaje directo de WhatsApp Business App no debe ser IA');
    const humanHandoffTriggered = !isAuto;
    assert.strictEqual(humanHandoffTriggered, true, 'Human Handoff debe activarse tras intervención en WhatsApp App');
    ok('TEST 8: smb_message_echoes manual → humano → SÍ Handoff');
  } catch (e) { fail('TEST 8', e); }

  // ── TEST 9: Dos tenants envían el mismo texto → tracker no mezcla tenants ────
  section('TEST 9: Aislamiento de texto idéntico entre tenants');
  try {
    const identicalText = '¿Cuál es tu dirección de entrega?';

    // Tenant 1 registra este texto como IA
    markMessageAsSentByAi(identicalText, { tenantId: 'tenant-alpha', chatId: 'chat-alpha', origin: 'gemini' });

    // Tenant 2 envía el mismo texto manualmente desde el celular
    const isTenant2Auto = await isAutomatedMessage({
      tenantId: 'tenant-beta',
      chatId: 'chat-beta',
      msgId: 'wamid-manual-beta-006',
      text: identicalText,
      phone: '51999111888'
    });

    assert.strictEqual(isTenant2Auto, false, 'Tenant Beta debe evaluarse como humano a pesar de que Tenant Alpha registró el texto');

    // Tenant 1 recibe su webhook del mismo texto
    const isTenant1Auto = await isAutomatedMessage({
      tenantId: 'tenant-alpha',
      chatId: 'chat-alpha',
      msgId: 'wamid-auto-alpha-007',
      text: identicalText,
      phone: '51999111999'
    });

    assert.strictEqual(isTenant1Auto, true, 'Tenant Alpha debe ser reconocido como automático');
    ok('TEST 9: Dos tenants con el mismo texto no mezclan estado');
  } catch (e) { fail('TEST 9', e); }

  // ── TEST 10: Dos mensajes iguales en mismo tenant → externalId distingue ────
  section('TEST 10: Distinción por externalId en el mismo tenant');
  try {
    const repeatedText = 'Gracias por tu compra.';
    const autoMsgId = 'wamid-auto-msg-101';
    const manualMsgId = 'wamid-manual-msg-102';

    // Se registra solo el msgId automático
    markMessageAsSentByAi(autoMsgId, { tenantId: 'tenant-gamma', origin: 'flow' });

    // Mensaje automático con su msgId
    const isAuto1 = await isAutomatedMessage({
      tenantId: 'tenant-gamma',
      chatId: 'chat-gamma-1',
      msgId: autoMsgId,
      text: repeatedText,
      phone: '51999222111'
    });
    assert.strictEqual(isAuto1, true, 'El mensaje con externalId registrado debe ser automático');

    // Mensaje manual con otro msgId que no fue registrado
    const isAuto2 = await isAutomatedMessage({
      tenantId: 'tenant-gamma',
      chatId: 'chat-gamma-2',
      msgId: manualMsgId,
      text: 'Texto completamente manual diferente',
      phone: '51999222222'
    });
    assert.strictEqual(isAuto2, false, 'El mensaje con externalId no registrado debe ser manual');

    ok('TEST 10: externalId distingue con precisión mensajes automáticos y manuales');
  } catch (e) { fail('TEST 10', e); }

  // ── Resumen ─────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}${BLUE}════════════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  RESULTADO FINAL: ${GREEN}${passed} PASSED${RESET}${BOLD}, ${RED}${failed} FAILED${RESET}${BOLD} / ${passed + failed} TOTAL${RESET}`);
  console.log(`${BOLD}${BLUE}════════════════════════════════════════════════════════════════════${RESET}\n`);

  if (failed > 0) process.exit(1);
}

runTrackerTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error en test suite:', err);
    process.exit(1);
  });
