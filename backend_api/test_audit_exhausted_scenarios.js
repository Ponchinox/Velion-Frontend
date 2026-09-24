/**
 * test_audit_exhausted_scenarios.js
 * ===================================
 * AUDITORÍA TÉCNICA Y EMPÍRICA COMPLETA:
 * Comportamiento de la IA ante productos agotados (stock = 0 / isAvailable = false).
 * 
 * Escenarios a auditar:
 * CASO 1: Producto existe + stock > 0 (Snowboard Pro 100, isAvailable: true) -> "¿Tienen el Snowboard Pro 100?"
 * CASO 2: Producto existe + stock = 0 (Snowboard X Agotado, isAvailable: false) -> "¿Tienen el Snowboard X Agotado?"
 * CASO 3: Producto existe + stock = 0 (Snowboard X Agotado, isAvailable: false) -> "Quiero comprar el Snowboard X Agotado"
 * CASO 4: Producto inexistente (Snowboard Inexistente Y) -> "¿Tienen el Snowboard Inexistente Y?"
 * CASO 5: Producto Shopify con inventoryTracked = false (Snowboard Unlimited, availableForSale: true, inventoryQuantity: null) -> "¿Tienen el Snowboard Unlimited?"
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';
import { CommerceService } from './src/services/commerce/CommerceService.js';
import VelionNativeProvider from './src/services/commerce/VelionNativeProvider.js';
import ShopifyCachedProvider from './src/services/commerce/ShopifyCachedProvider.js';
import { syncCommercialOrder } from './src/services/orderCommercialService.js';

dotenv.config();

const groqClient = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1'
});
const LLM_MODEL = 'qwen/qwen3.8-27b';

// ── 1. MOCK DATABASE MULTI-TENANT CON TODOS LOS ESCENARIOS ──
const tenantId = 'dfe020e6-5e08-404c-9b89-ef3f08f2b150';

const mockNativeProducts = [
  {
    id: 'prod-1-in-stock',
    tenantId,
    name: 'Snowboard Pro 100',
    description: 'Snowboard profesional para alta montaña con fijaciones de aluminio.',
    price: 350.00,
    promotionalPrice: null,
    promoStartDate: null,
    promoEndDate: null,
    category: 'Deportes de Invierno',
    type: 'PHYSICAL_PRODUCT',
    tags: ['snowboard', 'invierno', 'nieve'],
    isAvailable: true,
    sku: 'SNOW-PRO-100',
    normalizedSku: 'SNOWPRO100',
    imageUrl: 'https://example.com/snow1.jpg',
    images: ['https://example.com/snow1.jpg'],
    videoUrl: null
  },
  {
    id: 'prod-2-out-of-stock',
    tenantId,
    name: 'Snowboard X Agotado',
    description: 'Snowboard edición especial carbono. Agotado en almacén temporalmente.',
    price: 499.00,
    promotionalPrice: null,
    promoStartDate: null,
    promoEndDate: null,
    category: 'Deportes de Invierno',
    type: 'PHYSICAL_PRODUCT',
    tags: ['snowboard', 'carbono'],
    isAvailable: false, // <<-- AGOTADO
    sku: 'SNOW-X-AGOTADO',
    normalizedSku: 'SNOWXAGOTADO',
    imageUrl: 'https://example.com/snowx.jpg',
    images: ['https://example.com/snowx.jpg'],
    videoUrl: null
  }
];

const mockExternalProducts = [
  {
    id: 'ext-prod-shopify-untracked',
    tenantId,
    provider: 'SHOPIFY',
    externalId: 'gid://shopify/Product/999111',
    title: 'Snowboard Unlimited Shopify',
    description: 'Snowboard fabricado bajo demanda en Shopify sin control de inventario.',
    category: 'Deportes de Invierno',
    tags: ['shopify', 'untracked'],
    imageUrl: 'https://example.com/snow_shopify.jpg',
    images: ['https://example.com/snow_shopify.jpg'],
    isAvailable: true // status ACTIVE + availableForSale true
  },
  {
    id: 'ext-prod-shopify-exhausted',
    tenantId,
    provider: 'SHOPIFY',
    externalId: 'gid://shopify/Product/999222',
    title: 'Snowboard Shopify Agotado',
    description: 'Snowboard Shopify con stock 0 y venta detenida.',
    category: 'Deportes de Invierno',
    tags: ['shopify', 'exhausted'],
    imageUrl: 'https://example.com/snow_shopify_out.jpg',
    images: ['https://example.com/snow_shopify_out.jpg'],
    isAvailable: false // stock 0 y deny
  }
];

const mockExternalVariants = [
  {
    id: 'var-shopify-untracked-1',
    tenantId,
    externalProductId: 'ext-prod-shopify-untracked',
    provider: 'SHOPIFY',
    externalVariantId: 'gid://shopify/ProductVariant/888111',
    inventoryItemId: 'gid://shopify/InventoryItem/777111',
    sku: 'SNOW-UNTRACKED',
    normalizedSku: 'SNOWUNTRACKED',
    title: 'Default Title',
    price: 299.00,
    compareAtPrice: null,
    inventoryQuantity: null, // Untracked
    availableForSale: true,  // Puede venderse
    syncedAt: new Date()
  },
  {
    id: 'var-shopify-exhausted-1',
    tenantId,
    externalProductId: 'ext-prod-shopify-exhausted',
    provider: 'SHOPIFY',
    externalVariantId: 'gid://shopify/ProductVariant/888222',
    inventoryItemId: 'gid://shopify/InventoryItem/777222',
    sku: 'SNOW-SHOPIFY-OUT',
    normalizedSku: 'SNOWSHOPIFYOUT',
    title: 'Default Title',
    price: 399.00,
    compareAtPrice: null,
    inventoryQuantity: 0,   // stock 0
    availableForSale: false, // NO disponible para venta
    syncedAt: new Date()
  }
];

const mockIntegration = {
  id: 'integ-1',
  tenantId,
  provider: 'SHOPIFY',
  status: 'CONNECTED',
  shopDomain: 'velion-dev.myshopify.com',
  catalogMode: 'COMBINED',
  priceSource: 'SHOPIFY',
  stockSource: 'SHOPIFY',
  externalOrderMode: 'SHOPIFY_DRAFT_ORDER',
  shopCurrencyCode: 'USD'
};

const mockCustomer = {
  id: 'cust-1',
  tenantId,
  phone: '51999888777',
  name: 'Juan Perez',
  commercialState: {}
};

const createdOrders = [];

function createPrismaMock() {
  return {
    tenant: {
      findUnique: async () => ({
        id: tenantId,
        name: 'Velion Sports',
        businessSector: 'Deportes y Nieve',
        currencyCode: 'PEN',
        bankAccounts: 'BCP: 191-12345678-0-01 (Cuenta Corriente Soles)',
        termsAndPolicies: 'Envíos a todo el Perú vía Shalom y Olva Courier.'
      })
    },
    integration: {
      findFirst: async ({ where }) => {
        if (where.tenantId === tenantId && where.provider === 'SHOPIFY') {
          return mockIntegration;
        }
        return null;
      }
    },
    product: {
      findFirst: async ({ where }) => {
        return mockNativeProducts.find(p => {
          if (where.id && p.id !== where.id) return false;
          if (where.user?.tenantId && p.tenantId !== where.user.tenantId) return false;
          return true;
        }) || null;
      },
      findMany: async ({ where }) => {
        return mockNativeProducts.filter(p => {
          if (where.user?.tenantId && p.tenantId !== where.user.tenantId) return false;
          if (where.isAvailable !== undefined && p.isAvailable !== where.isAvailable) return false;
          return true;
        });
      },
      count: async () => mockNativeProducts.length
    },
    externalProductVariant: {
      findFirst: async ({ where }) => {
        return mockExternalVariants.map(v => ({
          ...v,
          externalProduct: mockExternalProducts.find(ep => ep.id === v.externalProductId)
        })).find(v => {
          if (where.id && v.id !== where.id) return false;
          if (where.tenantId && v.tenantId !== where.tenantId) return false;
          if (where.provider && v.provider !== where.provider) return false;
          return true;
        }) || null;
      },
      findMany: async ({ where }) => {
        return mockExternalVariants.map(v => ({
          ...v,
          externalProduct: mockExternalProducts.find(ep => ep.id === v.externalProductId)
        })).filter(v => {
          if (where.tenantId && v.tenantId !== where.tenantId) return false;
          if (where.provider && v.provider !== where.provider) return false;
          if (where.availableForSale !== undefined && v.availableForSale !== where.availableForSale) return false;
          if (where.externalProduct?.isAvailable !== undefined && v.externalProduct?.isAvailable !== where.externalProduct.isAvailable) return false;
          return true;
        });
      },
      findUnique: async ({ where }) => {
        return mockExternalVariants.find(v => v.id === where.id) || null;
      }
    },
    externalProduct: {
      findFirst: async ({ where }) => mockExternalProducts.find(ep => ep.id === where.id) || null
    },
    customer: {
      findUnique: async () => mockCustomer,
      update: async ({ data }) => {
        Object.assign(mockCustomer, data);
        return mockCustomer;
      }
    },
    order: {
      create: async ({ data }) => {
        const orderId = `ord-${Date.now()}-${Math.floor(Math.random()*1000)}`;
        const rec = { id: orderId, ...data };
        createdOrders.push(rec);
        return rec;
      },
      findFirst: async ({ where }) => createdOrders.find(o => o.id === where.id) || null,
      update: async ({ where, data }) => {
        const o = createdOrders.find(x => x.id === where.id);
        if (o) Object.assign(o, data);
        return o;
      }
    },
    alert: {
      create: async ({ data }) => ({ id: 'alert-1', ...data })
    },
    $transaction: async (cb) => cb(createPrismaMock())
  };
}

async function runAudit() {
  console.log('========================================================================');
  console.log('🔍 AUDITORÍA DE PRODUCTOS AGOTADOS: TRAZABILIDAD Y PRUEBAS REALES');
  console.log('========================================================================\n');

  const mockDb = createPrismaMock();
  const nativeProvider = new VelionNativeProvider(mockDb);
  const shopifyProvider = new ShopifyCachedProvider(mockDb);
  const commerceService = new CommerceService(mockDb, {
    nativeProvider,
    shopifyCachedProvider: shopifyProvider
  });

  // 1. EVALUAR QUÉ PRODUCTOS APARECEN EN EL CATÁLOGO COMPACTO CSV
  console.log('------------------------------------------------------------------------');
  console.log('1. GENERACIÓN DEL CSV COMPACTO (getCompactCatalogCsv / <catalog_index>)');
  console.log('------------------------------------------------------------------------');
  
  const csvVelionOnly = await commerceService.getCompactCatalogCsv(tenantId, { catalogMode: 'VELION_ONLY' });
  console.log('📌 CSV Catálogo VELION_ONLY:');
  console.log(csvVelionOnly.trim());

  const csvShopifyOnly = await commerceService.getCompactCatalogCsv(tenantId, { catalogMode: 'SHOPIFY_ONLY' });
  console.log('\n📌 CSV Catálogo SHOPIFY_ONLY:');
  console.log(csvShopifyOnly.trim());

  const csvCombined = await commerceService.getCompactCatalogCsv(tenantId, { catalogMode: 'COMBINED' });
  console.log('\n📌 CSV Catálogo COMBINED:');
  console.log(csvCombined.trim());

  // 2. EVALUAR BÚSQUEDA DE PRODUCTOS (searchProducts)
  console.log('\n------------------------------------------------------------------------');
  console.log('2. EVALUAR BÚSQUEDA DE PRODUCTOS (searchProducts)');
  console.log('------------------------------------------------------------------------');
  const allNative = await nativeProvider.searchProducts(tenantId, {});
  const availableNative = await nativeProvider.searchProducts(tenantId, { isAvailable: true });
  console.log(`Native searchProducts (sin filtro isAvailable): ${allNative.length} items`);
  allNative.forEach(p => console.log(`   - [${p.id}] ${p.name} | isAvailable: ${p.isAvailable}`));
  console.log(`Native searchProducts (con { isAvailable: true }): ${availableNative.length} items`);
  availableNative.forEach(p => console.log(`   - [${p.id}] ${p.name} | isAvailable: ${p.isAvailable}`));

  const allShopify = await shopifyProvider.searchProducts(tenantId, {});
  const availableShopify = await shopifyProvider.searchProducts(tenantId, { isAvailable: true });
  console.log(`Shopify searchProducts (sin filtro isAvailable): ${allShopify.length} items`);
  allShopify.forEach(p => console.log(`   - [${p.id}] ${p.name} | isAvailable: ${p.isAvailable}`));
  console.log(`Shopify searchProducts (con { isAvailable: true }): ${availableShopify.length} items`);
  availableShopify.forEach(p => console.log(`   - [${p.id}] ${p.name} | isAvailable: ${p.isAvailable}`));

  // 3. EVALUAR getProduct Y getStock DE PRODUCTOS AGOTADOS
  console.log('\n------------------------------------------------------------------------');
  console.log('3. CONSULTA DIRECTA DE PRODUCTOS AGOTADOS (getProduct / getStock)');
  console.log('------------------------------------------------------------------------');
  const exhaustedNative = await commerceService.getProduct(tenantId, 'prod-2-out-of-stock');
  console.log('Native Agotado getProduct:', {
    id: exhaustedNative?.id,
    name: exhaustedNative?.name,
    isAvailable: exhaustedNative?.isAvailable,
    price: exhaustedNative?.price
  });

  const exhaustedShopify = await commerceService.getProduct(tenantId, 'shopify:var-shopify-exhausted-1');
  console.log('Shopify Agotado getProduct:', {
    id: exhaustedShopify?.id,
    name: exhaustedShopify?.name,
    isAvailable: exhaustedShopify?.isAvailable,
    inventoryQuantity: exhaustedShopify?.inventoryQuantity,
    availableForSale: exhaustedShopify?.availableForSale
  });

  const stockShopifyExhausted = await shopifyProvider.getStock(tenantId, 'shopify:var-shopify-exhausted-1');
  console.log('Shopify Agotado getStock:', stockShopifyExhausted);

  const stockShopifyUntracked = await shopifyProvider.getStock(tenantId, 'shopify:var-shopify-untracked-1');
  console.log('Shopify Untracked getStock:', stockShopifyUntracked);

  // 4. EJECUTAR PRUEBAS DE LLM CON EL SYSTEM PROMPT REAL PARA LOS 5 ESCENARIOS
  console.log('\n------------------------------------------------------------------------');
  console.log('4. RESPUESTA REAL DEL MODELO DE IA ANTE CADA ESCENARIO');
  console.log('------------------------------------------------------------------------');

  // Construir System Prompt idéntico al de whatsappController.js
  const systemPromptTemplate = (csvCatalog) => `
[ROL DEL AGENTE EMPRESARIAL - ASISTENTE INTEGRAL DEL NEGOCIO]
Eres el asistente integral de Velion Sports. Tu función es atender a los clientes con amabilidad y honestidad.

[ANTI-ALUCINACIÓN - CRÍTICO]
La tienda/empresa es la ÚNICA fuente de verdad para productos, precios, stock, promociones y características comerciales.
- Si un producto no existe en el catálogo: NO lo inventes. Indícalo claramente y ofrece alternativas de la misma familia si corresponde.
- Si no conoces el precio exacto: NO lo inventes.
- Si no conoces el stock: NO lo inventes.

[INVENTARIO Y STOCK CANÓNICO]
El catálogo opera exclusivamente por estado de disponibilidad (Disponible: Sí/No). El sistema únicamente autoriza afirmar disponibilidad o cantidades que estén presentes explícitamente en la fuente canónica. PROHIBIDO inventar cantidades numéricas exactas de stock restante, escasez ni niveles de inventario. Si el cliente pregunta por stock o cantidades específicas, indica si el producto figura disponible y aclara que las unidades exactas en almacén deben confirmarse directamente con el negocio.

<catalog_index>
[ATENCION: LOS DATOS A CONTINUACION SON EL INDICE DE PRODUCTOS Y SERVICIOS DISPONIBLES. NO INVENTES PRODUCTOS QUE NO ESTEN AQUI. SI EL CLIENTE PIDE FOTOS O IMAGENES, USA send_product_media. SI NECESITAS MAS DETALLES, USA get_product_details]
${csvCatalog}
</catalog_index>

INFORMACIÓN DE LA EMPRESA: Velion Sports, sector: Deportes y Nieve.
- Cuentas bancarias y métodos de pago autorizados: BCP: 191-12345678-0-01 (Cuenta Corriente Soles).
- Políticas de envío: Envíos a todo el Perú vía Shalom y Olva Courier.

[FORMATO Y NATURALIDAD - OBLIGATORIO]
- EXTREMADAMENTE conciso (párrafos de 1 a 3 líneas).
- Negritas: un solo asterisco *texto*.
- MONEDA: Usa siempre "S/.".
`.trim();

  const realPrompt = systemPromptTemplate(csvCombined);

  async function queryAi(userText) {
    const res = await groqClient.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: realPrompt },
        { role: 'user', content: userText }
      ],
      temperature: 0.1
    });
    return res.choices[0].message.content.trim();
  }

  // CASO 1: Producto existe + stock > 0
  console.log('\n🟢 CASO 1: Producto existe + stock > 0');
  console.log('Cliente: "¿Tienen el Snowboard Pro 100?"');
  const res1 = await queryAi('¿Tienen el Snowboard Pro 100?');
  console.log('IA Respuesta:\n', res1);

  // CASO 2: Producto existe + stock = 0
  console.log('\n🔴 CASO 2: Producto existe pero stock = 0 (isAvailable = false)');
  console.log('Cliente: "¿Tienen el Snowboard X Agotado?"');
  const res2 = await queryAi('¿Tienen el Snowboard X Agotado?');
  console.log('IA Respuesta:\n', res2);

  // CASO 3: Producto existe + stock = 0 intentando compra
  console.log('\n🔴 CASO 3: Producto existe + stock = 0 intentando compra');
  console.log('Cliente: "Quiero comprar el Snowboard X Agotado"');
  const res3 = await queryAi('Quiero comprar el Snowboard X Agotado');
  console.log('IA Respuesta:\n', res3);

  // CASO 4: Producto inexistente
  console.log('\n⚪ CASO 4: Producto inexistente');
  console.log('Cliente: "¿Tienen el Snowboard Fantasma 9000?"');
  const res4 = await queryAi('¿Tienen el Snowboard Fantasma 9000?');
  console.log('IA Respuesta:\n', res4);

  // CASO 5: Producto Shopify con inventoryTracked = false
  console.log('\n🔵 CASO 5: Producto Shopify con inventario no rastreado (untracked)');
  console.log('Cliente: "¿Tienen el Snowboard Unlimited Shopify?"');
  const res5 = await queryAi('¿Tienen el Snowboard Unlimited Shopify?');
  console.log('IA Respuesta:\n', res5);

  // 5. EVALUAR VALIDACIÓN DE COMPRA EN BACKEND (orderCommercialService.syncCommercialOrder)
  console.log('\n------------------------------------------------------------------------');
  console.log('5. EVALUAR VALIDACIÓN DE COMPRA EN BACKEND (syncCommercialOrder)');
  console.log('------------------------------------------------------------------------');
  console.log('Simulando intento de compra directa para el producto agotado "prod-2-out-of-stock" en syncCommercialOrder...');

  const orderAttemptRes = await syncCommercialOrder({
    tenant: {
      id: tenantId,
      name: 'Velion Sports',
      bankAccounts: 'BCP: 191-12345678-0-01'
    },
    customer: mockCustomer,
    clientNumber: '51999888777',
    currentCommercialState: {
      productId: 'prod-2-out-of-stock',
      productName: 'Snowboard X Agotado'
    },
    args: {
      currentStage: 'PAYMENT_PENDING',
      productId: 'prod-2-out-of-stock',
      productName: 'Snowboard X Agotado',
      quantity: 1,
      customerConfirmed: true,
      shippingCity: 'Lima',
      paymentMethod: 'BCP'
    },
    prismaClient: mockDb
  });

  console.log('Resultado de syncCommercialOrder para producto agotado:');
  console.log('   - Error retornado:', orderAttemptRes.error || 'NINGUNO (¡Permitió la orden!)');
  console.log('   - activeOrderId generado:', orderAttemptRes.state?.activeOrderId || 'No creado');
  console.log('   - Órdenes creadas en BD:', createdOrders.length);
  if (createdOrders.length > 0) {
    console.log('   - Detalle de la orden creada:', {
      id: createdOrders[0].id,
      totalAmount: createdOrders[0].totalAmount,
      status: createdOrders[0].status,
      items: createdOrders[0].items
    });
  }

  // 6. QUÉ PASA SI SE LLAMA get_product_details PARA UN PRODUCTO AGOTADO
  console.log('\n------------------------------------------------------------------------');
  console.log('6. QUÉ RECIBIRÍA LA IA SI LLAMARA A get_product_details DE UN PRODUCTO AGOTADO');
  console.log('------------------------------------------------------------------------');
  const detailsItem = await commerceService.getProduct(tenantId, 'prod-2-out-of-stock');
  const simulatedDetailsResult = `
Nombre: ${detailsItem.name}
Tipo: ${detailsItem.type === 'SERVICE' ? 'SERVICE (Servicio / Programa)' : 'PHYSICAL_PRODUCT (Producto Físico)'}
Precio: S/. ${detailsItem.price.toFixed(2)}
Categoría: ${detailsItem.category || 'N/A'}
Disponible: ${detailsItem.isAvailable ? 'Sí' : 'No'}
Fotos disponibles: 1
Video: No
Descripción Completa: ${detailsItem.description || 'Sin descripción adicional'}
Atributos/Tags: ${Array.isArray(detailsItem.tags) ? detailsItem.tags.join(', ') : ''}
`.trim();
  console.log(simulatedDetailsResult);
}

runAudit().catch(console.error);
