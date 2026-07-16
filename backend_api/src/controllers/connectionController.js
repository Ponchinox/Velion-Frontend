import axios from 'axios';
import prisma from '../db.js';

/**
 * Helper para generar los headers de autenticación de Evolution API
 */
function getEvoHeaders() {
  return {
    headers: {
      apikey: process.env.EVOLUTION_API_KEY || 'bot_clave_maestra_2026',
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

    return res.json({
      status: state === 'open' ? 'open' : 'close',
      instanceName,
      phone: response.data?.instance?.phone || null,
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

      if (!isAlreadyInUse) {
        console.error('❌ Error al crear la instancia en Evolution API:', createError.response?.data || createError.message);
      }
    }

    // 1.5. Configurar el webhook en Evolution API
    try {
      const webhookUrl = process.env.WEBHOOK_URL || 'http://host.docker.internal:3000/api/whatsapp/webhook';
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
    } catch (webhookError) {
      console.error('🚨 Error al configurar webhook:', webhookError.message);
    }

    // 2. Solicitar el código QR de conexión
    const connectRes = await axios.get(
      `${evoUrl}/instance/connect/${instanceName}`,
      getEvoHeaders()
    );

    const qrBase64 = connectRes.data?.base64 || connectRes.data?.qrcode?.base64 || null;

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

      return res.status(400).json({ error: 'No se pudo generar el código QR de vinculación.' });
    }

    return res.json({
      qr: qrBase64,
    });
  } catch (error) {
    const errorMsg = error.response?.data || error.message || '';
    const isAlreadyConnected = error.response?.status === 400 && 
                               containsKeywords(errorMsg, ['already connected', 'connected', 'open', 'conectada']);

    if (isAlreadyConnected) {
      return res.status(200).json({
        status: 'open',
        message: 'La instancia ya está conectada y activa.',
      });
    }

    console.error('❌ Error al obtener código QR:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Error interno al comunicarse con Evolution API.' });
  }
}

/**
 * POST /api/connections/logout
 * Cierra la sesión activa de WhatsApp
 */
export async function logoutDevice(req, res) {
  try {
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
    } catch (logoutError) {
      if (logoutError.response && logoutError.response.status === 404) {
        return res.json({ message: 'Sesión de WhatsApp cerrada con éxito.' });
      }
      throw logoutError;
    }

    return res.json({ message: 'Sesión de WhatsApp cerrada con éxito.' });
  } catch (error) {
    console.error("❌ Error al desconectar dispositivo:", error.response?.data || error.message);
    return res.status(500).json({ error: 'Error al desconectar el dispositivo.' });
  }
}
