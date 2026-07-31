import prisma from '../db.js';

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
      marketingModeEnabled
    } = req.body;

    // ── Verificación de Plan: Modo Vendedor Persuasivo permitido para todos los clientes con plan activo ──
    if ((marketingModeEnabled === true || marketingModeEnabled === 'true') && req.user?.role !== 'superadmin') {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { planId: true, plan: true },
      });

      if (!tenant || !tenant.plan || tenant.plan === 'Sin Plan') {
        return res.status(403).json({
          error: 'Tu cuenta requiere un plan activo para habilitar el Modo Vendedor Persuasivo.',
          code: 'PLAN_FEATURE_REQUIRED',
        });
      }
    }

    const updated = await prisma.tenant.update({
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
        ...(respondInGroups !== undefined && { respondInGroups: Boolean(respondInGroups) })
      }
    });

    console.log(`🏢 [Settings Controller] Ajustes actualizados con éxito para tenant: "${updated.name}"`);

    return res.status(200).json(updated);
  } catch (error) {
    console.error('❌ Error al actualizar ajustes:', error);
    return res.status(500).json({ error: 'Error al actualizar los ajustes de la empresa.' });
  }
}

