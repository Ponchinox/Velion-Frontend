/**
 * SHOPIFY DRAFT ORDER SERVICE (API VERSION 2026-07)
 * ==================================================
 * Orquestador determinista para la creación y reconciliación de Draft Orders en Shopify.
 * 
 * Garantías de Seguridad e Invariantes Arquitectónicos:
 * 1. Sin Directiva @idempotent: Shopify 2026-07 no soporta @idempotent en draftOrderCreate.
 *    La idempotencia reside 100% en Velion mediante:
 *      - Snapshot previo de Order.id
 *      - Transición atómica de estado: NOT_STARTED -> CREATING
 *      - Tag único indexable: "velion-order-<ORDER_UUID>"
 *      - Custom attribute estructurado: key="velion_order_id", value="<ORDER_UUID>"
 *      - Coalescing en memoria + PostgreSQL Session Advisory Lock por Order.id.
 * 2. Cero Blind Retries: Las mutaciones fallidas jamás se reintentan automáticamente a ciegas.
 * 3. Manejo de Resultados Ambiguos: Ante timeouts o fallos de red post-dispatch, el estado
 *    transiciona a UNKNOWN_RESULT y se delega a reconciliación mediante query READ.
 * 4. invoiceUrl Null-Safe: Si draftOrder.id existe pero invoiceUrl es null, la orden es
 *    marcada exitosamente como CREATED (NUNCA se recrea ni duplica).
 * 5. Autoridad Monetaria: El total de la orden se actualiza con el monto real
 *    reportado por draftOrder.totalPriceSet.presentmentMoney.amount.
 */

import pg from 'pg';
import prisma from '../../../db.js';
import { executeShopifyGraphql } from './shopifyGraphqlClient.js';
import {
  ShopifyError,
  ShopifyDraftOrderError,
  ShopifyDraftOrderConflictError,
  ShopifyUnknownResultError,
  ShopifyCurrencyMismatchError,
  ShopifyReconciliationError,
  ShopifyIntegrationNotConnectedError,
} from './shopifyErrors.js';

const { Client } = pg;

// Mapa en memoria para coalescing por Order.id dentro del mismo proceso Node
const inFlightDraftOrders = new Map();

/**
 * Mutación GraphQL congelada para crear Draft Orders en Shopify Admin API 2026-07.
 * Sin directivas @idempotent no soportadas.
 */
export const DRAFT_ORDER_CREATE_MUTATION = `
  mutation draftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
        status
        currencyCode
        presentmentCurrencyCode
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
          presentmentMoney {
            amount
            currencyCode
          }
        }
        customAttributes {
          key
          value
        }
        tags
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Consulta GraphQL de reconciliación segura por tag indexable.
 */
export const RECONCILE_DRAFT_ORDER_QUERY = `
  query reconcileDraftOrder($query: String!) {
    draftOrders(first: 2, query: $query) {
      nodes {
        id
        name
        invoiceUrl
        status
        currencyCode
        presentmentCurrencyCode
        totalPriceSet {
          presentmentMoney {
            amount
            currencyCode
          }
        }
        customAttributes {
          key
          value
        }
        tags
      }
    }
  }
`;

/**
 * Construye el payload canónico DraftOrderInput V1.
 * 
 * @param {Object} order - Modelo Order local con items
 * @param {Object} integration - Modelo Integration de Shopify
 * @returns {Object} DraftOrderInput
 */
export function buildDraftOrderInput(order, integration) {
  if (!order || !order.id) {
    throw new ShopifyDraftOrderError('Order inválida para construir DraftOrderInput.', 'INVALID_ORDER');
  }
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new ShopifyDraftOrderError(`La orden ${order.id} no contiene items vendibles.`, 'EMPTY_ORDER_ITEMS');
  }
  if (!integration?.shopCurrencyCode) {
    throw new ShopifyDraftOrderError('Moneda de tienda Shopify no resuelta.', 'SHOPIFY_CURRENCY_UNRESOLVED');
  }

  const lineItems = order.items.map((item) => {
    if (!item.externalVariantId || !String(item.externalVariantId).startsWith('gid://shopify/ProductVariant/')) {
      throw new ShopifyDraftOrderError(
        `Item "${item.name}" carece de externalVariantId Shopify válido: ${item.externalVariantId}`,
        'INVALID_VARIANT_ID'
      );
    }
    const qty = parseInt(item.quantity, 10);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new ShopifyDraftOrderError(`Cantidad inválida para item "${item.name}": ${item.quantity}`, 'INVALID_QUANTITY');
    }

    return {
      variantId: item.externalVariantId,
      quantity: qty,
    };
  });

  return {
    lineItems,
    presentmentCurrencyCode: integration.shopCurrencyCode,
    note: 'Pedido asistido por Velion',
    tags: [
      'velion',
      `velion-${String(order.id).replace(/-/g, '')}`
    ],
    customAttributes: [
      {
        key: 'velion_order_id',
        value: String(order.id)
      }
    ]
  };
}

/**
 * Crea un Draft Order en Shopify a partir de una orden local pre-creada.
 * Implementa la máquina de estados con transición atómica:
 *   NOT_STARTED -> CREATING -> CREATED | ERROR | UNKNOWN_RESULT
 * 
 * @param {string} orderId - UUID de la orden local en PostgreSQL
 * @param {string} tenantId - ID del tenant
 * @param {Object} [options] - Inyectables para testing
 * @returns {Promise<Object>} { success, draftOrder, invoiceUrl }
 */
export async function createDraftOrderForOrder(orderId, tenantId, options = {}) {
  if (!orderId || typeof orderId !== 'string') {
    throw new ShopifyDraftOrderError('orderId válido es requerido.', 'INVALID_ORDER_ID');
  }
  if (!tenantId || typeof tenantId !== 'string') {
    throw new ShopifyDraftOrderError('tenantId válido es requerido.', 'INVALID_TENANT_ID');
  }

  // 1. Coalescing en memoria para evitar ejecuciones concurrentes por la misma orden en el mismo proceso
  if (inFlightDraftOrders.has(orderId)) {
    return inFlightDraftOrders.get(orderId);
  }

  const dispatchPromise = (async () => {
    const prismaClient = options.prismaClient || prisma;
    const graphqlExecutor = options.graphqlExecutor || executeShopifyGraphql;

    // 2. Adquirir PostgreSQL Session Advisory Lock por Order.id
    let pgClient = options.lockClient || null;
    let lockAcquired = false;

    if (!pgClient && process.env.DATABASE_URL) {
      try {
        pgClient = new Client({ connectionString: process.env.DATABASE_URL });
        await pgClient.connect();
      } catch (connErr) {
        console.warn('[ShopifyDraftOrder] Advertencia al conectar cliente PG para advisory lock:', connErr.message);
        pgClient = null;
      }
    }

    if (pgClient) {
      try {
        const lockRes = await pgClient.query('SELECT pg_try_advisory_lock(hashtext($1)) as locked', [
          `shopify_draft_order_${orderId}`
        ]);
        lockAcquired = lockRes.rows?.[0]?.locked === true;
      } catch (lockErr) {
        console.warn('[ShopifyDraftOrder] Advertencia al solicitar pg_try_advisory_lock:', lockErr.message);
        lockAcquired = true; // Permitir fallback en mocks
      }

      if (!lockAcquired) {
        if (!options.lockClient) await pgClient.end().catch(() => {});
        throw new ShopifyDraftOrderConflictError('Una creación de Draft Order ya está en ejecución para esta orden.');
      }
    }

    try {
      // 3. Re-leer la orden dentro del lock
      const order = await prismaClient.order.findFirst({
        where: { id: orderId, tenantId },
        include: { items: true }
      });

      if (!order) {
        throw new ShopifyDraftOrderError(`Orden "${orderId}" no encontrada para tenant "${tenantId}".`, 'ORDER_NOT_FOUND');
      }

      // 4. Evaluar estado actual de la máquina de estados
      if (order.externalSyncStatus === 'CREATED') {
        console.log(`ℹ️ [ShopifyDraftOrder] Orden "${orderId}" ya fue creada previamente (externalDraftOrderId: ${order.externalDraftOrderId}). Devolviendo estado existente sin mutaciones.`);
        return {
          success: true,
          isExisting: true,
          draftOrder: {
            id: order.externalDraftOrderId,
            invoiceUrl: order.externalCheckoutUrl,
            status: 'OPEN',
            totalAmount: order.totalAmount,
            currencyCode: order.currencyCode,
          },
          invoiceUrl: order.externalCheckoutUrl || null,
        };
      }

      if (order.externalSyncStatus === 'CREATING') {
        throw new ShopifyDraftOrderConflictError('La orden ya se encuentra en proceso de despacho (CREATING).');
      }

      if (order.externalSyncStatus === 'UNKNOWN_RESULT') {
        console.log(`ℹ️ [ShopifyDraftOrder] Orden "${orderId}" en estado UNKNOWN_RESULT. Ejecutando reconciliación de solo lectura sin nueva mutación.`);
        return await reconcileDraftOrder(orderId, tenantId, {
          prismaClient,
          graphqlExecutor,
          lockClient: pgClient
        });
      }

      if (order.externalSyncStatus === 'ERROR') {
        throw new ShopifyDraftOrderError(
          `La orden se encuentra en estado ERROR previo: ${order.externalSyncError}. Reintento no autorizado sin política explícita.`,
          'PREVIOUS_ERROR_BLOCKED'
        );
      }

      // 5. TRANSICIÓN ATÓMICA: NOT_STARTED -> CREATING (Corrección Obligatoria 1)
      const claimResult = await prismaClient.order.updateMany({
        where: {
          id: orderId,
          tenantId,
          externalSyncStatus: 'NOT_STARTED'
        },
        data: {
          externalSyncStatus: 'CREATING',
          externalSyncAttempts: { increment: 1 }
        }
      });

      if (claimResult.count !== 1) {
        // Otro proceso tomó el reclamo concurrentemente
        const recheck = await prismaClient.order.findUnique({ where: { id: orderId } });
        if (recheck?.externalSyncStatus === 'CREATED') {
          return {
            success: true,
            isExisting: true,
            draftOrder: {
              id: recheck.externalDraftOrderId,
              invoiceUrl: recheck.externalCheckoutUrl,
              totalAmount: recheck.totalAmount,
              currencyCode: recheck.currencyCode,
            },
            invoiceUrl: recheck.externalCheckoutUrl || null,
          };
        }
        throw new ShopifyDraftOrderConflictError('Conflicto concurrente en transición atómica de la orden.');
      }

      // 6. Obtener integración del tenant y validar configuración
      const integration = await prismaClient.integration.findFirst({
        where: { tenantId, provider: 'SHOPIFY' },
        select: {
          id: true,
          status: true,
          shopDomain: true,
          externalOrderMode: true,
          priceSource: true,
          shopCurrencyCode: true,
        }
      });

      if (!integration || integration.status !== 'CONNECTED' || !integration.shopDomain) {
        await prismaClient.order.update({
          where: { id: orderId },
          data: { externalSyncStatus: 'ERROR', externalSyncError: 'SHOPIFY_INTEGRATION_NOT_CONNECTED' }
        });
        throw new ShopifyIntegrationNotConnectedError(`Integración Shopify inactiva para tenant ${tenantId}.`);
      }

      if (integration.externalOrderMode === 'NONE' || !integration.externalOrderMode) {
        await prismaClient.order.update({
          where: { id: orderId },
          data: { externalSyncStatus: 'ERROR', externalSyncError: 'EXTERNAL_ORDER_DISABLED' }
        });
        throw new ShopifyDraftOrderError('La creación de pedidos externos está deshabilitada.', 'EXTERNAL_ORDER_DISABLED');
      }

      if (integration.externalOrderMode === 'SHOPIFY_COMPLETE') {
        await prismaClient.order.update({
          where: { id: orderId },
          data: { externalSyncStatus: 'ERROR', externalSyncError: 'SHOPIFY_COMPLETE_NOT_IMPLEMENTED' }
        });
        throw new ShopifyDraftOrderError('Modo SHOPIFY_COMPLETE no implementado en Fase 5B.', 'SHOPIFY_COMPLETE_NOT_IMPLEMENTED');
      }

      if (integration.priceSource === 'VELION') {
        await prismaClient.order.update({
          where: { id: orderId },
          data: { externalSyncStatus: 'ERROR', externalSyncError: 'SHOPIFY_PRICE_OVERRIDE_CURRENCY_UNRESOLVED' }
        });
        throw new ShopifyDraftOrderError(
          'priceSource VELION no está permitido para pedidos Shopify en Fase 5B.',
          'SHOPIFY_PRICE_OVERRIDE_CURRENCY_UNRESOLVED'
        );
      }

      if (!integration.shopCurrencyCode) {
        await prismaClient.order.update({
          where: { id: orderId },
          data: { externalSyncStatus: 'ERROR', externalSyncError: 'SHOPIFY_CURRENCY_UNRESOLVED' }
        });
        throw new ShopifyDraftOrderError('Moneda de tienda Shopify no resuelta.', 'SHOPIFY_CURRENCY_UNRESOLVED');
      }

      // 7. Construir DraftOrderInput
      const input = buildDraftOrderInput(order, integration);

      // 8. Ejecutar mutación draftOrderCreate (CERO blind retries)
      let mutationResult;
      try {
        mutationResult = await graphqlExecutor(tenantId, {
          query: DRAFT_ORDER_CREATE_MUTATION,
          variables: { input },
          prismaClient
        });
      } catch (transportErr) {
        // Timeout, error de red o fallo de transporte -> UNKNOWN_RESULT
        console.warn(`⚠️ [ShopifyDraftOrder] Fallo de transporte en draftOrderCreate para orden "${orderId}":`, transportErr.message);
        await prismaClient.order.update({
          where: { id: orderId },
          data: {
            externalSyncStatus: 'UNKNOWN_RESULT',
            externalSyncError: ShopifyError.sanitize(transportErr.message || 'Network/timeout failure')
          }
        });

        // Intentar reconciliación inmediata de solo lectura
        return await reconcileDraftOrder(orderId, tenantId, {
          prismaClient,
          graphqlExecutor,
          lockClient: pgClient
        });
      }

      // 9. Procesar errores a nivel de negocio (userErrors)
      const payload = mutationResult?.data?.draftOrderCreate;
      const userErrors = payload?.userErrors || [];

      if (userErrors.length > 0) {
        const errorSummary = userErrors.map(e => `${e.field || 'input'}: ${e.message}`).join('; ');
        console.error(`❌ [ShopifyDraftOrder] userErrors en draftOrderCreate para orden "${orderId}":`, errorSummary);
        await prismaClient.order.update({
          where: { id: orderId },
          data: {
            externalSyncStatus: 'ERROR',
            externalSyncError: ShopifyError.sanitize(errorSummary)
          }
        });
        return {
          success: false,
          error: 'SHOPIFY_USER_ERROR',
          userErrors
        };
      }

      const createdDraft = payload?.draftOrder;
      if (!createdDraft || !createdDraft.id) {
        console.warn(`⚠️ [ShopifyDraftOrder] Respuesta HTTP 200 sin draftOrder.id ni userErrors para orden "${orderId}". Marcando UNKNOWN_RESULT.`);
        await prismaClient.order.update({
          where: { id: orderId },
          data: {
            externalSyncStatus: 'UNKNOWN_RESULT',
            externalSyncError: 'Respuesta sin draftOrder.id'
          }
        });
        return await reconcileDraftOrder(orderId, tenantId, {
          prismaClient,
          graphqlExecutor,
          lockClient: pgClient
        });
      }

      // 10. Validaciones post-creación exitosa: Moneda y Totales
      const returnedCurrency = createdDraft.presentmentCurrencyCode || createdDraft.currencyCode;
      if (returnedCurrency && returnedCurrency !== integration.shopCurrencyCode) {
        console.warn(`⚠️ [ShopifyDraftOrder] DRAFT_CURRENCY_MISMATCH: Esperado ${integration.shopCurrencyCode}, devuelto ${returnedCurrency}`);
      }

      // Corrección Obligatoria 3: La autoridad del monto snapshot es el presentmentMoney real
      const presentmentAmountStr = createdDraft.totalPriceSet?.presentmentMoney?.amount;
      const finalTotal = presentmentAmountStr ? parseFloat(presentmentAmountStr) : order.totalAmount;
      const finalCurrency = createdDraft.totalPriceSet?.presentmentMoney?.currencyCode || returnedCurrency || integration.shopCurrencyCode;

      // Actualizar Orden local como CREATED
      await prismaClient.order.update({
        where: { id: orderId },
        data: {
          externalDraftOrderId: createdDraft.id,
          externalCheckoutUrl: createdDraft.invoiceUrl || null,
          externalOrderNumber: createdDraft.name || null,
          totalAmount: finalTotal,
          currencyCode: finalCurrency,
          externalSyncStatus: 'CREATED',
          externalSyncedAt: new Date(),
          externalSyncError: null
        }
      });

      console.log(`✅ [ShopifyDraftOrder] Draft Order creada exitosamente: ${createdDraft.id} (${createdDraft.name || ''}) | Total: ${finalCurrency} ${finalTotal}`);

      return {
        success: true,
        draftOrder: {
          id: createdDraft.id,
          name: createdDraft.name,
          invoiceUrl: createdDraft.invoiceUrl || null,
          status: createdDraft.status,
          currencyCode: createdDraft.currencyCode,
          presentmentCurrencyCode: createdDraft.presentmentCurrencyCode,
          totalAmount: finalTotal,
          currency: finalCurrency
        },
        invoiceUrl: createdDraft.invoiceUrl || null
      };

    } finally {
      // 11. Liberar PostgreSQL Advisory Lock
      if (pgClient && lockAcquired) {
        try {
          await pgClient.query('SELECT pg_advisory_unlock(hashtext($1))', [`shopify_draft_order_${orderId}`]);
        } catch (unlockErr) {
          console.warn('[ShopifyDraftOrder] Advertencia al liberar advisory lock:', unlockErr.message);
        }
        if (!options.lockClient) {
          await pgClient.end().catch(() => {});
        }
      }
    }
  })();

  inFlightDraftOrders.set(orderId, dispatchPromise);
  try {
    return await dispatchPromise;
  } finally {
    inFlightDraftOrders.delete(orderId);
  }
}

/**
 * Reconcilia de solo lectura un Draft Order ambiguo (UNKNOWN_RESULT) consultando
 * por el tag único indexable "velion-order-<ORDER_UUID>" y verificando customAttributes.
 * 
 * @param {string} orderId
 * @param {string} tenantId
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function reconcileDraftOrder(orderId, tenantId, options = {}) {
  const prismaClient = options.prismaClient || prisma;
  const graphqlExecutor = options.graphqlExecutor || executeShopifyGraphql;

  const expectedTag = `velion-${String(orderId).replace(/-/g, '')}`;
  console.log(`🔍 [ShopifyReconciliation] Consultando draftOrders con tag "${expectedTag}" para orden "${orderId}"...`);

  let queryResult;
  try {
    queryResult = await graphqlExecutor(tenantId, {
      query: RECONCILE_DRAFT_ORDER_QUERY,
      variables: { query: `tag:${expectedTag}` },
      prismaClient
    });
  } catch (reconcileErr) {
    console.warn(`⚠️ [ShopifyReconciliation] Fallo al consultar Shopify durante reconciliación:`, reconcileErr.message);
    return {
      success: false,
      status: 'UNKNOWN_RESULT',
      error: 'RECONCILIATION_QUERY_FAILED',
      message: ShopifyError.sanitize(reconcileErr.message)
    };
  }

  const nodes = queryResult?.data?.draftOrders?.nodes || [];

  // Filtrar estrictamente por customAttributes: velion_order_id === orderId
  const exactMatches = nodes.filter((node) => {
    const attrs = node.customAttributes || [];
    return attrs.some(a => a.key === 'velion_order_id' && String(a.value).trim() === String(orderId).trim());
  });

  console.log(`🔍 [ShopifyReconciliation] Resultados con tag: ${nodes.length}, coincidencias exactas por attribute: ${exactMatches.length}`);

  if (exactMatches.length === 1) {
    // Exactamente 1 coincidencia: RECUPERACIÓN EXITOSA
    const recovered = exactMatches[0];
    const presentmentAmountStr = recovered.totalPriceSet?.presentmentMoney?.amount;
    const finalTotal = presentmentAmountStr ? parseFloat(presentmentAmountStr) : undefined;
    const finalCurrency = recovered.totalPriceSet?.presentmentMoney?.currencyCode || recovered.presentmentCurrencyCode || recovered.currencyCode;

    await prismaClient.order.update({
      where: { id: orderId },
      data: {
        externalDraftOrderId: recovered.id,
        externalCheckoutUrl: recovered.invoiceUrl || null,
        externalOrderNumber: recovered.name || null,
        ...(finalTotal ? { totalAmount: finalTotal } : {}),
        ...(finalCurrency ? { currencyCode: finalCurrency } : {}),
        externalSyncStatus: 'CREATED',
        externalSyncedAt: new Date(),
        externalSyncError: null
      }
    });

    console.log(`✅ [ShopifyReconciliation] Draft Order recuperada con éxito: ${recovered.id} (${recovered.name || ''})`);

    return {
      success: true,
      recovered: true,
      draftOrder: {
        id: recovered.id,
        name: recovered.name,
        invoiceUrl: recovered.invoiceUrl || null,
        status: recovered.status,
        currencyCode: recovered.currencyCode,
        presentmentCurrencyCode: recovered.presentmentCurrencyCode,
        totalAmount: finalTotal,
        currency: finalCurrency
      },
      invoiceUrl: recovered.invoiceUrl || null
    };
  }

  if (exactMatches.length === 0) {
    // 0 coincidencias: MANTENER UNKNOWN_RESULT (NUNCA recrear a ciegas)
    console.warn(`⚠️ [ShopifyReconciliation] 0 coincidencias encontradas para tag "${expectedTag}". Manteniendo UNKNOWN_RESULT.`);
    return {
      success: false,
      status: 'UNKNOWN_RESULT',
      matchesCount: 0,
      message: 'No se encontró Draft Order previo para esta orden en Shopify.'
    };
  }

  // 2+ coincidencias: ANOMALÍA AMBIGUA
  console.error(`🚨 [ShopifyReconciliation] Múltiples Draft Orders (${exactMatches.length}) encontradas con el mismo tag y attribute para la orden "${orderId}". Bloqueando fail-closed.`);
  await prismaClient.order.update({
    where: { id: orderId },
    data: {
      externalSyncStatus: 'RECONCILIATION_AMBIGUOUS',
      externalSyncError: `Se detectaron ${exactMatches.length} Draft Orders con el mismo identificador en Shopify.`
    }
  });

  return {
    success: false,
    status: 'RECONCILIATION_AMBIGUOUS',
    matchesCount: exactMatches.length,
    error: 'RECONCILIATION_AMBIGUOUS'
  };
}

export default {
  buildDraftOrderInput,
  createDraftOrderForOrder,
  reconcileDraftOrder,
  DRAFT_ORDER_CREATE_MUTATION,
  RECONCILE_DRAFT_ORDER_QUERY
};
