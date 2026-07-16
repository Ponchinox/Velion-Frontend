import prisma from '../db.js';
import { processCampaign } from '../services/campaignService.js';

/**
 * Crea una campaña masiva, resuelve la audiencia (todos o selección)
 * e inicia el despachador en segundo plano de forma no bloqueante.
 */
export async function launchCampaign(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { name, baseMessage, delayMin, delayMax, audience, media } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    if (!name || !baseMessage) {
      return res.status(400).json({ error: 'El nombre y el mensaje base de la campaña son requeridos.' });
    }

    // Seguro Anti-Ban: Forzar límites mínimos estrictos de retraso por seguridad
    let minDelay = Math.max(10, parseInt(delayMin) || 10);
    let maxDelay = Math.max(15, parseInt(delayMax) || 15);
    if (minDelay >= maxDelay) {
      maxDelay = minDelay + 5;
    }

    // 1. Crear el registro de la campaña con estado 'running'
    const campaign = await prisma.campaign.create({
      data: {
        name,
        baseMessage,
        media: media || null,
        delayMin: minDelay,
        delayMax: maxDelay,
        status: 'running',
        tenantId
      }
    });

    // 2. Resolver audiencia del Tenant
    let targetContacts = [];
    if (audience === 'all' || !audience) {
      targetContacts = await prisma.contact.findMany({
        where: { tenantId }
      });
    } else if (Array.isArray(audience)) {
      targetContacts = await prisma.contact.findMany({
        where: {
          id: { in: audience },
          tenantId
        }
      });
    }

    // Si la audiencia está vacía, finalizar campaña de inmediato
    if (targetContacts.length === 0) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'completed' }
      });
      return res.status(200).json({
        success: true,
        message: 'Campaña creada pero no hay contactos en la audiencia seleccionada.',
        campaignId: campaign.id
      });
    }

    // 3. Obtener nombre de la instancia Evolution
    const instance = 'velion_instance_' + tenantId.slice(0, 8);

    // 4. Disparar worker en segundo plano (No bloqueante, sin await)
    processCampaign(campaign.id, targetContacts, instance).catch((err) => {
      console.error(`❌ [Campaign Controller] Error en background worker para campaña ${campaign.id}:`, err);
    });

    // 5. Responder inmediatamente
    return res.status(200).json({
      success: true,
      message: 'Campaña iniciada con éxito en segundo plano.',
      campaignId: campaign.id,
      contactsCount: targetContacts.length
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
