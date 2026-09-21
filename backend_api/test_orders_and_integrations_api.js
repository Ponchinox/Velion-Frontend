/**
 * TEST: ORDERS & INTEGRATIONS API CONTRACT & SECURITY AUDIT
 * ==========================================================
 * Valida:
 * 1. GET /api/orders: Paginación, filtros (status, externalProvider), búsqueda.
 * 2. GET /api/orders: Aislamiento multi-tenant estricto (req.user.tenantId).
 * 3. GET /api/orders/:id: Detalle completo de orden, items y relación customer.
 * 4. GET /api/orders/:id: Bloqueo 404 entre tenants cruzados.
 * 5. PATCH /api/integrations/shopify/settings: Whitelist estricta de campos.
 * 6. PATCH /api/integrations/shopify/settings: Validación de enums (catalogMode, priceSource, stockSource).
 * 7. Cero filtración de secretos, tokens o credenciales en respuestas.
 */

import prisma from './src/db.js';
import { getOrders, getOrderById } from './src/controllers/orderController.js';
import { updateShopifySettings } from './src/controllers/shopifyController.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`✅ PASS: ${message}`);
}

function mockRes() {
  const res = {
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
  return res;
}

async function runSuite() {
  console.log('======================================================================');
  console.log('🛡️ VELION API AUDIT: ORDERS & INTEGRATIONS (PHASE 6C)');
  console.log('======================================================================\n');

  let tenantA = null;
  let tenantB = null;
  let customerA = null;
  let customerB = null;
  let orderA1 = null;
  let orderA2 = null;
  let orderB1 = null;
  let integrationA = null;

  try {
    // -------------------------------------------------------------------------
    // SETUP: Fixtures para Tenant A y Tenant B
    // -------------------------------------------------------------------------
    tenantA = await prisma.tenant.create({
      data: {
        name: 'Tenant Test 6C A',
        companyName: 'Empresa A 6C',
        currencyCode: 'PEN',
      },
    });

    tenantB = await prisma.tenant.create({
      data: {
        name: 'Tenant Test 6C B',
        companyName: 'Empresa B 6C',
        currencyCode: 'USD',
      },
    });

    customerA = await prisma.customer.create({
      data: {
        name: 'Carlos Cliente A',
        phone: '+51987654321',
        tenantId: tenantA.id,
      },
    });

    customerB = await prisma.customer.create({
      data: {
        name: 'Diana Cliente B',
        phone: '+51912345678',
        tenantId: tenantB.id,
      },
    });

    // Orden A1: Nativa de Velion
    orderA1 = await prisma.order.create({
      data: {
        tenantId: tenantA.id,
        customerId: customerA.id,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        totalAmount: 150.0,
        currencyCode: 'PEN',
        shippingCity: 'Lima',
        shippingAddress: 'Av. Las Flores 123',
        externalProvider: null,
        items: {
          create: [
            {
              name: 'Polo Algodón Velion',
              quantity: 2,
              price: 75.0,
              variant: 'Talla M',
              sourceProvider: 'VELION',
            },
          ],
        },
      },
      include: { items: true },
    });

    // Orden A2: Externa de Shopify
    orderA2 = await prisma.order.create({
      data: {
        tenantId: tenantA.id,
        customerId: customerA.id,
        status: 'PENDING',
        paymentStatus: 'UNPAID',
        totalAmount: 240.0,
        currencyCode: 'USD',
        shippingCity: 'Arequipa',
        externalProvider: 'SHOPIFY',
        externalOrderNumber: 'SHOPIFY-#1002',
        externalDraftOrderId: 'gid://shopify/DraftOrder/888888',
        externalCheckoutUrl: 'https://velion-dev.myshopify.com/checkouts/cn/test-order-token',
        externalSyncStatus: 'CREATED',
        items: {
          create: [
            {
              name: 'Gorra Urbana Shopify',
              quantity: 1,
              price: 240.0,
              variant: 'Negro',
              sourceProvider: 'SHOPIFY',
              sourceSku: 'CAP-URB-BLK',
            },
          ],
        },
      },
      include: { items: true },
    });

    // Orden B1: Perteneciente a Tenant B
    orderB1 = await prisma.order.create({
      data: {
        tenantId: tenantB.id,
        customerId: customerB.id,
        status: 'PENDING',
        totalAmount: 50.0,
        currencyCode: 'USD',
        externalProvider: 'SHOPIFY',
        externalOrderNumber: 'SHOPIFY-#9999',
        items: {
          create: [
            {
              name: 'Producto Tenant B',
              quantity: 1,
              price: 50.0,
            },
          ],
        },
      },
      include: { items: true },
    });

    console.log('--- TEST 1: Listado de órdenes y aislamiento multi-tenant ---');

    // Tenant A solicita sus órdenes
    const reqA = { user: { tenantId: tenantA.id }, query: {} };
    const resA = mockRes();
    await getOrders(reqA, resA);

    assert(resA.statusCode === 200, 'getOrders retorna status 200');
    assert(Array.isArray(resA.body.items), 'getOrders retorna array items');
    assert(resA.body.items.length === 2, 'Tenant A ve exactamente sus 2 órdenes');
    assert(
      !resA.body.items.some((o) => o.id === orderB1.id),
      'Aislamiento estricto: Tenant A NO ve la orden de Tenant B'
    );
    assert(resA.body.pagination.total === 2, 'Paginación total es 2 para Tenant A');

    // Tenant B solicita sus órdenes
    const reqB = { user: { tenantId: tenantB.id }, query: {} };
    const resB = mockRes();
    await getOrders(reqB, resB);

    assert(resB.body.items.length === 1, 'Tenant B ve exactamente su 1 orden');
    assert(resB.body.items[0].id === orderB1.id, 'Tenant B ve orden orderB1');
    assert(
      !resB.body.items.some((o) => o.id === orderA1.id || o.id === orderA2.id),
      'Aislamiento estricto: Tenant B NO ve órdenes de Tenant A'
    );

    console.log('\n--- TEST 2: Paginación, filtros y búsqueda ---');

    // Paginación: limit=1
    const reqPage = { user: { tenantId: tenantA.id }, query: { page: '1', limit: '1' } };
    const resPage = mockRes();
    await getOrders(reqPage, resPage);
    assert(resPage.body.items.length === 1, 'Paginación: respeta limit=1');
    assert(resPage.body.pagination.pages === 2, 'Paginación: total páginas calculadas = 2');

    // Filtro por externalProvider = 'SHOPIFY'
    const reqShopifyOnly = { user: { tenantId: tenantA.id }, query: { externalProvider: 'SHOPIFY' } };
    const resShopifyOnly = mockRes();
    await getOrders(reqShopifyOnly, resShopifyOnly);
    assert(resShopifyOnly.body.items.length === 1, 'Filtro externalProvider=SHOPIFY retorna 1 orden');
    assert(resShopifyOnly.body.items[0].id === orderA2.id, 'Filtro externalProvider=SHOPIFY retorna orderA2');

    // Filtro por externalProvider = 'VELION'
    const reqVelionOnly = { user: { tenantId: tenantA.id }, query: { externalProvider: 'VELION' } };
    const resVelionOnly = mockRes();
    await getOrders(reqVelionOnly, resVelionOnly);
    assert(resVelionOnly.body.items.length === 1, 'Filtro externalProvider=VELION retorna 1 orden');
    assert(resVelionOnly.body.items[0].id === orderA1.id, 'Filtro externalProvider=VELION retorna orderA1');

    // Filtro por status = 'CONFIRMED'
    const reqConfirmed = { user: { tenantId: tenantA.id }, query: { status: 'CONFIRMED' } };
    const resConfirmed = mockRes();
    await getOrders(reqConfirmed, resConfirmed);
    assert(resConfirmed.body.items.length === 1, 'Filtro status=CONFIRMED retorna 1 orden');
    assert(resConfirmed.body.items[0].id === orderA1.id, 'Filtro status retorna orderA1');

    // Búsqueda por nombre de cliente
    const reqSearch = { user: { tenantId: tenantA.id }, query: { search: 'Carlos' } };
    const resSearch = mockRes();
    await getOrders(reqSearch, resSearch);
    assert(resSearch.body.items.length === 2, 'Búsqueda por nombre cliente encuentra 2 órdenes de Carlos');

    console.log('\n--- TEST 3: Detalle de orden y bloqueo cruzado (Cross-Tenant) ---');

    // Tenant A consulta el detalle de su propia orden A2
    const reqDetailA = { user: { tenantId: tenantA.id }, params: { id: orderA2.id } };
    const resDetailA = mockRes();
    await getOrderById(reqDetailA, resDetailA);

    assert(resDetailA.statusCode === 200, 'Detalle de orden propia retorna 200');
    assert(resDetailA.body.id === orderA2.id, 'Detalle tiene ID correcto');
    assert(resDetailA.body.customer.name === 'Carlos Cliente A', 'Detalle incluye datos del cliente');
    assert(resDetailA.body.items.length === 1, 'Detalle incluye items de la orden');
    assert(resDetailA.body.items[0].sourceSku === 'CAP-URB-BLK', 'Detalle incluye sourceSku del item');
    assert(resDetailA.body.externalCheckoutUrl.includes('myshopify.com'), 'Detalle incluye externalCheckoutUrl');

    // Tenant A intenta consultar la orden de Tenant B -> DEBE RETORNAR 404
    const reqCrossTenant = { user: { tenantId: tenantA.id }, params: { id: orderB1.id } };
    const resCrossTenant = mockRes();
    await getOrderById(reqCrossTenant, resCrossTenant);

    assert(resCrossTenant.statusCode === 404, 'Seguridad: consulta cross-tenant rechazada con 404');

    console.log('\n--- TEST 4: Configuración de Shopify (PATCH /settings) ---');

    // Caso A: Sin integración conectada -> Rechaza con 400
    const reqNoShopify = {
      user: { tenantId: tenantA.id },
      body: { catalogMode: 'COMBINED' },
    };
    const resNoShopify = mockRes();
    await updateShopifySettings(reqNoShopify, resNoShopify);

    assert(resNoShopify.statusCode === 400, 'Sin Shopify conectado retorna 400');
    assert(resNoShopify.body.code === 'SHOPIFY_NOT_CONNECTED', 'Código de error es SHOPIFY_NOT_CONNECTED');

    // Crear integración conectada para Tenant A
    integrationA = await prisma.integration.create({
      data: {
        tenantId: tenantA.id,
        provider: 'SHOPIFY',
        status: 'CONNECTED',
        shopDomain: 'test-tienda.myshopify.com',
        catalogMode: 'VELION_ONLY',
        priceSource: 'VELION',
        stockSource: 'VELION',
      },
    });

    // Caso B: Enum inválido en catalogMode -> Rechaza con 400
    const reqInvalidCatalog = {
      user: { tenantId: tenantA.id },
      body: { catalogMode: 'INVALID_SUPER_MODE' },
    };
    const resInvalidCatalog = mockRes();
    await updateShopifySettings(reqInvalidCatalog, resInvalidCatalog);

    assert(resInvalidCatalog.statusCode === 400, 'Enum catalogMode inválido retorna 400');
    assert(resInvalidCatalog.body.code === 'INVALID_CATALOG_MODE', 'Código es INVALID_CATALOG_MODE');

    // Caso C: Enum inválido en priceSource -> Rechaza con 400
    const reqInvalidPrice = {
      user: { tenantId: tenantA.id },
      body: { priceSource: 'AMAZON' },
    };
    const resInvalidPrice = mockRes();
    await updateShopifySettings(reqInvalidPrice, resInvalidPrice);

    assert(resInvalidPrice.statusCode === 400, 'Enum priceSource inválido retorna 400');
    assert(resInvalidPrice.body.code === 'INVALID_PRICE_SOURCE', 'Código es INVALID_PRICE_SOURCE');

    // Caso D: Actualización válida con whitelist
    const reqValidUpdate = {
      user: { tenantId: tenantA.id },
      body: {
        catalogMode: 'COMBINED',
        priceSource: 'SHOPIFY',
        stockSource: 'VELION',
        // Inyección maliciosa simulada:
        shopDomain: 'hacked.myshopify.com',
        tenantId: tenantB.id,
        accessToken: 'stolen_token',
      },
    };
    const resValidUpdate = mockRes();
    await updateShopifySettings(reqValidUpdate, resValidUpdate);

    assert(resValidUpdate.statusCode === 200, 'Actualización válida retorna 200');
    assert(resValidUpdate.body.settings.catalogMode === 'COMBINED', 'catalogMode actualizado a COMBINED');
    assert(resValidUpdate.body.settings.priceSource === 'SHOPIFY', 'priceSource actualizado a SHOPIFY');
    assert(resValidUpdate.body.settings.stockSource === 'VELION', 'stockSource actualizado a VELION');

    // Verificar en base de datos que campos maliciosos NO se alteraron
    const dbIntegration = await prisma.integration.findUnique({
      where: { id: integrationA.id },
    });
    assert(dbIntegration.shopDomain === 'test-tienda.myshopify.com', 'shopDomain NO fue alterado por el body');
    assert(dbIntegration.tenantId === tenantA.id, 'tenantId NO fue alterado por el body');

    console.log('\n--- TEST 5: Cero exposición de secretos o credenciales ---');

    const jsonOrderA2 = JSON.stringify(resDetailA.body);
    assert(!jsonOrderA2.includes('clientSecret'), 'Respuesta de orden no contiene clientSecret');
    assert(!jsonOrderA2.includes('accessToken'), 'Respuesta de orden no contiene accessToken');
    assert(!jsonOrderA2.includes('password'), 'Respuesta de orden no contiene password');

    const jsonSettings = JSON.stringify(resValidUpdate.body);
    assert(!jsonSettings.includes('clientSecret'), 'Respuesta de settings no contiene clientSecret');
    assert(!jsonSettings.includes('accessToken'), 'Respuesta de settings no contiene accessToken');

    console.log('\n======================================================================');
    console.log(`🎉 SUITE ORDERS & INTEGRATIONS API PASS: ${passedTests}/${totalTests} pruebas exitosas.`);
    console.log('======================================================================\n');
  } finally {
    // Limpieza
    if (orderA1?.id) await prisma.orderItem.deleteMany({ where: { orderId: orderA1.id } });
    if (orderA2?.id) await prisma.orderItem.deleteMany({ where: { orderId: orderA2.id } });
    if (orderB1?.id) await prisma.orderItem.deleteMany({ where: { orderId: orderB1.id } });

    if (orderA1?.id) await prisma.order.deleteMany({ where: { id: orderA1.id } });
    if (orderA2?.id) await prisma.order.deleteMany({ where: { id: orderA2.id } });
    if (orderB1?.id) await prisma.order.deleteMany({ where: { id: orderB1.id } });

    if (integrationA?.id) await prisma.integration.deleteMany({ where: { id: integrationA.id } });

    if (customerA?.id) await prisma.customer.deleteMany({ where: { id: customerA.id } });
    if (customerB?.id) await prisma.customer.deleteMany({ where: { id: customerB.id } });

    if (tenantA?.id) await prisma.tenant.deleteMany({ where: { id: tenantA.id } });
    if (tenantB?.id) await prisma.tenant.deleteMany({ where: { id: tenantB.id } });

    await prisma.$disconnect();
  }
}

runSuite().catch((err) => {
  console.error('💥 Error inesperado en suite de pruebas:', err);
  process.exit(1);
});
