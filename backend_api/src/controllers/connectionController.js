import axios from 'axios';
import prisma from '../db.js';
import { validateAndRegisterWhatsAppConnection } from '../services/antiFraudService.js';

/**
 * Helper para generar los headers de autenticación de Evolution API
 */
function getEvoHeaders() {
  return {
    headers: {
      apikey: process.env.EVOLUTION_API_KEY || 'A59F9002-9FFF-41CF-8EA6-58AEEB06ED7B',
      'Content-Type': 'application/json',
    },
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
  const messageStr = typeof errorObj === 'string' ? errorObj : JSON.stringify(errorObj);
  const lowerMessageStr = messageStr.toLowerCase();
  return keywords.some(keyword => lowerMessageStr.includes(keyword.toLowerCase()));
}

/**
 * GET /api/connections/status
 * Consulta si la instancia está conectada o desconectada
 */
export async function getStatus(req, res) {
  try {
    const tenantId = req.user.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    const instanceName = getEvoInstanceName(tenantId);
    const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';

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
          status: 'close',
          instanceName,
          phone: null,
          error: validation.errorMessage,
        });
      }
    }

    return res.json({
      status: state === 'open' ? 'open' : 'close',
      instanceName,
      phone,
    });
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return res.json({
        status: 'close',
        instanceName: getEvoInstanceName(req.user.tenantId),
        phone: null,
      });
    }
    console.error("❌ [Connections Controller] Error al obtener estado:", error.response?.data || error.message);
    return res.json({
      status: 'close',
      instanceName: getEvoInstanceName(req.user.tenantId),
      error: 'Evolution API no responde.',
    });
  }
}

/**
 * GET /api/connections/qr
 * Obtiene el código QR en base64 para vincular el dispositivo
 */
export async function getQrCode(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.', message: 'El usuario no está asociado a ningún Tenant.' });
    }

    const instanceName = getEvoInstanceName(tenantId);
    const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';

    // 0. Verificar primero si la instancia ya se encuentra conectada (state === open)
    try {
      const stateRes = await axios.get(
        `${evoUrl}/instance/connectionState/${instanceName}`,
        getEvoHeaders()
      );
      if (stateRes.data?.instance?.state === 'open') {
        return res.status(200).json({
          status: 'open',
          message: 'La instancia ya está conectada y activa.',
          phone: stateRes.data?.instance?.phone || null,
        });
      }
    } catch (stateErr) {
      // Si falla o no existe, continuamos con el flujo normal de generación de QR
    }

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

      if (!isAlreadyInUse) {
        console.error('❌ Error al crear la instancia en Evolution API:', createError.response?.data || createError.message);
      }
    }

    // 1.5. Configurar el webhook en Evolution API
    try {
      await axios.post(
        `${evoUrl}/webhook/set/${instanceName}`,
        {
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
    } catch (webhookError) {
      console.error('🚨 Error al configurar webhook:', webhookError.message);
    }

    // 2. Solicitar el código QR de conexión
    let connectRes;
    try {
      connectRes = await axios.get(
        `${evoUrl}/instance/connect/${instanceName}`,
        getEvoHeaders()
      );
    } catch (connectError) {
      // Si devolvió 404 porque la instancia no existe en Evolution API, la creamos de nuevo e reintentamos
      if (connectError.response?.status === 404) {
        try {
          await axios.post(
            `${evoUrl}/instance/create`,
            { instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' },
            getEvoHeaders()
          );
          connectRes = await axios.get(
            `${evoUrl}/instance/connect/${instanceName}`,
            getEvoHeaders()
          );
        } catch (retryErr) {
          console.error('❌ Error en reintento de conexión:', retryErr.response?.data || retryErr.message);
          throw connectError;
        }
      } else {
        throw connectError;
      }
    }

    const qrBase64 = connectRes.data?.base64 || connectRes.data?.qrcode?.base64 || connectRes.data?.code || null;

    if (!qrBase64) {
      const lowerDataStr = JSON.stringify(connectRes.data || {}).toLowerCase();
      const isAlreadyConnected = lowerDataStr.includes('already connected') || 
                                 lowerDataStr.includes('connected') || 
                                 lowerDataStr.includes('open');

      if (isAlreadyConnected) {
        return res.status(200).json({
          status: 'open',
          message: 'La instancia ya está conectada y activa.',
        });
      }

      return res.status(400).json({ error: 'No se pudo generar el código QR de vinculación.', message: 'No se pudo generar el código QR de vinculación.' });
    }

    return res.json({
      qr: qrBase64,
    });
  } catch (error) {
    const errorMsg = error.response?.data || error.message || '';
    const isAlreadyConnected = (error.response?.status === 400 || error.response?.status === 403) && 
                               containsKeywords(errorMsg, ['already connected', 'connected', 'open', 'conectada']);

    if (isAlreadyConnected) {
      return res.status(200).json({
        status: 'open',
        message: 'La instancia ya está conectada y activa.',
      });
    }

    console.error('❌ Error al obtener código QR:', error.response?.data || error.message);
    const detailMsg = error.code === 'ECONNREFUSED' 
      ? 'No se pudo conectar con el servidor de WhatsApp (Evolution API no responde).' 
      : (error.response?.data?.message || error.message || 'Error al comunicarse con el servidor de WhatsApp.');

    return res.status(500).json({
      error: detailMsg,
      message: detailMsg
    });
  }
}

/**
 * POST /api/connections/logout
 * Cierra la sesión activa y destruye por completo la instancia en Evolution API
 * eliminando cualquier instancia zombi y limpiando registros en la BD.
 */
export async function logoutDevice(req, res) {
  try {
    const tenantId = req.user.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    const instanceName = getEvoInstanceName(tenantId);
    const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';

    // 1. Petición HTTP DELETE a Evolution API para cerrar sesión (logout)
    try {
      await axios.delete(
        `${evoUrl}/instance/logout/${instanceName}`,
        getEvoHeaders()
      );
      console.log(`🔌 [Evolution API] Logout exitoso para instancia: ${instanceName}`);
    } catch (logoutError) {
      console.log(`ℹ️ [Evolution API] Logout aviso/ya desvinculado (${logoutError.response?.status || 'network error'}):`, logoutError.response?.data || logoutError.message);
    }

    // 2. Petición HTTP DELETE a Evolution API para destruir la instancia por completo
    try {
      await axios.delete(
        `${evoUrl}/instance/delete/${instanceName}`,
        getEvoHeaders()
      );
      console.log(`🗑️ [Evolution API] Instancia destruida totalmente: ${instanceName}`);
    } catch (deleteError) {
      if (deleteError.response && (deleteError.response.status === 404 || deleteError.response.status === 400)) {
        console.log(`ℹ️ [Evolution API] Instancia "${instanceName}" ya no existía en el servidor (404/400).`);
      } else {
        console.warn(`⚠️ Error de respuesta al eliminar instancia en Evolution API:`, deleteError.response?.data || deleteError.message);
      }
    }

    // Nota: prisma.whatsappConnection no existe en el schema actual.
    // La limpieza de conexiones se gestiona a través de RegisteredWhatsAppNumber.

    return res.json({
      status: 'DISCONNECTED',
      message: 'Instancia destruida y sesión de WhatsApp eliminada por completo.'
    });
  } catch (error) {
    console.error("❌ Error al desconectar/destruir dispositivo:", error.response?.data || error.message);
    return res.status(500).json({ error: 'Error al desconectar el dispositivo.' });
  }
}
