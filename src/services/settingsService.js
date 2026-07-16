import { apiClient } from './api';

/**
 * Obtiene la configuración institucional del Tenant actual
 */
export async function getSettings() {
  return apiClient('/settings', {
    method: 'GET'
  });
}

/**
 * Actualiza la configuración institucional del Tenant actual
 */
export async function updateSettings(settingsData) {
  return apiClient('/settings', {
    method: 'PUT',
    body: settingsData
  });
}
