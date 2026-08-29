import prisma from '../db.js';

// Cache structure: tenantId -> { csv: string, timestamp: number }
const catalogCache = new Map();
const TTL_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Normaliza textos para el CSV (elimina comas y saltos de línea que rompan el formato)
 */
function sanitizeForCsv(text) {
  if (!text) return '';
  return text.toString().replace(/[\r\n,]/g, ' ').trim();
}

/**
 * Obtiene el índice compacto (CSV) del catálogo de un tenant.
 * Usa caché en memoria con TTL para no saturar la BD.
 */
export async function getCompactCatalogIndex(tenantId) {
  const now = Date.now();
  const cached = catalogCache.get(tenantId);

  // Retornar caché si es válido
  if (cached && (now - cached.timestamp < TTL_MS)) {
    return cached.csv;
  }

  // Si no hay caché o expiró, consultar a BD
  try {
    const products = await prisma.product.findMany({
      where: {
        user: { tenantId: tenantId },
        isAvailable: true
      },
      select: {
        id: true,
        name: true,
        price: true,
        promotionalPrice: true,
        category: true
      },
      orderBy: { name: 'asc' }
    });

    if (products.length === 0) {
      const emptyCsv = "ID,Nombre,Precio,Categoria\nNo hay productos disponibles actualmente.";
      catalogCache.set(tenantId, { csv: emptyCsv, timestamp: now });
      return emptyCsv;
    }

    // Construir CSV
    let csv = "ID,Nombre,Precio,Categoria\n";
    for (const p of products) {
      const priceToUse = (p.promotionalPrice && p.promotionalPrice > 0) ? p.promotionalPrice : p.price;
      const id = sanitizeForCsv(p.id);
      const name = sanitizeForCsv(p.name);
      const cat = sanitizeForCsv(p.category || 'General');
      csv += `${id},${name},S/. ${priceToUse},${cat}\n`;
    }

    catalogCache.set(tenantId, { csv, timestamp: now });
    return csv;

  } catch (error) {
    console.error(`❌ [CatalogCache] Error al obtener catálogo para tenant ${tenantId}:`, error.message);
    // En caso de error, si hay caché viejo, devolverlo para no caerse
    if (cached) return cached.csv;
    return "ID,Nombre,Precio,Categoria\nError al cargar catálogo.";
  }
}

/**
 * Permite invalidar manualmente el caché si se actualiza un producto en el dashboard
 */
export function invalidateCatalogCache(tenantId) {
  catalogCache.delete(tenantId);
}
