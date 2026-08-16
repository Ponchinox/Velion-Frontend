import { apiClient } from './api';

/**
 * Obtiene el estado real de la conexión de la instancia desde el backend
 */
export async function getStatus(instanceName) {
  const query = instanceName ? `?instanceName=${instanceName}` : '';
  return apiClient(`/connections/status${query}`, { method: 'GET' });
}

/**
 * Obtiene el código QR en Base64 desde el backend
 */
export async function getQrCode() {
  return apiClient('/connections/qr', { method: 'GET' });
}

/**
 * Cierra la sesión de WhatsApp vinculada en el backend
 */
export async function logout(instanceName) {
  return apiClient('/connections/logout', { 
    method: 'POST',
    body: { instanceName }
  });
}

/**
 * Guarda o actualiza las credenciales de Meta Cloud API para el Tenant
 * @param {{ metaPhoneNumberId: string, metaWabaId: string, metaAccessToken: string, phoneNumber?: string }} data
 */
export async function saveMetaConnection(data) {
  return apiClient('/connections/meta', {
    method: 'POST',
    body: data,
  });
}

/**
 * Obtiene el proveedor activo y metadatos de la conexión del Tenant
 * @returns {{ provider: 'EVOLUTION'|'META', phoneNumber: string|null, metaPhoneNumberId: string|null, metaWabaId: string|null }}
 */
export async function getProvider() {
  return apiClient('/connections/provider', { method: 'GET' });
}
