import axios from 'axios';
import prisma from '../db.js';
import { generateAIResponse, transcribeAudio, extractFrameFromVideo } from '../services/aiService.js';
import * as flowService from '../services/flowService.js';

/**
 * Helper para generar los headers de autenticación del Evolution API
 */
function getEvoHeaders() {
  return {
    headers: {
      apikey: process.env.EVOLUTION_API_KEY || 'tu_global_api_key_aqui',
      'Content-Type': 'application/json',
    },
  };
}

/**
 * Helper para formatear el nombre de la instancia en base al tenantId
 */
function getEvoInstanceName(tenantId) {
  return `velion_instance_${tenantId.slice(0, 8)}`;
}

/**
 * Helper para verificar si un objeto, array o string de error contiene ciertas palabras clave
 */
function containsKeywords(errorObj, keywords) {
  if (!errorObj) return false;
  const messageStr = typeof errorObj === 'string'
    ? errorObj
    : JSON.stringify(errorObj);
  
  const lowerMessageStr = messageStr.toLowerCase();
  return keywords.some(keyword => lowerMessageStr.includes(keyword.toLowerCase()));
}

// Escudo Anti-Spam: Cache en memoria para rate limiting por número
const spamCache = new Map();

/**
 * Obtiene el estado real de la conexión de la instancia desde Evolution API
 */
export async function getStatus(req, res) {
  const tenantId = req.user.tenantId;
  if (!tenantId) {
    return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
  }

  const instanceName = getEvoInstanceName(tenantId);
  const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';

  try {
    const response = await axios.get(
      `${evoUrl}/instance/connectionState/${instanceName}`,
      getEvoHeaders()
    );

    const state = response.data?.instance?.state || 'close';

    // Mapeo al formato de estados de la UI del Frontend
    let status = 'DISCONNECTED';
    if (state === 'open') status = 'CONNECTED';
    if (state === 'connecting') status = 'CONNECTING';

    return res.json({
      status,
      instanceName,
      phone: response.data?.instance?.phone || null,
    });
  } catch (error) {
    // Si la instancia no existe en Evolution (error 404), la tratamos como desconectada
    if (error.response && error.response.status === 404) {
      return res.json({
        status: 'DISCONNECTED',
        instanceName,
        phone: null,
      });
    }

    console.error("DETALLE DEL ERROR DE EVOLUTION:", error.response?.data || error.message);
    return res.json({
      status: 'DISCONNECTED',
      instanceName,
      error: 'Evolution API no responde.',
    });
  }
}

/**
 * Solicita o genera el código QR interactivo de conexión desde la Evolution API
 */
export async function connectDevice(req, res) {
  const tenantId = req.user.tenantId;
  if (!tenantId) {
    return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
  }

  const instanceName = getEvoInstanceName(tenantId);
  const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';

  // 1. Asegurar la creación previa de la instancia
  try {
    await axios.post(
      `${evoUrl}/instance/create`,
      {
        instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      },
      getEvoHeaders()
    );
  } catch (createError) {
    const errorMsg = createError.response?.data || createError.message || '';
    const isAlreadyInUse = createError.response?.status === 403 || 
                           createError.response?.status === 400 || 
                           containsKeywords(errorMsg, ['already in use', 'already exists', 'in use', 'exists', 'registrada']);

    if (isAlreadyInUse) {
      console.log(`⚠️ Instancia "${instanceName}" ya registrada o en uso en Evolution API. Continuando flujo.`);
    } else {
      console.error('❌ Error al crear la instancia en Evolution API:', createError.response?.data || createError.message);
    }
  }

  // 1.5. Configurar el webhook en Evolution API para que los mensajes lleguen al backend
  try {
    const webhookUrl = process.env.WEBHOOK_URL || 'http://host.docker.internal:3000/api/whatsapp/webhook';
    console.log(`🔌 [Evolution API] Configurando webhook en: ${webhookUrl} para la instancia: ${instanceName}`);
    await axios.post(
      `${evoUrl}/webhook/set/${instanceName}`,
      {
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          events: [
            "MESSAGES_UPSERT"
          ]
        }
      },
      getEvoHeaders()
    );
    console.log('✅ [Evolution API] Webhook configurado con éxito.');
  } catch (webhookError) {
    console.error('🚨 Detalle Webhook:', JSON.stringify(webhookError?.response?.data || webhookError.message, null, 2));
  }

  // 2. Solicitar el código QR de conexión de forma segura
  try {
    const connectRes = await axios.get(
      `${evoUrl}/instance/connect/${instanceName}`,
      getEvoHeaders()
    );

    // Registrar logs de respuesta de Evolution API para diagnóstico
    console.log('📡 [Evolution API] Respuesta de /connect:', JSON.stringify(connectRes.data, null, 2));

    const qrBase64 = connectRes.data?.base64 || connectRes.data?.qrcode?.base64 || null;

    if (!qrBase64) {
      // Intentar ver si en la respuesta del servidor venía que ya estaba conectada
      const lowerDataStr = JSON.stringify(connectRes.data || {}).toLowerCase();
      const isAlreadyConnected = lowerDataStr.includes('already connected') || 
                                 lowerDataStr.includes('connected') || 
                                 lowerDataStr.includes('open');

      if (isAlreadyConnected) {
        console.log(`✅ [Evolution API] Instancia "${instanceName}" ya se encuentra conectada (detectado en 200 OK).`);
        return res.status(200).json({
          success: true,
          status: 'CONNECTED',
          message: 'La instancia ya está conectada y activa.',
        });
      }

      console.error('❌ [Evolution API] No se encontró código QR base64 en la respuesta:', JSON.stringify(connectRes.data, null, 2));
      return res.status(400).json({ error: 'No se pudo generar el código QR de vinculación.' });
    }

    return res.json({
      success: true,
      qr: qrBase64,
      qrCode: qrBase64, // Alias de seguridad
      message: 'Código QR obtenido con éxito.',
    });
  } catch (error) {
    console.error('💥 ERROR FATAL AL OBTENER QR:', JSON.stringify(error?.response?.data || error.message, null, 2));

    // Si la instancia ya está conectada (open), Evolution API devuelve un error 400.
    // Devolvemos exitosamente status: 'CONNECTED' para que el frontend cierre el modal de QR
    const errorMsg = error.response?.data || error.message || '';
    const isAlreadyConnected = error.response?.status === 400 && 
                               containsKeywords(errorMsg, ['already connected', 'connected', 'open', 'conectada']);

    if (isAlreadyConnected) {
      console.log(`✅ [Evolution API] Instancia "${instanceName}" ya se encuentra conectada (detectado en catch 400).`);
      return res.status(200).json({
        success: true,
        status: 'CONNECTED',
        message: 'La instancia ya está conectada y activa.',
      });
    }

    return res.status(500).json({ error: 'Error interno al comunicarse con Evolution API.' });
  }
}

/**
 * Cierra la sesión activa de WhatsApp destruyendo la conexión en Evolution API
 */
export async function disconnectDevice(req, res) {
  const tenantId = req.user.tenantId;
  if (!tenantId) {
    return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
  }

  const instanceName = getEvoInstanceName(tenantId);
  const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';

  try {
    await axios.delete(
      `${evoUrl}/instance/logout/${instanceName}`,
      getEvoHeaders()
    );

    return res.json({
      status: 'DISCONNECTED',
      message: 'Sesión de WhatsApp cerrada con éxito.',
    });
  } catch (error) {
    // Si ya estaba eliminada o da 404, confirmamos el estado desconectado
    if (error.response && error.response.status === 404) {
      return res.json({
        status: 'DISCONNECTED',
        message: 'La instancia ya no existía en el servidor.',
      });
    }

    console.error("DETALLE DEL ERROR DE EVOLUTION:", error.response?.data || error.message);
    return res.status(500).json({ error: 'Error al desconectar la instancia en Evolution API.' });
  }
}

/**
 * Envía un mensaje de texto a través de un canal activo de Evolution API
 */
export async function sendMessage(req, res) {
  const { number, message, instanceName } = req.body;

  if (!number || !message || !instanceName) {
    return res.status(400).json({ error: 'Faltan parámetros requeridos (number, message, instanceName).' });
  }

  const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';

  try {
    const response = await axios.post(
      `${evoUrl}/message/sendText/${instanceName}`,
      {
        number,
        text: message,
      },
      getEvoHeaders()
    );

    return res.json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    console.error('DETALLE DEL ERROR DE EVOLUTION:', error.response?.data || error.message);
    return res.status(500).json({
      error: 'Error al enviar el mensaje de texto a través de Evolution API.',
      details: error.response?.data || error.message,
    });
  }
}

/**
 * Procesa los webhooks entrantes de Evolution API (Mensajes recibidos)
 * y responde automáticamente consultando la base de datos de productos de ese tenant e invocando a la IA
 */
export async function receiveWebhook(req, res) {
  const { event, instance, data } = req.body;
  const remoteJid = data?.key?.remoteJid || '';
  const clientNumber = remoteJid.split('@')[0] || 'desconocido';

  // Escudo Anti-Spam: Rate limiting de 2 segundos (2000ms)
  if (remoteJid) {
    const now = Date.now();
    const lastTime = spamCache.get(remoteJid);
    if (lastTime && (now - lastTime < 2000)) {
      console.log(`🛡️ [Spam Cache] Spam detectado de +${clientNumber}, ignorando...`);
      return res.status(200).send("Spam detectado, ignorando...");
    }
    spamCache.set(remoteJid, now);
  }

  // Verificar tipo de mensaje entrante
  const messageType = data?.message ? Object.keys(data.message)[0] : '';
  const isMedia = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(messageType);

  if (isMedia) {
    if (messageType === 'imageMessage') {
      console.log(`📸 Imagen recibida de +${clientNumber} en instancia "${instance}"`);
    } else if (messageType === 'audioMessage') {
      console.log(`🎙️ Audio recibido de +${clientNumber} en instancia "${instance}"`);
    } else if (messageType === 'videoMessage') {
      console.log(`🎥 Video recibido de +${clientNumber} en instancia "${instance}"`);
    } else {
      console.log(`🎥 Multimedia (${messageType}) recibido de +${clientNumber} en instancia "${instance}"`);
    }
  } else {
    console.log('🚨 WEBHOOK RECIBIDO:', JSON.stringify(req.body, null, 2));
  }

  try {
    // Solo procesar la creación/recepción de nuevos mensajes
    if (event !== 'messages.upsert') {
      return res.sendStatus(200);
    }

    if (!data || !data.key) {
      return res.sendStatus(200);
    }

    const key = data.key;

    const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';

    // Extraer texto o imagen del mensaje entrante
    let userMessageText = '';
    let imageBase64 = null;

    if (data.message?.conversation) {
      userMessageText = data.message.conversation;
    } else if (data.message?.extendedTextMessage?.text) {
      userMessageText = data.message.extendedTextMessage.text;
    } else if (data.message?.imageMessage) {
      const caption = data.message.imageMessage.caption || '';
      userMessageText = caption || 'Analiza esta imagen';

      try {
        console.log(`📸 [Evolution API] Descargando imagen en Base64 para la instancia "${instance}"...`);
        const mediaRes = await axios.post(
          `${evoUrl}/chat/getBase64FromMediaMessage/${instance}`,
          { message: data },
          getEvoHeaders()
        );
        let resData = mediaRes.data;
        if (resData) {
          imageBase64 = typeof resData === 'string' ? resData : (resData.base64 || null);
        }
        if (imageBase64) {
          console.log('✅ [Evolution API] Imagen descargada correctamente en Base64.');
        }
      } catch (mediaError) {
        console.error('❌ [Evolution API] Error al descargar imagen en Base64:', mediaError.response?.data || mediaError.message);
      }
    } else if (data.message?.audioMessage) {
      try {
        console.log(`🎙️ [Evolution API] Descargando audio en Base64 para la instancia "${instance}"...`);
        const mediaRes = await axios.post(
          `${evoUrl}/chat/getBase64FromMediaMessage/${instance}`,
          { message: data },
          getEvoHeaders()
        );
        let resData = mediaRes.data;
        let audioBase64 = null;
        if (resData) {
          audioBase64 = typeof resData === 'string' ? resData : (resData.base64 || null);
        }
        if (audioBase64) {
          console.log('✅ [Evolution API] Audio descargado correctamente en Base64. Iniciando transcripción...');
          const transcriptionText = await transcribeAudio(audioBase64);
          if (transcriptionText && transcriptionText.trim()) {
            console.log(`📝 [Whisper] Audio transcrito con éxito: "${transcriptionText}"`);
            userMessageText = `[Nota de voz]: ${transcriptionText}`;
          }
        }
      } catch (audioError) {
        console.error('❌ Error al procesar audio en webhook:', audioError.message);
      }
    } else if (data.message?.videoMessage) {
      const caption = data.message.videoMessage.caption || '';
      userMessageText = caption || 'Analiza este video';

      // ESCUDO ANTI-SATURACIÓN:
      // Comprobar con regex si el caption contiene 'segundo \d+' antes de descargar
      const match = userMessageText.match(/segundo\s+(\d+)/i);
      if (!match) {
        console.log('🛡️ [Escudo Video] No se detectó palabra clave de segundo en el mensaje del video. Cancelando descarga y respondiendo.');
        await axios.post(
          `${evoUrl}/message/sendText/${instance}`,
          {
            number: clientNumber,
            text: "🎥 He recibido tu video. Para evitar confusiones, ¿podrías enviarme una *captura de pantalla* del momento exacto, o volver a enviarme el video escribiendo el *segundo* en el mensaje? (Ej: 'segundo 5')"
          },
          getEvoHeaders()
        );
        return res.sendStatus(200);
      }

      try {
        console.log(`🎥 [Evolution API] Descargando video en Base64 para la instancia "${instance}"...`);
        const mediaRes = await axios.post(
          `${evoUrl}/chat/getBase64FromMediaMessage/${instance}`,
          { message: data },
          getEvoHeaders()
        );
        let resData = mediaRes.data;
        let videoBase64 = null;
        if (resData) {
          videoBase64 = typeof resData === 'string' ? resData : (resData.base64 || null);
        }
        if (videoBase64) {
          console.log('✅ [Evolution API] Video descargado correctamente en Base64. Iniciando extracción de fotograma...');
          const frameBase64 = await extractFrameFromVideo(videoBase64, userMessageText);
          if (frameBase64 === 'REQUIRE_SECOND') {
            console.log('🛡️ [Escudo Video] extractFrameFromVideo solicitó segundo. Respondiendo plantilla.');
            await axios.post(
              `${evoUrl}/message/sendText/${instance}`,
              {
                number: clientNumber,
                text: "🎥 He recibido tu video. Para evitar confusiones, ¿podrías enviarme una *captura de pantalla* del momento exacto, o volver a enviarme el video escribiendo el *segundo* en el mensaje? (Ej: 'segundo 5')"
              },
              getEvoHeaders()
            );
            return res.sendStatus(200);
          }
          if (frameBase64 && frameBase64 !== 'REQUIRE_SECOND') {
            console.log('✅ [FFmpeg] Fotograma extraído y convertido a Base64 con éxito.');
            imageBase64 = frameBase64;
          }
        }
      } catch (videoError) {
        console.error('❌ Error al procesar video en webhook:', videoError.message);
      }
    }

    // Ignorar si el mensaje no tiene contenido de texto legible
    if (!userMessageText.trim()) {
      return res.sendStatus(200);
    }

    console.log(`💬 [Webhook Evolution] Mensaje entrante de +${clientNumber} en instancia ${instance}: "${userMessageText}"`);

    // Mapear el nombre de la instancia al Tenant correspondiente en PostgreSQL
    // El nombre de la instancia sigue el formato: velion_instance_8c975d84 (los primeros 8 caracteres del tenantId)
    const tenantPrefix = instance.replace('velion_instance_', '');
    const tenant = await prisma.tenant.findFirst({
      where: {
        id: {
          startsWith: tenantPrefix
        }
      }
    });

    if (!tenant) {
      console.warn(`⚠️ [Webhook Evolution] No se encontró ningún Tenant registrado en DB para el prefijo: ${tenantPrefix}`);
      return res.sendStatus(200);
    }

    // --- Persistencia en Chat y Mensajes (Live Chat CRM) ---
    let contact = await prisma.contact.findFirst({
      where: {
        tenantId: tenant.id,
        phone: {
          contains: clientNumber
        }
      }
    });

    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          name: data?.pushName || `Cliente +${clientNumber}`,
          phone: clientNumber,
          tenantId: tenant.id,
          category: 'Whatsapp'
        }
      });
    }

    let chat = await prisma.chat.findFirst({
      where: {
        contactId: contact.id,
        tenantId: tenant.id
      }
    });

    if (!chat) {
      chat = await prisma.chat.create({
        data: {
          contactId: contact.id,
          tenantId: tenant.id
        }
      });
    }

    // SI EL MENSAJE ES NUESTRO (ENVIADO DESDE EL CELULAR COMERCIAL O PANEL)
    if (key.fromMe) {
      // Guardar en la base de datos como mensaje del agente
      await prisma.message.create({
        data: {
          content: userMessageText,
          senderRole: 'agent',
          chatId: chat.id,
          tenantId: tenant.id
        }
      });

      // Emitir mensaje saliente a través de WebSocket en tiempo real
      if (req.io) {
        req.io.emit('new_whatsapp_message', {
          chatId: chat.id,
          remoteJid,
          text: userMessageText,
          type: 'outgoing',
          timestamp: new Date()
        });
      }

      console.log(`📤 [Webhook Evolution] Mensaje saliente propio de +${clientNumber} guardado y transmitido por socket: "${userMessageText}"`);
      return res.sendStatus(200);
    }

    // SI EL MENSAJE ES ENTRANTE (DEL CLIENTE)
    // Registrar el mensaje entrante en la base de datos
    await prisma.message.create({
      data: {
        content: userMessageText,
        senderRole: 'contact',
        chatId: chat.id,
        tenantId: tenant.id
      }
    });

    // Emitir mensaje entrante a través de WebSocket en tiempo real
    if (req.io) {
      req.io.emit('new_whatsapp_message', {
        chatId: chat.id,
        remoteJid,
        text: userMessageText,
        type: 'incoming',
        timestamp: new Date()
      });
    }

    // Buscar o registrar al cliente en el CRM (Memoria a Largo Plazo / Anti-Banes)
    let customer = await prisma.customer.findUnique({
      where: {
        tenantId_phone: {
          tenantId: tenant.id,
          phone: remoteJid
        }
      }
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          phone: remoteJid,
          tenantId: tenant.id,
          name: data?.pushName || 'Cliente'
        }
      });
      console.log(`👤 [CRM] Nuevo cliente registrado en base de datos: +${clientNumber}`);
    }

    // El Martillo del Ban: Si el usuario está baneado, ignorar de inmediato
    if (customer.isBanned) {
      console.log(`🔨 [Martillo del Ban] Mensaje de +${clientNumber} ignorado debido a baneo activo.`);
      return res.status(200).send("Usuario baneado, ignorando");
    }

    // --- SEGURO DE ATENCIÓN HUMANA (HUMAN HANDOFF) ---
    if (customer.isBotPaused) {
      console.log(`👥 [Human Handoff] Bot pausado para +${clientNumber}. Conversación atendida por asesor.`);
      return res.sendStatus(200);
    }

    // --- MOTOR DE FLUJOS AUTOMATIZADOS (FASE 2) ---
    const isFlowHandled = await flowService.executeFlowContext(customer, userMessageText, instance);
    if (isFlowHandled) {
      console.log(`🤖 [Flow Engine] Flujo visual tomó control de la conversación para +${clientNumber}`);
      return res.sendStatus(200);
    }

    // Consultar el catálogo de inventario del Tenant
    const products = await prisma.product.findMany({
      where: {
        user: {
          tenantId: tenant.id
        }
      }
    });

    // Obtener información institucional del Tenant para inyección de contexto
    const tenantDetails = await prisma.tenant.findUnique({
      where: { id: tenant.id }
    });

    // Formatear el catálogo de inventario en una lista compacta de texto
    const lines = products.map((p) => {
      const disponibilidad = p.isAvailable ? 'Disponible' : 'Agotado';
      const precio = p.price ? `$${p.price.toFixed(2)}` : 'precio no definido';
      const descripcion = p.description ? `. ${p.description}` : '';
      const imagenUrl = p.imageUrl ? ` | Imagen: ${p.imageUrl}` : ' | Imagen: Sin imagen';
      return `- ${p.name}: ${precio}, Estado: ${disponibilidad}${descripcion}${imagenUrl}`;
    });

    const inventarioTexto = lines.length > 0
      ? lines.join('\n')
      : 'El catálogo de inventario se encuentra actualmente vacío.';

    // Construir bloque de contexto institucional del Tenant
    let infoInstitucional = '';
    if (tenantDetails) {
      const nombreComercial = tenantDetails.companyName || tenantDetails.name || 'nuestra empresa';
      infoInstitucional = `Eres el asistente virtual de ventas de "${nombreComercial}".`;
      if (tenantDetails.businessSector) infoInstitucional += ` Nos dedicamos a: ${tenantDetails.businessSector}.`;
      if (tenantDetails.address) infoInstitucional += ` Nuestra dirección física es: ${tenantDetails.address}.`;
      if (tenantDetails.phone) infoInstitucional += ` Teléfono de contacto: ${tenantDetails.phone}.`;
      if (tenantDetails.email) infoInstitucional += ` Email de soporte: ${tenantDetails.email}.`;
      if (tenantDetails.businessHours) infoInstitucional += ` Horarios de atención: ${tenantDetails.businessHours}.`;
      if (tenantDetails.bankAccounts) infoInstitucional += ` Cuentas bancarias e instrucciones de pago: ${tenantDetails.bankAccounts}.`;
      if (tenantDetails.termsAndPolicies) infoInstitucional += ` Políticas de devolución, envíos y términos: ${tenantDetails.termsAndPolicies}.`;
    } else {
      infoInstitucional = `Eres un asistente virtual de ventas amable.`;
    }

    // Inyectar el inventario al System Prompt de GPT-4o-mini
    const systemPrompt = `${infoInstitucional} Responde siempre de forma breve, amable y concisa.
Este es el inventario actual de productos disponibles (datos en tiempo real desde la base de datos):
${inventarioTexto}

Usa esta información para responder preguntas sobre disponibilidad, precios y productos del catálogo. Si el estado de un producto es Agotado, infórmale claramente al cliente que no está disponible por el momento.`;

    console.log(`🤖 [GPT-4o-mini] Generando respuesta de IA para +${clientNumber}...`);

    // Simular estado "escribiendo..." en WhatsApp de forma asíncrona no bloqueante
    axios.post(
      `${evoUrl}/chat/sendPresence/${instance}`,
      {
        number: key.remoteJid,
        presence: "composing",
        delay: 5000
      },
      getEvoHeaders()
    ).catch(err => {
      console.warn('⚠️ [Evolution API] No se pudo enviar estado de presencia:', err.message);
    });

    // Obtener respuesta de GPT-4o-mini pasando las preferencias históricas del cliente
    const aiResponse = await generateAIResponse(
      systemPrompt, 
      [{ role: 'user', content: userMessageText }],
      imageBase64,
      clientNumber,
      customer.preferences
    );

    if (!aiResponse || aiResponse === '...') {
      return res.sendStatus(200);
    }

    // El Martillo del Ban: Si la respuesta es exactamente '[BAN_USER]'
    if (aiResponse.trim() === '[BAN_USER]') {
      console.log(`🔨 [Martillo del Ban] Detectado comportamiento troll de +${clientNumber}. Aplicando baneo.`);
      await prisma.customer.update({
        where: { id: customer.id },
        data: { isBanned: true }
      });
      return res.sendStatus(200);
    }

    // 1. Buscar y extraer etiquetas [MEDIA: url_de_la_imagen] de la respuesta de la IA
    const mediaRegex = /\[MEDIA:\s*(.+?)\]/g;
    const mediaUrls = [];
    let match;
    while ((match = mediaRegex.exec(aiResponse)) !== null) {
      if (match[1]) {
        // En caso de que se envíen múltiples imágenes separadas por coma en la etiqueta
        const urls = match[1].split(',').map(url => url.trim());
        mediaUrls.push(...urls);
      }
    }

    // Buscar y extraer etiquetas [SAVE_MEM: ...] para la memoria a largo plazo
    const saveMemRegex = /\[SAVE_MEM:\s*(.+?)\]/g;
    const newMemories = [];
    let memMatch;
    while ((memMatch = saveMemRegex.exec(aiResponse)) !== null) {
      if (memMatch[1]) {
        newMemories.push(memMatch[1].trim());
      }
    }

    // Guardar nuevas preferencias en la base de datos de forma incremental
    if (newMemories.length > 0) {
      try {
        const currentPrefs = customer.preferences ? customer.preferences + '\n' : '';
        const newPrefsStr = newMemories.join('. ');
        const updatedPrefs = `${currentPrefs}${newPrefsStr}`;

        await prisma.customer.update({
          where: { id: customer.id },
          data: { preferences: updatedPrefs }
        });
        console.log(`💾 [CRM] Memoria de preferencias actualizada para +${clientNumber}: "${updatedPrefs}"`);
      } catch (dbError) {
        console.error('❌ [CRM] Error al guardar preferencias del cliente en BD:', dbError.message);
      }
    }

    // 2. Limpiar el texto para que el cliente no vea los tags internos
    const cleanText = aiResponse
      .replace(mediaRegex, '')
      .replace(saveMemRegex, '')
      .trim();

    console.log(`📤 [Evolution API] Enviando respuesta limpia a +${clientNumber}: "${cleanText}"`);

    // 3. Enviar mensaje de texto principal (si contiene texto)
    if (cleanText) {
      await axios.post(
        `${evoUrl}/message/sendText/${instance}`,
        {
          number: clientNumber,
          text: cleanText,
        },
        getEvoHeaders()
      );

      // Guardar el mensaje saliente de texto en la base de datos
      await prisma.message.create({
        data: {
          content: cleanText,
          senderRole: 'agent',
          chatId: chat.id,
          tenantId: tenant.id
        }
      });

      // Emitir mensaje saliente de texto por WebSocket en tiempo real
      if (req.io) {
        req.io.emit('new_whatsapp_message', {
          chatId: chat.id,
          remoteJid,
          text: cleanText,
          type: 'outgoing',
          timestamp: new Date()
        });
      }
    }

    // 4. Enviar los archivos multimedia extraídos de forma secuencial y asíncrona
    for (const url of mediaUrls) {
      if (url && url !== 'Sin imagen') {
        try {
          console.log(`📤 [Evolution API] Enviando multimedia a +${clientNumber}: "${url}"`);
          await axios.post(
            `${evoUrl}/message/sendMedia/${instance}`,
            {
              number: clientNumber,
              mediatype: "image",
              media: url,
              caption: "Imagen de producto"
            },
            getEvoHeaders()
          );

          // Guardar el mensaje saliente de imagen en la base de datos
          await prisma.message.create({
            data: {
              content: `[Imagen]: ${url}`,
              senderRole: 'agent',
              chatId: chat.id,
              tenantId: tenant.id
            }
          });

          // Emitir mensaje saliente de imagen por WebSocket en tiempo real
          if (req.io) {
            req.io.emit('new_whatsapp_message', {
              chatId: chat.id,
              remoteJid,
              text: url,
              type: 'outgoing',
              mediaType: 'image',
              timestamp: new Date()
            });
          }
        } catch (mediaSendError) {
          console.error('❌ [Evolution API] Error al enviar archivo multimedia:', mediaSendError.response?.data || mediaSendError.message);
        }
      }
    }

    return res.status(200).json({ success: true, response: aiResponse });
  } catch (error) {
    console.error('❌ Error en webhook de recepción e IA:', error.response?.data || error.message);
    return res.sendStatus(200); // Siempre responder 200 a Evolution para evitar reintentos infinitos por error del webhook
  }
}
