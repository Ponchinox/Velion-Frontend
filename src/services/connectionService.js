import { apiClient } from './api';

/**
 * Obtiene el estado real de la conexión de la instancia desde el backend
 */
export async function getStatus(instanceName) {
  const query = instanceName ? `?instanceName=${instanceName}` : '';
  return apiClient(`/connections/status${query}`, { method: 'GET' });
}

/**
 * Obtiene el código QR en Base64 desde el backend (solo conexión Baileys/QR)
 */
export async function getQrCode() {
  return apiClient('/connections/qr', { method: 'GET' });
}

/**
 * Cierra la sesión de WhatsApp vinculada en el backend
 * @param {{ instanceName?: string, connectionId: string, provider?: string }} conn
 */
export async function logout(conn) {
  return apiClient('/connections/logout', {
    method: 'POST',
    body: typeof conn === 'string' ? { instanceName: conn } : conn
  });
}

/**
 * Crea una instancia de WhatsApp Cloud API en Evolution API (WHATSAPP-BUSINESS)
 * e inyecta los 3 credenciales de Meta nativamente.
 * @param {{ metaPhoneNumberId: string, metaWabaId: string, metaAccessToken: string, phoneNumber: string, connectionName?: string }} data
 */
export async function createMetaConnection(data) {
  return apiClient('/connections/meta/connect', {
    method: 'POST',
    body:   data,
  });
}

/**
 * Obtiene el proveedor activo y metadatos de la conexión del Tenant
 */
export async function getProvider() {
  return apiClient('/connections/provider', { method: 'GET' });
}
