import prisma from '../db.js';

/**
 * humanHandoffGate.js — Verificación Autoritativa de Human Handoff (Fase 1)
 *
 * Determina si el bot está pausado para un cliente en un tenant específico
 * consultando en base de datos el estado de:
 *   1. Contact.botPaused
 *   2. Chat.botPaused
 *   3. Customer.isBotPaused
 *
 * Regla Fail-Closed:
 * Si CUALQUIERA de las tres entidades indica pausa (true), el handoff está ACTIVO
 * y la IA pierde toda autoridad para generar o despachar mensajes.
 * Si ocurre un error de BD, falla cerrado (true) para proteger la conversación humana.
 */
export async function isHandoffActive({
  tenantId,
  contactId,
  chatId,
  phone,
  prismaClient
}) {
  if (!tenantId) {
    return false;
  }

  const db = prismaClient || prisma;
  const rawPhone = String(phone || '').trim();
  const cleanPhone = rawPhone.includes('@lid')
    ? rawPhone
    : (rawPhone.replace(/\D/g, '') || rawPhone);

  try {
    // 1. Verificar Contact.botPaused (por contactId o por teléfono)
    if (contactId) {
      const contact = await db.contact.findFirst({
        where: { id: contactId, tenantId },
        select: { botPaused: true }
      });
      if (contact?.botPaused === true) return true;
    } else if (cleanPhone) {
      const contact = await db.contact.findFirst({
        where: {
          tenantId,
          OR: [
            { phone: { contains: cleanPhone } },
            { phone: rawPhone }
          ]
        },
        select: { botPaused: true }
      });
      if (contact?.botPaused === true) return true;
    }

    // 2. Verificar Chat.botPaused (por chatId o por contactId)
    if (chatId) {
      const chat = await db.chat.findFirst({
        where: { id: chatId, tenantId },
        select: { botPaused: true }
      });
      if (chat?.botPaused === true) return true;
    } else if (contactId) {
      const chat = await db.chat.findFirst({
        where: { tenantId, contactId },
        select: { botPaused: true }
      });
      if (chat?.botPaused === true) return true;
    }

    // 3. Verificar Customer.isBotPaused (por tenantId + phone)
    if (cleanPhone) {
      const customer = await db.customer.findFirst({
        where: {
          tenantId,
          OR: [
            { phone: { contains: cleanPhone } },
            { phone: rawPhone }
          ]
        },
        select: { isBotPaused: true }
      });
      if (customer?.isBotPaused === true) return true;
    }

    return false;
  } catch (err) {
    console.error(`⚠️ [Human Handoff Gate] Error al consultar estado de pausa para tenant ${tenantId?.slice(0, 8)}:`, err.message);
    // FAIL-CLOSED: ante error de infraestructura, no permitimos que la IA responda a ciegas
    return true;
  }
}
