/**
 * operationalItemEventService.js
 * Capa de eventos Socket.IO para OperationalItems (NOTE y TASK).
 *
 * Garantiza:
 * - Emisiones acotadas estrictamente a la sala 'tenant:${tenantId}'.
 * - Sanitización de payloads (NUNCA expone dedupeKey ni tenantId redundante).
 * - Tolerancia total a fallos si Socket.IO no está disponible (cero excepciones hacia el llamador).
 * - Cero efectos colaterales de WhatsApp (no notificationPhone, no handoff alert).
 */

export function sanitizeOperationalItemForSocket(item) {
  if (!item || typeof item !== 'object') return null;

  return {
    id: item.id,
    type: item.type,
    category: item.category,
    title: item.title,
    summary: item.summary,
    subjectName: item.subjectName,
    status: item.status,
    priority: item.priority,
    customerId: item.customerId || null,
    contactId: item.contactId || null,
    chatId: item.chatId || null,
    orderId: item.orderId || null,
    sourceMessageId: item.sourceMessageId || null,
    dueDateLocal: item.dueDateLocal || null,
    dueTimeLocal: item.dueTimeLocal || null,
    dueAt: item.dueAt ? (item.dueAt instanceof Date ? item.dueAt.toISOString() : item.dueAt) : null,
    details: item.details || null,
    createdByType: item.createdByType,
    createdByUserId: item.createdByUserId || null,
    completedAt: item.completedAt ? (item.completedAt instanceof Date ? item.completedAt.toISOString() : item.completedAt) : null,
    completedByUserId: item.completedByUserId || null,
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
    updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : item.updatedAt
  };
}

export function emitOperationalItemCreated({ io, tenantId, item }) {
  if (!tenantId || !item) return;

  try {
    const activeIo = io || global.io;
    if (!activeIo) return;

    const roomName = `tenant:${tenantId}`;
    const sanitized = sanitizeOperationalItemForSocket(item);

    activeIo.to(roomName).emit('operational_item_created', {
      item: sanitized,
      chatId: item.chatId || null
    });
  } catch (err) {
    console.error('[OperationalItemEvent] Error al emitir operational_item_created:', err.message);
  }
}

export function emitOperationalItemUpdated({ io, tenantId, item }) {
  if (!tenantId || !item) return;

  try {
    const activeIo = io || global.io;
    if (!activeIo) return;

    const roomName = `tenant:${tenantId}`;
    const sanitized = sanitizeOperationalItemForSocket(item);

    activeIo.to(roomName).emit('operational_item_updated', {
      item: sanitized,
      chatId: item.chatId || null
    });
  } catch (err) {
    console.error('[OperationalItemEvent] Error al emitir operational_item_updated:', err.message);
  }
}
