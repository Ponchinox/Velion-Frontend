import prisma from '../db.js';
import { commerceService } from '../services/commerce/CommerceService.js';
import { isPromotionActive } from '../services/commerce/canonicalPricing.js';

/**
 * Obtiene métricas agregadas en tiempo real para el Dashboard del Tenant actual
 */
export async function getTenantMetrics(req, res) {
  try {
    const tenantId = req.user.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Inquilino (Tenant).' });
    }

    const now = new Date();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    // Consultar configuración comercial del tenant para gobernanza de catálogo
    const tenantConfig = await commerceService.getTenantConfig(tenantId);
    const catalogMode = tenantConfig?.catalogMode || 'VELION_ONLY';

    let totalProductsPromise;
    if (catalogMode === 'VELION_ONLY') {
      totalProductsPromise = prisma.product.count({
        where: { user: { tenantId } }
      });
    } else if (catalogMode === 'SHOPIFY_ONLY') {
      totalProductsPromise = prisma.externalProduct.count({
        where: { tenantId }
      });
    } else {
      // COMBINED: Catálogo unificado a nivel PRODUCTO
      // Deduplica colisiones 1:1 por SKU si existen
      totalProductsPromise = (async () => {
        const [nativeProducts, externalProducts] = await Promise.all([
          prisma.product.findMany({
            where: { user: { tenantId } },
            select: { normalizedSku: true }
          }),
          prisma.externalProduct.findMany({
            where: { tenantId },
            select: { id: true, variants: { select: { normalizedSku: true } } }
          })
        ]);

        const nativeSkus = new Set(nativeProducts.map(p => p.normalizedSku).filter(Boolean));
        const collidingExternalProductIds = new Set();
        for (const ep of externalProducts) {
          for (const v of ep.variants) {
            if (v.normalizedSku && nativeSkus.has(v.normalizedSku)) {
              collidingExternalProductIds.add(ep.id);
            }
          }
        }
        return nativeProducts.length + (externalProducts.length - collidingExternalProductIds.size);
      })();
    }

    // Promociones vigentes y activas hoy (Velion Nativo)
    const activePromosPromise = (catalogMode === 'SHOPIFY_ONLY')
      ? Promise.resolve(0)
      : prisma.product.findMany({
          where: {
            user: { tenantId },
            promotionalPrice: { not: null, gt: 0 }
          },
          select: {
            price: true,
            promotionalPrice: true,
            promoStartDate: true,
            promoEndDate: true
          }
        }).then(prods => prods.filter(p => isPromotionActive(p, now)).length);

    // Ejecutar consultas en paralelo para mejorar el tiempo de respuesta
    const [
      totalContacts,
      newContactsToday,
      sentMessages,
      receivedMessages,
      openChats,
      closedChats,
      totalProducts,
      activePromosCount,
      notifications
    ] = await Promise.all([
      // 1. Total de contactos del CRM
      prisma.contact.count({
        where: { tenantId }
      }),
      // 2. Contactos registrados hoy
      prisma.contact.count({
        where: {
          tenantId,
          createdAt: { gte: startOfDay }
        }
      }),
      // 3. Mensajes enviados por el Bot/Agente (fromMe = true equivalente)
      prisma.message.count({
        where: {
          tenantId,
          senderRole: { in: ['agent', 'bot'] }
        }
      }),
      // 4. Mensajes recibidos del Cliente (fromMe = false equivalente)
      prisma.message.count({
        where: {
          tenantId,
          senderRole: 'contact'
        }
      }),
      // 5. Chats con estado abierto
      prisma.chat.count({
        where: {
          tenantId,
          status: 'open'
        }
      }),
      // 6. Chats con estado cerrado
      prisma.chat.count({
        where: {
          tenantId,
          status: 'closed'
        }
      }),
      // 7. Total de productos en catálogo unificado
      totalProductsPromise,
      // 8. Promociones vigentes y activas hoy
      activePromosPromise,
      // 9. Notificaciones recientes (Alertas)
      prisma.alert.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 6
      })
    ]);

    return res.status(200).json({
      contacts: {
        total: totalContacts,
        newToday: newContactsToday
      },
      messages: {
        sent: sentMessages,
        received: receivedMessages,
        total: sentMessages + receivedMessages
      },
      chats: {
        open: openChats,
        closed: closedChats,
        total: openChats + closedChats
      },
      products: {
        total: totalProducts,
        activePromotions: activePromosCount
      },
      notifications: notifications || []
    });

  } catch (error) {
    console.error('❌ Error en getTenantMetrics:', error);
    return res.status(500).json({ error: 'Error interno al calcular las métricas del inquilino.' });
  }
}

/**
 * POST /api/tenant/assign-plan
 * Permite al Tenant recién registrado o sin plan seleccionar y asignarse un plan
 */
export async function assignPlan(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { planId } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Inquilino.' });
    }

    if (!planId) {
      return res.status(400).json({ error: 'Debes proporcionar un planId válido.' });
    }

    // Buscar el plan seleccionado
    const selectedPlan = await prisma.plan.findUnique({
      where: { id: planId }
    });

    if (!selectedPlan || !selectedPlan.active) {
      return res.status(404).json({ error: 'El plan seleccionado no existe o no está activo.' });
    }

    // Actualizar el Tenant con los datos del nuevo Plan
    const updatedTenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        planId: selectedPlan.id,
        plan: selectedPlan.name,
        msgLimit: selectedPlan.msgLimit,
        connLimit: selectedPlan.connLimit,
        dailyTokenBudget: selectedPlan.dailyTokenBudget ?? 130000,
        monthlyTokenBudget: selectedPlan.monthlyTokenBudget ?? 2000000,
      }
    });

    return res.json({
      message: `Plan '${selectedPlan.name}' asignado con éxito.`,
      tenant: {
        id: updatedTenant.id,
        name: updatedTenant.name,
        plan: updatedTenant.plan,
        planId: updatedTenant.planId,
        hasPlan: true,
        msgLimit: updatedTenant.msgLimit,
        connLimit: updatedTenant.connLimit,
        dailyTokenBudget: updatedTenant.dailyTokenBudget,
        monthlyTokenBudget: updatedTenant.monthlyTokenBudget,
      }
    });
  } catch (error) {
    console.error('❌ Error en assignPlan:', error);
    return res.status(500).json({ error: 'Error al asignar el plan al inquilino.' });
  }
}
