/**
 * test_commerce_shopify_media.js
 * ================================
 * Suite de pruebas para verificar la compatibilidad de media de Shopify
 * con productMediaOrchestrator y las herramientas de WhatsApp.
 *
 * Cobertura requerida:
 * 1. Shape compatible con productMediaOrchestrator: id, name, category, tags, imageUrl, images, videoUrl.
 * 2. Auto-dispatch de imagen para producto Shopify en primera consulta comercial.
 * 3. Rotación de imágenes de galería Shopify (NEXT_PHOTO y MORE_PHOTOS).
 * 4. Petición explícita de video para producto Shopify: rechaza con NO_VIDEO_REGISTERED (videoUrl=null).
 * 5. Aislamiento multi-tenant en media: no se despachan imágenes de otros tenants.
 * 6. Ítems combinados (MERGED) preservan imágenes y video del producto nativo.
 */

import assert from 'node:assert';
import {
  orchestrateProductMedia,
  getCanonicalProductImages,
  getCanonicalProductImageUrl,
  getCanonicalProductVideoUrl
} from './src/services/productMediaOrchestrator.js';
import { ShopifyCachedProvider } from './src/services/commerce/ShopifyCachedProvider.js';

console.log('======================================================================');
console.log('🧪 VELION COMMERCE SHOPIFY MEDIA & ORCHESTRATOR SUITE');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

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

function createMockShopifyDb() {
  const products = [
    {
      id: 'ext-p-snow',
      tenantId: 'tenant-media',
      provider: 'SHOPIFY',
      externalId: 'gid://shopify/Product/1',
      title: 'Snowboard Pro',
      description: 'Edición especial',
      category: 'Deportes',
      tags: ['snowboard', 'nieve'],
      imageUrl: 'https://cdn.shopify.com/snow-cover.jpg',
      images: ['https://cdn.shopify.com/snow-cover.jpg', 'https://cdn.shopify.com/snow-side.jpg', 'https://cdn.shopify.com/snow-bottom.jpg'],
      isAvailable: true
    },
    {
      id: 'ext-p-no-img',
      tenantId: 'tenant-media',
      provider: 'SHOPIFY',
      externalId: 'gid://shopify/Product/2',
      title: 'Cera para Tablas',
      description: 'Cera rápida',
      category: 'Mantenimiento',
      tags: ['cera'],
      imageUrl: null,
      images: [],
      isAvailable: true
    }
  ];

  const variants = [
    {
      id: 'var-snow-155',
      tenantId: 'tenant-media',
      externalProductId: 'ext-p-snow',
      provider: 'SHOPIFY',
      externalVariantId: 'gid://shopify/ProductVariant/11',
      title: '155 cm',
      price: 450.00,
      inventoryQuantity: 5,
      availableForSale: true
    },
    {
      id: 'var-wax-std',
      tenantId: 'tenant-media',
      externalProductId: 'ext-p-no-img',
      provider: 'SHOPIFY',
      externalVariantId: 'gid://shopify/ProductVariant/22',
      title: 'Default Title',
      price: 25.00,
      inventoryQuantity: 50,
      availableForSale: true
    }
  ];

  return {
    externalProductVariant: {
      async findFirst({ where, include }) {
        const found = variants.find(v => v.id === where.id && v.tenantId === where.tenantId);
        if (!found) return null;
        const res = { ...found };
        if (include?.externalProduct) {
          res.externalProduct = products.find(p => p.id === found.externalProductId) || null;
        }
        return res;
      },
      async findMany({ where, include }) {
        let list = variants.filter(v => v.tenantId === where.tenantId);
        if (include?.externalProduct) {
          list = list.map(v => ({
            ...v,
            externalProduct: products.find(p => p.id === v.externalProductId) || null
          }));
        }
        return list;
      }
    }
  };
}

// ── EJECUCIÓN DE TESTS ────────────────────────────────────────────────────────

await runTest('TEST 1: Shape de producto Shopify normalizado es 100% compatible con helpers de media', async () => {
  const db = createMockShopifyDb();
  const provider = new ShopifyCachedProvider(db);

  const item = await provider.getProduct('tenant-media', 'shopify:var-snow-155');
  assert.ok(item);

  const images = getCanonicalProductImages(item);
  assert.strictEqual(images.length, 3);
  assert.strictEqual(images[0], 'https://cdn.shopify.com/snow-cover.jpg');
  assert.strictEqual(images[1], 'https://cdn.shopify.com/snow-side.jpg');
  assert.strictEqual(images[2], 'https://cdn.shopify.com/snow-bottom.jpg');

  const cover = getCanonicalProductImageUrl(item);
  assert.strictEqual(cover, 'https://cdn.shopify.com/snow-cover.jpg');

  const video = getCanonicalProductVideoUrl(item);
  assert.strictEqual(video, null, 'videoUrl en Shopify debe ser null');
});

await runTest('TEST 2: Auto-dispatch de imagen para producto Shopify en primera consulta comercial', async () => {
  const db = createMockShopifyDb();
  const provider = new ShopifyCachedProvider(db);
  const items = await provider.searchProducts('tenant-media', { isAvailable: true });

  const result = orchestrateProductMedia({
    userMessageText: 'Hola, me interesa el Snowboard Pro 155 cm, a cuánto está?',
    availableProducts: items,
    currentCommercialState: {},
    sentMediaProductIds: []
  });

  assert.strictEqual(result.shouldDispatch, true);
  assert.strictEqual(result.mediaType, 'image');
  assert.strictEqual(result.url, 'https://cdn.shopify.com/snow-cover.jpg');
  assert.strictEqual(result.targetProduct.id, 'shopify:var-snow-155');
  assert.strictEqual(result.reason, 'AUTO_IMAGE_ON_PRODUCT_INQUIRY');
});

await runTest('TEST 3: Rotación de galería (NEXT_PHOTO) para producto Shopify', async () => {
  const db = createMockShopifyDb();
  const provider = new ShopifyCachedProvider(db);
  const items = await provider.searchProducts('tenant-media', { isAvailable: true });

  // Simular que ya se envió la portada
  const commercialState = {
    productId: 'shopify:var-snow-155',
    productMediaState: {
      productId: 'shopify:var-snow-155',
      sentImageUrls: ['https://cdn.shopify.com/snow-cover.jpg']
    }
  };

  const result = orchestrateProductMedia({
    userMessageText: '¿Tienes otra foto?',
    availableProducts: items,
    currentCommercialState: commercialState,
    sentMediaProductIds: ['shopify:var-snow-155']
  });

  assert.strictEqual(result.shouldDispatch, true);
  assert.strictEqual(result.mediaType, 'image');
  assert.strictEqual(result.url, 'https://cdn.shopify.com/snow-side.jpg');
  assert.strictEqual(result.requestType, 'NEXT_PHOTO');
});

await runTest('TEST 4: Petición explícita de video para producto Shopify retorna NO_VIDEO_REGISTERED', async () => {
  const db = createMockShopifyDb();
  const provider = new ShopifyCachedProvider(db);
  const items = await provider.searchProducts('tenant-media', { isAvailable: true });

  const result = orchestrateProductMedia({
    userMessageText: 'Mándame un video del Snowboard Pro 155 cm',
    availableProducts: items,
    currentCommercialState: { productId: 'shopify:var-snow-155' },
    sentMediaProductIds: []
  });

  assert.strictEqual(result.shouldDispatch, false);
  assert.strictEqual(result.mediaType, 'video');
  assert.strictEqual(result.reason, 'NO_VIDEO_REGISTERED');
  assert.strictEqual(result.url, null);
});

await runTest('TEST 5: Producto Shopify sin fotos registradas no intenta despachar imagen', async () => {
  const db = createMockShopifyDb();
  const provider = new ShopifyCachedProvider(db);
  const items = await provider.searchProducts('tenant-media', { isAvailable: true });

  const result = orchestrateProductMedia({
    userMessageText: 'Muéstrame fotos de la Cera para Tablas',
    availableProducts: items,
    currentCommercialState: {},
    sentMediaProductIds: []
  });

  assert.strictEqual(result.shouldDispatch, false);
  assert.strictEqual(result.reason, 'NO_IMAGE_REGISTERED');
});

console.log('\n======================================================================');
console.log(`🎉 SUITE SHOPIFY MEDIA COMPATIBILITY: ${passedTests}/${totalTests} TESTS PASARON`);
console.log('======================================================================\n');
