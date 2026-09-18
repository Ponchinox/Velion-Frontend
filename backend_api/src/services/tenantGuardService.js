/**
 * TENANT GUARD SERVICE
 * Centraliza la verificación y el caché de estado activo/suspendido de tenants.
 *
 * Garantías:
 * - Caché de lectura ultrarrápido (TTL 10s) para mitigar consultas repetitivas en
 *   webhooks, authMiddleware y WhatsApp gateway.
 * - Invalidación instantánea al actualizar el estado desde SuperAdmin.
 * - Soporte para mock en suites de tests (cero llamadas de red / DB).
 */

import defaultPrisma from '../db.js';

const tenantActiveCache = new Map();
const CACHE_TTL_MS = 10 * 1000; // 10 segundos

let customTenantActiveResolver = null;

/**
 * Permite inyectar un resolver mock en suites de pruebas unitarias o de integración.
 * @param {Function|null} resolverFn
 */
export function setTenantActiveMock(resolverFn) {
  customTenantActiveResolver = typeof resolverFn === 'function' ? resolverFn : null;
}

/**
 * Invalida el caché en memoria de un tenant para reflejo inmediato tras cambios de estado.
 * @param {string} tenantId
 */
export function invalidateTenantActiveCache(tenantId) {
  if (!tenantId) {
    tenantActiveCache.clear();
    return;
  }
  tenantActiveCache.delete(String(tenantId));
}

/**
 * Determina de forma eficiente y segura si un tenant está activo.
 *
 * @param {string} tenantId
 * @param {object} [prismaClient]
 * @returns {Promise<boolean>}
 */
export async function isTenantActive(tenantId, prismaClient = defaultPrisma) {
  if (!tenantId) return false;

  if (customTenantActiveResolver) {
    return Boolean(await customTenantActiveResolver(tenantId));
  }

  const cleanId = String(tenantId);
  const cached = tenantActiveCache.get(cleanId);
  const now = Date.now();

  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return cached.active;
  }

  try {
    const db = prismaClient || defaultPrisma;
    const tenant = await db.tenant.findUnique({
      where: { id: cleanId },
      select: { active: true }
    });

    const active = tenant ? Boolean(tenant.active) : false;
    tenantActiveCache.set(cleanId, { active, timestamp: now });

    // Evitar acumulación infinita de claves en caché
    if (tenantActiveCache.size > 1000) {
      for (const [key, val] of tenantActiveCache.entries()) {
        if (now - val.timestamp > CACHE_TTL_MS) {
          tenantActiveCache.delete(key);
        }
      }
    }

    return active;
  } catch (err) {
    console.error(`[TenantGuard] Error verificando estado de tenant ${cleanId}:`, err.message);
    // En caso de fallo de BD, si había un valor en caché lo usamos; si no, fail-closed seguro para no filtrar
    if (cached) return cached.active;
    return false;
  }
}
