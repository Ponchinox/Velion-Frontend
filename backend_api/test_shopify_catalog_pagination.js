/**
 * SHOPIFY CATALOG PAGINATION & RESILIENCE TEST SUITE
 * ==================================================
 * Valida el comportamiento del Two-Pass cursor pagination:
 * - Paginación múltiple continua (Pass A y Pass B).
 * - Detección y rechazo de bucles infinitos de cursor (PAGINATION_CURSOR_LOOP).
 * - Detección de endCursor ausente cuando hasNextPage=true.
 * - Detección y aborto ante variante huérfana (ORPHAN_SHOPIFY_VARIANT).
 * - Fallo de red en página N aborta completamente el fetch sin persistir.
 */

import assert from 'node:assert';
import { syncShopifyCatalog } from './src/services/integrations/shopify/shopifyCatalogSyncService.js';
import { ShopifySyncError } from './src/services/integrations/shopify/shopifyErrors.js';

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
    id: 'int_page_test_1',
    tenantId: 'tenant_page_1',
    provider: 'SHOPIFY',
    status: 'CONNECTED',
    shopDomain: 'tienda-page.myshopify.com',
    syncStatus: 'IDLE',
  };
  store.integrations.set(`${integration.tenantId}_${integration.provider}`, integration);

  return {
    _store: store,
    integration: {
      async findUnique({ where }) {
        return store.integrations.get(`${where.tenantId_provider.tenantId}_${where.tenantId_provider.provider}`) || null;
      },
      async update({ where, data }) {
        const item = store.integrations.get('tenant_page_1_SHOPIFY');
        Object.assign(item, data);
        return item;
      },
    },
    externalProduct: {
      async upsert({ where, create, update }) {
        const key = `${where.tenantId_provider_externalId.tenantId}_${where.tenantId_provider_externalId.externalId}`;
        const existing = store.externalProducts.get(key) || { id: `local_prod_${Math.random()}` };
        const merged = { ...existing, ...create, ...update };
        store.externalProducts.set(key, merged);
        return merged;
      },
      async deleteMany({ where }) {
        let count = 0;
        for (const [key, prod] of store.externalProducts.entries()) {
          if (prod.tenantId === where.tenantId && prod.provider === where.provider) {
            if (where.syncedAt?.lt && prod.syncedAt < where.syncedAt.lt) {
              store.externalProducts.delete(key);
              count++;
            }
          }
        }
        return { count };
      },
    },
    externalProductVariant: {
      async upsert({ where, create, update }) {
        const key = `${where.tenantId_provider_externalVariantId.tenantId}_${where.tenantId_provider_externalVariantId.externalVariantId}`;
        const existing = store.externalVariants.get(key) || { id: `local_var_${Math.random()}` };
        const merged = { ...existing, ...create, ...update };
        store.externalVariants.set(key, merged);
        return merged;
      },
      async deleteMany({ where }) {
        let count = 0;
        for (const [key, v] of store.externalVariants.entries()) {
          if (v.tenantId === where.tenantId && v.provider === where.provider) {
            if (where.syncedAt?.lt && v.syncedAt < where.syncedAt.lt) {
              store.externalVariants.delete(key);
              count++;
            }
          }
        }
        return { count };
      },
    },
    async $transaction(fn) {
      return fn(this);
    },
  };
}

function createMockLockClient() {
  return {
    async query(sql, params) {
      return { rows: [{ locked: true }] };
    },
    async end() {},
  };
}

console.log('======================================================================');
console.log('🧪 VELION SHOPIFY CATALOG PAGINATION & RESILIENCE SUITE');
console.log('======================================================================\n');

(async () => {
  // ── TEST 1: Paginación múltiple de productos y variantes ───────────────────
  await runTest('TEST 1: Paginación de múltiples páginas en Pass A y Pass B', async () => {
    const mockPrisma = createMockPrisma();
    const mockLock = createMockLockClient();

    let productPageCalls = 0;
    let variantPageCalls = 0;

    const mockGraphqlExecutor = async (tenantId, { query, variables }) => {
      if (query.includes('getProducts')) {
        productPageCalls++;
        if (!variables.after) {
          return {
            data: {
              products: {
                nodes: [
                  { id: 'gid://shopify/Product/1', title: 'P1', status: 'ACTIVE', tags: [], images: { nodes: [] } },
                  { id: 'gid://shopify/Product/2', title: 'P2', status: 'ACTIVE', tags: [], images: { nodes: [] } },
                ],
                pageInfo: { hasNextPage: true, endCursor: 'cursor_prod_1' },
              },
            },
          };
        } else {
          return {
            data: {
              products: {
                nodes: [
                  { id: 'gid://shopify/Product/3', title: 'P3', status: 'ACTIVE', tags: [], images: { nodes: [] } },
                ],
                pageInfo: { hasNextPage: false, endCursor: 'cursor_prod_2' },
              },
            },
          };
        }
      }

      if (query.includes('getProductVariants')) {
        variantPageCalls++;
        if (!variables.after) {
          return {
            data: {
              productVariants: {
                nodes: [
                  { id: 'gid://shopify/ProductVariant/101', title: 'V101', price: '10.0', availableForSale: true, inventoryQuantity: 5, product: { id: 'gid://shopify/Product/1' } },
                  { id: 'gid://shopify/ProductVariant/102', title: 'V102', price: '20.0', availableForSale: true, inventoryQuantity: 5, product: { id: 'gid://shopify/Product/2' } },
                ],
                pageInfo: { hasNextPage: true, endCursor: 'cursor_var_1' },
              },
            },
          };
        } else {
          return {
            data: {
              productVariants: {
                nodes: [
                  { id: 'gid://shopify/ProductVariant/103', title: 'V103', price: '30.0', availableForSale: false, inventoryQuantity: 0, product: { id: 'gid://shopify/Product/3' } },
                ],
                pageInfo: { hasNextPage: false, endCursor: 'cursor_var_2' },
              },
            },
          };
        }
      }

      throw new Error('Unknown query');
    };

    const res = await syncShopifyCatalog('tenant_page_1', {
      prismaClient: mockPrisma,
      graphqlExecutor: mockGraphqlExecutor,
      lockClient: mockLock,
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.productsSynced, 3);
    assert.strictEqual(res.variantsSynced, 3);
    assert.strictEqual(productPageCalls, 2);
    assert.strictEqual(variantPageCalls, 2);
  });

  // ── TEST 2: Detección de bucle infinito de cursor ──────────────────────────
  await runTest('TEST 2: Cursor repetido lanza PAGINATION_CURSOR_LOOP', async () => {
    const mockPrisma = createMockPrisma();
    const mockLock = createMockLockClient();

    const mockGraphqlExecutor = async (tenantId, { query, variables }) => {
      return {
        data: {
          products: {
            nodes: [{ id: 'gid://shopify/Product/1', title: 'P1', status: 'ACTIVE', tags: [], images: { nodes: [] } }],
            pageInfo: { hasNextPage: true, endCursor: 'stuck_cursor_abc' }, // Mismo cursor siempre
          },
        },
      };
    };

    await assert.rejects(
      async () => {
        await syncShopifyCatalog('tenant_page_1', {
          prismaClient: mockPrisma,
          graphqlExecutor: mockGraphqlExecutor,
          lockClient: mockLock,
        });
      },
      (err) => err instanceof ShopifySyncError && err.code === 'PAGINATION_CURSOR_LOOP'
    );
  });

  // ── TEST 3: hasNextPage=true sin endCursor lanza MISSING_END_CURSOR ────────
  await runTest('TEST 3: hasNextPage=true sin endCursor lanza MISSING_END_CURSOR', async () => {
    const mockPrisma = createMockPrisma();
    const mockLock = createMockLockClient();

    const mockGraphqlExecutor = async (tenantId, { query, variables }) => {
      return {
        data: {
          products: {
            nodes: [{ id: 'gid://shopify/Product/1', title: 'P1', status: 'ACTIVE', tags: [], images: { nodes: [] } }],
            pageInfo: { hasNextPage: true, endCursor: null }, // Error de Shopify
          },
        },
      };
    };

    await assert.rejects(
      async () => {
        await syncShopifyCatalog('tenant_page_1', {
          prismaClient: mockPrisma,
          graphqlExecutor: mockGraphqlExecutor,
          lockClient: mockLock,
        });
      },
      (err) => err instanceof ShopifySyncError && err.code === 'MISSING_END_CURSOR'
    );
  });

  // ── TEST 4: Variante con producto padre desconocido lanza ORPHAN_SHOPIFY_VARIANT
  await runTest('TEST 4: Variante huérfana (sin producto padre) lanza ORPHAN_SHOPIFY_VARIANT', async () => {
    const mockPrisma = createMockPrisma();
    const mockLock = createMockLockClient();

    const mockGraphqlExecutor = async (tenantId, { query }) => {
      if (query.includes('getProducts')) {
        return {
          data: {
            products: {
              nodes: [{ id: 'gid://shopify/Product/1', title: 'P1', status: 'ACTIVE', tags: [], images: { nodes: [] } }],
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
                // variant points to Product/999 which was NEVER retrieved in Pass A
                { id: 'gid://shopify/ProductVariant/orphan_1', title: 'V_Orphan', price: '10.0', availableForSale: true, inventoryQuantity: 1, product: { id: 'gid://shopify/Product/999' } },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        };
      }
    };

    await assert.rejects(
      async () => {
        await syncShopifyCatalog('tenant_page_1', {
          prismaClient: mockPrisma,
          graphqlExecutor: mockGraphqlExecutor,
          lockClient: mockLock,
        });
      },
      (err) => err instanceof ShopifySyncError && err.code === 'ORPHAN_SHOPIFY_VARIANT'
    );
  });

  // ── TEST 5: Fallo de red en página 2 causa CERO persistencia y marca ERROR ──
  await runTest('TEST 5: Fallo de red en página 2 aborta antes de abrir transacción DB y marca syncStatus=ERROR', async () => {
    const mockPrisma = createMockPrisma();
    const mockLock = createMockLockClient();

    let callCount = 0;
    const mockGraphqlExecutor = async (tenantId, { query, variables }) => {
      callCount++;
      if (callCount === 1) {
        return {
          data: {
            products: {
              nodes: [{ id: 'gid://shopify/Product/1', title: 'P1', status: 'ACTIVE', tags: [], images: { nodes: [] } }],
              pageInfo: { hasNextPage: true, endCursor: 'cursor_p1' },
            },
          },
        };
      }
      throw new Error('Network connection reset by peer');
    };

    await assert.rejects(
      async () => {
        await syncShopifyCatalog('tenant_page_1', {
          prismaClient: mockPrisma,
          graphqlExecutor: mockGraphqlExecutor,
          lockClient: mockLock,
        });
      },
      (err) => err.message.includes('Network connection reset')
    );

    // Validar que NINGÚN producto fue persistido en la base de datos
    assert.strictEqual(mockPrisma._store.externalProducts.size, 0);
    assert.strictEqual(mockPrisma._store.externalVariants.size, 0);

    // Validar que Integration fue marcado con syncStatus = ERROR y error sanitizado
    const integrationInDb = mockPrisma._store.integrations.get('tenant_page_1_SHOPIFY');
    assert.strictEqual(integrationInDb.syncStatus, 'ERROR');
    assert.ok(integrationInDb.lastSyncError.includes('Network connection reset'));
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE SHOPIFY CATALOG PAGINATION: ${passedTests}/${totalTests} TESTS PASARON`);
  console.log('======================================================================\n');
})();
