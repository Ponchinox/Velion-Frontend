/**
 * WA GATEWAY SERVICE
 * Servicio centralizado de envío saliente. Resuelve proveedor desde BD.
 * PROVEEDORES: 'EVOLUTION' (QR) | 'META' (Cloud API Oficial)
 */
import axios from 'axios';
import prisma from '../db.js';

function getEvoHeaders(apiKey) {
  const key = (apiKey || process.env.EVOLUTION_API_KEY || '').trim();
  return { headers: { apikey: key, 'Content-Type': 'application/json' } };
}

function getEvoInstanceName(tenantId) {
  return `bot_prod_${tenantId.slice(0, 8)}`;
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
    return {
      provider: 'META',
      instance: null,
      apiKey: '',
      metaPhoneNumberId: connection?.metaPhoneNumberId || process.env.META_PHONE_NUMBER_ID || null,
      metaAccessToken: connection?.metaAccessToken || process.env.META_ACCESS_TOKEN || null,
    };
  }

  return {
    provider: 'EVOLUTION',
    instance: getEvoInstanceName(tenantId),
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
  if (!mediaId || !token) return null;
  try {
    // 1. Obtener la URL temporal de descarga del archivo
    const metaRes = await axios.get(`https://graph.facebook.com/v20.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const downloadUrl = metaRes.data?.url;
    const mimeType = metaRes.data?.mime_type || 'audio/ogg';
    if (!downloadUrl) return null;

    // 2. Descargar el binario usando el token en el header
    const binaryRes = await axios.get(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer'
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
  let { tenantId, provider, instance, apiKey, metaPhoneNumberId, metaAccessToken, to, text } = opts;

  if (!provider && tenantId) {
    const ctx = await resolveGatewayCtx(tenantId);
    ({ provider, instance, apiKey, metaPhoneNumberId, metaAccessToken } = ctx);
  }

  const cleanTo = String(to).replace(/\D/g, '');

  if (provider === 'META') {
    const token = metaAccessToken || process.env.META_ACCESS_TOKEN;
    const phoneId = metaPhoneNumberId || process.env.META_PHONE_NUMBER_ID;
    if (!token || !phoneId) {
      console.error('WA Gateway META: Faltan credenciales. Abortando envio de texto.');
      return null;
    }
    try {
      const res = await axios.post(
        `https://graph.facebook.com/v20.0/${phoneId}/messages`,
        { messaging_product: 'whatsapp', to: cleanTo, type: 'text', text: { body: text } },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      const msgId = res.data?.messages?.[0]?.id || null;
      console.log(`[WA Gateway META] Texto enviado a +${cleanTo} (msgId: ${msgId})`);
      return msgId;
    } catch (err) {
      console.error(`[WA Gateway META] Error al enviar texto a +${cleanTo}:`, err.response?.data || err.message);
      throw err;
    }
  }

  const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
  const evoInstance = instance || getEvoInstanceName(tenantId || '');
  try {
    const res = await axios.post(
      `${evoUrl}/message/sendText/${evoInstance}`,
      { number: cleanTo, text, options: { delay: 0 } },
      getEvoHeaders(apiKey)
    );
    const msgId = res.data?.key?.id || null;
    console.log(`[WA Gateway EVOLUTION] Texto enviado a +${cleanTo} (msgId: ${msgId})`);
    return msgId;
  } catch (err) {
    console.error(`[WA Gateway EVOLUTION] Error al enviar texto a +${cleanTo}:`, err.response?.data || err.message);
    throw err;
  }
}

/**
 * Envía un archivo multimedia (imagen o video) por URL.
 * Detecta automáticamente si es video por extensión o parámetro mediaType.
 */
export async function sendMedia(opts) {
  let { tenantId, provider, instance, apiKey, metaPhoneNumberId, metaAccessToken, to, url, caption, mediaType } = opts;

  if (!url) {
    console.warn('[WA Gateway] sendMedia: URL no válida. Abortando.');
    return null;
  }

  if (!provider && tenantId) {
    const ctx = await resolveGatewayCtx(tenantId);
    ({ provider, instance, apiKey, metaPhoneNumberId, metaAccessToken } = ctx);
  }

  const cleanTo = String(to).replace(/\D/g, '');

  // Detectar si es video según mediaType o extensión de URL
  const lowerUrl = url.toLowerCase();
  const isVideo = mediaType === 'video' || lowerUrl.includes('.mp4') || lowerUrl.includes('.mov') || lowerUrl.includes('.webm') || lowerUrl.includes('.m4v') || lowerUrl.includes('/video/upload/');

  if (provider === 'META') {
    const token = metaAccessToken || process.env.META_ACCESS_TOKEN;
    const phoneId = metaPhoneNumberId || process.env.META_PHONE_NUMBER_ID;
    if (!token || !phoneId) {
      console.error('[WA Gateway META] Faltan credenciales. Abortando envío multimedia.');
      return null;
    }
    try {
      const payload = isVideo
        ? { messaging_product: 'whatsapp', to: cleanTo, type: 'video', video: { link: url, caption: caption || '' } }
        : { messaging_product: 'whatsapp', to: cleanTo, type: 'image', image: { link: url, caption: caption || '' } };

      const res = await axios.post(
        `https://graph.facebook.com/v20.0/${phoneId}/messages`,
        payload,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      const msgId = res.data?.messages?.[0]?.id || null;
      console.log(`[WA Gateway META] ${isVideo ? 'Video' : 'Imagen'} enviado a +${cleanTo} (msgId: ${msgId})`);
      return msgId;
    } catch (err) {
      console.error(`[WA Gateway META] Error al enviar ${isVideo ? 'video' : 'imagen'} a +${cleanTo}:`, err.response?.data || err.message);
      throw err;
    }
  }

  const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
  const evoInstance = instance || getEvoInstanceName(tenantId || '');
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
    console.log(`[WA Gateway EVOLUTION] ${isVideo ? 'Video' : 'Imagen'} enviado a +${cleanTo} (msgId: ${msgId})`);
    return msgId;
  } catch (err) {
    console.error(`[WA Gateway EVOLUTION] Error al enviar ${isVideo ? 'video' : 'imagen'} a +${cleanTo}:`, err.response?.data || err.message);
    throw err;
  }
}