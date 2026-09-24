/**
 * phoneEquivalenceService.js
 * 
 * Lógica unificada y determinística de equivalencia telefónica CRM ↔ WhatsApp.
 * 
 * Reglas para Perú:
 * - LOCAL válido: exactamente 9 dígitos, empieza con 9 (ej. 990123456)
 * - INTERNACIONAL equivalente: exactamente 11 dígitos, empieza con 519 (ej. 51990123456)
 * - Equivalencia bidireccional estricta: 9XXXXXXXX <-> 519XXXXXXXX
 * - NO se utiliza endsWith(9) indiscriminadamente para ningún país.
 * 
 * Reglas de Prioridad:
 * 1. Coincidencia exacta (exact phone)
 * 2. Equivalencia Perú válida (si aplica)
 * 3. Si hay exactamente 1 candidato -> reutilizar
 * 4. Si hay ambigüedad (> 1 candidato) -> NO fusionar automáticamente (retorna null)
 * 5. Aislamiento multi-tenant estricto: siempre filtrado por tenantId
 */

/**
 * Limpia y extrae los dígitos de un teléfono, preservando JIDs de tipo @lid
 * @param {string} raw 
 * @returns {string}
 */
export function cleanPhoneDigits(raw) {
  if (!raw) return '';
  const str = String(raw).trim();
  if (str.includes('@lid')) return str;
  return str.replace(/\D/g, '');
}

/**
 * Determina si un número es peruano móvil (local o internacional) y calcula su variante equivalente
 * @param {string} raw 
 * @returns {{ isPeru: boolean, local: string|null, international: string|null, allVariants: string[] }}
 */
export function getPeruPhoneEquivalents(raw) {
  const digits = cleanPhoneDigits(raw);
  
  // Perú Local: exactamente 9 dígitos comenzando con 9
  if (digits.length === 9 && digits.startsWith('9')) {
    const international = '51' + digits;
    return {
      isPeru: true,
      local: digits,
      international,
      allVariants: [digits, international]
    };
  }

  // Perú Internacional: exactamente 11 dígitos comenzando con 519
  if (digits.length === 11 && digits.startsWith('519')) {
    const local = digits.slice(2);
    return {
      isPeru: true,
      local,
      international: digits,
      allVariants: [digits, local]
    };
  }

  // No es Perú móvil o no cumple formato estricto
  return {
    isPeru: false,
    local: null,
    international: null,
    allVariants: digits ? [digits] : []
  };
}

/**
 * Normaliza un número para almacenamiento estándar si aplica regla Perú
 * @param {string} raw 
 * @returns {string}
 */
export function normalizePhone(raw) {
  const digits = cleanPhoneDigits(raw);
  if (digits.length === 11 && digits.startsWith('519')) {
    return digits.slice(2);
  }
  return digits;
}

/**
 * Busca un contacto en el Tenant según prioridad:
 * 1. Teléfono exacto (incluyendo posible prefijo '+')
 * 2. Teléfono equivalente Perú (si aplica y no hay match exacto)
 * 
 * Si hay exactamente 1 candidato -> lo retorna.
 * Si hay ambigüedad (>1) -> retorna null para evitar fusiones accidentales.
 * 
 * @param {object} prismaClient 
 * @param {object} options
 * @param {string} options.tenantId
 * @param {string} options.phone
 * @param {string} [options.excludeContactId] - Opcional para evitar coincidir consigo mismo en edición
 * @returns {Promise<object|null>}
 */
export async function findEquivalentContact(prismaClient, { tenantId, phone, excludeContactId = null }) {
  if (!prismaClient || !tenantId || !phone) return null;

  const clean = cleanPhoneDigits(phone);
  if (!clean) return null;

  const baseWhere = {
    tenantId,
    ...(excludeContactId ? { id: { not: excludeContactId } } : {})
  };

  // ── PRIORIDAD 1: Búsqueda exacta ──
  const exactCandidates = [clean];
  if (!clean.startsWith('+')) exactCandidates.push('+' + clean);

  const exactMatches = await prismaClient.contact.findMany({
    where: {
      ...baseWhere,
      phone: { in: exactCandidates }
    }
  });

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }
  if (exactMatches.length > 1) {
    // Ambigüedad en coincidencia exacta: no fusionar automáticamente
    return null;
  }

  // ── PRIORIDAD 2: Equivalencia Perú válida ──
  const peruInfo = getPeruPhoneEquivalents(clean);
  if (peruInfo.isPeru) {
    const altVariant = clean === peruInfo.local ? peruInfo.international : peruInfo.local;
    const altCandidates = [altVariant];
    if (!altVariant.startsWith('+')) altCandidates.push('+' + altVariant);

    const altMatches = await prismaClient.contact.findMany({
      where: {
        ...baseWhere,
        phone: { in: altCandidates }
      }
    });

    if (altMatches.length === 1) {
      return altMatches[0];
    }
    if (altMatches.length > 1) {
      // Ambigüedad en variante equivalente: no fusionar
      return null;
    }
  }

  return null;
}
