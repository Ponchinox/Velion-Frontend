/**
 * SHOPIFY TOKEN SERVICE
 * =====================
 * Gestiona el ciclo de vida, cifrado en reposo, rotación atómica y refresco concurrente
 * de tokens de acceso para Shopify (especificación de tokens offline expirables 2026).
 *
 * Características:
 * - Cifrado obligatorio en reposo mediante AES-256-GCM (cryptoUtils).
 * - Rotación atómica de pares de tokens (access_token + refresh_token).
 * - Semántica oficial de errores:
 *     - Errores transitorios (5xx, timeouts, network) -> reintentos con backoff + jitter sin desconectar.
 *     - Errores terminales (HTTP 401 con invalid_request) -> status = 'ERROR', lastSyncError = 'REAUTH_REQUIRED', preservando historial y shopDomain.
 * - Concurrencia multi-worker: coalescing en memoria + PostgreSQL Advisory Transaction Lock + Double Check.
 */

import prisma from '../../../db.js';
import { encryptText, decryptText } from '../../../utils/cryptoUtils.js';
import { getShopifyConfig } from './shopifyConfig.js';
import { canonicalizeShopDomain } from './shopifyDomain.js';
import {
  ShopifyAuthError,
  ShopifyReauthRequiredError,
  ShopifyIntegrationNotConnectedError,
  ShopifyDomainConflictError,
  ShopifyNetworkError,
  ShopifyTimeoutError,
} from './shopifyErrors.js';

// Margen de seguridad preventivo: refrescar si faltan 5 minutos o menos para expirar
export const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Mapa en memoria para coalescing de refrescos dentro del mismo proceso Node
const inFlightRefreshes = new Map();

/**
 * Persiste de forma atómica y cifrada los tokens de una integración conectada.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.shopDomain
 * @param {Object} params.tokenData - { accessToken, refreshToken, expiresIn, refreshTokenExpiresIn, scopes }
 * @param {Object} [params.prismaClient]
 * @returns {Promise<Object>} Registro Integration actualizado
 */
export async function persistConnectedTokens({
  tenantId,
  shopDomain,
  tokenData,
  prismaClient = prisma,
}) {
  const canonicalDomain = canonicalizeShopDomain(shopDomain);

  const encryptedAccessToken = encryptText(tokenData.accessToken);
  const encryptedRefreshToken = tokenData.refreshToken ? encryptText(tokenData.refreshToken) : null;

  const expiresInSec = tokenData.expiresIn !== undefined ? Number(tokenData.expiresIn) : 3600;
  const accessTokenExpiresAt = new Date(Date.now() + expiresInSec * 1000);
  const refreshTokenExpiresAt = tokenData.refreshTokenExpiresIn !== undefined
    ? new Date(Date.now() + Number(tokenData.refreshTokenExpiresIn) * 1000)
    : null;

  const scopes = Array.isArray(tokenData.scopes) ? tokenData.scopes : [];

  try {
    const integration = await prismaClient.integration.upsert({
      where: {
        tenantId_provider: {
          tenantId,
          provider: 'SHOPIFY',
        },
      },
      update: {
        status: 'CONNECTED',
        shopDomain: canonicalDomain,
        encryptedAccessToken,
        encryptedRefreshToken,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        scopes,
        syncStatus: 'IDLE',
        lastSyncError: null,
      },
      create: {
        tenantId,
        provider: 'SHOPIFY',
        status: 'CONNECTED',
        shopDomain: canonicalDomain,
        encryptedAccessToken,
        encryptedRefreshToken,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        scopes,
        syncStatus: 'IDLE',
      },
    });

    return integration;
  } catch (err) {
    // Detectar colisión única @@unique([provider, shopDomain])
    if (err.code === 'P2002' || (err.message && err.message.includes('shopDomain'))) {
      throw new ShopifyDomainConflictError(
        `La tienda "${canonicalDomain}" ya está conectada a otra cuenta de Velion.`
      );
    }
    throw err;
  }
}

/**
 * Obtiene un token de acceso válido para el tenant especificado.
 * Si el token vigente está dentro de la ventana de seguridad (< 5 minutos) o ya expiró,
 * ejecuta automáticamente el refresco antes de retornar.
 *
 * @param {string} tenantId
 * @param {Object} [options]
 * @param {Object} [options.prismaClient]
 * @param {Function} [options.fetchFn]
 * @returns {Promise<string>} Token de acceso descifrado en memoria
 */
export async function getValidAccessToken(tenantId, { prismaClient = prisma, fetchFn = globalThis.fetch } = {}) {
  const integration = await prismaClient.integration.findUnique({
    where: {
      tenantId_provider: {
        tenantId,
        provider: 'SHOPIFY',
      },
    },
  });

  if (!integration || integration.status !== 'CONNECTED') {
    throw new ShopifyIntegrationNotConnectedError(
      `No existe una integración de Shopify activa para el tenant ${tenantId}.`
    );
  }

  if (!integration.encryptedAccessToken) {
    throw new ShopifyAuthError('La integración existe pero no posee token de acceso configurado.');
  }

  const now = Date.now();
  const expiresAt = integration.accessTokenExpiresAt
    ? new Date(integration.accessTokenExpiresAt).getTime()
    : null;

  // Si no tiene fecha de expiración (legacy) o aún tiene más de 5 minutos de vigencia:
  if (!expiresAt || expiresAt - REFRESH_BUFFER_MS > now) {
    return decryptText(integration.encryptedAccessToken);
  }

  // Token próximo a expirar o expirado: ejecutar refresco seguro
  return refreshAccessToken(tenantId, integration, { prismaClient, fetchFn });
}

/**
 * Ejecuta el refresco de tokens coordinado con soporte para concurrencia multi-worker y reintentos.
 *
 * @param {string} tenantId
 * @param {Object} currentIntegration
 * @param {Object} options
 * @returns {Promise<string>} Nuevo token de acceso descifrado
 */
export async function refreshAccessToken(
  tenantId,
  currentIntegration,
  { prismaClient = prisma, fetchFn = globalThis.fetch } = {}
) {
  // 1. Coalescing en memoria para llamadas concurrentes en el mismo worker
  if (inFlightRefreshes.has(tenantId)) {
    return inFlightRefreshes.get(tenantId);
  }

  const refreshPromise = (async () => {
    try {
      // 2. Ejecutar dentro de transacción con Advisory Lock de PostgreSQL para multi-worker
      return await executeRefreshWithLock(tenantId, currentIntegration, { prismaClient, fetchFn });
    } finally {
      inFlightRefreshes.delete(tenantId);
    }
  })();

  inFlightRefreshes.set(tenantId, refreshPromise);
  return refreshPromise;
}

/**
 * Implementa el bloqueo coordinado en base de datos con Double Check y reintentos.
 */
async function executeRefreshWithLock(tenantId, currentIntegration, { prismaClient, fetchFn }) {
  // Ejecutar dentro de transacción si es posible
  const runInTransaction = typeof prismaClient.$transaction === 'function';

  if (!runInTransaction) {
    return performTokenRefreshHttp(tenantId, currentIntegration, { prismaClient, fetchFn });
  }

  return prismaClient.$transaction(async (tx) => {
    // Intentar adquirir lock transaccional no bloqueante
    let acquiredLock = true;
    try {
      const lockKey = `shopify_refresh_${tenantId}`;
      const lockRes = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) as locked;`;
      if (Array.isArray(lockRes) && lockRes.length > 0 && lockRes[0].locked !== undefined) {
        acquiredLock = Boolean(lockRes[0].locked);
      }
    } catch {
      // Si el motor no soporta advisory locks (ej: sqlite o test mocks), continuar
      acquiredLock = true;
    }

    // 3. Si otro worker tiene el lock: esperar brevemente y releer
    if (!acquiredLock) {
      // Esperar hasta 2 segundos en intervalos cortos
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const updated = await tx.integration.findUnique({
          where: { tenantId_provider: { tenantId, provider: 'SHOPIFY' } },
        });

        if (updated && updated.accessTokenExpiresAt) {
          const updatedExpiresAt = new Date(updated.accessTokenExpiresAt).getTime();
          if (updatedExpiresAt - REFRESH_BUFFER_MS > Date.now()) {
            return decryptText(updated.encryptedAccessToken);
          }
        }
      }
    }

    // 4. DOUBLE CHECK OBLIGATORIO: releer la integración tras adquirir el lock
    const fresh = await tx.integration.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'SHOPIFY' } },
    });

    if (fresh && fresh.accessTokenExpiresAt) {
      const freshExpiresAt = new Date(fresh.accessTokenExpiresAt).getTime();
      if (freshExpiresAt - REFRESH_BUFFER_MS > Date.now()) {
        // Otro worker ya completó el refresco; usar el token nuevo sin llamar a Shopify
        return decryptText(fresh.encryptedAccessToken);
      }
    }

    // 5. Ejecutar la llamada HTTP de refresco a Shopify
    return performTokenRefreshHttp(tenantId, fresh || currentIntegration, { prismaClient: tx, fetchFn });
  }, {
    timeout: 15000, // Límite estricto de conexión transaccional
  });
}

/**
 * Realiza la llamada HTTP oficial de refresco contra Shopify con manejo de semántica de errores y jitter.
 */
async function performTokenRefreshHttp(tenantId, integration, { prismaClient, fetchFn }) {
  if (!integration.encryptedRefreshToken) {
    throw new ShopifyReauthRequiredError(
      'La integración no posee un refresh token para rotar credenciales. Se requiere reautorización.'
    );
  }

  const decryptedRefreshToken = decryptText(integration.encryptedRefreshToken);
  const cfg = getShopifyConfig({ requireSecret: true });
  const shopDomain = canonicalizeShopDomain(integration.shopDomain);
  const tokenUrl = `https://${shopDomain}/admin/oauth/access_token`;

  const body = {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: decryptedRefreshToken,
  };

  const MAX_RETRIES = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      let res;
      try {
        res = await fetchFn(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const bodyText = await res.text();
      let data = {};
      try {
        data = JSON.parse(bodyText);
      } catch {
        // Respuesta no parseable
      }

      // ── CASO A: ERROR TERMINAL DE AUTENTICACIÓN (HTTP 401 / invalid_request) ──
      // Documentación oficial: token revocado o expirado responde 401 con error=invalid_request
      if (res.status === 401 || (res.status === 400 && data.error === 'invalid_grant')) {
        await prismaClient.integration.update({
          where: { tenantId_provider: { tenantId, provider: 'SHOPIFY' } },
          data: {
            status: 'ERROR',
            lastSyncError: 'REAUTH_REQUIRED',
            syncStatus: 'ERROR',
            encryptedAccessToken: null,
            encryptedRefreshToken: null,
            accessTokenExpiresAt: null,
            refreshTokenExpiresAt: null,
          },
        });

        throw new ShopifyReauthRequiredError(
          'El refresh token de Shopify es inválido o expiró. Se requiere reautorización de la tienda.'
        );
      }

      // ── CASO B: ERROR TRANSITORIO DE SERVIDOR (5xx) ──
      if (res.status >= 500) {
        throw new ShopifyNetworkError(`Shopify respondió con error transitorio HTTP ${res.status}.`);
      }

      if (!res.ok) {
        throw new ShopifyAuthError(`Error inesperado al refrescar token: HTTP ${res.status}`);
      }

      if (!data.access_token) {
        throw new ShopifyAuthError('La respuesta de refresco de Shopify no contiene access_token.');
      }

      // ── ÉXITO: ROTACIÓN ATÓMICA DE PARES DE TOKENS ──
      const newAccessToken = data.access_token;
      const newRefreshToken = data.refresh_token || decryptedRefreshToken;
      const expiresIn = Number(data.expires_in) || 3600;
      const refreshTokenExpiresIn = Number(data.refresh_token_expires_in) || 7776000;

      const encryptedAccessToken = encryptText(newAccessToken);
      const encryptedRefreshToken = encryptText(newRefreshToken);
      const accessTokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
      const refreshTokenExpiresAt = new Date(Date.now() + refreshTokenExpiresIn * 1000);

      await prismaClient.integration.update({
        where: { tenantId_provider: { tenantId, provider: 'SHOPIFY' } },
        data: {
          encryptedAccessToken,
          encryptedRefreshToken,
          accessTokenExpiresAt,
          refreshTokenExpiresAt,
          status: 'CONNECTED',
          lastSyncError: null,
          syncStatus: 'IDLE',
        },
      });

      return newAccessToken;
    } catch (err) {
      if (err instanceof ShopifyReauthRequiredError) {
        throw err; // Terminal: no reintentar
      }

      lastError = err;
      if (attempt < MAX_RETRIES) {
        // Backoff exponencial con jitter: 200ms, 400ms...
        const backoff = Math.pow(2, attempt) * 100 + Math.random() * 50;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  // Si se agotaron los reintentos transitorios, no desconectar la tienda
  throw (
    lastError ||
    new ShopifyNetworkError('Se agotaron los reintentos al intentar refrescar el token de Shopify.')
  );
}

/**
 * Desconecta la integración de Shopify.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {boolean} [params.releaseDomain=false] - Si es true, libera shopDomain fijándolo en null.
 * @param {Object} [params.prismaClient]
 */
export async function disconnectIntegration({
  tenantId,
  releaseDomain = false,
  prismaClient = prisma,
}) {
  const updateData = {
    status: 'DISCONNECTED',
    encryptedAccessToken: null,
    encryptedRefreshToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scopes: [],
    syncStatus: 'IDLE',
  };

  if (releaseDomain) {
    updateData.shopDomain = null;
  }

  return prismaClient.integration.update({
    where: {
      tenantId_provider: {
        tenantId,
        provider: 'SHOPIFY',
      },
    },
    data: updateData,
  });
}
