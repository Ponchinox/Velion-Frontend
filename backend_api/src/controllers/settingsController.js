import prisma from '../db.js';
import { incrementTenantAiEpoch } from './whatsappController.js';

/**
 * Obtiene los ajustes corporativos del Tenant del usuario autenticado
 */
export async function getSettings(req, res) {
  try {
    const tenantId = req.user.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        companyName: true,
        taxId: true,
        address: true,
        phone: true,
        email: true,
        businessSector: true,
        bankAccounts: true,
        businessHours: true,
        termsAndPolicies: true,
        customPrompt: true,
        botRole: true,
        multiMessageMode: true,
        respondInGroups: true,
        notificationPhone: true,
        notifySalesWhatsApp: true,
        marketingModeEnabled: true,
        aiEnabled: true,
      }
    });

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant no encontrado.' });
    }

    // Si la empresa cuenta con un plan activo o el usuario es SuperAdmin, se habilita la función
    let hasAdvancedMarketing = tenant.plan && tenant.plan !== 'Sin Plan' || req.user?.role === 'superadmin';
    let planName = tenant.plan || 'Sin Plan';

    if (tenant.planId) {
      const plan = await prisma.plan.findUnique({
        where: { id: tenant.planId },
        select: { name: true },
      });
      if (plan) {
        planName = plan.name;
      }
    }

    return res.status(200).json({
      ...tenant,
      hasAdvancedMarketing,
      planName,
    });
  } catch (error) {
    console.error('❌ Error al obtener ajustes:', error);
    return res.status(500).json({ error: 'Error al recuperar los ajustes de la empresa.' });
  }
}

/**
 * Actualiza los ajustes corporativos del Tenant del usuario autenticado
 */
export async function updateSettings(req, res) {
  try {
    const tenantId = req.user.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    const {
      logoUrl,
      companyName,
      taxId,
      address,
      phone,
      email,
      businessSector,
      bankAccounts,
      businessHours,
      termsAndPolicies,
      customPrompt,
      botRole,
      multiMessageMode,
      respondInGroups,
      notificationPhone,
      notifySalesWhatsApp,
      marketingModeEnabled,
      aiEnabled
    } = req.body;

    const isAiEnabledPayload = aiEnabled !== undefined ? Boolean(aiEnabled) : undefined;
    let updatedTenant;

    try {
      updatedTenant = await prisma.$transaction(async (tx) => {
        // ── Fetch Current Tenant State with row-level lock ──
        const lockedTenants = await tx.$queryRaw`SELECT "id", "aiEnabled", "aiDisabledAt", "plan", "planId" FROM "Tenant" WHERE "id" = ${tenantId} FOR UPDATE`;
        
        if (!lockedTenants || lockedTenants.length === 0) {
          throw new Error('TENANT_NOT_FOUND');
        }
        
        const currentTenant = lockedTenants[0];

        // ── Verificación de Plan: Modo Vendedor Persuasivo ──
        if ((marketingModeEnabled === true || marketingModeEnabled === 'true') && req.user?.role !== 'superadmin') {
          if (!currentTenant.plan || currentTenant.plan === 'Sin Plan') {
            throw new Error('PLAN_FEATURE_REQUIRED');
          }
        }

        const aiTurnedOff = isAiEnabledPayload === false && currentTenant.aiEnabled === true;
        const aiTurnedOn = isAiEnabledPayload === true && currentTenant.aiEnabled === false;
        
        // T1: Instante exacto de reactivación
        const reactivationAt = new Date();
        const T0 = currentTenant.aiDisabledAt;

        // Determinar el nuevo aiDisabledAt
        let nextAiDisabledAt = currentTenant.aiDisabledAt;
        if (aiTurnedOff) {
          nextAiDisabledAt = new Date(); // Conserva el idempotente: ON->OFF = new, OFF->OFF = conservado
        } else if (aiTurnedOn) {
          nextAiDisabledAt = null; // Consume el T0
        }

        const updated = await tx.tenant.update({
          where: { id: tenantId },
          data: {
            logoUrl,
            companyName,
            taxId,
            address,
            phone,
            email,
            businessSector,
            bankAccounts,
            businessHours,
            termsAndPolicies,
            customPrompt: botRole !== undefined ? botRole : customPrompt,
            botRole,
            notificationPhone,
            ...(notifySalesWhatsApp !== undefined && { notifySalesWhatsApp: Boolean(notifySalesWhatsApp) }),
            ...(marketingModeEnabled !== undefined && { marketingModeEnabled: Boolean(marketingModeEnabled) }),
            ...(multiMessageMode !== undefined && { multiMessageMode: Boolean(multiMessageMode) }),
            ...(respondInGroups !== undefined && { respondInGroups: Boolean(respondInGroups) }),
            ...(aiEnabled !== undefined && { 
              aiEnabled: Boolean(aiEnabled),
              aiDisabledAt: nextAiDisabledAt
            })
          }
        });

        // ─── AI CONFIG EPOCH: Invalidar jobs en vuelo si aiEnabled pasó a false ───
        if (aiTurnedOff || (isAiEnabledPayload === false)) {
          incrementTenantAiEpoch(tenantId);
        }

        // ─── AI OFF BLOCK CLOSURE: Cerrar turno al reactivar la IA (T0 bound) ───
        if (aiTurnedOn && T0) {
          try {
            // Obtenemos el último mensaje estricto de la etapa pre-reactivación
            const latestMessages = await tx.message.findMany({
              where: { 
                tenantId: tenantId,
                createdAt: { lt: reactivationAt }
              },
              distinct: ['chatId'],
              orderBy: [
                { chatId: 'asc' },
                { createdAt: 'desc' }
              ],
              select: {
                chatId: true,
                senderRole: true,
                createdAt: true
              }
            });
            
            const chatsToClose = getChatsToCloseByAiOff(latestMessages, T0, reactivationAt);
              
            if (chatsToClose.length > 0) {
              const newMarkers = chatsToClose.map(chatId => ({
                chatId,
                tenantId: tenantId,
                content: '[Período AI OFF cerrado]',
                senderRole: 'model',
                status: 'ai_cancelled',
                createdAt: reactivationAt
              }));
              await tx.message.createMany({ data: newMarkers });
              console.log(`🚫 [AI OFF Closure] Cerrados ${chatsToClose.length} chats acumulados desde ${T0.toISOString()} hasta ${reactivationAt.toISOString()}.`);
            } else {
              console.log(`🚫 [AI OFF Closure] No hubo mensajes de contacto pendientes durante el período OFF.`);
            }
          } catch (closureErr) {
            console.error(`⚠️ [AI OFF Closure] Error al cerrar historial OFF:`, closureErr.message);
          }
        }
        
        return updated;
      });
    } catch (txError) {
      if (txError.message === 'TENANT_NOT_FOUND') {
        return res.status(404).json({ error: 'Tenant no encontrado.' });
      }
      if (txError.message === 'PLAN_FEATURE_REQUIRED') {
        return res.status(403).json({
          error: 'Tu cuenta requiere un plan activo para habilitar el Modo Vendedor Persuasivo.',
          code: 'PLAN_FEATURE_REQUIRED',
        });
      }
      throw txError;
    }

    console.log(`🏢 [Settings Controller] Ajustes actualizados con éxito para tenant: "${updatedTenant.name}"`);

    return res.status(200).json(updatedTenant);
  } catch (error) {
    console.error('❌ Error al actualizar ajustes:', error);
    return res.status(500).json({ error: 'Error al actualizar los ajustes de la empresa.' });
  }
}

/**
 * ─── HELPER: SELECCIÓN DE CHATS A CERRAR (AI OFF) ───
 * Filtra la lista de últimos mensajes para determinar qué chats deben cerrarse semánticamente.
 * @param {Array} latestMessages - [{ chatId, senderRole, createdAt }]
 * @param {Date|String} T0 - Timestamp en que la IA fue desactivada
 * @param {Date|String} T1 - Timestamp en que la IA fue reactivada
 */
export function getChatsToCloseByAiOff(latestMessages, T0, T1) {
  if (!T0 || !T1) return [];
  const t0Date = new Date(T0);
  const t1Date = new Date(T1);
  return latestMessages
    .filter(m => m.senderRole === 'contact' && new Date(m.createdAt) >= t0Date && new Date(m.createdAt) < t1Date)
    .map(m => m.chatId);
}

