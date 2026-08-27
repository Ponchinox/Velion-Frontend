import prisma from '../db.js';

/**
 * Normaliza un número de teléfono:
 * - Elimina todo lo que no sea dígito
 * - Si empieza con 51 y tiene 11 dígitos (código Perú), lo recorta a 9 dígitos
 */
function normalizePhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.startsWith('51') && digits.length === 11) return digits.slice(2);
  return digits;
}

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
 * Elimina un contacto tras comprobar la propiedad del Tenant y borra relaciones de forma segura.
 */
export async function deleteContact(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { id } = req.params;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    // Verificar si el contacto pertenece al tenant
    const contact = await prisma.contact.findFirst({
      where: {
        id,
        tenantId,
      },
    });

    if (!contact) {
      return res.status(404).json({ error: 'Contacto no encontrado o no pertenece a su cuenta.' });
    }

    // Borrado seguro en cascada usando transacción para no romper la base de datos
    await prisma.$transaction(async (tx) => {
      // 1. Obtener chats asociados
      const chats = await tx.chat.findMany({
        where: { contactId: id },
        select: { id: true },
      });
      const chatIds = chats.map(c => c.id);

      // 2. Eliminar mensajes de los chats
      if (chatIds.length > 0) {
        await tx.message.deleteMany({
          where: { chatId: { in: chatIds } },
        });

        // 3. Eliminar chats
        await tx.chat.deleteMany({
          where: { contactId: id },
        });
      }

      // 4. Eliminar el contacto
      await tx.contact.delete({
        where: { id },
      });
    });

    return res.json({ message: 'Contacto eliminado con éxito.' });
  } catch (error) {
    console.error('Error en deleteContact:', error);
    return res.status(500).json({ error: 'Error al eliminar el contacto.' });
  }
}

/**
 * Alterna/Reactiva el estado botPaused de un contacto (y sus chats/customer)
 */
export async function toggleBotPause(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { id } = req.params;
    const { botPaused } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    const contact = await prisma.contact.findFirst({
      where: { id, tenantId },
    });

    if (!contact) {
      return res.status(404).json({ error: 'Contacto no encontrado.' });
    }

    const newBotPausedState = botPaused !== undefined ? Boolean(botPaused) : !contact.botPaused;

    const updatedContact = await prisma.contact.update({
      where: { id },
      data: { botPaused: newBotPausedState },
    });

    await prisma.chat.updateMany({
      where: { contactId: id },
      data: { botPaused: newBotPausedState },
    });

    const cleanPhone = contact.phone.replace(/[^0-9]/g, '');
    if (cleanPhone) {
      await prisma.customer.updateMany({
        where: { tenantId, phone: { contains: cleanPhone } },
        data: { isBotPaused: newBotPausedState },
      });
    }

    return res.json(updatedContact);
  } catch (error) {
    console.error('Error en toggleBotPause:', error);
    return res.status(500).json({ error: 'Error al actualizar el estado del bot para este contacto.' });
  }
}

/**
 * Actualiza nombre y/o teléfono de un contacto.
 * Si el teléfono cambia, actualiza también el registro Customer correspondiente
 * para que el enrutamiento de WhatsApp siga funcionando con el número nuevo.
 */
export async function updateContact(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { id } = req.params;
    const { name, phone } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'El nombre es requerido.' });
    }

    const existing = await prisma.contact.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return res.status(404).json({ error: 'Contacto no encontrado o no pertenece a su cuenta.' });
    }

    // Normalizar teléfono nuevo (si se proporcionó)
    const rawPhone   = phone || existing.phone;
    const finalPhone = normalizePhone(rawPhone) || existing.phone;

    const updated = await prisma.$transaction(async (tx) => {
      // Si el teléfono cambió, actualizar Customer para mantener el enrutamiento de WhatsApp
      if (finalPhone !== existing.phone) {
        await tx.customer.updateMany({
          where: { tenantId, phone: existing.phone },
          data:  { phone: finalPhone },
        });
        // Intentar actualizar también la variante con prefijo 51 por si acaso
        await tx.customer.updateMany({
          where: { tenantId, phone: `51${existing.phone}` },
          data:  { phone: finalPhone },
        }).catch(() => {});
      }

      return tx.contact.update({
        where: { id },
        data:  { name: name.trim(), phone: finalPhone },
      });
    });

    return res.json(updated);
  } catch (error) {
    console.error('Error en updateContact:', error);
    return res.status(500).json({ error: 'Error al actualizar el contacto.' });
  }
}
