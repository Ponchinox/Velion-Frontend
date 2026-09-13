import prisma from '../db.js';
import { cancelFollowUpOnHandoff } from './followUpService.js';

/**
 * humanHandoffService.js — Gestión Centralizada de Human Handoff (Intervención Humana)
 *
 * Responsabilidad:
 * Activar la pausa de 30 minutos para un cliente en un tenant específico de forma atómica:
 * - Contact.botPaused = true, updatedAt = now
 * - Chat.botPaused = true, updatedAt = now
 * - Customer.isBotPaused = true, persistentProfile.lastHumanInterventionAt = now ISO
 * Emite los eventos 'contact_updated' y 'bot_status_changed' exclusivamente a la sala privada tenant:${tenantId}.
 */

export const HUMAN_HANDOFF_MINUTES = 30;
export const HUMAN_HANDOFF_MS = HUMAN_HANDOFF_MINUTES * 60 * 1000;

/**
 * Activa Human Handoff de forma atómica para un cliente en un tenant.
 *
 * @param {object} params
 * @param {string} params.tenantId   - ID del tenant (obligatorio)
 * @param {string} [params.contactId] - ID del Contacto en BD
 * @param {string} [params.chatId]    - ID del Chat en BD
 * @param {string} [params.phone]     - Teléfono del cliente
 * @param {object} [params.io]        - Instancia de Socket.IO
 * @param {string} [params.reason]    - Motivo de la intervención ('HUMAN_INTERVENTION' | 'HUMAN_INTERVENTION_LIVECHAT' | 'HUMAN_HANDOFF' | 'PROFANITY')
 * @returns {Promise<boolean>}
 */
export async function activateHumanHandoff({
  tenantId,
  contactId,
  chatId,
  phone,
  io,
  reason = 'HUMAN_INTERVENTION'
}) {
  if (!tenantId) {
    console.warn('⚠️ [Human Handoff] No se proporcionó tenantId para activar handoff.');
    return false;
  }

  const cleanPhone = String(phone || '').includes('@lid')
    ? String(phone).trim()
    : (String(phone || '').replace(/\D/g, '') || phone);

  const now = new Date();

  try {
    const ops = [];

    // 1. Actualizar Contacto (por ID o por teléfono)
    if (contactId) {
      ops.push(
        prisma.contact.update({
          where: { id: contactId },
          data: { botPaused: true, updatedAt: now }
        })
      );
    } else if (cleanPhone) {
      ops.push(
        prisma.contact.updateMany({
          where: {
            tenantId,
            OR: [
              { phone: { contains: cleanPhone } },
              { phone: phone }
            ]
          },
          data: { botPaused: true, updatedAt: now }
        })
      );
    }

    // 2. Actualizar Chat (por ID o por contactId)
    if (chatId) {
      ops.push(
        prisma.chat.update({
          where: { id: chatId },
          data: { botPaused: true, updatedAt: now }
        })
      );
    } else if (contactId) {
      ops.push(
        prisma.chat.updateMany({
          where: { tenantId, contactId },
          data: { botPaused: true, updatedAt: now }
        })
      );
    }

    // 3. Actualizar Customer y merge seguro de persistentProfile (lastHumanInterventionAt)
    if (cleanPhone) {
      const customers = await prisma.customer.findMany({
        where: {
          tenantId,
          OR: [
            { phone: { contains: cleanPhone } },
            { phone: phone }
          ]
        }
      });

      for (const cust of customers) {
        const currentProfile = (typeof cust.persistentProfile === 'object' && cust.persistentProfile !== null)
          ? cust.persistentProfile
          : {};

        const mergedProfile = {
          ...currentProfile,
          lastHumanInterventionAt: now.toISOString()
        };

        ops.push(
          prisma.customer.update({
            where: { id: cust.id },
            data: {
              isBotPaused: true,
              persistentProfile: mergedProfile
            }
          })
        );
      }
    }

    if (ops.length > 0) {
      await prisma.$transaction(ops);
    }

    // Cancelar inmediatamente cualquier seguimiento automático activo del cliente
    try {
      await cancelFollowUpOnHandoff({ tenantId, contactId, chatId, phone: cleanPhone || phone });
    } catch (fuErr) {
      console.warn(`⚠️ [Human Handoff] Error al cancelar seguimientos activos:`, fuErr.message);
    }

    console.log(`👤 [Human Handoff] Intervención humana activada (30 min) para tenant ${tenantId.slice(0, 8)} | Tel: +${cleanPhone || 'N/A'} (Motivo: ${reason})`);

    // 4. Emisión en tiempo real vía WebSocket exclusivamente a la sala privada del tenant
    const ioInstance = io || global.io;
    if (ioInstance) {
      const ioRoom = `tenant:${tenantId}`;
      const payload = {
        contactId: contactId || null,
        chatId: chatId || null,
        phone: cleanPhone || phone || '',
        botPaused: true,
        isBotPaused: true,
        reason
      };

      if (typeof ioInstance.to === 'function') {
        ioInstance.to(ioRoom).emit('contact_updated', payload);
        ioInstance.to(ioRoom).emit('bot_status_changed', payload);
      } else {
        ioInstance.emit('contact_updated', payload);
        ioInstance.emit('bot_status_changed', payload);
      }
    }

    return true;
  } catch (err) {
    console.error('❌ [Human Handoff] Error al activar pausa de bot:', err.message);
    return false;
  }
}

/**
 * Determina si un texto expresa una solicitud inequívoca de atención humana
 * o aceptación explícita de una transferencia a asesor.
 *
 * @param {string} [text]
 * @returns {boolean}
 */
export function isExplicitHandoffRequested(text) {
  if (!text || typeof text !== 'string') return false;
  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  // 1. Solicitud directa de hablar con humano/asesor/persona/soporte
  const directPatterns = [
    /\b(hablar|pasame|pasa me|comunicame|comunica me|contactame|contacta me|contactar|atenderme|atienda|atender)\b.*\b(asesor|asesora|humano|humana|persona|alguien|agente|operador|operadora|representante|soporte)\b/,
    /\b(quiero|deseo|necesito|solicito|busco|pido)\b.*\b(asesor|asesora|humano|humana|persona|alguien|agente|operador|operadora|representante|soporte)\b/,
    /\b(pedirle|preguntale|dile|consultar)\b.*\b(asesor|asesora|humano|persona|agente)\b/,
    /\b(soporte humano|atencion humana|asesor humano|persona real)\b/,
    /\b(comunicame con alguien|pasame con alguien|atendeme alguien|atender con alguien)\b/,
    /\b(quiero asesor|quiero persona|necesito asesor|necesito persona|pide asesor)\b/
  ];

  if (directPatterns.some(pattern => pattern.test(normalized))) {
    return true;
  }

  // 2. Aceptación explícita de una oferta previa ("sí, por favor", "sí, comunícame", etc.)
  const acceptancePatterns = [
    /^(si|claro|por favor|porfa)\b.*(asesor|humano|persona|comunicame|pasame|transfiereme|contactame)/,
    /^(si|claro)[,\s]+(por favor|porfa|comunicame|pasame|con el asesor|con un asesor)\b/,
    /^(si por favor|si porfa|si claro|por favor comunicame|por favor pasame|si deseo que me contacte|si contactame)\.?$/
  ];

  if (acceptancePatterns.some(pattern => pattern.test(normalized))) {
    return true;
  }

  // 3. Reclamos, disputas o quejas formales que requieren atención humana
  const disputePatterns = [
    /\b(reclamo|queja|denuncia|estafa|estafadores|indecopi|abogado|fraude|policia)\b/
  ];

  if (disputePatterns.some(pattern => pattern.test(normalized))) {
    return true;
  }

  return false;
}

/**
 * Determina si una invocación de handoff (vía tool o tag [HUMAN_HANDOFF: ...])
 * corresponde a UNKNOWN_INFORMATION (información desconocida, no confirmada o no disponible)
 * en lugar de una solicitud legítima de atención humana.
 *
 * @param {object} params
 * @param {string} [params.reason]
 * @param {string} [params.userMessageText]
 * @returns {boolean}
 */
export function isUnknownInfoHandoff({ reason, userMessageText } = {}) {
  // Si el usuario solicitó explícitamente a un humano en su mensaje, NUNCA es unknown info
  if (isExplicitHandoffRequested(userMessageText)) {
    return false;
  }

  const rawReason = String(reason || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  // Si no hay userMessageText (ej. tests unitarios determinísticos de herramientas),
  // se evalúa el reason por motivos explícitos de handoff
  if (!userMessageText) {
    if (
      rawReason.includes('pide asesor') ||
      rawReason.includes('solicita asesor') ||
      rawReason.includes('solicitud de asesor') ||
      rawReason.includes('pide humano') ||
      rawReason.includes('reclamo') ||
      rawReason.includes('disputa') ||
      rawReason.includes('cliente insiste')
    ) {
      return false;
    }
  }

  // Patrones característicos de información desconocida o no confirmada
  const unknownInfoPatterns = [
    /\b(fecha|inicio|empiezan|comienzan|cuando empiezan|cuando inician)\b/,
    /\b(profesor|docente|instructor|profesores|docentes|quien dicta)\b/,
    /\b(horario|horarios|a que hora|hora de inicio)\b/,
    /\b(vacante|vacantes|cupo|cupos|disponibilidad)\b/,
    /\b(garantia|garantiza|ingreso a la universidad|ingresar|asegurar ingreso)\b/,
    /\b(no disponible|desconocid|no confirmad|sin confirmar|no figura|no esta en catalogo|no se encuentra)\b/,
    /\b(falta informacion|dato faltante|dato no configurado|no configurado)\b/,
    /\b(consulta fecha|pregunta fecha|consulta horario|consulta profesor|consulta vacante|consulta garantia)\b/
  ];

  const reasonMatchesUnknown = unknownInfoPatterns.some(pattern => pattern.test(rawReason));

  if (reasonMatchesUnknown) {
    return true;
  }

  // Si el usuario envió una consulta pero no pidió asesor y el motivo describe una consulta de datos
  if (rawReason.startsWith('consulta') || rawReason.startsWith('pregunta') || rawReason.includes('consulta cliente')) {
    if (!isExplicitHandoffRequested(userMessageText)) {
      return true;
    }
  }

  return false;
}
