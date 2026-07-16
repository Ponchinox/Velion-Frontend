import { apiClient } from './api';

/**
 * Obtiene todos los planes y paquetes comerciales registrados en el sistema
 */
export async function getPlans() {
  return apiClient('/admin/plans', {
    method: 'GET',
  });
}

/**
 * Crea un nuevo plan en el SaaS
 */
export async function createPlan(planData) {
  return apiClient('/admin/plans', {
    method: 'POST',
    body: planData,
  });
}

/**
 * Actualiza los límites y configuraciones de un plan existente
 */
export async function updatePlan(id, planData) {
  return apiClient(`/admin/plans/${id}`, {
    method: 'PUT',
    body: planData,
  });
}

/**
 * Elimina un plan comercial del sistema
 */
export async function deletePlan(id) {
  return apiClient(`/admin/plans/${id}`, {
    method: 'DELETE',
  });
}
