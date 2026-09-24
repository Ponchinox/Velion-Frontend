import prisma from '../db.js';
import {
  findEquivalentContact,
  getPeruPhoneEquivalents,
  cleanPhoneDigits,
  normalizePhone
} from '../services/phoneEquivalenceService.js';

/**
 * Obtiene todos los contactos pertenecientes al Tenant del usuario autenticado
 */
export async function getContacts(req, res) {
  try {
    const tenantId = req.user.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    const [contacts, customers] = await Promise.all([
      prisma.contact.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.customer.findMany({
        where: { tenantId },
        select: { phone: true, isBotPaused: true }
      })
    ]);

    const formatted = contacts.map(c => {
      const cleanPhone = cleanPhoneDigits(c.phone);
      const peruInfo = getPeruPhoneEquivalents(cleanPhone);
      const matchingCustomer = customers.find(cust => {
        const custPhone = cleanPhoneDigits(cust.phone);
        if (!custPhone || !cleanPhone) return false;
        if (custPhone === cleanPhone) return true;
        if (peruInfo.isPeru && peruInfo.allVariants.includes(custPhone)) return true;
        return false;
      });

      // Fuente unificada de verdad
      const isEffectivePaused = Boolean(c.botPaused || matchingCustomer?.isBotPaused);

      return {
        ...c,
        botPaused: isEffectivePaused,
        isBotPaused: isEffectivePaused
      };
    });

    return res.json(formatted);
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

    // Comprobar colisión por teléfono exacto o equivalente Perú
    const duplicate = await findEquivalentContact(prisma, { tenantId, phone });
    if (duplicate) {
      return res.status(409).json({
        error: `Ya existe un contacto (${duplicate.name}) con este número o su equivalente.`,
        code: 'DUPLICATE_CONTACT',
        existingContact: {
          id: duplicate.id,
          name: duplicate.name,
          phone: duplicate.phone
        }
      });
    }

    const clean = cleanPhoneDigits(phone);
    const normalizedToStore = normalizePhone(clean) || clean;

    const contact = await prisma.contact.create({
      data: {
        name: name.trim(),
        phone: normalizedToStore,
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
    const cleanPhone = (contact.phone || '').replace(/\D/g, '');

    await prisma.$transaction(async (tx) => {
      // 1. Actualizar Contacto
      await tx.contact.update({
        where: { id },
        data: { botPaused: newBotPausedState },
      });

      // 2. Actualizar Chats asociados (por contactId y tenantId)
      await tx.chat.updateMany({
        where: { contactId: id, tenantId },
        data: { botPaused: newBotPausedState },
      });

      // 3. Actualizar Customers asociados (por tenantId)
      if (cleanPhone) {
        const peruInfo = getPeruPhoneEquivalents(cleanPhone);
        const candidatePhones = [contact.phone, cleanPhone];
        if (peruInfo.isPeru) {
          candidatePhones.push(peruInfo.local, peruInfo.international);
        }
        await tx.customer.updateMany({
          where: {
            tenantId,
            phone: { in: Array.from(new Set(candidatePhones.filter(Boolean))) }
          },
          data: { isBotPaused: newBotPausedState },
        });
      }
    });

    const effectiveTenantId = req.user?.tenantId || contact.tenantId;
    if ((req.io || global.io) && effectiveTenantId) {
      const io = req.io || global.io;
      if (typeof io.to === 'function') {
        io.to(`tenant:${effectiveTenantId}`).emit('bot_status_changed', { phone: contact.phone, contactId: id, botPaused: newBotPausedState, isBotPaused: newBotPausedState });
        io.to(`tenant:${effectiveTenantId}`).emit('contact_updated', { phone: contact.phone, contactId: id, botPaused: newBotPausedState, reason: 'MANUAL_TOGGLE' });
      } else {
        io.emit('bot_status_changed', { phone: contact.phone, contactId: id, botPaused: newBotPausedState, isBotPaused: newBotPausedState });
        io.emit('contact_updated', { phone: contact.phone, contactId: id, botPaused: newBotPausedState, reason: 'MANUAL_TOGGLE' });
      }
    }

    return res.json({ ...contact, botPaused: newBotPausedState, isBotPaused: newBotPausedState });
  } catch (error) {
    console.error('Error en toggleBotPause:', error);
    return res.status(500).json({ error: 'Error al actualizar el estado del bot para este contacto: ' + error.message });
  }
}


/**
 * Actualiza nombre y/o teléfono de un contacto.
 * Si el teléfono cambia, comprueba colisiones e impide colisionar con otro Contact.
 * Actualiza también el registro Customer correspondiente.
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

    // Si el teléfono se proporcionó, validar que no colisione con otro Contact del mismo Tenant
    if (phone) {
      const duplicate = await findEquivalentContact(prisma, {
        tenantId,
        phone: finalPhone,
        excludeContactId: id
      });
      if (duplicate) {
        return res.status(409).json({
          error: `El número ingresado ya pertenece a otro contacto (${duplicate.name}).`,
          code: 'DUPLICATE_CONTACT',
          existingContact: {
            id: duplicate.id,
            name: duplicate.name,
            phone: duplicate.phone
          }
        });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Si el teléfono cambió, actualizar Customer para mantener el enrutamiento de WhatsApp
      if (finalPhone !== existing.phone) {
        const existingPeru = getPeruPhoneEquivalents(existing.phone);
        const candidateOldPhones = [existing.phone];
        if (existingPeru.isPeru) {
          candidateOldPhones.push(existingPeru.local, existingPeru.international);
        }
        await tx.customer.updateMany({
          where: {
            tenantId,
            phone: { in: Array.from(new Set(candidateOldPhones.filter(Boolean))) }
          },
          data:  { phone: finalPhone },
        });
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
