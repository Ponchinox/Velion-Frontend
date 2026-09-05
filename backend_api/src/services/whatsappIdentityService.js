import prisma from '../db.js';

/**
 * Extrae de forma estrictamente autoritativa un par phone <-> LID de un payload de webhook
 * (Evolution API o Meta Cloud API / Coexistence).
 * 
 * Reglas determinísticas:
 * - NO infiere por nombre ni por longitud.
 * - Solo extrae si una clave es telefónica y la otra es explícitamente @lid.
 * - Retorna { phone: string (solo dígitos), lid: string (terminado en @lid) } o null.
 */
export function extractAuthoritativeIdentityPair(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const candidates = [];

  // 1. Evolution key (directo, en data, en rawData o el propio payload)
  const key = payload.key || payload.data?.key || payload.rawData?.key || payload;
  if (key && typeof key === 'object') {
    if (key.remoteJid && key.remoteJidAlt) {
      candidates.push([String(key.remoteJid), String(key.remoteJidAlt)]);
    }
    if (key.participant && key.participantAlt) {
      candidates.push([String(key.participant), String(key.participantAlt)]);
    }
  }

  // 2. Meta Cloud API / Coexistence alternate identities
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const msg = value?.messages?.[0];
  if (msg?.from && msg?.identity_key) {
    candidates.push([String(msg.from), String(msg.identity_key)]);
  }
  if (msg?.from && msg?.participant) {
    candidates.push([String(msg.from), String(msg.participant)]);
  }

  for (const [a, b] of candidates) {
    const cleanA = a.trim();
    const cleanB = b.trim();

    // En WhatsApp, los JIDs pueden traer sufijo de dispositivo: user:device@server
    const userPartA = cleanA.split('@')[0].split(':')[0];
    const userPartB = cleanB.split('@')[0].split(':')[0];

    let phone = null;
    let lid = null;

    if (cleanA.includes('@lid') && (cleanB.includes('@s.whatsapp.net') || !cleanB.includes('@'))) {
      lid = userPartA + '@lid';
      phone = userPartB.replace(/\D/g, '');
    } else if (cleanB.includes('@lid') && (cleanA.includes('@s.whatsapp.net') || !cleanA.includes('@'))) {
      lid = userPartB + '@lid';
      phone = userPartA.replace(/\D/g, '');
    }

    if (phone && lid && phone.length >= 8) {
      return { phone, lid };
    }
  }

  return null;
}

/**
 * Persiste autoritativamente la relación phone <-> LID en base de datos.
 * Aislamiento estricto por tenantId.
 * Escribe en:
 * - Customer.persistentProfile ({ linkedLid, linkedPhone })
 * - Contact.tags (['lid:...'], ['phone:...'])
 */
export async function persistAuthoritativeIdentityMapping({
  tenantId,
  phone,
  lid,
  prismaClient = prisma
}) {
  if (!tenantId || !phone || !lid) return null;

  const cleanDigits = String(phone).replace(/\D/g, '');
  const cleanLid = String(lid).trim();
  if (cleanDigits.length < 8 || !cleanLid.endsWith('@lid')) return null;

  const lidTag = `lid:${cleanLid}`;
  const phoneTag = `phone:${cleanDigits}`;

  try {
    // 1. Actualizar Contact telefónico existente (o que coincida con cleanDigits)
    const phoneContacts = await prismaClient.contact.findMany({
      where: {
        tenantId,
        OR: [
          { phone: cleanDigits },
          { phone: `+${cleanDigits}` },
          { phone: `${cleanDigits}@s.whatsapp.net` },
          { phone: `+${cleanDigits}@s.whatsapp.net` }
        ]
      }
    });

    for (const c of phoneContacts) {
      const currentTags = Array.isArray(c.tags) ? c.tags : [];
      if (!currentTags.includes(lidTag)) {
        await prismaClient.contact.update({
          where: { id: c.id },
          data: { tags: [...currentTags, lidTag] }
        });
      }
    }

    // 2. Actualizar Contact @lid si ya existe en el tenant
    const lidContacts = await prismaClient.contact.findMany({
      where: {
        tenantId,
        OR: [
          { phone: cleanLid },
          { phone: cleanLid.replace('@lid', '') }
        ]
      }
    });

    for (const c of lidContacts) {
      const currentTags = Array.isArray(c.tags) ? c.tags : [];
      if (!currentTags.includes(phoneTag)) {
        await prismaClient.contact.update({
          where: { id: c.id },
          data: { tags: [...currentTags, phoneTag] }
        });
      }
    }

    // 3. Actualizar Customer telefónico
    const phoneCustomers = await prismaClient.customer.findMany({
      where: {
        tenantId,
        OR: [
          { phone: cleanDigits },
          { phone: `+${cleanDigits}` },
          { phone: `${cleanDigits}@s.whatsapp.net` },
          { phone: `+${cleanDigits}@s.whatsapp.net` }
        ]
      }
    });

    for (const cust of phoneCustomers) {
      const currentProfile = (typeof cust.persistentProfile === 'object' && cust.persistentProfile !== null)
        ? cust.persistentProfile
        : {};
      const currentTags = Array.isArray(cust.tags) ? cust.tags : [];
      const needsProfileUpdate = currentProfile.linkedLid !== cleanLid;
      const needsTagUpdate = !currentTags.includes(lidTag);

      if (needsProfileUpdate || needsTagUpdate) {
        await prismaClient.customer.update({
          where: { id: cust.id },
          data: {
            persistentProfile: {
              ...currentProfile,
              linkedLid: cleanLid
            },
            tags: needsTagUpdate ? [...currentTags, lidTag] : currentTags
          }
        });
      }
    }

    // 4. Actualizar Customer @lid si ya existe en el tenant
    const lidCustomers = await prismaClient.customer.findMany({
      where: {
        tenantId,
        OR: [
          { phone: cleanLid },
          { phone: cleanLid.replace('@lid', '') }
        ]
      }
    });

    for (const cust of lidCustomers) {
      const currentProfile = (typeof cust.persistentProfile === 'object' && cust.persistentProfile !== null)
        ? cust.persistentProfile
        : {};
      const currentTags = Array.isArray(cust.tags) ? cust.tags : [];
      const needsProfileUpdate = currentProfile.linkedPhone !== cleanDigits;
      const needsTagUpdate = !currentTags.includes(phoneTag);

      if (needsProfileUpdate || needsTagUpdate) {
        await prismaClient.customer.update({
          where: { id: cust.id },
          data: {
            persistentProfile: {
              ...currentProfile,
              linkedPhone: cleanDigits
            },
            tags: needsTagUpdate ? [...currentTags, phoneTag] : currentTags
          }
        });
      }
    }

    return { phone: cleanDigits, lid: cleanLid };
  } catch (err) {
    console.error(`⚠️ [Identity Mapping] Error persistiendo mapeo autoritativo phone <-> LID para tenant ${tenantId}:`, err.message);
    return null;
  }
}
