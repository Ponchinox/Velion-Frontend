import { apiClient } from './api';

/**
 * Obtiene el estado actual del dispositivo de WhatsApp del tenant autenticado
 */
export async function getStatus() {
  return apiClient('/whatsapp/status', {
    method: 'GET',
  });
}

/**
 * Genera una nueva solicitud de emparejamiento por código QR
 */
export async function connectDevice() {
  return apiClient('/whatsapp/connect', {
    method: 'POST',
  });
}

/**
 * Desconecta el dispositivo cerrando sesión de WhatsApp
 */
export async function disconnectDevice() {
  return apiClient('/whatsapp/disconnect', {
    method: 'POST',
  });
}
