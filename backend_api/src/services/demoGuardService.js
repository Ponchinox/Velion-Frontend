/**
 * DEMO GUARD SERVICE
 * Centraliza la identificación y el filtrado de seguridad para tenants de demostración.
 *
 * Configuración requerida en entorno:
 * - DEMO_TENANT_IDS: Lista separada por comas de IDs de tenants demo.
 * - DEMO_ALLOWED_WHATSAPP_NUMBERS: Lista blanca separada por comas de números telefónicos
 *   autorizados para recibir mensajes desde un tenant demo.
 */

/**
 * Determina si un tenantId corresponde a un tenant configurado como demo.
 * @param {string|null|undefined} tenantId
 * @returns {boolean}
 */
export function isDemoTenant(tenantId) {
  if (!tenantId) return false;
  const demoTenantIds = (process.env.DEMO_TENANT_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return demoTenantIds.includes(String(tenantId).trim());
}

/**
 * Obtiene los números normalizados (solo dígitos) autorizados para tenants demo.
 * @returns {string[]}
 */
export function getAllowedDemoNumbers() {
  return (process.env.DEMO_ALLOWED_WHATSAPP_NUMBERS || '')
    .split(',')
    .map(s => s.trim().replace(/@.*$/, '').replace(/\D/g, ''))
    .filter(Boolean);
}

/**
 * Normaliza un número o JID de WhatsApp a una cadena de dígitos puros.
 * @param {string} target
 * @returns {string}
 */
export function normalizeTargetNumber(target) {
  return String(target || '').trim().replace(/@.*$/, '').replace(/\D/g, '');
}

/**
 * Redacta parcialmente un número telefónico para evitar fugas en logs.
 * Ejemplo: "51912345678" -> "519***78"
 * @param {string} number
 * @returns {string}
 */
export function redactPhoneNumber(number) {
  const clean = normalizeTargetNumber(number);
  if (!clean) return '***';
  if (clean.length <= 4) return '***';
  return `${clean.slice(0, 3)}***${clean.slice(-2)}`;
}

/**
 * Evalúa si un mensaje saliente está permitido según las políticas del tenant demo.
 * Para tenants normales siempre devuelve { allowed: true }.
 * Para tenants demo, solo permite el envío si el destinatario está en DEMO_ALLOWED_WHATSAPP_NUMBERS.
 *
 * @param {string|null|undefined} tenantId
 * @param {string} to - Destinatario (teléfono o JID)
 * @returns {{ allowed: boolean, reason?: string, cleanTarget?: string, redactedTarget?: string }}
 */
export function checkDemoOutboundGuard(tenantId, to) {
  // 1. Tenants normales: comportamiento no alterado
  if (!isDemoTenant(tenantId)) {
    return { allowed: true };
  }

  // 2. Tenants demo: verificar whitelist
  const cleanTo = normalizeTargetNumber(to);
  const allowedNumbers = getAllowedDemoNumbers();
  const isAllowed = cleanTo.length > 0 && allowedNumbers.includes(cleanTo);

  if (!isAllowed) {
    const redacted = redactPhoneNumber(cleanTo);
    console.warn(`🛑 [DEMO_OUTBOUND_BLOCKED] Envío bloqueado a destinatario no autorizado (${redacted}) para tenant demo ${String(tenantId).slice(0, 8)}`);
    return {
      allowed: false,
      reason: 'DEMO_OUTBOUND_BLOCKED',
      cleanTarget: cleanTo,
      redactedTarget: redacted,
    };
  }

  return { allowed: true, cleanTarget: cleanTo };
}
