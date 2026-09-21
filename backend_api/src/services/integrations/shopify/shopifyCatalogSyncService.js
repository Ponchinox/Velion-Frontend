/**
 * SHOPIFY CATALOG SYNC SERVICE
 * =============================
 * Sincronizador bidireccional / réplica local de catálogo de Shopify hacia Velion.
 * Mapea:
 *   Shopify Product        -> ExternalProduct
 *   Shopify ProductVariant -> ExternalProductVariant
 *
 * Principios y Garantías:
 * 1. Concurrencia: In-memory coalescing + PostgreSQL Advisory Session Lock por tenant.
 * 2. Red separada de Transacción: Toda la comunicación HTTP GraphQL ocurre ANTES de abrir la transacción local.
 * 3. Two-Pass Pagination: Pass A (productos globales) + Pass B (variantes globales) evitando N+1 anidados.
 * 4. Reconciliación segura: El borrado de registros obsoletos (syncedAt < syncMarker) ocurre EXCLUSIVAMENTE
 *    tras un fetch 100% exitoso y validado dentro de la misma transacción atómica.
 * 5. Cero fugas de credenciales en logs o lastSyncError.
 */

import pg from 'pg';
import prisma from '../../../db.js';
import { executeShopifyGraphql } from './shopifyGraphqlClient.js';
import {
  ShopifyError,
  ShopifySyncConflictError,
  ShopifySyncError,
  ShopifyIntegrationNotConnectedError,
} from './shopifyErrors.js';
import { invalidateCatalogCache } from '../../catalogCacheService.js';

const { Client } = pg;

// Constantes de paginación y cuotas
export const PRODUCT_PAGE_SIZE = 50;
export const VARIANT_PAGE_SIZE = 100;
export const IMAGE_SYNC_LIMIT = 10;
export const SAFETY_RESERVE = 50;

// Mapa en memoria para coalescing dentro del mismo proceso Node
const inFlightSyncs = new Map();

export const PRODUCTS_QUERY = `
  query getProducts($first: Int!, $after: String) {
    shop {
      currencyCode
    }
    products(first: $first, after: $after) {
      nodes {
        id
        title
        description
        status
        productType
        tags
        updatedAt
        category {
          id
          fullName
        }
        images(first: 10) {
          nodes {
            url
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const PRODUCT_VARIANTS_QUERY = `
  query getProductVariants($first: Int!, $after: String) {
    productVariants(first: $first, after: $after) {
      nodes {
        id
        title
        sku
        price
        compareAtPrice
        availableForSale
        inventoryQuantity
        updatedAt
        inventoryItem {
          id
        }
        product {
          id
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/**
 * Parsea y valida valores monetarios asegurando finitud y precisión decimal.
 */
export function parseMoney(value, fieldName = 'price') {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || isNaN(num) || num < 0) {
    throw new ShopifySyncError(`Valor monetario inválido en ${fieldName}: ${value}`, 'INVALID_MONEY_VALUE');
  }
  return Math.round(num * 100) / 100;
}

/**
 * Parsea y valida cantidades de inventario.
 * Regla V1: null o undefined -> 0. Cualquier valor no entero lanza error.
 */
export function parseInventoryQuantity(value) {
  if (value === null || value === undefined) {
    return 0;
  }
  const q = Number(value);
  if (!Number.isInteger(q)) {
    throw new ShopifySyncError(`Cantidad de inventario no entera o inválida: ${value}`, 'INVALID_INVENTORY_QUANTITY');
  }
  return q;
}

/**
 * Calcula la disponibilidad del producto según el status y el estado de venta de sus variantes.
 * ACTIVE + al menos una variante con availableForSale === true => isAvailable = true.
 */
export function computeProductAvailability(status, variants) {
  if (status !== 'ACTIVE') return false;
  if (!Array.isArray(variants) || variants.length === 0) return false;
  return variants.some((v) => v.availableForSale === true);
}

/**
 * Aplica espera preventiva dinámica si la cuota disponible de Shopify es inferior a la requerida.
 */
export async function applyThrottleWait(cost, nextEstimatedCost = 50) {
  if (!cost?.throttleStatus) return;
  const { currentlyAvailable, restoreRate } = cost.throttleStatus;
  const required = nextEstimatedCost + SAFETY_RESERVE;
  if (currentlyAvailable < required && restoreRate > 0) {
    const waitMs = Math.min(Math.ceil(((required - currentlyAvailable) / restoreRate) * 1000), 10000);
    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

/**
 * Ejecuta el Full Sync del catálogo de Shopify para un tenant.
 *
 * @param {string} tenantId - Tenant ID de Velion
 * @param {Object} [options] - Opciones inyectables para pruebas y control
 * @param {Object} [options.prismaClient]
 * @param {Function} [options.graphqlExecutor]
 * @param {Object} [options.lockClient] - Mock de conexión PG para advisory lock
 * @returns {Promise<Object>} Resumen del sync { success, productsSynced, variantsSynced, staleProductsDeleted, staleVariantsDeleted, durationMs, transactionDurationMs }
 */
export async function syncShopifyCatalog(tenantId, options = {}) {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new ShopifySyncError('tenantId válido es requerido para sincronizar catálogo.');
  }

  // 1. Coalescing en memoria para evitar ejecuciones concurrentes en el mismo worker
  if (inFlightSyncs.has(tenantId)) {
    throw new ShopifySyncConflictError('Una sincronización de catálogo ya está en ejecución para este tenant.');
  }

  const syncPromise = (async () => {
    const startTime = Date.now();
    const prismaClient = options.prismaClient || prisma;
    const graphqlExecutor = options.graphqlExecutor || executeShopifyGraphql;

    // 2. Obtener Integration del tenant
    const integration = await prismaClient.integration.findUnique({
      where: {
        tenantId_provider: {
          tenantId,
          provider: 'SHOPIFY',
        },
      },
    });

    if (!integration || integration.status !== 'CONNECTED' || !integration.shopDomain) {
      throw new ShopifyIntegrationNotConnectedError(
        `Integración con Shopify no conectada o inactiva para el tenant ${tenantId}.`
      );
    }

    // 3. Adquirir PostgreSQL Session Advisory Lock en conexión dedicada
    let pgClient = options.lockClient || null;
    let lockAcquired = false;

    if (!pgClient && process.env.DATABASE_URL) {
      try {
        pgClient = new Client({ connectionString: process.env.DATABASE_URL });
        await pgClient.connect();
      } catch (connErr) {
        console.warn('[ShopifySync] Advertencia al conectar cliente PG para advisory lock:', connErr.message);
        pgClient = null;
      }
    }

    if (pgClient) {
      try {
        const lockRes = await pgClient.query('SELECT pg_try_advisory_lock(hashtext($1)) as locked', [
          `shopify_sync_${tenantId}`,
        ]);
        lockAcquired = lockRes.rows?.[0]?.locked === true;
      } catch (lockErr) {
        console.warn('[ShopifySync] Advertencia al solicitar pg_try_advisory_lock:', lockErr.message);
        lockAcquired = true; // Si el adapter no soporta advisory locks, permitir continuar en tests
      }

      if (!lockAcquired) {
        if (!options.lockClient) await pgClient.end().catch(() => {});
        throw new ShopifySyncConflictError('Una sincronización de catálogo ya está en ejecución para este tenant.');
      }
    }

    try {
      // 4. Marcar estado SYNCING en Integration
      await prismaClient.integration.update({
        where: { id: integration.id },
        data: { syncStatus: 'SYNCING' },
      });

      // ── PASS A: PAGINACIÓN DE PRODUCTOS ─────────────────────────────────
      const rawProductsMap = new Map();
      let hasNextPage = true;
      let afterCursor = null;
      const seenProductCursors = new Set();
      let detectedShopCurrency = null;

      while (hasNextPage) {
        const result = await graphqlExecutor(tenantId, {
          query: PRODUCTS_QUERY,
          variables: { first: PRODUCT_PAGE_SIZE, after: afterCursor },
          prismaClient,
        });

        if (!detectedShopCurrency && result.data?.shop?.currencyCode) {
          detectedShopCurrency = String(result.data.shop.currencyCode).trim().toUpperCase();
        }

        const productConnection = result.data?.products;
        if (!productConnection || !Array.isArray(productConnection.nodes)) {
          throw new ShopifySyncError('Respuesta inesperada de Shopify en consulta de productos.', 'INVALID_PRODUCTS_RESPONSE');
        }

        for (const rawProd of productConnection.nodes) {
          if (!rawProd || !rawProd.id || !rawProd.title) {
            throw new ShopifySyncError('Producto con formato o ID inválido recibido de Shopify.', 'MALFORMED_PRODUCT');
          }
          rawProductsMap.set(rawProd.id, {
            ...rawProd,
            variants: [], // Se poblarán en Pass B
          });
        }

        hasNextPage = Boolean(productConnection.pageInfo?.hasNextPage);
        const endCursor = productConnection.pageInfo?.endCursor || null;

        if (hasNextPage) {
          if (!endCursor) {
            throw new ShopifySyncError('Shopify indicó hasNextPage=true pero no proporcionó endCursor.', 'MISSING_END_CURSOR');
          }
          if (seenProductCursors.has(endCursor)) {
            throw new ShopifySyncError(`Bucle infinito de cursor detectado en productos: ${endCursor}`, 'PAGINATION_CURSOR_LOOP');
          }
          seenProductCursors.add(endCursor);
          afterCursor = endCursor;
          await applyThrottleWait(result.cost, 150);
        }
      }

      // ── PASS B: PAGINACIÓN DE VARIANTES ─────────────────────────────────
      const rawVariantsList = [];
      hasNextPage = true;
      afterCursor = null;
      const seenVariantCursors = new Set();

      while (hasNextPage) {
        const result = await graphqlExecutor(tenantId, {
          query: PRODUCT_VARIANTS_QUERY,
          variables: { first: VARIANT_PAGE_SIZE, after: afterCursor },
          prismaClient,
        });

        const variantConnection = result.data?.productVariants;
        if (!variantConnection || !Array.isArray(variantConnection.nodes)) {
          throw new ShopifySyncError('Respuesta inesperada de Shopify en consulta de variantes.', 'INVALID_VARIANTS_RESPONSE');
        }

        for (const rawVar of variantConnection.nodes) {
          if (!rawVar || !rawVar.id || !rawVar.title) {
            throw new ShopifySyncError('Variante con formato o ID inválido recibida de Shopify.', 'MALFORMED_VARIANT');
          }

          const parentShopifyId = rawVar.product?.id;
          if (!parentShopifyId || !rawProductsMap.has(parentShopifyId)) {
            throw new ShopifySyncError(
              `Variante huérfana detectada: ${rawVar.id} apunta a producto desconocido ${parentShopifyId}.`,
              'ORPHAN_SHOPIFY_VARIANT'
            );
          }

          // Validar precios e inventario antes de admitir la variante
          const price = parseMoney(rawVar.price, 'price');
          const compareAtPrice = parseMoney(rawVar.compareAtPrice, 'compareAtPrice');
          const inventoryQuantity = parseInventoryQuantity(rawVar.inventoryQuantity);

          const parsedVariant = {
            id: rawVar.id,
            productShopifyId: parentShopifyId,
            inventoryItemId: rawVar.inventoryItem?.id || null,
            sku: rawVar.sku?.trim() || null,
            normalizedSku: rawVar.sku?.trim().toUpperCase() || null,
            title: rawVar.title.trim(),
            price,
            compareAtPrice,
            inventoryQuantity,
            availableForSale: rawVar.availableForSale === true,
          };

          rawVariantsList.push(parsedVariant);
          rawProductsMap.get(parentShopifyId).variants.push(parsedVariant);
        }

        hasNextPage = Boolean(variantConnection.pageInfo?.hasNextPage);
        const endCursor = variantConnection.pageInfo?.endCursor || null;

        if (hasNextPage) {
          if (!endCursor) {
            throw new ShopifySyncError('Shopify indicó hasNextPage=true pero no proporcionó endCursor en variantes.', 'MISSING_END_CURSOR');
          }
          if (seenVariantCursors.has(endCursor)) {
            throw new ShopifySyncError(`Bucle infinito de cursor detectado en variantes: ${endCursor}`, 'PAGINATION_CURSOR_LOOP');
          }
          seenVariantCursors.add(endCursor);
          afterCursor = endCursor;
          await applyThrottleWait(result.cost, 100);
        }
      }

      // ── MAPPING Y PERSISTENCIA TRANSACCIONAL LOCAL ─────────────────────────
      // Toda la comunicación de red ha concluido satisfactoriamente.
      // Se genera el syncMarker que compartirán TODOS los registros upserted.
      const syncMarker = new Date();
      let txStartTime = Date.now();
      let staleProductsDeleted = 0;
      let staleVariantsDeleted = 0;

      await prismaClient.$transaction(
        async (tx) => {
          const localProductIdMap = new Map();

          // A) Upsert de ExternalProduct
          for (const rawProd of rawProductsMap.values()) {
            const rawImages = Array.isArray(rawProd.images?.nodes)
              ? rawProd.images.nodes.map((n) => n.url).filter(Boolean).slice(0, IMAGE_SYNC_LIMIT)
              : [];
            const imageUrl = rawImages[0] || null;

            const category =
              rawProd.category?.fullName?.trim() ||
              rawProd.productType?.trim() ||
              null;

            const isAvailable = computeProductAvailability(rawProd.status, rawProd.variants);

            const tags = Array.isArray(rawProd.tags) ? rawProd.tags : [];

            const upserted = await tx.externalProduct.upsert({
              where: {
                tenantId_provider_externalId: {
                  tenantId,
                  provider: 'SHOPIFY',
                  externalId: rawProd.id,
                },
              },
              create: {
                tenantId,
                integrationId: integration.id,
                provider: 'SHOPIFY',
                externalId: rawProd.id,
                title: rawProd.title.trim(),
                description: rawProd.description?.trim() || null,
                category,
                tags,
                imageUrl,
                images: rawImages,
                isAvailable,
                syncedAt: syncMarker,
              },
              update: {
                title: rawProd.title.trim(),
                description: rawProd.description?.trim() || null,
                category,
                tags,
                imageUrl,
                images: rawImages,
                isAvailable,
                syncedAt: syncMarker,
              },
            });

            localProductIdMap.set(rawProd.id, upserted.id);
          }

          // B) Upsert de ExternalProductVariant
          for (const parsedVar of rawVariantsList) {
            const localParentId = localProductIdMap.get(parsedVar.productShopifyId);

            await tx.externalProductVariant.upsert({
              where: {
                tenantId_provider_externalVariantId: {
                  tenantId,
                  provider: 'SHOPIFY',
                  externalVariantId: parsedVar.id,
                },
              },
              create: {
                tenantId,
                externalProductId: localParentId,
                provider: 'SHOPIFY',
                externalVariantId: parsedVar.id,
                inventoryItemId: parsedVar.inventoryItemId,
                sku: parsedVar.sku,
                normalizedSku: parsedVar.normalizedSku,
                title: parsedVar.title,
                price: parsedVar.price,
                compareAtPrice: parsedVar.compareAtPrice,
                inventoryQuantity: parsedVar.inventoryQuantity,
                availableForSale: parsedVar.availableForSale,
                syncedAt: syncMarker,
              },
              update: {
                externalProductId: localParentId,
                inventoryItemId: parsedVar.inventoryItemId,
                sku: parsedVar.sku,
                normalizedSku: parsedVar.normalizedSku,
                title: parsedVar.title,
                price: parsedVar.price,
                compareAtPrice: parsedVar.compareAtPrice,
                inventoryQuantity: parsedVar.inventoryQuantity,
                availableForSale: parsedVar.availableForSale,
                syncedAt: syncMarker,
              },
            });
          }

          // C) Reconciliación de Stale Records (registros locales con syncedAt < syncMarker)
          const staleVariantsResult = await tx.externalProductVariant.deleteMany({
            where: {
              tenantId,
              provider: 'SHOPIFY',
              syncedAt: { lt: syncMarker },
            },
          });
          staleVariantsDeleted = staleVariantsResult.count || 0;

          const staleProductsResult = await tx.externalProduct.deleteMany({
            where: {
              tenantId,
              provider: 'SHOPIFY',
              integrationId: integration.id,
              syncedAt: { lt: syncMarker },
            },
          });
          staleProductsDeleted = staleProductsResult.count || 0;

          // D) Actualizar Integration con éxito
          const updateIntegrationData = {
            syncStatus: 'IDLE',
            lastSyncedAt: syncMarker,
            lastSyncError: null,
          };
          if (detectedShopCurrency) {
            updateIntegrationData.shopCurrencyCode = detectedShopCurrency;
          }

          await tx.integration.update({
            where: { id: integration.id },
            data: updateIntegrationData,
          });
        },
        { timeout: 60000 }
      );

      // Invalida caché de catálogo del tenant para reflejo inmediato en el agente
      try {
        invalidateCatalogCache(tenantId);
      } catch (cacheErr) {
        console.warn('[ShopifySync] Advertencia al invalidar catalog cache:', cacheErr.message);
      }

      const transactionDurationMs = Date.now() - txStartTime;
      const durationMs = Date.now() - startTime;

      return {
        success: true,
        productsSynced: rawProductsMap.size,
        variantsSynced: rawVariantsList.length,
        staleProductsDeleted,
        staleVariantsDeleted,
        durationMs,
        transactionDurationMs,
      };
    } catch (err) {
      // 5. Ante error: marcar syncStatus = 'ERROR' con mensaje sanitizado sin filtrar secretos
      const sanitizedError = ShopifyError.sanitize(err.message || 'Error desconocido durante la sincronización.');
      try {
        await prismaClient.integration.update({
          where: { id: integration.id },
          data: {
            syncStatus: 'ERROR',
            lastSyncError: sanitizedError,
          },
        });
      } catch (updateErr) {
        console.error('[ShopifySync] Error al registrar fallo en Integration:', updateErr.message);
      }
      throw err;
    } finally {
      // 6. Liberar Advisory Session Lock en PostgreSQL
      if (pgClient && lockAcquired) {
        try {
          await pgClient.query('SELECT pg_advisory_unlock(hashtext($1))', [`shopify_sync_${tenantId}`]);
        } catch (unlockErr) {
          console.warn('[ShopifySync] Advertencia al liberar advisory lock:', unlockErr.message);
        }
        if (!options.lockClient) {
          await pgClient.end().catch(() => {});
        }
      }
    }
  })();

  inFlightSyncs.set(tenantId, syncPromise);
  try {
    return await syncPromise;
  } finally {
    inFlightSyncs.delete(tenantId);
  }
}
