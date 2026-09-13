import { apiClient } from './api';

/**
 * Servicio frontend para el módulo de Seguimientos Automáticos (Follow-ups V1).
 */

export async function getFollowUps(params = {}) {
  const query = new URLSearchParams();
  if (params.tab) query.set('tab', params.tab);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  const queryString = query.toString() ? `?${query.toString()}` : '';
  return apiClient(`/follow-ups${queryString}`, {
    method: 'GET'
  });
}

export async function getFollowUpSummary() {
  return apiClient('/follow-ups/summary', {
    method: 'GET'
  });
}

export async function cancelFollowUp(id, reason = 'MERCHANT_MANUAL') {
  return apiClient(`/follow-ups/${id}/cancel`, {
    method: 'PATCH',
    body: { reason }
  });
}

export async function updateFollowUpSettings(settings) {
  return apiClient('/follow-ups/settings', {
    method: 'PATCH',
    body: settings
  });
}
