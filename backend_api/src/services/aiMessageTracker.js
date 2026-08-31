/**
 * AI & AUTOMATED MESSAGE TRACKER
 * ==============================
 * Registra y rastrea mensajes salientes generados por:
 *   - IA (Gemini / OpenAI)
 *   - Campañas Masivas (campaignService)
 *   - Flujos Automatizados (flowService)
 *   - Notificaciones y Alertas del Sistema
 *
 * Principios de Diseño:
 *   1. Aislamiento Multi-Tenant Estricto: Los mensajes se asocian a su tenantId correspondiente.
 *   2. Prioridad a externalId / provider msgId explícitamente registrado.
 *   3. NUNCA considerar automático un mensaje solo por tener senderRole='agent' en la BD
 *      (un asesor humano en Live Chat también guarda senderRole='agent').
 *   4. Cache en RAM de 2 capas con auto-limpieza (5 minutos de retención).
 *   5. Resiliencia Persistente en PostgreSQL: Consulta campaignLog y roles inequívocos ('bot', 'system').
 *   6. Idempotencia y soporte para webhooks duplicados de Meta y Evolution.
 */

import prisma from '../db.js';

// Cache en memoria para IDs de mensaje registrados como automáticos
// key: msgId -> { timestamp, tenantId, chatId, origin }
const sentMsgIdCache = new Map();

// Cache en memoria para textos registrados como automáticos
// key: scopedKey or rawText -> { timestamp, tenantId, chatId, origin }
const sentTextCache = new Map();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos de retención

/**
 * Registra un mensaje saliente como generado automáticamente por IA/Sistema/Flujo/Campaña.
 *
 * @param {string|object} textOrIdOrOpts - ID del mensaje, texto o payload de opciones
 * @param {object} [opts] - Opciones adicionales ({ tenantId, chatId, origin })
 */
export function markMessageAsSentByAi(textOrIdOrOpts, opts = {}) {
  if (!textOrIdOrOpts) return;

  const now = Date.now();

  let msgId = null;
  let text = null;
  let tenantId = opts.tenantId || null;
  let chatId = opts.chatId || null;
  let origin = opts.origin || 'ai';

  if (typeof textOrIdOrOpts === 'object' && textOrIdOrOpts !== null) {
    msgId = textOrIdOrOpts.msgId || textOrIdOrOpts.externalId || null;
    text = textOrIdOrOpts.text || textOrIdOrOpts.content || null;
    tenantId = textOrIdOrOpts.tenantId || tenantId;
    chatId = textOrIdOrOpts.chatId || chatId;
    origin = textOrIdOrOpts.origin || origin;
  } else if (typeof textOrIdOrOpts === 'string') {
    const clean = textOrIdOrOpts.trim();
    if (!clean) return;

    if (!clean.includes(' ')) {
      // Sin espacios: puede ser consultado como msgId o como text
      msgId = clean;
      text = clean;
    } else {
      text = clean;
    }
  }

  // Registrar ID en cache
  if (msgId) {
    const cleanId = String(msgId).trim();
    if (cleanId) {
      sentMsgIdCache.set(cleanId, { timestamp: now, tenantId, chatId, origin });
      setTimeout(() => {
        const item = sentMsgIdCache.get(cleanId);
        if (item && Date.now() - item.timestamp >= CACHE_TTL_MS) {
          sentMsgIdCache.delete(cleanId);
        }
      }, CACHE_TTL_MS + 1000);
    }
  }

  // Registrar Texto en cache con aislamiento de tenant y chat
  if (text) {
    const cleanText = String(text).trim();
    if (cleanText) {
      // Clave scoped por tenant y chat
      const scopedKey = `${tenantId || '*'}:${chatId || '*'}:${cleanText}`;
      sentTextCache.set(scopedKey, { timestamp: now, tenantId, chatId, origin });

      // Clave global por compatibilidad legacy si tenantId no se proveyó
      if (!tenantId) {
        sentTextCache.set(cleanText, { timestamp: now, tenantId: null, chatId: null, origin });
      }

      setTimeout(() => {
        const item = sentTextCache.get(scopedKey);
        if (item && Date.now() - item.timestamp >= CACHE_TTL_MS) {
          sentTextCache.delete(scopedKey);
        }
        if (!tenantId) {
          const rawItem = sentTextCache.get(cleanText);
          if (rawItem && Date.now() - rawItem.timestamp >= CACHE_TTL_MS) {
            sentTextCache.delete(cleanText);
          }
        }
      }, CACHE_TTL_MS + 1000);
    }
  }
}

/**
 * Determina si un mensaje saliente (fromMe: true) fue generado automáticamente por el sistema
 * o si proviene de una intervención humana (asesor en Live Chat o dueño en WhatsApp Business App).
 *
 * @param {object} params
 * @param {string} [params.tenantId]
 * @param {string} [params.chatId]
 * @param {string} [params.msgId] - ID del mensaje reportado por Evolution / Meta
 * @param {string} [params.text]  - Contenido del mensaje de texto
 * @param {string} [params.phone] - Teléfono limpio del destinatario
 * @returns {Promise<boolean>} true si es automático/IA, false si es humano manual
 */
export async function isAutomatedMessage({ tenantId, chatId, msgId, text, phone }) {
  const cleanMsgId = msgId ? String(msgId).trim() : '';
  const cleanText = text ? String(text).trim() : '';
  const cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';
  const now = Date.now();

  // ── 1. Capa Rápida: Cache en Memoria RAM por ID (Prioridad 1) ─────────────
  if (cleanMsgId && sentMsgIdCache.has(cleanMsgId)) {
    const cached = sentMsgIdCache.get(cleanMsgId);
    // Verificar aislamiento de tenant si ambos están definidos
    if (!cached.tenantId || !tenantId || cached.tenantId === tenantId) {
      cached.timestamp = now; // Refrescar para webhooks duplicados
      return true;
    }
  }

  // ── 2. Capa Rápida: Cache en Memoria RAM por Texto Scoped (Prioridad 2) ───
  if (cleanText) {
    // 2a. Búsqueda exacta scoped: tenant:chat:texto
    if (tenantId && chatId) {
      const exactKey = `${tenantId}:${chatId}:${cleanText}`;
      if (sentTextCache.has(exactKey)) {
        sentTextCache.get(exactKey).timestamp = now;
        return true;
      }
    }

    // 2b. Búsqueda scoped por tenant: tenant:*:texto
    if (tenantId) {
      const tenantKey = `${tenantId}:*:${cleanText}`;
      if (sentTextCache.has(tenantKey)) {
        sentTextCache.get(tenantKey).timestamp = now;
        return true;
      }
    }

    // 2c. Búsqueda genérica *:*:texto o texto crudo (solo si el tenant coincide o no tiene tenant)
    const wildcardKey = `*:*:${cleanText}`;
    if (sentTextCache.has(wildcardKey)) {
      const cached = sentTextCache.get(wildcardKey);
      if (!cached.tenantId || !tenantId || cached.tenantId === tenantId) {
        cached.timestamp = now;
        return true;
      }
    }

    if (sentTextCache.has(cleanText)) {
      const cached = sentTextCache.get(cleanText);
      if (!cached.tenantId || !tenantId || cached.tenantId === tenantId) {
        cached.timestamp = now;
        return true;
      }
    }
  }

  // ── 3. Capa Persistente: Verificación en PostgreSQL (Resiliencia ante Restart) ──
  try {
    // 3a. Verificar si coincide con un envío de Campaña reciente (última hora)
    if (cleanPhone || cleanText) {
      const oneHourAgo = new Date(now - 60 * 60 * 1000);
      const campaignMatch = await prisma.campaignLog.findFirst({
        where: {
          sentAt: { gte: oneHourAgo },
          ...(cleanPhone ? { customerPhone: { contains: cleanPhone } } : {}),
          ...(cleanText ? { sentMessage: cleanText } : {})
        }
      });

      if (campaignMatch) {
        if (cleanMsgId) markMessageAsSentByAi(cleanMsgId, { tenantId, chatId, origin: 'campaign' });
        if (cleanText) markMessageAsSentByAi(cleanText, { tenantId, chatId, origin: 'campaign' });
        return true;
      }
    }

    // 3b. Verificar si en la BD existe un mensaje explícitamente automático (roles 'bot' o 'system')
    // IMPORTANTE: NO usamos senderRole: 'agent' aquí, porque Live Chat manual también usa 'agent'.
    if (tenantId || chatId) {
      const orConditions = [];
      if (cleanMsgId) orConditions.push({ externalId: cleanMsgId });

      if (orConditions.length > 0) {
        const automatedDbMsg = await prisma.message.findFirst({
          where: {
            ...(tenantId ? { tenantId } : {}),
            ...(chatId ? { chatId } : {}),
            senderRole: { in: ['bot', 'system'] },
            OR: orConditions
          },
          orderBy: { createdAt: 'desc' }
        });

        if (automatedDbMsg) {
          if (cleanMsgId) markMessageAsSentByAi(cleanMsgId, { tenantId, chatId, origin: automatedDbMsg.senderRole });
          return true;
        }
      }
    }
  } catch (dbErr) {
    console.error('⚠️ [aiMessageTracker] Error al verificar persistencia en BD:', dbErr.message);
  }

  // Si no está registrado en RAM por Gemini/Flow/Campaña ni en BD como automatización,
  // es una intervención humana real (Live Chat o WhatsApp Business App)
  return false;
}
