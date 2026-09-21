/**
 * SHOPIFY CATALOG SYNC & RECONCILIATION TEST SUITE
 * ================================================
 * Valida la reconciliación transaccional, idempotencia, estados de sincronización
 * y el endpoint de la API REST /sync.
 */

import assert from 'node:assert';
import { syncShopifyCatalog } from './src/services/integrations/shopify/shopifyCatalogSyncService.js';
import { triggerShopifySync } from './src/controllers/shopifyController.js';

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}:`, err.message);
    throw err;
  }
}

function createMockPrisma() {
  const store = {
    integrations: new Map(),
    externalProducts: new Map(),
    externalVariants: new Map(),
  };

  const integration = {
    id: 'int_sync_test_1',
    tenantId: 'tenant_sync_1',
    provider: 'SHOPIFY',
    status: 'CONNECTED',
    shopDomain: 'tienda-sync.myshopify.com',
    syncStatus: 'IDLE',
    lastSyncedAt: null,
    lastSyncError: null,
  };
  store.integrations.set(`${integration.tenantId}_${integration.provider}`, integration);

  return {
    _store: store,
    integration: {
      async findUnique({ where }) {
        return store.integrations.get(`${where.tenantId_provider.tenantId}_${where.tenantId_provider.provider}`) || null;
      },
      async update({ where, data }) {
        const item = store.integrations.get('tenant_sync_1_SHOPIFY');
        Object.assign(item, data);
        return item;
      },
    },
    externalProduct: {
      async upsert({ where, create, update }) {
        const key = `${where.tenantId_provider_externalId.tenantId}_${where.tenantId_provider_externalId.externalId}`;
        const existing = store.externalProducts.get(key) || { id: `local_prod_${where.tenantId_provider_externalId.externalId}` };
        const merged = { ...existing, ...create, ...update };
        store.externalProducts.set(key, merged);
        return merged;
      },
      async deleteMany({ where }) {
        let count = 0;
        for (const [key, prod] of Array.from(store.externalProducts.entries())) {
          if (prod.tenantId === where.tenantId && prod.provider === where.provider) {
            if (where.syncedAt?.lt && prod.syncedAt < where.syncedAt.lt) {
              store.externalProducts.delete(key);
              count++;
            }
          }
        }
        return { count };
      },
      async count({ where }) {
        let c = 0;
        for (const prod of store.externalProducts.values()) {
          if (prod.tenantId === where.tenantId && prod.provider === where.provider) c++;
        }
        return c;
      },
    },
    externalProductVariant: {
      async upsert({ where, create, update }) {
        const key = `${where.tenantId_provider_externalVariantId.tenantId}_${where.tenantId_provider_externalVariantId.externalVariantId}`;
        const existing = store.externalVariants.get(key) || { id: `local_var_${where.tenantId_provider_externalVariantId.externalVariantId}` };
        const merged = { ...existing, ...create, ...update };
        store.externalVariants.set(key, merged);
        return merged;
      },
      async deleteMany({ where }) {
        let count = 0;
        for (const [key, v] of Array.from(store.externalVariants.entries())) {
          if (v.tenantId === where.tenantId && v.provider === where.provider) {
            if (where.syncedAt?.lt && v.syncedAt < where.syncedAt.lt) {
              store.externalVariants.delete(key);
              count++;
            }
          }
        }
        return { count };
      },
      async count({ where }) {
        let c = 0;
        for (const v of store.externalVariants.values()) {
          if (v.tenantId === where.tenantId && v.provider === where.provider) c++;
        }
        return c;
      },
    },
    async $transaction(fn) {
      return fn(this);
    },
  };
}

function createMockLockClient() {
  return {
    async query() {
      return { rows: [{ locked: true }] };
    },
    async end() {},
  };
}

console.log('======================================================================');
console.log('🧪 VELION SHOPIFY CATALOG SYNC & RECONCILIATION SUITE');
console.log('======================================================================\n');

(async () => {
  // ── TEST 1: Reconciliación de Stale Cache (elimina productos despublicados) ──
  await runTest('TEST 1: Stale Reconciliation elimina productos y variantes que ya no existen en Shopify', async () => {
    const mockPrisma = createMockPrisma();
    const mockLock = createMockLockClient();

    // Sembrar un producto local previo (que ya no vendrá en Shopify)
    const oldDate = new Date(Date.now() - 100000);
    mockPrisma._store.externalProducts.set('tenant_sync_1_gid://shopify/Product/obsolete', {
      id: 'local_obsolete_prod',
      tenantId: 'tenant_sync_1',
      provider: 'SHOPIFY',
      externalId: 'gid://shopify/Product/obsolete',
      syncedAt: oldDate,
    });
    mockPrisma._store.externalVariants.set('tenant_sync_1_gid://shopify/ProductVariant/obsolete_var', {
      id: 'local_obsolete_var',
      tenantId: 'tenant_sync_1',
      provider: 'SHOPIFY',
      externalVariantId: 'gid://shopify/ProductVariant/obsolete_var',
      syncedAt: oldDate,
    });

    const mockGraphqlExecutor = async (tenantId, { query }) => {
      if (query.includes('getProducts')) {
        return {
          data: {
            products: {
              nodes: [
                { id: 'gid://shopify/Product/active_1', title: 'Active 1', status: 'ACTIVE', tags: [], images: { nodes: [] } },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        };
      }
      if (query.includes('getProductVariants')) {
        return {
          data: {
            productVariants: {
              nodes: [
                { id: 'gid://shopify/ProductVariant/active_var_1', title: 'V1', price: '100.0', availableForSale: true, inventoryQuantity: 10, product: { id: 'gid://shopify/Product/active_1' } },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        };
      }
    };

    const res = await syncShopifyCatalog('tenant_sync_1', {
      prismaClient: mockPrisma,
      graphqlExecutor: mockGraphqlExecutor,
      lockClient: mockLock,
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.productsSynced, 1);
    assert.strictEqual(res.variantsSynced, 1);
    assert.strictEqual(res.staleProductsDeleted, 1);
    assert.strictEqual(res.staleVariantsDeleted, 1);

    // El producto obsoleto ya no debe existir
    assert.strictEqual(mockPrisma._store.externalProducts.has('tenant_sync_1_gid://shopify/Product/obsolete'), false);
    assert.strictEqual(mockPrisma._store.externalVariants.has('tenant_sync_1_gid://shopify/ProductVariant/obsolete_var'), false);
    // El producto activo debe existir
    assert.strictEqual(mockPrisma._store.externalProducts.has('tenant_sync_1_gid://shopify/Product/active_1'), true);
  });

  // ── TEST 2: Idempotencia en doble sync consecutivo ──────────────────────────
  await runTest('TEST 2: Doble sync consecutivo sin cambios en Shopify mantiene conteos idénticos y 0 duplicados', async () => {
    const mockPrisma = createMockPrisma();
    const mockLock = createMockLockClient();

    const mockGraphqlExecutor = async (tenantId, { query }) => {
      if (query.includes('getProducts')) {
        return {
          data: {
            products: {
              nodes: [
                { id: 'gid://shopify/Product/p1', title: 'P1', status: 'ACTIVE', tags: [], images: { nodes: [] } },
                { id: 'gid://shopify/Product/p2', title: 'P2', status: 'ACTIVE', tags: [], images: { nodes: [] } },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        };
      }
      if (query.includes('getProductVariants')) {
        return {
          data: {
            productVariants: {
              nodes: [
                { id: 'gid://shopify/ProductVariant/v1', title: 'V1', price: '10.0', availableForSale: true, inventoryQuantity: 5, product: { id: 'gid://shopify/Product/p1' } },
                { id: 'gid://shopify/ProductVariant/v2', title: 'V2', price: '20.0', availableForSale: true, inventoryQuantity: 8, product: { id: 'gid://shopify/Product/p2' } },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        };
      }
    };

    // 1er Sync
    const res1 = await syncShopifyCatalog('tenant_sync_1', {
      prismaClient: mockPrisma,
      graphqlExecutor: mockGraphqlExecutor,
      lockClient: mockLock,
    });
    assert.strictEqual(res1.productsSynced, 2);
    assert.strictEqual(res1.variantsSynced, 2);
    assert.strictEqual(mockPrisma._store.externalProducts.size, 2);
    assert.strictEqual(mockPrisma._store.externalVariants.size, 2);

    // 2do Sync
    const res2 = await syncShopifyCatalog('tenant_sync_1', {
      prismaClient: mockPrisma,
      graphqlExecutor: mockGraphqlExecutor,
      lockClient: mockLock,
    });
    assert.strictEqual(res2.productsSynced, 2);
    assert.strictEqual(res2.variantsSynced, 2);
    assert.strictEqual(res2.staleProductsDeleted, 0);
    assert.strictEqual(res2.staleVariantsDeleted, 0);

    // Los conteos totales en BD deben ser exactamente los mismos (0 duplicados)
    assert.strictEqual(mockPrisma._store.externalProducts.size, 2);
    assert.strictEqual(mockPrisma._store.externalVariants.size, 2);
  });

  // ── TEST 3: Transición de estados en Integration ───────────────────────────
  await runTest('TEST 3: syncStatus transita a IDLE y lastSyncedAt se actualiza con éxito', async () => {
    const mockPrisma = createMockPrisma();
    const mockLock = createMockLockClient();

    const mockGraphqlExecutor = async () => ({
      data: {
        products: { nodes: [], pageInfo: { hasNextPage: false } },
        productVariants: { nodes: [], pageInfo: { hasNextPage: false } },
      },
    });

    await syncShopifyCatalog('tenant_sync_1', {
      prismaClient: mockPrisma,
      graphqlExecutor: mockGraphqlExecutor,
      lockClient: mockLock,
    });

    const integrationInDb = mockPrisma._store.integrations.get('tenant_sync_1_SHOPIFY');
    assert.strictEqual(integrationInDb.syncStatus, 'IDLE');
    assert.ok(integrationInDb.lastSyncedAt instanceof Date);
    assert.strictEqual(integrationInDb.lastSyncError, null);
  });

  // ── TEST 4: Controlador triggerShopifySync (POST /api/integrations/shopify/sync)
  await runTest('TEST 4: triggerShopifySync responde con resumen seguro y sin exponer credenciales', async () => {
    const { encryptText } = await import('./src/utils/cryptoUtils.js');
    const mockPrisma = createMockPrisma();
    const intItem = mockPrisma._store.integrations.get('tenant_sync_1_SHOPIFY');
    intItem.encryptedAccessToken = encryptText('shpat_test_access_token');
    intItem.accessTokenExpiresAt = new Date(Date.now() + 3600000);

    const originalPrisma = (await import('./src/db.js')).default;
    const oldFindUnique = originalPrisma.integration.findUnique;
    const oldUpdate = originalPrisma.integration.update;
    const oldTransaction = originalPrisma.$transaction;
    const oldExtProd = originalPrisma.externalProduct;
    const oldExtVar = originalPrisma.externalProductVariant;

    originalPrisma.integration.findUnique = mockPrisma.integration.findUnique;
    originalPrisma.integration.update = mockPrisma.integration.update;
    originalPrisma.$transaction = mockPrisma.$transaction;
    originalPrisma.externalProduct = mockPrisma.externalProduct;
    originalPrisma.externalProductVariant = mockPrisma.externalProductVariant;

    const req = {
      user: { tenantId: 'tenant_sync_1', userId: 'user_sync_1' },
      body: { tenantId: 'attacker_tenant' }, // Debe ser ignorado
    };

    let responseData = null;
    let responseStatus = 200;
    const res = {
      status(code) { responseStatus = code; return this; },
      json(data) { responseData = data; return this; },
    };

    try {
      // Mock global fetch
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            products: { nodes: [], pageInfo: { hasNextPage: false } },
            productVariants: { nodes: [], pageInfo: { hasNextPage: false } },
          },
        }),
      });

      try {
        await triggerShopifySync(req, res);
        assert.strictEqual(responseStatus, 200);
        assert.strictEqual(responseData.success, true);
        assert.strictEqual(typeof responseData.productsSynced, 'number');
        assert.strictEqual(typeof responseData.variantsSynced, 'number');
        assert.strictEqual(typeof responseData.durationMs, 'number');

        // Cero tokens expuestos en la respuesta
        const jsonStr = JSON.stringify(responseData);
        assert.ok(!jsonStr.includes('shpat_'));
        assert.ok(!jsonStr.includes('shprt_'));
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      originalPrisma.integration.findUnique = oldFindUnique;
      originalPrisma.integration.update = oldUpdate;
      originalPrisma.$transaction = oldTransaction;
      originalPrisma.externalProduct = oldExtProd;
      originalPrisma.externalProductVariant = oldExtVar;
    }
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE SHOPIFY CATALOG SYNC: ${passedTests}/${totalTests} TESTS PASARON`);
  console.log('======================================================================\n');
})();
