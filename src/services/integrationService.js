import { apiClient } from './api';

/**
 * SERVICIO DE INTEGRACIONES (SHOPIFY & EXTERNOS)
 * ===============================================
 * Conexión segura con los endpoints del backend para Shopify y proveedores externos.
 * Ningún secreto, token ni API Key es manejado o expuesto en este servicio.
 */

/**
 * Obtiene el estado actual de la integración de Shopify para el tenant autenticado.
 */
export async function getShopifyStatus() {
  return apiClient('/integrations/shopify/status', { method: 'GET' });
}

/**
 * Inicia el flujo OAuth de conexión con una tienda Shopify.
 * El backend valida el dominio y devuelve la URL de redirección a Shopify.
 * @param {string} shopDomain Dominio myshopify de la tienda (ej. mi-tienda.myshopify.com)
 */
export async function connectShopify(shopDomain) {
  return apiClient('/integrations/shopify/connect', {
    method: 'POST',
    body: { shopDomain },
  });
}

/**
 * Dispara la sincronización manual del catálogo de Shopify.
 */
export async function syncShopify() {
  return apiClient('/integrations/shopify/sync', {
    method: 'POST',
  });
}

/**
 * Actualiza la configuración comercial de Shopify para el tenant (catalogMode, priceSource, stockSource).
 * @param {{ catalogMode?: string, priceSource?: string, stockSource?: string }} settings
 */
export async function updateShopifySettings(settings) {
  return apiClient('/integrations/shopify/settings', {
    method: 'PATCH',
    body: settings,
  });
}

/**
 * Desconecta la integración de Shopify en el backend revocando tokens locales.
 * @param {boolean} [releaseDomain=false]
 */
export async function disconnectShopify(releaseDomain = false) {
  return apiClient('/integrations/shopify/disconnect', {
    method: 'POST',
    body: { releaseDomain },
  });
}
