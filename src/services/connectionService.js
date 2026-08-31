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
 * [LEGACY] Crea una instancia de WhatsApp Cloud API en Evolution API (WHATSAPP-BUSINESS)
 * e inyecta los credenciales de Meta nativamente.
 * Mantenido por backward-compatibility. El flujo nuevo usa metaOnboardingCallback.
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

// ─── Meta Embedded Signup (Nuevo flujo oficial) ───────────────────────────

/**
 * Obtiene la configuración pública del SDK de Facebook (App ID, Config ID).
 * NO devuelve secretos.
 */
export async function getMetaOnboardingConfig() {
  return apiClient('/connections/meta/onboarding/config', { method: 'GET' });
}

/**
 * Envía el código de autorización de Embedded Signup al backend para que
 * realice el token exchange de forma segura.
 *
 * @param {{ code: string, wabaId?: string, phoneNumberId?: string }} data
 */
export async function metaOnboardingCallback(data) {
  return apiClient('/connections/meta/onboarding/callback', {
    method: 'POST',
    body:   data,
  });
}

/**
 * [LEGACY DEV] Conecta Meta con formulario manual (fallback para desarrolladores).
 * @param {{ metaPhoneNumberId: string, metaWabaId: string, metaAccessToken: string, phoneNumber: string }} data
 */
export async function metaLegacyConnect(data) {
  return apiClient('/connections/meta/onboarding/legacy', {
    method: 'POST',
    body:   data,
  });
}

