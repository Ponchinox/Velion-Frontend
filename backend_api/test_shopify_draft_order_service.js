/**
 * test_shopify_draft_order_service.js
 * ====================================
 * Suite de pruebas unitarias para shopifyDraftOrderService.
 * 
 * Verificaciones y Cobertura Obligatoria:
 * 1. FIRST_CALL_NOT_STARTED_TO_CREATING = PASS: La primera llamada realiza la transición atómica y no se bloquea.
 * 2. Segunda llamada con estado CREATED devuelve estado existente sin mutaciones (0 llamadas).
 * 3. Concurrencia con estado CREATING rechaza con ShopifyDraftOrderConflictError.
 * 4. Estado ERROR previo bloquea reintento automático sin política explícita (PREVIOUS_ERROR_BLOCKED).
 * 5. INVOICE_URL_NULL_SAFE = YES: invoiceUrl === null marca CREATED y jamás recrea el pedido.
 * 6. Manejo de userErrors: marca ERROR y persiste el mensaje sin reintentos a ciegas.
 * 7. UNKNOWN_RESULT_NEVER_RECREATES = YES: Fallo de red/timeout transiciona a UNKNOWN_RESULT y delega a reconciliación.
 * 8. Reconciliación con 1 coincidencia exacta recupera la orden a CREATED.
 * 9. Reconciliación con 0 coincidencias mantiene UNKNOWN_RESULT (sin recrear a ciegas).
 * 10. Reconciliación con 2+ coincidencias marca RECONCILIATION_AMBIGUOUS.
 * 11. Autoridad monetaria: Order.totalAmount toma totalPriceSet.presentmentMoney.amount.
 */

import assert from 'node:assert';
import {
  createDraftOrderForOrder,
  reconcileDraftOrder,
  buildDraftOrderInput
} from './src/services/integrations/shopify/shopifyDraftOrderService.js';
import {
  ShopifyDraftOrderError,
  ShopifyDraftOrderConflictError,
  ShopifyIntegrationNotConnectedError
} from './src/services/integrations/shopify/shopifyErrors.js';

console.log('======================================================================');
console.log('🧪 TEST SUITE 2: SHOPIFY DRAFT ORDER SERVICE & STATE MACHINE');
console.log('======================================================================\n');

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    throw err;
  }
}

function createMockPrisma(initialOrders = [], initialIntegrations = []) {
  const orders = new Map(initialOrders.map(o => [o.id, { ...o }]));
  const integrations = new Map(initialIntegrations.map(i => [`${i.tenantId}:${i.provider}`, { ...i }]));

  return {
    order: {
      findFirst: async ({ where }) => {
        for (const o of orders.values()) {
          if (where.id && o.id !== where.id) continue;
          if (where.tenantId && o.tenantId !== where.tenantId) continue;
          return { ...o };
        }
        return null;
      },
      findUnique: async ({ where }) => {
        return orders.has(where.id) ? { ...orders.get(where.id) } : null;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const [id, o] of orders.entries()) {
          if (where.id && o.id !== where.id) continue;
          if (where.tenantId && o.tenantId !== where.tenantId) continue;
          if (where.externalSyncStatus && o.externalSyncStatus !== where.externalSyncStatus) continue;

          // Mutación atómica simulada
          const updated = { ...o, ...data };
          if (data.externalSyncAttempts?.increment) {
            updated.externalSyncAttempts = (o.externalSyncAttempts || 0) + data.externalSyncAttempts.increment;
          }
          orders.set(id, updated);
          count++;
        }
        return { count };
      },
      update: async ({ where, data }) => {
        const o = orders.get(where.id);
        if (!o) throw new Error(`Order ${where.id} not found`);
        const updated = { ...o, ...data };
        orders.set(where.id, updated);
        return updated;
      }
    },
    integration: {
      findFirst: async ({ where }) => {
        const key = `${where.tenantId}:${where.provider || 'SHOPIFY'}`;
        return integrations.has(key) ? { ...integrations.get(key) } : null;
      }
    },
    _orders: orders
  };
}

async function main() {
  const tenantId = 'tenant-test-5b';
  const defaultIntegration = {
    id: 'integ-5b',
    tenantId,
    provider: 'SHOPIFY',
    status: 'CONNECTED',
    shopDomain: 'velion-dev.myshopify.com',
    externalOrderMode: 'SHOPIFY_DRAFT',
    priceSource: 'SHOPIFY',
    shopCurrencyCode: 'USD'
  };

  // Test 1: FIRST_CALL_NOT_STARTED_TO_CREATING = PASS
  await runTest('FIRST_CALL_NOT_STARTED_TO_CREATING = PASS (Transición atómica y ejecución exitosa)', async () => {
    const orderId = 'order-claim-1';
    const mockDb = createMockPrisma([
      {
        id: orderId,
        tenantId,
        externalSyncStatus: 'NOT_STARTED',
        externalSyncAttempts: 0,
        totalAmount: 885.95,
        currencyCode: 'USD',
        items: [{ name: 'The Minimal Snowboard', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/101' }]
      }
    ], [defaultIntegration]);

    let mutationsExecuted = 0;
    const mockGraphql = async (tId, { query, variables }) => {
      mutationsExecuted++;
      return {
        data: {
          draftOrderCreate: {
            draftOrder: {
              id: 'gid://shopify/DraftOrder/9001',
              name: '#D9001',
              status: 'OPEN',
              currencyCode: 'USD',
              presentmentCurrencyCode: 'USD',
              invoiceUrl: 'https://checkout.shopify.com/invoice/9001',
              totalPriceSet: {
                presentmentMoney: { amount: '885.95', currencyCode: 'USD' }
              }
            },
            userErrors: []
          }
        }
      };
    };

    const res = await createDraftOrderForOrder(orderId, tenantId, {
      prismaClient: mockDb,
      graphqlExecutor: mockGraphql
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(mutationsExecuted, 1);
    const finalOrder = mockDb._orders.get(orderId);
    assert.strictEqual(finalOrder.externalSyncStatus, 'CREATED');
    assert.strictEqual(finalOrder.externalSyncAttempts, 1);
    assert.strictEqual(finalOrder.externalDraftOrderId, 'gid://shopify/DraftOrder/9001');
    assert.strictEqual(finalOrder.externalCheckoutUrl, 'https://checkout.shopify.com/invoice/9001');
  });

  // Test 2: Segunda llamada con estado CREATED devuelve estado existente sin mutaciones extras
  await runTest('Segunda llamada con estado CREATED devuelve estado existente con 0 mutaciones', async () => {
    const orderId = 'order-created-2';
    const mockDb = createMockPrisma([
      {
        id: orderId,
        tenantId,
        externalSyncStatus: 'CREATED',
        externalDraftOrderId: 'gid://shopify/DraftOrder/9002',
        externalCheckoutUrl: 'https://checkout.shopify.com/invoice/9002',
        totalAmount: 885.95,
        currencyCode: 'USD',
        items: [{ name: 'The Minimal Snowboard', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/101' }]
      }
    ], [defaultIntegration]);

    let mutationsExecuted = 0;
    const mockGraphql = async () => { mutationsExecuted++; return {}; };

    const res = await createDraftOrderForOrder(orderId, tenantId, {
      prismaClient: mockDb,
      graphqlExecutor: mockGraphql
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.isExisting, true);
    assert.strictEqual(res.draftOrder.id, 'gid://shopify/DraftOrder/9002');
    assert.strictEqual(mutationsExecuted, 0); // CERO mutaciones adicionales
  });

  // Test 3: Llamada con estado CREATING rechaza con conflicto
  await runTest('Llamada con orden en estado CREATING rechaza con ShopifyDraftOrderConflictError', async () => {
    const orderId = 'order-creating-3';
    const mockDb = createMockPrisma([
      {
        id: orderId,
        tenantId,
        externalSyncStatus: 'CREATING',
        externalSyncAttempts: 1,
        items: [{ name: 'Item', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/101' }]
      }
    ], [defaultIntegration]);

    await assert.rejects(
      () => createDraftOrderForOrder(orderId, tenantId, { prismaClient: mockDb }),
      (err) => err instanceof ShopifyDraftOrderConflictError
    );
  });

  // Test 4: Estado ERROR previo bloquea reintento automatico
  await runTest('Orden en estado ERROR previo bloquea reintento automatico (PREVIOUS_ERROR_BLOCKED)', async () => {
    const orderId = 'order-error-4';
    const mockDb = createMockPrisma([
      {
        id: orderId,
        tenantId,
        externalSyncStatus: 'ERROR',
        externalSyncError: 'Inventario agotado',
        items: [{ name: 'Item', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/101' }]
      }
    ], [defaultIntegration]);

    await assert.rejects(
      () => createDraftOrderForOrder(orderId, tenantId, { prismaClient: mockDb }),
      (err) => err instanceof ShopifyDraftOrderError && err.code === 'PREVIOUS_ERROR_BLOCKED'
    );
  });

  // Test 5: INVOICE_URL_NULL_SAFE = YES
  await runTest('INVOICE_URL_NULL_SAFE = YES: invoiceUrl === null marca CREATED y jamas recrea el draft', async () => {
    const orderId = 'order-null-invoice-5';
    const mockDb = createMockPrisma([
      {
        id: orderId,
        tenantId,
        externalSyncStatus: 'NOT_STARTED',
        externalSyncAttempts: 0,
        totalAmount: 500.0,
        currencyCode: 'USD',
        items: [{ name: 'Test Snowboard', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/101' }]
      }
    ], [defaultIntegration]);

    const mockGraphql = async () => ({
      data: {
        draftOrderCreate: {
          draftOrder: {
            id: 'gid://shopify/DraftOrder/9005',
            name: '#D9005',
            status: 'OPEN',
            currencyCode: 'USD',
            presentmentCurrencyCode: 'USD',
            invoiceUrl: null, // Shopify devolvió null
            totalPriceSet: {
              presentmentMoney: { amount: '500.00', currencyCode: 'USD' }
            }
          },
          userErrors: []
        }
      }
    });

    const res = await createDraftOrderForOrder(orderId, tenantId, {
      prismaClient: mockDb,
      graphqlExecutor: mockGraphql
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.invoiceUrl, null);
    const finalOrder = mockDb._orders.get(orderId);
    assert.strictEqual(finalOrder.externalSyncStatus, 'CREATED');
    assert.strictEqual(finalOrder.externalCheckoutUrl, null);
    assert.strictEqual(finalOrder.externalDraftOrderId, 'gid://shopify/DraftOrder/9005');
  });

  // Test 6: userErrors marca ERROR y persiste mensaje
  await runTest('Manejo de userErrors: persiste ERROR sin blind retry', async () => {
    const orderId = 'order-usererror-6';
    const mockDb = createMockPrisma([
      {
        id: orderId,
        tenantId,
        externalSyncStatus: 'NOT_STARTED',
        items: [{ name: 'Item', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/101' }]
      }
    ], [defaultIntegration]);

    const mockGraphql = async () => ({
      data: {
        draftOrderCreate: {
          draftOrder: null,
          userErrors: [{ field: 'lineItems', message: 'Variant not found' }]
        }
      }
    });

    const res = await createDraftOrderForOrder(orderId, tenantId, {
      prismaClient: mockDb,
      graphqlExecutor: mockGraphql
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'SHOPIFY_USER_ERROR');
    const finalOrder = mockDb._orders.get(orderId);
    assert.strictEqual(finalOrder.externalSyncStatus, 'ERROR');
    assert.strictEqual(finalOrder.externalSyncError.includes('Variant not found'), true);
  });

  // Test 7: Fallo de red transiciona a UNKNOWN_RESULT y ejecuta reconciliacion
  await runTest('UNKNOWN_RESULT_NEVER_RECREATES = YES: Fallo de transporte transiciona a UNKNOWN_RESULT', async () => {
    const orderId = 'order-transport-fail-7';
    const mockDb = createMockPrisma([
      {
        id: orderId,
        tenantId,
        externalSyncStatus: 'NOT_STARTED',
        items: [{ name: 'Item', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/101' }]
      }
    ], [defaultIntegration]);

    let reconcileCalled = false;
    const mockGraphql = async (tId, { query }) => {
      if (query.includes('draftOrderCreate')) {
        throw new Error('ETIMEDOUT: Connection reset by peer');
      }
      if (query.includes('reconcileDraftOrder')) {
        reconcileCalled = true;
        return { data: { draftOrders: { nodes: [] } } }; // 0 resultados
      }
      return {};
    };

    const res = await createDraftOrderForOrder(orderId, tenantId, {
      prismaClient: mockDb,
      graphqlExecutor: mockGraphql
    });

    assert.strictEqual(reconcileCalled, true);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.status, 'UNKNOWN_RESULT');
    const finalOrder = mockDb._orders.get(orderId);
    assert.strictEqual(finalOrder.externalSyncStatus, 'UNKNOWN_RESULT');
  });

  // Test 8: Reconciliacion con 1 coincidencia exacta recupera a CREATED
  await runTest('Reconciliacion con 1 coincidencia exacta recupera la orden a CREATED', async () => {
    const orderId = 'order-reconcile-8';
    const mockDb = createMockPrisma([
      {
        id: orderId,
        tenantId,
        externalSyncStatus: 'UNKNOWN_RESULT',
        items: [{ name: 'Item', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/101' }]
      }
    ], [defaultIntegration]);

    const mockGraphql = async (tId, { query, variables }) => {
      assert.strictEqual(variables.query, `tag:velion-${orderId.replace(/-/g, '')}`);
      return {
        data: {
          draftOrders: {
            nodes: [
              {
                id: 'gid://shopify/DraftOrder/9008',
                name: '#D9008',
                status: 'OPEN',
                currencyCode: 'USD',
                presentmentCurrencyCode: 'USD',
                invoiceUrl: 'https://checkout.shopify.com/invoice/9008',
                totalPriceSet: {
                  presentmentMoney: { amount: '885.95', currencyCode: 'USD' }
                },
                customAttributes: [{ key: 'velion_order_id', value: orderId }]
              }
            ]
          }
        }
      };
    };

    const res = await reconcileDraftOrder(orderId, tenantId, {
      prismaClient: mockDb,
      graphqlExecutor: mockGraphql
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.recovered, true);
    assert.strictEqual(res.draftOrder.id, 'gid://shopify/DraftOrder/9008');
    const finalOrder = mockDb._orders.get(orderId);
    assert.strictEqual(finalOrder.externalSyncStatus, 'CREATED');
    assert.strictEqual(finalOrder.externalDraftOrderId, 'gid://shopify/DraftOrder/9008');
  });

  // Test 9: Reconciliacion con 0 coincidencias mantiene UNKNOWN_RESULT
  await runTest('Reconciliacion con 0 coincidencias mantiene UNKNOWN_RESULT sin recrear', async () => {
    const orderId = 'order-reconcile-9';
    const mockDb = createMockPrisma([
      {
        id: orderId,
        tenantId,
        externalSyncStatus: 'UNKNOWN_RESULT',
        items: [{ name: 'Item', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/101' }]
      }
    ], [defaultIntegration]);

    const mockGraphql = async () => ({
      data: { draftOrders: { nodes: [] } }
    });

    const res = await reconcileDraftOrder(orderId, tenantId, {
      prismaClient: mockDb,
      graphqlExecutor: mockGraphql
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.status, 'UNKNOWN_RESULT');
    assert.strictEqual(res.matchesCount, 0);
  });

  // Test 10: Reconciliacion con 2+ coincidencias marca RECONCILIATION_AMBIGUOUS
  await runTest('Reconciliacion con 2+ coincidencias marca RECONCILIATION_AMBIGUOUS fail-closed', async () => {
    const orderId = 'order-reconcile-10';
    const mockDb = createMockPrisma([
      {
        id: orderId,
        tenantId,
        externalSyncStatus: 'UNKNOWN_RESULT',
        items: [{ name: 'Item', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/101' }]
      }
    ], [defaultIntegration]);

    const mockGraphql = async () => ({
      data: {
        draftOrders: {
          nodes: [
            {
              id: 'gid://shopify/DraftOrder/9010A',
              customAttributes: [{ key: 'velion_order_id', value: orderId }]
            },
            {
              id: 'gid://shopify/DraftOrder/9010B',
              customAttributes: [{ key: 'velion_order_id', value: orderId }]
            }
          ]
        }
      }
    });

    const res = await reconcileDraftOrder(orderId, tenantId, {
      prismaClient: mockDb,
      graphqlExecutor: mockGraphql
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.status, 'RECONCILIATION_AMBIGUOUS');
    assert.strictEqual(res.matchesCount, 2);
    const finalOrder = mockDb._orders.get(orderId);
    assert.strictEqual(finalOrder.externalSyncStatus, 'RECONCILIATION_AMBIGUOUS');
  });

  // Test 11: Autoridad monetaria
  await runTest('Autoridad monetaria: Order.totalAmount adopta presentmentMoney.amount de Shopify', async () => {
    const orderId = 'order-money-11';
    const mockDb = createMockPrisma([
      {
        id: orderId,
        tenantId,
        externalSyncStatus: 'NOT_STARTED',
        totalAmount: 100.0, // Estimado previo
        currencyCode: 'USD',
        items: [{ name: 'Item', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/101' }]
      }
    ], [defaultIntegration]);

    const mockGraphql = async () => ({
      data: {
        draftOrderCreate: {
          draftOrder: {
            id: 'gid://shopify/DraftOrder/9011',
            status: 'OPEN',
            presentmentCurrencyCode: 'USD',
            invoiceUrl: 'https://checkout.shopify.com/inv/11',
            totalPriceSet: {
              presentmentMoney: { amount: '885.95', currencyCode: 'USD' }
            }
          },
          userErrors: []
        }
      }
    });

    const res = await createDraftOrderForOrder(orderId, tenantId, {
      prismaClient: mockDb,
      graphqlExecutor: mockGraphql
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.draftOrder.totalAmount, 885.95);
    const finalOrder = mockDb._orders.get(orderId);
    assert.strictEqual(finalOrder.totalAmount, 885.95);
    assert.strictEqual(finalOrder.currencyCode, 'USD');
  });

  console.log(`\n======================================================================`);
  console.log(`🎉 SUITE 2 COMPLETADA: ${passedTests}/${totalTests} pruebas pasaron.`);
  console.log(`======================================================================\n`);
}

main().catch((err) => {
  console.error('Fallo fatal en Suite 2:', err);
  process.exit(1);
});
