/**
 * SHOPIFY WEBHOOK CONTROLLER
 * ==========================
 * Controlador receptor para peticiones de Shopify Webhooks.
 *
 * Características:
 * - Validación criptográfica estricta de HMAC-SHA256 con el raw body antes de cualquier deserialización.
 * - Identificación exclusiva de tienda mediante el header 'X-Shopify-Shop-Domain'.
 * - Verificación de Tenant/Integration activo en la base de datos (rechaza con 401 tiendas desconocidas).
 * - Deduplicación durable mediante PostgreSQL respaldada por 'X-Shopify-Webhook-Id'.
 * - Procesamiento síncrono y durable: responde 200 OK únicamente cuando la persistencia en DB fue confirmada.
 * - En caso de error, responde con 500 para permitir que Shopify reintente con backoff exponencial.
 * - Prevención absoluta de fugas de secretos y tokens en logs.
 */

import prisma from '../db.js';
import { getShopifyConfig } from '../services/integrations/shopify/shopifyConfig.js';
import { canonicalizeShopDomain } from '../services/integrations/shopify/shopifyDomain.js';
import {
  verifyShopifyWebhookHmac,
  isWebhookProcessed,
  recordProcessedWebhook,
  processProductCreateOrUpdate,
  processProductDelete,
  processInventoryLevelUpdate,
  TOPIC_MAP,
} from '../services/integrations/shopify/shopifyWebhookService.js';

export async function handleShopifyWebhook(req, res, { prismaClient = prisma } = {}) {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  const shopDomainHeader = req.headers['x-shopify-shop-domain'];
  const topicHeader = req.headers['x-shopify-topic'];
  const webhookIdHeader = req.headers['x-shopify-webhook-id'];

  // 1. Validar presencia de headers obligatorios
  if (!hmacHeader || !shopDomainHeader || !topicHeader) {
    console.warn('[Shopify Webhook] Petición rechazada: faltan headers requeridos de Shopify');
    return res.status(401).json({ error: 'Faltan headers obligatorios de Shopify' });
  }

  // 2. Validar firma HMAC con raw body
  const rawBody = req.rawBody;
  if (!rawBody) {
    console.error('[Shopify Webhook] Error crítico: rawBody no disponible en req');
    return res.status(500).json({ error: 'Buffer de cuerpo crudo no disponible' });
  }

  let config;
  try {
    config = getShopifyConfig();
  } catch (err) {
    console.error('[Shopify Webhook] Error leyendo configuración de Shopify:', err.message);
    return res.status(500).json({ error: 'Configuración del servidor incompleta' });
  }

  const isHmacValid = verifyShopifyWebhookHmac(rawBody, hmacHeader, config.clientSecret);
  if (!isHmacValid) {
    console.warn(`[Shopify Webhook] HMAC inválido para tienda: ${shopDomainHeader}`);
    return res.status(401).json({ error: 'Firma HMAC inválida' });
  }

  // 3. Normalizar e identificar la tienda en la base de datos
  let canonicalDomain;
  try {
    canonicalDomain = canonicalizeShopDomain(shopDomainHeader);
  } catch (err) {
    return res.status(400).json({ error: 'Dominio de tienda inválido' });
  }

  const integration = await prismaClient.integration.findFirst({
    where: {
      provider: 'SHOPIFY',
      shopDomain: canonicalDomain,
      status: 'CONNECTED',
    },
    select: {
      id: true,
      tenantId: true,
      shopDomain: true,
      status: true,
    },
  });

  if (!integration) {
    console.warn(`[Shopify Webhook] Tienda no registrada o no conectada: ${canonicalDomain}`);
    return res.status(401).json({ error: 'Tienda no registrada o no autorizada' });
  }

  const tenantId = integration.tenantId;

  // 4. Deduplicación durable mediante X-Shopify-Webhook-Id
  if (webhookIdHeader) {
    const alreadyProcessed = await isWebhookProcessed(webhookIdHeader, prismaClient);
    if (alreadyProcessed) {
      console.log(`[Shopify Webhook] Evento deduplicado (${webhookIdHeader}) para ${canonicalDomain}`);
      return res.status(200).json({ received: true, deduplicated: true, id: webhookIdHeader });
    }
  }

  // 5. Procesamiento del evento según topic
  const payload = req.body;
  const canonicalTopic = TOPIC_MAP[topicHeader] || topicHeader.toUpperCase().replace('/', '_');

  console.log(`[Shopify Webhook] Procesando ${canonicalTopic} para ${canonicalDomain} (ID: ${webhookIdHeader || 'N/A'})`);

  try {
    switch (topicHeader) {
      case 'products/create':
      case 'products/update': {
        await processProductCreateOrUpdate(tenantId, integration.id, payload, prismaClient);
        break;
      }

      case 'products/delete': {
        await processProductDelete(tenantId, payload, prismaClient);
        break;
      }

      case 'inventory_levels/update': {
        await processInventoryLevelUpdate(tenantId, payload, prismaClient);
        break;
      }

      default: {
        console.warn(`[Shopify Webhook] Topic no manejado activamente: ${topicHeader}`);
        break;
      }
    }

    // 6. Registrar webhook como procesado en PostgreSQL de forma durable
    if (webhookIdHeader) {
      await recordProcessedWebhook(
        {
          webhookId: webhookIdHeader,
          topic: topicHeader,
          shopDomain: canonicalDomain,
          tenantId,
        },
        prismaClient
      );
    }

    // 7. Responder 200 únicamente tras confirmación de persistencia
    return res.status(200).json({
      success: true,
      topic: topicHeader,
      shop: canonicalDomain,
      webhookId: webhookIdHeader,
    });
  } catch (err) {
    console.error(`[Shopify Webhook] Error al procesar ${topicHeader} para ${canonicalDomain}:`, err.message);
    // Devolver 500 para que Shopify reintente
    return res.status(500).json({ error: 'Error procesando webhook' });
  }
}
