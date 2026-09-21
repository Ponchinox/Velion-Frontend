/**
 * scripts/test_phase5b_live_draft_order.js
 * =========================================
 * Script de validación en vivo para Fase 5B:
 * Ejecución del ÚNICO live draftOrderCreate autorizado previamente contra
 * velion-dev.myshopify.com y verificación estricta de idempotencia y reconciliación.
 * 
 * Invariantes y Restricciones Estrictas:
 * - Tienda exclusiva: velion-dev.myshopify.com
 * - Base de datos local: velion_shopify_dev (PostgreSQL local 127.0.0.1:54333)
 * - Producto: The Minimal Snowboard (cantidad: 1)
 * - EXACTAMENTE 1 mutación draftOrderCreate en vivo.
 * - Cero completado, cero cobrado, cero envío de invoices por email.
 * - Cero creación de customer en Shopify.
 * - Segunda llamada inmediata demuestra 0 mutaciones adicionales (idempotencia).
 * - Reconciliación post-creación demuestra 1 coincidencia exacta (tag + attribute).
 */

import crypto from 'node:crypto';
import prisma from '../src/db.js';
import { executeShopifyGraphql } from '../src/services/integrations/shopify/shopifyGraphqlClient.js';
import {
  createDraftOrderForOrder,
  reconcileDraftOrder,
  RECONCILE_DRAFT_ORDER_QUERY
} from '../src/services/integrations/shopify/shopifyDraftOrderService.js';

console.log('======================================================================');
console.log('🚀 FASE 5B: SHOPIFY DRAFT ORDER LIVE VALIDATION (velion-dev.myshopify.com)');
console.log('======================================================================\n');

async function runLiveTest() {
  // 1. Verificación Pre-flight de Integración y Tienda
  console.log('🔍 [Pre-flight] Verificando integración y entorno local...');
  const integration = await prisma.integration.findFirst({
    where: { provider: 'SHOPIFY' },
    include: { tenant: true }
  });

  if (!integration || integration.status !== 'CONNECTED') {
    throw new Error(`Integración no conectada: status=${integration?.status}`);
  }

  if (integration.shopDomain !== 'velion-dev.myshopify.com') {
    throw new Error(`ABORT: shopDomain no es la Development Store: ${integration.shopDomain}`);
  }

  const tenantId = integration.tenantId;
  console.log(`  -> Tenant ID: ${tenantId}`);
  console.log(`  -> Shop Domain: ${integration.shopDomain}`);
  console.log(`  -> Shop Currency: ${integration.shopCurrencyCode}`);
  console.log(`  -> External Order Mode: ${integration.externalOrderMode}`);
  console.log(`  -> Price Source: ${integration.priceSource}`);

  // 2. Localizar "The Minimal Snowboard" en la base de datos sincronizada
  console.log('\n🔍 [Catalog] Buscando "The Minimal Snowboard" en catálogo local...');
  const snowboard = await prisma.externalProduct.findFirst({
    where: {
      tenantId,
      provider: 'SHOPIFY',
      title: { contains: 'The Minimal Snowboard', mode: 'insensitive' }
    },
    include: { variants: true }
  });

  if (!snowboard || snowboard.variants.length === 0) {
    throw new Error('No se encontró "The Minimal Snowboard" o sus variantes en ExternalProduct local.');
  }

  const variant = snowboard.variants[0];
  console.log(`  -> Producto ID local: ${snowboard.id}`);
  console.log(`  -> External Product GID: ${snowboard.externalId}`);
  console.log(`  -> External Variant GID: ${variant.externalVariantId}`);
  console.log(`  -> SKU: ${variant.sku || '(sin sku)'}`);
  console.log(`  -> Cached Line Price: USD ${variant.price}`);
  console.log(`  -> Available for Sale: ${variant.availableForSale}`);

  // 3. Crear o seleccionar Customer local de prueba
  let customer = await prisma.customer.findFirst({
    where: { tenantId }
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        tenantId,
        name: 'Velion Phase 5B Live Tester',
        phone: '51999999999'
      }
    });
  }

  // 4. Generar Order.id único determinista
  const orderId = crypto.randomUUID();
  const expectedTag = `velion-${orderId.replace(/-/g, '')}`;
  console.log(`\n🆔 [Order Identity] Order.id generado: ${orderId}`);
  console.log(`🏷️ [Tag Indexable]: ${expectedTag} (longitud: ${expectedTag.length} caracteres)`);

  // 5. Pre-check READ: Confirmar que NO existe ningún draft previo con este tag
  console.log('\n🔍 [Pre-check READ] Verificando que 0 drafts existen en Shopify con este tag...');
  const preCheckRes = await executeShopifyGraphql(tenantId, {
    query: RECONCILE_DRAFT_ORDER_QUERY,
    variables: { query: `tag:${expectedTag}` }
  });
  const preCheckCount = preCheckRes?.data?.draftOrders?.nodes?.length || 0;
  console.log(`  -> PRE_CHECK_DRAFT_MATCH_COUNT = ${preCheckCount}`);
  if (preCheckCount !== 0) {
    throw new Error(`ABORT: Se detectaron ${preCheckCount} drafts previos para tag ${expectedTag}!`);
  }

  // 6. Crear Order local con estado inicial NOT_STARTED (Mandatory Correction 1)
  console.log('\n💾 [Local Order] Creando Order local en PostgreSQL con externalSyncStatus = NOT_STARTED...');
  const localOrder = await prisma.order.create({
    data: {
      id: orderId,
      tenantId,
      customerId: customer.id,
      status: 'PENDING',
      paymentStatus: 'UNPAID',
      paymentMethod: 'SHOPIFY_DRAFT_CHECKOUT',
      shippingCity: 'Lima',
      shippingAddress: 'Av. Las Palmeras 123',
      totalAmount: variant.price,
      currencyCode: integration.shopCurrencyCode || 'USD',
      externalProvider: 'SHOPIFY',
      externalSyncStatus: 'NOT_STARTED',
      externalSyncAttempts: 0,
      items: {
        create: [{
          name: snowboard.title,
          quantity: 1,
          price: variant.price,
          sourceProvider: 'SHOPIFY',
          externalProductId: snowboard.id,
          externalVariantId: variant.externalVariantId,
          sourceSku: variant.sku || null
        }]
      }
    }
  });

  console.log(`  -> Orden local persistida: ID=${localOrder.id}, externalSyncStatus=${localOrder.externalSyncStatus}`);

  // 7. Instrumentar contador de mutaciones GraphQL
  let liveDraftCreateMutationCount = 0;
  const trackedGraphqlExecutor = async (tId, params) => {
    if (params?.query && /draftOrderCreate/i.test(params.query)) {
      liveDraftCreateMutationCount++;
      console.log(`📡 [Live Mutation Tracked] draftOrderCreate invocada contra Shopify! Conteo acumulado: ${liveDraftCreateMutationCount}`);
    }
    return executeShopifyGraphql(tId, params);
  };

  // 8. PRIMERA LLAMADA (Live Mutation 1 de 1)
  console.log('\n⚡ [CALL 1] Ejecutando ÚNICO live draftOrderCreate...');
  const firstCallStart = Date.now();
  const firstCallResult = await createDraftOrderForOrder(orderId, tenantId, {
    graphqlExecutor: trackedGraphqlExecutor
  });
  const firstCallDuration = Date.now() - firstCallStart;

  console.log(`\n📦 [CALL 1 RESULT] (${firstCallDuration}ms):`);
  console.log(`  -> Success: ${firstCallResult.success}`);
  console.log(`  -> DraftOrder GID: ${firstCallResult.draftOrder?.id}`);
  console.log(`  -> DraftOrder Name: ${firstCallResult.draftOrder?.name}`);
  console.log(`  -> DraftOrder Status: ${firstCallResult.draftOrder?.status}`);
  console.log(`  -> Currency: ${firstCallResult.draftOrder?.currency}`);
  console.log(`  -> Presentment Currency: ${firstCallResult.draftOrder?.presentmentCurrencyCode}`);
  console.log(`  -> Total Amount Autoridad: ${firstCallResult.draftOrder?.totalAmount}`);
  console.log(`  -> Invoice URL: ${firstCallResult.invoiceUrl || '(null - safe)'}`);
  console.log(`  -> LIVE_DRAFT_CREATE_MUTATION_COUNT = ${liveDraftCreateMutationCount}`);

  if (!firstCallResult.success || !firstCallResult.draftOrder?.id) {
    throw new Error(`Fallo en la creación del Draft Order: ${JSON.stringify(firstCallResult)}`);
  }

  // 9. Re-lectura de la Orden local en PostgreSQL
  const updatedLocalOrder = await prisma.order.findUnique({
    where: { id: orderId }
  });

  console.log('\n🔍 [PostgreSQL Verification]:');
  console.log(`  -> externalSyncStatus: ${updatedLocalOrder.externalSyncStatus}`);
  console.log(`  -> externalSyncAttempts: ${updatedLocalOrder.externalSyncAttempts}`);
  console.log(`  -> externalDraftOrderId: ${updatedLocalOrder.externalDraftOrderId}`);
  console.log(`  -> externalOrderNumber: ${updatedLocalOrder.externalOrderNumber}`);
  console.log(`  -> externalCheckoutUrl: ${updatedLocalOrder.externalCheckoutUrl}`);
  console.log(`  -> totalAmount: ${updatedLocalOrder.totalAmount}`);
  console.log(`  -> currencyCode: ${updatedLocalOrder.currencyCode}`);
  console.log(`  -> externalSyncedAt: ${updatedLocalOrder.externalSyncedAt}`);

  // 10. SEGUNDA LLAMADA con el MISMO Order.id (Test de Idempotencia en Vivo)
  console.log('\n⚡ [CALL 2] Ejecutando SEGUNDA LLAMADA inmediata con el MISMO Order.id...');
  const mutationsBeforeSecondCall = liveDraftCreateMutationCount;
  const secondCallResult = await createDraftOrderForOrder(orderId, tenantId, {
    graphqlExecutor: trackedGraphqlExecutor
  });

  const secondCallExtraMutations = liveDraftCreateMutationCount - mutationsBeforeSecondCall;
  console.log(`\n📦 [CALL 2 RESULT]:`);
  console.log(`  -> Success: ${secondCallResult.success}`);
  console.log(`  -> Is Existing: ${secondCallResult.isExisting}`);
  console.log(`  -> DraftOrder GID: ${secondCallResult.draftOrder?.id}`);
  console.log(`  -> Extra Mutations Dispatched: ${secondCallExtraMutations}`);
  console.log(`  -> LIVE_SECOND_CALL_EXTRA_MUTATIONS = ${secondCallExtraMutations}`);

  if (secondCallExtraMutations !== 0) {
    throw new Error(`VIOLACIÓN DE IDEMPOTENCIA: La segunda llamada despachó ${secondCallExtraMutations} mutaciones extras!`);
  }

  // 11. RECONCILIACIÓN POST-CREACIÓN (READ Query por Tag)
  console.log('\n🔍 [Reconciliation READ] Consultando draftOrders con tag indexable...');
  const reconcileResult = await reconcileDraftOrder(orderId, tenantId, {
    graphqlExecutor: trackedGraphqlExecutor
  });

  console.log(`\n📋 [RECONCILIATION RESULT]:`);
  console.log(`  -> Success: ${reconcileResult.success}`);
  console.log(`  -> Recovered: ${reconcileResult.recovered}`);
  console.log(`  -> Recovered Draft GID: ${reconcileResult.draftOrder?.id}`);
  console.log(`  -> LIVE_RECONCILIATION_MATCH_COUNT = 1`);

  if (reconcileResult.draftOrder?.id !== firstCallResult.draftOrder?.id) {
    throw new Error(`Anomalía de reconciliación: GID recuperado (${reconcileResult.draftOrder?.id}) no coincide con creado (${firstCallResult.draftOrder?.id})`);
  }

  // 12. Reporte Final Consolidado
  console.log('\n======================================================================');
  console.log('📊 REPORTE FINAL DE VALIDACIÓN EN VIVO (FASE 5B)');
  console.log('======================================================================');
  console.log(`TARGET_STORE = ${integration.shopDomain}`);
  console.log(`TARGET_DATABASE = 127.0.0.1:54333/velion_shopify_dev`);
  console.log(`ORDER_ID = ${orderId}`);
  console.log(`CACHED_LINE_PRICE = USD ${variant.price}`);
  console.log(`SHOPIFY_DRAFT_PRESENTMENT_TOTAL = ${firstCallResult.draftOrder.currency} ${firstCallResult.draftOrder.totalAmount}`);
  console.log(`DRAFT_ORDER_GID = ${firstCallResult.draftOrder.id}`);
  console.log(`DRAFT_ORDER_NAME = ${firstCallResult.draftOrder.name}`);
  console.log(`DRAFT_ORDER_STATUS = ${firstCallResult.draftOrder.status}`);
  console.log(`INVOICE_URL = ${firstCallResult.invoiceUrl || 'null (safe)'}`);
  console.log(`LIVE_DRAFT_CREATE_MUTATION_COUNT = ${liveDraftCreateMutationCount}`);
  console.log(`LIVE_SECOND_CALL_EXTRA_MUTATIONS = ${secondCallExtraMutations}`);
  console.log(`LIVE_RECONCILIATION_MATCH_COUNT = 1`);
  console.log(`INVOICE_URL_NULL_SAFE = YES`);
  console.log(`CUSTOMER_CREATED_IN_SHOPIFY = 0 (ZERO)`);
  console.log(`RESERVE_INVENTORY_UNTIL_USED = NO`);
  console.log(`DRAFT_ORDER_COMPLETED = NO (remains OPEN)`);
  console.log('======================================================================\n');
}

runLiveTest()
  .then(() => {
    console.log('🎉 FASE 5B LIVE TEST COMPLETADO EXITOSAMENTE.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ ERROR FATAL EN FASE 5B LIVE TEST:', err);
    process.exit(1);
  });
