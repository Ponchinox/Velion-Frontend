import prisma from '../db.js';

/**
 * ORDER CONTROLLER (TENANT-SCOPED)
 * ================================
 * Controladores para el módulo de Pedidos del Dashboard de Velion.
 *
 * Garantías de Seguridad:
 * - req.user.tenantId es la única fuente de verdad para tenant isolation.
 * - No se exponen tokens, secretos ni metadata interna sensible.
 * - Validación y sanitización estricta de parámetros de consulta.
 */

/**
 * GET /api/orders
 * Lista paginada de órdenes del tenant autenticado con soporte para filtros y búsqueda.
 */
export async function getOrders(req, res) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: 'Contexto de tenant requerido.' });
  }

  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const { status, externalProvider, search } = req.query;

    const where = { tenantId };

    // Filtro por estado
    if (status && typeof status === 'string' && status.trim() !== '') {
      where.status = status.trim();
    }

    // Filtro por proveedor externo (VELION vs SHOPIFY)
    if (externalProvider && typeof externalProvider === 'string' && externalProvider.trim() !== '') {
      const providerUpper = externalProvider.trim().toUpperCase();
      if (providerUpper === 'VELION') {
        where.OR = [
          { externalProvider: null },
          { externalProvider: 'VELION' },
        ];
      } else {
        where.externalProvider = providerUpper;
      }
    }

    // Filtro de búsqueda textual (cliente nombre, teléfono, externalOrderNumber o ID)
    if (search && typeof search === 'string' && search.trim() !== '') {
      const searchTrim = search.trim();
      const searchConditions = [
        { customer: { name: { contains: searchTrim, mode: 'insensitive' } } },
        { customer: { phone: { contains: searchTrim } } },
        { externalOrderNumber: { contains: searchTrim, mode: 'insensitive' } },
      ];

      // Si parece UUID, también buscar por id exacto
      if (/^[0-9a-fA-F-]{8,36}$/.test(searchTrim)) {
        searchConditions.push({ id: { contains: searchTrim } });
      }

      if (where.OR) {
        where.AND = [
          { OR: where.OR },
          { OR: searchConditions },
        ];
        delete where.OR;
      } else {
        where.OR = searchConditions;
      }
    }

    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: {
              name: true,
              phone: true,
            },
          },
          _count: {
            select: {
              items: true,
            },
          },
        },
      }),
    ]);

    const items = orders.map((order) => {
      const orderNumber =
        order.externalOrderNumber ||
        `#${order.id.slice(0, 8).toUpperCase()}`;

      return {
        id: order.id,
        orderNumber,
        customerName: order.customer?.name || 'Cliente sin nombre',
        customerPhone: order.customer?.phone || null,
        status: order.status,
        paymentStatus: order.paymentStatus,
        totalAmount: order.totalAmount,
        currencyCode: order.currencyCode || 'PEN',
        externalProvider: order.externalProvider || 'VELION',
        externalSyncStatus: order.externalSyncStatus || 'NOT_STARTED',
        externalOrderNumber: order.externalOrderNumber || null,
        externalCheckoutUrlPresent: Boolean(order.externalCheckoutUrl),
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        itemCount: order._count?.items || 0,
      };
    });

    return res.json({
      items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    console.error('[Orders Controller] Error al listar pedidos:', error.message);
    return res.status(500).json({ error: 'Error interno al consultar pedidos.' });
  }
}

/**
 * GET /api/orders/:id
 * Retorna el detalle completo de un pedido del tenant autenticado con sus items y customer.
 */
export async function getOrderById(req, res) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: 'Contexto de tenant requerido.' });
  }

  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'ID de pedido requerido.' });
  }

  try {
    const order = await prisma.order.findFirst({
      where: {
        id,
        tenantId, // Aislamiento estricto de tenant
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        items: {
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }

    const orderNumber =
      order.externalOrderNumber ||
      `#${order.id.slice(0, 8).toUpperCase()}`;

    return res.json({
      id: order.id,
      orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      shippingCity: order.shippingCity,
      shippingAddress: order.shippingAddress,
      customerNeeds: order.customerNeeds,
      totalAmount: order.totalAmount,
      currencyCode: order.currencyCode || 'PEN',
      externalProvider: order.externalProvider || 'VELION',
      externalDraftOrderId: order.externalDraftOrderId,
      externalOrderId: order.externalOrderId,
      externalOrderNumber: order.externalOrderNumber,
      externalCheckoutUrl: order.externalCheckoutUrl,
      externalSyncStatus: order.externalSyncStatus || 'NOT_STARTED',
      externalSyncAttempts: order.externalSyncAttempts,
      externalSyncError: order.externalSyncError,
      externalSyncedAt: order.externalSyncedAt,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      customer: order.customer,
      items: (order.items || []).map((item) => ({
        id: item.id,
        name: item.name,
        variant: item.variant,
        quantity: item.quantity,
        price: item.price,
        subtotal: Number((item.price * item.quantity).toFixed(2)),
        sourceProvider: item.sourceProvider || 'VELION',
        sourceSku: item.sourceSku,
      })),
    });
  } catch (error) {
    console.error('[Orders Controller] Error al obtener detalle de pedido:', error.message);
    return res.status(500).json({ error: 'Error interno al consultar detalle de pedido.' });
  }
}
