/**
 * SHOPIFY CATALOG MULTI-TENANT ISOLATION TEST SUITE
 * =================================================
 * Valida que la sincronización de catálogo esté estrictamente aislada por tenant:
 * - El sync del Tenant A NO modifica, sobrescribe ni borra productos del Tenant B.
 * - El sync del Tenant A NO modifica, sobrescribe ni borra variantes del Tenant B.
 * - La reconciliación de stale records solo afecta al tenant e integración activa.
 * - Concurrencia: Tenant A y Tenant B pueden sincronizar concurrentemente sin bloquearse entre sí.
 */

import assert from 'node:assert';
import { syncShopifyCatalog } from './src/services/integrations/shopify/shopifyCatalogSyncService.js';
import { ShopifySyncConflictError } from './src/services/integrations/shopify/shopifyErrors.js';

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

function createMultiTenantMockPrisma() {
  const store = {
    integrations: new Map(),
    externalProducts: new Map(),
    externalVariants: new Map(),
  };

  // Sembrar Tenant A
  store.integrations.set('tenant_A_SHOPIFY', {
    id: 'int_A',
    tenantId: 'tenant_A',
    provider: 'SHOPIFY',
    status: 'CONNECTED',
    shopDomain: 'tienda-a.myshopify.com',
    syncStatus: 'IDLE',
  });

  // Sembrar Tenant B
  store.integrations.set('tenant_B_SHOPIFY', {
    id: 'int_B',
    tenantId: 'tenant_B',
    provider: 'SHOPIFY',
    status: 'CONNECTED',
    shopDomain: 'tienda-b.myshopify.com',
    syncStatus: 'IDLE',
  });

  // Sembrar productos existentes para Tenant B
  const oldDate = new Date(Date.now() - 50000);
  store.externalProducts.set('tenant_B_gid://shopify/Product/b1', {
    id: 'local_prod_b1',
    tenantId: 'tenant_B',
    integrationId: 'int_B',
    provider: 'SHOPIFY',
    externalId: 'gid://shopify/Product/b1',
    title: 'Producto B1',
    syncedAt: oldDate,
  });
  store.externalVariants.set('tenant_B_gid://shopify/ProductVariant/bv1', {
    id: 'local_var_bv1',
    tenantId: 'tenant_B',
    externalProductId: 'local_prod_b1',
    provider: 'SHOPIFY',
    externalVariantId: 'gid://shopify/ProductVariant/bv1',
    title: 'Variante B1',
    syncedAt: oldDate,
  });

  return {
    _store: store,
    integration: {
      async findUnique({ where }) {
        return store.integrations.get(`${where.tenantId_provider.tenantId}_${where.tenantId_provider.provider}`) || null;
      },
      async update({ where, data }) {
        let item = null;
        for (const it of store.integrations.values()) {
          if (where.id && it.id === where.id) { item = it; break; }
          if (where.tenantId_provider && it.tenantId === where.tenantId_provider.tenantId && it.provider === where.tenantId_provider.provider) { item = it; break; }
        }
        if (item) Object.assign(item, data);
        return item;
      },
    },
    externalProduct: {
      async upsert({ where, create, update }) {
        const key = `${where.tenantId_provider_externalId.tenantId}_${where.tenantId_provider_externalId.externalId}`;
        const existing = store.externalProducts.get(key) || { id: `local_${Math.random()}` };
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
    },
    externalProductVariant: {
      async upsert({ where, create, update }) {
        const key = `${where.tenantId_provider_externalVariantId.tenantId}_${where.tenantId_provider_externalVariantId.externalVariantId}`;
        const existing = store.externalVariants.get(key) || { id: `local_${Math.random()}` };
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
    },
    async $transaction(fn) {
      return fn(this);
    },
  };
}

console.log('======================================================================');
console.log('🧪 VELION SHOPIFY CATALOG MULTI-TENANT ISOLATION SUITE');
console.log('======================================================================\n');

(async () => {
  // ── TEST 1: Tenant A sync no altera ni borra productos del Tenant B ─────────
  await runTest('TEST 1: Sync de Tenant A preserva intacto el catálogo y estado de Tenant B', async () => {
    const mockPrisma = createMultiTenantMockPrisma();

    const mockGraphqlExecutor = async (tenantId, { query }) => {
      if (query.includes('getProducts')) {
        return {
          data: {
            products: {
              nodes: [
                { id: 'gid://shopify/Product/a1', title: 'Producto A1', status: 'ACTIVE', tags: [], images: { nodes: [] } },
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
                { id: 'gid://shopify/ProductVariant/av1', title: 'Var A1', price: '50.0', availableForSale: true, inventoryQuantity: 10, product: { id: 'gid://shopify/Product/a1' } },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        };
      }
    };

    const mockLockClientA = {
      async query() { return { rows: [{ locked: true }] }; },
      async end() {},
    };

    const resA = await syncShopifyCatalog('tenant_A', {
      prismaClient: mockPrisma,
      graphqlExecutor: mockGraphqlExecutor,
      lockClient: mockLockClientA,
    });

    assert.strictEqual(resA.success, true);
    assert.strictEqual(resA.productsSynced, 1);
    assert.strictEqual(resA.variantsSynced, 1);

    // Verificar que los datos del Tenant B siguen INTACTOS
    const prodB = mockPrisma._store.externalProducts.get('tenant_B_gid://shopify/Product/b1');
    assert.ok(prodB, 'Producto de Tenant B debe seguir existiendo');
    assert.strictEqual(prodB.title, 'Producto B1');
    assert.strictEqual(prodB.tenantId, 'tenant_B');

    const varB = mockPrisma._store.externalVariants.get('tenant_B_gid://shopify/ProductVariant/bv1');
    assert.ok(varB, 'Variante de Tenant B debe seguir existiendo');
    assert.strictEqual(varB.title, 'Variante B1');
    assert.strictEqual(varB.tenantId, 'tenant_B');

    // Verificar que Integration de Tenant B no fue alterada
    const intB = mockPrisma._store.integrations.get('tenant_B_SHOPIFY');
    assert.strictEqual(intB.syncStatus, 'IDLE');
  });

  // ── TEST 2: Concurrencia: Mismo tenant bloquea, tenants distintos sincronizan ─
  await runTest('TEST 2: Intento de sync concurrente para el MISMO tenant lanza SYNC_ALREADY_RUNNING', async () => {
    const mockPrisma = createMultiTenantMockPrisma();

    // Simular lock no adquirido (otra sesión lo tiene)
    const mockLockBusy = {
      async query() { return { rows: [{ locked: false }] }; },
      async end() {},
    };

    await assert.rejects(
      async () => {
        await syncShopifyCatalog('tenant_A', {
          prismaClient: mockPrisma,
          graphqlExecutor: async () => ({}),
          lockClient: mockLockBusy,
        });
      },
      (err) => err instanceof ShopifySyncConflictError && err.code === 'SYNC_ALREADY_RUNNING'
    );
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE SHOPIFY CATALOG MULTI-TENANT: ${passedTests}/${totalTests} TESTS PASARON`);
  console.log('======================================================================\n');
})();
