import axios from 'axios';
import prisma from '../db.js';
import { generateAIResponse, transcribeAudio, extractFrameFromVideo } from '../services/aiService.js';
import * as flowService from '../services/flowService.js';
import { validateAndRegisterWhatsAppConnection } from '../services/antiFraudService.js';

/**
 * Helper para generar los headers de autenticación del Evolution API
 */
function getEvoHeaders(customApiKey) {
  const key = (customApiKey || process.env.EVOLUTION_API_KEY || 'A59F9002-9FFF-41CF-8EA6-58AEEB06ED7B').trim();
  return {
    headers: {
      apikey: key,
      'Content-Type': 'application/json'
    }
  };
}

/**
 * Helper para formatear el nombre de la instancia en base al tenantId
 */
function getEvoInstanceName(tenantId) {
  return `bot_prod_${tenantId.slice(0, 8)}`;
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

/**
 * Sanea el nombre de usuario recibido de WhatsApp (pushName)
 * Si está vacío, es solo símbolos o caracteres invisibles, asigna "Cliente Desconocido"
 */
function sanitizePushName(pushName) {
  if (!pushName || typeof pushName !== 'string') return 'Cliente Desconocido';

  // Eliminar caracteres invisibles de ancho cero, caracteres de uso privado y espacios sobrantes
  const cleaned = pushName
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\uE000-\uF8FF]/g, '')
    .trim();

  // Verificar que contenga al menos una letra o número legible
  const hasAlphanumeric = /[a-zA-Z0-9\u00C0-\u024F]/.test(cleaned);

  if (!cleaned || !hasAlphanumeric) {
    return 'Cliente Desconocido';
  }

  return cleaned;
}

/**
 * Helper para obtener el teléfono de destino de notificaciones y alertas
 * 1. Prioriza notificationPhone del tenant
 * 2. Si está vacío/null, realiza fallback al teléfono del Perfil de Administrador
 */
async function resolveNotificationPhone(tenantId, tenantDetails) {
  let phone = tenantDetails?.notificationPhone?.replace(/[^0-9]/g, '') || '';
  if (!phone && tenantId) {
    try {
      const adminUser = await prisma.user.findFirst({
        where: {
          tenantId: tenantId,
          phone: { not: null }
        },
        select: { phone: true }
      });
      if (adminUser?.phone) {
        phone = adminUser.phone.replace(/[^0-9]/g, '');
      }
    } catch (err) {
      console.error('❌ [Alert Helper] Error buscando teléfono de administrador fallback:', err.message);
    }
  }
  return phone || null;
}

/**
 * Sanea un número de teléfono antes de enviarlo a Evolution API.
 * - Elimina todos los caracteres no numéricos (incl. el +)
 * - Si el número resultante tiene exactamente 9 dígitos (formato Perú), agrega el prefijo 51
 */
function sanitizePhoneForEvo(rawPhone) {
  if (!rawPhone) return null;
  const digits = String(rawPhone).replace(/[^0-9]/g, '');
  if (digits.length === 9) {
    return `51${digits}`;
  }
  return digits;
}

// Escudo Anti-Spam: Cache en memoria para rate limiting por número
const spamCache = new Map();

// Buffer de Mensajes (Debounce / Message Collector): Acumula mensajes enviados en ráfaga antes de llamar a la IA (4000ms)
const messageBuffers = new Map();

// Escudo de Facturación: Cache en memoria para rate limiting de llamadas de IA (OpenAI)
const iaRateLimitCache = new Map();

// Cache en memoria para rastrear mensajes enviados por el sistema (IA / Flujos / Panel)
// Permite distinguir intervención humana manual desde el celular/WhatsApp Web
const sentByAiCache = new Set();

export function markMessageAsSentByAi(textOrId) {
  if (!textOrId) return;
  const clean = typeof textOrId === 'string' ? textOrId.trim() : '';
  if (clean) {
    sentByAiCache.add(clean);
    // Auto-expirar en 60 segundos por seguridad
    setTimeout(() => sentByAiCache.delete(clean), 60000);
  }
}

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
    const phone = response.data?.instance?.phone || null;

    if (state === 'open' && phone) {
      const validation = await validateAndRegisterWhatsAppConnection(tenantId, instanceName, phone);
      if (!validation.allowed) {
        return res.status(403).json({
          status: 'DISCONNECTED',
          instanceName,
          phone: null,
          error: validation.errorMessage,
        });
      }
    }

    // Mapeo al formato de estados de la UI del Frontend
    let status = 'DISCONNECTED';
    if (state === 'open') status = 'CONNECTED';
    if (state === 'connecting') status = 'CONNECTING';

    return res.json({
      status,
      instanceName,
      phone,
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

  const baseUrl = process.env.APP_URL || 'https://velion-backend-a7vw.onrender.com';
  const rawWebhookUrl = process.env.WEBHOOK_URL || `${baseUrl.replace(/\/$/, '')}/api/whatsapp/webhook`;
  const cleanApiKey = (process.env.EVOLUTION_API_KEY || '').trim();
  const apiKeyParam = cleanApiKey ? `?apikey=${cleanApiKey}` : '';
  const webhookUrl = rawWebhookUrl.includes('?') ? `${rawWebhookUrl}&apikey=${cleanApiKey}` : `${rawWebhookUrl}${apiKeyParam}`;

  // 1. Asegurar la creación previa de la instancia
  try {
    await axios.post(
      `${evoUrl}/instance/create`,
      {
        instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        webhook: {
          enabled: true,
          url: webhookUrl,
          byEvents: false,
          webhookByEvents: false,
          events: [
            "MESSAGES_UPSERT"
          ]
        }
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
    console.log(`🔌 [Evolution API] Sobrescribiendo webhook en: ${webhookUrl} para la instancia: ${instanceName}`);
    await axios.post(
      `${evoUrl}/webhook/set/${instanceName}`,
      {
        webhook: {
          enabled: true,
          url: webhookUrl,
          headers: {
            apikey: cleanApiKey
          },
          byEvents: false,
          webhookByEvents: false,
          events: [
            "MESSAGES_UPSERT"
          ]
        }
      },
      getEvoHeaders()
    );
    console.log('✅ [Evolution API] Webhook sobrescrito y actualizado con éxito.');
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
 * Cierra la sesión activa y destruye por completo la conexión en Evolution API (evitando instancias zombis)
 */
export async function disconnectDevice(req, res) {
  const tenantId = req.user.tenantId;
  if (!tenantId) {
    return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
  }

  const instanceName = getEvoInstanceName(tenantId);
  const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';

  try {
    // 1. Logout previo en Evolution API (cerrar sesión WhatsApp Baileys)
    try {
      await axios.delete(
        `${evoUrl}/instance/logout/${instanceName}`,
        getEvoHeaders()
      );
      console.log(`🔌 [Evolution API] Logout exitoso para la instancia "${instanceName}".`);
    } catch (logoutErr) {
      console.log(`ℹ️ [Evolution API] Aviso en logout (${logoutErr.response?.status}):`, logoutErr.response?.data || logoutErr.message);
    }

    // 2. Destrucción total de la instancia en Evolution API
    try {
      await axios.delete(
        `${evoUrl}/instance/delete/${instanceName}`,
        getEvoHeaders()
      );
      console.log(`🗑️ [Evolution API] Instancia "${instanceName}" eliminada/destruida por completo.`);
    } catch (deleteErr) {
      if (deleteErr.response && (deleteErr.response.status === 404 || deleteErr.response.status === 400)) {
        console.log(`ℹ️ [Evolution API] Instancia "${instanceName}" ya no existía en el servidor (404/400).`);
      } else {
        console.warn(`⚠️ Advertencia al eliminar la instancia "${instanceName}" en Evolution API:`, deleteErr.response?.data || deleteErr.message);
      }
    }

    // Nota: prisma.whatsappConnection no existe en el schema actual.
    // La limpieza de conexiones se gestiona a través de RegisteredWhatsAppNumber.

    return res.json({
      status: 'DISCONNECTED',
      message: 'Instancia eliminada y sesión de WhatsApp destruida con éxito.',
    });
  } catch (error) {
    console.error("DETALLE DEL ERROR DE EVOLUTION:", error.response?.data || error.message);
    return res.status(500).json({ error: 'Error al desconectar y destruir la instancia en Evolution API.' });
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

  const cleanNumber = number.replace(/\D/g, '');
  try {
    const response = await axios.post(
      `${evoUrl}/message/sendText/${instanceName}`,
      {
        number: cleanNumber,
        text: message,
        options: {
          delay: 0
        }
      },
      getEvoHeaders()
    );

    const msgId = response.data?.key?.id;
    if (msgId) markMessageAsSentByAi(msgId);
    markMessageAsSentByAi(message);

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
  const requestApiKey = (req.query?.apikey || req.headers?.apikey || req.body?.apikey || req.headers?.['x-api-key'] || '').trim();
  const systemApiKey = (process.env.EVOLUTION_API_KEY || '').trim();

  // Validación de Seguridad: Si se envía una ApiKey explícita y no coincide con la del sistema, se bloquea.
  if (systemApiKey && requestApiKey && requestApiKey !== systemApiKey) {
    console.log('🔍 [DEBUG KEY] Recibida:', requestApiKey, '|| Esperada:', systemApiKey);
    console.error('🚨 [Seguridad Webhook] Petición bloqueada por ApiKey explícitamente inválida.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { event, instance, data } = req.body;
  const remoteJid = data?.key?.remoteJid || '';
  const clientNumber = remoteJid.split('@')[0] || 'desconocido';
  const tenantTag = instance ? instance.replace('bot_prod_', '').substring(0, 8) : 'sistema';

  // Identificar si el mensaje proviene o pertenece a un grupo de WhatsApp (@g.us)
  const isGroup = remoteJid.endsWith('@g.us') || remoteJid.includes('@g.us') || !!data?.key?.participant || data?.isGroup === true;

  // REGLA ESTRICTA HARDCODEADA: Bloquear siempre respuestas e interacciones en grupos de WhatsApp
  if (isGroup) {
    console.log(`🛡️ [Bloqueo Estricto de Grupos] Mensaje de grupo ignorado para ${remoteJid}.`);
    return res.status(200).send('Group message ignored (hardcoded policy)');
  }

  // Verificar tipo de mensaje entrante
  const messageType = data?.message ? Object.keys(data.message)[0] : 'event';

  // Log estructurado limpio en formato SaaS de una sola línea (Sin Log Pollution)
  console.log(`[🏢 TENANT: ${tenantTag}] 📥 EVENTO: ${event || 'N/A'} | De: +${clientNumber} | Tipo: ${messageType}`);

  try {
    // Solo procesar la creación/recepción de nuevos mensajes
    if (event !== 'messages.upsert') {
      return res.sendStatus(200);
    }

    const key = data.key;

    // SI EL MENSAJE ES NUESTRO (ENVIADO POR EL BOT O EL AGENTE HUMANO)
    if (key.fromMe) {
      // No procesar IA ni activar buffer para mensajes salientes de nuestra propia cuenta
    }

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
          getEvoHeaders(requestApiKey)
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
          getEvoHeaders(requestApiKey)
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
        const cleanClientNumber = clientNumber.replace(/\D/g, '');
        await axios.post(
          `${evoUrl}/message/sendText/${instance}`,
          {
            number: cleanClientNumber,
            text: "🎥 He recibido tu video. Para evitar confusiones, ¿podrías enviarme una *captura de pantalla* del momento exacto, o volver a enviarme el video escribiendo el *segundo* en el mensaje? (Ej: 'segundo 5')",
            options: {
              delay: 0
            }
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
          getEvoHeaders(requestApiKey)
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
            const cleanClientNumber = clientNumber.replace(/\D/g, '');
            await axios.post(
              `${evoUrl}/message/sendText/${instance}`,
              {
                number: cleanClientNumber,
                text: "🎥 He recibido tu video. Para evitar confusiones, ¿podrías enviarme una *captura de pantalla* del momento exacto, o volver a enviarme el video escribiendo el *segundo* en el mensaje? (Ej: 'segundo 5')",
                options: {
                  delay: 0
                }
              },
              getEvoHeaders(requestApiKey)
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
    // El nombre de la instancia sigue el formato: bot_prod_8c975d84 (los primeros 8 caracteres del tenantId)
    const tenantPrefix = instance.replace('bot_prod_', '');
    
    const tenants = await prisma.tenant.findMany({ select: { id: true } });
    console.log("🔍 [DEBUG] Tenants en la base de datos:", tenants.map(t => t.id));
    console.log("🔍 [DEBUG] Buscando el prefijo exacto:", tenantPrefix);

    const matchingTenant = tenants.find(t => t.id.toLowerCase().startsWith(tenantPrefix.toLowerCase()));

    if (!matchingTenant) {
        console.log(`⚠️ [Webhook Evolution] No se encontró ningún Tenant registrado en DB para el prefijo: ${tenantPrefix}`);
        return res.status(200).send('Tenant no encontrado, pero mensaje recibido.');
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: matchingTenant.id }
    });

    // ESCUDO DE GRUPOS: Validar si el mensaje es de un grupo y si el Tenant permite responder en grupos
    if (isGroup && !tenant?.respondInGroups) {
      console.log(`🛡️ [Seguridad] Mensaje de grupo ignorado para ${remoteJid} (respondInGroups es false)`);
      return res.status(200).send('Group message ignored');
    }

    // --- Persistencia en Chat y Mensajes (Live Chat CRM) ---
    const cleanPhone = clientNumber.replace(/\D/g, '') || clientNumber;
    const isOutgoing = Boolean(data?.key?.fromMe);

    // REGLA CRÍTICA DE NOMBRES EN CRM:
    // Si el mensaje es SALIENTE (fromMe: true), el pushName en el evento pertenece al dueño del bot (tenant).
    // Está ESTRICTAMENTE PROHIBIDO usar el pushName de eventos salientes para nombrar al cliente.
    // Para mensajes salientes a números nuevos, registramos al contacto temporalmente con su número ("Cliente +51...").
    // Solo cuando el mensaje es ENTRANTE (!fromMe) extraemos y guardamos el pushName real del cliente.
    const rawPushName = !isOutgoing
      ? (data?.pushName || data?.key?.pushName || req.body?.pushName || null)
      : null;

    const extractedName = sanitizePushName(rawPushName);
    const fallbackName = `Cliente +${cleanPhone}`;
    const initialName = (!isOutgoing && extractedName !== 'Cliente Desconocido') ? extractedName : fallbackName;

    // Búsqueda ESTRICTA por tenantId y phone exacto (Evita duplicados o cruces de nombres)
    let contact = await prisma.contact.findFirst({
      where: {
        tenantId: tenant.id,
        phone: cleanPhone
      }
    });

    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          name: initialName,
          phone: cleanPhone,
          tenantId: tenant.id,
          category: 'Whatsapp'
        }
      });
    } else if (!isOutgoing && extractedName !== 'Cliente Desconocido' && (contact.name === 'Cliente Desconocido' || contact.name.startsWith('Cliente +'))) {
      // Si el mensaje es ENTRANTE y el cliente envía un pushName válido, actualizamos su nombre real en el CRM
      contact = await prisma.contact.update({
        where: { id: contact.id },
        data: { name: extractedName }
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

    // SI EL MENSAJE ES NUESTRO (ENVIADO DESDE EL CELULAR COMERCIAL, PANEL O IA)
    if (key.fromMe) {
      const msgId = key.id;
      const isAiMessage = (msgId && sentByAiCache.has(msgId)) || 
                          (userMessageText && sentByAiCache.has(userMessageText.trim()));

      if (isAiMessage) {
        if (msgId) sentByAiCache.delete(msgId);
        if (userMessageText) sentByAiCache.delete(userMessageText.trim());
        console.log(`🤖 [Webhook Evolution] Mensaje saliente de IA/Sistema verificado para +${clientNumber}.`);
      } else {
        // 🚨 ¡INTERVENCIÓN HUMANA DETECTADA DESDE CELULAR O WHATSAPP WEB!
        console.log(`👤 [Auto-Pausa Human Handoff] Intervención humana detectada en +${clientNumber}. Pausando bot automáticamente...`);

        // 1. Pausar en Contact (CRM)
        if (contact && !contact.botPaused) {
          await prisma.contact.update({
            where: { id: contact.id },
            data: { botPaused: true }
          });
        }

        // 2. Pausar en Chat (CRM)
        if (chat && !chat.botPaused) {
          await prisma.chat.update({
            where: { id: chat.id },
            data: { botPaused: true }
          });
        }

        // 3. Pausar en Customer (Bot Engine)
        const cleanPhone = clientNumber.replace(/\D/g, '');
        if (cleanPhone) {
          await prisma.customer.updateMany({
            where: { tenantId: tenant.id, phone: { contains: cleanPhone } },
            data: { isBotPaused: true }
          });
        }

        // 4. Cancelar cualquier buffer de mensajes acumulados pendiente del cliente
        if (messageBuffers.has(remoteJid)) {
          const buf = messageBuffers.get(remoteJid);
          if (buf?.timer) clearTimeout(buf.timer);
          messageBuffers.delete(remoteJid);
          console.log(`🧹 [Message Buffer] Buffer cancelado para +${clientNumber} por intervención humana.`);
        }

        // 5. Emitir eventos por WebSocket en tiempo real para el Dashboard
        if (req.io) {
          req.io.emit('contact_updated', {
            contactId: contact?.id,
            phone: cleanPhone,
            botPaused: true,
            reason: 'HUMAN_INTERVENTION'
          });
          req.io.emit('bot_status_changed', {
            contactId: contact?.id,
            phone: cleanPhone,
            botPaused: true
          });
        }
      }

      // Guardar en la base de datos como mensaje del agente si no se ha guardado previamente
      const existingMessage = await prisma.message.findFirst({
        where: {
          chatId: chat.id,
          content: userMessageText,
          senderRole: 'agent'
        }
      });

      if (!existingMessage) {
        await prisma.message.create({
          data: {
            content: userMessageText,
            senderRole: 'agent',
            chatId: chat.id,
            tenantId: tenant.id
          }
        });
      }

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
    // 1. Registrar el mensaje entrante en la base de datos inmediatamente para el panel
    await prisma.message.create({
      data: {
        content: userMessageText,
        senderRole: 'contact',
        chatId: chat.id,
        tenantId: tenant.id
      }
    });

    // 2. Emitir mensaje entrante a través de WebSocket en tiempo real inmediatamente
    if (req.io) {
      req.io.emit('new_whatsapp_message', {
        chatId: chat.id,
        remoteJid,
        text: userMessageText,
        type: 'incoming',
        timestamp: new Date()
      });
    }

    // 2.5 ESCUDO DE AUTO-PAUSA Y AUTO-REACTIVACIÓN POR TIMEOUT (24 HORAS)
    const existingCustomerForCheck = await prisma.customer.findUnique({
      where: {
        tenantId_phone: {
          tenantId: tenant.id,
          phone: remoteJid
        }
      }
    });

    let isPaused = Boolean(contact?.botPaused || existingCustomerForCheck?.isBotPaused);

    if (isPaused) {
      // Buscar la interacción previa en el chat (saltando el mensaje entrante recién guardado)
      const previousMessage = await prisma.message.findFirst({
        where: { chatId: chat.id },
        orderBy: { createdAt: 'desc' },
        skip: 1
      });

      const lastActivityDate = previousMessage?.createdAt 
        || chat?.updatedAt 
        || contact?.updatedAt 
        || new Date(0);

      const timeDiffMs = Date.now() - new Date(lastActivityDate).getTime();
      const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000; // 86,400,000 milisegundos

      if (timeDiffMs >= TWENTY_FOUR_HOURS_MS) {
        const hoursPassed = Math.round(timeDiffMs / (1000 * 60 * 60));
        console.log(`🔄 [Auto-Reactivación 24h] Han pasado ${hoursPassed}h desde la última interacción con +${clientNumber}. Reactivando Bot automáticamente...`);

        // 1. Despausar en PostgreSQL (Contact, Chat, Customer)
        if (contact) {
          await prisma.contact.update({
            where: { id: contact.id },
            data: { botPaused: false }
          });
          contact.botPaused = false;
        }

        if (chat) {
          await prisma.chat.update({
            where: { id: chat.id },
            data: { botPaused: false }
          });
        }

        if (cleanPhone) {
          await prisma.customer.updateMany({
            where: { tenantId: tenant.id, phone: { contains: cleanPhone } },
            data: { isBotPaused: false }
          });
        }

        // 2. Emitir eventos por WebSocket en tiempo real para el Dashboard
        if (req.io) {
          req.io.emit('contact_updated', {
            contactId: contact?.id,
            phone: cleanPhone,
            botPaused: false,
            reason: 'AUTO_REACTIVATION_24H'
          });
          req.io.emit('bot_status_changed', {
            contactId: contact?.id,
            phone: cleanPhone,
            botPaused: false
          });
        }

        // Desactivar bandera para permitir respuesta normal de la IA
        isPaused = false;
      }
    }

    if (isPaused) {
      console.log(`👥 [Auto-Pausa Human Handoff] Bot pausado para +${clientNumber} (< 24h desde la última interacción). Mensaje del cliente guardado en CRM pero la IA no responderá.`);
      return res.sendStatus(200);
    }

    // 3. Sistema de Message Buffer / Debounce: Acumular mensajes si el usuario escribe en ráfaga (espera 4000ms)
    const existingBuffer = messageBuffers.get(remoteJid);
    if (existingBuffer) {
      clearTimeout(existingBuffer.timer);
      existingBuffer.text += '\n' + userMessageText;
      if (imageBase64) {
        existingBuffer.imageBase64 = imageBase64;
      }
      existingBuffer.timer = setTimeout(() => {
        processBufferedMessage(remoteJid);
      }, 4000);
      console.log(`⏳ [Message Buffer] Mensaje en ráfaga concatenado para +${clientNumber}. Reiniciando temporizador a 4000ms...`);
    } else {
      const bufferEntry = {
        remoteJid,
        clientNumber,
        text: userMessageText,
        imageBase64,
        tenant,
        contact,
        chat,
        instance,
        requestApiKey,
        data,
        reqIo: req.io,
        timer: setTimeout(() => {
          processBufferedMessage(remoteJid);
        }, 4000)
      };
      messageBuffers.set(remoteJid, bufferEntry);
      console.log(`⏳ [Message Buffer] Primer mensaje en ráfaga de +${clientNumber}. Esperando 4000ms para acumular mensajes adicionales...`);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error en webhook de recepción:', error.response?.data || error.message);
    return res.sendStatus(200);
  }
}

/**
 * Procesa la ráfaga acumulada de mensajes en el buffer tras caducar el temporizador de 4000ms
 */
async function processBufferedMessage(remoteJid) {
  const buffer = messageBuffers.get(remoteJid);
  if (!buffer) return;

  // Sacar y eliminar del buffer
  messageBuffers.delete(remoteJid);

  const {
    text: userMessageText,
    imageBase64,
    tenant,
    contact,
    chat,
    instance,
    requestApiKey,
    clientNumber,
    data,
    reqIo
  } = buffer;

  console.log(`🤖 [Message Buffer] Procesando ráfaga acumulada para +${clientNumber} (${userMessageText.length} caracteres): "${userMessageText.replace(/\n/g, ' ')}"`);

  try {
    const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';

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
      return;
    }

    // --- SEGURO DE ATENCIÓN HUMANA (HUMAN HANDOFF) ---
    if (customer.isBotPaused) {
      console.log(`👥 [Human Handoff] Bot pausado para +${clientNumber}. Conversación atendida por asesor.`);
      return;
    }

    // --- MOTOR DE FLUJOS AUTOMATIZADOS (FASE 2) ---
    const isFlowHandled = await flowService.executeFlowContext(customer, userMessageText, instance);
    if (isFlowHandled) {
      console.log(`🤖 [Flow Engine] Flujo visual tomó control de la conversación para +${clientNumber}`);
      return;
    }

    // --- ESCUDO DE FACTURACIÓN: Rate Limiter de IA (Máximo 10 mensajes de IA por minuto por usuario) ---
    if (remoteJid) {
      const now = Date.now();
      const limitData = iaRateLimitCache.get(remoteJid);
      if (limitData) {
        if (now < limitData.resetTime) {
          if (limitData.count >= 10) {
            console.warn(`🛡️ [IA Rate Limiter] Límite de IA excedido para +${clientNumber}. Bloqueando respuesta para proteger tokens de OpenAI.`);
            return;
          }
          limitData.count += 1;
        } else {
          iaRateLimitCache.set(remoteJid, { count: 1, resetTime: now + 60000 });
        }
      } else {
        iaRateLimitCache.set(remoteJid, { count: 1, resetTime: now + 60000 });
      }
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

    // ─── CONTROL DE CUOTA / LÍMITE DE MENSAJES MENSUALES DEL TENANT ───
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthMsgCount = await prisma.message.count({
      where: {
        tenantId: tenant.id,
        createdAt: { gte: startOfMonth }
      }
    });

    const tenantMsgLimit = tenantDetails?.msgLimit || 1000;

    if (monthMsgCount >= tenantMsgLimit) {
      console.warn(`🛑 [Límite Excedido] Tenant '${tenant.name}' alcanzó su límite mensual (${monthMsgCount}/${tenantMsgLimit}). Se detiene la IA y se notifica al usuario.`);
      const finalCleanNumber = clientNumber.replace(/[^0-9]/g, '');
      try {
        await axios.post(
          `${evoUrl}/message/sendText/${instance}`,
          {
            number: finalCleanNumber,
            text: "Has alcanzado el límite mensual de mensajes de tu plan."
          },
          getEvoHeaders(requestApiKey)
        );
      } catch (limitSendErr) {
        console.error(`❌ Error enviando mensaje de límite excedido:`, limitSendErr.message);
      }
      return;
    }

    // Formatear el catálogo de inventario en una lista compacta de texto
    const hoy = new Date();
    const lines = products.map((p) => {
      const disponibilidad = p.isAvailable ? 'Disponible' : 'Agotado';
      const descripcion = p.description ? `. ${p.description}` : '';
      const imagenUrl = p.imageUrl ? ` | Imagen: ${p.imageUrl}` : ' | Imagen: Sin imagen';

      let tienePromoActiva = false;
      if (p.promotionalPrice !== null && p.promotionalPrice !== undefined) {
        const start = p.promoStartDate ? new Date(p.promoStartDate) : null;
        const end = p.promoEndDate ? new Date(p.promoEndDate) : null;

        const despuesDeInicio = !start || hoy >= start;
        const antesDeFin = !end || hoy <= end;

        if (despuesDeInicio && antesDeFin) {
          tienePromoActiva = true;
        }
      }

      let precioTexto = '';
      if (tienePromoActiva) {
        const fechaFinTexto = p.promoEndDate
          ? new Date(p.promoEndDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
          : 'tiempo limitado';
        precioTexto = `Precio Normal: S/. ${p.price.toFixed(2)} - PRECIO DE PROMOCIÓN ACTIVO: S/. ${p.promotionalPrice.toFixed(2)} (Válido hasta ${fechaFinTexto})`;
      } else {
        precioTexto = p.price ? `S/. ${p.price.toFixed(2)}` : 'precio no definido';
      }

      return `- ${p.name}: ${precioTexto}, Estado: ${disponibilidad}${descripcion}${imagenUrl}`;
    });

    const inventarioTexto = lines.length > 0
      ? lines.join('\n')
      : 'El catálogo de inventario se encuentra actualmente vacío.';

    // ─── CAPA 1: CAPA GLOBAL (Guardrails de Seguridad y Límites de la IA) ───
    const globalGuardrails = `
Eres el asistente virtual oficial de la tienda. En ningún momento actúes como un asistente de IA general. Tu función es representar a la tienda y ayudar únicamente en temas relacionados con sus productos, servicios, pedidos, horarios, promociones, políticas y atención al cliente.

Si un cliente hace preguntas que no tienen relación con la tienda (por ejemplo: resolver tareas, programar, traducir textos, dar consejos médicos, legales, financieros, crear historias, responder cultura general o cualquier otra consulta ajena al negocio), responde de forma amable indicando que tu función es brindar atención sobre la tienda y redirige la conversación hacia ese propósito. No respondas esas solicitudes.

Mantén siempre un tono profesional, amable, natural y cercano. Escribe como una persona del equipo de atención al cliente, nunca menciones que eres una inteligencia artificial, un modelo de lenguaje o ChatGPT, salvo que la configuración de la tienda lo indique explícitamente.

Responde de forma breve y clara. Evita mensajes largos o innecesarios. Da únicamente la información necesaria para responder la consulta. Si el cliente necesita más detalles, proporcionalos paso a paso.

REGLA DE CIERRE DE CONVERSACIÓN (OBLIGATORIA Y ESTRICTA):
Si el usuario responde con un simple agradecimiento ('gracias', 'ok', 'listo', 'muchas gracias', 'perfecto') o se despide cerrando la venta, DEBES responder con una despedida final muy breve (máximo 5 palabras, ej: '¡De nada, vuelve pronto!'). BAJO NINGUNA CIRCUNSTANCIA debes hacer preguntas de seguimiento, ni decir '¿En qué más puedo ayudarte?' en estos casos. Cierra la conversación de forma seca pero amable para evitar bucles infinitos.

REGLA ANTI-ALUCINACIÓN (OBLIGATORIA, CRÍTICA Y SIN EXCEPCIONES):
NUNCA inventes, supongas, ni imagines datos que no estén explícitamente escritos en este mensaje del sistema. Esto incluye, sin excepción:
- Productos: Si un producto NO aparece en el CATÁLOGO DE PRODUCTOS, NO EXISTE para ti. Nunca lo menciones, describas, cotices ni ofrezcas.
- Precios: SOLO puedes mencionar los precios tal como aparecen en el catálogo. NUNCA estimes, aproximes ni inventes un precio.
- Disponibilidad/stock: Solo puedes decir que algo está disponible o agotado si el catálogo lo indica. Si no aparece, no está disponible.
- Promociones y descuentos: Solo puedes mencionar una promoción si el catálogo la muestra activa. NUNCA inventes ofertas.
- Información de la empresa: Solo puedes usar los datos del apartado INFORMACIÓN DE LA EMPRESA. NUNCA supongas horarios, direcciones ni contactos.
Si el cliente pregunta por algo que no está en el catálogo, responde con honestidad: "Por ahora no contamos con ese producto, pero te puedo mostrar lo que sí tenemos disponible." Luego ofrece alternativas del catálogo real. Silenciar o negar es mejor que inventar.

No prometas descuentos, disponibilidad, tiempos de entrega, garantías, devoluciones o cualquier condición que no esté especificada por la tienda.

Adapta el lenguaje al cliente, pero mantén siempre el respeto. Usa emojis solo si la configuración de la tienda lo permite o si el estilo de la conversación lo hace apropiado.

Si el cliente envía un saludo, responde al saludo e invita a explicar qué necesita. Si hace varias preguntas, respóndelas en un solo mensaje de forma organizada.

Prioriza ayudar al cliente a realizar una compra, resolver dudas sobre productos o dar seguimiento a pedidos, sin ser insistente ni presionar para vender.

ESTRATEGIA DE VENTAS CONTEXTUAL:
- Fase de Exploración/Consulta: Si el cliente pregunta por productos, precios o tiene dudas, usa una estructura persuasiva: 1) Empatía o beneficio rápido, 2) Información directa, 3) Termina SIEMPRE con una pregunta corta para avanzar la venta.
- Fase de Pago/Cierre o Respuestas Simples: Si el cliente está pagando, enviando datos o la conversación ya fluyó al cierre, OLVIDA la estructura anterior. Responde de forma natural, corta y al grano (ej. '¡Excelente! Envíame el comprobante por aquí'). Adapta tu nivel de persuasión al contexto para sonar 100% como un humano real.

Las instrucciones específicas de la tienda tienen prioridad sobre este mensaje global. En caso de conflicto, sigue siempre las instrucciones particulares de la tienda, siempre que no contradigan estas reglas generales.
`.trim();

    // ─── CAPA 2: CAPA DEL SISTEMA (Reglas Duras de Plataforma e Inventario PostgreSQL) ───
    let infoInstitucional = '';
    if (tenantDetails) {
      const nombreComercial = tenantDetails.companyName || tenantDetails.name || 'nuestra empresa';
      const sector = tenantDetails.businessSector || 'sector comercial';
      
      infoInstitucional = `\n\nINFORMACIÓN DE LA EMPRESA: ${nombreComercial}, sector: ${sector}.`;

      let detallesExt = '\nINFORMACIÓN COMPLEMENTARIA DE LA EMPRESA:';
      if (tenantDetails.address) detallesExt += `\n- Dirección física: ${tenantDetails.address}.`;
      if (tenantDetails.phone) detallesExt += `\n- Teléfono de contacto: ${tenantDetails.phone}.`;
      if (tenantDetails.email) detallesExt += `\n- Email de soporte: ${tenantDetails.email}.`;
      if (tenantDetails.businessHours) detallesExt += `\n- Horarios de atención: ${tenantDetails.businessHours}.`;
      if (tenantDetails.bankAccounts) detallesExt += `\n- Cuentas bancarias e instrucciones de pago: ${tenantDetails.bankAccounts}.`;
      if (tenantDetails.termsAndPolicies) detallesExt += `\n- Políticas de envío, devolución y términos: ${tenantDetails.termsAndPolicies}.`;
      
      infoInstitucional += detallesExt;
    }

    const isMultiMessageActive = tenantDetails?.multiMessageMode !== false; // Activo por defecto (true)
    let splitRule = '';
    if (isMultiMessageActive) {
      splitRule = `\nREGLA CRÍTICA DEL SISTEMA (OBLIGATORIA): 
Sin importar tus instrucciones anteriores, DEBES separar tus respuestas en múltiples globos de chat cortos y fluidos para simular a un humano escribiendo. 
Para hacer esto, usa el separador exacto '[SPLIT]' entre cada idea. 
Ejemplo: '¡Hola! Claro que sí 😃 [SPLIT] ¿Qué producto buscas hoy? [SPLIT] Hacemos envíos a todo el Perú 🚚.'\n`;
    }

    let orderNotificationRule = '';
    if (tenantDetails?.notifySalesWhatsApp === true) {
      orderNotificationRule = `\nINSTRUCCIÓN DE CONFIRMACIÓN DE VENTA/PEDIDO (OBLIGATORIA):
Cuando el cliente confirme todos los datos de una compra/envío (producto, dirección, método de pago, monto), genera un resumen estandarizado del pedido e inclúyelo al final de tu respuesta entre la etiqueta exacta [ORDER_CONFIRMED: ...] (ej. '[ORDER_CONFIRMED: Producto: Camiseta Anime | Monto: S/ 85 | Dirección: Av. Brasil 123, Lima | Método: Yape]').\n`;
    }

    const humanHandoffRule = `\nREGLA DE TRANSFERENCIA A HUMANO (FILTRO INTELIGENTE - OBLIGATORIO):
1. Si el usuario pide hablar con un humano, asesor o persona en su PRIMER mensaje o sin explicar su problema, NO emitirás la etiqueta [HUMAN_HANDOFF: ...] de inmediato.
2. En su lugar, responde de forma empática ofreciendo tu ayuda primero: 'Con gusto te comunico con un asesor, pero quizás yo pueda resolver tu consulta más rápido. ¿Sobre qué tema necesitas ayuda?'.
3. Si el usuario procede a explicar su duda y está dentro de tus capacidades (horarios, precios, información básica, catálogo), RESUÉLVELA directamente.
4. PERO, si el usuario explica un problema complejo (quejas, reembolsos, reclamos, errores de sistema), O si INSISTE agresivamente o por segunda vez en hablar con un humano tras tu ofrecimiento, ENTONCES SÍ debes activar la transferencia. En ese caso, despídete amablemente indicando que un asesor lo atenderá y emite al final de tu respuesta la etiqueta exacta: [HUMAN_HANDOFF: Motivo o breve resumen de la solicitud].\n`;

    let marketingInstructionRule = '';
    if (tenantDetails?.marketingModeEnabled === true) {
      marketingInstructionRule = `\nMODO VENDEDOR PERSUASIVO (ESTRATEGIAS DE MARKETING):
tu objetivo principal será aumentar las probabilidades de concretar una venta sin sacrificar la honestidad ni la buena experiencia del cliente.

Antes de responder, analiza la intención del cliente y adapta la conversación para guiarla de forma natural hacia una compra cuando sea apropiado.

No te limites a responder preguntas de forma literal. Explica primero el valor, los beneficios y cómo el producto o servicio puede ayudar al cliente utilizando únicamente la información proporcionada por la tienda. Nunca inventes características, ventajas o promociones.

Cuando un cliente pregunte el precio, si la conversación lo permite, presenta primero de forma breve los beneficios más relevantes del producto y luego indica el precio. No ocultes el precio ni evites responderlo si el cliente lo solicita.

Personaliza la respuesta según la necesidad del cliente. Relaciona los beneficios con lo que el cliente está buscando en lugar de repetir una lista de características.

Resuelve dudas y objeciones con calma, utilizando información real. Si el cliente compara con otros productos o menciona un precio más bajo, destaca el valor diferencial de la tienda o del producto cuando exista, sin hablar mal de la competencia ni hacer afirmaciones sin fundamento.

No presiones al cliente para comprar. Evita insistir repetidamente, generar sensación de culpa o utilizar tácticas agresivas. Si el cliente no está interesado, respeta su decisión.

Cuando existan varias opciones, ayuda al cliente a elegir la más adecuada según sus necesidades en lugar de intentar vender siempre la más cara.

Siempre que sea natural, finaliza la respuesta con una pregunta que mantenga la conversación, por ejemplo para conocer la necesidad del cliente, confirmar una característica importante o facilitar el siguiente paso hacia la compra.

Mantén un tono cercano, profesional y seguro. Evita mensajes excesivamente largos o con apariencia de publicidad. La conversación debe sentirse natural y útil.

No inventes descuentos, promociones, disponibilidad, urgencia, escasez, testimonios, garantías o cualquier otro dato comercial que no haya sido proporcionado por la tienda.

El éxito de este modo no consiste en convencer a toda costa, sino en ayudar al cliente a tomar una decisión de compra informada, generando confianza mediante respuestas claras, útiles y orientadas al valor.\n`;
    }

    const systemRulesAndInventory = `${splitRule}${orderNotificationRule}${humanHandoffRule}${marketingInstructionRule}${infoInstitucional}

CATÁLOGO DE PRODUCTOS DISPONIBLES EN LA TIENDA (actualizado en tiempo real desde la base de datos):
${inventarioTexto}`.trim();

    // ─── ENSAMBLAJE FINAL CON INYECCIÓN DE IDENTIDAD E INSTRUCCIONES EN LA CÚSPIDE ───
    const mainInstructions = (tenantDetails?.botRole || tenantDetails?.customPrompt || 'Eres un asistente virtual de ventas amable, atento y amigable.').trim();
    const mainInstructionsHeader = `IDENTIDAD E INSTRUCCIONES PRINCIPALES DEL BOT:\n${mainInstructions}\n\n`;

    const systemPrompt = `${mainInstructionsHeader}${globalGuardrails}\n\n${systemRulesAndInventory}`;

    console.log(`🤖 [GPT-4o-mini] Generando respuesta de IA para +${clientNumber}...`);

    try {
      axios.post(
        `${evoUrl}/chat/sendPresence/${instance}`,
        {
          number: remoteJid,
          presence: "composing",
          delay: 2000
        },
        getEvoHeaders()
      ).catch(err => {});
    } catch {}

    const aiResponse = await generateAIResponse(
      systemPrompt, 
      [{ role: 'user', content: userMessageText }],
      imageBase64,
      clientNumber,
      customer.preferences
    );

    if (!aiResponse || aiResponse === '...') {
      return;
    }

    if (aiResponse.trim() === '[BAN_USER]') {
      console.log(`👥 [Auto-Pausa Human Handoff] Lenguaje inapropiado detectado para +${clientNumber}. Pausando bot...`);
      if (contact && !contact.botPaused) {
        await prisma.contact.update({ where: { id: contact.id }, data: { botPaused: true } });
      }
      if (chat && !chat.botPaused) {
        await prisma.chat.update({ where: { id: chat.id }, data: { botPaused: true } });
      }
      if (customer && !customer.isBotPaused) {
        await prisma.customer.update({ where: { id: customer.id }, data: { isBotPaused: true } });
      }
      if (reqIo) {
        reqIo.emit('contact_updated', { contactId: contact?.id, phone: clientNumber, botPaused: true, reason: 'PROFANITY' });
        reqIo.emit('bot_status_changed', { contactId: contact?.id, phone: clientNumber, botPaused: true });
      }
      return;
    }

    const mediaRegex = /\[MEDIA:\s*(.+?)\]/g;
    const mediaUrls = [];
    let match;
    while ((match = mediaRegex.exec(aiResponse)) !== null) {
      if (match[1]) {
        const urls = match[1].split(',').map(url => url.trim());
        mediaUrls.push(...urls);
      }
    }

    const saveMemRegex = /\[SAVE_MEM:\s*(.+?)\]/g;
    const newMemories = [];
    let memMatch;
    while ((memMatch = saveMemRegex.exec(aiResponse)) !== null) {
      if (memMatch[1]) {
        newMemories.push(memMatch[1].trim());
      }
    }

    // ─── DETECCIÓN DE TRANSFERENCIA A HUMANO [HUMAN_HANDOFF: ...] (AUTO-PAUSA) ───
    const handoffRegex = /\[HUMAN_HANDOFF:\s*([\s\S]+?)\]/g;
    const handoffMatches = [];
    let handoffMatch;
    while ((handoffMatch = handoffRegex.exec(aiResponse)) !== null) {
      if (handoffMatch[1]) {
        handoffMatches.push(handoffMatch[1].trim());
      }
    }

    if (handoffMatches.length > 0) {
      // 1. Pausar el Bot en PostgreSQL para este contacto (Auto-Pausa)
      if (contact && !contact.botPaused) {
        await prisma.contact.update({ where: { id: contact.id }, data: { botPaused: true } });
      }
      if (chat && !chat.botPaused) {
        await prisma.chat.update({ where: { id: chat.id }, data: { botPaused: true } });
      }
      if (customer && !customer.isBotPaused) {
        await prisma.customer.update({ where: { id: customer.id }, data: { isBotPaused: true } });
      }

      // 2. Emitir eventos por WebSocket en tiempo real para el Dashboard (Live Chat CRM)
      if (reqIo) {
        reqIo.emit('contact_updated', { contactId: contact?.id, phone: clientNumber, botPaused: true, reason: 'HUMAN_HANDOFF' });
        reqIo.emit('bot_status_changed', { contactId: contact?.id, phone: clientNumber, botPaused: true });
      }

      // 3. Enviar notificación por WhatsApp si el tenant tiene configurado teléfono de alertas
      const rawDestPhone = await resolveNotificationPhone(tenant.id, tenantDetails);
      const destPhone = sanitizePhoneForEvo(rawDestPhone);
      if (destPhone) {
        for (const reason of handoffMatches) {
          const alertMessage = `🚨 *ALERTA DE ASESOR REQUERIDO* 🚨\nEl cliente *+${clientNumber}* requiere atención de un asesor humano.\n*Motivo / Último mensaje:* ${reason}\n¡Por favor, entra al chat y atiéndelo!`;
          try {
            await axios.post(
              `${evoUrl}/message/sendText/${instance}`,
              {
                number: destPhone,
                text: alertMessage,
              },
              getEvoHeaders(requestApiKey)
            );
            console.log(`🚨 [Human Handoff] Alerta enviada a ${destPhone} para cliente +${clientNumber}`);
          } catch (errHandoff) {
            console.error(`❌ [Human Handoff] Error al enviar alerta a ${destPhone}:`, errHandoff.response?.data || errHandoff.message);
          }
        }
      }
    }

    // ─── DETECCIÓN DE CONFIRMACIÓN DE VENTA/PEDIDO [ORDER_CONFIRMED: ...] ───
    const orderRegex = /\[ORDER_CONFIRMED:\s*([\s\S]+?)\]/g;
    const orderSummaries = [];
    let orderMatch;
    while ((orderMatch = orderRegex.exec(aiResponse)) !== null) {
      if (orderMatch[1]) {
        orderSummaries.push(orderMatch[1].trim());
      }
    }

    if (orderSummaries.length > 0 && tenantDetails?.notifySalesWhatsApp === true) {
      const rawDestPhone = await resolveNotificationPhone(tenant.id, tenantDetails);
      const destPhone = sanitizePhoneForEvo(rawDestPhone);
      if (destPhone) {
        for (const summary of orderSummaries) {
          const notificationText = `🚨 *NUEVO PEDIDO CONFIRMADO por IA*\n\n📱 *Cliente:* +${clientNumber} (${customer.name || 'Sin Nombre'})\n📋 *Resumen:* ${summary}\n\n⚡ _Velion Agent Auto-Notification_`;
          try {
            await axios.post(
              `${evoUrl}/message/sendText/${instance}`,
              {
                number: destPhone,
                text: notificationText,
              },
              getEvoHeaders(requestApiKey)
            );
            console.log(`📲 [Notificación de Venta] Enviada exitosamente a ${destPhone}`);
          } catch (notifyErr) {
            console.error(`❌ [Notificación de Venta] Error al enviar a ${destPhone}:`, notifyErr.response?.data || notifyErr.message);
          }
        }
      }
    }

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

    const cleanText = aiResponse
      .replace(mediaRegex, '')
      .replace(saveMemRegex, '')
      .replace(orderRegex, '')
      .replace(handoffRegex, '')
      .trim();

    if (cleanText) {
      const finalCleanNumber = clientNumber.replace(/[^0-9]/g, '');
      const isMultiMsg = tenantDetails?.multiMessageMode !== false;

      if (isMultiMsg) {
        // Modo Conversación Humana ACTIVO: Dividir por [SPLIT] y enviar con pausa entre mensajes
        const messageSegments = cleanText
          .split('[SPLIT]')
          .map(segment => segment.trim())
          .filter(segment => segment.length > 0);

        console.log(`📤 [Evolution API] Modo Multi-Mensaje: enviando ${messageSegments.length} segmento(s) a ${finalCleanNumber}...`);

        const evoSendUrl = `${evoUrl}/message/sendText/${instance}`;

        for (let i = 0; i < messageSegments.length; i++) {
          const msgSegment = messageSegments[i];
          try {
            const sendRes = await axios.post(
              evoSendUrl,
              { number: finalCleanNumber, text: msgSegment, options: { delay: 0 } },
              getEvoHeaders(requestApiKey)
            );
            const msgId = sendRes.data?.key?.id;
            if (msgId) markMessageAsSentByAi(msgId);
            markMessageAsSentByAi(msgSegment);

            console.log(`✅ [Evolution API] Segmento ${i + 1}/${messageSegments.length} enviado: "${msgSegment}"`);
          } catch (sendErr) {
            console.error(`❌ [Evolution API] Error al enviar segmento ${i + 1}:`, sendErr.response?.data || sendErr.message);
          }

          await prisma.message.create({
            data: { content: msgSegment, senderRole: 'agent', chatId: chat.id, tenantId: tenant.id }
          });

          if (reqIo) {
            reqIo.emit('new_whatsapp_message', {
              chatId: chat.id, remoteJid, text: msgSegment, type: 'outgoing', timestamp: new Date()
            });
          }

          // Pausa de 2.5 segundos entre segmentos para simular escritura humana
          if (i < messageSegments.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2500));
          }
        }
      } else {
        // Modo Conversación Humana DESACTIVADO: Limpiar etiquetas [SPLIT] y enviar 1 solo bloque
        const singleMessage = cleanText
          .replace(/\[SPLIT\]/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim();

        console.log(`📤 [Evolution API] Modo Mensaje Único: enviando respuesta completa a ${finalCleanNumber}...`);

        try {
          const sendRes = await axios.post(
            `${evoUrl}/message/sendText/${instance}`,
            { number: finalCleanNumber, text: singleMessage, options: { delay: 0 } },
            getEvoHeaders(requestApiKey)
          );
          const msgId = sendRes.data?.key?.id;
          if (msgId) markMessageAsSentByAi(msgId);
          markMessageAsSentByAi(singleMessage);

          console.log(`✅ [Evolution API] Mensaje único enviado a ${finalCleanNumber}: "${singleMessage}"`);
        } catch (sendErr) {
          console.error(`❌ [Evolution API] Error al enviar mensaje único:`, sendErr.response?.data || sendErr.message);
        }

        await prisma.message.create({
          data: { content: singleMessage, senderRole: 'agent', chatId: chat.id, tenantId: tenant.id }
        });

        if (reqIo) {
          reqIo.emit('new_whatsapp_message', {
            chatId: chat.id,
            remoteJid,
            text: singleMessage,
            type: 'outgoing',
            timestamp: new Date()
          });
        }
      }
    }

    for (const url of mediaUrls) {
      if (url && url !== 'Sin imagen') {
        try {
          await axios.post(
            `${evoUrl}/message/sendMedia/${instance}`,
            {
              number: finalCleanNumber,
              mediatype: "image",
              media: url,
              caption: "Imagen de producto"
            },
            getEvoHeaders(requestApiKey)
          );
          console.log(`✅ [Evolution API] Multimedia enviado a ${finalCleanNumber}`);

          await prisma.message.create({
            data: {
              content: `[Imagen]: ${url}`,
              senderRole: 'agent',
              chatId: chat.id,
              tenantId: tenant.id
            }
          });

          if (reqIo) {
            reqIo.emit('new_whatsapp_message', {
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
  } catch (error) {
    console.error('❌ Error en el procesamiento del buffer de mensajes:', error.message);
  }
}
