import { apiClient } from './api';

/**
 * Obtiene la configuración e infraestructura global del SaaS desde el servidor maestro
 */
export async function getGlobalConfig() {
  return apiClient('/admin/settings', {
    method: 'GET',
  });
}

/**
 * Guarda en bloque todas las credenciales y ajustes del servidor maestro
 */
export async function saveGlobalConfig(configData) {
  return apiClient('/admin/settings', {
    method: 'PUT',
    body: configData,
  });
}
