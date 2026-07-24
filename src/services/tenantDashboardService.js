import { apiClient } from './api';

/**
 * Obtiene las estadísticas reales de negocio de la empresa del Tenant actual
 */
export async function getTenantMetrics() {
  return apiClient('/tenant/dashboard', {
    method: 'GET',
  });
}
