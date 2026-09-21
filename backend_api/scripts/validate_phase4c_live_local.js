/**
 * scripts/validate_phase4c_live_local.js
 * =======================================
 * Script de validación en vivo contra la base de datos PostgreSQL LOCAL
 * (velion_shopify_dev).
 *
 * CERO llamadas de red a Shopify:
 * Lee únicamente ExternalProduct y ExternalProductVariant ya sincronizados.
 *
 * Secciones:
 * - Paso 28: Validación de SHOPIFY_ONLY en DB local.
 * - Paso 29: Validación de COMBINED (SKU Matching 1:1) con Product nativo sintético temporal.
 * - Limpieza estricta del fixture sintético temporal.
 */

import prisma from '../src/db.js';
import commerceService from '../src/services/commerce/CommerceService.js';
import { orchestrateProductMedia } from '../src/services/productMediaOrchestrator.js';

console.log('======================================================================');
console.log('🔍 VALIDACIÓN FASE 4C EN VIVO EN POSTGRESQL LOCAL (velion_shopify_dev)');
console.log('======================================================================\n');

async function main() {
  try {
    // 1. Obtener integración de Shopify existente
    const integration = await prisma.integration.findFirst({
      where: { provider: 'SHOPIFY' },
      select: {
        id: true,
        tenantId: true,
        shopDomain: true,
        status: true,
        catalogMode: true,
        priceSource: true,
        stockSource: true
      }
    });

    if (!integration) {
      throw new Error('No se encontró ninguna Integration de Shopify en la BD local.');
    }

    const tenantId = integration.tenantId;
    console.log(`📌 Tenant Local: ${tenantId}`);
    console.log(`📌 Shop Domain: ${integration.shopDomain}`);
    console.log(`📌 Estado Integración: ${integration.status}`);

    const initialProductCount = await prisma.externalProduct.count({ where: { tenantId } });
    const initialVariantCount = await prisma.externalProductVariant.count({ where: { tenantId } });

    console.log(`📦 ExternalProducts sincronizados: ${initialProductCount}`);
    console.log(`🏷️ ExternalProductVariants sincronizadas: ${initialVariantCount}`);

    if (initialProductCount !== 17 || initialVariantCount !== 26) {
      console.warn(`⚠️ Advertencia: Conteos de catálogo difieren del esperado (17/26): ${initialProductCount}/${initialVariantCount}`);
    }

    // ======================================================================
    // PASO 28 — SHOPIFY_ONLY EN VIVO
    // ======================================================================
    console.log('\n--- PASO 28: VALIDACIÓN SHOPIFY_ONLY ---');

    await prisma.integration.update({
      where: { id: integration.id },
      data: { catalogMode: 'SHOPIFY_ONLY' }
    });

    const csvShopifyOnly = await commerceService.getCompactCatalogCsv(tenantId);
    const csvLines = csvShopifyOnly.trim().split('\n');

    console.log(`📊 Cabecera CSV: "${csvLines[0]}"`);
    if (csvLines[0] !== 'ID,Nombre,Precio,Tipo,Categoria') {
      throw new Error(`Cabecera CSV incorrecta: "${csvLines[0]}"`);
    }

    console.log(`📊 Filas generadas en CSV: ${csvLines.length - 1} variantes`);
    console.log(`📄 Primeras 3 filas de muestra:\n  ${csvLines.slice(1, 4).join('\n  ')}`);

    // Seleccionar variantes de interés
    // a) Con SKU
    const variantWithSku = await prisma.externalProductVariant.findFirst({
      where: { tenantId, sku: { not: null } },
      include: { externalProduct: true }
    });
    console.log(`\n  a) Variante con SKU: "${variantWithSku?.title}" (SKU: ${variantWithSku?.sku}, Price: ${variantWithSku?.price})`);
    const prodItemA = await commerceService.getProduct(tenantId, `shopify:${variantWithSku.id}`);
    console.log(`     -> getProduct: ID=${prodItemA.id}, Name="${prodItemA.name}", Price=${prodItemA.price}, isAvailable=${prodItemA.isAvailable}`);

    // b) Sin SKU
    const variantWithoutSku = await prisma.externalProductVariant.findFirst({
      where: { tenantId, sku: null },
      include: { externalProduct: true }
    });
    console.log(`\n  b) Variante sin SKU: "${variantWithoutSku?.title}" (ID: ${variantWithoutSku?.id})`);
    if (variantWithoutSku) {
      const prodItemB = await commerceService.getProduct(tenantId, `shopify:${variantWithoutSku.id}`);
      console.log(`     -> getProduct: ID=${prodItemB.id}, Name="${prodItemB.name}", Price=${prodItemB.price}`);
    }

    // c) Producto con múltiples variantes
    const multiVariantProduct = await prisma.externalProduct.findFirst({
      where: {
        tenantId,
        variants: { some: {} }
      },
      include: { variants: true }
    });
    console.log(`\n  c) Producto con múltiples variantes: "${multiVariantProduct?.title}" (${multiVariantProduct?.variants.length} variantes)`);
    for (const v of multiVariantProduct.variants.slice(0, 3)) {
      const item = await commerceService.getProduct(tenantId, `shopify:${v.id}`);
      console.log(`     - Variante ID=${v.id.slice(0, 8)}: DisplayName="${item.name}", Price=${item.price}`);
    }

    // d) Producto sin imagen o con imagen
    const productNoImg = await prisma.externalProduct.findFirst({
      where: { tenantId, imageUrl: null }
    });
    console.log(`\n  d) Producto sin imagen: ${productNoImg ? `"${productNoImg.title}"` : 'Todos los productos tienen imagen'}`);

    // Probar media con orchestrator
    const mediaSample = await commerceService.searchProducts(tenantId, { isAvailable: true });
    const mediaResult = orchestrateProductMedia({
      userMessageText: `Hola, me interesa el ${mediaSample[0]?.name}`,
      availableProducts: mediaSample,
      currentCommercialState: {},
      sentMediaProductIds: []
    });
    console.log(`\n  🖼️ Orquestación de Media para "${mediaSample[0]?.name}":`);
    console.log(`     shouldDispatch: ${mediaResult.shouldDispatch}, mediaType: ${mediaResult.mediaType}, url: ${mediaResult.url?.slice(0, 40)}...`);

    // ======================================================================
    // PASO 29 — COMBINED SKU MATCHING EN VIVO
    // ======================================================================
    console.log('\n--- PASO 29: VALIDACIÓN COMBINED (SKU MATCHING 1:1) ---');

    // Buscar una variante conocida de Shopify con SKU
    const targetShopifyVariant = await prisma.externalProductVariant.findFirst({
      where: {
        tenantId,
        normalizedSku: { not: null },
        availableForSale: true
      },
      include: { externalProduct: true }
    });

    if (!targetShopifyVariant) {
      throw new Error('No se encontró ninguna variante Shopify con SKU para emparejar.');
    }

    const matchSku = targetShopifyVariant.normalizedSku;
    console.log(`🎯 SKU objetivo para coincidencia 1:1: "${matchSku}"`);
    console.log(`   Variante Shopify: "${targetShopifyVariant.title}" en "${targetShopifyVariant.externalProduct.title}" (Price: S/. ${targetShopifyVariant.price})`);

    // Obtener un usuario del tenant para asociar el producto nativo sintético
    const tenantUser = await prisma.user.findFirst({
      where: { tenantId }
    });

    if (!tenantUser) {
      throw new Error(`No se encontró ningún User asociado al tenant ${tenantId}`);
    }

    // Crear Product nativo sintético temporal
    const syntheticNativeProduct = await prisma.product.create({
      data: {
        name: 'Snowboard Sintético Demo Velion',
        description: 'Descripción Nativa Curada por el Negocio',
        category: 'Deportes',
        type: 'PHYSICAL_PRODUCT',
        price: 99.00,
        promotionalPrice: null,
        isAvailable: true,
        sku: matchSku,
        normalizedSku: matchSku,
        imageUrl: 'https://velion.pe/demo-native.jpg',
        images: ['https://velion.pe/demo-native.jpg'],
        videoUrl: 'https://velion.pe/demo-video.mp4',
        userId: tenantUser.id
      }
    });

    console.log(`✨ Creado Product nativo sintético temporal: ID=${syntheticNativeProduct.id}, Name="${syntheticNativeProduct.name}", Price=S/. ${syntheticNativeProduct.price}`);

    try {
      // Configuración A: catalogMode=COMBINED, priceSource=SHOPIFY, stockSource=SHOPIFY
      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          catalogMode: 'COMBINED',
          priceSource: 'SHOPIFY',
          stockSource: 'SHOPIFY'
        }
      });

      console.log('\n  [Prueba A: priceSource=SHOPIFY, stockSource=SHOPIFY]');
      const csvCombinedA = await commerceService.getCompactCatalogCsv(tenantId);
      const linesA = csvCombinedA.trim().split('\n');

      // Buscar la fila del SKU emparejado
      const matchedRowA = linesA.find(l => l.startsWith(`${syntheticNativeProduct.id},`));
      if (!matchedRowA) {
        throw new Error(`No se encontró fila con el ID nativo ${syntheticNativeProduct.id} en el CSV combinado.`);
      }

      console.log(`  ✅ Fila fusionada encontrada: "${matchedRowA}"`);
      // Verificar que el ID es el nativo
      if (!matchedRowA.startsWith(`${syntheticNativeProduct.id},`)) {
        throw new Error('El ID de la fila fusionada debe ser el ID nativo.');
      }
      // Verificar que el nombre es el nativo
      if (!matchedRowA.includes('Snowboard Sintético Demo Velion')) {
        throw new Error('El nombre de la fila fusionada debe ser el nativo.');
      }
      // Verificar que el precio proviene de Shopify
      if (!matchedRowA.includes(`S/. ${targetShopifyVariant.price}`)) {
        throw new Error(`El precio debe ser el de Shopify (${targetShopifyVariant.price}), fila: ${matchedRowA}`);
      }

      // Verificar que la variante Shopify no aparece duplicada
      const duplicateShopifyRowA = linesA.find(l => l.startsWith(`shopify:${targetShopifyVariant.id},`));
      if (duplicateShopifyRowA) {
        throw new Error(`La variante Shopify ${targetShopifyVariant.id} aparece duplicada en el CSV: ${duplicateShopifyRowA}`);
      }
      console.log('  ✅ No existe duplicación en CSV: variante Shopify absorbida en el ítem nativo.');

      // Probar getProduct en modo COMBINED
      const resolvedProductA = await commerceService.getProduct(tenantId, syntheticNativeProduct.id);
      console.log(`  ✅ getProduct: Name="${resolvedProductA.name}", Price=S/. ${resolvedProductA.price} (de Shopify), Source=${resolvedProductA.source}`);

      // Configuración B: catalogMode=COMBINED, priceSource=VELION, stockSource=VELION
      console.log('\n  [Prueba B: priceSource=VELION, stockSource=VELION]');
      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          catalogMode: 'COMBINED',
          priceSource: 'VELION',
          stockSource: 'VELION'
        }
      });

      const csvCombinedB = await commerceService.getCompactCatalogCsv(tenantId);
      const linesB = csvCombinedB.trim().split('\n');
      const matchedRowB = linesB.find(l => l.startsWith(`${syntheticNativeProduct.id},`));

      console.log(`  ✅ Fila fusionada encontrada: "${matchedRowB}"`);
      // Verificar que el precio proviene de Velion Native (99.00)
      if (!matchedRowB.includes('S/. 99')) {
        throw new Error(`El precio debe ser el nativo (99), fila: ${matchedRowB}`);
      }

      const resolvedProductB = await commerceService.getProduct(tenantId, syntheticNativeProduct.id);
      console.log(`  ✅ getProduct: Name="${resolvedProductB.name}", Price=S/. ${resolvedProductB.price} (de Velion Native), Source=${resolvedProductB.source}`);

    } finally {
      // LIMPIEZA ESTRICTA: Eliminar únicamente el fixture sintético creado
      console.log('\n🧹 Limpiando fixture sintético temporal de la base de datos...');
      await prisma.product.delete({
        where: { id: syntheticNativeProduct.id }
      });
      console.log('✅ Fixture sintético eliminado exitosamente.');

      // Restaurar configuración de integración
      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          catalogMode: 'COMBINED',
          priceSource: 'SHOPIFY',
          stockSource: 'SHOPIFY'
        }
      });
      console.log('✅ Configuración de Integration restaurada (COMBINED / SHOPIFY / SHOPIFY).');
    }

    // Verificar que el catálogo Shopify permanece intacto
    const finalProductCount = await prisma.externalProduct.count({ where: { tenantId } });
    const finalVariantCount = await prisma.externalProductVariant.count({ where: { tenantId } });

    console.log(`\n🔒 Verificación final de integridad de catálogo:`);
    console.log(`   ExternalProducts: ${finalProductCount} (esperado: ${initialProductCount})`);
    console.log(`   ExternalProductVariants: ${finalVariantCount} (esperado: ${initialVariantCount})`);

    if (finalProductCount !== initialProductCount || finalVariantCount !== initialVariantCount) {
      throw new Error('CORRUPCIÓN DE CATÁLOGO: Conteos finales no coinciden con los iniciales.');
    }

    console.log('\n======================================================================');
    console.log('🎉 TODAS LAS VALIDACIONES LOCALES EN VIVO (28 Y 29) PASARON CON ÉXITO');
    console.log('======================================================================\n');

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('\n❌ ERROR EN VALIDACIÓN EN VIVO:', err);
  process.exit(1);
});
