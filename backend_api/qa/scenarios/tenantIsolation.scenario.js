import assert from 'node:assert';
import { TENANT_A, TENANT_B } from '../fixtures/tenants.js';
import { createUnifiedMockPrisma } from '../mocks/mockPrisma.js';

export async function runTenantIsolationScenario() {
  console.log('\n======================================================================');
  console.log('🏢 SCENARIO: TENANT ISOLATION & CROSS-TENANT DEFENSE (ZERO-COST S/0.00)');
  console.log('======================================================================');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✅ PASS: ${name}`);
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}: ${err.message}`);
      throw err;
    }
  }

  const mockPrisma = createUnifiedMockPrisma({
    tenants: [TENANT_A, TENANT_B],
    products: [...TENANT_A.products, ...TENANT_B.products]
  });

  // 1. Consulta directa por ID de producto de Tenant B desde sesión de Tenant A
  await test('T1: Consulta directa de producto de Tenant B con credencial Tenant A retorna null', async () => {
    const prodB_id = TENANT_B.products[0].id; // Vestido de Tenant B

    // Búsqueda con scope de Tenant A
    const result = await mockPrisma.product.findFirst({
      where: {
        id: prodB_id,
        user: { tenantId: TENANT_A.id }
      },
      select: { id: true, name: true, price: true }
    });

    assert.strictEqual(result, null, 'No debe ser posible acceder a productos de otro tenant');
  });

  // 2. Listado de catálogo de Tenant A nunca contiene productos de Tenant B
  await test('T2: Listado de catálogo de Tenant A contiene únicamente sus propios productos', async () => {
    const catalogA = await mockPrisma.product.findMany({
      where: { tenantId: TENANT_A.id }
    });

    assert.strictEqual(catalogA.length, TENANT_A.products.length);
    for (const p of catalogA) {
      assert.strictEqual(p.tenantId, TENANT_A.id);
      assert.ok(!p.name.includes('Vestido'), 'No debe contener productos de Tenant B');
      assert.ok(!p.name.includes('Zapatos'), 'No debe contener productos de Tenant B');
    }
  });

  // 3. Aislamiento de cuentas bancarias y métodos de pago
  await test('T3: Políticas y cuentas de Tenant B no son visibles para clientes de Tenant A', async () => {
    const tenantA_data = await mockPrisma.tenant.findUnique({
      where: { id: TENANT_A.id },
      select: { id: true, name: true, bankAccounts: true, termsAndPolicies: true }
    });

    assert.ok(tenantA_data.bankAccounts.includes('Yape / Plin'));
    assert.ok(!tenantA_data.bankAccounts.includes('BBVA'), 'Cuentas de Tenant B no deben aparecer en Tenant A');
    assert.ok(tenantA_data.termsAndPolicies.includes('Arequipa'));
    assert.ok(!tenantA_data.termsAndPolicies.includes('Lima Metropolitana'));
  });

  // 4. Aislamiento de multimedia entre tenants
  await test('T4: Multimedia de Tenant B (Zapatos video) no puede ser despachada por Tenant A', async () => {
    const shoesVideoUrl = TENANT_B.products.find((p) => p.name.includes('Zapatos')).videoUrl;

    const findMediaForTenantA = async (queryName) => {
      const prod = await mockPrisma.product.findFirst({
        where: {
          name: queryName,
          tenantId: TENANT_A.id
        },
        select: { id: true, videoUrl: true }
      });
      return prod?.videoUrl || null;
    };

    const mediaResult = await findMediaForTenantA('Zapatos Cuero Oxford');
    assert.strictEqual(mediaResult, null, 'Tenant A no puede emitir video de productos de Tenant B');
  });

  console.log(`\n🎉 TENANT ISOLATION SCENARIO: ${passed}/${total} TESTS PASARON EXITOSAMENTE`);
  return { passed, total };
}

if (process.argv[1] && process.argv[1].endsWith('tenantIsolation.scenario.js')) {
  runTenantIsolationScenario().then(() => process.exit(0)).catch(() => process.exit(1));
}
