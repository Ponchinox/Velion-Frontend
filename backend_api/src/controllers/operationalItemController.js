import {
  createOperationalItem,
  getOperationalItemById,
  listOperationalItems,
  updateOperationalItem,
  startOperationalTask,
  completeOperationalTask,
  archiveOperationalNote,
  cancelOperationalTask
} from '../services/operationalItemService.js';
import {
  emitOperationalItemCreated,
  emitOperationalItemUpdated
} from '../services/operationalItemEventService.js';

/**
 * Mapea excepciones del servicio a códigos HTTP adecuados y respuestas consistentes.
 */
function handleServiceError(err, res) {
  const msg = err.message || '';

  if (msg.includes('ITEM_NOT_FOUND')) {
    return res.status(404).json({ success: false, error: msg });
  }

  if (
    msg.includes('VALIDATION_ERROR') ||
    msg.includes('PROHIBITED_FIELD_UPDATE') ||
    msg.includes('CANNOT_START_NON_TASK') ||
    msg.includes('CANNOT_COMPLETE_NON_TASK') ||
    msg.includes('CANNOT_ARCHIVE_NON_NOTE') ||
    msg.includes('CANNOT_CANCEL_NON_TASK') ||
    msg.includes('INVALID_TASK_TRANSITION') ||
    msg.includes('PARAM_MISSING') ||
    msg.includes('TENANT_REQUIRED') ||
    msg.includes('TENANT_AND_ID_REQUIRED') ||
    msg.includes('LIMIT_EXCEEDED') ||
    msg.includes('INVALID_') ||
    msg.includes('FORBIDDEN_')
  ) {
    return res.status(400).json({ success: false, error: msg });
  }

  if (
    msg.includes('TENANT_MISMATCH') ||
    msg.includes('CROSS_TENANT') ||
    msg.includes('CHAT_MISMATCH') ||
    msg.includes('USER_TENANT_MISMATCH')
  ) {
    return res.status(400).json({ success: false, error: msg });
  }

  console.error('[OperationalItemController] Error no controlado:', err);
  return res.status(500).json({ success: false, error: 'Internal server error' });
}

/**
 * GET /api/operational-items
 * Lista items operacionales del tenant autenticado con filtros y paginación acotada.
 */
export async function getItems(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED: tenantId no encontrado en sesión.' });
    }

    const {
      type,
      status,
      chatId,
      customerId,
      category,
      dueDateLocal,
      limit,
      offset,
      orderBy,
      orderDirection
    } = req.query;

    if (limit !== undefined && parseInt(limit, 10) > 100) {
      return res.status(400).json({
        success: false,
        error: 'LIMIT_EXCEEDED: El límite máximo permitido es 100.'
      });
    }

    const serviceOptions = req.prismaClient ? { prismaClient: req.prismaClient } : {};

    const result = await listOperationalItems({
      tenantId,
      type: type ? String(type).trim().toUpperCase() : undefined,
      status: status ? String(status).trim().toUpperCase() : undefined,
      chatId,
      customerId,
      category: category ? String(category).trim().toUpperCase() : undefined,
      dueDateLocal,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
      orderBy,
      orderDirection
    }, serviceOptions);

    return res.json({
      success: true,
      items: result.items,
      total: result.total,
      pagination: {
        limit: result.limit,
        offset: result.offset
      }
    });
  } catch (error) {
    return handleServiceError(error, res);
  }
}

/**
 * GET /api/operational-items/:id
 * Consulta un item operacional por su ID garantizando pertenencia al tenant.
 */
export async function getItemById(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED: tenantId no encontrado en sesión.' });
    }

    const { id } = req.params;
    const serviceOptions = req.prismaClient ? { prismaClient: req.prismaClient } : {};

    const item = await getOperationalItemById({ tenantId, id }, serviceOptions);
    if (!item) {
      return res.status(404).json({ success: false, error: 'ITEM_NOT_FOUND: Item no encontrado.' });
    }

    return res.json({ success: true, item });
  } catch (error) {
    return handleServiceError(error, res);
  }
}

/**
 * POST /api/operational-items
 * Creación manual de un item operacional por parte de un operador humano.
 */
export async function createItem(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    const userId = req.user?.id || req.user?.userId;

    if (!tenantId || !userId) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Sesión inválida o incompleta.' });
    }

    // Validaciones defensivas contra spoofing / inyecciones de campos protegidos
    if (req.body.tenantId && req.body.tenantId !== tenantId) {
      return res.status(400).json({
        success: false,
        error: 'FORBIDDEN_FIELD: No se puede especificar un tenantId en el body.'
      });
    }

    if (req.body.createdByType && String(req.body.createdByType).trim().toUpperCase() !== 'USER') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_CREATED_BY_TYPE: Creación manual solo admite createdByType = USER.'
      });
    }

    if (req.body.sourceMessageId) {
      return res.status(400).json({
        success: false,
        error: 'FORBIDDEN_FIELD: sourceMessageId no está permitido en creación manual.'
      });
    }

    if (req.body.createdByUserId && req.body.createdByUserId !== userId) {
      return res.status(400).json({
        success: false,
        error: 'FORBIDDEN_FIELD: createdByUserId no puede ser asignado manualmente.'
      });
    }

    if (req.body.completedByUserId || req.body.completedAt || req.body.dedupeKey || req.body.status) {
      return res.status(400).json({
        success: false,
        error: 'FORBIDDEN_FIELD: No se permite definir status inicial, dedupeKey ni campos de completado.'
      });
    }

    if (req.body.dueAt) {
      return res.status(400).json({
        success: false,
        error: 'FORBIDDEN_FIELD: dueAt no puede especificarse en el body.'
      });
    }

    const payload = {
      tenantId,
      type: req.body.type,
      category: req.body.category,
      title: req.body.title,
      summary: req.body.summary,
      subjectName: req.body.subjectName,
      priority: req.body.priority,
      dueDateLocal: req.body.dueDateLocal,
      dueTimeLocal: req.body.dueTimeLocal,
      details: req.body.details,
      customerId: req.body.customerId,
      contactId: req.body.contactId,
      chatId: req.body.chatId,
      orderId: req.body.orderId,
      createdByType: 'USER',
      createdByUserId: userId
    };

    const serviceOptions = req.prismaClient ? { prismaClient: req.prismaClient } : {};
    const result = await createOperationalItem(payload, serviceOptions);

    const io = req.io || global.io;
    emitOperationalItemCreated({ io, tenantId, item: result.item });

    return res.status(201).json({
      success: true,
      item: result.item
    });
  } catch (error) {
    return handleServiceError(error, res);
  }
}

/**
 * PATCH /api/operational-items/:id
 * Actualiza campos semánticos de un item operacional.
 */
export async function updateItem(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED: tenantId no encontrado en sesión.' });
    }

    const { id } = req.params;

    // Campos prohibidos para edición (el cliente HTTP jamás define dueAt ni metadatos internos)
    const prohibitedFields = [
      'tenantId',
      'type',
      'status',
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
      'dueAt'
    ];

    for (const key of prohibitedFields) {
      if (req.body[key] !== undefined) {
        return res.status(400).json({
          success: false,
          error: `PROHIBITED_FIELD_UPDATE: El campo '${key}' no puede modificarse mediante update.`
        });
      }
    }

    const updates = {
      title: req.body.title,
      summary: req.body.summary,
      category: req.body.category,
      subjectName: req.body.subjectName,
      priority: req.body.priority,
      dueDateLocal: req.body.dueDateLocal,
      dueTimeLocal: req.body.dueTimeLocal,
      details: req.body.details
    };

    // Si se modifica la fecha o la hora local, el backend resetea dueAt a null internamente
    // para evitar almacenar un timestamp UTC desactualizado o inconsistente
    if (req.body.dueDateLocal !== undefined || req.body.dueTimeLocal !== undefined) {
      updates.dueAt = null;
    }

    const serviceOptions = req.prismaClient ? { prismaClient: req.prismaClient } : {};
    const updated = await updateOperationalItem({ tenantId, id, updates }, serviceOptions);

    const io = req.io || global.io;
    emitOperationalItemUpdated({ io, tenantId, item: updated });

    return res.json({
      success: true,
      item: updated
    });
  } catch (error) {
    return handleServiceError(error, res);
  }
}

/**
 * POST /api/operational-items/:id/start
 * Inicia una tarea operacional (TASK) pasando a IN_PROGRESS.
 */
export async function startItem(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    const userId = req.user?.id || req.user?.userId;

    if (!tenantId || !userId) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Sesión inválida.' });
    }

    const { id } = req.params;
    const serviceOptions = req.prismaClient ? { prismaClient: req.prismaClient } : {};

    const started = await startOperationalTask({ tenantId, id, userId }, serviceOptions);

    const io = req.io || global.io;
    emitOperationalItemUpdated({ io, tenantId, item: started });

    return res.json({
      success: true,
      item: started
    });
  } catch (error) {
    return handleServiceError(error, res);
  }
}

/**
 * POST /api/operational-items/:id/complete
 * Marca una tarea (TASK) como completada.
 */
export async function completeItem(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    const userId = req.user?.id || req.user?.userId;

    if (!tenantId || !userId) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Sesión inválida.' });
    }

    const { id } = req.params;
    const serviceOptions = req.prismaClient ? { prismaClient: req.prismaClient } : {};

    const completed = await completeOperationalTask({ tenantId, id, userId }, serviceOptions);

    const io = req.io || global.io;
    emitOperationalItemUpdated({ io, tenantId, item: completed });

    return res.json({
      success: true,
      item: completed
    });
  } catch (error) {
    return handleServiceError(error, res);
  }
}

/**
 * POST /api/operational-items/:id/archive
 * Archiva una nota (NOTE).
 */
export async function archiveItem(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Sesión inválida.' });
    }

    const { id } = req.params;
    const serviceOptions = req.prismaClient ? { prismaClient: req.prismaClient } : {};

    const archived = await archiveOperationalNote({ tenantId, id }, serviceOptions);

    const io = req.io || global.io;
    emitOperationalItemUpdated({ io, tenantId, item: archived });

    return res.json({
      success: true,
      item: archived
    });
  } catch (error) {
    return handleServiceError(error, res);
  }
}

/**
 * POST /api/operational-items/:id/cancel
 * Cancela una tarea (TASK).
 */
export async function cancelItem(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Sesión inválida.' });
    }

    const { id } = req.params;
    const serviceOptions = req.prismaClient ? { prismaClient: req.prismaClient } : {};

    const canceled = await cancelOperationalTask({ tenantId, id }, serviceOptions);

    const io = req.io || global.io;
    emitOperationalItemUpdated({ io, tenantId, item: canceled });

    return res.json({
      success: true,
      item: canceled
    });
  } catch (error) {
    return handleServiceError(error, res);
  }
}
