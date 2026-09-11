/**
 * META ONBOARDING CONTROLLER
 * Maneja el flujo de Embedded Signup v4 para WhatsApp Business App Coexistence
 * y configuración manual avanzada de Meta Cloud API.
 *
 * FLUJO EMBEDDED SIGNUP:
 *   1. Frontend lanza FB.login() con config_id + featureType: 'whatsapp_business_app_onboarding'
 *   2. SDK devuelve { code } y mensaje WA_EMBEDDED_SIGNUP con { waba_id, phone_number_id }
 *   3. Frontend llama POST /api/connections/meta/onboarding/callback
 *   4. Backend intercambia code por access_token (server-side, secret protegido)
 *   5. Backend valida WABA y pertenencia estricta del Phone Number ID
 *   6. Backend suscribe la WABA a webhooks (POST /{wabaId}/subscribed_apps) (fail-closed)
 *   7. Backend cifra access_token con AES-256-GCM y persiste connectionState = 'CONNECTED'
 *   8. Responde al frontend SIN exponer token
 *
 * SEGURIDAD:
 *   - tenantId se obtiene EXCLUSIVAMENTE de req.user (JWT verificado por authMiddleware)
 *   - El access_token NUNCA llega al frontend ni a los logs
 *   - El access_token se almacena cifrado (AES-256-GCM)
 *   - El code es de un solo uso (~10 min TTL de Meta)
 */

import axios from 'axios';
import prisma from '../db.js';
import { encryptText } from '../utils/cryptoUtils.js';

export function getMetaGraphVersion() {
  return process.env.META_GRAPH_API_VERSION || 'v21.0';
}

/**
 * GET /api/connections/meta/onboarding/config
 * Devuelve la configuración pública para inicializar el SDK de Facebook.
 * NO devuelve secretos. Solo App ID, Config ID y versión de Graph.
 */
export async function getMetaOnboardingConfig(req, res) {
  try {
    const appId    = process.env.META_APP_ID;
    const configId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
    const graphApiVersion = getMetaGraphVersion();

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
      graphApiVersion,
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
  const graphVersion = getMetaGraphVersion();

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
        `https://graph.facebook.com/${graphVersion}/oauth/access_token`,
        {
          params: {
            client_id:     appId,
            client_secret: appSecret,
            code:          code.trim(),
          },
          timeout: 15000,
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
    let resolvedWabaId = wabaId || null;

    if (!resolvedWabaId) {
      try {
        console.log(`🔍 [Meta Onboarding] WABA ID no recibido, consultando debug_token...`);
        const debugRes = await axios.get(
          `https://graph.facebook.com/${graphVersion}/debug_token`,
          {
            params: {
              input_token:  accessToken,
              access_token: `${appId}|${appSecret}`,
            },
            timeout: 10000,
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

    // ── PASO 3: Obtener números de teléfono y validar pertenencia ─────────────
    let phoneNumber       = null;
    let finalPhoneNumberId = phoneNumberId || null;
    let selectedPhone     = null;

    try {
      const phonesRes = await axios.get(
        `https://graph.facebook.com/${graphVersion}/${resolvedWabaId}/phone_numbers`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params:  { fields: 'id,display_phone_number,verified_name,status,quality_rating,platform_type' },
          timeout: 15000,
        }
      );
      const phones = phonesRes.data?.data || [];

      if (phones.length === 0) {
        return res.status(422).json({
          error: 'No se encontraron números de teléfono registrados en la cuenta WABA.',
          code:  'META_NO_PHONES_IN_WABA',
        });
      }

      if (finalPhoneNumberId) {
        selectedPhone = phones.find(p => p.id === finalPhoneNumberId);
        if (!selectedPhone) {
          return res.status(422).json({
            error: `El Phone Number ID ${finalPhoneNumberId} no pertenece a la cuenta WABA ${resolvedWabaId}.`,
            code:  'META_PHONE_NOT_IN_WABA',
          });
        }
      } else {
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

    // ── PASO 4: Suscribir App a los Webhooks de la WABA (Obligatorio & Fail-Closed) ─
    try {
      console.log(`📡 [Meta Onboarding] Suscribiendo WABA ${resolvedWabaId} a los webhooks de la App...`);
      const subRes = await axios.post(
        `https://graph.facebook.com/${graphVersion}/${resolvedWabaId}/subscribed_apps`,
        {},
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 10000,
        }
      );
      if (subRes.data?.success !== true) {
        throw new Error(subRes.data?.error?.message || 'Meta no confirmó la suscripción de webhooks.');
      }
      console.log(`✅ [Meta Onboarding] WABA ${resolvedWabaId} suscrita con éxito a webhooks.`);
    } catch (subErr) {
      const errMeta = subErr.response?.data?.error;
      console.error('❌ [Meta Onboarding] Error en subscribed_apps:', errMeta?.message || subErr.message);
      return res.status(502).json({
        error: `No se pudo suscribir la cuenta WABA a los webhooks de Meta: ${errMeta?.message || subErr.message}`,
        code:  'META_SUBSCRIBE_FAILED',
      });
    }

    // ── PASO 5: Cifrar token y persistir en BD ─────────────────────────────────
    const encryptedToken = encryptText(accessToken);

    const existing = await prisma.registeredWhatsAppNumber.findFirst({
      where: { tenantId, provider: 'META' },
    });

    let record;
    if (existing) {
      record = await prisma.registeredWhatsAppNumber.update({
        where: { id: existing.id },
        data: {
          phoneNumber:              phoneNumber,
          metaPhoneNumberId:        finalPhoneNumberId,
          metaWabaId:               resolvedWabaId,
          metaAccessToken:          encryptedToken, // ⛔ Cifrado AES-256-GCM
          instanceName:             null,           // Meta Cloud API directo
          connectionState:          'CONNECTED',
          connectionStateUpdatedAt: new Date(),
          updatedAt:                new Date(),
        },
      });
      console.log(`✅ [Meta Onboarding] Conexión Meta actualizada para tenant: ${tenantId}`);
    } else {
      record = await prisma.registeredWhatsAppNumber.create({
        data: {
          phoneNumber:              phoneNumber,
          provider:                 'META',
          metaPhoneNumberId:        finalPhoneNumberId,
          metaWabaId:               resolvedWabaId,
          metaAccessToken:          encryptedToken, // ⛔ Cifrado AES-256-GCM
          instanceName:             null,
          connectionState:          'CONNECTED',
          connectionStateUpdatedAt: new Date(),
          tenantId,
        },
      });
      console.log(`✅ [Meta Onboarding] Nueva conexión Meta creada para tenant: ${tenantId}`);
    }

    // ── PASO 6: Responder al frontend SIN exponer el token ────────────────────
    return res.json({
      success:           true,
      message:           'WhatsApp Business conectado exitosamente mediante Meta Cloud API (Embedded Signup).',
      provider:          'META',
      phoneNumber:       record.phoneNumber,
      metaPhoneNumberId: record.metaPhoneNumberId,
      metaWabaId:        record.metaWabaId,
      connectionState:   'CONNECTED',
      onboardingMethod:  'EMBEDDED_SIGNUP',
      isCoexistence:     Boolean(selectedPhone?.platform_type === 'CLOUD_API' || selectedPhone?.platform_type === 'ON_PREMISE' || true),
      // metaAccessToken: NEVER included
    });

  } catch (err) {
    console.error('❌ [Meta Onboarding] Error inesperado en callback:', err.message);
    return res.status(500).json({ error: 'Error interno durante la vinculación con Meta.' });
  }
}

/**
 * POST /api/connections/meta/onboarding/legacy
 * Conexión Manual Avanzada: Para negocios que ya disponen de una WABA y Cloud API configurada.
 * Valida server-side exhaustivamente credenciales, pertenencia y webhook antes de persistir.
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
      error: 'Faltan campos obligatorios: metaPhoneNumberId, metaWabaId, metaAccessToken y phoneNumber son requeridos.',
      code:  'META_MISSING_MANUAL_FIELDS',
    });
  }

  const graphVersion = getMetaGraphVersion();

  try {
    const cleanToken = String(metaAccessToken).trim();
    const cleanPhoneId = String(metaPhoneNumberId).trim();
    const cleanWabaId = String(metaWabaId).trim();
    const cleanPhone = String(phoneNumber).replace(/\D/g, '');

    // 1. Validar Phone Number ID contra Graph API
    let phoneData;
    try {
      const pRes = await axios.get(
        `https://graph.facebook.com/${graphVersion}/${cleanPhoneId}`,
        {
          headers: { Authorization: `Bearer ${cleanToken}` },
          params: { fields: 'id,display_phone_number,status' },
          timeout: 10000,
        }
      );
      phoneData = pRes.data;
      if (!phoneData?.id) throw new Error('Respuesta inválida de Meta para Phone Number ID.');
    } catch (pErr) {
      const errMeta = pErr.response?.data?.error;
      return res.status(422).json({
        error: `Phone Number ID o token de acceso inválido en Meta: ${errMeta?.message || pErr.message}`,
        code:  'META_INVALID_PHONE_ID_OR_TOKEN',
      });
    }

    // 2. Validar WABA ID contra Graph API
    try {
      const wRes = await axios.get(
        `https://graph.facebook.com/${graphVersion}/${cleanWabaId}`,
        {
          headers: { Authorization: `Bearer ${cleanToken}` },
          params: { fields: 'id,name' },
          timeout: 10000,
        }
      );
      if (!wRes.data?.id) throw new Error('Respuesta inválida de Meta para WABA ID.');
    } catch (wErr) {
      const errMeta = wErr.response?.data?.error;
      return res.status(422).json({
        error: `WABA ID inválido o no accesible con el token provisto: ${errMeta?.message || wErr.message}`,
        code:  'META_INVALID_WABA_OR_TOKEN',
      });
    }

    // 3. Validar pertenencia estricta del Phone Number ID al WABA provisto
    try {
      const wabaPhonesRes = await axios.get(
        `https://graph.facebook.com/${graphVersion}/${cleanWabaId}/phone_numbers`,
        {
          headers: { Authorization: `Bearer ${cleanToken}` },
          params: { fields: 'id,display_phone_number' },
          timeout: 10000,
        }
      );
      const phones = wabaPhonesRes.data?.data || [];
      const belongs = phones.some(p => p.id === cleanPhoneId);
      if (!belongs) {
        return res.status(422).json({
          error: `El Phone Number ID ${cleanPhoneId} no pertenece a la cuenta WABA ${cleanWabaId}.`,
          code:  'META_PHONE_NOT_IN_WABA',
        });
      }
    } catch (matchErr) {
      const errMeta = matchErr.response?.data?.error;
      return res.status(502).json({
        error: `Error al validar números asociados a la WABA: ${errMeta?.message || matchErr.message}`,
        code:  'META_PHONES_FETCH_FAILED',
      });
    }

    // 4. Suscribir App a Webhooks de la WABA (Fail-closed)
    try {
      const subRes = await axios.post(
        `https://graph.facebook.com/${graphVersion}/${cleanWabaId}/subscribed_apps`,
        {},
        {
          headers: { Authorization: `Bearer ${cleanToken}` },
          timeout: 10000,
        }
      );
      if (subRes.data?.success !== true) {
        throw new Error(subRes.data?.error?.message || 'Meta rechazó la suscripción de webhooks.');
      }
    } catch (subErr) {
      const errMeta = subErr.response?.data?.error;
      return res.status(502).json({
        error: `No se pudo suscribir la cuenta WABA al webhook: ${errMeta?.message || subErr.message}`,
        code:  'META_SUBSCRIBE_FAILED',
      });
    }

    // 5. Cifrar token y persistir
    const encryptedToken = encryptText(cleanToken);

    const existing = await prisma.registeredWhatsAppNumber.findFirst({
      where: { tenantId, provider: 'META' },
    });

    let record;
    if (existing) {
      record = await prisma.registeredWhatsAppNumber.update({
        where: { id: existing.id },
        data: {
          phoneNumber:              cleanPhone,
          metaPhoneNumberId:        cleanPhoneId,
          metaWabaId:               cleanWabaId,
          metaAccessToken:          encryptedToken, // ⛔ Cifrado
          instanceName:             null,
          connectionState:          'CONNECTED',
          connectionStateUpdatedAt: new Date(),
          updatedAt:                new Date(),
        },
      });
    } else {
      record = await prisma.registeredWhatsAppNumber.create({
        data: {
          phoneNumber:              cleanPhone,
          provider:                 'META',
          metaPhoneNumberId:        cleanPhoneId,
          metaWabaId:               cleanWabaId,
          metaAccessToken:          encryptedToken, // ⛔ Cifrado
          instanceName:             null,
          connectionState:          'CONNECTED',
          connectionStateUpdatedAt: new Date(),
          tenantId,
        },
      });
    }

    console.log(`✅ [Meta Manual] Conexión manual validada y guardada para tenant: ${tenantId}`);

    return res.json({
      success:           true,
      message:           'Conexión Meta Cloud API configurada y verificada exitosamente.',
      provider:          'META',
      phoneNumber:       record.phoneNumber,
      metaPhoneNumberId: record.metaPhoneNumberId,
      metaWabaId:        record.metaWabaId,
      connectionState:   'CONNECTED',
      onboardingMethod:  'MANUAL_ADVANCED',
    });
  } catch (err) {
    console.error('❌ [Meta Manual] Error:', err.message);
    return res.status(500).json({ error: 'Error interno al validar la conexión manual de Meta.' });
  }
}
