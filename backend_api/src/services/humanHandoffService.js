import prisma from '../db.js';

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
