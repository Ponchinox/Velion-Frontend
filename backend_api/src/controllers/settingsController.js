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
      }
    });

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant no encontrado.' });
    }

    return res.status(200).json(tenant);
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
      termsAndPolicies
    } = req.body;

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
        termsAndPolicies
      }
    });

    console.log(`🏢 [Settings Controller] Ajustes actualizados con éxito para tenant: "${updated.name}"`);

    return res.status(200).json(updated);
  } catch (error) {
    console.error('❌ Error al actualizar ajustes:', error);
    return res.status(500).json({ error: 'Error al actualizar los ajustes de la empresa.' });
  }
}
