/**
 * test_exhausted_products_verification.js
 * ==================================================
 * PRUEBAS OBLIGATORIAS: CORRECCIÓN DE PRODUCTOS AGOTADOS
 * 
 * CASO A: Producto existe + disponible -> IA reconoce producto y permite flujo.
 * CASO B: Producto existe + agotado -> IA reconoce que existe pero dice agotado.
 * CASO C: Producto inexistente -> IA dice que no existe/no se encontró.
 * CASO D: Producto agotado + intento directo de crear orden -> PRODUCT_OUT_OF_STOCK, 0 órdenes creadas.
 * CASO E: Producto seleccionado con stock, luego se agota antes de confirmar -> PRODUCT_OUT_OF_STOCK, 0 órdenes creadas.
 * CASO F: Shopify inventoryTracked=false + availableForSale=true -> Disponible (Sí).
 * CASO G: Producto Shopify stock 0 -> IA dice agotado y backend impide pedido (PRODUCT_OUT_OF_STOCK, 0 órdenes creadas).
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

const tenantId = 'dfe020e6-5e08-404c-9b89-ef3f08f2b150';

function getInitialMockState() {
  const nativeProducts = [
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
      description: 'Snowboard edición especial carbono. Agotado en almacén.',
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

  const externalProducts = [
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
      isAvailable: true
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
      isAvailable: false
    }
  ];

  const externalVariants = [
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
      availableForSale: true,  // Disponible
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
      availableForSale: false, // Agotado
      syncedAt: new Date()
    }
  ];

  const integration = {
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

  const customer = {
    id: 'cust-test-1',
    tenantId,
    phone: '51999888777',
    name: 'Juan Perez',
    commercialState: {}
  };

  const orders = [];

  return { nativeProducts, externalProducts, externalVariants, integration, customer, orders };
}

function createPrismaMock(state) {
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
          return state.integration;
        }
        return null;
      }
    },
    product: {
      findFirst: async ({ where }) => {
        return state.nativeProducts.find(p => {
          if (where.id && p.id !== where.id) return false;
          if (where.user?.tenantId && p.tenantId !== where.user.tenantId) return false;
          return true;
        }) || null;
      },
      findMany: async ({ where }) => {
        return state.nativeProducts.filter(p => {
          if (where.user?.tenantId && p.tenantId !== where.user.tenantId) return false;
          if (where.isAvailable !== undefined && p.isAvailable !== where.isAvailable) return false;
          return true;
        });
      },
      count: async () => state.nativeProducts.length
    },
    externalProductVariant: {
      findFirst: async ({ where }) => {
        return state.externalVariants.map(v => ({
          ...v,
          externalProduct: state.externalProducts.find(ep => ep.id === v.externalProductId)
        })).find(v => {
          if (where.id && v.id !== where.id) return false;
          if (where.tenantId && v.tenantId !== where.tenantId) return false;
          if (where.provider && v.provider !== where.provider) return false;
          return true;
        }) || null;
      },
      findMany: async ({ where }) => {
        return state.externalVariants.map(v => ({
          ...v,
          externalProduct: state.externalProducts.find(ep => ep.id === v.externalProductId)
        })).filter(v => {
          if (where.tenantId && v.tenantId !== where.tenantId) return false;
          if (where.provider && v.provider !== where.provider) return false;
          if (where.availableForSale !== undefined && v.availableForSale !== where.availableForSale) return false;
          if (where.externalProduct?.isAvailable !== undefined && v.externalProduct?.isAvailable !== where.externalProduct.isAvailable) return false;
          return true;
        });
      },
      findUnique: async ({ where }) => {
        return state.externalVariants.map(v => ({
          ...v,
          externalProduct: state.externalProducts.find(ep => ep.id === v.externalProductId)
        })).find(v => v.id === where.id) || null;
      }
    },
    externalProduct: {
      findFirst: async ({ where }) => state.externalProducts.find(ep => ep.id === where.id) || null
    },
    customer: {
      findUnique: async () => state.customer,
      update: async ({ data }) => {
        Object.assign(state.customer, data);
        return state.customer;
      }
    },
    order: {
      create: async ({ data }) => {
        const orderId = `ord-${Date.now()}-${Math.floor(Math.random()*1000)}`;
        const rec = { id: orderId, ...data };
        state.orders.push(rec);
        return rec;
      },
      findFirst: async ({ where }) => state.orders.find(o => o.id === where.id) || null,
      update: async ({ where, data }) => {
        const o = state.orders.find(x => x.id === where.id);
        if (o) Object.assign(o, data);
        return o;
      }
    },
    alert: {
      create: async ({ data }) => ({ id: 'alert-1', ...data })
    },
    $transaction: async (cb) => cb(createPrismaMock(state))
  };
}

function buildSystemPrompt(csvCatalog) {
  return `
[ROL DEL AGENTE EMPRESARIAL - ASISTENTE INTEGRAL DEL NEGOCIO]
Eres el asistente integral de Velion Sports. Tu función es atender a los clientes con amabilidad y honestidad.

[ANTI-ALUCINACIÓN - CRÍTICO]
La tienda/empresa es la ÚNICA fuente de verdad para productos, precios, stock, promociones y características comerciales.
- Si un producto no existe en el catálogo: NO lo inventes. Indícalo claramente y ofrece alternativas de la misma familia si corresponde.
- Si un producto figura en el catálogo con Disponible='No': SÍ existe en la tienda pero está AGOTADO. PROHIBIDO decir que no existe o que no lo manejamos; explica con honestidad y amabilidad que sí forma parte de nuestro catálogo pero actualmente se encuentra agotado.
- Si no conoces el precio exacto: NO lo inventes. Usa get_product_details.
- Si no conoces el stock: NO lo inventes. Usa get_product_details.

[FIDELIDAD TÉCNICA Y POLÍTICAS - PROHIBIDO ALUCINAR]
- INVENTARIO Y STOCK CANÓNICO (PRODUCTOS DISPONIBLES VS AGOTADOS):
  * El catálogo opera por estado de disponibilidad (columna 'Disponible: Sí' o 'Disponible: No' en <catalog_index>).
  * PRODUCTO DISPONIBLE (Disponible: Sí): Confirma disponibilidad y precio.
  * PRODUCTO AGOTADO (Disponible: No): Si el cliente pregunta por él ("¿Tienen X?", "¿Está disponible X?", "¿Cuánto cuesta X?"), debes responder explicando que sí manejamos ese modelo, pero que actualmente se encuentra agotado/no disponible. NUNCA digas "no existe", "no lo tenemos en catálogo" o "no lo manejamos" si el producto figura en <catalog_index>.
  * INTENTO DE COMPRA DE PRODUCTO AGOTADO: Si el cliente dice "quiero comprar [Producto Agotado]" o similar, explícale con amabilidad que el producto está agotado y que no es posible procesar la compra en este momento. Ofrece alternativas disponibles de la misma categoría. ESTÁ TERMINANTEMENTE PROHIBIDO llamar a 'update_commercial_state' para adquirir un producto agotado.
  * PRODUCTO INEXISTENTE (No figura en <catalog_index>): Explica claramente que no contamos con ese producto en nuestro catálogo.
  * PROHIBIDO inventar cantidades numéricas exactas de stock restante, escasez ni niveles de inventario. Si el cliente pregunta por stock o cantidades específicas, indica si el producto figura disponible o agotado y aclara que las unidades exactas en almacén deben confirmarse directamente con el negocio.

<catalog_index>
[ATENCION: LOS DATOS A CONTINUACION SON EL INDICE COMPLETO DE PRODUCTOS Y SERVICIOS DE LA TIENDA.
- La columna 'Disponible' indica si el producto cuenta con stock actual para venta ('Sí') o si está agotado ('No').
- SI EL CLIENTE PREGUNTA POR UN PRODUCTO CON Disponible='No': Reconoce que sí forma parte de nuestro catálogo pero aclara amablemente que actualmente se encuentra AGOTADO o no disponible. NUNCA digas que no existe si figura en este índice.
- SI EL CLIENTE INTENTA COMPRAR UN PRODUCTO CON Disponible='No': Indícale amablemente que está agotado y que no es posible procesar la compra. Ofrece alternativas disponibles de la misma categoría. PROHIBIDO crear órdenes para productos agotados.
- SI UN PRODUCTO NO FIGURA EN ESTE ÍNDICE: Explica claramente que no contamos con ese producto en nuestro catálogo.]
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
}

async function queryAi(prompt, userText) {
  await new Promise(r => setTimeout(r, 2000));
  const res = await groqClient.chat.completions.create({
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: userText }
    ],
    temperature: 0.1,
    max_tokens: 150
  });
  return res.choices[0].message.content.trim();
}

async function runAllTests() {
  console.log('======================================================================');
  console.log('🧪 SUITE OBLIGATORIA: VERIFICACIÓN DE PRODUCTOS AGOTADOS (CASOS A - G)');
  console.log('======================================================================\n');

  let passedTests = 0;
  let failedTests = 0;

  const state = getInitialMockState();
  const mockDb = createPrismaMock(state);
  const nativeProvider = new VelionNativeProvider(mockDb);
  const shopifyProvider = new ShopifyCachedProvider(mockDb);
  const commerceService = new CommerceService(mockDb, {
    nativeProvider,
    shopifyCachedProvider: shopifyProvider
  });

  // Generar CSV Compacto en COMBINED
  const catalogCsv = await commerceService.getCompactCatalogCsv(tenantId, { catalogMode: 'COMBINED' });
  console.log('📄 CSV Compacto generado para la IA:');
  console.log(catalogCsv.trim());
  console.log('\n----------------------------------------------------------------------');

  const systemPrompt = buildSystemPrompt(catalogCsv);

  // -------------------------------------------------------------------------------------
  // CASO A: Producto existe + disponible
  // Expected: IA reconoce producto y permite flujo / confirma disponibilidad.
  // -------------------------------------------------------------------------------------
  console.log('\n--- [CASO A]: Producto existe + disponible ("Snowboard Pro 100") ---');
  try {
    const aiRespA = await queryAi(systemPrompt, '¿Tienen el Snowboard Pro 100?');
    console.log('IA:', aiRespA);

    const mentionsProduct = /snowboard pro 100/i.test(aiRespA);
    const mentionsAvailable = /disponible|tenemos|contamos/i.test(aiRespA);
    const doesNotSayExhausted = !/agotado|no disponible/i.test(aiRespA);

    if (mentionsProduct && mentionsAvailable && doesNotSayExhausted) {
      console.log('✅ PASS CASO A: IA reconoce producto y confirma disponibilidad.');
      passedTests++;
    } else {
      console.error('❌ FAIL CASO A: Respuesta no confirma disponibilidad esperada.');
      failedTests++;
    }
  } catch (err) {
    console.error('❌ FAIL CASO A error:', err.message);
    failedTests++;
  }

  // -------------------------------------------------------------------------------------
  // CASO B: Producto existe + agotado
  // Expected: IA reconoce que existe pero dice agotado. NO dice "no existe".
  // -------------------------------------------------------------------------------------
  console.log('\n--- [CASO B]: Producto existe + agotado ("Snowboard X Agotado") ---');
  try {
    const aiRespB = await queryAi(systemPrompt, '¿Tienen el Snowboard X Agotado?');
    console.log('IA:', aiRespB);

    const statesExhausted = /agotado|no disponible/i.test(aiRespB);
    const forbiddenPhrases = /no existe|no lo manejamos|no contamos con ese producto|no está en nuestro catálogo/i.test(aiRespB);

    if (statesExhausted && !forbiddenPhrases) {
      console.log('✅ PASS CASO B: IA reconoce que el producto existe en tienda pero aclara que está agotado, sin decir "no existe".');
      passedTests++;
    } else {
      console.error('❌ FAIL CASO B: IA dijo que no existe o no indicó que está agotado.');
      failedTests++;
    }
  } catch (err) {
    console.error('❌ FAIL CASO B error:', err.message);
    failedTests++;
  }

  // -------------------------------------------------------------------------------------
  // CASO C: Producto inexistente
  // Expected: IA dice que no existe / no se encontró en catálogo.
  // -------------------------------------------------------------------------------------
  console.log('\n--- [CASO C]: Producto inexistente ("Snowboard Fantasma 9000") ---');
  try {
    const aiRespC = await queryAi(systemPrompt, '¿Tienen el Snowboard Fantasma 9000?');
    console.log('IA:', aiRespC);

    const mentionsNotFound = /no contamos|no tenemos|no figura|no se encuentra|no disponemos|no manejamos/i.test(aiRespC);

    if (mentionsNotFound) {
      console.log('✅ PASS CASO C: IA indica correctamente que el producto no se encuentra en el catálogo.');
      passedTests++;
    } else {
      console.error('❌ FAIL CASO C: IA no indicó que el producto no existe.');
      failedTests++;
    }
  } catch (err) {
    console.error('❌ FAIL CASO C error:', err.message);
    failedTests++;
  }

  // -------------------------------------------------------------------------------------
  // CASO D: Producto agotado + intento directo de crear orden en backend
  // Expected: PRODUCT_OUT_OF_STOCK, 0 órdenes creadas.
  // -------------------------------------------------------------------------------------
  console.log('\n--- [CASO D]: Producto agotado + intento directo de crear orden ---');
  try {
    state.orders.length = 0; // Limpiar órdenes previas
    const resD = await syncCommercialOrder({
      tenant: {
        id: tenantId,
        name: 'Velion Sports',
        bankAccounts: 'BCP: 191-12345678-0-01'
      },
      customer: state.customer,
      clientNumber: '51999888777',
      currentCommercialState: {},
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

    console.log('Resultado syncCommercialOrder:', {
      error: resD.error,
      message: resD.message,
      ordersInDb: state.orders.length
    });

    if (resD.error === 'PRODUCT_OUT_OF_STOCK' && state.orders.length === 0) {
      console.log('✅ PASS CASO D: Backend bloqueó compra con PRODUCT_OUT_OF_STOCK y 0 órdenes creadas.');
      passedTests++;
    } else {
      console.error('❌ FAIL CASO D: No retornó PRODUCT_OUT_OF_STOCK o creó una orden.');
      failedTests++;
    }
  } catch (err) {
    console.error('❌ FAIL CASO D error:', err.message);
    failedTests++;
  }

  // -------------------------------------------------------------------------------------
  // CASO E: Producto seleccionado con stock, luego se agota antes de confirmar (Race condition / stale session)
  // Expected: PRODUCT_OUT_OF_STOCK, 0 órdenes creadas.
  // -------------------------------------------------------------------------------------
  console.log('\n--- [CASO E]: Producto seleccionado con stock, luego se agota antes de confirmar ---');
  try {
    state.orders.length = 0; // Reset
    // Estado inicial en la conversación del cliente: tenía seleccionado prod-1-in-stock cuando había stock
    const staleState = {
      productId: 'prod-1-in-stock',
      productName: 'Snowboard Pro 100',
      quantity: 1,
      currentStage: 'PRODUCT_SELECTED'
    };

    // Entre el momento de selección y el momento de confirmar, se agota en la base de datos:
    const prodInDb = state.nativeProducts.find(p => p.id === 'prod-1-in-stock');
    prodInDb.isAvailable = false; // Se agotó en almacén!

    // Ahora el cliente intenta confirmar el pago:
    const resE = await syncCommercialOrder({
      tenant: {
        id: tenantId,
        name: 'Velion Sports',
        bankAccounts: 'BCP: 191-12345678-0-01'
      },
      customer: state.customer,
      clientNumber: '51999888777',
      currentCommercialState: staleState,
      args: {
        currentStage: 'PAYMENT_PENDING',
        productId: 'prod-1-in-stock',
        productName: 'Snowboard Pro 100',
        quantity: 1,
        customerConfirmed: true,
        shippingCity: 'Lima',
        paymentMethod: 'BCP'
      },
      prismaClient: mockDb
    });

    console.log('Resultado syncCommercialOrder con producto que se agotó en tiempo real:', {
      error: resE.error,
      message: resE.message,
      ordersInDb: state.orders.length
    });

    if (resE.error === 'PRODUCT_OUT_OF_STOCK' && state.orders.length === 0) {
      console.log('✅ PASS CASO E: Stale session bloqueada exitosamente en tiempo real con PRODUCT_OUT_OF_STOCK y 0 órdenes.');
      passedTests++;
    } else {
      console.error('❌ FAIL CASO E: Permitió orden en stale session o no retornó PRODUCT_OUT_OF_STOCK.');
      failedTests++;
    }

    // Restaurar estado de prod-1-in-stock
    prodInDb.isAvailable = true;
  } catch (err) {
    console.error('❌ FAIL CASO E error:', err.message);
    failedTests++;
  }

  // -------------------------------------------------------------------------------------
  // CASO F: Shopify inventoryTracked=false + availableForSale=true
  // Expected: Disponible (Sí).
  // -------------------------------------------------------------------------------------
  console.log('\n--- [CASO F]: Shopify inventoryTracked=false + availableForSale=true ---');
  try {
    const shopifyUntrackedItem = await commerceService.getProduct(tenantId, 'shopify:var-shopify-untracked-1');
    console.log('Shopify Untracked Item:', {
      id: shopifyUntrackedItem?.id,
      name: shopifyUntrackedItem?.name,
      inventoryQuantity: shopifyUntrackedItem?.inventoryQuantity,
      availableForSale: shopifyUntrackedItem?.availableForSale,
      isAvailable: shopifyUntrackedItem?.isAvailable
    });

    // Validar en CSV: debe figurar como Disponible = "Sí"
    const csvRowMatch = catalogCsv.split('\n').find(row => row.includes('Snowboard Unlimited Shopify'));
    console.log('Fila CSV para Untracked:', csvRowMatch);

    const isAvailableTrue = shopifyUntrackedItem?.isAvailable === true;
    const csvHasSi = csvRowMatch && csvRowMatch.includes(',Sí,');

    if (isAvailableTrue && csvHasSi) {
      console.log('✅ PASS CASO F: Shopify untracked con availableForSale=true se preserva correctamente como disponible (isAvailable=true, Disponible=Sí).');
      passedTests++;
    } else {
      console.error('❌ FAIL CASO F: Item untracked fue considerado erróneamente no disponible.');
      failedTests++;
    }
  } catch (err) {
    console.error('❌ FAIL CASO F error:', err.message);
    failedTests++;
  }

  // -------------------------------------------------------------------------------------
  // CASO G: Producto Shopify stock 0 / availableForSale=false
  // Expected: IA dice agotado y backend impide pedido con PRODUCT_OUT_OF_STOCK.
  // -------------------------------------------------------------------------------------
  console.log('\n--- [CASO G]: Producto Shopify stock 0 (Snowboard Shopify Agotado) ---');
  try {
    // 1. Verificar respuesta conversacional de la IA para Shopify agotado
    const aiRespG = await queryAi(systemPrompt, '¿Tienen el Snowboard Shopify Agotado?');
    console.log('IA Shopify Agotado:', aiRespG);
    const aiRecognizesExhausted = /agotado|no disponible/i.test(aiRespG) && !/no existe|no lo manejamos/i.test(aiRespG);

    // 2. Verificar que backend bloquee intento de compra directa
    state.orders.length = 0;
    const resG = await syncCommercialOrder({
      tenant: {
        id: tenantId,
        name: 'Velion Sports',
        bankAccounts: 'BCP: 191-12345678-0-01'
      },
      customer: state.customer,
      clientNumber: '51999888777',
      currentCommercialState: {},
      args: {
        currentStage: 'PAYMENT_PENDING',
        productId: 'shopify:var-shopify-exhausted-1',
        productName: 'Snowboard Shopify Agotado',
        quantity: 1,
        customerConfirmed: true,
        shippingCity: 'Lima',
        paymentMethod: 'BCP'
      },
      prismaClient: mockDb
    });

    console.log('Resultado backend compra Shopify agotado:', {
      error: resG.error,
      message: resG.message,
      ordersInDb: state.orders.length
    });

    const backendBlocked = resG.error === 'PRODUCT_OUT_OF_STOCK' && state.orders.length === 0;

    if (aiRecognizesExhausted && backendBlocked) {
      console.log('✅ PASS CASO G: IA reconoce Shopify agotado y backend bloquea orden con PRODUCT_OUT_OF_STOCK (0 órdenes creadas).');
      passedTests++;
    } else {
      console.error('❌ FAIL CASO G: IA o backend fallaron para producto Shopify agotado.');
      failedTests++;
    }
  } catch (err) {
    console.error('❌ FAIL CASO G error:', err.message);
    failedTests++;
  }

  // -------------------------------------------------------------------------------------
  // RESUMEN FINAL
  // -------------------------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log(`📊 RESULTADOS FINALES: ${passedTests} PASADOS, ${failedTests} FALLADOS DE ${passedTests + failedTests}`);
  console.log('======================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Error fatal ejecutando suite:', err);
  process.exit(1);
});
