import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('======================================================================');
console.log('🧪 VELION COMMERCE SCHEMA PHASE 2A: STATIC SCHEMA VALIDATION');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}:`, err.message);
    throw err;
  }
}

function parseModel(schemaText, modelName) {
  const regex = new RegExp(`model\\s+${modelName}\\s+\\{([^}]+)\\}`, 's');
  const match = schemaText.match(regex);
  if (!match) return null;
  
  const body = match[1];
  const fields = {};
  const lines = body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//') && !l.startsWith('@@'));
  
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length >= 2) {
      const fieldName = parts[0];
      const fieldType = parts[1];
      const attributes = parts.slice(2).join(' ');
      fields[fieldName] = { fieldType, attributes };
    }
  }
  
  return { body, fields };
}

const schemaPath = path.join(__dirname, 'prisma', 'schema.prisma');
const schemaContent = fs.readFileSync(schemaPath, 'utf8');

// ── TEST 1: Product incluye campos de SKU retrocompatibles e index scoped ──────
runTest('TEST 1: Product incluye sku y normalizedSku nullable con @@index([userId, normalizedSku])', () => {
  const product = parseModel(schemaContent, 'Product');
  assert.ok(product, 'Modelo Product debe existir');
  assert.ok(product.fields.sku, 'Product debe contener el campo sku');
  assert.strictEqual(product.fields.sku.fieldType, 'String?', 'sku debe ser nullable');
  assert.ok(product.fields.normalizedSku, 'Product debe contener normalizedSku');
  assert.strictEqual(product.fields.normalizedSku.fieldType, 'String?', 'normalizedSku debe ser nullable');
  assert.ok(product.body.includes('@@index([userId, normalizedSku])'), 'Product debe indexar compuesto [userId, normalizedSku]');
  assert.ok(!product.body.includes('@@index([normalizedSku])'), 'Product NO debe tener índice global superfluo @@index([normalizedSku])');
  assert.ok(!product.fields.sku.attributes.includes('@unique'), 'sku NO debe ser marcado globalmente @unique');
  assert.ok(!product.fields.normalizedSku.attributes.includes('@unique'), 'normalizedSku NO debe ser marcado globalmente @unique');
});

// ── TEST 2: Campos preexistentes de Product intactos ───────────────────────────
runTest('TEST 2: Product conserva todos los campos preexistentes sin alteraciones', () => {
  const product = parseModel(schemaContent, 'Product');
  const requiredLegacy = ['id', 'name', 'description', 'category', 'tags', 'type', 'price', 'isAvailable', 'imageUrl', 'promotionalPrice', 'promoStartDate', 'promoEndDate', 'userId', 'images', 'videoUrl'];
  for (const f of requiredLegacy) {
    assert.ok(product.fields[f], `Campo legacy "${f}" debe seguir presente en Product`);
  }
});

// ── TEST 3: Integration existe con campos canónicos y @@unique([provider, shopDomain])
runTest('TEST 3: Modelo Integration contiene @@unique([tenantId, provider]) y @@unique([provider, shopDomain])', () => {
  const integration = parseModel(schemaContent, 'Integration');
  assert.ok(integration, 'Modelo Integration debe existir');
  assert.ok(integration.fields.id, 'Integration.id requerido');
  assert.ok(integration.fields.tenantId, 'Integration.tenantId requerido');
  assert.ok(integration.fields.provider, 'Integration.provider requerido');
  assert.ok(integration.fields.status, 'Integration.status requerido');
  assert.strictEqual(integration.fields.shopDomain.fieldType, 'String?');
  assert.strictEqual(integration.fields.encryptedAccessToken.fieldType, 'String?');
  assert.strictEqual(integration.fields.encryptedRefreshToken.fieldType, 'String?');
  assert.strictEqual(integration.fields.accessTokenExpiresAt.fieldType, 'DateTime?');
  assert.strictEqual(integration.fields.refreshTokenExpiresAt.fieldType, 'DateTime?');
  assert.ok(integration.fields.catalogMode, 'catalogMode requerido');
  assert.ok(integration.fields.priceSource, 'priceSource requerido');
  assert.ok(integration.fields.stockSource, 'stockSource requerido');
  assert.ok(integration.fields.externalOrderMode, 'externalOrderMode requerido');
  assert.ok(integration.body.includes('@@unique([tenantId, provider])'), 'Debe existir constraint @@unique([tenantId, provider])');
  assert.ok(integration.body.includes('@@unique([provider, shopDomain])'), 'Debe existir constraint @@unique([provider, shopDomain]) anti-colisión TOCTOU');
});

// ── TEST 4: NO existe encryptedWebhookSecret en Integration ────────────────────
runTest('TEST 4: Integration NO incluye encryptedWebhookSecret (secreto es global en env)', () => {
  const integration = parseModel(schemaContent, 'Integration');
  assert.strictEqual(integration.fields.encryptedWebhookSecret, undefined, 'NO debe almacenarse secreto de webhook por tenant');
});

// ── TEST 5: ExternalProduct existe y relaciona con Tenant e Integration ────────
runTest('TEST 5: ExternalProduct model existe con relaciones e índices correctos', () => {
  const ep = parseModel(schemaContent, 'ExternalProduct');
  assert.ok(ep, 'Modelo ExternalProduct debe existir');
  assert.ok(ep.fields.externalId, 'ExternalProduct.externalId requerido');
  assert.strictEqual(ep.fields.externalId.fieldType, 'String');
  assert.ok(ep.fields.title, 'ExternalProduct.title requerido');
  assert.strictEqual(ep.fields.title.fieldType, 'String');
  assert.ok(ep.body.includes('@@unique([tenantId, provider, externalId])'), 'Debe existir constraint @@unique([tenantId, provider, externalId])');
  assert.ok(ep.fields.variants, 'Debe existir el campo variants en ExternalProduct');
  assert.strictEqual(ep.fields.variants.fieldType, 'ExternalProductVariant[]', 'variants debe ser de tipo ExternalProductVariant[]');
});

// ── TEST 6: ExternalProductVariant existe con campos vendibles ─────────────────
runTest('TEST 6: ExternalProductVariant model representa la unidad transaccional', () => {
  const epv = parseModel(schemaContent, 'ExternalProductVariant');
  assert.ok(epv, 'Modelo ExternalProductVariant debe existir');
  assert.ok(epv.fields.externalVariantId, 'externalVariantId requerido');
  assert.strictEqual(epv.fields.externalVariantId.fieldType, 'String');
  assert.strictEqual(epv.fields.inventoryItemId?.fieldType, 'String?');
  assert.strictEqual(epv.fields.sku?.fieldType, 'String?');
  assert.strictEqual(epv.fields.normalizedSku?.fieldType, 'String?');
  assert.strictEqual(epv.fields.price.fieldType, 'Float', 'price debe ser Float para paridad con Velion');
  assert.strictEqual(epv.fields.compareAtPrice?.fieldType, 'Float?');
  assert.strictEqual(epv.fields.inventoryQuantity.fieldType, 'Int');
  assert.strictEqual(epv.fields.availableForSale.fieldType, 'Boolean');
  assert.ok(epv.body.includes('@@unique([tenantId, provider, externalVariantId])'), 'Debe existir @@unique([tenantId, provider, externalVariantId])');
  assert.ok(epv.body.includes('@@index([tenantId, provider, normalizedSku])'), 'Debe indexar normalizedSku compuesto');
  assert.ok(epv.fields.tenant, 'ExternalProductVariant debe tener relación tenant');
  assert.strictEqual(epv.fields.tenant.fieldType, 'Tenant', 'tenant debe ser de tipo Tenant');
  assert.ok(epv.fields.tenant.attributes.includes('onDelete: Cascade'), 'Relación tenant debe tener onDelete: Cascade');
});

// ── TEST 7: Order extendido de forma retrocompatible ───────────────────────────
runTest('TEST 7: Order contiene campos externos nullable sin alterar pedidos históricos', () => {
  const order = parseModel(schemaContent, 'Order');
  assert.ok(order, 'Modelo Order debe existir');
  assert.strictEqual(order.fields.externalProvider?.fieldType, 'String?');
  assert.strictEqual(order.fields.externalDraftOrderId?.fieldType, 'String?');
  assert.strictEqual(order.fields.externalOrderId?.fieldType, 'String?');
  assert.strictEqual(order.fields.externalOrderNumber?.fieldType, 'String?');
  assert.strictEqual(order.fields.externalCheckoutUrl?.fieldType, 'String?');
  assert.strictEqual(order.fields.externalSyncStatus?.fieldType, 'String?');
  assert.strictEqual(order.fields.externalSyncAttempts?.fieldType, 'Int');
  assert.strictEqual(order.fields.externalSyncError?.fieldType, 'String?');
  assert.strictEqual(order.fields.externalSyncedAt?.fieldType, 'DateTime?');
});

// ── TEST 8: OrderItem contiene snapshot de procedencia sin FK destructiva ──────
runTest('TEST 8: OrderItem contiene snapshot histórico sin foreign keys a tablas externas', () => {
  const item = parseModel(schemaContent, 'OrderItem');
  assert.ok(item, 'Modelo OrderItem debe existir');
  assert.strictEqual(item.fields.sourceProvider?.fieldType, 'String?');
  assert.strictEqual(item.fields.externalProductId?.fieldType, 'String?');
  assert.strictEqual(item.fields.externalVariantId?.fieldType, 'String?');
  assert.strictEqual(item.fields.sourceSku?.fieldType, 'String?');
  assert.ok(!item.fields.externalProduct, 'OrderItem NO debe tener FK a ExternalProduct');
  assert.ok(!item.fields.externalProductVariant, 'OrderItem NO debe tener FK a ExternalProductVariant');
});

// ── TEST 9: Integridad de relaciones y borrado en cascada seguro ───────────────
runTest('TEST 9: Borrado en cascada seguro — Order y OrderItem NO son eliminados por desconexión', () => {
  const epv = parseModel(schemaContent, 'ExternalProductVariant');
  assert.ok(epv.body.includes('onDelete: Cascade'), 'ExternalProductVariant cascadea desde ExternalProduct');
  const ep = parseModel(schemaContent, 'ExternalProduct');
  assert.ok(ep.body.includes('onDelete: Cascade'), 'ExternalProduct cascadea desde Integration');
  const order = parseModel(schemaContent, 'Order');
  assert.ok(!order.body.includes('references: [external'), 'Order es inmune a desconexión externa');
});

// ── TEST 10: Tenant contiene relaciones inversas a integraciones y catálogo externo
runTest('TEST 10: Tenant model incluye relaciones inversas hacia Integration, ExternalProduct y ExternalProductVariant', () => {
  const tenant = parseModel(schemaContent, 'Tenant');
  assert.ok(tenant.fields.integrations, 'Tenant debe tener integrations Integration[]');
  assert.ok(tenant.fields.externalProducts, 'Tenant debe tener externalProducts ExternalProduct[]');
  assert.ok(tenant.fields.externalProductVariants, 'Tenant debe tener externalProductVariants ExternalProductVariant[]');
  assert.strictEqual(tenant.fields.externalProductVariants.fieldType, 'ExternalProductVariant[]');
});

// ── TEST 11: Currency Foundation fields en Tenant, Integration y Order ────────
runTest('TEST 11: Currency Foundation fields (Tenant.currencyCode, Integration.shopCurrencyCode, Order.currencyCode)', () => {
  const tenant = parseModel(schemaContent, 'Tenant');
  assert.ok(tenant.fields.currencyCode, 'Tenant.currencyCode debe existir');
  assert.strictEqual(tenant.fields.currencyCode.fieldType, 'String');
  assert.ok(tenant.fields.currencyCode.attributes.includes('@default("PEN")'), 'Tenant.currencyCode default debe ser PEN');

  const integration = parseModel(schemaContent, 'Integration');
  assert.ok(integration.fields.shopCurrencyCode, 'Integration.shopCurrencyCode debe existir');
  assert.strictEqual(integration.fields.shopCurrencyCode.fieldType, 'String?');

  const order = parseModel(schemaContent, 'Order');
  assert.ok(order.fields.currencyCode, 'Order.currencyCode debe existir');
  assert.strictEqual(order.fields.currencyCode.fieldType, 'String?');
});

console.log('\n======================================================================');
console.log(`🎉 SUITE SCHEMA STATIC VALIDATION: ${passedTests}/${totalTests} TESTS PASARON`);
console.log('======================================================================\n');
