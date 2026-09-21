/**
 * SHOPIFY DOMAIN VALIDATION AND CANONICALIZATION
 * ==============================================
 * Garantiza que todo dominio de tienda cumpla estrictamente con el formato oficial de Shopify.
 * Bloquea inyecciones de SSRF, subdominios fraudulentos, paths y caracteres maliciosos.
 */

import { ShopifyDomainError } from './shopifyErrors.js';

// Regex estricta oficial para dominios *.myshopify.com:
// 1. Inicia con caracter alfanumérico.
// 2. Puede contener caracteres alfanuméricos o guiones medios (-).
// 3. Termina estrictamente en .myshopify.com sin sufijos adicionales.
const STRICT_SHOPIFY_DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

/**
 * Valida y canonicaliza un dominio de Shopify.
 *
 * @param {string} input - El dominio ingresado (ej: " MiTienda.MyShopify.com ")
 * @returns {string} Dominio canonicalizado en minúsculas (ej: "mitienda.myshopify.com")
 * @throws {ShopifyDomainError} Si el dominio es inválido o sospechoso
 */
export function canonicalizeShopDomain(input) {
  if (!input || typeof input !== 'string') {
    throw new ShopifyDomainError('El dominio de la tienda es requerido y debe ser una cadena de texto.');
  }

  const raw = input.trim().toLowerCase();

  // 1. Rechazo inmediato de esquemas de protocolo (http://, https://)
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    throw new ShopifyDomainError(
      'Ingresa únicamente el nombre de la tienda o subdominio (ej: mitienda.myshopify.com), sin https:// ni protocolo.'
    );
  }

  // 2. Rechazo inmediato de caracteres de path, query, puerto o credenciales
  if (raw.includes('/') || raw.includes('\\') || raw.includes(':') || raw.includes('@') || raw.includes('?')) {
    throw new ShopifyDomainError('El dominio no debe contener rutas, puertos, arrobas ni parámetros.');
  }

  // 3. Si el usuario ingresó solo el slug/handle (ej: "mitienda"), permitir autocompletar .myshopify.com
  let candidate = raw;
  if (!candidate.endsWith('.myshopify.com') && !candidate.includes('.')) {
    candidate = `${candidate}.myshopify.com`;
  }

  // 4. Validación con regex estricta
  if (!STRICT_SHOPIFY_DOMAIN_REGEX.test(candidate)) {
    throw new ShopifyDomainError(
      `El dominio "${input}" no es un subdominio válido de myshopify.com.`
    );
  }

  return candidate;
}

/**
 * Valida si un dominio es válido sin lanzar excepción.
 *
 * @param {string} input
 * @returns {boolean}
 */
export function isValidShopDomain(input) {
  try {
    canonicalizeShopDomain(input);
    return true;
  } catch {
    return false;
  }
}
