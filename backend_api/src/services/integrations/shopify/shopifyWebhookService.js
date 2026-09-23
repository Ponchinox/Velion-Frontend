/**
 * SHOPIFY WEBHOOK SERVICE
 * =======================
 * Gestiona el registro automático, validación criptográfica, deduplicación persistente en PostgreSQL
 * y procesamiento idempotente de eventos de catálogo e inventario provenientes de Shopify Webhooks.
 *
 * Topics soportados:
 * - products/create
 * - products/update
 * - products/delete
 * - inventory_levels/update
 *
 * Shopify es la única fuente de verdad; los webhooks actualizan el catálogo local en caché de Velion.
 */

import crypto from 'crypto';
import prisma from '../../../db.js';
import { getShopifyConfig } from './shopifyConfig.js';
import { canonicalizeShopDomain } from './shopifyDomain.js';
import { executeShopifyGraphql } from './shopifyGraphqlClient.js';

// Cache en memoria para deduplicación ultra-rápida (coalescing) respaldado por PostgreSQL
const memoryDedupeCache = new Map();
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

// Lista canónica de topics requeridos en formato GraphQL enum
export const REQUIRED_WEBHOOK_TOPICS = [
  'PRODUCTS_CREATE',
  'PRODUCTS_UPDATE',
  'PRODUCTS_DELETE',
  'INVENTORY_LEVELS_UPDATE',
];

// Mapeo entre topics HTTP enviados en header 'X-Shopify-Topic' y nombres canónicos
export const TOPIC_MAP = {
  'products/create': 'PRODUCTS_CREATE',
  'products/update': 'PRODUCTS_UPDATE',
  'products/delete': 'PRODUCTS_DELETE',
  'inventory_levels/update': 'INVENTORY_LEVELS_UPDATE',
};

/**
 * Asegura la existencia de la tabla ProcessedWebhook en PostgreSQL para deduplicación durable.
 */
let tableEnsured = false;
export async function ensureProcessedWebhookTable(prismaClient = prisma) {
  if (tableEnsured) return;
  try {
    await prismaClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ProcessedWebhook" (
        "id" VARCHAR(255) PRIMARY KEY,
        "topic" VARCHAR(100) NOT NULL,
        "shopDomain" VARCHAR(255) NOT NULL,
        "tenantId" VARCHAR(255),
        "processedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS "ProcessedWebhook_shopDomain_idx" ON "ProcessedWebhook"("shopDomain");
      CREATE INDEX IF NOT EXISTS "ProcessedWebhook_processedAt_idx" ON "ProcessedWebhook"("processedAt");
    `);
    tableEnsured = true;
  } catch (err) {
    // Si ya existe o hay concurrencia, marcar como asegurada
    tableEnsured = true;
  }
}

/**
 * Valida la firma criptográfica HMAC-SHA256 enviada por Shopify usando el raw body.
 *
 * @param {Buffer|string} rawBody - Buffer binario exacto de la petición HTTP
 * @param {string} hmacHeader - Valor del header 'X-Shopify-Hmac-Sha256'
 * @param {string} clientSecret - SHOPIFY_CLIENT_SECRET configurado
 * @returns {boolean}
 */
export function verifyShopifyWebhookHmac(rawBody, hmacHeader, clientSecret) {
  if (!rawBody || !hmacHeader || !clientSecret) {
    return false;
  }

  try {
    const computedHmac = crypto
      .createHmac('sha256', clientSecret)
      .update(rawBody)
      .digest('base64');

    const headerBuf = Buffer.from(hmacHeader, 'base64');
    const computedBuf = Buffer.from(computedHmac, 'base64');

    if (headerBuf.length !== computedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(headerBuf, computedBuf);
  } catch (err) {
    console.error('[Shopify Webhook] Error verificando HMAC:', err.message);
    return false;
  }
}

/**
 * Comprueba de forma durable si un webhook ya fue procesado previamente.
 *
 * @param {string} webhookId - Valor del header 'X-Shopify-Webhook-Id'
 * @param {Object} [prismaClient]
 * @returns {Promise<boolean>}
 */
export async function isWebhookProcessed(webhookId, prismaClient = prisma) {
  if (!webhookId) return false;

  // 1. Revisar cache rápido en memoria
  if (memoryDedupeCache.has(webhookId)) {
    return true;
  }

  // 2. Revisar persistencia en PostgreSQL
  await ensureProcessedWebhookTable(prismaClient);
  try {
    const existing = await prismaClient.processedWebhook.findUnique({
      where: { id: webhookId },
    });

    if (existing) {
      memoryDedupeCache.set(webhookId, Date.now());
      return true;
    }
  } catch (err) {
    console.warn('[Shopify Webhook] Error al consultar ProcessedWebhook en DB:', err.message);
  }

  return false;
}

/**
 * Registra de forma durable que un webhook fue procesado con éxito.
 *
 * @param {Object} params
 * @param {string} params.webhookId
 * @param {string} params.topic
 * @param {string} params.shopDomain
 * @param {string} [params.tenantId]
 * @param {Object} [prismaClient]
 */
export async function recordProcessedWebhook(
  { webhookId, topic, shopDomain, tenantId },
  prismaClient = prisma
) {
  if (!webhookId) return;

  // 1. Guardar en memoria
  memoryDedupeCache.set(webhookId, Date.now());

  // Limpieza periódica de memoria si supera 10,000 entradas
  if (memoryDedupeCache.size > 10000) {
    const now = Date.now();
    for (const [id, time] of memoryDedupeCache.entries()) {
      if (now - time > DEDUPE_TTL_MS) {
        memoryDedupeCache.delete(id);
      }
    }
  }

  // 2. Guardar en PostgreSQL
  await ensureProcessedWebhookTable(prismaClient);
  try {
    await prismaClient.processedWebhook.upsert({
      where: { id: webhookId },
      update: { processedAt: new Date() },
      create: {
        id: webhookId,
        topic,
        shopDomain,
        tenantId: tenantId || null,
      },
    });
  } catch (err) {
    console.error('[Shopify Webhook] Error registrando ProcessedWebhook en DB:', err.message);
  }
}

/**
 * Registra automáticamente las suscripciones de webhooks requeridas en Shopify GraphQL.
 * Es idempotente: solo crea las que no existan previamente.
 *
 * @param {string} tenantId
 * @param {Object} [options]
 * @param {string} [options.callbackUrl]
 * @param {Object} [options.prismaClient]
 * @returns {Promise<Array<Object>>} Lista de webhooks registrados/activos
 */
export async function registerShopifyWebhooks(
  tenantId,
  { callbackUrl, prismaClient = prisma } = {}
) {
  const integration = await prismaClient.integration.findUnique({
    where: {
      tenantId_provider: {
        tenantId,
        provider: 'SHOPIFY',
      },
    },
  });

  if (!integration || integration.status !== 'CONNECTED') {
    throw new Error('La integración de Shopify no está conectada para este tenant.');
  }

  const publicCallbackUrl =
    callbackUrl || 'https://185.163.116.210/api/integrations/shopify/webhook';

  // 1. Consultar suscripciones existentes
  const queryExisting = `
    query getWebhooks {
      webhookSubscriptions(first: 50) {
        nodes {
          id
          topic
          endpoint {
            __typename
            ... on WebhookHttpEndpoint {
              callbackUrl
            }
          }
        }
      }
    }
  `;

  const existingRes = await executeShopifyGraphql(tenantId, {
    query: queryExisting,
    prismaClient,
  });

  const existingNodes = existingRes?.data?.webhookSubscriptions?.nodes || [];
  const existingTopics = new Set(
    existingNodes
      .filter((n) => n.endpoint?.callbackUrl === publicCallbackUrl)
      .map((n) => n.topic)
  );

  const mutationCreate = `
    mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
        userErrors {
          field
          message
        }
        webhookSubscription {
          id
          topic
          endpoint {
            __typename
            ... on WebhookHttpEndpoint {
              callbackUrl
            }
          }
        }
      }
    }
  `;

  const results = [];

  for (const topic of REQUIRED_WEBHOOK_TOPICS) {
    if (existingTopics.has(topic)) {
      results.push({ topic, status: 'ALREADY_EXISTS' });
      continue;
    }

    try {
      const resp = await executeShopifyGraphql(tenantId, {
        query: mutationCreate,
        variables: {
          topic,
          webhookSubscription: {
            callbackUrl: publicCallbackUrl,
            format: 'JSON',
          },
        },
        prismaClient,
      });

      const userErrors = resp?.data?.webhookSubscriptionCreate?.userErrors || [];
      if (userErrors.length > 0) {
        console.warn(`[Shopify Webhook] Advertencia registrando ${topic}:`, userErrors);
        results.push({ topic, status: 'ERROR', errors: userErrors });
      } else {
        const sub = resp?.data?.webhookSubscriptionCreate?.webhookSubscription;
        results.push({ topic, status: 'REGISTERED', id: sub?.id });
      }
    } catch (err) {
      console.error(`[Shopify Webhook] Error registrando suscripción ${topic}:`, err.message);
      results.push({ topic, status: 'FAILED', error: err.message });
    }
  }

  return results;
}

/**
 * Normaliza y formatea un external ID a GID de Shopify.
 */
function toProductGid(id) {
  if (!id) return '';
  const str = String(id);
  return str.startsWith('gid://shopify/Product/') ? str : `gid://shopify/Product/${str}`;
}

function toVariantGid(id) {
  if (!id) return '';
  const str = String(id);
  return str.startsWith('gid://shopify/ProductVariant/') ? str : `gid://shopify/ProductVariant/${str}`;
}

function toInventoryItemGid(id) {
  if (!id) return null;
  const str = String(id);
  return str.startsWith('gid://shopify/InventoryItem/') ? str : `gid://shopify/InventoryItem/${str}`;
}

/**
 * Procesa la creación o actualización de un producto proveniente de Shopify.
 */
export async function processProductCreateOrUpdate(
  tenantId,
  integrationId,
  payload,
  prismaClient = prisma
) {
  if (!payload || !payload.id) {
    throw new Error('Payload inválido para producto Shopify: falta id');
  }

  const externalId = toProductGid(payload.id);
  const title = payload.title || 'Sin Título';
  const description = payload.body_html || payload.description || '';
  const isAvailable = (payload.status || 'active').toLowerCase() === 'active';
  const category = payload.product_type || null;

  // Extraer etiquetas
  let tags = [];
  if (Array.isArray(payload.tags)) {
    tags = payload.tags;
  } else if (typeof payload.tags === 'string') {
    tags = payload.tags.split(',').map((t) => t.trim()).filter(Boolean);
  }

  // Extraer imágenes
  let images = [];
  if (Array.isArray(payload.images)) {
    images = payload.images
      .map((img) => (typeof img === 'string' ? img : img?.src || img?.url))
      .filter(Boolean);
  } else if (payload.image && (payload.image.src || payload.image.url)) {
    images = [payload.image.src || payload.image.url];
  }
  const imageUrl = images[0] || null;

  // Variantes
  const variants = Array.isArray(payload.variants) ? payload.variants : [];

  // Transacción atómica: Upsert producto y recrear/actualizar variantes
  return await prismaClient.$transaction(async (tx) => {
    const product = await tx.externalProduct.upsert({
      where: {
        tenantId_provider_externalId: {
          tenantId,
          provider: 'SHOPIFY',
          externalId,
        },
      },
      update: {
        title,
        description,
        isAvailable,
        category,
        tags,
        imageUrl,
        images,
        syncedAt: new Date(),
        lastEventTriggeredAt: new Date(),
      },
      create: {
        tenantId,
        integrationId,
        provider: 'SHOPIFY',
        externalId,
        title,
        description,
        isAvailable,
        category,
        tags,
        imageUrl,
        images,
        syncedAt: new Date(),
        lastEventTriggeredAt: new Date(),
      },
    });

    for (const v of variants) {
      if (!v.id) continue;
      const externalVariantId = toVariantGid(v.id);
      const inventoryItemId = toInventoryItemGid(v.inventory_item_id || v.inventoryItemId);
      const price = parseFloat(v.price) || 0;
      const compareAtPrice = v.compare_at_price ? parseFloat(v.compare_at_price) : null;
      const inventoryQuantity = Number.isInteger(v.inventory_quantity) ? v.inventory_quantity : 0;
      const availableForSale =
        inventoryQuantity > 0 ||
        v.inventory_policy === 'continue' ||
        v.availableForSale === true;

      await tx.externalProductVariant.upsert({
        where: {
          tenantId_provider_externalVariantId: {
            tenantId,
            provider: 'SHOPIFY',
            externalVariantId,
          },
        },
        update: {
          externalProductId: product.id,
          inventoryItemId,
          sku: v.sku || null,
          normalizedSku: v.sku ? v.sku.trim().toUpperCase() : null,
          title: v.title || 'Default Title',
          price,
          compareAtPrice,
          inventoryQuantity,
          availableForSale,
          syncedAt: new Date(),
          lastEventTriggeredAt: new Date(),
        },
        create: {
          tenantId,
          externalProductId: product.id,
          provider: 'SHOPIFY',
          externalVariantId,
          inventoryItemId,
          sku: v.sku || null,
          normalizedSku: v.sku ? v.sku.trim().toUpperCase() : null,
          title: v.title || 'Default Title',
          price,
          compareAtPrice,
          inventoryQuantity,
          availableForSale,
          syncedAt: new Date(),
          lastEventTriggeredAt: new Date(),
        },
      });
    }

    return product;
  });
}

/**
 * Procesa la eliminación de un producto proveniente de Shopify.
 */
export async function processProductDelete(tenantId, payload, prismaClient = prisma) {
  if (!payload || !payload.id) {
    throw new Error('Payload inválido para eliminación de producto: falta id');
  }

  const externalId = toProductGid(payload.id);

  try {
    const existing = await prismaClient.externalProduct.findUnique({
      where: {
        tenantId_provider_externalId: {
          tenantId,
          provider: 'SHOPIFY',
          externalId,
        },
      },
    });

    if (existing) {
      await prismaClient.externalProduct.delete({
        where: { id: existing.id },
      });
      return { deleted: true, id: existing.id };
    }
    return { deleted: false, reason: 'NOT_FOUND' };
  } catch (err) {
    console.error('[Shopify Webhook] Error eliminando ExternalProduct:', err.message);
    throw err;
  }
}

/**
 * Procesa la actualización de nivel de inventario proveniente de Shopify.
 */
export async function processInventoryLevelUpdate(tenantId, payload, prismaClient = prisma) {
  if (!payload || payload.inventory_item_id === undefined) {
    throw new Error('Payload inválido para actualización de inventario: falta inventory_item_id');
  }

  const inventoryItemId = toInventoryItemGid(payload.inventory_item_id);
  const newAvailable = Number.isInteger(payload.available) ? payload.available : 0;

  // Localizar todas las variantes que usan este inventoryItemId
  const variants = await prismaClient.externalProductVariant.findMany({
    where: {
      tenantId,
      provider: 'SHOPIFY',
      inventoryItemId,
    },
    include: {
      externalProduct: true,
    },
  });

  if (variants.length === 0) {
    return { updated: false, reason: 'NO_MATCHING_VARIANTS' };
  }

  const productIdsToReevaluate = new Set();

  await prismaClient.$transaction(async (tx) => {
    for (const variant of variants) {
      await tx.externalProductVariant.update({
        where: { id: variant.id },
        data: {
          inventoryQuantity: newAvailable,
          availableForSale: newAvailable > 0,
          syncedAt: new Date(),
          lastEventTriggeredAt: new Date(),
        },
      });
      productIdsToReevaluate.add(variant.externalProductId);
    }

    // Reevaluar disponibilidad general de cada producto padre
    for (const prodId of productIdsToReevaluate) {
      const allVars = await tx.externalProductVariant.findMany({
        where: { externalProductId: prodId },
      });

      const hasStock = allVars.some((v) => v.inventoryQuantity > 0 || v.availableForSale);

      await tx.externalProduct.update({
        where: { id: prodId },
        data: {
          isAvailable: hasStock,
          syncedAt: new Date(),
          lastEventTriggeredAt: new Date(),
        },
      });
    }
  });

  return { updated: true, variantCount: variants.length };
}
