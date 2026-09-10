import { apiClient } from './api.js';

/**
 * Servicio para items operacionales (Notas y Tareas)
 * Velion Business Agent — Fase 2D-B
 */

/**
 * Obtiene los items operacionales para un chatId específico.
 * Soporta options.signal para cancelación de peticiones con AbortController.
 * Nunca envía tenantId manualmente (el backend lo deriva del JWT).
 */
export async function getOperationalItems(chatId, options = {}) {
  if (!chatId) return [];
  const endpoint = `/operational-items?chatId=${encodeURIComponent(chatId)}&limit=100`;
  const response = await apiClient(endpoint, {
    method: 'GET',
    ...options,
  });
  // El backend retorna { success: true, items: [...] } o array directo
  if (response && Array.isArray(response.items)) {
    return response.items;
  }
  if (Array.isArray(response)) {
    return response;
  }
  return [];
}

/**
 * Crea una nueva nota o tarea operacional.
 * No envía dueAt, tenantId ni status.
 */
export async function createOperationalItem(payload) {
  const cleanPayload = {
    type: payload.type,
    category: payload.category,
    summary: payload.summary,
    chatId: payload.chatId,
  };

  if (payload.subjectName) cleanPayload.subjectName = payload.subjectName;
  if (payload.title) cleanPayload.title = payload.title;

  if (payload.type === 'TASK') {
    if (payload.priority) cleanPayload.priority = payload.priority;
    if (payload.dueDateLocal) cleanPayload.dueDateLocal = payload.dueDateLocal;
    if (payload.dueTimeLocal) cleanPayload.dueTimeLocal = payload.dueTimeLocal;
  }

  const response = await apiClient('/operational-items', {
    method: 'POST',
    body: cleanPayload,
  });

  return response?.item || response;
}

/**
 * Transición de tarea: PENDING -> IN_PROGRESS
 */
export async function startTask(id) {
  const response = await apiClient(`/operational-items/${id}/start`, {
    method: 'POST',
  });
  return response?.item || response;
}

/**
 * Transición de tarea: PENDING / IN_PROGRESS -> COMPLETED
 */
export async function completeTask(id) {
  const response = await apiClient(`/operational-items/${id}/complete`, {
    method: 'POST',
  });
  return response?.item || response;
}

/**
 * Transición de tarea: PENDING / IN_PROGRESS -> CANCELED
 */
export async function cancelTask(id) {
  const response = await apiClient(`/operational-items/${id}/cancel`, {
    method: 'POST',
  });
  return response?.item || response;
}

/**
 * Transición de nota: ACTIVE -> ARCHIVED
 */
export async function archiveNote(id) {
  const response = await apiClient(`/operational-items/${id}/archive`, {
    method: 'POST',
  });
  return response?.item || response;
}

/**
 * Actualiza campos permitidos de un item operacional (PATCH).
 * Nunca debe enviar status (usar endpoints de ciclo de vida).
 */
export async function updateOperationalItem(id, data) {
  const response = await apiClient(`/operational-items/${id}`, {
    method: 'PATCH',
    body: data,
  });
  return response?.item || response;
}
