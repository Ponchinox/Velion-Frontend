import { apiClient } from './api';

/**
 * Obtiene la configuración del flujo del bot automático guardado en el servidor
 */
export async function getFlow() {
  return apiClient('/automation/flow', {
    method: 'GET',
  });
}

/**
 * Guarda el estado actual del mapa de automatización (nodos y conexiones)
 */
export async function saveFlow(flowData) {
  return apiClient('/automation/flow', {
    method: 'POST',
    body: flowData,
  });
}
