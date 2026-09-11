/**
 * WA GATEWAY SERVICE
 * Servicio centralizado de envío saliente. Resuelve proveedor desde BD.
 * PROVEEDORES: 'EVOLUTION' (QR) | 'META' (Cloud API Oficial)
 */
import axios from 'axios';
import prisma from '../db.js';
import { markMessageAsSentByAi } from './aiMessageTracker.js';
import { decryptText } from '../utils/cryptoUtils.js';
import { getMetaGraphVersion } from '../controllers/metaOnboardingController.js';

function getEvoHeaders(apiKey) {
  const key = (apiKey || process.env.EVOLUTION_API_KEY || '').trim();
  return { headers: { apikey: key, 'Content-Type': 'application/json' } };
}

function getEvoInstanceName(tenantId) {
  return `bot_prod_${tenantId}`;
}

function assertNotInTestMode(operation, target) {
  if (process.env.NODE_ENV === 'test' || process.env.CAMPAIGN_TEST_MODE === '1') {
    throw new Error(`[WA Gateway Guard] External WhatsApp HTTP call blocked in test mode (op: ${operation}, target: ${target || 'unknown'})`);
  }
}

/**
 * Resuelve el contexto del Gateway (proveedor + credenciales) desde la BD.
 */
export async function resolveGatewayCtx(tenantId) {
  const connection = await prisma.registeredWhatsAppNumber.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  });

  const provider = connection?.provider || 'EVOLUTION';

  if (provider === 'META') {
    const rawToken = connection?.metaAccessToken || process.env.META_ACCESS_TOKEN || null;
    const decryptedToken = rawToken ? decryptText(rawToken) : null;
    return {
      provider: 'META',
      instance: null,
      apiKey: '',
      metaPhoneNumberId: connection?.metaPhoneNumberId || process.env.META_PHONE_NUMBER_ID || null,
      metaAccessToken: decryptedToken,
    };
  }

  return {
    provider: 'EVOLUTION',
    instance: connection?.instanceName || getEvoInstanceName(tenantId),
    apiKey: (process.env.EVOLUTION_API_KEY || '').trim(),
    metaPhoneNumberId: null,
    metaAccessToken: null,
  };
}

/**
 * Descarga un archivo multimedia de Meta Cloud API mediante su mediaId
 * y lo devuelve como Data URL Base64 para consumo directo por la IA.
 *
 * @param {string} mediaId - ID del archivo multimedia en Meta
 * @param {string} token   - Meta Access Token
 * @returns {Promise<{ dataUrl: string, mimeType: string }|null>}
 */
export async function downloadMetaMedia(mediaId, token) {
  assertNotInTestMode('downloadMetaMedia', mediaId);
  if (!mediaId || !token) return null;
  const effectiveToken = decryptText(token);
  const graphVersion = getMetaGraphVersion();
  try {
    // 1. Obtener la URL temporal de descarga del archivo
    const metaRes = await axios.get(`https://graph.facebook.com/${graphVersion}/${mediaId}`, {
      headers: { Authorization: `Bearer ${effectiveToken}` },
      timeout: 15000
    });
    const downloadUrl = metaRes.data?.url;
    const mimeType = metaRes.data?.mime_type || 'audio/ogg';
    if (!downloadUrl) return null;

    // 2. Descargar el binario usando el token en el header
    const binaryRes = await axios.get(downloadUrl, {
      headers: { Authorization: `Bearer ${effectiveToken}` },
      responseType: 'arraybuffer',
      timeout: 15000
    });

    const base64 = Buffer.from(binaryRes.data).toString('base64');
    const cleanMime = mimeType.split(';')[0].trim();
    return {
      dataUrl: `data:${cleanMime};base64,${base64}`,
      mimeType: cleanMime
    };
  } catch (err) {
    console.error(`❌ [WA Gateway] Error descargando multimedia de Meta (${mediaId}):`, err.response?.data || err.message);
    return null;
  }
}

/**
 * Envía un mensaje de texto. Si no se pasa provider/instance, los resuelve desde la BD.
 * @returns {Promise<string|null>} msgId (Evolution / Meta wamid) o null
 */
export async function sendText(opts) {
  assertNotInTestMode('sendText', opts?.to);
  let { tenantId, provider, instance, apiKey, metaPhoneNumberId, metaAccessToken, to, text, isAutomated, origin } = opts;

  if (!provider && tenantId) {
    const ctx = await resolveGatewayCtx(tenantId);
    ({ provider, instance, apiKey, metaPhoneNumberId, metaAccessToken } = ctx);
  } else if (!instance && tenantId) {
    const conn = await prisma.registeredWhatsAppNumber.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { instanceName: true }
    });
    if (conn?.instanceName) instance = conn.instanceName;
  }

  const isJid = String(to).includes('@lid') || String(to).includes('@s.whatsapp.net');
  let cleanTo = String(to).trim().replace(/^\+/, '');
  if (!isJid) {
    cleanTo = cleanTo.replace(/\D/g, '');
  }

  if (provider === 'META') {
    const rawToken = metaAccessToken || process.env.META_ACCESS_TOKEN;
    const token = rawToken ? decryptText(rawToken) : null;
    const phoneId = metaPhoneNumberId || process.env.META_PHONE_NUMBER_ID;
    const graphVersion = getMetaGraphVersion();

    if (!token || !phoneId) {
      console.error('WA Gateway META: Faltan credenciales. Abortando envio de texto.');
      return null;
    }
    try {
      const res = await axios.post(
        `https://graph.facebook.com/${graphVersion}/${phoneId}/messages`,
        { messaging_product: 'whatsapp', to: cleanTo, type: 'text', text: { body: text } },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      const msgId = res.data?.messages?.[0]?.id || null;
      if (isAutomated) {
        if (msgId) markMessageAsSentByAi(msgId, { tenantId, origin: origin || 'ai' });
        if (text) markMessageAsSentByAi(text, { tenantId, origin: origin || 'ai' });
      }
      console.log(`[WA Gateway META] Texto enviado a ${cleanTo} (msgId: ${msgId})`);
      return msgId;
    } catch (err) {
      console.error(`[WA Gateway META] Error al enviar texto a ${cleanTo}:`, err.response?.data || err.message);
      throw err;
    }
  }

  const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
  const evoInstance = instance || getEvoInstanceName(tenantId || '');

  // Reintento automático ante errores transitorios (Connection Closed, 500, 503)
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 2000;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const res = await axios.post(
        `${evoUrl}/message/sendText/${evoInstance}`,
        { number: cleanTo, text, options: { delay: 0 } },
        getEvoHeaders(apiKey)
      );
      const msgId = res.data?.key?.id || null;
      if (isAutomated) {
        if (msgId) markMessageAsSentByAi(msgId, { tenantId, origin: origin || 'ai' });
        if (text) markMessageAsSentByAi(text, { tenantId, origin: origin || 'ai' });
      }
      console.log(`[WA Gateway EVOLUTION] Texto enviado a ${cleanTo} (msgId: ${msgId})`);
      return msgId;
    } catch (err) {
      const status = err.response?.status;
      const isTransient = !status || status === 500 || status === 503 ||
        (err.message || '').toLowerCase().includes('connection closed') ||
        (err.message || '').toLowerCase().includes('econnreset') ||
        (err.message || '').toLowerCase().includes('econnrefused');

      if (isTransient && attempt <= MAX_RETRIES) {
        console.warn(`⚠️ [WA Gateway EVOLUTION] Intento ${attempt}/${MAX_RETRIES} falló (${status || err.code || err.message}). Reintentando en ${RETRY_DELAY_MS / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }

      console.error(`[WA Gateway EVOLUTION] Error definitivo al enviar texto a ${cleanTo} tras ${attempt} intento(s):`, JSON.stringify(err.response?.data || err.message));
      throw err;
    }
  }
}

/**
 * Envía un archivo multimedia (imagen o video) por URL.
 * Detecta automáticamente si es video por extensión o parámetro mediaType.
 */
export async function sendMedia(opts) {
  assertNotInTestMode('sendMedia', opts?.to);
  let { tenantId, provider, instance, apiKey, metaPhoneNumberId, metaAccessToken, to, url, caption, mediaType, isAutomated, origin } = opts;

  if (!url) {
    console.warn('[WA Gateway] sendMedia: URL no válida. Abortando.');
    return null;
  }

  if (!provider && tenantId) {
    const ctx = await resolveGatewayCtx(tenantId);
    ({ provider, instance, apiKey, metaPhoneNumberId, metaAccessToken } = ctx);
  } else if (!instance && tenantId) {
    const conn = await prisma.registeredWhatsAppNumber.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { instanceName: true }
    });
    if (conn?.instanceName) instance = conn.instanceName;
  }

  const isJid = String(to).includes('@lid') || String(to).includes('@s.whatsapp.net');
  let cleanTo = String(to).trim().replace(/^\+/, '');
  if (!isJid) {
    cleanTo = cleanTo.replace(/\D/g, '');
  }

  // Detectar si es video según mediaType o extensión de URL
  const lowerUrl = url.toLowerCase();
  const isVideo = mediaType === 'video' ||
    lowerUrl.startsWith('data:video/') ||
    lowerUrl.includes('video/mp4') ||
    lowerUrl.includes('video/webm') ||
    lowerUrl.includes('.mp4') ||
    lowerUrl.includes('.mov') ||
    lowerUrl.includes('.webm') ||
    lowerUrl.includes('.m4v') ||
    lowerUrl.includes('/video/upload/');

  if (provider === 'META') {
    const rawToken = metaAccessToken || process.env.META_ACCESS_TOKEN;
    const token = rawToken ? decryptText(rawToken) : null;
    const phoneId = metaPhoneNumberId || process.env.META_PHONE_NUMBER_ID;
    const graphVersion = getMetaGraphVersion();

    if (!token || !phoneId) {
      console.error('[WA Gateway META] Faltan credenciales. Abortando envío multimedia.');
      return null;
    }
    try {
      const payload = isVideo
        ? { messaging_product: 'whatsapp', to: cleanTo, type: 'video', video: { link: url, caption: caption || '' } }
        : { messaging_product: 'whatsapp', to: cleanTo, type: 'image', image: { link: url, caption: caption || '' } };

      const res = await axios.post(
        `https://graph.facebook.com/${graphVersion}/${phoneId}/messages`,
        payload,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      const msgId = res.data?.messages?.[0]?.id || null;
      if (isAutomated) {
        if (msgId) markMessageAsSentByAi(msgId, { tenantId, origin: origin || 'ai' });
        if (caption) markMessageAsSentByAi(caption, { tenantId, origin: origin || 'ai' });
      }
      console.log(`[WA Gateway META] ${isVideo ? 'Video' : 'Imagen'} enviado a ${cleanTo} (msgId: ${msgId})`);
      return msgId;
    } catch (err) {
      console.error(`[WA Gateway META] Error al enviar ${isVideo ? 'video' : 'imagen'} a ${cleanTo}:`, err.response?.data || err.message);
      throw err;
    }
  }

  const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
  const evoInstance = instance || getEvoInstanceName(tenantId || '');

  // Reintento automático ante errores transitorios para Evolution API (1 inicial + 2 retries = 3 intentos máx.)
  //
  // NOTA SOBRE DUPLICADOS Y TIMEOUT AMBIGUO:
  // Si Evolution API recibe y procesa el multimedia pero la conexión HTTP se corta o agota
  // el timeout antes de que el cliente reciba la confirmación HTTP 200 con key.id, un reintento
  // posterior podría provocar el envío duplicado del mensaje multimedia al usuario.
  // Este es un riesgo inherente al transporte HTTP sin idempotencia persistente en el gateway.
  // Sin embargo, en cuanto Evolution confirma la recepción con msgId, la función retorna inmediatamente
  // evitando cualquier duplicado posterior tras una respuesta exitosa.
  const MAX_MEDIA_RETRIES = 2;
  const BASE_MEDIA_RETRY_DELAY_MS = Number(process.env.GATEWAY_MEDIA_RETRY_DELAY_MS) || 1500;

  for (let attempt = 1; attempt <= MAX_MEDIA_RETRIES + 1; attempt++) {
    try {
      const res = await axios.post(
        `${evoUrl}/message/sendMedia/${evoInstance}`,
        {
          number: cleanTo,
          mediatype: isVideo ? 'video' : 'image',
          media: url,
          caption: caption || ''
        },
        getEvoHeaders(apiKey)
      );
      const msgId = res.data?.key?.id || null;
      if (isAutomated) {
        if (msgId) markMessageAsSentByAi(msgId, { tenantId, origin: origin || 'ai' });
        if (caption) markMessageAsSentByAi(caption, { tenantId, origin: origin || 'ai' });
      }
      console.log(`[WA Gateway EVOLUTION] ${isVideo ? 'Video' : 'Imagen'} enviado a ${cleanTo} (msgId: ${msgId})`);
      return msgId;
    } catch (err) {
      const status = err.response?.status;
      const errText = `${err.code || ''} ${err.message || ''}`.toLowerCase();

      // Errores fatales de cliente (4xx: auth, payload inválido, número inválido, ruta inexistente)
      const isFatal = Boolean(status && status >= 400 && status < 500);

      // Errores transitorios (500, 502, 503, 504 o fallos de red / timeout / socket cortado)
      const isTransient = !isFatal && (
        !status ||
        status === 500 || status === 502 || status === 503 || status === 504 ||
        errText.includes('connection closed') ||
        errText.includes('econnreset') ||
        errText.includes('econnrefused') ||
        errText.includes('etimedout') ||
        errText.includes('timeout')
      );

      if (isTransient && attempt <= MAX_MEDIA_RETRIES) {
        const delay = BASE_MEDIA_RETRY_DELAY_MS * attempt;
        console.warn(`⚠️ [WA Gateway EVOLUTION] Media intento ${attempt}/${MAX_MEDIA_RETRIES + 1} falló (${status || err.code || err.message}). Reintentando en ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      console.error(`[WA Gateway EVOLUTION] Error definitivo al enviar ${isVideo ? 'video' : 'imagen'} a ${cleanTo} tras ${attempt} intento(s):`, JSON.stringify(err.response?.data || err.message));
      throw err;
    }
  }
}