import { apiClient } from './api';

/**
 * Obtiene notificaciones filtradas y paginadas
 */
export async function getNotifications(params = {}) {
  const query = new URLSearchParams();
  if (params.status) query.append('status', params.status);
  if (params.priority) query.append('priority', params.priority);
  if (params.filter) query.append('filter', params.filter);
  if (params.page) query.append('page', params.page);
  if (params.limit) query.append('limit', params.limit);

  const qs = query.toString();
  const endpoint = `/notifications${qs ? `?${qs}` : ''}`;
  return apiClient(endpoint, { method: 'GET' });
}

/**
 * Obtiene conteo de no leídas para el badge
 */
export async function getUnreadCount() {
  return apiClient('/notifications/unread-count', { method: 'GET' });
}

/**
 * Marca una notificación como leída
 */
export async function markAsRead(id) {
  return apiClient(`/notifications/${id}/read`, { method: 'PATCH' });
}

/**
 * Marca una notificación como resuelta
 */
export async function resolveNotification(id) {
  return apiClient(`/notifications/${id}/resolve`, { method: 'PATCH' });
}

/**
 * Descarta una notificación
 */
export async function dismissNotification(id) {
  return apiClient(`/notifications/${id}/dismiss`, { method: 'PATCH' });
}

/**
 * Marca todas las notificaciones como leídas
 */
export async function markAllAsRead() {
  return apiClient('/notifications/read-all', { method: 'POST' });
}
