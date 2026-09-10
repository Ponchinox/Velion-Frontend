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
 * Ordenamiento determinista y transitivo de tareas:
 * 1. Jerarquía de estados: IN_PROGRESS (0) -> PENDING (1) -> COMPLETED (2) -> CANCELED (3)
 * 2. Para tareas activas (IN_PROGRESS y PENDING):
 *    - Tareas con fecha antes que sin fecha
 *    - Fecha ascendente
 *    - Si coinciden en fecha: tarea con hora antes que sin hora; si ambas tienen hora, hora ascendente
 * 3. Fallback createdAt descendente (más reciente primero)
 * 4. Fallback updatedAt descendente
 * 5. Tie-breaker estricto final por id ascendente (total order)
 */
export function sortTasks(tasks = []) {
  const statusWeight = {
    IN_PROGRESS: 0,
    PENDING: 1,
    COMPLETED: 2,
    CANCELED: 3,
  };

  return [...tasks].sort((a, b) => {
    // 1. Jerarquía de estados
    const weightA = statusWeight[a.status] ?? 99;
    const weightB = statusWeight[b.status] ?? 99;
    if (weightA !== weightB) {
      return weightA - weightB;
    }

    // 2. Para tareas activas (IN_PROGRESS y PENDING), orden de vencimiento
    if (weightA < 2) {
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
        return -1; // Tarea con fecha primero que tarea sin fecha
      } else if (hasDateB) {
        return 1;
      }
    }

    // 3. Fallback determinista por createdAt descendente (más reciente primero)
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    if (timeA !== timeB) {
      return timeB - timeA;
    }

    // 4. Fallback por updatedAt descendente
    const updA = new Date(a.updatedAt || 0).getTime();
    const updB = new Date(b.updatedAt || 0).getTime();
    if (updA !== updB) {
      return updB - updA;
    }

    // 5. Clave total final por id ascendente (garantiza transitividad estricta)
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
