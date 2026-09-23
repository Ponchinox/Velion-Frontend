/**
 * SHOPIFY OAUTH 2.0 SERVICE
 * ==========================
 * Implementa el flujo oficial de Authorization Code Grant para aplicaciones standalone.
 * - Soporta tokens offline expirables (expiring=1).
 * - Protección CSRF mediante nonce en cookie HttpOnly SameSite=Lax + state cifrado con AES-256-GCM.
 * - Verificación estricta de HMAC en tiempo constante (timingSafeEqual).
 * - Descifrado estricto de state sin fallbacks legacy.
 */

import crypto from 'crypto';
import { canonicalizeShopDomain } from './shopifyDomain.js';
import { getShopifyConfig } from './shopifyConfig.js';
import { ShopifyOAuthError } from './shopifyErrors.js';

export const OAUTH_COOKIE_NAME = 'shopify_oauth_nonce';
export const OAUTH_COOKIE_PATH = '/';
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos

/**
 * Resuelve si la cookie OAuth debe tener el flag Secure.
 * Debe ser true en producción o cuando la redirección/frontend use HTTPS.
 */
export function resolveOAuthCookieSecure() {
  if (process.env.NODE_ENV === 'production') return true;
  if (process.env.SHOPIFY_REDIRECT_URI && process.env.SHOPIFY_REDIRECT_URI.startsWith('https://')) return true;
  if (process.env.FRONTEND_URL && process.env.FRONTEND_URL.startsWith('https://')) return true;
  return false;
}

/**
 * Obtiene la llave de cifrado AES-256-GCM desde el entorno.
 */
function getEncryptionKey() {
  const keyStr = process.env.TOKEN_ENCRYPTION_KEY || process.env.BACKUP_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!keyStr) {
    throw new ShopifyOAuthError('No se encontró llave de cifrado configurada (TOKEN_ENCRYPTION_KEY o JWT_SECRET).');
  }

  if (keyStr.length === 64 && /^[0-9a-fA-F]+$/.test(keyStr)) {
    return Buffer.from(keyStr, 'hex');
  }
  if (keyStr.length === 32) {
    return Buffer.from(keyStr, 'utf-8');
  }
  return crypto.createHash('sha256').update(keyStr).digest();
}

/**
 * Cifra el payload del state para OAuth con AES-256-GCM.
 * Formato devuelto: iv:authTag:encryptedData (hex).
 */
export function encryptOAuthState(payload) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const jsonStr = JSON.stringify(payload);
  let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Descifra estrictamente el parámetro state recibido en el callback de OAuth.
 * FAIL-CLOSED:
 * - Rechaza cualquier entrada en texto plano.
 * - Exige formato exacto iv(12 bytes):authTag(16 bytes):encryptedData.
 * - Lanza error si el authTag no coincide o fue manipulado.
 * - Exige campos válidos: nonce, tenantId, userId, shopDomain, exp.
 *
 * @param {string} stateString - El valor del query param `state`
 * @returns {Object} Payload validado { nonce, tenantId, userId, shopDomain, exp }
 * @throws {ShopifyOAuthError} Si el state no es un GCM válido o fue alterado
 */
export function decryptOAuthStateStrict(stateString) {
  if (!stateString || typeof stateString !== 'string') {
    throw new ShopifyOAuthError('Parámetro state inválido o ausente.', 'INVALID_STATE');
  }

  const parts = stateString.split(':');
  // iv: 12 bytes = 24 hex chars; authTag: 16 bytes = 32 hex chars
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32 || !parts[2]) {
    throw new ShopifyOAuthError('Formato de state no reconocido o texto plano rechazado.', 'INVALID_STATE');
  }

  const [ivHex, authTagHex, encryptedData] = parts;

  // Validar caracteres hexadecimales
  if (!/^[0-9a-fA-F]+$/.test(ivHex) || !/^[0-9a-fA-F]+$/.test(authTagHex) || !/^[0-9a-fA-F]+$/.test(encryptedData)) {
    throw new ShopifyOAuthError('Contenido de state no contiene valores hexadecimales válidos.', 'INVALID_STATE');
  }

  let decryptedJson;
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    decryptedJson = decipher.update(encryptedData, 'hex', 'utf8');
    decryptedJson += decipher.final('utf8');
  } catch (err) {
    throw new ShopifyOAuthError('Fallo criptográfico al descifrar state (authTag mismatch o manipulación).', 'INVALID_STATE');
  }

  let payload;
  try {
    payload = JSON.parse(decryptedJson);
  } catch {
    throw new ShopifyOAuthError('El contenido descifrado del state no es JSON válido.', 'INVALID_STATE');
  }

  // Validar estructura obligatoria
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof payload.nonce !== 'string' ||
    !payload.nonce ||
    typeof payload.tenantId !== 'string' ||
    !payload.tenantId ||
    typeof payload.userId !== 'string' ||
    !payload.userId ||
    typeof payload.shopDomain !== 'string' ||
    !payload.shopDomain ||
    typeof payload.exp !== 'number'
  ) {
    throw new ShopifyOAuthError('Estructura interna del state incompleta o corrupta.', 'INVALID_STATE');
  }

  if (payload.returnTo !== undefined && payload.returnTo !== null && typeof payload.returnTo !== 'string') {
    throw new ShopifyOAuthError('Parámetro returnTo en state inválido.', 'INVALID_STATE');
  }

  // Validar expiración
  if (payload.exp < Date.now()) {
    throw new ShopifyOAuthError('El estado de autorización OAuth ha expirado. Inicia el flujo nuevamente.', 'STATE_EXPIRED');
  }

  return payload;
}

/**
 * Construye la URL oficial de autorización de Shopify.
 *
 * @param {Object} params
 * @param {string} params.shopDomain - Dominio de la tienda (ej: "mitienda.myshopify.com")
 * @param {string} params.tenantId   - Tenant autenticado en Velion
 * @param {string} params.userId     - Usuario que inició la acción
 * @param {string} [params.returnTo] - URL de retorno al frontend post-OAuth
 * @param {Object} [params.config]   - Configuración opcional inyectada (para tests)
 * @returns {Object} { authUrl, state, nonce, cookieOptions }
 */
export function buildAuthorizationUrl({ shopDomain, tenantId, userId, returnTo = null, config = null }) {
  if (!tenantId || !userId) {
    throw new ShopifyOAuthError('tenantId y userId son obligatorios para iniciar el flujo OAuth.', 'AUTH_REQUIRED');
  }

  const canonicalDomain = canonicalizeShopDomain(shopDomain);
  const cfg = config || getShopifyConfig({ requireAll: true });

  const nonce = crypto.randomBytes(32).toString('hex');
  const exp = Date.now() + OAUTH_STATE_TTL_MS;

  const statePayload = {
    nonce,
    tenantId,
    userId,
    shopDomain: canonicalDomain,
    exp,
  };

  if (returnTo && typeof returnTo === 'string') {
    statePayload.returnTo = returnTo;
  }

  const state = encryptOAuthState(statePayload);

  const queryParams = new URLSearchParams({
    client_id: cfg.clientId,
    scope: cfg.scopes.join(','),
    redirect_uri: cfg.redirectUri,
    state,
  });

  const authUrl = `https://${canonicalDomain}/admin/oauth/authorize?${queryParams.toString()}`;

  const secure = resolveOAuthCookieSecure();
  const cookieOptions = {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_STATE_TTL_MS,
  };

  return {
    authUrl,
    state,
    nonce,
    cookieOptions,
  };
}

/**
 * Opciones para eliminar la cookie shopify_oauth_nonce tras consumirse.
 */
export function getClearCookieOptions() {
  const secure = resolveOAuthCookieSecure();
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: OAUTH_COOKIE_PATH,
    maxAge: 0,
  };
}

/**
 * Valida el HMAC enviado por Shopify en el callback.
 * Cumple estrictamente con la especificación de Shopify:
 * 1. Remueve 'hmac' y 'signature'.
 * 2. Ordena las claves alfabéticamente.
 * 3. Serializa en formato clave=valor unidas por '&'.
 * 4. Calcula HMAC-SHA256 con el client_secret.
 * 5. Compara usando crypto.timingSafeEqual para prevenir ataques de tiempo.
 *
 * @param {Object} params
 * @param {Object} params.query        - Parámetros de la query recibida en el callback
 * @param {string} params.clientSecret - El SHOPIFY_CLIENT_SECRET
 * @returns {boolean} true si es válido
 */
export function verifyOAuthHmac({ query, clientSecret }) {
  if (!query || typeof query !== 'object' || !query.hmac || typeof query.hmac !== 'string') {
    return false;
  }
  if (!clientSecret || typeof clientSecret !== 'string') {
    return false;
  }

  const receivedHmac = query.hmac.trim().toLowerCase();

  // Clonar y remover hmac / signature
  const cleanParams = {};
  for (const [k, v] of Object.entries(query)) {
    if (k !== 'hmac' && k !== 'signature') {
      cleanParams[k] = v;
    }
  }

  // Ordenar claves alfabéticamente
  const sortedKeys = Object.keys(cleanParams).sort();
  const message = sortedKeys
    .map(key => {
      const val = cleanParams[key];
      const strVal = Array.isArray(val) ? val.join(',') : String(val);
      return `${key}=${strVal}`;
    })
    .join('&');

  const computedHmac = crypto
    .createHmac('sha256', clientSecret)
    .update(message, 'utf8')
    .digest('hex')
    .toLowerCase();

  const bufA = Buffer.from(computedHmac, 'utf8');
  const bufB = Buffer.from(receivedHmac, 'utf8');

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Valida el state y el nonce de la cookie en el callback.
 *
 * @param {Object} params
 * @param {string} params.state        - Parámetro state recibido
 * @param {string} params.cookieNonce  - Valor de la cookie shopify_oauth_nonce
 * @param {string} params.shop         - Parámetro shop recibido
 * @returns {Object} Payload del state autenticado { tenantId, userId, shopDomain }
 */
export function verifyOAuthState({ state, cookieNonce, shop }) {
  const payload = decryptOAuthStateStrict(state);

  // 1. Validar que el shop coincida con el dominio del state
  const canonicalShop = canonicalizeShopDomain(shop);
  if (payload.shopDomain !== canonicalShop) {
    throw new ShopifyOAuthError('El dominio del comercio en el callback no coincide con el state de sesión.', 'SHOP_MISMATCH');
  }

  // 2. Validar que la cookie de nonce exista
  if (!cookieNonce || typeof cookieNonce !== 'string') {
    throw new ShopifyOAuthError('Cookie de sesión OAuth no encontrada. Flujo caducado o CSRF detectado.', 'CSRF_DETECTED');
  }

  // 3. Comparar nonce del state contra la cookie en tiempo constante
  const bufStateNonce = Buffer.from(payload.nonce, 'utf8');
  const bufCookieNonce = Buffer.from(cookieNonce.trim(), 'utf8');

  if (bufStateNonce.length !== bufCookieNonce.length || !crypto.timingSafeEqual(bufStateNonce, bufCookieNonce)) {
    throw new ShopifyOAuthError('El nonce de la cookie no coincide con el state. Petición rechazada.', 'CSRF_DETECTED');
  }

  return {
    tenantId: payload.tenantId,
    userId: payload.userId,
    shopDomain: payload.shopDomain,
    returnTo: payload.returnTo || null,
  };
}

/**
 * Intercambia el código de autorización temporal por tokens de acceso.
 * Solicita tokens offline expirables mediante `expiring: 1`.
 *
 * @param {Object} params
 * @param {string} params.shopDomain    - Dominio de la tienda canonicalizado
 * @param {string} params.code          - Authorization code de Shopify
 * @param {string} params.clientId      - SHOPIFY_CLIENT_ID
 * @param {string} params.clientSecret  - SHOPIFY_CLIENT_SECRET
 * @param {Function} [params.fetchFn]   - Implementación de fetch inyectable (para tests/mocks)
 * @returns {Promise<Object>} Datos del token intercambiado
 */
export async function exchangeAuthorizationCode({
  shopDomain,
  code,
  clientId,
  clientSecret,
  fetchFn = globalThis.fetch,
}) {
  const canonicalDomain = canonicalizeShopDomain(shopDomain);

  if (!code || typeof code !== 'string') {
    throw new ShopifyOAuthError('Código de autorización faltante.', 'INVALID_CODE');
  }

  const tokenUrl = `https://${canonicalDomain}/admin/oauth/access_token`;

  const requestBody = {
    client_id: clientId,
    client_secret: clientSecret,
    code,
    expiring: 1, // Exige tokens offline expirables (especificación 2026)
  };

  let response;
  try {
    response = await fetchFn(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (netErr) {
    throw new ShopifyOAuthError(`Error de red al conectar con endpoint de tokens: ${netErr.message}`, 'NETWORK_ERROR');
  }

  const bodyText = await response.text();
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new ShopifyOAuthError('Respuesta malformada recibida del endpoint de tokens de Shopify.', 'INVALID_RESPONSE');
  }

  if (!response.ok) {
    const errorDesc = data.error_description || data.error || `HTTP ${response.status}`;
    throw new ShopifyOAuthError(`Intercambio de código fallido: ${errorDesc}`, 'TOKEN_EXCHANGE_FAILED');
  }

  if (!data.access_token) {
    throw new ShopifyOAuthError('La respuesta de Shopify no contiene access_token.', 'TOKEN_EXCHANGE_FAILED');
  }

  // Parsear scopes concedidos
  const grantedScopes = typeof data.scope === 'string'
    ? data.scope.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const requiredScopes = ['read_products', 'read_inventory', 'write_draft_orders'];
  const missingScopes = requiredScopes.filter(s => !grantedScopes.includes(s));

  if (missingScopes.length > 0) {
    throw new ShopifyOAuthError(
      `Permisos insuficientes concedidos por el comercio. Faltan: ${missingScopes.join(', ')}`,
      'INSUFFICIENT_SCOPES'
    );
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresIn: Number(data.expires_in) || 3600, // Duración en segundos informada por Shopify
    refreshTokenExpiresIn: Number(data.refresh_token_expires_in) || 7776000, // Duración en segundos
    scopes: grantedScopes,
  };
}
