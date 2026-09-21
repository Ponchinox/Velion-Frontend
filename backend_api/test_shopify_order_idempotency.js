/**
 * test_shopify_order_idempotency.js
 * ==================================
 * Suite de pruebas de idempotencia y concurrencia estricta para Shopify Draft Order (Fase 5B).
 * 
 * Verificaciones y Gates Obligatorios:
 * 1. SAME_CART_CONCURRENT_LOCAL_ORDER_TEST = PASS:
 *    Dos llamadas concurrentes equivalentes al entry point REAL (syncCommercialOrder):
 *    -> LOCAL_ORDER_COUNT_CREATED = 1
 *    -> DRAFT_MUTATION_COUNT = 1
 *    -> CAN_SAME_CART_CREATE_TWO_LOCAL_ORDERS_CONCURRENTLY = NO
 * 2. SAME_ORDER_CONCURRENT_MUTATION_TEST = PASS:
 *    Dos llamadas concurrentes directas a createDraftOrderForOrder para el mismo Order.id:
 *    -> Exactamente 1 mutation draftOrderCreate ejecutada (coalescing + advisory lock + atomic claim).
 * 3. Llamada secuencial repetida sobre Order CREATED:
 *    -> 0 mutaciones extras.
 * 4. MUTATION_BLIND_RETRY_DISABLED = YES:
 *    -> Verificación de que las mutaciones GraphQL tienen effectiveMaxRetries = 0.
 */

import assert from 'node:assert';
import { syncCommercialOrder } from './src/services/orderCommercialService.js';
import { createDraftOrderForOrder } from './src/services/integrations/shopify/shopifyDraftOrderService.js';
import { executeShopifyGraphql } from './src/services/integrations/shopify/shopifyGraphqlClient.js';

console.log('======================================================================');
console.log('🧪 TEST SUITE 4: SHOPIFY ORDER IDEMPOTENCY & CONCURRENCY');
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

function createMockPrismaForIdempotency() {
  const store = {
    orders: new Map(),
    customers: new Map(),
    externalProducts: new Map(),
    externalVariants: new Map(),
    integrations: new Map(),
    mutationCallCount: 0
  };

  const client = {
    customer: {
      update: async ({ where, data }) => {
        const c = store.customers.get(where.id) || { id: where.id, commercialState: {} };
        c.commercialState = { ...(c.commercialState || {}), ...(data.commercialState || {}) };
        store.customers.set(where.id, c);
        return c;
      },
      findUnique: async ({ where }) => store.customers.get(where.id) || null
    },
    product: {
      findFirst: async () => null,
      count: async () => 0
    },
    externalProductVariant: {
      findFirst: async ({ where }) => {
        for (const ev of store.externalVariants.values()) {
          return { ...ev, externalProduct: store.externalProducts.get(ev.externalProductId) };
        }
        return null;
      },
      findUnique: async ({ where }) => store.externalVariants.get(where.id) || null
    },
    integration: {
      findFirst: async () => ({
        id: 'integ-idem',
        tenantId: 'tenant-idem',
        provider: 'SHOPIFY',
        status: 'CONNECTED',
        shopDomain: 'velion-dev.myshopify.com',
        catalogMode: 'SHOPIFY_ONLY',
        priceSource: 'SHOPIFY',
        stockSource: 'SHOPIFY',
        externalOrderMode: 'SHOPIFY_DRAFT',
        shopCurrencyCode: 'USD'
      })
    },
    order: {
      findFirst: async ({ where }) => {
        for (const o of store.orders.values()) {
          if (where.id && o.id !== where.id) continue;
          return { ...o };
        }
        return null;
      },
      findUnique: async ({ where }) => store.orders.get(where.id) || null,
      create: async ({ data }) => {
        const id = `order-local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const created = { id, ...data, items: data.items?.create || [] };
        store.orders.set(id, created);
        return created;
      },
      update: async ({ where, data }) => {
        const o = store.orders.get(where.id);
        if (o) Object.assign(o, data);
        return o;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const [id, o] of store.orders.entries()) {
          if (where.id && o.id !== where.id) continue;
          if (where.externalSyncStatus && o.externalSyncStatus !== where.externalSyncStatus) continue;
          Object.assign(o, data);
          count++;
        }
        return { count };
      }
    },
    alert: {
      create: async () => ({})
    },
    $transaction: async (fn) => {
      if (Array.isArray(fn)) return fn;
      return await fn(client);
    },
    $queryRaw: async () => [],
    _store: store
  };

  return client;
}

async function main() {
  const tenantId = 'tenant-idem';
  const tenant = {
    id: tenantId,
    currencyCode: 'PEN',
    bankAccounts: 'BCP: 191-00000000-0-00',
    termsAndPolicies: 'Delivery en Lima'
  };

  const customerId = 'cust-idem-1';
  const customer = {
    id: customerId,
    name: 'Cliente Concurrente',
    phone: '51999999999',
    commercialState: {}
  };

  const extProdId = 'ext-prod-snow';
  const extVarId = 'ext-var-snow';

  // 1. SAME_CART_CONCURRENT_LOCAL_ORDER_TEST = PASS
  await runTest('SAME_CART_CONCURRENT_LOCAL_ORDER_TEST = PASS (Dos llamadas concurrentes al entry point real crean exactamente 1 Order y 1 Draft)', async () => {
    const mockDb = createMockPrismaForIdempotency();
    mockDb._store.customers.set(customerId, customer);
    mockDb._store.externalProducts.set(extProdId, { id: extProdId, title: 'The Minimal Snowboard', isAvailable: true });
    mockDb._store.externalVariants.set(extVarId, {
      id: extVarId,
      externalProductId: extProdId,
      externalVariantId: 'gid://shopify/ProductVariant/88501',
      price: 885.95,
      availableForSale: true
    });

    let draftMutationsDispatched = 0;
    const mockGraphqlExecutor = async (tId, { query }) => {
      if (query.includes('draftOrderCreate')) {
        draftMutationsDispatched++;
        // Simular latencia de red de 50ms para exponer cualquier ventana de carrera
        await new Promise(r => setTimeout(r, 50));
        return {
          data: {
            draftOrderCreate: {
              draftOrder: {
                id: 'gid://shopify/DraftOrder/CONCURRENT_SUCCESS',
                name: '#D-CONC',
                status: 'OPEN',
                currencyCode: 'USD',
                presentmentCurrencyCode: 'USD',
                invoiceUrl: 'https://checkout.shopify.com/conc',
                totalPriceSet: { presentmentMoney: { amount: '885.95', currencyCode: 'USD' } }
              },
              userErrors: []
            }
          }
        };
      }
      return {};
    };

    const callArgs = {
      tenant,
      customer,
      clientNumber: customer.phone,
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: `shopify:${extVarId}`,
        quantity: 1,
        shippingCity: 'Lima',
        paymentMethod: 'BCP'
      },
      prismaClient: mockDb,
      graphqlExecutor: mockGraphqlExecutor
    };

    // Despacho estrictamente simultáneo de dos llamadas idénticas
    const [resA, resB] = await Promise.all([
      syncCommercialOrder(callArgs),
      syncCommercialOrder(callArgs)
    ]);

    assert.strictEqual(resA.success, true);
    assert.strictEqual(resB.success, true);

    const localOrderCountCreated = mockDb._store.orders.size;
    console.log(`     -> LOCAL_ORDER_COUNT_CREATED = ${localOrderCountCreated}`);
    console.log(`     -> DRAFT_MUTATION_COUNT = ${draftMutationsDispatched}`);

    assert.strictEqual(localOrderCountCreated, 1, 'Debe crearse exactamente UNA orden local en PostgreSQL');
    assert.strictEqual(draftMutationsDispatched, 1, 'Debe ejecutarse exactamente UNA mutación draftOrderCreate en Shopify');
    assert.strictEqual(resA.order.id, resB.order.id, 'Ambas llamadas deben resolver al MISMO Order.id');
    console.log('     -> CAN_SAME_CART_CREATE_TWO_LOCAL_ORDERS_CONCURRENTLY = NO');
  });

  // 2. SAME_ORDER_CONCURRENT_MUTATION_TEST = PASS
  await runTest('SAME_ORDER_CONCURRENT_MUTATION_TEST = PASS (Concurrencia al mismo Order.id coalescida a 1 sola mutación)', async () => {
    const mockDb = createMockPrismaForIdempotency();
    const sharedOrderId = 'order-shared-concurrency-test';
    mockDb._store.orders.set(sharedOrderId, {
      id: sharedOrderId,
      tenantId,
      externalSyncStatus: 'NOT_STARTED',
      externalSyncAttempts: 0,
      totalAmount: 885.95,
      currencyCode: 'USD',
      items: [{ name: 'Snowboard', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/88501' }]
    });

    let serviceMutationsCount = 0;
    const mockGraphqlExecutor = async () => {
      serviceMutationsCount++;
      await new Promise(r => setTimeout(r, 60)); // Simular latencia
      return {
        data: {
          draftOrderCreate: {
            draftOrder: {
              id: 'gid://shopify/DraftOrder/SERVICE_COALESCE',
              status: 'OPEN',
              invoiceUrl: 'https://checkout.shopify.com/coalesce',
              totalPriceSet: { presentmentMoney: { amount: '885.95', currencyCode: 'USD' } }
            },
            userErrors: []
          }
        }
      };
    };

    // Dos llamadas concurrentes al servicio por el mismo Order.id
    const [res1, res2] = await Promise.all([
      createDraftOrderForOrder(sharedOrderId, tenantId, { prismaClient: mockDb, graphqlExecutor: mockGraphqlExecutor }),
      createDraftOrderForOrder(sharedOrderId, tenantId, { prismaClient: mockDb, graphqlExecutor: mockGraphqlExecutor })
    ]);

    assert.strictEqual(res1.success, true);
    assert.strictEqual(res2.success, true);
    console.log(`     -> SERVICE_MUTATION_COUNT = ${serviceMutationsCount}`);
    assert.strictEqual(serviceMutationsCount, 1, 'Exactamente 1 mutación GraphQL despachada');
  });

  // 3. Llamada repetida secuencial con Order CREATED
  await runTest('Llamada repetida secuencial con Order CREATED ejecuta 0 mutaciones', async () => {
    const mockDb = createMockPrismaForIdempotency();
    const createdOrderId = 'order-already-created';
    mockDb._store.orders.set(createdOrderId, {
      id: createdOrderId,
      tenantId,
      externalSyncStatus: 'CREATED',
      externalDraftOrderId: 'gid://shopify/DraftOrder/EXISTING_1',
      externalCheckoutUrl: 'https://checkout.shopify.com/existing',
      totalAmount: 885.95,
      currencyCode: 'USD',
      items: [{ name: 'Snowboard', quantity: 1, externalVariantId: 'gid://shopify/ProductVariant/88501' }]
    });

    let extraMutations = 0;
    const mockGraphql = async () => { extraMutations++; return {}; };

    const res = await createDraftOrderForOrder(createdOrderId, tenantId, {
      prismaClient: mockDb,
      graphqlExecutor: mockGraphql
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.isExisting, true);
    assert.strictEqual(extraMutations, 0, 'CERO mutaciones en llamadas repetidas sobre CREATED');
  });

  // 4. MUTATION_BLIND_RETRY_DISABLED = YES
  await runTest('MUTATION_BLIND_RETRY_DISABLED = YES: executeShopifyGraphql no reintenta mutaciones a ciegas', async () => {
    let rawHttpCalls = 0;

    const mockFetchFn = async () => {
      rawHttpCalls++;
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'Service Unavailable',
        json: async () => ({ errors: 'Service Unavailable' }),
        headers: new Map()
      };
    };

    const { encryptText } = await import('./src/utils/cryptoUtils.js');
    const validEncrypted = encryptText('shpat_test_token_12345');

    const mockPrismaClient = {
      integration: {
        findUnique: async () => ({
          id: 'integ-retry-test',
          provider: 'SHOPIFY',
          status: 'CONNECTED',
          shopDomain: 'velion-dev.myshopify.com',
          encryptedAccessToken: validEncrypted,
          accessTokenExpiresAt: new Date(Date.now() + 3600000),
          scopes: ['write_draft_orders']
        })
      }
    };

    // Invocación con query mutation: DEBE ejecutar 1 sola llamada (0 reintentos)
    await assert.rejects(
      () => executeShopifyGraphql(tenantId, {
        query: 'mutation draftOrderCreate($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id } } }',
        variables: { input: {} },
        prismaClient: mockPrismaClient,
        fetchFn: mockFetchFn,
        maxRetries: 3 // Aunque el caller pida 3, la política DEBE forzar 0 en mutaciones
      }),
      (err) => err.message.includes('503') || err.message.includes('Service Unavailable')
    );

    console.log(`     -> RAW_HTTP_MUTATION_ATTEMPTS = ${rawHttpCalls}`);
    assert.strictEqual(rawHttpCalls, 1, 'Las mutaciones GraphQL jamás deben reintentarse automáticamente (maxRetries forzado a 0)');
    console.log('     -> MUTATION_BLIND_RETRY_DISABLED = YES');
  });

  console.log(`\n======================================================================`);
  console.log(`🎉 SUITE 4 COMPLETADA: ${passedTests}/${totalTests} pruebas pasaron.`);
  console.log(`======================================================================\n`);
}

main().catch((err) => {
  console.error('Fallo fatal en Suite 4:', err);
  process.exit(1);
});
