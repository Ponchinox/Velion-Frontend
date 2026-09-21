import { PrismaClient } from '@prisma/client';
import assert from 'node:assert';

// ── MANDATORY HOSTNAME SECURITY GUARD ──────────────────────────────────────────
const rawUrl = process.env.DATABASE_URL || 'postgresql://disposable_user:disposable_pass_123@127.0.0.1:54333/velion_commerce_test?schema=public';
process.env.DATABASE_URL = rawUrl;

const parsedUrl = new URL(rawUrl);
if (parsedUrl.hostname !== 'localhost' && parsedUrl.hostname !== '127.0.0.1') {
  console.error(`❌ CRITICAL SECURITY ABORT: Forbidden host "${parsedUrl.hostname}". Only localhost/127.0.0.1 permitted.`);
  process.exit(1);
}

console.log('======================================================================');
console.log('🧪 VELION COMMERCE PHASE 2B: DISPOSABLE POSTGRESQL MIGRATION TEST');
console.log('======================================================================');
console.log(`DB_HOST = ${parsedUrl.hostname}`);
console.log(`DB_NAME = ${parsedUrl.pathname.replace('/', '')}`);
console.log('ENVIRONMENT = DISPOSABLE_LOCAL\n');

const prisma = new PrismaClient();

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

async function main() {
  try {
    // ── TEST 1: Tablas nuevas existen y son consultables ──────────────────────────
    await runTest('TEST 1: Nuevas tablas Integration, ExternalProduct, ExternalProductVariant existen en PostgreSQL', async () => {
      const integrations = await prisma.integration.findMany();
      const extProducts = await prisma.externalProduct.findMany();
      const extVariants = await prisma.externalProductVariant.findMany();
      assert.ok(Array.isArray(integrations));
      assert.ok(Array.isArray(extProducts));
      assert.ok(Array.isArray(extVariants));
    });

    // ── TEST 2: Productos históricos siguen existiendo sin SKU (preservación intacta)
    await runTest('TEST 2: Productos pre-migración sobreviven sin cambios (sku = null, normalizedSku = null)', async () => {
      const p1 = await prisma.product.findUnique({ where: { id: 'prod-test-pre-001' } });
      assert.ok(p1, 'Producto histórico 1 debe existir');
      assert.strictEqual(p1.name, 'Producto Historico Sin SKU');
      assert.strictEqual(p1.sku, null);
      assert.strictEqual(p1.normalizedSku, null);
      assert.strictEqual(p1.price, 49.9);

      const p2 = await prisma.product.findUnique({ where: { id: 'prod-test-pre-002' } });
      assert.ok(p2, 'Producto histórico 2 debe existir');
      assert.strictEqual(p2.sku, null);
      assert.strictEqual(p2.normalizedSku, null);
    });

    // ── TEST 3: Pedidos históricos sobreviven intactos con campos externos default/null
    await runTest('TEST 3: Pedidos y OrderItems pre-migración sobreviven intactos sin pérdida de datos', async () => {
      const order = await prisma.order.findUnique({
        where: { id: 'order-test-pre-001' },
        include: { items: true }
      });
      assert.ok(order, 'Pedido histórico debe existir');
      assert.strictEqual(order.status, 'CONFIRMED');
      assert.strictEqual(order.externalProvider, null);
      assert.strictEqual(order.externalDraftOrderId, null);
      assert.strictEqual(order.externalSyncAttempts, 0);
      assert.strictEqual(order.items.length, 2);

      for (const item of order.items) {
        assert.strictEqual(item.sourceProvider, null);
        assert.strictEqual(item.externalProductId, null);
        assert.strictEqual(item.externalVariantId, null);
        assert.strictEqual(item.sourceSku, null);
      }
    });

    // Setup tenants for migration testing
    const tenantA = await prisma.tenant.upsert({
      where: { id: 'tenant-test-a' },
      update: {},
      create: { id: 'tenant-test-a', name: 'Tenant Test A' }
    });

    const tenantB = await prisma.tenant.upsert({
      where: { id: 'tenant-test-b' },
      update: {},
      create: { id: 'tenant-test-b', name: 'Tenant Test B' }
    });

    // ── TEST 4: Crear Integration Shopify Tenant A -> SUCCESS ─────────────────────
    await runTest('TEST 4: Crear Integration Shopify en Tenant A con shopDomain canónico -> SUCCESS', async () => {
      // Limpiar si existía previamente
      await prisma.integration.deleteMany({ where: { tenantId: tenantA.id } });

      const created = await prisma.integration.create({
        data: {
          tenantId: tenantA.id,
          provider: 'SHOPIFY',
          shopDomain: 'tienda-test.myshopify.com',
          status: 'CONNECTED',
          catalogMode: 'COMBINED',
          priceSource: 'SHOPIFY',
          stockSource: 'SHOPIFY'
        }
      });
      assert.ok(created.id);
      assert.strictEqual(created.shopDomain, 'tienda-test.myshopify.com');
      assert.strictEqual(created.status, 'CONNECTED');
    });

    // ── TEST 5: Misma tienda en Tenant B debe fallar por unique constraint ────────
    await runTest('TEST 5: Intentar misma combinación provider/shopDomain en Tenant B -> FAILS (P2002)', async () => {
      await prisma.integration.deleteMany({ where: { tenantId: tenantB.id } });

      let threw = false;
      try {
        await prisma.integration.create({
          data: {
            tenantId: tenantB.id,
            provider: 'SHOPIFY',
            shopDomain: 'tienda-test.myshopify.com', // MISMO shopDomain
            status: 'CONNECTED'
          }
        });
      } catch (err) {
        threw = true;
        // P2002 = Prisma Unique constraint failed
        assert.ok(err.code === 'P2002' || err.message.includes('unique constraint') || err.message.includes('Unique constraint'), `Error code must be P2002, got ${err.code}`);
      }
      assert.ok(threw, 'Debe fallar al intentar conectar la misma tienda a dos tenants');
    });

    // ── TEST 6: Múltiples integraciones con shopDomain = NULL permitidas ──────────
    await runTest('TEST 6: Múltiples integraciones de proveedores con shopDomain = NULL son permitidas', async () => {
      // Tenant A con WOOCOMMERCE sin shopDomain inicial
      const i1 = await prisma.integration.create({
        data: {
          tenantId: tenantA.id,
          provider: 'WOOCOMMERCE',
          shopDomain: null,
          status: 'DISCONNECTED'
        }
      });
      assert.ok(i1.id);

      // Tenant B con WOOCOMMERCE sin shopDomain inicial (NULL != NULL en PostgreSQL)
      const i2 = await prisma.integration.create({
        data: {
          tenantId: tenantB.id,
          provider: 'WOOCOMMERCE',
          shopDomain: null,
          status: 'DISCONNECTED'
        }
      });
      assert.ok(i2.id);
      assert.notStrictEqual(i1.id, i2.id);
    });

    // ── TEST 7: Creación de ExternalProduct y ExternalProductVariant ──────────────
    let testExtProdId = null;
    let testExtVarId = null;
    await runTest('TEST 7: Creación exitosa de ExternalProduct y ExternalProductVariant con relaciones válidas', async () => {
      const integration = await prisma.integration.findFirst({
        where: { tenantId: tenantA.id, provider: 'SHOPIFY' }
      });

      const extProd = await prisma.externalProduct.create({
        data: {
          tenantId: tenantA.id,
          integrationId: integration.id,
          provider: 'SHOPIFY',
          externalId: 'gid://shopify/Product/1122334455',
          title: 'Remera Shopify V1',
          price: undefined, // En padre no hay price
          isAvailable: true
        }
      });
      testExtProdId = extProd.id;
      assert.ok(extProd.id);

      const extVar = await prisma.externalProductVariant.create({
        data: {
          tenantId: tenantA.id,
          externalProductId: extProd.id,
          provider: 'SHOPIFY',
          externalVariantId: 'gid://shopify/ProductVariant/9988776655',
          title: 'Remera Shopify V1 - Talle L / Azul',
          sku: 'REM-SH-L-AZ',
          normalizedSku: 'REM-SH-L-AZ',
          price: 59.99,
          compareAtPrice: 79.99,
          inventoryQuantity: 15,
          availableForSale: true
        }
      });
      testExtVarId = extVar.id;
      assert.ok(extVar.id);
      assert.strictEqual(extVar.price, 59.99);
      assert.strictEqual(extVar.normalizedSku, 'REM-SH-L-AZ');
    });

    // ── TEST 8: Foreign Key hacia Tenant en ExternalProductVariant ────────────────
    await runTest('TEST 8: Variant con tenant inexistente -> FAILS por Foreign Key (P2003)', async () => {
      let threw = false;
      try {
        await prisma.externalProductVariant.create({
          data: {
            tenantId: 'tenant-fantasma-non-existent-999', // Tenant inválido
            externalProductId: testExtProdId,
            provider: 'SHOPIFY',
            externalVariantId: 'gid://shopify/ProductVariant/fail-fk',
            title: 'Variante Fallida',
            price: 10.0
          }
        });
      } catch (err) {
        threw = true;
        assert.ok(err.code === 'P2003' || err.message.includes('foreign key constraint') || err.message.includes('Foreign key constraint'), `Debe fallar por P2003 Foreign Key, got ${err.code}`);
      }
      assert.ok(threw, 'Inserción de variante con tenantId inexistente debe ser rechazada');
    });

    // ── TEST 9: Cascade Delete en ExternalProduct y variantes ──────────────────────
    await runTest('TEST 9: Eliminar ExternalProduct elimina variantes en cascada (caché)', async () => {
      await prisma.externalProduct.delete({
        where: { id: testExtProdId }
      });

      const foundVariant = await prisma.externalProductVariant.findUnique({
        where: { id: testExtVarId }
      });
      assert.strictEqual(foundVariant, null, 'Variante debe haber sido eliminada automáticamente por cascada');
    });

    // ── TEST 10: Inmunidad de pedidos históricos tras operaciones externas ────────
    await runTest('TEST 10: Pedidos y OrderItems históricos continúan 100% intactos e inmunes a mutaciones externas', async () => {
      const order = await prisma.order.findUnique({
        where: { id: 'order-test-pre-001' },
        include: { items: true }
      });
      assert.ok(order, 'Pedido debe seguir existiendo');
      assert.strictEqual(order.items.length, 2);
    });

    console.log('\n======================================================================');
    console.log(`🎉 SUITE MIGRATION PHASE 2B: ${passedTests}/${totalTests} TESTS PASARON`);
    console.log('======================================================================\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('\n❌ Suite Phase 2B falló:', err);
  process.exit(1);
});
