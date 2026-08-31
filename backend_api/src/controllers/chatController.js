import prisma from '../db.js';
import axios from 'axios';
import {
  sendText as gatewaySendText,
  sendMedia as gatewaySendMedia,
  resolveGatewayCtx
} from '../services/whatsappGateway.js';
import { activateHumanHandoff } from '../services/humanHandoffService.js';

/**
 * Obtiene la lista de chats activos del tenant desde la base de datos real
 * e incluye el cálculo del estado de la ventana de 24h de Meta.
 */
export async function getChats(req, res) {
  try {
    const tenantId = req.user.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    // Obtener proveedor activo del Tenant
    const connection = await prisma.registeredWhatsAppNumber.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { provider: true }
    });
    const provider = connection?.provider || 'EVOLUTION';

    // Consultar todos los chats con sus contactos, último mensaje y último mensaje entrante del cliente
    const chats = await prisma.chat.findMany({
      where: { tenantId },
      include: {
        contact: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const customers = await prisma.customer.findMany({
      where: { tenantId }
    });

    // Consultar el último mensaje entrante de cada chat para el cálculo de la ventana de 24h
    const lastIncomingMessages = await prisma.message.findMany({
      where: {
        tenantId,
        senderRole: 'contact',
      },
      orderBy: { createdAt: 'desc' },
      distinct: ['chatId'],
      select: {
        chatId: true,
        createdAt: true,
      },
    });

    const incomingMap = new Map();
    lastIncomingMessages.forEach((m) => {
      incomingMap.set(m.chatId, m.createdAt);
    });

    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const formatted = chats.map((c) => {
      const lastMessage = c.messages[0];
      const cleanPhone = (c.contact?.phone || '').replace(/\D/g, '');
      const matchingCustomer = customers.find((cust) => {
        const custPhone = (cust.phone || '').replace(/\D/g, '');
        return custPhone.endsWith(cleanPhone) || cleanPhone.endsWith(custPhone);
      });

      // Fuente unificada de verdad para el estado de pausa del bot
      const isEffectivePaused = Boolean(c.botPaused || c.contact?.botPaused || matchingCustomer?.isBotPaused);

      // Cálculo de ventana de 24h para Meta
      const lastCustomerMsgAt = incomingMap.get(c.id) || null;
      let isWindowOpen = true;
      let windowExpiresAt = null;
      let windowRemainingMinutes = null;

      if (provider === 'META') {
        if (lastCustomerMsgAt) {
          const elapsed = now - new Date(lastCustomerMsgAt).getTime();
          isWindowOpen = elapsed < TWENTY_FOUR_HOURS_MS;
          windowExpiresAt = new Date(new Date(lastCustomerMsgAt).getTime() + TWENTY_FOUR_HOURS_MS).toISOString();
          windowRemainingMinutes = isWindowOpen ? Math.max(0, Math.round((TWENTY_FOUR_HOURS_MS - elapsed) / (1000 * 60))) : 0;
        } else {
          isWindowOpen = false;
        }
      }

      const lastMessageAt = lastMessage
        ? lastMessage.createdAt.toISOString()
        : c.updatedAt.toISOString();

      return {
        id: c.id,
        contactId: c.contactId,
        name: c.contact?.name || 'Cliente',
        phone: c.contact?.phone || '',
        lastMsg: lastMessage ? lastMessage.content : 'Sin mensajes',
        time: lastMessage
          ? lastMessage.createdAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
          : '',
        lastMessageAt,
        unread: 0,
        isBotPaused: isEffectivePaused,
        botPaused: isEffectivePaused,
        customerId: matchingCustomer ? matchingCustomer.id : null,
        provider,
        isWindowOpen,
        lastCustomerMsgAt: lastCustomerMsgAt ? lastCustomerMsgAt.toISOString() : null,
        windowExpiresAt,
        windowRemainingMinutes,
      };
    });

    // Ordenar de forma descendente por la fecha REAL del último mensaje
    formatted.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

    return res.json(formatted);
  } catch (error) {
    console.error('Error en getChats:', error);
    return res.status(500).json({ error: 'Error al obtener los chats.' });
  }
}


/**
 * Obtiene el historial de mensajes de un chat específico con status y externalId
 */
export async function getMessages(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { chatId } = req.params;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    const messages = await prisma.message.findMany({
      where: {
        chatId,
        tenantId,
      },
      orderBy: { createdAt: 'asc' },
    });

    const formatted = messages.map((m) => ({
      id: m.id,
      from: m.senderRole === 'contact' ? 'client' : 'business',
      text: m.content,
      status: m.status || 'sent',
      externalId: m.externalId || null,
      time: m.createdAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
    }));

    return res.json(formatted);
  } catch (error) {
    console.error('Error en getMessages:', error);
    return res.status(500).json({ error: 'Error al obtener el historial de mensajes.' });
  }
}

/**
 * Guarda el mensaje enviado y lo despacha a través del Gateway centralizado
 */
export async function sendMessage(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { chatId } = req.params;
    const { text } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    if (!text) {
      return res.status(400).json({ error: 'El contenido del mensaje es requerido.' });
    }

    // Verificar pertenencia del chat y obtener contacto
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, tenantId },
      include: { contact: true }
    });

    if (!chat) {
      return res.status(404).json({ error: 'Conversación no encontrada o no autorizada.' });
    }

    const remoteJid = chat.contact.phone;
    const cleanNumber = remoteJid.replace(/\D/g, '');

    // ─── CONTROL DE VENTANA DE 24 HORAS PARA META CLOUD API ───
    const connection = await prisma.registeredWhatsAppNumber.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { provider: true }
    });
    const provider = connection?.provider || 'EVOLUTION';

    if (provider === 'META') {
      const lastIncoming = await prisma.message.findFirst({
        where: { chatId: chat.id, senderRole: 'contact' },
        orderBy: { createdAt: 'desc' }
      });
      const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
      if (!lastIncoming || Date.now() - new Date(lastIncoming.createdAt).getTime() > TWENTY_FOUR_HOURS_MS) {
        return res.status(400).json({
          error: 'La ventana de atención de 24 horas de Meta está cerrada para este cliente. Meta prohíbe el envío de mensajes de texto libre fuera de esta ventana.',
          code: 'META_24H_WINDOW_EXPIRED'
        });
      }
    }

    // ─── GATEWAY: Enviar por el proveedor activo del Tenant ───
    let msgId = null;
    let gatewaySuccess = false;
    try {
      msgId = await gatewaySendText({
        tenantId,
        to: cleanNumber,
        text,
        isAutomated: false,
      });
      gatewaySuccess = true;
      console.log(`📤 [Live Chat] Mensaje enviado a WhatsApp +${remoteJid} vía Gateway (msgId: ${msgId})`);
    } catch (sendError) {
      console.error('❌ [Live Chat] Error al despachar mensaje vía Gateway:', sendError.response?.data || sendError.message);
    }

    // 1. Guardar mensaje enviado por el agente y actualizar Chat.updatedAt de forma atómica
    const now = new Date();
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          content: text,
          senderRole: 'agent',
          status: 'sent',
          externalId: msgId || null,
          chatId,
          tenantId,
        },
      }),
      prisma.chat.update({
        where: { id: chatId },
        data: { updatedAt: now }
      })
    ]);

    // 2. Activar Human Handoff ÚNICAMENTE si el Gateway confirmó éxito
    if (gatewaySuccess) {
      await activateHumanHandoff({
        tenantId,
        contactId: chat.contactId,
        chatId: chat.id,
        phone: cleanNumber || remoteJid,
        io: req.io || global.io,
        reason: 'HUMAN_INTERVENTION_LIVECHAT'
      });
    }

    // Emitir por WebSocket en tiempo real a la sala privada del tenant
    const ioInstance = req.io || global.io;
    if (ioInstance && tenantId) {
      const payload = {
        chatId,
        remoteJid,
        text,
        type: 'outgoing',
        from: 'business',
        senderRole: 'agent',
        status: 'sent',
        externalId: msgId || null,
        messageId: message.id,
        createdAt: message.createdAt.toISOString(),
        lastMessageAt: message.createdAt.toISOString(),
        timestamp: message.createdAt
      };
      ioInstance.to(`tenant:${tenantId}`).emit('new_whatsapp_message', payload);
    }


    return res.status(201).json({
      id: message.id,
      from: 'business',
      text: message.content,
      status: message.status,
      externalId: message.externalId,
      time: message.createdAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
    });
  } catch (error) {
    console.error('Error en sendMessage:', error);
    return res.status(500).json({ error: 'Error al procesar el envío del mensaje.' });
  }
}

/**
 * Enviar mensaje directo con texto o archivo multimedia adjunto
 */
export async function sendDirectMessage(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { chatId, text, remoteJid, media } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    if ((!text && !media) || !chatId) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos.' });
    }

    const chat = await prisma.chat.findFirst({
      where: { id: chatId, tenantId },
      include: { contact: true }
    });

    if (!chat) {
      return res.status(404).json({ error: 'Conversación no encontrada.' });
    }

    const number = remoteJid || chat.contact.phone;
    const cleanNumber = (number || '').replace(/\D/g, '');

    // ─── CONTROL DE VENTANA DE 24 HORAS PARA META CLOUD API ───
    const connection = await prisma.registeredWhatsAppNumber.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { provider: true }
    });
    const provider = connection?.provider || 'EVOLUTION';

    if (provider === 'META') {
      const lastIncoming = await prisma.message.findFirst({
        where: { chatId: chat.id, senderRole: 'contact' },
        orderBy: { createdAt: 'desc' }
      });
      const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
      if (!lastIncoming || Date.now() - new Date(lastIncoming.createdAt).getTime() > TWENTY_FOUR_HOURS_MS) {
        return res.status(400).json({
          error: 'La ventana de atención de 24 horas de Meta está cerrada para este cliente. Meta prohíbe el envío de mensajes de texto libre fuera de esta ventana.',
          code: 'META_24H_WINDOW_EXPIRED'
        });
      }
    }

    let messageContent = text;
    let msgId = null;
    let gatewaySuccess = false;

    if (media && media.base64) {
      // Enviar multimedia a través del Gateway
      try {
        msgId = await gatewaySendMedia({
          tenantId,
          to: cleanNumber,
          url: media.base64,
          caption: text || undefined,
          mediaType: media.type === 'image' ? 'image' : 'document',
          isAutomated: false
        });
        gatewaySuccess = true;
        console.log(`📤 [Live Chat Direct] Archivo multimedia enviado vía Gateway a +${cleanNumber} (msgId: ${msgId})`);
      } catch (gatewayErr) {
        console.error('❌ [Live Chat Direct] Error enviando media vía Gateway:', gatewayErr.message);
      }

      messageContent = media.type === 'image' ? media.base64 : `[Documento]: ${media.name}`;
    } else {
      // Enviar mensaje de texto a través del Gateway
      try {
        msgId = await gatewaySendText({
          tenantId,
          to: cleanNumber,
          text,
          isAutomated: false,
        });
        gatewaySuccess = true;
        console.log(`📤 [Live Chat Direct] Mensaje enviado vía Gateway a +${cleanNumber} (msgId: ${msgId})`);
      } catch (gatewayErr) {
        console.error('❌ [Live Chat Direct] Error enviando texto vía Gateway:', gatewayErr.message);
      }
    }

    const now = new Date();
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          content: messageContent,
          senderRole: 'agent',
          status: 'sent',
          externalId: msgId || null,
          chatId: chat.id,
          tenantId,
        },
      }),
      prisma.chat.update({
        where: { id: chat.id },
        data: { updatedAt: now }
      })
    ]);

    // Activar Human Handoff ÚNICAMENTE si el Gateway confirmó éxito
    if (gatewaySuccess) {
      await activateHumanHandoff({
        tenantId,
        contactId: chat.contactId,
        chatId: chat.id,
        phone: cleanNumber || number,
        io: req.io || global.io,
        reason: 'HUMAN_INTERVENTION_LIVECHAT'
      });
    }

    const ioInstance = req.io || global.io;
    if (ioInstance && tenantId) {
      const payload = {
        chatId: chat.id,
        remoteJid: number,
        text: messageContent,
        type: 'outgoing',
        from: 'business',
        senderRole: 'agent',
        mediaType: media ? media.type : undefined,
        status: 'sent',
        externalId: msgId || null,
        messageId: message.id,
        createdAt: message.createdAt.toISOString(),
        lastMessageAt: message.createdAt.toISOString(),
        timestamp: message.createdAt
      };
      ioInstance.to(`tenant:${tenantId}`).emit('new_whatsapp_message', payload);
    }


    return res.status(201).json({
      id: message.id,
      from: 'business',
      text: message.content,
      status: message.status,
      externalId: message.externalId,
      time: message.createdAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
    });
  } catch (error) {
    console.error('Error en sendDirectMessage:', error);
    return res.status(500).json({ error: 'Error al enviar el mensaje.' });
  }
}

/**
 * Reactiva el bot de chat para un cliente específico (isBotPaused: false)
 * Limpia de forma atómica y consistente el estado de pausa en Customer, Contact y Chat.
 */
export async function resumeBot(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { customerId } = req.params;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        tenantId
      }
    });

    if (!customer) {
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }

    const cleanPhone = (customer.phone || '').replace(/\D/g, '');

    await prisma.$transaction(async (tx) => {
      // 1. Despausar Customer por ID
      await tx.customer.update({
        where: { id: customer.id },
        data: { isBotPaused: false }
      });

      // Si existen otros registros de Customer para el mismo tenant con variaciones del teléfono
      if (cleanPhone) {
        await tx.customer.updateMany({
          where: {
            tenantId,
            phone: { contains: cleanPhone }
          },
          data: { isBotPaused: false }
        });
      }

      // 2. Buscar contactos asociados por teléfono exacto o limpio
      const contacts = await tx.contact.findMany({
        where: {
          tenantId,
          OR: [
            { phone: customer.phone },
            ...(cleanPhone ? [{ phone: { contains: cleanPhone } }] : [])
          ]
        },
        select: { id: true, phone: true }
      });

      if (contacts.length > 0) {
        const contactIds = contacts.map(c => c.id);

        // Despausar Contactos
        await tx.contact.updateMany({
          where: { id: { in: contactIds } },
          data: { botPaused: false }
        });

        // 3. Despausar Chats asociados usando contactId (relación real existente)
        await tx.chat.updateMany({
          where: {
            tenantId,
            contactId: { in: contactIds }
          },
          data: { botPaused: false }
        });
      }
    });

    // Emitir eventos en tiempo real para actualizar la interfaz del dashboard solo al tenant propietario
    if ((req.io || global.io) && tenantId) {
      const ioInstance = req.io || global.io;
      if (typeof ioInstance.to === 'function') {
        ioInstance.to(`tenant:${tenantId}`).emit('bot_status_changed', { phone: customer.phone, botPaused: false, isBotPaused: false });
        ioInstance.to(`tenant:${tenantId}`).emit('contact_updated', { phone: customer.phone, botPaused: false, reason: 'MANUAL_RESUME' });
      } else {
        ioInstance.emit('bot_status_changed', { phone: customer.phone, botPaused: false, isBotPaused: false });
        ioInstance.emit('contact_updated', { phone: customer.phone, botPaused: false, reason: 'MANUAL_RESUME' });
      }
    }

    console.log(`✅ [Resume Bot] Bot reactivado exitosamente en base de datos para +${customer.phone}`);

    return res.status(200).json({ success: true, message: 'Bot reactivado exitosamente.', isBotPaused: false });
  } catch (error) {
    console.error('Error en resumeBot:', error);
    return res.status(500).json({ error: 'Error al reactivar el bot para el cliente: ' + error.message });
  }
}

