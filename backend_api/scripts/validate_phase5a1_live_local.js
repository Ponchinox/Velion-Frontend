/**
 * scripts/validate_phase5a1_live_local.js
 * ========================================
 * Script de validación en vivo para FASE 5A.1 — CURRENCY FOUNDATION
 * 
 * 1. Ejecuta full sync real SOLO contra Dev Store (velion-dev.myshopify.com).
 * 2. Verifica que Integration.shopCurrencyCode = 'USD'.
 * 3. Inspecciona The Minimal Snowboard (price = 885.95, currencyCode = 'USD').
 * 4. Valida que el CSV contenga 'USD 885.95' y NUNCA 'S/. 885.95'.
 * 5. NO ejecuta ninguna mutation Shopify (0 mutations).
 */

import prisma from '../src/db.js';
import { syncShopifyCatalog } from '../src/services/integrations/shopify/shopifyCatalogSyncService.js';
import { commerceService } from '../src/services/commerce/CommerceService.js';
import assert from 'node:assert';

console.log('======================================================================');
console.log('🧪 VALIDACIÓN EN VIVO FASE 5A.1 — CURRENCY FOUNDATION (DEV STORE)');
console.log('======================================================================\n');

async function main() {
  // 1. Obtener integración de Shopify existente
  const integration = await prisma.integration.findFirst({
    where: { provider: 'SHOPIFY' },
    select: {
      id: true,
      tenantId: true,
      shopDomain: true,
      status: true,
      shopCurrencyCode: true
    }
  });

  if (!integration) {
    throw new Error('No se encontró ninguna Integration de Shopify en la BD local.');
  }

  assert.strictEqual(integration.shopDomain, 'velion-dev.myshopify.com');
  assert.strictEqual(integration.status, 'CONNECTED');

  console.log(`📌 Tenant Local: ${integration.tenantId}`);
  console.log(`📌 Shop Domain: ${integration.shopDomain}`);
  console.log(`📌 Moneda previa en Integration: ${integration.shopCurrencyCode || 'null'}`);

  // 2. Ejecutar full sync real
  console.log('\n⏳ Ejecutando syncShopifyCatalog real contra velion-dev.myshopify.com...');
  const syncResult = await syncShopifyCatalog(integration.tenantId);
  console.log('✅ Sync exitoso:', {
    productsSynced: syncResult.productsSynced,
    variantsSynced: syncResult.variantsSynced,
    durationMs: syncResult.durationMs
  });

  // 3. Verificar persistencia atómica de moneda
  const updatedIntegration = await prisma.integration.findUnique({
    where: { id: integration.id },
    select: {
      shopCurrencyCode: true,
      lastSyncedAt: true,
      syncStatus: true
    }
  });

  console.log(`\n📌 Integration.shopCurrencyCode actualizado: ${updatedIntegration.shopCurrencyCode}`);
  assert.strictEqual(updatedIntegration.shopCurrencyCode, 'USD', 'Integration.shopCurrencyCode debe ser USD');

  // 4. Inspeccionar The Minimal Snowboard
  const snowboardProduct = await prisma.externalProduct.findFirst({
    where: {
      tenantId: integration.tenantId,
      title: { contains: 'Minimal Snowboard' }
    },
    include: {
      variants: true
    }
  });

  assert.ok(snowboardProduct, 'The Minimal Snowboard debe existir en la BD local');
  console.log(`\n🏂 ExternalProduct encontrado: "${snowboardProduct.title}" (ID: ${snowboardProduct.id})`);
  
  const defaultVariant = snowboardProduct.variants[0];
  assert.ok(defaultVariant, 'Variante de snowboard debe existir');
  console.log(`   Variante: "${defaultVariant.title}" | Price: ${defaultVariant.price}`);
  assert.strictEqual(defaultVariant.price, 885.95, 'Precio debe ser 885.95');

  // 5. Validar getPrice a través de CommerceService
  const commerceItemId = `shopify:${defaultVariant.id}`;
  const priceInfo = await commerceService.getPrice(integration.tenantId, commerceItemId);
  console.log('\n💰 CommerceService.getPrice():', priceInfo);
  assert.strictEqual(priceInfo.price, 885.95);
  assert.strictEqual(priceInfo.currencyCode, 'USD');

  // 6. Validar CSV en SHOPIFY_ONLY
  await prisma.integration.update({
    where: { id: integration.id },
    data: { catalogMode: 'SHOPIFY_ONLY' }
  });

  const csv = await commerceService.getCompactCatalogCsv(integration.tenantId);
  const lines = csv.trim().split('\n');

  console.log(`\n📊 Header CSV: ${lines[0]}`);
  assert.strictEqual(lines[0], 'ID,Nombre,Precio,Tipo,Categoria');

  const snowboardCsvLine = lines.find(l => l.includes('Minimal Snowboard'));
  console.log(`🏂 Línea CSV de The Minimal Snowboard:\n   ${snowboardCsvLine}`);

  assert.ok(snowboardCsvLine, 'Debe existir una línea en el CSV para The Minimal Snowboard');
  assert.ok(snowboardCsvLine.includes('USD 885.95'), `El CSV debe formatear "USD 885.95". Recibido: ${snowboardCsvLine}`);
  assert.ok(!snowboardCsvLine.includes('S/. 885.95'), `PROHIBIDO: El CSV no debe formatear "S/. 885.95". Recibido: ${snowboardCsvLine}`);

  console.log('\n======================================================================');
  console.log('🎉 VALIDACIÓN EN VIVO FASE 5A.1 COMPLETADA CON ÉXITO');
  console.log('   - Integration.shopCurrencyCode = USD');
  console.log('   - The Minimal Snowboard Price = USD 885.95');
  console.log('   - CSV formateado correctamente con prefijo ISO "USD 885.95"');
  console.log('   - CERO ocurrencias de "S/." para precios Shopify');
  console.log('   - SHOPIFY_DRAFT_MUTATIONS_EXECUTED = 0');
  console.log('======================================================================\n');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ Validación en vivo falló:', err);
    process.exit(1);
  });
