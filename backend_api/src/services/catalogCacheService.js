import { commerceService } from './commerce/CommerceService.js';

// Cache structure: tenantId -> { csv: string, timestamp: number }
const catalogCache = new Map();
const TTL_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Obtiene el índice compacto (CSV) del catálogo de un tenant.
 * Usa caché en memoria con TTL para no saturar la BD ni el proveedor de comercio.
 */
export async function getCompactCatalogIndex(tenantId) {
  const now = Date.now();
  const cached = catalogCache.get(tenantId);

  // Retornar caché si es válido
  if (cached && (now - cached.timestamp < TTL_MS)) {
    return cached.csv;
  }

  // Si no hay caché o expiró, consultar a través de CommerceService
  try {
    const csv = await commerceService.getCompactCatalogCsv(tenantId);
    catalogCache.set(tenantId, { csv, timestamp: now });
    return csv;
  } catch (error) {
    console.error(`❌ [CatalogCache] Error al obtener catálogo para tenant ${tenantId}:`, error.message);
    // En caso de error, si hay caché viejo, devolverlo para no caerse
    if (cached) return cached.csv;
    return "ID,Nombre,PrecioActual,PrecioNormal,Promocion,Disponible,Categoria\nError al cargar catálogo.";
  }
}

/**
 * Permite invalidar manualmente el caché si se actualiza un producto en el dashboard
 */
export function invalidateCatalogCache(tenantId) {
  catalogCache.delete(tenantId);
}
