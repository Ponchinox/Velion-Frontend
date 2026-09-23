/**
 * TEST SUITE: SHOPIFY WEBHOOKS & SECURITY SPECIFICATION
 * ====================================================
 */

import assert from 'assert';
import crypto from 'crypto';

process.env.NODE_ENV = 'production';
process.env.SHOPIFY_CLIENT_SECRET = 'test_secret_for_webhook_signature_12345';
process.env.SHOPIFY_CLIENT_ID = 'test_client_id_abc';
process.env.SHOPIFY_REDIRECT_URI = 'https://185.163.116.210/api/integrations/shopify/callback';

const {
  verifyShopifyWebhookHmac,
  isWebhookProcessed,
  recordProcessedWebhook,
  processProductCreateOrUpdate,
  processProductDelete,
  processInventoryLevelUpdate,
  registerShopifyWebhooks,
  REQUIRED_WEBHOOK_TOPICS,
} = await import('./src/services/integrations/shopify/shopifyWebhookService.js');

const { handleShopifyWebhook } = await import('./src/controllers/shopifyWebhookController.js');

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
  console.log('🧪 SUITE: SHOPIFY WEBHOOKS, HMAC, DEDUPLICACIÓN Y OPERACIONES CANÓNICAS');
  console.log('======================================================================\n');

  let passCount = 0;
  let failCount = 0;

  function runTest(name, fn) {
    return (async () => {
      try {
        console.log(`▶ TEST: ${name}`);
        await fn();
        console.log(`  ✅ PASS: ${name}\n`);
        passCount++;
      } catch (err) {
        console.error(`  ❌ FAIL: ${name}`);
        console.error(err);
        console.log('\n');
        failCount++;
      }
    })();
  }

  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  const testTenantId = 'tenant_wh_test_123';
  const testIntegrationId = 'integ_wh_test_456';
  const testShopDomain = 'velion-dev.myshopify.com';

  // 1. HMAC Validation
  await runTest('Verificación HMAC válida y rechazo de alteraciones', async () => {
    const rawBody = Buffer.from(JSON.stringify({ id: 12345, title: 'Snowboard Pro' }));
    const validHmac = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');

    const isValid = verifyShopifyWebhookHmac(rawBody, validHmac, secret);
    assert.strictEqual(isValid, true, 'HMAC legítimo debe ser aceptado');

    const tamperedBody = Buffer.from(JSON.stringify({ id: 12345, title: 'Snowboard Hacked' }));
    const isTamperedValid = verifyShopifyWebhookHmac(tamperedBody, validHmac, secret);
    assert.strictEqual(isTamperedValid, false, 'Cuerpo alterado debe ser rechazado');

    const invalidSecret = verifyShopifyWebhookHmac(rawBody, validHmac, 'wrong_secret');
    assert.strictEqual(invalidSecret, false, 'Secret incorrecto debe ser rechazado');
  });

  // 2. Mock Prisma Store para pruebas unitarias de persistencia
  const mockDb = {
    processedWebhooks: new Map(),
    externalProducts: new Map(),
    externalVariants: new Map(),
    integrations: new Map([
      [
        testShopDomain,
        {
          id: testIntegrationId,
          tenantId: testTenantId,
          shopDomain: testShopDomain,
          status: 'CONNECTED',
          provider: 'SHOPIFY',
        },
      ],
    ]),

    processedWebhook: {
      findUnique: async ({ where }) => mockDb.processedWebhooks.get(where.id) || null,
      upsert: async ({ where, create, update }) => {
        const item = { ...create, ...update, id: where.id };
        mockDb.processedWebhooks.set(where.id, item);
        return item;
      },
    },

    integration: {
      findFirst: async ({ where }) => {
        for (const integ of mockDb.integrations.values()) {
          if (
            (!where.provider || integ.provider === where.provider) &&
            (!where.shopDomain || integ.shopDomain === where.shopDomain) &&
            (!where.status || integ.status === where.status)
          ) {
            return integ;
          }
        }
        return null;
      },
      findUnique: async () => mockDb.integrations.get(testShopDomain),
    },

    externalProduct: {
      upsert: async ({ where, update, create }) => {
        const key = `${where.tenantId_provider_externalId.tenantId}_${where.tenantId_provider_externalId.externalId}`;
        const existing = mockDb.externalProducts.get(key);
        const item = existing ? { ...existing, ...update } : { id: 'ep_' + Date.now(), ...create };
        mockDb.externalProducts.set(key, item);
        return item;
      },
      findUnique: async ({ where }) => {
        if (where.id) {
          for (const p of mockDb.externalProducts.values()) {
            if (p.id === where.id) return p;
          }
        }
        if (where.tenantId_provider_externalId) {
          const key = `${where.tenantId_provider_externalId.tenantId}_${where.tenantId_provider_externalId.externalId}`;
          return mockDb.externalProducts.get(key) || null;
        }
        return null;
      },
      delete: async ({ where }) => {
        for (const [key, p] of mockDb.externalProducts.entries()) {
          if (p.id === where.id) {
            mockDb.externalProducts.delete(key);
            // Cascada variantes
            for (const [vKey, v] of mockDb.externalVariants.entries()) {
              if (v.externalProductId === where.id) {
                mockDb.externalVariants.delete(vKey);
              }
            }
            return p;
          }
        }
      },
      update: async ({ where, data }) => {
        for (const [key, p] of mockDb.externalProducts.entries()) {
          if (p.id === where.id) {
            const updated = { ...p, ...data };
            mockDb.externalProducts.set(key, updated);
            return updated;
          }
        }
      },
    },

    externalProductVariant: {
      upsert: async ({ where, update, create }) => {
        const key = `${where.tenantId_provider_externalVariantId.tenantId}_${where.tenantId_provider_externalVariantId.externalVariantId}`;
        const existing = mockDb.externalVariants.get(key);
        const item = existing ? { ...existing, ...update } : { id: 'ev_' + Date.now(), ...create };
        mockDb.externalVariants.set(key, item);
        return item;
      },
      findMany: async ({ where }) => {
        const res = [];
        for (const v of mockDb.externalVariants.values()) {
          if (where.tenantId && v.tenantId !== where.tenantId) continue;
          if (where.provider && v.provider !== where.provider) continue;
          if (where.inventoryItemId && v.inventoryItemId !== where.inventoryItemId) continue;
          if (where.externalProductId && v.externalProductId !== where.externalProductId) continue;
          res.push(v);
        }
        return res;
      },
      update: async ({ where, data }) => {
        for (const [key, v] of mockDb.externalVariants.entries()) {
          if (v.id === where.id) {
            const updated = { ...v, ...data };
            mockDb.externalVariants.set(key, updated);
            return updated;
          }
        }
      },
    },

    $executeRawUnsafe: async () => {},
    $transaction: async (fn) => fn(mockDb),
  };

  // 3. Durable Deduplication
  await runTest('Deduplicación durable con X-Shopify-Webhook-Id', async () => {
    const webhookId = 'wh_dedupe_test_' + Date.now();

    const before = await isWebhookProcessed(webhookId, mockDb);
    assert.strictEqual(before, false, 'Antes de registrar, no debe estar procesado');

    await recordProcessedWebhook(
      {
        webhookId,
        topic: 'products/update',
        shopDomain: testShopDomain,
        tenantId: testTenantId,
      },
      mockDb
    );

    const after = await isWebhookProcessed(webhookId, mockDb);
    assert.strictEqual(after, true, 'Tras registro durable, debe figurar como procesado');
  });

  // 4. Products Create & Update
  await runTest('products/create y products/update actualizan catálogo canónico', async () => {
    const payload = {
      id: 9988776655,
      title: 'Snowboard Powder Master',
      body_html: '<p>Diseñado para nieve virgen</p>',
      status: 'active',
      product_type: 'Snowboards',
      tags: 'powder, winter, sports',
      images: [
        { src: 'https://cdn.shopify.com/powder-master.jpg' },
      ],
      variants: [
        {
          id: 11223344,
          title: '158cm',
          sku: 'POW-158',
          price: '849.99',
          inventory_quantity: 15,
          inventory_item_id: 55667788,
          inventory_policy: 'deny',
        },
      ],
    };

    const prod = await processProductCreateOrUpdate(testTenantId, testIntegrationId, payload, mockDb);
    assert.ok(prod, 'El producto debe ser creado');
    assert.strictEqual(prod.title, 'Snowboard Powder Master');
    assert.strictEqual(prod.isAvailable, true);

    const variantKey = `${testTenantId}_gid://shopify/ProductVariant/11223344`;
    const variant = mockDb.externalVariants.get(variantKey);
    assert.ok(variant, 'Variante debe ser creada');
    assert.strictEqual(variant.price, 849.99);
    assert.strictEqual(variant.inventoryQuantity, 15);
    assert.strictEqual(variant.sku, 'POW-158');

    // Update
    payload.title = 'Snowboard Powder Master 2026';
    payload.variants[0].price = '899.99';
    const updatedProd = await processProductCreateOrUpdate(testTenantId, testIntegrationId, payload, mockDb);
    assert.strictEqual(updatedProd.title, 'Snowboard Powder Master 2026');
    assert.strictEqual(mockDb.externalVariants.get(variantKey).price, 899.99);
  });

  // 5. Inventory Level Update
  await runTest('inventory_levels/update actualiza stock y disponibilidad', async () => {
    const invPayload = {
      inventory_item_id: 55667788,
      available: 0,
    };

    const res = await processInventoryLevelUpdate(testTenantId, invPayload, mockDb);
    assert.strictEqual(res.updated, true);
    assert.strictEqual(res.variantCount, 1);

    const variantKey = `${testTenantId}_gid://shopify/ProductVariant/11223344`;
    const variant = mockDb.externalVariants.get(variantKey);
    assert.strictEqual(variant.inventoryQuantity, 0);

    const prodKey = `${testTenantId}_gid://shopify/Product/9988776655`;
    const product = mockDb.externalProducts.get(prodKey);
    assert.strictEqual(product.isAvailable, false, 'Con stock 0 y policy deny, disponibilidad pasa a false');

    // Restaurar inventario a >0
    invPayload.available = 25;
    await processInventoryLevelUpdate(testTenantId, invPayload, mockDb);
    assert.strictEqual(mockDb.externalVariants.get(variantKey).inventoryQuantity, 25);
    assert.strictEqual(mockDb.externalProducts.get(prodKey).isAvailable, true, 'Con stock >0, disponible pasa a true');
  });

  // 6. Products Delete
  await runTest('products/delete elimina el producto y sus variantes', async () => {
    const deletePayload = { id: 9988776655 };
    const res = await processProductDelete(testTenantId, deletePayload, mockDb);
    assert.strictEqual(res.deleted, true);

    const prodKey = `${testTenantId}_gid://shopify/Product/9988776655`;
    assert.strictEqual(mockDb.externalProducts.has(prodKey), false, 'Producto debe haber sido eliminado');
    const variantKey = `${testTenantId}_gid://shopify/ProductVariant/11223344`;
    assert.strictEqual(mockDb.externalVariants.has(variantKey), false, 'Variantes deben ser eliminadas en cascada');
  });

  // 7. Security: Rejection of unknown shops & invalid HMAC in Controller
  await runTest('Controller rechaza firmas falsas y tiendas no registradas con 401', async () => {
    const rawBody = Buffer.from(JSON.stringify({ id: 111, title: 'Unknown' }));
    const invalidHmac = 'invalid_base64_signature==';

    const req1 = {
      headers: {
        'x-shopify-hmac-sha256': invalidHmac,
        'x-shopify-shop-domain': testShopDomain,
        'x-shopify-topic': 'products/create',
      },
      rawBody,
      body: JSON.parse(rawBody.toString()),
    };
    const res1 = mockRes();
    await handleShopifyWebhook(req1, res1, { prismaClient: mockDb });
    assert.strictEqual(res1.statusCode, 401, 'Debe rechazar con 401 por firma HMAC inválida');

    const validHmac = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    const req2 = {
      headers: {
        'x-shopify-hmac-sha256': validHmac,
        'x-shopify-shop-domain': 'malicious-store.myshopify.com',
        'x-shopify-topic': 'products/create',
      },
      rawBody,
      body: JSON.parse(rawBody.toString()),
    };
    const res2 = mockRes();
    await handleShopifyWebhook(req2, res2, { prismaClient: mockDb });
    assert.strictEqual(res2.statusCode, 401, 'Debe rechazar con 401 por tienda desconocida');

    // Test de éxito síncrono y deduplicación en Controller
    const webhookId = 'wh_ctrl_success_' + Date.now();
    const successPayload = Buffer.from(JSON.stringify({
      id: 5544332211,
      title: 'Valid Webhook Product',
      variants: [{ id: 98765, price: '100.00', inventory_quantity: 5 }]
    }));
    const successHmac = crypto.createHmac('sha256', secret).update(successPayload).digest('base64');
    const reqSuccess = {
      headers: {
        'x-shopify-hmac-sha256': successHmac,
        'x-shopify-shop-domain': testShopDomain,
        'x-shopify-topic': 'products/create',
        'x-shopify-webhook-id': webhookId,
      },
      rawBody: successPayload,
      body: JSON.parse(successPayload.toString()),
    };
    const resSuccess = mockRes();
    await handleShopifyWebhook(reqSuccess, resSuccess, { prismaClient: mockDb });
    assert.strictEqual(resSuccess.statusCode, 200, 'Debe responder 200 OK tras persistencia');
    assert.strictEqual(resSuccess.body.success, true);

    // Reenvío del mismo webhookId debe retornar 200 con deduplicated: true
    const resDup = mockRes();
    await handleShopifyWebhook(reqSuccess, resDup, { prismaClient: mockDb });
    assert.strictEqual(resDup.statusCode, 200, 'Debe responder 200 OK a reintento');
    assert.strictEqual(resDup.body.deduplicated, true, 'Debe indicar deduplicated: true');
  });

  console.log('======================================================================');
  console.log(`📊 RESULTADOS: TOTAL_TESTS=${passCount + failCount} | PASS=${passCount} | FAIL=${failCount}`);
  console.log('======================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
})();
