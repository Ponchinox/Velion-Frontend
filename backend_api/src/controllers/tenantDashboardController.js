import prisma from '../db.js';

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

    // Ejecutar consultas en paralelo para mejorar el tiempo de respuesta
    const [
      totalContacts,
      newContactsToday,
      sentMessages,
      receivedMessages,
      openChats,
      closedChats,
      totalProducts,
      activePromosCount
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
      // 7. Total de productos en catálogo (relacionados vía User del Tenant)
      prisma.product.count({
        where: {
          user: { tenantId }
        }
      }),
      // 8. Promociones vigentes y activas hoy
      prisma.product.count({
        where: {
          user: { tenantId },
          promotionalPrice: { not: null },
          OR: [
            {
              AND: [
                { promoStartDate: { lte: now } },
                { promoEndDate: { gte: now } }
              ]
            },
            {
              AND: [
                { promoStartDate: null },
                { promoEndDate: null }
              ]
            },
            {
              AND: [
                { promoStartDate: null },
                { promoEndDate: { gte: now } }
              ]
            },
            {
              AND: [
                { promoStartDate: { lte: now } },
                { promoEndDate: null }
              ]
            }
          ]
        }
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
      }
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
      }
    });
  } catch (error) {
    console.error('❌ Error en assignPlan:', error);
    return res.status(500).json({ error: 'Error al asignar el plan al inquilino.' });
  }
}
