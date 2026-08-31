import assert from 'node:assert';
import prisma from './src/db.js';
import * as chatController from './src/controllers/chatController.js';
import { activateHumanHandoff, HUMAN_HANDOFF_MS, HUMAN_HANDOFF_MINUTES } from './src/services/humanHandoffService.js';
import { isAutomatedMessage, markMessageAsSentByAi } from './src/services/aiMessageTracker.js';

console.log('======================================================================');
console.log('🧪 LIVE CHAT MANUAL HUMAN HANDOFF & TIMESTAMP SUITE (TESTS A - L)');
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

async function main() {
  const stamp = Date.now();
  const tenantAId = `test-ts-tenant-a-${stamp}`;
  const tenantBId = `test-ts-tenant-b-${stamp}`;

  // 1. Crear Tenants de prueba
  const tenantA = await prisma.tenant.create({
    data: {
      id: tenantAId,
      name: `Tenant LiveHandoff A ${stamp}`,
      aiEnabled: true,
      msgLimit: 1000,
    }
  });

  const tenantB = await prisma.tenant.create({
    data: {
      id: tenantBId,
      name: `Tenant LiveHandoff B ${stamp}`,
      aiEnabled: true,
      msgLimit: 1000,
    }
  });

  const phoneA = `51988${stamp.toString().slice(-6)}`;
  const phoneB = `51977${stamp.toString().slice(-6)}`;

  // 2. Crear Contactos, Chats y Customers
  const contactA = await prisma.contact.create({
    data: {
      name: 'Cliente A',
      phone: phoneA,
      tenantId: tenantA.id,
      botPaused: false
    }
  });

  const chatA = await prisma.chat.create({
    data: {
      tenantId: tenantA.id,
      contactId: contactA.id,
      botPaused: false
    }
  });

  const customerA = await prisma.customer.create({
    data: {
      tenantId: tenantA.id,
      phone: phoneA,
      name: 'Cliente A',
      isBotPaused: false,
      persistentProfile: { previousBuyer: true, score: 95 }
    }
  });

  try {
    const baseTime1500 = new Date('2026-08-31T15:00:00.000Z');

    // ──────────────────────────────────────────────────────────────────────────
    console.log('══ TEST A: 15:00 Humano responde -> lastHumanInterventionAt = 15:00 ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST A: activateHumanHandoff guarda lastHumanInterventionAt en persistentProfile', async () => {
      // Simular intervención humana a las 15:00
      await activateHumanHandoff({
        tenantId: tenantA.id,
        contactId: contactA.id,
        chatId: chatA.id,
        phone: phoneA,
        reason: 'HUMAN_INTERVENTION_LIVECHAT'
      });

      // Sobrescribir timestamp a las 15:00:00 para simulación controlada
      await prisma.customer.update({
        where: { id: customerA.id },
        data: {
          persistentProfile: {
            previousBuyer: true,
            score: 95,
            lastHumanInterventionAt: baseTime1500.toISOString()
          }
        }
      });

      const cust = await prisma.customer.findUnique({ where: { id: customerA.id } });
      assert.strictEqual(cust.isBotPaused, true, 'Customer.isBotPaused es true');
      assert.strictEqual(cust.persistentProfile.lastHumanInterventionAt, baseTime1500.toISOString());
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST B: Cliente escribe 15:10 -> Timestamp SIGUE 15:00 (NO cambia) ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST B: Mensaje entrante del cliente a las 15:10 no altera lastHumanInterventionAt', async () => {
      const msg1510 = new Date('2026-08-31T15:10:00.000Z');

      // Simular mensaje entrante del cliente y actualización de Chat.updatedAt (para orden en Live Chat)
      await prisma.$transaction([
        prisma.message.create({
          data: {
            content: 'Hola, asesor? (15:10)',
            senderRole: 'contact',
            chatId: chatA.id,
            tenantId: tenantA.id,
            createdAt: msg1510
          }
        }),
        prisma.chat.update({ where: { id: chatA.id }, data: { updatedAt: msg1510 } })
      ]);

      const cust = await prisma.customer.findUnique({ where: { id: customerA.id } });
      const lastInterventionIso = cust.persistentProfile.lastHumanInterventionAt;
      assert.strictEqual(lastInterventionIso, baseTime1500.toISOString(), 'El timestamp de intervención humana sigue siendo 15:00');

      // Evaluar si transcurrieron 30 min a las 15:10
      const diff1510Ms = msg1510.getTime() - new Date(lastInterventionIso).getTime();
      assert.strictEqual(diff1510Ms, 10 * 60 * 1000, 'Han pasado exactamente 10 minutos');
      assert.ok(diff1510Ms < HUMAN_HANDOFF_MS, 'Bot permanece pausado');
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST C: Cliente escribe 15:25 -> Timestamp SIGUE 15:00 ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST C: Segundo mensaje del cliente a las 15:25 no altera lastHumanInterventionAt', async () => {
      const msg1525 = new Date('2026-08-31T15:25:00.000Z');

      await prisma.$transaction([
        prisma.message.create({
          data: {
            content: 'Siguen ahí? (15:25)',
            senderRole: 'contact',
            chatId: chatA.id,
            tenantId: tenantA.id,
            createdAt: msg1525
          }
        }),
        prisma.chat.update({ where: { id: chatA.id }, data: { updatedAt: msg1525 } })
      ]);

      const cust = await prisma.customer.findUnique({ where: { id: customerA.id } });
      const lastInterventionIso = cust.persistentProfile.lastHumanInterventionAt;
      assert.strictEqual(lastInterventionIso, baseTime1500.toISOString(), 'Timestamp sigue intacto en 15:00');

      const diff1525Ms = msg1525.getTime() - new Date(lastInterventionIso).getTime();
      assert.strictEqual(diff1525Ms, 25 * 60 * 1000, 'Han pasado 25 minutos');
      assert.ok(diff1525Ms < HUMAN_HANDOFF_MS, 'Bot permanece pausado');
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST D: Cliente escribe 15:35 -> Han pasado 35 min -> Auto-reactivación ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST D: A las 15:35 han pasado 35 min desde 15:00 y el bot se auto-reactiva', async () => {
      const msg1535 = new Date('2026-08-31T15:35:00.000Z');

      await prisma.$transaction([
        prisma.message.create({
          data: {
            content: 'Hola por favor responder (15:35)',
            senderRole: 'contact',
            chatId: chatA.id,
            tenantId: tenantA.id,
            createdAt: msg1535
          }
        }),
        prisma.chat.update({ where: { id: chatA.id }, data: { updatedAt: msg1535 } })
      ]);

      const cust = await prisma.customer.findUnique({ where: { id: customerA.id } });
      const lastInterventionIso = cust.persistentProfile.lastHumanInterventionAt;

      const diff1535Ms = msg1535.getTime() - new Date(lastInterventionIso).getTime();
      assert.strictEqual(diff1535Ms, 35 * 60 * 1000, 'Han pasado exactamente 35 minutos');
      assert.ok(diff1535Ms >= HUMAN_HANDOFF_MS, 'timeDiffMs >= 30 min');

      // Simular la auto-reactivación que ejecuta whatsappController
      let isPaused = cust.isBotPaused;
      if (diff1535Ms >= HUMAN_HANDOFF_MS) {
        await prisma.$transaction([
          prisma.chat.update({ where: { id: chatA.id }, data: { botPaused: false } }),
          prisma.contact.update({ where: { id: contactA.id }, data: { botPaused: false } }),
          prisma.customer.update({ where: { id: customerA.id }, data: { isBotPaused: false } })
        ]);
        isPaused = false;
      }

      assert.strictEqual(isPaused, false, 'El bot se despausa y Gemini puede responder');
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST E: Mensaje automático de Gemini -> NO cambia lastHumanInterventionAt ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST E: Respuesta generada por Gemini no altera lastHumanInterventionAt', async () => {
      const custBefore = await prisma.customer.findUnique({ where: { id: customerA.id } });
      const tsBefore = custBefore.persistentProfile.lastHumanInterventionAt;

      const aiText = `Respuesta IA ${stamp}`;
      const aiMsgId = `ai-resp-${stamp}`;
      markMessageAsSentByAi(aiMsgId, { tenantId: tenantA.id, origin: 'ai' });
      markMessageAsSentByAi(aiText, { tenantId: tenantA.id, origin: 'ai' });

      const isAutomated = await isAutomatedMessage({
        tenantId: tenantA.id,
        chatId: chatA.id,
        msgId: aiMsgId,
        text: aiText,
        phone: phoneA
      });

      assert.strictEqual(isAutomated, true, 'Mensaje de IA es automático');
      // No se llama a activateHumanHandoff
      const custAfter = await prisma.customer.findUnique({ where: { id: customerA.id } });
      assert.strictEqual(custAfter.persistentProfile.lastHumanInterventionAt, tsBefore);
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST F: Mensaje de Campaña -> NO cambia timestamp ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST F: Mensaje de Campaña masiva no altera lastHumanInterventionAt', async () => {
      const custBefore = await prisma.customer.findUnique({ where: { id: customerA.id } });
      const tsBefore = custBefore.persistentProfile.lastHumanInterventionAt;

      const campText = `Campaña ${stamp}`;
      markMessageAsSentByAi(campText, { tenantId: tenantA.id, origin: 'campaign' });

      const isAutomated = await isAutomatedMessage({
        tenantId: tenantA.id,
        chatId: chatA.id,
        text: campText,
        phone: phoneA
      });

      assert.strictEqual(isAutomated, true);
      const custAfter = await prisma.customer.findUnique({ where: { id: customerA.id } });
      assert.strictEqual(custAfter.persistentProfile.lastHumanInterventionAt, tsBefore);
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST G: Mensaje de Flow -> NO cambia timestamp ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST G: Mensaje de Flow automatizado no altera lastHumanInterventionAt', async () => {
      const custBefore = await prisma.customer.findUnique({ where: { id: customerA.id } });
      const tsBefore = custBefore.persistentProfile.lastHumanInterventionAt;

      const flowText = `Flow menu ${stamp}`;
      markMessageAsSentByAi(flowText, { tenantId: tenantA.id, origin: 'flow' });

      const isAutomated = await isAutomatedMessage({
        tenantId: tenantA.id,
        chatId: chatA.id,
        text: flowText,
        phone: phoneA
      });

      assert.strictEqual(isAutomated, true);
      const custAfter = await prisma.customer.findUnique({ where: { id: customerA.id } });
      assert.strictEqual(custAfter.persistentProfile.lastHumanInterventionAt, tsBefore);
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST H: Nueva intervención humana a 15:20 -> Timestamp cambia a 15:20 ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST H: Nueva respuesta humana actualiza lastHumanInterventionAt y renueva los 30 min', async () => {
      const time1520 = new Date('2026-08-31T15:20:00.000Z');

      // Asesor escribe a las 15:20
      await activateHumanHandoff({
        tenantId: tenantA.id,
        contactId: contactA.id,
        chatId: chatA.id,
        phone: phoneA,
        reason: 'HUMAN_INTERVENTION_LIVECHAT'
      });

      await prisma.customer.update({
        where: { id: customerA.id },
        data: {
          persistentProfile: {
            previousBuyer: true,
            score: 95,
            lastHumanInterventionAt: time1520.toISOString()
          }
        }
      });

      const cust = await prisma.customer.findUnique({ where: { id: customerA.id } });
      assert.strictEqual(cust.persistentProfile.lastHumanInterventionAt, time1520.toISOString(), 'Timestamp actualizado a 15:20');

      // A las 15:35 solo habrán pasado 15 min desde 15:20
      const time1535 = new Date('2026-08-31T15:35:00.000Z');
      const diff1535 = time1535.getTime() - new Date(cust.persistentProfile.lastHumanInterventionAt).getTime();
      assert.strictEqual(diff1535, 15 * 60 * 1000);
      assert.ok(diff1535 < HUMAN_HANDOFF_MS, 'Bot sigue pausado porque la nueva expiración es 15:50');
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST I: Webhook fromMe duplicado/eco -> NO cambia timestamp ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST I: fromMe con mensaje ya existente en BD no altera lastHumanInterventionAt', async () => {
      const time1520 = new Date('2026-08-31T15:20:00.000Z');
      const msgContent = `Respuesta humana ${stamp}`;
      const msgExtId = `livechat-msg-${stamp}`;

      // 1. Mensaje ya guardado por Live Chat a las 15:20:00
      await prisma.message.create({
        data: {
          content: msgContent,
          senderRole: 'agent',
          externalId: msgExtId,
          chatId: chatA.id,
          tenantId: tenantA.id,
          createdAt: time1520
        }
      });

      const custBefore = await prisma.customer.findUnique({ where: { id: customerA.id } });
      const tsBefore = custBefore.persistentProfile.lastHumanInterventionAt;

      // 2. A las 15:20:05 llega webhook fromMe de Evolution para el mismo mensaje
      const existingMessage = await prisma.message.findFirst({
        where: {
          chatId: chatA.id,
          senderRole: 'agent',
          OR: [{ externalId: msgExtId }, { content: msgContent }]
        }
      });

      assert.ok(existingMessage !== null, 'existingMessage detectado como duplicado/eco');

      // Al ser detectado como duplicado, no se vuelve a invocar activateHumanHandoff
      const custAfter = await prisma.customer.findUnique({ where: { id: customerA.id } });
      assert.strictEqual(custAfter.persistentProfile.lastHumanInterventionAt, tsBefore, 'Timestamp no se movió');
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST J: smb_message_echoes manual NUEVO -> SÍ actualiza timestamp ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST J: Mensaje nuevo desde WhatsApp Business App actualiza lastHumanInterventionAt', async () => {
      const newEchoText = `Respuesta directa desde celular ${stamp}`;

      // Comprobar que no existe en BD
      const existing = await prisma.message.findFirst({
        where: { chatId: chatA.id, content: newEchoText }
      });
      assert.strictEqual(existing, null, 'Mensaje no existía previamente');

      // Al ser una intervención humana nueva, se activa handoff
      await activateHumanHandoff({
        tenantId: tenantA.id,
        contactId: contactA.id,
        chatId: chatA.id,
        phone: phoneA,
        reason: 'HUMAN_INTERVENTION'
      });

      const cust = await prisma.customer.findUnique({ where: { id: customerA.id } });
      assert.ok(cust.persistentProfile.lastHumanInterventionAt !== null, 'lastHumanInterventionAt registrado');
      assert.strictEqual(cust.isBotPaused, true);
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST K: persistentProfile existente con otros datos -> Preservados ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST K: safe merge en persistentProfile no borra campos previos (score, buyer, etc)', async () => {
      // Guardar campos previos en persistentProfile
      await prisma.customer.update({
        where: { id: customerA.id },
        data: {
          persistentProfile: {
            customFieldA: 'valor_importante',
            loyaltyTier: 'GOLD',
            totalPurchases: 5
          }
        }
      });

      await activateHumanHandoff({
        tenantId: tenantA.id,
        contactId: contactA.id,
        chatId: chatA.id,
        phone: phoneA,
        reason: 'HUMAN_INTERVENTION'
      });

      const cust = await prisma.customer.findUnique({ where: { id: customerA.id } });
      assert.strictEqual(cust.persistentProfile.customFieldA, 'valor_importante', 'customFieldA preservado');
      assert.strictEqual(cust.persistentProfile.loyaltyTier, 'GOLD', 'loyaltyTier preservado');
      assert.strictEqual(cust.persistentProfile.totalPurchases, 5, 'totalPurchases preservado');
      assert.ok('lastHumanInterventionAt' in cust.persistentProfile, 'lastHumanInterventionAt añadido');
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST L: Contacto legacy pausado sin timestamp -> No queda bloqueado ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST L: Fallback de compatibilidad despausa registros legacy sin lastHumanInterventionAt', async () => {
      // Crear customer legacy pausado sin lastHumanInterventionAt
      const legacyPhone = `51966${stamp.toString().slice(-6)}`;
      const legacyCust = await prisma.customer.create({
        data: {
          tenantId: tenantA.id,
          phone: legacyPhone,
          name: 'Cliente Legacy',
          isBotPaused: true,
          persistentProfile: { legacyKey: 'old' }
        }
      });

      const legacyContact = await prisma.contact.create({
        data: {
          tenantId: tenantA.id,
          phone: legacyPhone,
          name: 'Cliente Legacy',
          botPaused: true,
          updatedAt: new Date(Date.now() - 35 * 60 * 1000) // 35 min atrás
        }
      });

      const legacyChat = await prisma.chat.create({
        data: {
          tenantId: tenantA.id,
          contactId: legacyContact.id,
          botPaused: true
        }
      });

      // Simular lógica de whatsappController
      const lastInterventionIso = legacyCust.persistentProfile?.lastHumanInterventionAt || null;
      let lastActivityDate = null;
      if (lastInterventionIso) {
        lastActivityDate = new Date(lastInterventionIso);
      } else {
        lastActivityDate = legacyContact.updatedAt || new Date(0);
      }

      const diffMs = Date.now() - new Date(lastActivityDate).getTime();
      assert.ok(diffMs >= HUMAN_HANDOFF_MS, 'Supera 30 min por fallback de compatibilidad');

      // Auto-reactivación
      await prisma.$transaction([
        prisma.chat.update({ where: { id: legacyChat.id }, data: { botPaused: false } }),
        prisma.contact.update({ where: { id: legacyContact.id }, data: { botPaused: false } }),
        prisma.customer.update({ where: { id: legacyCust.id }, data: { isBotPaused: false } })
      ]);

      const refreshed = await prisma.customer.findUnique({ where: { id: legacyCust.id } });
      assert.strictEqual(refreshed.isBotPaused, false, 'Cliente legacy reactivado sin quedarse bloqueado');
    });

  } finally {
    // Limpieza de datos de prueba
    try {
      await prisma.message.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
      await prisma.chat.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
      await prisma.contact.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
      await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
      await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    } catch {}
  }

  console.log('\n======================================================================');
  console.log(`📊 RESULTADO FINAL: ${passedTests}/${totalTests} TESTS COMPLETADOS CON ÉXITO`);
  console.log('======================================================================');
}

main().catch(err => {
  console.error('Fatal error running suite:', err);
  process.exit(1);
});
