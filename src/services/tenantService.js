import { apiClient } from './api';

/**
 * Obtiene el listado completo de tenants (empresas) registradas en el SaaS
 */
export async function getTenants() {
  return apiClient('/admin/tenants', {
    method: 'GET',
  });
}

/**
 * Actualiza el estado de suspensión o activación de un tenant
 */
export async function updateTenantStatus(tenantId, status) {
  return apiClient(`/admin/tenants/${tenantId}/status`, {
    method: 'PATCH',
    body: { status }, // 'active' | 'suspended' o boolean según backend, mandamos un objeto con status
  });
}

/**
 * Actualiza los límites de conexiones y mensajes mensuales asignados a un tenant
 */
export async function updateTenantLimits(tenantId, limitsData) {
  return apiClient(`/admin/tenants/${tenantId}/limits`, {
    method: 'PATCH',
    body: limitsData, // Contiene { connLimit, msgLimit }
  });
}

/**
 * Crea un nuevo tenant y su usuario administrador asociado en el servidor
 */
export async function createTenant(tenantData) {
  return apiClient('/admin/tenants', {
    method: 'POST',
    body: tenantData,
  });
}

/**
 * Restablece la contraseña del usuario administrador principal de un tenant
 */
export async function updateTenantPassword(tenantId, password) {
  return apiClient(`/admin/tenants/${tenantId}/password`, {
    method: 'PUT',
    body: { password },
  });
}
