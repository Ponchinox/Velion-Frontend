import axios from 'axios';
import prisma from '../db.js';
import { validateAndRegisterWhatsAppConnection } from '../services/antiFraudService.js';
import { determineReconciliationUpdates, applyReconciliationUpdates } from '../utils/connectionSyncLogic.js';

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

    let connections = await prisma.registeredWhatsAppNumber.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        phoneNumber: true,
        metaPhoneNumberId: true,
        metaWabaId: true,
        instanceName: true,
        connectionState: true,
        connectionStateUpdatedAt: true
      },
    });

    // ── RECONCILIACIÓN DEFENSIVA ──
    const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
    const headers = getEvoHeaders();

    const fetchEvolutionState = async (conn) => {
      try {
        const stateRes = await axios.get(`${evoUrl}/instance/connectionState/${conn.instanceName}`, {
          ...headers,
          timeout: 4000
        });
        return { state: stateRes.data?.instance?.state };
      } catch (err) {
        throw { status: err.response?.status || 500 };
      }
    };

    const updates = await determineReconciliationUpdates(connections, fetchEvolutionState);
    await applyReconciliationUpdates(updates, prisma);

    const activeConnectionsCount = connections.length;

    return res.json({
      connections,
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
  return `bot_prod_${tenantId}`;
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
 * POST /api/connections/meta/connect
 *
 * Crea una instancia en Evolution API configurada para WhatsApp Cloud (Meta oficial)
 * e inyecta los 3 credenciales nativamente. No se valida contra Graph API directamente —
 * Evolution maneja la autenticación con Meta de forma interna.
 *
 * Body: { metaPhoneNumberId, metaWabaId, metaAccessToken, phoneNumber, connectionName? }
 */
export async function createMetaInstance(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    const {
      metaPhoneNumberId,
      metaWabaId,
      metaAccessToken,
      phoneNumber,
      connectionName,
    } = req.body;

    if (!metaPhoneNumberId || !metaWabaId || !metaAccessToken || !phoneNumber) {
      return res.status(400).json({
        error: 'Faltan campos requeridos: metaPhoneNumberId, metaWabaId, metaAccessToken y phoneNumber son obligatorios.',
      });
    }

    const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
    const baseUrl = process.env.APP_URL || 'https://velion-backend-a7vw.onrender.com';
    const rawWebhookUrl = process.env.WEBHOOK_URL || `${baseUrl.replace(/\/$/, '')}/api/whatsapp/webhook`;
    const cleanApiKey = (process.env.EVOLUTION_API_KEY || '').trim();
    const apiKeyParam = cleanApiKey ? `?apikey=${cleanApiKey}` : '';
    const webhookUrl = rawWebhookUrl.includes('?')
      ? `${rawWebhookUrl}&apikey=${cleanApiKey}`
      : `${rawWebhookUrl}${apiKeyParam}`;

    // ── 0. Verificar si ya existe registro Meta para este tenant ─────────────────
    const existing = await prisma.registeredWhatsAppNumber.findFirst({
      where: { tenantId, provider: 'META' },
    });

    // ── Nombre de instancia para Meta: reutilizar si ya existe (legacy o nuevo), o generar con UUID completo si es nuevo ──
    const instanceName = existing?.instanceName || `bot_meta_${tenantId}`;

    // ── Payload exacto que se envía a Evolution API ───────────────────────
    const evolutionPayload = {
      instanceName,
      integration:   'WHATSAPP-BUSINESS',
      token:         '',                // Evolution usa accessToken, no token interno
      number:        phoneNumber.replace(/\D/g, ''), // Solo dígitos (ej. 51987654321)
      businessId:    metaWabaId,
      phoneNumberId: metaPhoneNumberId,
      accessToken:   metaAccessToken,
      qrcode:        false,
      webhook: {
        enabled:         true,
        url:             webhookUrl,
        byEvents:        false,
        webhookByEvents: false,
        events:          ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
      },
    };

    console.log(`🔵 [Meta Instance] Creando instancia Evolution para tenant ${tenantId}:`, {
      instanceName,
      integration: 'WHATSAPP-BUSINESS',
      number: evolutionPayload.number,
      businessId: metaWabaId,
      // accessToken omitido del log por seguridad
    });

    // ── 1. Verificar si ya existe la instancia en Evolution → si sí, eliminarla primero ──
    try {
      await axios.delete(`${evoUrl}/instance/delete/${instanceName}`, getEvoHeaders());
      console.log(`🗑️  [Meta Instance] Instancia previa eliminada: ${instanceName}`);
    } catch (delErr) {
      // 404 es normal (no existía), otros errores los ignoramos y continuamos
      if (delErr.response?.status !== 404) {
        console.warn(`⚠️  [Meta Instance] Aviso al eliminar instancia previa:`, delErr.response?.data || delErr.message);
      }
    }

    // ── 2. Crear la instancia con integración WHATSAPP-BUSINESS ──────────
    try {
      const createRes = await axios.post(
        `${evoUrl}/instance/create`,
        evolutionPayload,
        getEvoHeaders()
      );
      console.log(`✅ [Meta Instance] Instancia creada en Evolution:`, createRes.data?.instance?.instanceName || instanceName);
    } catch (createErr) {
      const errData = createErr.response?.data;
      const errMsg  = errData?.message || errData?.error || createErr.message;
      console.error(`❌ [Meta Instance] Evolution rechazó la creación:`, errData || createErr.message);

      return res.status(502).json({
        error: `Evolution API rechazó la instancia Meta: ${errMsg}`,
        details: errData || null,
      });
    }

    // ── 3. Guardar / actualizar registro en la BD ─────────────────────────
    let record;
    if (existing) {
      record = await prisma.registeredWhatsAppNumber.update({
        where: { id: existing.id },
        data: {
          phoneNumber:        phoneNumber.replace(/\D/g, ''),
          metaPhoneNumberId,
          metaWabaId,
          metaAccessToken,
          instanceName,
          updatedAt: new Date(),
        },
      });
      console.log(`✅ [Meta Instance] Registro DB actualizado para tenant: ${tenantId}`);
    } else {
      record = await prisma.registeredWhatsAppNumber.create({
        data: {
          phoneNumber:        phoneNumber.replace(/\D/g, ''),
          provider:           'META',
          metaPhoneNumberId,
          metaWabaId,
          metaAccessToken,
          instanceName,
          tenantId,
        },
      });
      console.log(`✅ [Meta Instance] Nuevo registro DB creado para tenant: ${tenantId}`);
    }

    return res.json({
      success:      true,
      message:      'Instancia de WhatsApp Cloud API creada en Evolution y registrada correctamente.',
      provider:     'META',
      instanceName: record.instanceName,
      phoneNumber:  record.phoneNumber,
    });

  } catch (error) {
    console.error('❌ [Meta Instance] Error inesperado:', error.message);
    return res.status(500).json({ error: 'Error interno al crear la instancia Meta en Evolution.' });
  }
}

/**
 * GET /api/connections/status
 * Consulta si la instancia está conectada o desconectada
 */
export async function getStatus(req, res) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
  }

  let effectiveInstanceName = req.query.instanceName;
  if (!effectiveInstanceName) {
    try {
      const existingConn = await prisma.registeredWhatsAppNumber.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        select: { instanceName: true }
      });
      effectiveInstanceName = existingConn?.instanceName || getEvoInstanceName(tenantId);
    } catch (dbErr) {
      console.error('⚠️ [Connections Controller] Error buscando conexión en BD para getStatus:', dbErr.message);
      effectiveInstanceName = getEvoInstanceName(tenantId);
    }
  }

  const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';

  try {
    const response = await axios.get(
      `${evoUrl}/instance/connectionState/${effectiveInstanceName}`,
      getEvoHeaders()
    );

    const state = response.data?.instance?.state || 'close';
    let phone = response.data?.instance?.phone || null;

    if (state === 'open') {
      if (!phone) {
        const registered = await prisma.registeredWhatsAppNumber.findFirst({
          where: { instanceName: effectiveInstanceName }
        });
        if (registered) {
          phone = registered.phoneNumber;
        }
      }

      const validation = await validateAndRegisterWhatsAppConnection(tenantId, effectiveInstanceName, phone);
      if (!validation.allowed) {
        return res.status(403).json({
          status: 'close',
          instanceName: effectiveInstanceName,
          phone: null,
          error: validation.errorMessage,
        });
      }
    }

    return res.json({
      status: state === 'open' ? 'open' : 'close',
      instanceName: effectiveInstanceName,
      phone,
    });
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return res.json({
        status: 'close',
        instanceName: effectiveInstanceName,
        phone: null,
      });
    }
    console.error('❌ [Connections Controller] Error al obtener estado:', error.response?.data || error.message);
    return res.json({
      status: 'close',
      instanceName: effectiveInstanceName,
      error: 'Evolution API no responde.',
    });
  }
}

/**
 * GET /api/connections/qr
 * Obtiene el código QR en base64 para vincular el dispositivo (solo Baileys/QR)
 */
export async function getQrCode(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.', message: 'El usuario no está asociado a ningún Tenant.' });
    }

    let instanceName = req.query.instanceName;
    if (!instanceName) {
      const existingConn = await prisma.registeredWhatsAppNumber.findFirst({
        where: { tenantId, provider: { not: 'META' } },
        orderBy: { createdAt: 'desc' },
        select: { instanceName: true }
      });
      instanceName = existingConn?.instanceName || `bot_prod_${tenantId}_${Date.now()}`;
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

    // 1. Asegurar la creación previa de la instancia Baileys
    try {
      await axios.post(
        `${evoUrl}/instance/create`,
        {
          instanceName,
          qrcode:      true,
          integration: 'WHATSAPP-BAILEYS',
          webhook: {
            enabled:         true,
            url:             webhookUrl,
            byEvents:        false,
            webhookByEvents: false,
            events:          ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
          }
        },
        getEvoHeaders()
      );
    } catch (createError) {
      const errorMsg    = createError.response?.data || createError.message || '';
      const isAlreadyInUse = createError.response?.status === 403 ||
                             createError.response?.status === 400 ||
                             containsKeywords(errorMsg, ['already in use', 'already exists', 'in use', 'exists', 'registrada']);

      if (!isAlreadyInUse) {
        console.error('❌ Error al crear la instancia en Evolution API:', createError.response?.data || createError.message);
      }
    }

    // 1.5. Configurar el webhook en Evolution API explicitamente (Respaldo)
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
              "MESSAGES_UPSERT",
              "CONNECTION_UPDATE"
            ]
          }
        },
        getEvoHeaders()
      );
      console.log('✅ [Evolution API] Webhook sobrescrito y actualizado con éxito.');
    } catch (webhookError) {
      console.error('❌ Error configurando el Webhook en Evolution:', webhookError?.response?.data || webhookError.message);
    }

    // 2. Solicitar el código QR de conexión
    let connectRes;
    try {
      connectRes = await axios.get(
        `${evoUrl}/instance/connect/${instanceName}`,
        getEvoHeaders()
      );
    } catch (connectError) {
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
        return res.status(200).json({ status: 'open', message: 'La instancia ya está conectada y activa.' });
      }

      return res.status(400).json({ error: 'No se pudo generar el código QR de vinculación.', message: 'No se pudo generar el código QR de vinculación.' });
    }

    return res.json({ qr: qrBase64, instanceName });

  } catch (error) {
    const errorMsg = error.response?.data || error.message || '';
    const isAlreadyConnected = (error.response?.status === 400 || error.response?.status === 403) &&
                               containsKeywords(errorMsg, ['already connected', 'connected', 'open', 'conectada']);

    if (isAlreadyConnected) {
      return res.status(200).json({ status: 'open', message: 'La instancia ya está conectada y activa.' });
    }

    console.error('❌ Error al obtener código QR:', error.response?.data || error.message);
    const detailMsg = error.code === 'ECONNREFUSED'
      ? 'No se pudo conectar con el servidor de WhatsApp (Evolution API no responde).'
      : (error.response?.data?.message || error.message || 'Error al comunicarse con el servidor de WhatsApp.');

    return res.status(500).json({ error: detailMsg, message: detailMsg });
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

    // Determinar qué instancia de Evolution eliminar (reutilizando instanceName persistido si no viene en body)
    let instanceName = bodyInstanceName;
    if (!instanceName) {
      const existingConn = connectionId
        ? await prisma.registeredWhatsAppNumber.findFirst({ where: { id: connectionId, tenantId }, select: { instanceName: true } })
        : await prisma.registeredWhatsAppNumber.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' }, select: { instanceName: true } });
      instanceName = existingConn?.instanceName || (provider !== 'META' ? getEvoInstanceName(tenantId) : null);
    }

    // Para ambos proveedores (EVOLUTION y META) eliminamos la instancia de Evolution
    if (instanceName) {
      // 1. Logout en Evolution API
      try {
        await axios.delete(`${evoUrl}/instance/logout/${instanceName}`, getEvoHeaders());
        console.log(`🔌 [Evolution API] Logout exitoso para instancia: ${instanceName}`);
      } catch (logoutError) {
        console.log(`ℹ️ [Evolution API] Logout aviso (${logoutError.response?.status || 'network error'}):`, logoutError.response?.data || logoutError.message);
      }

      // 2. Destruir instancia en Evolution API
      try {
        await axios.delete(`${evoUrl}/instance/delete/${instanceName}`, getEvoHeaders());
        console.log(`🗑️ [Evolution API] Instancia destruida totalmente: ${instanceName}`);
      } catch (deleteError) {
        if (deleteError.response && (deleteError.response.status === 404 || deleteError.response.status === 400)) {
          console.log(`ℹ️ [Evolution API] Instancia "${instanceName}" ya no existía (404/400).`);
        } else {
          console.warn(`⚠️ Error al eliminar instancia en Evolution API:`, deleteError.response?.data || deleteError.message);
        }
      }
    }

    // 3. Eliminar el registro en la DB
    if (connectionId) {
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
      await prisma.registeredWhatsAppNumber.deleteMany({ where: { tenantId } });
      console.log(`🗑️ [DB] Todos los registros del tenant ${tenantId} eliminados (fallback).`);
    }

    return res.json({
      status:  'DISCONNECTED',
      message: 'Instancia destruida y sesión de WhatsApp eliminada por completo.',
    });
  } catch (error) {
    console.error('❌ Error al desconectar/destruir dispositivo:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Error al desconectar el dispositivo.' });
  }
}
