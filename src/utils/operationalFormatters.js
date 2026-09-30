/**
 * Utilidades puras para items operacionales (Notas y Tareas)
 * Velion Business Agent — Fase 2D-B
 */

export const NOTE_CATEGORIES = [
  { value: 'COORDINATION', label: 'Coordinación' },
  { value: 'ATTENDANCE', label: 'Asistencia / Turno' },
  { value: 'SERVICE_INSTRUCTION', label: 'Instrucción de servicio' },
  { value: 'ORDER_REQUEST', label: 'Solicitud de pedido' },
  { value: 'GENERAL', label: 'General' },
  { value: 'SUPPORT', label: 'Soporte' },
  { value: 'OTHER', label: 'Otro' },
];

export const TASK_CATEGORIES = [
  { value: 'FOLLOW_UP', label: 'Seguimiento' },
  { value: 'COORDINATION', label: 'Coordinación' },
  { value: 'ORDER_REQUEST', label: 'Solicitud de pedido' },
  { value: 'SUPPORT', label: 'Soporte' },
  { value: 'GENERAL', label: 'General' },
  { value: 'OTHER', label: 'Otro' },
];

export const TASK_PRIORITIES = [
  { value: 'LOW', label: 'Baja' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'Alta' },
];

export function formatStatus(status) {
  const map = {
    PENDING: 'Pendiente',
    IN_PROGRESS: 'En progreso',
    COMPLETED: 'Completada',
    CANCELED: 'Cancelada',
    ACTIVE: 'Activa',
    ARCHIVED: 'Archivada',
  };
  return map[status] || status || 'Desconocido';
}

export function formatPriority(priority) {
  const map = {
    LOW: 'Baja',
    NORMAL: 'Normal',
    HIGH: 'Alta',
  };
  return map[priority] || priority || 'Normal';
}

export function formatCategory(category, type = 'TASK') {
  const list = type === 'NOTE' ? NOTE_CATEGORIES : TASK_CATEGORIES;
  const found = list.find((c) => c.value === category);
  return found ? found.label : (category || 'General');
}

export function formatCreatedByType(type) {
  const map = {
    AI: 'IA Velion',
    USER: 'Usuario',
    SYSTEM: 'Sistema',
  };
  return map[type] || type || 'Sistema';
}

/**
 * Formatea fecha y hora local para presentación visual.
 * NO utiliza dueAt. Solo dueDateLocal y dueTimeLocal.
 */
export function formatDueDate(dueDateLocal, dueTimeLocal) {
  if (!dueDateLocal) return null;

  // dueDateLocal viene como YYYY-MM-DD
  const parts = dueDateLocal.split('-');
  let dateFormatted = dueDateLocal;
  if (parts.length === 3) {
    const [year, month, day] = parts;
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const monthName = months[parseInt(month, 10) - 1] || month;
    dateFormatted = `${parseInt(day, 10)} ${monthName} ${year}`;
  }

  if (dueTimeLocal) {
    return `${dateFormatted} • ${dueTimeLocal}`;
  }
  return dateFormatted;
}

export function formatDateTime(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/**
 * Cuenta únicamente items activos:
 * - TASK: PENDING o IN_PROGRESS
 * - NOTE: ACTIVE
 * No cuenta COMPLETED, CANCELED ni ARCHIVED.
 */
export function calculateActiveBadgeCount(items = []) {
  if (!Array.isArray(items)) return 0;
  return items.filter((item) => {
    if (item.type === 'TASK') {
      return item.status === 'PENDING' || item.status === 'IN_PROGRESS';
    }
    if (item.type === 'NOTE') {
      return item.status === 'ACTIVE';
    }
    return false;
  }).length;
}

/**
 * Determina si una versión entrante (incoming) debe reemplazar a una existente.
 * Política de frescura por updatedAt y defensa de estados terminales.
 */
export function shouldReplaceItem(existing, incoming) {
  if (!existing) return true;
  if (!incoming) return false;

  const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : NaN;
  const incomingTime = incoming.updatedAt ? new Date(incoming.updatedAt).getTime() : NaN;

  const hasExistingTime = !isNaN(existingTime);
  const hasIncomingTime = !isNaN(incomingTime);

  // 1. Si ambos tienen updatedAt válido
  if (hasExistingTime && hasIncomingTime) {
    if (incomingTime > existingTime) {
      return true;
    }
    if (incomingTime < existingTime) {
      return false; // Incoming es estrictamente anterior, conservar existing
    }

    // Si timestamps son iguales:
    // Terminal state defense: un estado terminal formal COMPLETED/CANCELED no se degrada a PENDING/IN_PROGRESS
    const isExistingTerminal = existing.type === 'TASK' && (existing.status === 'COMPLETED' || existing.status === 'CANCELED');
    const isIncomingNonTerminal = incoming.type === 'TASK' && (incoming.status === 'PENDING' || incoming.status === 'IN_PROGRESS');
    if (isExistingTerminal && isIncomingNonTerminal) {
      return false;
    }
    return true;
  }

  // 2. Si falta updatedAt en uno o ambos, fallback a createdAt
  const existingCreated = existing.createdAt ? new Date(existing.createdAt).getTime() : NaN;
  const incomingCreated = incoming.createdAt ? new Date(incoming.createdAt).getTime() : NaN;
  if (!isNaN(existingCreated) && !isNaN(incomingCreated)) {
    if (incomingCreated < existingCreated) {
      return false;
    }
  }

  // 3. Defensa secundaria de estado terminal si no hay timestamp válido de actualización
  const isExistingTerminal = existing.type === 'TASK' && (existing.status === 'COMPLETED' || existing.status === 'CANCELED');
  const isIncomingNonTerminal = incoming.type === 'TASK' && (incoming.status === 'PENDING' || incoming.status === 'IN_PROGRESS');
  if (isExistingTerminal && isIncomingNonTerminal) {
    return false;
  }

  // 4. Fail-safe por defecto: aceptar versión entrante legítima
  return true;
}

/**
 * Inserción/actualización protegida por frescura de versión e idempotencia por id
 */
export function upsertItem(items = [], newItem) {
  if (!newItem || !newItem.id) return items;
  const index = items.findIndex((i) => i.id === newItem.id);
  if (index >= 0) {
    const existing = items[index];
    if (!shouldReplaceItem(existing, newItem)) {
      return items;
    }
    const copy = [...items];
    copy[index] = newItem;
    return copy;
  }
  return [newItem, ...items];
}

/**
 * Reconcilia una lista de items en memoria (que puede incluir eventos Socket recientes)
 * con un snapshot obtenido vía REST GET.
 * Preserva items del GET, items Socket recibidos en vuelo y conserva la versión más fresca de cada item.id.
 */
export function reconcileItems(currentItems = [], incomingItems = []) {
  if (!Array.isArray(incomingItems)) return currentItems;
  if (!Array.isArray(currentItems) || currentItems.length === 0) return incomingItems;

  let result = [...currentItems];
  for (const item of incomingItems) {
    result = upsertItem(result, item);
  }
  return result;
}

/**
 * Validador frontend para creación de items operacionales.
 * Bloquea combinaciones inválidas antes de enviar al backend (ej: dueTimeLocal sin dueDateLocal).
 */
export function validateOperationalInput(input) {
  if (!input) {
    return { valid: false, error: 'Datos de formulario inválidos.' };
  }
  if (!input.summary || !input.summary.trim()) {
    return { valid: false, error: 'El resumen/descripción es obligatorio.' };
  }
  if (!input.chatId) {
    return { valid: false, error: 'No se encontró una conversación activa.' };
  }
  if (input.type === 'TASK' && input.dueTimeLocal && !input.dueDateLocal) {
    return { valid: false, error: 'Selecciona una fecha antes de indicar una hora.' };
  }
  return { valid: true, error: null };
}

/**
 * Obtiene la fecha/hora límite (deadline) de una tarea como objeto Date.
 * Considera dueDateLocal y dueTimeLocal, con fallback a dueAt.
 * Si solo se especifica fecha sin hora, el deadline es el final del día local (23:59:59.999).
 */
export function getTaskDeadline(item) {
  if (!item || item.type !== 'TASK') return null;

  if (item.dueDateLocal && typeof item.dueDateLocal === 'string') {
    const parts = item.dueDateLocal.split('-').map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
      const [year, month, day] = parts;
      if (item.dueTimeLocal && typeof item.dueTimeLocal === 'string') {
        const timeParts = item.dueTimeLocal.split(':').map(Number);
        if (timeParts.length >= 2 && !timeParts.slice(0, 2).some(isNaN)) {
          const [hours, minutes] = timeParts;
          const d = new Date(year, month - 1, day, hours, minutes, 0, 0);
          if (!isNaN(d.getTime())) return d;
        }
      }
      // Sin hora: límite al final del día local (23:59:59.999)
      const d = new Date(year, month - 1, day, 23, 59, 59, 999);
      if (!isNaN(d.getTime())) return d;
    }
  }

  if (item.dueAt) {
    const d = new Date(item.dueAt);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

/**
 * Determina dinámicamente si una tarea está vencida (overdue).
 * Una tarea es OVERDUE únicamente si:
 * 1. type === 'TASK'
 * 2. status IN ('PENDING', 'IN_PROGRESS')
 * 3. Existe fecha/hora límite válida
 * 4. deadline < now
 * COMPLETED y CANCELED nunca deben mostrarse como vencidas.
 */
export function isTaskOverdue(item, now = new Date()) {
  if (!item || item.type !== 'TASK') return false;
  if (item.status !== 'PENDING' && item.status !== 'IN_PROGRESS') return false;

  const deadline = getTaskDeadline(item);
  if (!deadline) return false;

  const currentTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (isNaN(currentTime)) return false;

  return deadline.getTime() < currentTime;
}

/**
 * Asigna el bucket de prioridad visual para ordenamiento de tareas:
 * 1. OVERDUE + HIGH
 * 2. OVERDUE + NORMAL
 * 3. OVERDUE + LOW
 * 4. PENDING/IN_PROGRESS + HIGH
 * 5. PENDING/IN_PROGRESS + NORMAL
 * 6. PENDING/IN_PROGRESS + LOW
 * 7. Resto por dueAt/dueDate
 * 8. COMPLETED/CANCELED al final
 */
export function getTaskSortBucket(task, now = new Date()) {
  const isTerminal = task.status === 'COMPLETED' || task.status === 'CANCELED';
  if (isTerminal) return 8;

  const overdue = isTaskOverdue(task, now);
  const priority = (task.priority || '').toUpperCase();

  if (overdue) {
    if (priority === 'HIGH') return 1;
    if (priority === 'LOW') return 3;
    // NORMAL o default/no especificado
    return 2;
  }

  // Activas no vencidas
  if (priority === 'HIGH') return 4;
  if (priority === 'NORMAL') return 5;
  if (priority === 'LOW') return 6;

  // Resto de tareas activas sin prioridad definida o no estándar
  return 7;
}

/**
 * Ordenamiento determinista y transitivo de tareas con priorización visual:
 * 1. OVERDUE + HIGH
 * 2. OVERDUE + NORMAL
 * 3. OVERDUE + LOW
 * 4. PENDING/IN_PROGRESS + HIGH
 * 5. PENDING/IN_PROGRESS + NORMAL
 * 6. PENDING/IN_PROGRESS + LOW
 * 7. Resto por dueAt/dueDate
 * 8. COMPLETED/CANCELED al final
 *
 * Dentro de cada grupo: deadline más próxima primero; fallback createdAt descendente.
 * Clave total final por id ascendente (garantiza transitividad estricta).
 */
export function sortTasks(tasks = [], now = new Date()) {
  return [...tasks].sort((a, b) => {
    // 1. Jerarquía de buckets recomendada por UX
    const bucketA = getTaskSortBucket(a, now);
    const bucketB = getTaskSortBucket(b, now);
    if (bucketA !== bucketB) {
      return bucketA - bucketB;
    }

    // 2. Si ambos son estados terminales (Bucket 8: COMPLETED / CANCELED)
    if (bucketA === 8) {
      const termWeight = { COMPLETED: 0, CANCELED: 1 };
      const twA = termWeight[a.status] ?? 99;
      const twB = termWeight[b.status] ?? 99;
      if (twA !== twB) return twA - twB;

      const compA = new Date(a.completedAt || 0).getTime();
      const compB = new Date(b.completedAt || 0).getTime();
      if (compA !== compB) return compB - compA;
    }

    // 3. Dentro de cada grupo: deadline más próxima primero
    const hasDateA = Boolean(a.dueDateLocal);
    const hasDateB = Boolean(b.dueDateLocal);

    if (hasDateA && hasDateB) {
      const cmpDate = a.dueDateLocal.localeCompare(b.dueDateLocal);
      if (cmpDate !== 0) return cmpDate;

      // Misma fecha: comparar hora
      const hasTimeA = Boolean(a.dueTimeLocal);
      const hasTimeB = Boolean(b.dueTimeLocal);
      if (hasTimeA && hasTimeB) {
        const cmpTime = a.dueTimeLocal.localeCompare(b.dueTimeLocal);
        if (cmpTime !== 0) return cmpTime;
      } else if (hasTimeA) {
        return -1; // Con hora específica primero en el día
      } else if (hasTimeB) {
        return 1;
      }
    } else if (hasDateA) {
      return -1; // Tarea con fecha antes que tarea sin fecha
    } else if (hasDateB) {
      return 1;
    } else if (a.dueAt || b.dueAt) {
      // Fallback a dueAt si uno o ambos lo tienen
      const deadA = a.dueAt ? new Date(a.dueAt).getTime() : NaN;
      const deadB = b.dueAt ? new Date(b.dueAt).getTime() : NaN;
      const hasDeadA = !isNaN(deadA);
      const hasDeadB = !isNaN(deadB);
      if (hasDeadA && hasDeadB) {
        if (deadA !== deadB) return deadA - deadB;
      } else if (hasDeadA) {
        return -1;
      } else if (hasDeadB) {
        return 1;
      }
    }

    // 4. Si empatan en deadline o ambas carecen de fecha:
    // IN_PROGRESS antes que PENDING
    const statusWeight = { IN_PROGRESS: 0, PENDING: 1 };
    const swA = statusWeight[a.status] ?? 99;
    const swB = statusWeight[b.status] ?? 99;
    if (swA !== swB) {
      return swA - swB;
    }

    // 5. Fallback determinista por createdAt descendente (más reciente primero)
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    if (timeA !== timeB) {
      return timeB - timeA;
    }

    // 6. Fallback por updatedAt descendente
    const updA = new Date(a.updatedAt || 0).getTime();
    const updB = new Date(b.updatedAt || 0).getTime();
    if (updA !== updB) {
      return updB - updA;
    }

    // 7. Clave total final por id ascendente (garantiza transitividad estricta)
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

/**
 * Ordenamiento determinista de notas:
 * 1. ACTIVE (0) -> ARCHIVED (1)
 * 2. createdAt descendente
 * 3. updatedAt descendente
 * 4. id ascendente
 */
export function sortNotes(notes = []) {
  const statusWeight = {
    ACTIVE: 0,
    ARCHIVED: 1,
  };

  return [...notes].sort((a, b) => {
    const weightA = statusWeight[a.status] ?? 99;
    const weightB = statusWeight[b.status] ?? 99;
    if (weightA !== weightB) {
      return weightA - weightB;
    }

    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    if (timeA !== timeB) {
      return timeB - timeA;
    }

    const updA = new Date(a.updatedAt || 0).getTime();
    const updB = new Date(b.updatedAt || 0).getTime();
    if (updA !== updB) {
      return updB - updA;
    }

    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}
