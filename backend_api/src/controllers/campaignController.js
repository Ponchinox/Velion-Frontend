import prisma from '../db.js';
import { launchCampaignV2, runCampaignWorker } from '../services/campaignWorkerV2.js';

const VALID_RECURRENCES = ['NONE', 'EVERY_15_DAYS', 'MONTHLY'];

/**
 * Crea una campaña masiva (inmediata o programada / recurrente), resuelve la audiencia
 * (todos o selección manual de contactos del tenant) y arranca o agenda el motor persistente V2.
 */
export async function launchCampaign(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const {
      name,
      baseMessage,
      delayMin,
      delayMax,
      audience,
      audienceType,
      media,
      contactIds,
      scheduledAt,
      recurrenceType
    } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    if (!name || !baseMessage) {
      return res.status(400).json({ error: 'El nombre y el mensaje base de la campaña son requeridos.' });
    }

    // Validación de recurrencia
    const normRecurrence = recurrenceType ? String(recurrenceType).toUpperCase().trim() : 'NONE';
    if (!VALID_RECURRENCES.includes(normRecurrence)) {
      return res.status(400).json({
        error: `Tipo de recurrencia no válido. Valores permitidos: ${VALID_RECURRENCES.join(', ')}.`
      });
    }

    // Validación de scheduledAt
    let parsedScheduledAt = null;
    if (scheduledAt) {
      parsedScheduledAt = new Date(scheduledAt);
      if (isNaN(parsedScheduledAt.getTime())) {
        return res.status(400).json({ error: 'La fecha de programación (scheduledAt) no tiene un formato válido.' });
      }
    }

    // Validación de audiencia manual
    const normAudienceType = audienceType || (audience === 'manual' || Array.isArray(audience) || Array.isArray(contactIds) ? 'manual' : 'all');
    if (normAudienceType === 'manual') {
      const ids = Array.isArray(contactIds) ? contactIds : (Array.isArray(audience) ? audience : []);
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Para audiencia manual se requiere especificar los contactos (contactIds).' });
      }
    }

    // Seguro Anti-Ban: Forzar límites mínimos estrictos de retraso por seguridad
    let minDelay = Math.max(10, parseInt(delayMin) || 10);
    let maxDelay = Math.max(15, parseInt(delayMax) || 15);
    if (minDelay >= maxDelay) {
      maxDelay = minDelay + 5;
    }

    const { campaign, eligibleCount, scheduled } = await launchCampaignV2({
      tenantId,
      name,
      baseMessage,
      media,
      delayMin: minDelay,
      delayMax: maxDelay,
      audience,
      audienceType: normAudienceType,
      contactIds: Array.isArray(contactIds) ? contactIds : (Array.isArray(audience) ? audience : null),
      scheduledAt: parsedScheduledAt,
      recurrenceType: normRecurrence
    });

    if (scheduled) {
      return res.status(200).json({
        success: true,
        message: 'Campaña programada con éxito en el sistema.',
        campaignId: campaign.id,
        scheduled: true,
        scheduledAt: campaign.scheduledAt,
        nextRunAt: campaign.nextRunAt,
        recurrenceType: campaign.recurrenceType
      });
    }

    if (eligibleCount === 0) {
      return res.status(200).json({
        success: true,
        message: 'Campaña creada pero no hay contactos elegibles en la audiencia seleccionada.',
        campaignId: campaign.id
      });
    }

    // Disparar worker en segundo plano para campaña inmediata (No bloqueante, sin await)
    runCampaignWorker(campaign.id).catch((err) => {
      console.error(`❌ [Campaign Controller] Error en worker V2 para campaña ${campaign.id}:`, err);
    });

    return res.status(200).json({
      success: true,
      message: 'Campaña iniciada con éxito en segundo plano.',
      campaignId: campaign.id,
      contactsCount: eligibleCount
    });

  } catch (error) {
    console.error('❌ Error en launchCampaign:', error);
    return res.status(500).json({ error: 'Error al lanzar la campaña masiva.' });
  }
}

/**
 * Obtiene el listado de campañas ejecutadas o en ejecución del tenant
 */
export async function getCampaigns(req, res) {
  try {
    const tenantId = req.user.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    const campaigns = await prisma.campaign.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { logs: true }
        }
      }
    });

    return res.status(200).json(campaigns);
  } catch (error) {
    console.error('Error al obtener campañas:', error);
    return res.status(500).json({ error: 'Error al recuperar las campañas.' });
  }
}

/**
 * Obtiene el detalle y logs de una campaña específica
 */
export async function getCampaignDetail(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { campaignId } = req.params;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
      include: {
        logs: {
          orderBy: { sentAt: 'desc' }
        }
      }
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaña no encontrada o no autorizada.' });
    }

    return res.status(200).json(campaign);
  } catch (error) {
    console.error('Error al obtener detalle de campaña:', error);
    return res.status(500).json({ error: 'Error al recuperar el detalle de la campaña.' });
  }
}
