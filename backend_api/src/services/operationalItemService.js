import crypto from 'crypto';
import defaultPrisma from '../db.js';

// ─── CONSTANTES Y ENUMS DE DOMINIO ───────────────────────────────────────────

export const VALID_TYPES = Object.freeze(['NOTE', 'TASK']);

export const VALID_CATEGORIES = Object.freeze([
  'GENERAL',
  'COORDINATION',
  'ATTENDANCE',
  'SERVICE_INSTRUCTION',
  'FOLLOW_UP',
  'ORDER_REQUEST',
  'SUPPORT',
  'OTHER'
]);

export const VALID_PRIORITIES = Object.freeze(['LOW', 'NORMAL', 'HIGH']);

export const VALID_NOTE_STATUSES = Object.freeze(['ACTIVE', 'ARCHIVED']);
export const VALID_TASK_STATUSES = Object.freeze(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELED']);

export const VALID_CREATED_BY_TYPES = Object.freeze(['AI', 'USER']);

export const MAX_SUMMARY_LENGTH = 300;
export const MAX_TITLE_LENGTH = 100;
export const MAX_SUBJECT_LENGTH = 80;
export const MAX_DETAILS_BYTES = 4096; // 4 KB

// ─── UTILIDADES PURAS: SANITIZACIÓN Y PRIVACIDAD ─────────────────────────────

/**
 * Sanitiza texto eliminando HTML, normalizando espacios y redactando datos sensibles.
 */
export function sanitizeOperationalText(rawText, maxLength = 300) {
  if (rawText === null || rawText === undefined) return null;
  let text = String(rawText);

  // 1. Eliminar etiquetas HTML
  text = text.replace(/<[^>]*>/g, ' ');

  // 2. Redactar datos altamente sensibles (Tarjetas, CVV, Contraseñas/Tokens)
  // Tarjetas: Secuencias de 13 a 19 dígitos (posiblemente separados por espacios o guiones)
  text = text.replace(/\b(?:\d[ -]*?){13,19}\b/g, '[TARJETA_REDACTADA]');
  // CVV / CVC
  text = text.replace(/\b(?:cvv|cvc|security code)\s*[:=]?\s*\d{3,4}\b/gi, '[CVV_REDACTADO]');
  // Contraseñas y API keys
  text = text.replace(/\b(?:password|contrase[ñn]a|token|api[_-]?key)\s*[:=]\s*\S+/gi, '[SECRETO_REDACTADO]');

  // 3. Normalizar espacios en blanco (múltiples espacios, saltos de línea repetidos)
  text = text.replace(/\s+/g, ' ').trim();

  // 4. Truncar a longitud máxima segura
  if (text.length > maxLength) {
    text = text.slice(0, maxLength).trim();
  }

  return text;
}

/**
 * Validador de formato de fecha YYYY-MM-DD
 */
export function isValidDateString(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;

  const [year, month, day] = dateStr.split('-').map(Number);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;

  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Validador de formato de hora 24h HH:mm
 */
export function isValidTimeString(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return false;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr);
}

/**
 * Genera la clave determinística de deduplicación SHA-256 para prevenir inserciones repetidas.
 */
export function buildOperationalItemDedupeKey({
  tenantId,
  sourceMessageId,
  type,
  category,
  summary
}) {
  if (!tenantId || !sourceMessageId) {
    return null;
  }

  const cleanTenant = String(tenantId).trim();
  const cleanMsgId = String(sourceMessageId).trim();
  const cleanType = String(type || '').trim().toUpperCase();
  const cleanCategory = String(category || '').trim().toUpperCase();
  const normalizedSummary = String(summary || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  const rawPayload = `${cleanTenant}:${cleanMsgId}:${cleanType}:${cleanCategory}:${normalizedSummary}`;
  return crypto.createHash('sha256').update(rawPayload, 'utf8').digest('hex');
}

// ─── VALIDACIÓN CENTRAL DEL PAYLOAD ──────────────────────────────────────────

export function validateOperationalItemPayload(data, isUpdate = false) {
  const errors = [];

  // Validar Type (requerido en creación)
  if (!isUpdate || data.type !== undefined) {
    if (!data.type || !VALID_TYPES.includes(data.type)) {
      errors.push(`Tipo inválido: '${data.type}'. Debe ser uno de: ${VALID_TYPES.join(', ')}.`);
    }
  }

  const effectiveType = data.type;

  // Validar Status según Type
  if (data.status !== undefined) {
    if (effectiveType === 'NOTE' && !VALID_NOTE_STATUSES.includes(data.status)) {
      errors.push(`Estado inválido '${data.status}' para tipo NOTE. Válidos: ${VALID_NOTE_STATUSES.join(', ')}.`);
    } else if (effectiveType === 'TASK' && !VALID_TASK_STATUSES.includes(data.status)) {
      errors.push(`Estado inválido '${data.status}' para tipo TASK. Válidos: ${VALID_TASK_STATUSES.join(', ')}.`);
    }
  }

  // Validar Category
  if (data.category !== undefined && data.category !== null) {
    if (!VALID_CATEGORIES.includes(data.category)) {
      errors.push(`Categoría inválida: '${data.category}'. Válidas: ${VALID_CATEGORIES.join(', ')}.`);
    }
  }

  // Validar Priority
  if (data.priority !== undefined && data.priority !== null) {
    if (!VALID_PRIORITIES.includes(data.priority)) {
      errors.push(`Prioridad inválida: '${data.priority}'. Válidas: ${VALID_PRIORITIES.join(', ')}.`);
    }
  }

  // Validar Summary (requerido en creación)
  if (!isUpdate || data.summary !== undefined) {
    const cleanSummary = sanitizeOperationalText(data.summary, MAX_SUMMARY_LENGTH);
    if (!cleanSummary || cleanSummary.length === 0) {
      errors.push('El campo summary es obligatorio y no puede estar vacío.');
    }
  }

  // Validar Fechas (dueDateLocal / dueTimeLocal)
  if (data.dueDateLocal !== undefined && data.dueDateLocal !== null) {
    if (!isValidDateString(data.dueDateLocal)) {
      errors.push(`dueDateLocal inválido: '${data.dueDateLocal}'. Debe ser YYYY-MM-DD válido.`);
    }
  }

  if (data.dueTimeLocal !== undefined && data.dueTimeLocal !== null) {
    if (!isValidTimeString(data.dueTimeLocal)) {
      errors.push(`dueTimeLocal inválido: '${data.dueTimeLocal}'. Debe ser HH:mm en formato 24 horas.`);
    }
    // REGLA CRÍTICA: dueTimeLocal no puede existir sin dueDateLocal
    const hasDueDate = (data.dueDateLocal !== undefined && data.dueDateLocal !== null) || (isUpdate && data.hasExistingDueDate);
    if (!hasDueDate) {
      errors.push('No se puede especificar dueTimeLocal sin un dueDateLocal asociado.');
    }
  }

  // Validar Details (JSON serializado <= 4KB)
  if (data.details !== undefined && data.details !== null) {
    if (typeof data.details !== 'object' || Array.isArray(data.details)) {
      errors.push('details debe ser un objeto JSON.');
    } else {
      try {
        const serialized = JSON.stringify(data.details);
        if (Buffer.byteLength(serialized, 'utf8') > MAX_DETAILS_BYTES) {
          errors.push(`details excede el límite máximo de ${MAX_DETAILS_BYTES} bytes.`);
        }
      } catch {
        errors.push('details no es un objeto JSON serializable.');
      }
    }
  }

  return errors;
}

// ─── VALIDACIÓN DE AISLAMIENTO MULTI-TENANT Y OWNERSHIP ───────────────────────

/**
 * Valida de forma cerrada que todas las entidades referenciadas pertenezcan al mismo tenantId.
 */
async function validateTenantOwnership({
  tenantId,
  customerId,
  contactId,
  chatId,
  sourceMessageId,
  orderId,
  createdByType,
  createdByUserId,
  prismaClient
}) {
  const db = prismaClient || defaultPrisma;

  if (customerId) {
    const cust = await db.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true }
    });
    if (!cust) {
      throw new Error(`CUSTOMER_TENANT_MISMATCH: Customer '${customerId}' no encontrado o no pertenece al tenant.`);
    }
  }

  if (contactId) {
    const contact = await db.contact.findFirst({
      where: { id: contactId, tenantId },
      select: { id: true }
    });
    if (!contact) {
      throw new Error(`CONTACT_TENANT_MISMATCH: Contact '${contactId}' no encontrado o no pertenece al tenant.`);
    }
  }

  if (chatId) {
    const chat = await db.chat.findFirst({
      where: { id: chatId, tenantId },
      select: { id: true, contactId: true }
    });
    if (!chat) {
      throw new Error(`CHAT_TENANT_MISMATCH: Chat '${chatId}' no encontrado o no pertenece al tenant.`);
    }
  }

  if (sourceMessageId) {
    const msg = await db.message.findFirst({
      where: { id: sourceMessageId, tenantId },
      select: { id: true, chatId: true }
    });
    if (!msg) {
      throw new Error(`MESSAGE_TENANT_MISMATCH: Message '${sourceMessageId}' no encontrado o no pertenece al tenant.`);
    }
    if (chatId && msg.chatId !== chatId) {
      throw new Error(`MESSAGE_CHAT_MISMATCH: Message '${sourceMessageId}' no pertenece al Chat '${chatId}'.`);
    }
  }

  if (orderId) {
    const ord = await db.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true }
    });
    if (!ord) {
      throw new Error(`ORDER_TENANT_MISMATCH: Order '${orderId}' no encontrado o no pertenece al tenant.`);
    }
  }

  // Creador
  if (createdByType === 'AI') {
    if (createdByUserId) {
      throw new Error('AI_CANNOT_HAVE_USER_ID: Un item creado por IA no puede tener un createdByUserId asignado.');
    }
  } else if (createdByType === 'USER') {
    if (!createdByUserId) {
      throw new Error('USER_REQUIRES_USER_ID: Un item creado por USER debe especificar createdByUserId.');
    }
    const user = await db.user.findFirst({
      where: { id: createdByUserId, tenantId },
      select: { id: true }
    });
    if (!user) {
      throw new Error(`USER_TENANT_MISMATCH: User '${createdByUserId}' no pertenece al tenant.`);
    }
  }
}

// ─── API PÚBLICA DEL SERVICIO ────────────────────────────────────────────────

/**
 * Crea un OperationalItem (NOTE o TASK) de forma segura e idempotente.
 */
export async function createOperationalItem(payload, options = {}) {
  const db = options.prismaClient || defaultPrisma;

  if (!payload || !payload.tenantId) {
    throw new Error('TENANT_REQUIRED: tenantId es obligatorio para crear un item operacional.');
  }

  const tenantId = String(payload.tenantId).trim();
  const type = String(payload.type || '').trim().toUpperCase();
  const category = payload.category ? String(payload.category).trim().toUpperCase() : 'GENERAL';
  const priority = payload.priority ? String(payload.priority).trim().toUpperCase() : 'NORMAL';
  const createdByType = payload.createdByType ? String(payload.createdByType).trim().toUpperCase() : 'AI';

  // Default status por tipo
  let status = payload.status ? String(payload.status).trim().toUpperCase() : null;
  if (!status) {
    status = (type === 'NOTE') ? 'ACTIVE' : 'PENDING';
  }

  const cleanSummary = sanitizeOperationalText(payload.summary, MAX_SUMMARY_LENGTH);
  const cleanTitle = sanitizeOperationalText(payload.title, MAX_TITLE_LENGTH);
  const cleanSubject = sanitizeOperationalText(payload.subjectName, MAX_SUBJECT_LENGTH);

  const cleanDueDate = payload.dueDateLocal ? String(payload.dueDateLocal).trim() : null;
  const cleanDueTime = payload.dueTimeLocal ? String(payload.dueTimeLocal).trim() : null;
  const dueAt = payload.dueAt ? new Date(payload.dueAt) : null;

  // Validación de contrato
  const validationErrors = validateOperationalItemPayload({
    type,
    status,
    category,
    priority,
    summary: cleanSummary,
    dueDateLocal: cleanDueDate,
    dueTimeLocal: cleanDueTime,
    details: payload.details
  }, false);

  if (validationErrors.length > 0) {
    throw new Error(`VALIDATION_ERROR: ${validationErrors.join(' | ')}`);
  }

  // Validación de relaciones y ownership
  await validateTenantOwnership({
    tenantId,
    customerId: payload.customerId || null,
    contactId: payload.contactId || null,
    chatId: payload.chatId || null,
    sourceMessageId: payload.sourceMessageId || null,
    orderId: payload.orderId || null,
    createdByType,
    createdByUserId: payload.createdByUserId || null,
    prismaClient: db
  });

  // Generación determinística de dedupeKey para creaciones basadas en mensaje
  let dedupeKey = payload.dedupeKey || null;
  if (!dedupeKey && payload.sourceMessageId) {
    dedupeKey = buildOperationalItemDedupeKey({
      tenantId,
      sourceMessageId: payload.sourceMessageId,
      type,
      category,
      summary: cleanSummary
    });
  }

  const createData = {
    tenantId,
    customerId: payload.customerId || null,
    contactId: payload.contactId || null,
    chatId: payload.chatId || null,
    sourceMessageId: payload.sourceMessageId || null,
    orderId: payload.orderId || null,
    type,
    category,
    title: cleanTitle,
    summary: cleanSummary,
    subjectName: cleanSubject,
    status,
    priority,
    createdByType,
    createdByUserId: payload.createdByUserId || null,
    dueDateLocal: cleanDueDate,
    dueTimeLocal: cleanDueTime,
    dueAt,
    dedupeKey,
    details: payload.details || null
  };

  try {
    const item = await db.operationalItem.create({
      data: createData
    });

    return {
      success: true,
      item,
      deduplicated: false
    };
  } catch (err) {
    // Si la BD reporta conflicto de unicidad en [tenantId, dedupeKey], retornamos el existente
    if (dedupeKey && (err.code === 'P2002' || (err.message && err.message.includes('dedupeKey')))) {
      const existing = await db.operationalItem.findFirst({
        where: {
          tenantId,
          dedupeKey
        }
      });
      if (existing) {
        return {
          success: true,
          item: existing,
          deduplicated: true
        };
      }
    }
    throw err;
  }
}

/**
 * Consulta un OperationalItem por su ID garantizando pertenencia al tenant.
 */
export async function getOperationalItemById({ tenantId, id }, options = {}) {
  const db = options.prismaClient || defaultPrisma;

  if (!tenantId || !id) {
    throw new Error('TENANT_AND_ID_REQUIRED: tenantId e id son obligatorios.');
  }

  return db.operationalItem.findFirst({
    where: {
      id,
      tenantId
    }
  });
}

/**
 * Lista items operacionales con filtros tenant-scoped y paginación acotada.
 */
export async function listOperationalItems({
  tenantId,
  type,
  status,
  chatId,
  customerId,
  category,
  dueDateLocal,
  limit = 50,
  offset = 0,
  orderBy = 'createdAt',
  orderDirection = 'desc'
}, options = {}) {
  const db = options.prismaClient || defaultPrisma;

  if (!tenantId) {
    throw new Error('TENANT_REQUIRED: tenantId es obligatorio.');
  }

  const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 100);
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

  const where = { tenantId };

  if (type && VALID_TYPES.includes(type)) where.type = type;
  if (status) where.status = status;
  if (chatId) where.chatId = chatId;
  if (customerId) where.customerId = customerId;
  if (category && VALID_CATEGORIES.includes(category)) where.category = category;
  if (dueDateLocal) where.dueDateLocal = dueDateLocal;

  const validOrderFields = ['createdAt', 'updatedAt', 'dueAt', 'dueDateLocal'];
  const sortField = validOrderFields.includes(orderBy) ? orderBy : 'createdAt';
  const sortDirection = orderDirection === 'asc' ? 'asc' : 'desc';

  const [items, total] = await Promise.all([
    db.operationalItem.findMany({
      where,
      take: safeLimit,
      skip: safeOffset,
      orderBy: { [sortField]: sortDirection }
    }),
    db.operationalItem.count({ where })
  ]);

  return {
    items,
    total,
    limit: safeLimit,
    offset: safeOffset
  };
}

/**
 * Actualiza campos semánticos y de fecha de un OperationalItem.
 * Prohíbe terminantemente alterar tenantId, IDs relacionales o dedupeKey.
 */
export async function updateOperationalItem({ tenantId, id, updates }, options = {}) {
  const db = options.prismaClient || defaultPrisma;

  if (!tenantId || !id) {
    throw new Error('TENANT_AND_ID_REQUIRED: tenantId e id son obligatorios.');
  }

  // Lista negra estricta de campos no actualizables vía update genérico
  const prohibitedFields = [
    'tenantId',
    'customerId',
    'contactId',
    'chatId',
    'sourceMessageId',
    'orderId',
    'createdByType',
    'createdByUserId',
    'completedAt',
    'completedByUserId',
    'dedupeKey',
    'type',
    'status'
  ];

  for (const field of prohibitedFields) {
    if (updates[field] !== undefined) {
      throw new Error(`PROHIBITED_FIELD_UPDATE: El campo '${field}' no puede modificarse mediante update genérico.`);
    }
  }

  const existing = await db.operationalItem.findFirst({
    where: { id, tenantId }
  });

  if (!existing) {
    throw new Error('ITEM_NOT_FOUND: Item no encontrado en este tenant.');
  }

  const cleanUpdates = {};

  if (updates.summary !== undefined) {
    cleanUpdates.summary = sanitizeOperationalText(updates.summary, MAX_SUMMARY_LENGTH);
  }
  if (updates.title !== undefined) {
    cleanUpdates.title = sanitizeOperationalText(updates.title, MAX_TITLE_LENGTH);
  }
  if (updates.subjectName !== undefined) {
    cleanUpdates.subjectName = sanitizeOperationalText(updates.subjectName, MAX_SUBJECT_LENGTH);
  }
  if (updates.category !== undefined) {
    cleanUpdates.category = updates.category ? String(updates.category).trim().toUpperCase() : 'GENERAL';
  }
  if (updates.priority !== undefined) {
    cleanUpdates.priority = updates.priority ? String(updates.priority).trim().toUpperCase() : 'NORMAL';
  }
  if (updates.dueDateLocal !== undefined) {
    cleanUpdates.dueDateLocal = updates.dueDateLocal ? String(updates.dueDateLocal).trim() : null;
  }
  if (updates.dueTimeLocal !== undefined) {
    cleanUpdates.dueTimeLocal = updates.dueTimeLocal ? String(updates.dueTimeLocal).trim() : null;
  }
  if (updates.dueAt !== undefined) {
    cleanUpdates.dueAt = updates.dueAt ? new Date(updates.dueAt) : null;
  }
  if (updates.details !== undefined) {
    cleanUpdates.details = updates.details;
  }

  // Validar el resultado contra las reglas del dominio
  const validationErrors = validateOperationalItemPayload({
    type: existing.type,
    category: cleanUpdates.category ?? existing.category,
    priority: cleanUpdates.priority ?? existing.priority,
    summary: cleanUpdates.summary ?? existing.summary,
    dueDateLocal: cleanUpdates.dueDateLocal !== undefined ? cleanUpdates.dueDateLocal : existing.dueDateLocal,
    dueTimeLocal: cleanUpdates.dueTimeLocal !== undefined ? cleanUpdates.dueTimeLocal : existing.dueTimeLocal,
    details: cleanUpdates.details !== undefined ? cleanUpdates.details : existing.details,
    hasExistingDueDate: Boolean(cleanUpdates.dueDateLocal || existing.dueDateLocal)
  }, true);

  if (validationErrors.length > 0) {
    throw new Error(`VALIDATION_ERROR: ${validationErrors.join(' | ')}`);
  }

  return db.operationalItem.update({
    where: { id: existing.id },
    data: cleanUpdates
  });
}

/**
 * Completa una tarea operacional (TASK).
 * Prohibido sobre notas (NOTE). Requiere usuario del mismo tenant.
 */
export async function completeOperationalTask({ tenantId, id, userId }, options = {}) {
  const db = options.prismaClient || defaultPrisma;

  if (!tenantId || !id || !userId) {
    throw new Error('PARAM_MISSING: tenantId, id y userId son obligatorios para completar una tarea.');
  }

  // Validar usuario
  const user = await db.user.findFirst({
    where: { id: userId, tenantId },
    select: { id: true }
  });
  if (!user) {
    throw new Error(`USER_TENANT_MISMATCH: User '${userId}' no pertenece al tenant.`);
  }

  const item = await db.operationalItem.findFirst({
    where: { id, tenantId }
  });

  if (!item) {
    throw new Error('ITEM_NOT_FOUND: Tarea no encontrada en este tenant.');
  }

  if (item.type !== 'TASK') {
    throw new Error(`CANNOT_COMPLETE_NON_TASK: No se puede completar un item de tipo '${item.type}'. Use archive para notas.`);
  }

  return db.operationalItem.update({
    where: { id: item.id },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      completedByUserId: userId
    }
  });
}

/**
 * Archiva una nota operacional (NOTE).
 * Prohibido sobre tareas (TASK).
 */
export async function archiveOperationalNote({ tenantId, id }, options = {}) {
  const db = options.prismaClient || defaultPrisma;

  if (!tenantId || !id) {
    throw new Error('TENANT_AND_ID_REQUIRED: tenantId e id son obligatorios.');
  }

  const item = await db.operationalItem.findFirst({
    where: { id, tenantId }
  });

  if (!item) {
    throw new Error('ITEM_NOT_FOUND: Nota no encontrada en este tenant.');
  }

  if (item.type !== 'NOTE') {
    throw new Error(`CANNOT_ARCHIVE_NON_NOTE: No se puede archivar un item de tipo '${item.type}'. Use cancel para tareas.`);
  }

  return db.operationalItem.update({
    where: { id: item.id },
    data: {
      status: 'ARCHIVED'
    }
  });
}

/**
 * Cancela una tarea operacional (TASK).
 * Prohibido sobre notas (NOTE).
 */
export async function cancelOperationalTask({ tenantId, id }, options = {}) {
  const db = options.prismaClient || defaultPrisma;

  if (!tenantId || !id) {
    throw new Error('TENANT_AND_ID_REQUIRED: tenantId e id son obligatorios.');
  }

  const item = await db.operationalItem.findFirst({
    where: { id, tenantId }
  });

  if (!item) {
    throw new Error('ITEM_NOT_FOUND: Tarea no encontrada en este tenant.');
  }

  if (item.type !== 'TASK') {
    throw new Error(`CANNOT_CANCEL_NON_TASK: No se puede cancelar un item de tipo '${item.type}'.`);
  }

  return db.operationalItem.update({
    where: { id: item.id },
    data: {
      status: 'CANCELED'
    }
  });
}
