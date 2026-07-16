import { apiClient } from './api';

/**
 * Obtiene la lista de flujos del inquilino
 */
export async function getFlows() {
  return apiClient('/flows', {
    method: 'GET',
  });
}

/**
 * Guarda o actualiza un flujo en la base de datos
 */
export async function saveFlow(flowData) {
  return apiClient('/flows', {
    method: 'POST',
    body: flowData,
  });
}
