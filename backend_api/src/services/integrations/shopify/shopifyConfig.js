/**
 * SHOPIFY CONFIGURATION MODULE
 * ============================
 * Centraliza la configuración y variables de entorno requeridas para Shopify.
 * Versión de API congelada: 2026-07.
 * Scopes V1 congelados: read_products, read_inventory, write_draft_orders.
 */

import { ShopifyConfigError } from './shopifyErrors.js';

export const SHOPIFY_ADMIN_API_VERSION = '2026-07';

export const SHOPIFY_SCOPES = Object.freeze([
  'read_products',
  'read_inventory',
  'write_draft_orders',
]);

/**
 * Obtiene la configuración de Shopify desde las variables de entorno.
 * Fail-closed: Si se requiere el secreto y no está configurado, lanza ShopifyConfigError.
 * No serializa el secreto en logs ni en representaciones JSON estándar.
 *
 * @param {Object} options
 * @param {boolean} [options.requireSecret=false] - Exigir que SHOPIFY_CLIENT_SECRET esté presente.
 * @param {boolean} [options.requireAll=false]    - Exigir CLIENT_ID, CLIENT_SECRET y REDIRECT_URI.
 * @returns {Object} Configuración validada
 */
export function getShopifyConfig({ requireSecret = false, requireAll = false } = {}) {
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim() || null;
  const redirectUri = process.env.SHOPIFY_REDIRECT_URI?.trim() || null;

  if (requireAll) {
    const missing = [];
    if (!clientId) missing.push('SHOPIFY_CLIENT_ID');
    if (!clientSecret) missing.push('SHOPIFY_CLIENT_SECRET');
    if (!redirectUri) missing.push('SHOPIFY_REDIRECT_URI');

    if (missing.length > 0) {
      throw new ShopifyConfigError(
        `Variables de entorno faltantes para Shopify: ${missing.join(', ')}`
      );
    }
  } else if (requireSecret && !clientSecret) {
    throw new ShopifyConfigError('SHOPIFY_CLIENT_SECRET no está configurado en las variables de entorno.');
  }

  // Objeto seguro: define clientSecret como propiedad no enumerable para prevenir fugas en JSON.stringify / console.log
  const config = {
    apiVersion: SHOPIFY_ADMIN_API_VERSION,
    scopes: [...SHOPIFY_SCOPES],
    clientId,
    redirectUri,
  };

  Object.defineProperty(config, 'clientSecret', {
    value: clientSecret,
    writable: false,
    enumerable: false, // No visible en Object.keys() ni JSON.stringify()
    configurable: false,
  });

  return config;
}
