import prisma from '../db.js';
import axios from 'axios';
import {
  sendText as gatewaySendText,
  sendMedia as gatewaySendMedia,
  resolveGatewayCtx
} from '../services/whatsappGateway.js';

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
      const cleanPhone = c.contact.phone.replace(/\D/g, '');
      const matchingCustomer = customers.find((cust) => {
        const custPhone = cust.phone.replace(/\D/g, '');
        return custPhone.endsWith(cleanPhone) || cleanPhone.endsWith(custPhone);
      });

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

      return {
        id: c.id,
        name: c.contact.name,
        phone: c.contact.phone,
        lastMsg: lastMessage ? lastMessage.content : 'Sin mensajes',
        time: lastMessage
          ? lastMessage.createdAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
          : '',
        unread: 0,
        isBotPaused: matchingCustomer ? matchingCustomer.isBotPaused : false,
        customerId: matchingCustomer ? matchingCustomer.id : null,
        provider,
        isWindowOpen,
        lastCustomerMsgAt: lastCustomerMsgAt ? lastCustomerMsgAt.toISOString() : null,
        windowExpiresAt,
        windowRemainingMinutes,
      };
    });

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
    try {
      msgId = await gatewaySendText({
        tenantId,
        to: cleanNumber,
        text,
      });
      console.log(`📤 [Live Chat] Mensaje enviado a WhatsApp +${remoteJid} vía Gateway (msgId: ${msgId})`);
    } catch (sendError) {
      console.error('❌ [Live Chat] Error al despachar mensaje vía Gateway:', sendError.response?.data || sendError.message);
    }

    // 1. Guardar mensaje enviado por el agente en base de datos
    const message = await prisma.message.create({
      data: {
        content: text,
        senderRole: 'agent',
        status: 'sent',
        externalId: msgId || null,
        chatId,
        tenantId,
      },
    });

    // Emitir por WebSocket en tiempo real para actualizar otros clientes conectados
    if (req.io || global.io) {
      const ioInstance = req.io || global.io;
      ioInstance.emit('new_whatsapp_message', {
        chatId,
        remoteJid,
        text,
        type: 'outgoing',
        status: 'sent',
        externalId: msgId || null,
        messageId: message.id,
        timestamp: new Date()
      });
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

    if (media && media.base64) {
      // Enviar multimedia a través del Gateway
      try {
        msgId = await gatewaySendMedia({
          tenantId,
          to: cleanNumber,
          url: media.base64,
          caption: text || undefined,
          mediaType: media.type === 'image' ? 'image' : 'document'
        });
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
        });
        console.log(`📤 [Live Chat Direct] Mensaje enviado vía Gateway a +${cleanNumber} (msgId: ${msgId})`);
      } catch (gatewayErr) {
        console.error('❌ [Live Chat Direct] Error enviando texto vía Gateway:', gatewayErr.message);
      }
    }

    const message = await prisma.message.create({
      data: {
        content: messageContent,
        senderRole: 'agent',
        status: 'sent',
        externalId: msgId || null,
        chatId: chat.id,
        tenantId,
      },
    });

    if (req.io || global.io) {
      const ioInstance = req.io || global.io;
      ioInstance.emit('new_whatsapp_message', {
        chatId: chat.id,
        remoteJid: number,
        text: messageContent,
        type: 'outgoing',
        mediaType: media ? media.type : undefined,
        status: 'sent',
        externalId: msgId || null,
        messageId: message.id,
        timestamp: new Date()
      });
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

    await prisma.customer.update({
      where: { id: customer.id },
      data: { isBotPaused: false }
    });

    console.log(`🤖 [Resume Bot] Reactivado chatbot para el cliente +${customer.phone}`);

    return res.status(200).json({ message: 'Bot reactivado exitosamente.' });
  } catch (error) {
    console.error('Error en resumeBot:', error);
    return res.status(500).json({ error: 'Error al reactivar el bot para el cliente.' });
  }
}
