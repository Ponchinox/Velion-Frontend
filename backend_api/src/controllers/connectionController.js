import axios from 'axios';
import prisma from '../db.js';
import { validateAndRegisterWhatsAppConnection } from '../services/antiFraudService.js';

/**
 * POST /api/connections/meta
 * Guarda o actualiza las credenciales de Meta Cloud API para el Tenant.
 * Crea o actualiza el registro en RegisteredWhatsAppNumber con provider='META'.
 */
export async function saveMeta(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    const { metaPhoneNumberId, metaWabaId, metaAccessToken, phoneNumber } = req.body;

    if (!metaPhoneNumberId || !metaWabaId || !metaAccessToken) {
      return res.status(400).json({
        error: 'Faltan campos requeridos: metaPhoneNumberId, metaWabaId y metaAccessToken son obligatorios.',
      });
    }

    // Buscar registro previo del tenant con proveedor META
    const existing = await prisma.registeredWhatsAppNumber.findFirst({
      where: { tenantId, provider: 'META' },
    });

    const phoneLabel = phoneNumber || metaPhoneNumberId;

    let record;
    if (existing) {
      // Actualizar credenciales existentes
      record = await prisma.registeredWhatsAppNumber.update({
        where: { id: existing.id },
        data: {
          phoneNumber: phoneLabel,
          metaPhoneNumberId,
          metaWabaId,
          metaAccessToken,
          updatedAt: new Date(),
        },
      });
      console.log(`✅ [Meta Connection] Credenciales actualizadas para Tenant: ${tenantId}`);
    } else {
      // Crear nuevo registro Meta
      record = await prisma.registeredWhatsAppNumber.create({
        data: {
          phoneNumber: phoneLabel,
          provider: 'META',
          metaPhoneNumberId,
          metaWabaId,
          metaAccessToken,
          tenantId,
        },
      });
      console.log(`✅ [Meta Connection] Nueva conexión Meta registrada para Tenant: ${tenantId}`);
    }

    return res.json({
      success: true,
      message: 'Conexión con Meta Cloud API guardada correctamente.',
      provider: 'META',
      phoneNumberId: record.metaPhoneNumberId,
    });
  } catch (error) {
    console.error('❌ [Meta Connection] Error al guardar credenciales Meta:', error.message);
    return res.status(500).json({ error: 'Error interno al guardar la conexión de Meta.' });
  }
}

/**
 * GET /api/connections/provider
 * Retorna el proveedor activo y metadatos de la conexión del Tenant.
 */
export async function getProvider(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Sin Tenant.' });

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { connLimit: true }
    });

    const connections = await prisma.registeredWhatsAppNumber.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        phoneNumber: true,
        metaPhoneNumberId: true,
        metaWabaId: true,
        instanceName: true,
        // metaAccessToken intencionalmente omitido por seguridad
      },
    });

    const activeConnectionsCount = connections.length;

    return res.json({
      connections,
      // Mantenemos estos campos para compatibilidad por si alguna otra parte del código los espera del primer registro
      provider: connections[0]?.provider || 'EVOLUTION',
      phoneNumber: connections[0]?.phoneNumber || null,
      metaPhoneNumberId: connections[0]?.metaPhoneNumberId || null,
      metaWabaId: connections[0]?.metaWabaId || null,
      connLimit: tenant?.connLimit || 1,
      activeConnectionsCount,
    });
  } catch (error) {
    console.error('❌ [Provider] Error al obtener proveedor:', error.message);
    return res.status(500).json({ error: 'Error al obtener información del proveedor.' });
  }
}

/**
 * Helper para generar los headers de autenticación de Evolution API
 */
function getEvoHeaders() {
  return {
    headers: {
      apikey: process.env.EVOLUTION_API_KEY || '',
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

    let instanceName = req.query.instanceName;
    if (!instanceName) {
      // Fallback para legacy o chequeo general
      instanceName = getEvoInstanceName(tenantId);
    }
    const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';

    const response = await axios.get(
      `${evoUrl}/instance/connectionState/${instanceName}`,
      getEvoHeaders()
    );

    const state = response.data?.instance?.state || 'close';
    let phone = response.data?.instance?.phone || null;

    if (state === 'open') {
      // Intentar obtener el teléfono de la DB si Evolution API no lo devuelve en connectionState
      if (!phone) {
        const registered = await prisma.registeredWhatsAppNumber.findFirst({
          where: { instanceName }
        });
        if (registered) {
          phone = registered.phoneNumber;
        }
      }

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

    let instanceName = req.query.instanceName;

    // Si no pasan un instanceName específico (por ejemplo, para generar una nueva conexión),
    // verificamos primero las instancias registradas en la DB.
    // Si queremos obligar a crear una nueva, la UI no pasaría instanceName.
    if (!instanceName) {
      instanceName = `bot_prod_${tenantId.slice(0, 8)}_${Date.now()}`;
    }

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
          instanceName
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
              "MESSAGES_UPSERT",
              "CONNECTION_UPDATE"
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

    // El webhook ya se configuró durante la creación de la instancia.
    // No es necesario volver a llamar a /webhook/set/ aquí.

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
      instanceName
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

    const { instanceName: bodyInstanceName, connectionId, provider } = req.body;
    const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';

    // Determinar qué instancia de Evolution eliminar (solo aplica para EVOLUTION)
    const instanceName = bodyInstanceName || (provider !== 'META' ? getEvoInstanceName(tenantId) : null);

    // Solo hacer logout/delete en Evolution API si el proveedor es EVOLUTION
    if (provider !== 'META' && instanceName) {
      // 1. Logout en Evolution API
      try {
        await axios.delete(
          `${evoUrl}/instance/logout/${instanceName}`,
          getEvoHeaders()
        );
        console.log(`🔌 [Evolution API] Logout exitoso para instancia: ${instanceName}`);
      } catch (logoutError) {
        console.log(`ℹ️ [Evolution API] Logout aviso (${logoutError.response?.status || 'network error'}):`, logoutError.response?.data || logoutError.message);
      }

      // 2. Destruir instancia en Evolution API
      try {
        await axios.delete(
          `${evoUrl}/instance/delete/${instanceName}`,
          getEvoHeaders()
        );
        console.log(`🗑️ [Evolution API] Instancia destruida totalmente: ${instanceName}`);
      } catch (deleteError) {
        if (deleteError.response && (deleteError.response.status === 404 || deleteError.response.status === 400)) {
          console.log(`ℹ️ [Evolution API] Instancia "${instanceName}" ya no existía (404/400).`);
        } else {
          console.warn(`⚠️ Error al eliminar instancia en Evolution API:`, deleteError.response?.data || deleteError.message);
        }
      }
    }

    // 3. Eliminar el registro en la DB:
    //    Prioridad: por connectionId (ID exacto del registro) > por instanceName > fallback borra todos
    if (connectionId) {
      // Verificar que el registro pertenece a este tenant (seguridad)
      await prisma.registeredWhatsAppNumber.deleteMany({
        where: { id: connectionId, tenantId }
      });
      console.log(`🗑️ [DB] Registro de conexión eliminado por ID: ${connectionId}`);
    } else if (instanceName) {
      await prisma.registeredWhatsAppNumber.deleteMany({
        where: { tenantId, instanceName }
      });
      console.log(`🗑️ [DB] Registro de conexión eliminado por instanceName: ${instanceName}`);
    } else {
      // Fallback legacy: eliminar todos los del tenant
      await prisma.registeredWhatsAppNumber.deleteMany({
        where: { tenantId }
      });
      console.log(`🗑️ [DB] Todos los registros del tenant ${tenantId} eliminados (fallback).`);
    }

    return res.json({
      status: 'DISCONNECTED',
      message: 'Instancia destruida y sesión de WhatsApp eliminada por completo.'
    });
  } catch (error) {
    console.error("❌ Error al desconectar/destruir dispositivo:", error.response?.data || error.message);
    return res.status(500).json({ error: 'Error al desconectar el dispositivo.' });
  }
}
