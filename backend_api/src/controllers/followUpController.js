import defaultPrisma from '../db.js';
import { isValidIanaTimezone } from '../services/followUpService.js';

/**
 * followUpController.js — Endpoints de Gestión y Monitoreo de Follow-ups V1
 *
 * REGLA ESTRICTA DE SEGURIDAD:
 * Todos los endpoints operan EXCLUSIVAMENTE sobre req.user.tenantId (del JWT verificado).
 * Ninguna operación confía en un tenantId enviado por el cliente.
 */

/**
 * GET /api/follow-ups
 * Lista secuencias de seguimiento del tenant con filtros autoritativos y paginación.
 */
export async function getFollowUps(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized: missing tenantId' });
    }

    const { page = 1, limit = 20 } = req.query;
    const rawFilter = (req.query.view || req.query.tab || req.query.status || 'all').toString().trim().toLowerCase();

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = { tenantId };
    let orderBy = { updatedAt: 'desc' };

    if (rawFilter === 'active' || rawFilter === 'activos') {
      where.status = { in: ['SCHEDULED', 'PROCESSING', 'WAITING_NEXT'] };
      orderBy = [{ nextRunAt: 'asc' }, { updatedAt: 'desc' }];
    } else if (rawFilter === 'recovered' || rawFilter === 'recuperados') {
      where.status = 'RECOVERED';
      where.attempts = { some: { status: 'SENT' } };
      orderBy = [{ recoveredAt: 'desc' }, { updatedAt: 'desc' }];
    } else if (rawFilter === 'history' || rawFilter === 'historial') {
      where.status = { in: ['RECOVERED', 'EXHAUSTED', 'CANCELLED', 'NEUTRALIZED_INBOUND'] };
      orderBy = { updatedAt: 'desc' };
    } else if (rawFilter !== 'all' && rawFilter !== '') {
      where.status = rawFilter.toUpperCase();
    }

    const prisma = req.prismaClient || req.prisma || defaultPrisma;

    const [total, sequences] = await Promise.all([
      prisma.followUpSequence.count({ where }),
      prisma.followUpSequence.findMany({
        where,
        skip,
        take: limitNum,
        orderBy,
        include: {
          customer: {
            select: { id: true, name: true, phone: true, followUpSuppressed: true }
          },
          order: {
            select: { id: true, status: true, paymentStatus: true, totalAmount: true }
          },
          attempts: {
            orderBy: { attemptNumber: 'asc' },
            select: {
              id: true,
              attemptNumber: true,
              status: true,
              deliveryStatus: true,
              deliveredAt: true,
              readAt: true,
              scheduledAt: true,
              sentAt: true,
              sentMessage: true,
              provider: true,
              providerMessageId: true,
              errorMessage: true
            }
          }
        }
      })
    ]);

    // TC-DASH-08: Para secuencias terminales, el próximo envío debe ser null
    const TERMINAL_STATUSES = ['RECOVERED', 'EXHAUSTED', 'CANCELLED', 'NEUTRALIZED_INBOUND'];
    const sanitizedSequences = sequences.map(seq => {
      const isTerminal = TERMINAL_STATUSES.includes(seq.status);
      return {
        ...seq,
        nextRunAt: isTerminal ? null : seq.nextRunAt
      };
    });

    return res.json({
      success: true,
      data: sanitizedSequences,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum) || 1
      }
    });
  } catch (err) {
    console.error('❌ [FollowUp API] Error listando seguimientos:', err.message);
    return res.status(500).json({ error: 'Error interno al consultar seguimientos' });
  }
}

/**
 * GET /api/follow-ups/summary
 * Métricas transparentes y agregadas del tenant.
 */
export async function getFollowUpSummary(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized: missing tenantId' });
    }

    const prisma = req.prismaClient || req.prisma || defaultPrisma;

    const [
      activeSequences,
      recoveredCount,
      totalSentAttempts,
      exhaustedSequences,
      cancelledSequences,
      attributableSequences,
      sequencesWithSentAttempts,
      tenantRecord
    ] = await Promise.all([
      // Activos operacionales reales (excluye NEUTRALIZED_INBOUND y terminales)
      prisma.followUpSequence.count({
        where: { tenantId, status: { in: ['SCHEDULED', 'PROCESSING', 'WAITING_NEXT'] } }
      }),
      // Recuperaciones comerciales reales (status RECOVERED con al menos un follow-up SENT)
      prisma.followUpSequence.count({
        where: {
          tenantId,
          status: 'RECOVERED',
          attempts: { some: { status: 'SENT' } }
        }
      }),
      prisma.followUpAttempt.count({
        where: {
          status: 'SENT',
          sequence: { tenantId }
        }
      }),
      prisma.followUpSequence.count({
        where: { tenantId, status: 'EXHAUSTED' }
      }),
      prisma.followUpSequence.count({
        where: { tenantId, status: 'CANCELLED' }
      }),
      prisma.followUpSequence.findMany({
        where: {
          tenantId,
          recoveredOrderId: { not: null }
        },
        select: {
          id: true,
          recoveredOrderId: true,
          recoveredAt: true,
          attempts: {
            where: { status: 'SENT' },
            orderBy: { sentAt: 'desc' },
            select: { sentAt: true }
          }
        }
      }),
      // Denominador comercial: secuencias que efectivamente enviaron al menos un follow-up
      prisma.followUpSequence.count({
        where: {
          tenantId,
          attempts: { some: { status: 'SENT' } }
        }
      }),
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { followUpEnabled: true, timezone: true }
      })
    ]);

    // Calcular ventas atribuidas (órdenes pagadas autoritativas verificadas dentro de la ventana de 72h post-SENT)
    const ATTRIBUTION_WINDOW_MS = 72 * 3600 * 1000;
    const validAttributedOrderIds = [];

    for (const seq of attributableSequences) {
      const lastSent = seq.attempts?.[0];
      if (!lastSent?.sentAt || !seq.recoveredAt) continue;
      const diffMs = new Date(seq.recoveredAt).getTime() - new Date(lastSent.sentAt).getTime();
      if (diffMs >= 0 && diffMs <= ATTRIBUTION_WINDOW_MS) {
        validAttributedOrderIds.push(seq.recoveredOrderId);
      }
    }

    let attributedSalesCount = 0;
    let attributedSalesTotal = 0;

    if (validAttributedOrderIds.length > 0) {
      const paidOrders = await prisma.order.findMany({
        where: {
          id: { in: validAttributedOrderIds },
          tenantId,
          paymentStatus: 'PAID'
        },
        select: { id: true, totalAmount: true }
      });

      attributedSalesCount = paidOrders.length;
      attributedSalesTotal = paidOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    }

    // Tasa de recuperación: ratio de recuperados sobre secuencias que efectivamente enviaron follow-up (0 => 0%)
    const recoveryRate = sequencesWithSentAttempts > 0
      ? Number(((recoveredCount / sequencesWithSentAttempts) * 100).toFixed(1))
      : 0;

    const payload = {
      activeSequences,
      recoveredConversations: recoveredCount,
      totalSentAttempts,
      exhaustedSequences,
      cancelledSequences,
      attributedSalesCount,
      attributedSalesTotal,
      recoveryRate,
      followUpEnabled: tenantRecord?.followUpEnabled || false,
      timezone: tenantRecord?.timezone || null,
      // Alias directos para consumo en frontend
      activeCount: activeSequences,
      recoveredCount,
      recoveryRatePercent: recoveryRate
    };

    return res.json({
      success: true,
      metrics: payload,
      data: payload
    });
  } catch (err) {
    console.error('❌ [FollowUp API] Error calculando resumen:', err.message);
    return res.status(500).json({ error: 'Error interno al consultar métricas' });
  }
}

/**
 * PATCH /api/follow-ups/:id/cancel
 * Cancelación manual de una secuencia activa con verificación estricta de pertenencia al tenant.
 */
export async function cancelFollowUp(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    const { id } = req.params;

    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized: missing tenantId' });
    }

    const prisma = req.prismaClient || req.prisma || defaultPrisma;

    const sequence = await prisma.followUpSequence.findFirst({
      where: { id, tenantId }
    });

    if (!sequence) {
      return res.status(404).json({ error: 'Secuencia de seguimiento no encontrada o no pertenece a este tenant.' });
    }

    const terminalStatuses = ['RECOVERED', 'EXHAUSTED', 'CANCELLED', 'NEUTRALIZED_INBOUND'];
    if (terminalStatuses.includes(sequence.status)) {
      return res.status(400).json({ error: `La secuencia ya se encuentra en estado terminal (${sequence.status}).` });
    }

    const validReasons = ['MANUAL_CANCEL', 'MERCHANT_MANUAL', 'CUSTOMER_NOT_INTERESTED', 'OUT_OF_STOCK', 'OTHER'];
    const requestedReason = req.body?.reason;
    const resolvedReason = (requestedReason && validReasons.includes(requestedReason))
      ? (requestedReason === 'MERCHANT_MANUAL' ? 'MANUAL_CANCEL' : requestedReason)
      : 'MANUAL_CANCEL';

    await prisma.followUpSequence.update({
      where: { id: sequence.id },
      data: {
        status: 'CANCELLED',
        cancelReason: resolvedReason,
        updatedAt: new Date()
      }
    });

    return res.json({ success: true, message: 'Seguimiento cancelado exitosamente.' });
  } catch (err) {
    console.error('❌ [FollowUp API] Error cancelando seguimiento:', err.message);
    return res.status(500).json({ error: 'Error interno al cancelar seguimiento' });
  }
}

/**
 * PATCH /api/follow-ups/settings
 * Actualiza la configuración de Follow-ups V1 para el tenant autenticado.
 */
export async function updateSettings(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized: missing tenantId' });
    }

    const { followUpEnabled, timezone } = req.body;
    const prisma = req.prismaClient || req.prisma || defaultPrisma;

    const currentTenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true, followUpEnabled: true }
    });

    const updateData = {};

    if (timezone !== undefined) {
      if (timezone === null || timezone === '') {
        updateData.timezone = null;
      } else {
        if (!isValidIanaTimezone(timezone)) {
          return res.status(400).json({
            error: 'Zona horaria no válida. Proporcione un identificador IANA válido (ej. "America/Lima", "America/Bogota").'
          });
        }
        updateData.timezone = timezone.trim();
      }
    }

    if (followUpEnabled !== undefined) {
      const boolEnabled = Boolean(followUpEnabled);
      const effectiveTz = updateData.timezone !== undefined ? updateData.timezone : currentTenant?.timezone;

      // CORRECCIÓN #4: Para activar Follow-ups, el timezone es OBLIGATORIO y debe ser válido
      if (boolEnabled && !isValidIanaTimezone(effectiveTz)) {
        return res.status(400).json({
          error: 'Para activar los seguimientos automáticos debe configurar una zona horaria IANA válida.'
        });
      }
      updateData.followUpEnabled = boolEnabled;
    }

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: updateData,
      select: { id: true, followUpEnabled: true, timezone: true }
    });

    return res.json({
      success: true,
      message: 'Configuración de seguimientos actualizada exitosamente.',
      data: updated
    });
  } catch (err) {
    console.error('❌ [FollowUp API] Error actualizando configuración:', err.message);
    return res.status(500).json({ error: 'Error interno al actualizar configuración' });
  }
}
