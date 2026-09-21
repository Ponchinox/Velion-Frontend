/**
 * SHOPIFY GRAPHQL ADMIN API CLIENT (VERSION 2026-07)
 * ===================================================
 * Cliente de transporte para consultas y mutaciones GraphQL contra Shopify Admin API.
 *
 * Características:
 * - Versión congelada: 2026-07.
 * - Inyección automática de token y shopDomain autenticados por tenant.
 * - Timeouts con AbortController.
 * - Detección exhaustiva de Throttling tanto en HTTP 429 como en HTTP 200 con errors[].extensions.code = "THROTTLED".
 * - Inspección de metadata de costo (extensions.cost).
 * - Desacoplamiento de userErrors: se devuelven en data para que la capa operativa los maneje.
 * - Prevención de fugas de credenciales en errores y mensajes.
 */

import prisma from '../../../db.js';
import { SHOPIFY_ADMIN_API_VERSION } from './shopifyConfig.js';
import { canonicalizeShopDomain } from './shopifyDomain.js';
import { getValidAccessToken } from './shopifyTokenService.js';
import {
  ShopifyAuthError,
  ShopifyGraphqlError,
  ShopifyNetworkError,
  ShopifyTimeoutError,
  ShopifyThrottledError,
  ShopifyIntegrationNotConnectedError,
} from './shopifyErrors.js';

/**
 * Determina si una consulta GraphQL es una mutación (operación con posibles efectos colaterales).
 */
function isMutation(queryStr) {
  if (typeof queryStr !== 'string') return false;
  const trimmed = queryStr.trim().replace(/^#[^\n]*\n/gm, ''); // Remover comentarios
  return /^mutation\b/i.test(trimmed);
}

/**
 * Ejecuta una consulta o mutación GraphQL contra la tienda de un tenant.
 *
 * @param {string} tenantId
 * @param {Object} params
 * @param {string} params.query                  - Consulta o mutación GraphQL
 * @param {Object} [params.variables={}]        - Variables GraphQL
 * @param {number} [params.timeoutMs=15000]     - Límite de tiempo por intento (ms)
 * @param {number} [params.maxRetries=2]        - Reintentos permitidos para consultas de solo lectura throttled
 * @param {Function} [params.fetchFn]           - fetch inyectable para tests
 * @param {Object} [params.prismaClient]        - Prisma client inyectable
 * @returns {Promise<Object>} { data, cost, extensions }
 */
export async function executeShopifyGraphql(
  tenantId,
  {
    query,
    variables = {},
    timeoutMs = 15000,
    maxRetries = 2,
    fetchFn = globalThis.fetch,
    prismaClient = prisma,
  }
) {
  if (!tenantId) {
    throw new ShopifyIntegrationNotConnectedError('tenantId es requerido para invocar Shopify GraphQL.');
  }
  if (!query || typeof query !== 'string') {
    throw new ShopifyGraphqlError(null, 'Query GraphQL requerida y debe ser string.');
  }

  // 1. Obtener la integración y el dominio validado
  const integration = await prismaClient.integration.findUnique({
    where: {
      tenantId_provider: {
        tenantId,
        provider: 'SHOPIFY',
      },
    },
    select: {
      status: true,
      shopDomain: true,
    },
  });

  if (!integration || integration.status !== 'CONNECTED' || !integration.shopDomain) {
    throw new ShopifyIntegrationNotConnectedError(
      `Integración con Shopify no conectada para el tenant ${tenantId}.`
    );
  }

  const shopDomain = canonicalizeShopDomain(integration.shopDomain);
  const graphqlEndpoint = `https://${shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;
  const isMut = isMutation(query);
  const effectiveMaxRetries = isMut ? 0 : maxRetries;

  let attempt = 0;

  while (attempt <= effectiveMaxRetries) {
    attempt++;

    // 2. Obtener token válido (refresca automáticamente si está próximo a expirar)
    const accessToken = await getValidAccessToken(tenantId, { prismaClient, fetchFn });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetchFn(graphqlEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } catch (netErr) {
      if (netErr.name === 'AbortError' || controller.signal.aborted) {
        throw new ShopifyTimeoutError(
          `La petición GraphQL a Shopify excedió el límite de ${timeoutMs}ms.`
        );
      }
      throw new ShopifyNetworkError(`Error de red al invocar GraphQL de Shopify: ${netErr.message}`);
    } finally {
      clearTimeout(timeoutId);
    }

    // 3. Manejo de códigos HTTP de autenticación y tasa
    if (response.status === 401) {
      throw new ShopifyAuthError('Token de acceso inválido o revocado por la tienda de Shopify.');
    }

    if (response.status === 429) {
      // Throttling a nivel HTTP
      const retryAfterHeader = response.headers?.get?.('Retry-After');
      const waitSeconds = parseFloat(retryAfterHeader) || 2.0;

      if (!isMut && attempt <= maxRetries) {
        await new Promise((r) => setTimeout(r, waitSeconds * 1000));
        continue;
      }
      throw new ShopifyThrottledError(
        `Límite de tasa (HTTP 429) alcanzado en Shopify. Reintento recomendado en ${waitSeconds}s.`
      );
    }

    const bodyText = await response.text();
    let resJson;
    try {
      resJson = JSON.parse(bodyText);
    } catch {
      throw new ShopifyGraphqlError(null, `Respuesta HTTP ${response.status} de Shopify no es JSON válido.`);
    }

    const cost = resJson.extensions?.cost || null;

    // 4. Detección exhaustiva de errores top-level en response.errors (HTTP 200 o HTTP error)
    if (Array.isArray(resJson.errors) && resJson.errors.length > 0) {
      const isThrottledError = resJson.errors.some(
        (err) => err.extensions?.code === 'THROTTLED' || /throttled/i.test(err.message || '')
      );

      if (isThrottledError) {
        // Calcular tiempo de espera si los datos de restoreRate y cost están disponibles
        let waitMs = 2000;
        if (cost?.throttleStatus && cost?.requestedQueryCost) {
          const missing = cost.requestedQueryCost - cost.throttleStatus.currentlyAvailable;
          if (missing > 0 && cost.throttleStatus.restoreRate > 0) {
            waitMs = Math.ceil((missing / cost.throttleStatus.restoreRate) * 1000) + 100;
          }
        }

        // Reintentar si y solo si es una consulta idempotente de solo lectura
        if (!isMut && attempt <= maxRetries) {
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }

        throw new ShopifyThrottledError(
          `Consulta limitada por cuota de costo de Shopify (errors: THROTTLED).`
        );
      }

      // Otros errores top-level clasificados
      const isAccessDenied = resJson.errors.some(
        (err) => err.extensions?.code === 'ACCESS_DENIED'
      );
      if (isAccessDenied) {
        throw new ShopifyAuthError(
          'Permisos insuficientes para ejecutar la operación solicitada en Shopify.'
        );
      }

      throw new ShopifyGraphqlError(resJson.errors);
    }

    if (!response.ok) {
      throw new ShopifyGraphqlError(null, `Shopify HTTP ${response.status} error.`);
    }

    // 5. Retornar datos exitosos junto con la metadata de costo
    return {
      data: resJson.data || null,
      cost,
      extensions: resJson.extensions || null,
    };
  }

  throw new ShopifyThrottledError('Reintentos por límite de tasa de Shopify agotados.');
}
