import { apiClient } from './api';

/**
 * Obtiene el estado real de la conexión de la instancia desde el backend
 */
export async function getStatus() {
  return apiClient('/connections/status', {
    method: 'GET'
  });
}

/**
 * Obtiene el código QR en Base64 desde el backend
 */
export async function getQrCode() {
  return apiClient('/connections/qr', {
    method: 'GET'
  });
}

/**
 * Cierra la sesión de WhatsApp vinculada en el backend
 */
export async function logout() {
  return apiClient('/connections/logout', {
    method: 'POST'
  });
}
