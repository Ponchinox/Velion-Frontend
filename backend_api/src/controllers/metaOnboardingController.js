/**
 * META ONBOARDING CONTROLLER
 * Maneja el flujo de Embedded Signup v4 para WhatsApp Business App Coexistence.
 *
 * FLUJO:
 *   1. Frontend lanza FB.login() con config_id + extras.coex=true
 *   2. SDK devuelve { code, waba_id, phone_number_id } al callback JS
 *   3. Frontend llama POST /api/connections/meta/onboarding/callback con ese payload
 *   4. Este controller hace el server-side token exchange con Meta Graph API
 *   5. Recupera el número real, guarda en BD, responde al frontend
 *
 * SEGURIDAD:
 *   - tenantId se obtiene EXCLUSIVAMENTE de req.user (JWT verificado por authMiddleware)
 *   - El access_token NUNCA llega al frontend ni a los logs
 *   - El code es de un solo uso (~10 min TTL de Meta)
 */

import axios from 'axios';
import prisma from '../db.js';

const GRAPH_VERSION = 'v20.0';

/**
 * GET /api/connections/meta/onboarding/config
 * Devuelve la configuración pública para inicializar el SDK de Facebook.
 * NO devuelve secretos. Solo App ID, Config ID y versión de Graph.
 */
export async function getMetaOnboardingConfig(req, res) {
  try {
    const appId    = process.env.META_APP_ID;
    const configId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;

    if (!appId || !configId) {
      return res.status(503).json({
        error:       'La integración con Meta no está configurada en este servidor. Contacta al administrador.',
        code:        'META_NOT_CONFIGURED',
        configured:  false,
      });
    }

    return res.json({
      appId,
      configId,
      graphApiVersion: GRAPH_VERSION,
      configured:      true,
    });
  } catch (err) {
    console.error('❌ [Meta Onboarding] Error al obtener configuración:', err.message);
    return res.status(500).json({ error: 'Error interno al obtener configuración Meta.' });
  }
}

/**
 * POST /api/connections/meta/onboarding/callback
 * Recibe el código de autorización del Embedded Signup y completa el flujo server-side.
 *
 * Body: { code: string, wabaId?: string, phoneNumberId?: string }
 */
export async function handleMetaOnboardingCallback(req, res) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    return res.status(400).json({ error: 'Usuario no asociado a ningún Tenant.' });
  }

  const { code, wabaId, phoneNumberId } = req.body;

  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return res.status(400).json({
      error: 'Falta el código de autorización de Meta (code).',
      code:  'META_CODE_MISSING',
    });
  }

  const appId     = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!appId || !appSecret) {
    return res.status(503).json({
      error: 'META_APP_ID o META_APP_SECRET no están configurados en el servidor.',
      code:  'META_NOT_CONFIGURED',
    });
  }

  try {
    // ── PASO 1: Intercambiar código por access_token ──────────────────────────
    let accessToken;
    try {
      const tokenRes = await axios.get(
        `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`,
        {
          params: {
            client_id:     appId,
            client_secret: appSecret,
            code:          code.trim(),
          },
        }
      );
      accessToken = tokenRes.data?.access_token;
      if (!accessToken) {
        throw new Error('Meta no devolvió access_token en el intercambio del código.');
      }
      // ⛔ NUNCA loguear el token
      console.log(`✅ [Meta Onboarding] Token intercambiado con éxito para tenant ${tenantId}.`);
    } catch (exchangeErr) {
      const errMeta = exchangeErr.response?.data?.error;
      console.error('❌ [Meta Onboarding] Fallo en intercambio de código:', errMeta?.message || exchangeErr.message);
      return res.status(502).json({
        error: `Meta rechazó el código: ${errMeta?.message || 'Código inválido o expirado.'}`,
        code:  'META_CODE_EXCHANGE_FAILED',
      });
    }

    // ── PASO 2: Resolver WABA ID ──────────────────────────────────────────────
    // El SDK normalmente lo devuelve en el callback. Si no, lo buscamos via debug_token.
    let resolvedWabaId = wabaId || null;

    if (!resolvedWabaId) {
      try {
        console.log(`🔍 [Meta Onboarding] WABA ID no recibido, consultando debug_token...`);
        const debugRes = await axios.get(
          `https://graph.facebook.com/${GRAPH_VERSION}/debug_token`,
          {
            params: {
              input_token:  accessToken,
              access_token: `${appId}|${appSecret}`,
            },
          }
        );
        const granularScopes = debugRes.data?.data?.granular_scopes || [];
        const wabScope = granularScopes.find(s => s.scope === 'whatsapp_business_management');
        resolvedWabaId = wabScope?.target_ids?.[0] || null;

        if (resolvedWabaId) {
          console.log(`✅ [Meta Onboarding] WABA ID resuelto via debug_token: ${resolvedWabaId}`);
        } else {
          console.warn('⚠️ [Meta Onboarding] debug_token no devolvió WABA ID en granular_scopes.');
        }
      } catch (debugErr) {
        console.error('❌ [Meta Onboarding] Error consultando debug_token:', debugErr.response?.data || debugErr.message);
      }
    }

    if (!resolvedWabaId) {
      return res.status(422).json({
        error: 'No se pudo determinar el WABA ID. Asegúrate de completar el flujo de Embedded Signup.',
        code:  'META_WABA_NOT_FOUND',
      });
    }

    // ── PASO 3: Obtener números de teléfono de la WABA ───────────────────────
    let phoneNumber       = null;
    let finalPhoneNumberId = phoneNumberId || null;

    try {
      const phonesRes = await axios.get(
        `https://graph.facebook.com/${GRAPH_VERSION}/${resolvedWabaId}/phone_numbers`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params:  { fields: 'id,display_phone_number,verified_name,status,quality_rating' },
        }
      );
      const phones = phonesRes.data?.data || [];

      if (phones.length === 0) {
        return res.status(422).json({
          error: 'No se encontraron números de teléfono registrados en la cuenta WABA.',
          code:  'META_NO_PHONES_IN_WABA',
        });
      }

      let selectedPhone;
      if (finalPhoneNumberId) {
        selectedPhone = phones.find(p => p.id === finalPhoneNumberId);
      }
      if (!selectedPhone) {
        selectedPhone      = phones[0];
        finalPhoneNumberId = selectedPhone.id;
      }

      phoneNumber = (selectedPhone.display_phone_number || '').replace(/\D/g, '');
      console.log(`✅ [Meta Onboarding] Número resuelto: +${phoneNumber} (Phone Number ID: ${finalPhoneNumberId})`);
    } catch (phonesErr) {
      const errMeta = phonesErr.response?.data?.error;
      console.error('❌ [Meta Onboarding] Error al consultar phone_numbers:', errMeta || phonesErr.message);
      return res.status(502).json({
        error: `No se pudieron obtener los números de la WABA: ${errMeta?.message || phonesErr.message}`,
        code:  'META_PHONES_FETCH_FAILED',
      });
    }

    if (!phoneNumber) {
      return res.status(422).json({
        error: 'El número de teléfono obtenido de Meta está vacío o es inválido.',
        code:  'META_PHONE_EMPTY',
      });
    }

    // ── PASO 4: Guardar o actualizar en la BD ─────────────────────────────────
    const existing = await prisma.registeredWhatsAppNumber.findFirst({
      where: { tenantId, provider: 'META' },
    });

    let record;
    if (existing) {
      record = await prisma.registeredWhatsAppNumber.update({
        where: { id: existing.id },
        data: {
          phoneNumber:       phoneNumber,
          metaPhoneNumberId: finalPhoneNumberId,
          metaWabaId:        resolvedWabaId,
          metaAccessToken:   accessToken,   // ⛔ Solo en BD, jamás en respuesta
          instanceName:      null,          // Arquitectura META directa, no usa Evolution
          updatedAt:         new Date(),
        },
      });
      console.log(`✅ [Meta Onboarding] Conexión existente actualizada para tenant: ${tenantId}`);
    } else {
      record = await prisma.registeredWhatsAppNumber.create({
        data: {
          phoneNumber:       phoneNumber,
          provider:          'META',
          metaPhoneNumberId: finalPhoneNumberId,
          metaWabaId:        resolvedWabaId,
          metaAccessToken:   accessToken,   // ⛔ Solo en BD, jamás en respuesta
          instanceName:      null,
          tenantId,
        },
      });
      console.log(`✅ [Meta Onboarding] Nueva conexión Meta creada para tenant: ${tenantId}`);
    }

    // ── PASO 5: Responder al frontend SIN exponer el token ────────────────────
    return res.json({
      success:          true,
      message:          'WhatsApp Business conectado exitosamente mediante Meta Cloud API (Embedded Signup).',
      provider:         'META',
      phoneNumber:      record.phoneNumber,
      metaPhoneNumberId: record.metaPhoneNumberId,
      metaWabaId:       record.metaWabaId,
      onboardingMethod: 'EMBEDDED_SIGNUP',
      // metaAccessToken: NEVER included
    });

  } catch (err) {
    console.error('❌ [Meta Onboarding] Error inesperado en callback:', err.message);
    return res.status(500).json({ error: 'Error interno durante la vinculación con Meta.' });
  }
}

/**
 * POST /api/connections/meta/onboarding/legacy
 * Mantiene el endpoint manual (formulario antiguo) para backward-compatibility.
 * Solo disponible para uso de desarrollador; el UI principal usa el Embedded Signup.
 *
 * Body: { metaPhoneNumberId, metaWabaId, metaAccessToken, phoneNumber }
 */
export async function handleMetaLegacyConnect(req, res) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    return res.status(400).json({ error: 'Usuario no asociado a ningún Tenant.' });
  }

  const { metaPhoneNumberId, metaWabaId, metaAccessToken, phoneNumber } = req.body;

  if (!metaPhoneNumberId || !metaWabaId || !metaAccessToken || !phoneNumber) {
    return res.status(400).json({
      error: 'Faltan campos: metaPhoneNumberId, metaWabaId, metaAccessToken, phoneNumber son obligatorios.',
    });
  }

  try {
    const cleanPhone = String(phoneNumber).replace(/\D/g, '');

    const existing = await prisma.registeredWhatsAppNumber.findFirst({
      where: { tenantId, provider: 'META' },
    });

    let record;
    if (existing) {
      record = await prisma.registeredWhatsAppNumber.update({
        where: { id: existing.id },
        data: {
          phoneNumber:       cleanPhone,
          metaPhoneNumberId,
          metaWabaId,
          metaAccessToken,   // ⛔ Solo en BD
          updatedAt:         new Date(),
        },
      });
    } else {
      record = await prisma.registeredWhatsAppNumber.create({
        data: {
          phoneNumber:       cleanPhone,
          provider:          'META',
          metaPhoneNumberId,
          metaWabaId,
          metaAccessToken,   // ⛔ Solo en BD
          tenantId,
        },
      });
    }

    console.log(`✅ [Meta Legacy] Conexión manual guardada para tenant: ${tenantId}`);

    return res.json({
      success:          true,
      message:          'Conexión Meta configurada manualmente.',
      provider:         'META',
      phoneNumber:      record.phoneNumber,
      metaPhoneNumberId: record.metaPhoneNumberId,
      onboardingMethod: 'MANUAL_LEGACY',
    });
  } catch (err) {
    console.error('❌ [Meta Legacy] Error:', err.message);
    return res.status(500).json({ error: 'Error interno al guardar la conexión Meta.' });
  }
}
