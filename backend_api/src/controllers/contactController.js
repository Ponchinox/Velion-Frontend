import prisma from '../db.js';

/**
 * Obtiene todos los contactos pertenecientes al Tenant del usuario autenticado
 */
export async function getContacts(req, res) {
  try {
    const tenantId = req.user.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    const contacts = await prisma.contact.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(contacts);
  } catch (error) {
    console.error('Error en getContacts:', error);
    return res.status(500).json({ error: 'Error al obtener los contactos.' });
  }
}

/**
 * Crea un nuevo contacto asociado forzosamente al Tenant del usuario autenticado
 */
export async function createContact(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { name, phone, category, tags, lastInteraction } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    if (!name || !phone) {
      return res.status(400).json({ error: 'Faltan campos requeridos (name, phone).' });
    }

    const contact = await prisma.contact.create({
      data: {
        name,
        phone,
        category: category || 'Nuevos Leads',
        tags: tags || [],
        lastInteraction: lastInteraction || null,
        tenantId,
      },
    });

    return res.status(201).json(contact);
  } catch (error) {
    console.error('Error en createContact:', error);
    return res.status(500).json({ error: 'Error al crear el contacto.' });
  }
}

/**
 * Elimina un contacto tras comprobar la propiedad del Tenant
 */
export async function deleteContact(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { id } = req.params;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    // Comprobar pertenencia y eliminar
    const result = await prisma.contact.deleteMany({
      where: {
        id,
        tenantId,
      },
    });

    if (result.count === 0) {
      return res.status(404).json({ error: 'Contacto no encontrado o no pertenece a su cuenta.' });
    }

    return res.json({ message: 'Contacto eliminado con éxito.' });
  } catch (error) {
    console.error('Error en deleteContact:', error);
    return res.status(500).json({ error: 'Error al eliminar el contacto.' });
  }
}
