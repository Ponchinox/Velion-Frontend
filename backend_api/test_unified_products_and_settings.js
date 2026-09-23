/**
 * TEST SUITE: CATÁLOGO UNIFICADO, PRODUCTOS READ-ONLY Y PERSISTENCIA DE SETTINGS
 * ==============================================================================
 */

import assert from 'assert';

process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_123';

const {
  getProducts,
  updateProduct,
  deleteProduct,
} = await import('./src/controllers/productController.js');

const {
  getShopifyStatus,
  updateShopifySettings,
} = await import('./src/controllers/shopifyController.js');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}

(async () => {
  console.log('======================================================================');
  console.log('🧪 SUITE: CATÁLOGO UNIFICADO, READ-ONLY GUARD Y SETTINGS HYDRATION');
  console.log('======================================================================\n');

  const testTenantId = 'tenant_unified_test_123';
  const testUserId = 'user_unified_test_456';
  const externalProductId = 'ext_prod_shopify_test_789';

  const originalPrisma = (await import('./src/db.js')).default;
  const oldProductFindMany = originalPrisma.product.findMany;
  const oldProductFindFirst = originalPrisma.product.findFirst;
  const oldExternalFindMany = originalPrisma.externalProduct.findMany;
  const oldExternalFindUnique = originalPrisma.externalProduct.findUnique;
  const oldIntegrationFindUnique = originalPrisma.integration.findUnique;
  const oldIntegrationUpdate = originalPrisma.integration.update;

  try {
    // ── TEST 1: getProducts devuelve productos nativos y externos unificados ────
    console.log('▶ TEST 1: getProducts combina productos nativos y de Shopify con metadata');
    originalPrisma.product.findMany = async () => [
      { id: 'native_1', name: 'Zapatillas Velion', price: 150, isAvailable: true, userId: testUserId },
    ];
    originalPrisma.externalProduct.findMany = async () => [
      {
        id: externalProductId,
        title: 'The Archived Snowboard (Shopify)',
        description: 'Snowboard oficial',
        externalId: 'gid://shopify/Product/10752116982038',
        isAvailable: true,
        imageUrl: 'https://cdn.shopify.com/snowboard.jpg',
        images: ['https://cdn.shopify.com/snowboard.jpg'],
        variants: [
          { id: 'var_1', title: 'Default', price: 629.95, inventoryQuantity: 50, sku: 'SNOW-123' },
        ],
        integration: {
          shopDomain: 'velion-dev.myshopify.com',
          status: 'CONNECTED',
        },
      },
    ];

    const reqGet = { user: { userId: testUserId, tenantId: testTenantId } };
    const resGet = mockRes();
    await getProducts(reqGet, resGet);

    assert.strictEqual(resGet.body.length, 2, 'Debe devolver exactamente 2 productos');
    const native = resGet.body.find(p => p.id === 'native_1');
    const external = resGet.body.find(p => p.id === externalProductId);

    assert.ok(native, 'Producto nativo debe estar presente');
    assert.strictEqual(native.source, 'VELION');
    assert.strictEqual(native.isExternal, false);

    assert.ok(external, 'Producto Shopify debe estar presente');
    assert.strictEqual(external.name, 'The Archived Snowboard (Shopify)');
    assert.strictEqual(external.source, 'SHOPIFY');
    assert.strictEqual(external.isExternal, true);
    assert.strictEqual(external.readOnly, true);
    assert.strictEqual(external.price, 629.95);
    assert.strictEqual(external.stock, 50);
    assert.strictEqual(external.adminUrl, 'https://velion-dev.myshopify.com/admin/products/10752116982038');
    console.log('  ✅ PASS: Productos nativos y externos unificados correctamente.\n');

    // ── TEST 2: updateProduct bloquea edición de productos Shopify (Read-Only) ──
    console.log('▶ TEST 2: updateProduct rechaza con HTTP 403 modificar producto Shopify');
    originalPrisma.externalProduct.findUnique = async ({ where }) => {
      if (where.id === externalProductId) return { id: externalProductId, provider: 'SHOPIFY' };
      return null;
    };

    const reqUpdate = {
      params: { id: externalProductId },
      user: { userId: testUserId, tenantId: testTenantId },
      body: { price: 999 },
    };
    const resUpdate = mockRes();
    await updateProduct(reqUpdate, resUpdate);

    assert.strictEqual(resUpdate.statusCode, 403);
    assert.strictEqual(resUpdate.body.code, 'READ_ONLY_EXTERNAL_PRODUCT');
    assert.ok(resUpdate.body.error.includes('Este producto se administra desde Shopify'));
    console.log('  ✅ PASS: Intento de edición de producto Shopify bloqueado con 403.\n');

    // ── TEST 3: deleteProduct bloquea eliminación de productos Shopify ─────────
    console.log('▶ TEST 3: deleteProduct rechaza con HTTP 403 eliminar producto Shopify');
    const reqDelete = {
      params: { id: externalProductId },
      user: { userId: testUserId, tenantId: testTenantId },
    };
    const resDelete = mockRes();
    await deleteProduct(reqDelete, resDelete);

    assert.strictEqual(resDelete.statusCode, 403);
    assert.strictEqual(resDelete.body.code, 'READ_ONLY_EXTERNAL_PRODUCT');
    console.log('  ✅ PASS: Intento de eliminación de producto Shopify bloqueado con 403.\n');

    // ── TEST 4: getShopifyStatus devuelve settings tanto plano como anidado ────
    console.log('▶ TEST 4: getShopifyStatus devuelve settings anidado para hidratación');
    originalPrisma.integration.findUnique = async () => ({
      provider: 'SHOPIFY',
      status: 'CONNECTED',
      shopDomain: 'velion-dev.myshopify.com',
      catalogMode: 'SHOPIFY_ONLY',
      priceSource: 'SHOPIFY',
      stockSource: 'SHOPIFY',
      scopes: ['read_products'],
    });

    const reqStatus = { user: { tenantId: testTenantId } };
    const resStatus = mockRes();
    await getShopifyStatus(reqStatus, resStatus);

    assert.strictEqual(resStatus.body.catalogMode, 'SHOPIFY_ONLY');
    assert.ok(resStatus.body.settings, 'Objeto settings debe existir');
    assert.strictEqual(resStatus.body.settings.catalogMode, 'SHOPIFY_ONLY');
    assert.strictEqual(resStatus.body.settings.priceSource, 'SHOPIFY');
    assert.strictEqual(resStatus.body.settings.stockSource, 'SHOPIFY');
    console.log('  ✅ PASS: Hydration contract garantizado con settings anidado y plano.\n');

    console.log('======================================================================');
    console.log('🎉 TODOS LOS TESTS DE CATÁLOGO UNIFICADO Y SETTINGS PASARON');
    console.log('======================================================================\n');
  } finally {
    originalPrisma.product.findMany = oldProductFindMany;
    originalPrisma.product.findFirst = oldProductFindFirst;
    originalPrisma.externalProduct.findMany = oldExternalFindMany;
    originalPrisma.externalProduct.findUnique = oldExternalFindUnique;
    originalPrisma.integration.findUnique = oldIntegrationFindUnique;
    originalPrisma.integration.update = oldIntegrationUpdate;
  }
})();
