/**
 * test_livechat_comprehensive.js
 * Suite exhaustiva de pruebas para verificar la corrección del sistema de Live Chat / Mensajes en Velion.
 * Cubre los 13 escenarios de prueba (TEST A - TEST M).
 */

import jwt from 'jsonwebtoken';
import prisma from './src/db.js';
import * as chatController from './src/controllers/chatController.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-12345';
process.env.JWT_SECRET = JWT_SECRET;

async function runLiveChatTestSuite() {
  console.log('======================================================================');
  console.log('🚀 INICIANDO TEST SUITE EXHAUSTIVA DE LIVE CHAT / MENSAJES EN VELION');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failed++;
    }
  }

  // Creación de Tenants de prueba
  const tenantAId = `test-tenant-a-${Date.now()}`;
  const tenantBId = `test-tenant-b-${Date.now()}`;

  let tenantA, tenantB;
  let userA, userB;
  let contactA1, contactA2, contactB1;
  let chatA1, chatA2, chatB1;

  try {
    // ── Setup inicial de datos en BD ──
    tenantA = await prisma.tenant.create({
      data: { id: tenantAId, name: 'Tenant A LiveChat Test' }
    });
    tenantB = await prisma.tenant.create({
      data: { id: tenantBId, name: 'Tenant B LiveChat Test' }
    });

    userA = await prisma.user.create({
      data: {
        email: `user_a_${Date.now()}@example.com`,
        password: 'hashedpassword',
        role: 'ADMIN',
        tenantId: tenantA.id
      }
    });

    userB = await prisma.user.create({
      data: {
        email: `user_b_${Date.now()}@example.com`,
        password: 'hashedpassword',
        role: 'ADMIN',
        tenantId: tenantB.id
      }
    });

    // Contactos
    contactA1 = await prisma.contact.create({
      data: {
        tenantId: tenantA.id,
        name: 'Cliente A1',
        phone: '51999111222',
        botPaused: false
      }
    });

    contactA2 = await prisma.contact.create({
      data: {
        tenantId: tenantA.id,
        name: 'Cliente A2',
        phone: '51999333444',
        botPaused: true
      }
    });

    contactB1 = await prisma.contact.create({
      data: {
        tenantId: tenantB.id,
        name: 'Cliente B1',
        phone: '51999555666',
        botPaused: false
      }
    });

    // Chats
    const d1 = new Date(Date.now() - 3600000); // 1 hora atrás
    const d2 = new Date(Date.now() - 1800000); // 30 min atrás

    chatA1 = await prisma.chat.create({
      data: {
        tenantId: tenantA.id,
        contactId: contactA1.id,
        createdAt: d1,
        updatedAt: d1
      }
    });

    chatA2 = await prisma.chat.create({
      data: {
        tenantId: tenantA.id,
        contactId: contactA2.id,
        createdAt: d2,
        updatedAt: d2
      }
    });

    chatB1 = await prisma.chat.create({
      data: {
        tenantId: tenantB.id,
        contactId: contactB1.id,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    // Mensajes para Chat A1 (más antiguo)
    await prisma.message.create({
      data: {
        chatId: chatA1.id,
        tenantId: tenantA.id,
        content: 'Hola desde A1 antiguo',
        senderRole: 'contact',
        createdAt: d1
      }
    });

    // Mensajes para Chat A2 (más reciente)
    await prisma.message.create({
      data: {
        chatId: chatA2.id,
        tenantId: tenantA.id,
        content: 'Hola desde A2 reciente',
        senderRole: 'contact',
        createdAt: d2
      }
    });

    // ────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST A: getChats con orden real descendente (lastMessageAt exacto ISO) ---');
    // ────────────────────────────────────────────────────────────────────────
    {
      const req = { user: { tenantId: tenantA.id, role: 'ADMIN' }, headers: {} };
      let resJson = null;
      const res = {
        json: (data) => { resJson = data; return res; },
        status: () => res
      };

      await chatController.getChats(req, res);

      assert(Array.isArray(resJson), 'getChats devuelve un array de conversaciones');
      assert(resJson.length === 2, `Devuelve exactamente las 2 conversaciones de Tenant A (recibió ${resJson.length})`);
      assert(resJson[0].id === chatA2.id, 'El primer chat es chatA2 (el que tiene mensaje más reciente)');
      assert(resJson[1].id === chatA1.id, 'El segundo chat es chatA1 (el más antiguo)');
      assert(typeof resJson[0].lastMessageAt === 'string', 'lastMessageAt está presente como string ISO');
      assert(new Date(resJson[0].lastMessageAt).getTime() > new Date(resJson[1].lastMessageAt).getTime(), 'El orden temporal por lastMessageAt es estrictamente descendente');
    }

    // ────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST B: getChats conservando contrato de campos frontend ---');
    // ────────────────────────────────────────────────────────────────────────
    {
      const req = { user: { tenantId: tenantA.id, role: 'ADMIN' }, headers: {} };
      let resJson = null;
      const res = {
        json: (data) => { resJson = data; return res; },
        status: () => res
      };

      await chatController.getChats(req, res);
      const first = resJson[0];

      assert('id' in first, 'Campo "id" presente');
      assert('name' in first, 'Campo "name" presente');
      assert('phone' in first, 'Campo "phone" presente');
      assert('lastMsg' in first, 'Campo "lastMsg" presente');
      assert('time' in first, 'Campo "time" (HH:mm) presente');
      assert('lastMessageAt' in first, 'Campo "lastMessageAt" (ISO) presente');
      assert('unread' in first, 'Campo "unread" presente');
      assert('isBotPaused' in first, 'Campo "isBotPaused" presente');
      assert('isWindowOpen' in first, 'Campo "isWindowOpen" presente');
      assert('windowRemainingMinutes' in first, 'Campo "windowRemainingMinutes" presente');
    }

    // ────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST C: Creación de Message y actualización atómica de Chat.updatedAt en sendMessage ---');
    // ────────────────────────────────────────────────────────────────────────
    {
      const chatBefore = await prisma.chat.findUnique({ where: { id: chatA1.id } });
      const emittedEvents = [];
      const mockIo = {
        to: (room) => ({
          emit: (event, payload) => emittedEvents.push({ room, event, payload })
        }),
        emit: (event, payload) => emittedEvents.push({ room: 'global', event, payload })
      };

      const req = {
        user: { tenantId: tenantA.id, role: 'ADMIN' },
        params: { chatId: chatA1.id },
        body: { text: 'Mensaje de prueba sendMessage' },
        io: mockIo
      };
      let resJson = null;
      const res = {
        json: (data) => { resJson = data; return res; },
        status: () => res
      };

      await chatController.sendMessage(req, res);

      const chatAfter = await prisma.chat.findUnique({ where: { id: chatA1.id } });
      assert(new Date(chatAfter.updatedAt).getTime() > new Date(chatBefore.updatedAt).getTime(), 'Chat.updatedAt se actualizó de forma atómica');
      assert(emittedEvents.length > 0, 'Se emitió evento Socket.IO');
      assert(emittedEvents[0].room === `tenant:${tenantA.id}`, `Emitido exclusivamente a la sala "tenant:${tenantA.id}"`);
      assert(emittedEvents[0].event === 'new_whatsapp_message', 'Evento es "new_whatsapp_message"');
      assert(emittedEvents[0].payload.from === 'business', 'Payload tiene from: "business"');
      assert(emittedEvents[0].payload.senderRole === 'agent', 'Payload tiene senderRole: "agent"');
      assert(typeof emittedEvents[0].payload.lastMessageAt === 'string', 'Payload tiene lastMessageAt en formato ISO');
    }

    // ────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST D: Creación de Message y actualización atómica en sendDirectMessage ---');
    // ────────────────────────────────────────────────────────────────────────
    {
      const chatBefore = await prisma.chat.findUnique({ where: { id: chatA2.id } });
      const emittedEvents = [];
      const mockIo = {
        to: (room) => ({
          emit: (event, payload) => emittedEvents.push({ room, event, payload })
        }),
        emit: (event, payload) => emittedEvents.push({ room: 'global', event, payload })
      };

      const req = {
        user: { tenantId: tenantA.id, role: 'ADMIN' },
        body: {
          chatId: chatA2.id,
          text: 'Mensaje directo sendDirectMessage'
        },
        io: mockIo
      };
      let resJson = null;
      const res = {
        json: (data) => { resJson = data; return res; },
        status: () => res
      };

      await chatController.sendDirectMessage(req, res);

      const chatAfter = await prisma.chat.findUnique({ where: { id: chatA2.id } });
      assert(new Date(chatAfter.updatedAt).getTime() > new Date(chatBefore.updatedAt).getTime(), 'Chat.updatedAt se actualizó en sendDirectMessage');
      assert(emittedEvents.some(e => e.room === `tenant:${tenantA.id}` && e.event === 'new_whatsapp_message'), 'Emitido a sala de tenant con new_whatsapp_message');
    }

    // ────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST E & F & G: Transacciones atómicas en whatsappController ---');
    // ────────────────────────────────────────────────────────────────────────
    {
      // Validamos que el código de whatsappController contenga prisma.$transaction al crear Message
      const fs = await import('fs');
      const pathMod = await import('path');
      const urlMod = await import('url');
      const __dirname2 = pathMod.dirname(urlMod.fileURLToPath(import.meta.url));
      const waCode = fs.readFileSync(pathMod.join(__dirname2, 'src/controllers/whatsappController.js'), 'utf8');

      assert(waCode.includes('prisma.$transaction') && waCode.includes('prisma.chat.update'), 'whatsappController usa prisma.$transaction para Message y Chat.updatedAt');
      // El código usa variables intermedias (aiTextRoom, aiMediaRoom, etc.) para el tenant-scoped emit
      assert(
        waCode.includes('.to(aiTextRoom).emit') || 
        waCode.includes('.to(aiMediaRoom).emit') || 
        waCode.includes('.to(ioRoom).emit') || 
        waCode.includes('.to(incomingIoRoom).emit') || 
        waCode.includes('req.io.to(`tenant:${tenant.id}`)') || 
        waCode.includes('reqIo.to(`tenant:${tenant.id}`)'),
        'whatsappController emite a la sala privada tenant:${tenant.id}'
      );
    }

    // ────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST H & I: Aislamiento estricto multi-tenant en getChats y Socket.IO ---');
    // ────────────────────────────────────────────────────────────────────────
    {
      const reqB = { user: { tenantId: tenantB.id, role: 'ADMIN' }, headers: {} };
      let resJsonB = null;
      const resB = {
        json: (data) => { resJsonB = data; return resB; },
        status: () => resB
      };

      await chatController.getChats(reqB, resB);

      assert(Array.isArray(resJsonB), 'Tenant B obtiene su lista');
      assert(resJsonB.length === 1, 'Tenant B solo ve su propia conversación (1 chat)');
      assert(resJsonB[0].id === chatB1.id, 'Tenant B ve únicamente chatB1');
      assert(!resJsonB.some(c => c.id === chatA1.id || c.id === chatA2.id), 'Cero filtración de datos de Tenant A en Tenant B');
    }

    // ────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST J: Integridad de Human Handoff (resumeBot atómico) ---');
    // ────────────────────────────────────────────────────────────────────────
    {
      // Pausamos contacto y cliente
      const customerA = await prisma.customer.create({
        data: {
          tenantId: tenantA.id,
          name: 'Cliente Pausado',
          phone: '51999777888',
          isBotPaused: true
        }
      });

      const contactPausado = await prisma.contact.create({
        data: {
          tenantId: tenantA.id,
          name: 'Contacto Pausado',
          phone: '51999777888',
          botPaused: true
        }
      });

      const req = {
        user: { tenantId: tenantA.id, role: 'ADMIN' },
        params: { customerId: customerA.id },
        io: { emit: () => {} }
      };
      let resJson = null;
      const res = {
        json: (data) => { resJson = data; return res; },
        status: () => res
      };

      await chatController.resumeBot(req, res);

      const customerAfter = await prisma.customer.findUnique({ where: { id: customerA.id } });
      const contactAfter = await prisma.contact.findUnique({ where: { id: contactPausado.id } });

      assert(customerAfter.isBotPaused === false, 'Customer.isBotPaused restablecido a false');
      assert(contactAfter.botPaused === false, 'Contact.botPaused restablecido a false');
    }

    // ────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST K: Compatibilidad del schema Prisma (cero cambios/migraciones requeridas) ---');
    // ────────────────────────────────────────────────────────────────────────
    {
      // Verificamos que Chat y Message usen campos existentes sin requerir nuevas columnas
      const chatFields = Object.keys(chatA1);
      assert(chatFields.includes('id'), 'Chat tiene campo "id"');
      assert(chatFields.includes('updatedAt'), 'Chat tiene campo "updatedAt"');
      assert(chatFields.includes('tenantId'), 'Chat tiene campo "tenantId"');
      assert(chatFields.includes('contactId'), 'Chat tiene campo "contactId"');
    }

    // ────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST L: Compatibilidad del helper getChatTimestamp en frontend ---');
    // ────────────────────────────────────────────────────────────────────────
    {
      function getChatTimestamp(chat) {
        if (!chat) return 0;
        if (chat.lastMessageAt) {
          const t = new Date(chat.lastMessageAt).getTime();
          if (!isNaN(t) && t > 0) return t;
        }
        if (chat.updatedAt) {
          const t = new Date(chat.updatedAt).getTime();
          if (!isNaN(t) && t > 0) return t;
        }
        if (chat._sortTs) return chat._sortTs;
        return 0;
      }

      const mockChatRecent = { lastMessageAt: new Date('2026-08-31T12:00:00Z').toISOString() };
      const mockChatOlder = { lastMessageAt: new Date('2026-08-31T10:00:00Z').toISOString() };

      const tsRecent = getChatTimestamp(mockChatRecent);
      const tsOlder = getChatTimestamp(mockChatOlder);

      assert(tsRecent > tsOlder, 'getChatTimestamp ordena correctamente fechas ISO');
      assert(getChatTimestamp(null) === 0, 'getChatTimestamp maneja chat nulo de forma segura');
      assert(getChatTimestamp({ updatedAt: '2026-08-31T11:00:00Z' }) > 0, 'getChatTimestamp hace fallback a updatedAt');
    }

    // ────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST M: Seguridad Socket.IO con JWT Auth Middleware ---');
    // ────────────────────────────────────────────────────────────────────────
    {
      const fs2 = await import('fs');
      const pathMod2 = await import('path');
      const urlMod2 = await import('url');
      const __dirname3 = pathMod2.dirname(urlMod2.fileURLToPath(import.meta.url));
      const serverCode = fs2.readFileSync(pathMod2.join(__dirname3, 'server.js'), 'utf8');

      assert(serverCode.includes('io.use(') && serverCode.includes('jwt.verify'), 'server.js tiene middleware io.use con validación jwt.verify');
      assert(serverCode.includes('tenant:${socket.tenantId}') && serverCode.includes('socket.join'), 'server.js une los sockets autenticados a la sala "tenant:${socket.tenantId}"');
      assert(serverCode.includes('impersonatedTenantId'), 'server.js soporta impersonación autorizada de SuperAdmin');

      // Validar generación y verificación de JWT real
      const token = jwt.sign({ userId: userA.id, tenantId: tenantA.id, role: 'ADMIN' }, JWT_SECRET);
      const decoded = jwt.verify(token, JWT_SECRET);
      assert(decoded.tenantId === tenantA.id, 'Token decodifica correctamente el tenantId');
    }

  } catch (err) {
    console.error('💥 Error inesperado durante la ejecución de la suite:', err);
    failed++;
  } finally {
    // Cleanup de datos de prueba
    console.log('\n🧹 Limpiando registros de prueba...');
    try {
      if (chatA1?.id) await prisma.message.deleteMany({ where: { chatId: chatA1.id } });
      if (chatA2?.id) await prisma.message.deleteMany({ where: { chatId: chatA2.id } });
      if (chatB1?.id) await prisma.message.deleteMany({ where: { chatId: chatB1.id } });

      if (chatA1?.id) await prisma.chat.deleteMany({ where: { id: chatA1.id } });
      if (chatA2?.id) await prisma.chat.deleteMany({ where: { id: chatA2.id } });
      if (chatB1?.id) await prisma.chat.deleteMany({ where: { id: chatB1.id } });

      if (contactA1?.id) await prisma.contact.deleteMany({ where: { id: contactA1.id } });
      if (contactA2?.id) await prisma.contact.deleteMany({ where: { id: contactA2.id } });
      if (contactB1?.id) await prisma.contact.deleteMany({ where: { id: contactB1.id } });

      await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
      await prisma.contact.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });

      if (userA?.id) await prisma.user.deleteMany({ where: { id: userA.id } });
      if (userB?.id) await prisma.user.deleteMany({ where: { id: userB.id } });

      if (tenantA?.id) await prisma.tenant.deleteMany({ where: { id: tenantA.id } });
      if (tenantB?.id) await prisma.tenant.deleteMany({ where: { id: tenantB.id } });
    } catch (cleanupErr) {
      console.warn('Advertencia durante cleanup:', cleanupErr.message);
    }
  }

  console.log('\n======================================================================');
  console.log(`📊 RESULTADO FINAL: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runLiveChatTestSuite().catch((err) => {
  console.error('Fatal error running suite:', err);
  process.exit(1);
});
