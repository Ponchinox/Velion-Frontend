import prisma from '../db.js';
import axios from 'axios';

/**
 * Obtiene la lista de chats activos del tenant desde la base de datos real
 */
export async function getChats(req, res) {
  try {
    const tenantId = req.user.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    // Inicializar datos de prueba si es un tenant nuevo sin contactos
    const contactsCount = await prisma.contact.count({ where: { tenantId } });
    if (contactsCount === 0) {
      // 1. Crear contacto demo
      const testContact = await prisma.contact.create({
        data: {
          name: 'Juan Pérez (Demo)',
          phone: '+51 987 654 321',
          category: 'Nuevos Leads',
          tenantId,
        },
      });

      // 2. Crear conversación
      const testChat = await prisma.chat.create({
        data: {
          contactId: testContact.id,
          tenantId,
        },
      });

      // 3. Inyectar mensajes iniciales
      await prisma.message.createMany({
        data: [
          { content: 'Hola, buenas tardes.', senderRole: 'contact', chatId: testChat.id, tenantId },
          { content: '¡Hola! ¿Cómo estás? Te saluda el equipo de soporte.', senderRole: 'agent', chatId: testChat.id, tenantId },
          { content: 'Hola, me gustaría saber los precios de los planes.', senderRole: 'contact', chatId: testChat.id, tenantId },
        ],
      });
    }

    // Consultar todos los chats con sus contactos y el último mensaje
    const chats = await prisma.chat.findMany({
      where: { tenantId },
      include: {
        contact: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const customers = await prisma.customer.findMany({
      where: { tenantId }
    });

    const formatted = chats.map(c => {
      const lastMessage = c.messages[0];
      const cleanPhone = c.contact.phone.replace(/\D/g, '');
      const matchingCustomer = customers.find(cust => {
        const custPhone = cust.phone.replace(/\D/g, '');
        return custPhone.endsWith(cleanPhone) || cleanPhone.endsWith(custPhone);
      });

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
      };
    });

    return res.json(formatted);
  } catch (error) {
    console.error('Error en getChats:', error);
    return res.status(500).json({ error: 'Error al obtener los chats.' });
  }
}

/**
 * Obtiene el historial de mensajes de un chat específico
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

    const formatted = messages.map(m => ({
      id: m.id,
      from: m.senderRole === 'contact' ? 'client' : 'business',
      text: m.content,
      time: m.createdAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
    }));

    return res.json(formatted);
  } catch (error) {
    console.error('Error en getMessages:', error);
    return res.status(500).json({ error: 'Error al obtener el historial de mensajes.' });
  }
}

/**
 * Guarda el mensaje enviado y simula el ping-pong interactivo
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

    // Verificar pertenencia del chat y obtener contacto para el número de teléfono
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, tenantId },
      include: { contact: true }
    });

    if (!chat) {
      return res.status(404).json({ error: 'Conversación no encontrada o no autorizada.' });
    }

    // Enviar mensaje real a Evolution API
    const remoteJid = chat.contact.phone;
    const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
    const evoKey = process.env.EVOLUTION_API_KEY || 'bot_clave_maestra_2026';
    const instance = 'velion_instance_' + tenantId.slice(0, 8);

    try {
      await axios.post(
        `${evoUrl}/message/sendText/${instance}`,
        {
          number: remoteJid,
          text: text,
        },
        {
          headers: {
            apikey: evoKey,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log(`📤 [Live Chat] Mensaje enviado exitosamente a WhatsApp +${remoteJid}`);
    } catch (evoError) {
      console.error('❌ [Live Chat] Error al despachar mensaje a Evolution API:', evoError.response?.data || evoError.message);
    }

    // 1. Guardar mensaje enviado por el agente en base de datos
    const message = await prisma.message.create({
      data: {
        content: text,
        senderRole: 'agent',
        chatId,
        tenantId,
      },
    });

    // Emitir por WebSocket en tiempo real para actualizar otros clientes conectados
    if (req.io) {
      req.io.emit('new_whatsapp_message', {
        chatId,
        remoteJid,
        text,
        type: 'outgoing',
        timestamp: new Date()
      });
    }

    return res.status(201).json({
      id: message.id,
      from: 'business',
      text: message.content,
      time: message.createdAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
    });
  } catch (error) {
    console.error('Error en sendMessage:', error);
    return res.status(500).json({ error: 'Error al procesar el envío del mensaje.' });
  }
}

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
    const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
    const evoKey = process.env.EVOLUTION_API_KEY || 'bot_clave_maestra_2026';
    const instance = 'velion_instance_' + tenantId.slice(0, 8);

    let messageContent = text;

    if (media && media.base64) {
      // 1. Enviar multimedia a Evolution API
      try {
        await axios.post(
          `${evoUrl}/message/sendMedia/${instance}`,
          {
            number: number,
            mediatype: media.type === 'image' ? 'image' : 'document',
            media: media.base64,
            fileName: media.name,
            caption: text || undefined
          },
          {
            headers: {
              apikey: evoKey,
              'Content-Type': 'application/json'
            }
          }
        );
        console.log(`📤 [Live Chat Direct] Archivo multimedia enviado exitosamente a WhatsApp +${number}`);
      } catch (evoError) {
        console.error('❌ [Live Chat Direct] Error al despachar multimedia a Evolution API:', evoError.response?.data || evoError.message);
      }

      messageContent = media.type === 'image' ? media.base64 : `[Documento]: ${media.name}`;
    } else {
      // 2. Enviar mensaje de texto normal a Evolution API
      try {
        await axios.post(
          `${evoUrl}/message/sendText/${instance}`,
          {
            number: number,
            text: text,
          },
          {
            headers: {
              apikey: evoKey,
              'Content-Type': 'application/json'
            }
          }
        );
        console.log(`📤 [Live Chat Direct] Mensaje enviado exitosamente a WhatsApp +${number}`);
      } catch (evoError) {
        console.error('❌ [Live Chat Direct] Error al despachar mensaje a Evolution API:', evoError.response?.data || evoError.message);
      }
    }

    const message = await prisma.message.create({
      data: {
        content: messageContent,
        senderRole: 'agent',
        chatId: chat.id,
        tenantId,
      },
    });

    if (req.io) {
      req.io.emit('new_whatsapp_message', {
        chatId: chat.id,
        remoteJid: number,
        text: messageContent,
        type: 'outgoing',
        mediaType: media ? media.type : undefined,
        timestamp: new Date()
      });
    }

    return res.status(201).json({
      id: message.id,
      from: 'business',
      text: message.content,
      time: message.createdAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
    });
  } catch (error) {
    console.error('Error en sendDirectMessage:', error);
    return res.status(500).json({ error: 'Error al enviar el mensaje por Evolution API.' });
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
