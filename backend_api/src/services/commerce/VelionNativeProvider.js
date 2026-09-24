import { CommerceProvider } from './CommerceProvider.js';
import prisma from '../../db.js';

/**
 * Normaliza textos para el CSV (elimina comas y saltos de línea que rompan el formato).
 * Preserva exactamente la lógica de catalogCacheService.
 */
function sanitizeForCsv(text) {
  if (!text) return '';
  return text.toString().replace(/[\r\n,]/g, ' ').trim();
}

/**
 * VelionNativeProvider
 *
 * Implementación del CommerceProvider para el catálogo interno y nativo de Velion.
 * Encapsula consultas a los modelos 'Product' y 'User' preservando idéntico
 * comportamiento, formato CSV, resolución de precios y compatibilidad con
 * productMediaOrchestrator.
 */
export class VelionNativeProvider extends CommerceProvider {
  /**
   * @param {object} [db] - Cliente Prisma o adaptador in-memory para testing
   */
  constructor(db = null) {
    super('VELION_NATIVE');
    this.db = (db && (db.prisma || db.db)) || db || prisma;
  }

  /**
   * Permite actualizar la instancia de BD (útil en tests con adaptadores mock)
   * @param {object} dbClient
   */
  setDb(dbClient) {
    this.db = dbClient || prisma;
  }

  /**
   * Valida y asegura que el tenantId sea válido y no vacío.
   * @private
   */
  _validateTenantId(tenantId) {
    if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
      return false;
    }
    return true;
  }

  /**
   * Obtiene el código de moneda configurado para el tenant (por defecto 'PEN').
   * @param {string} tenantId
   * @returns {Promise<string>}
   */
  async getTenantCurrency(tenantId) {
    if (!this._validateTenantId(tenantId) || !this.db?.tenant?.findUnique) {
      return 'PEN';
    }
    try {
      const tenant = await this.db.tenant.findUnique({
        where: { id: tenantId.trim() },
        select: { currencyCode: true }
      });
      return tenant?.currencyCode || 'PEN';
    } catch {
      return 'PEN';
    }
  }

  /**
   * Obtiene un producto por ID dentro del contexto del tenant.
   * Garantiza aislamiento estricto (where: { id, user: { tenantId } }).
   *
   * @param {string} tenantId - ID del tenant (obligatorio)
   * @param {string} productId - ID del producto
   * @returns {Promise<object|null>}
   */
  async getProduct(tenantId, productId) {
    if (!this._validateTenantId(tenantId) || !productId || typeof productId !== 'string') {
      return null;
    }

    try {
      const product = await this.db.product.findFirst({
        where: {
          id: productId.trim(),
          user: { tenantId: tenantId.trim() }
        },
        select: {
          id: true,
          name: true,
          description: true,
          price: true,
          category: true,
          type: true,
          tags: true,
          isAvailable: true,
          promotionalPrice: true,
          promoStartDate: true,
          promoEndDate: true,
          imageUrl: true,
          images: true,
          videoUrl: true,
          sku: true,
          normalizedSku: true,
          createdAt: true,
          updatedAt: true
        }
      });

      if (!product) {
        return null;
      }

      product.source = 'VELION';
      product.currencyCode = await this.getTenantCurrency(tenantId);
      return product;
    } catch (error) {
      console.error(`❌ [VelionNativeProvider] Error al obtener producto "${productId}" para tenant "${tenantId}":`, error.message);
      return null;
    }
  }

  /**
   * Busca productos en el catálogo del tenant.
   *
   * @param {string} tenantId - ID del tenant (obligatorio)
   * @param {object} [options] - Opciones de filtrado
   * @returns {Promise<Array<object>>}
   */
  async searchProducts(tenantId, options = {}) {
    if (!this._validateTenantId(tenantId)) {
      return [];
    }

    try {
      const where = {
        user: { tenantId: tenantId.trim() }
      };

      if (options.isAvailable !== undefined) {
        where.isAvailable = Boolean(options.isAvailable);
      }

      if (options.category && typeof options.category === 'string') {
        where.category = options.category.trim();
      }

      const products = await this.db.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          price: true,
          category: true,
          type: true,
          tags: true,
          isAvailable: true,
          promotionalPrice: true,
          promoStartDate: true,
          promoEndDate: true,
          imageUrl: true,
          images: true,
          videoUrl: true,
          sku: true,
          normalizedSku: true
        },
        orderBy: { name: 'asc' }
      });

      const currencyCode = await this.getTenantCurrency(tenantId);
      return (products || []).map(p => ({ ...p, source: 'VELION', currencyCode }));
    } catch (error) {
      console.error(`❌ [VelionNativeProvider] Error en searchProducts para tenant "${tenantId}":`, error.message);
      return [];
    }
  }

  /**
   * Obtiene la disponibilidad y existencias de un producto.
   * En Velion Native la disponibilidad es estrictamente binaria (isAvailable).
   *
   * @param {string} tenantId
   * @param {string} productId
   * @param {string} [variantId]
   * @returns {Promise<{ inStock: boolean, inventoryQuantity: number|null, isTracked: boolean }>}
   */
  async getStock(tenantId, productId, variantId = null) {
    const product = await this.getProduct(tenantId, productId);
    if (!product) {
      return { inStock: false, inventoryQuantity: null, isTracked: false };
    }

    return {
      inStock: Boolean(product.isAvailable),
      inventoryQuantity: null, // Velion Nativo no maneja contador numérico
      isTracked: false
    };
  }

  /**
   * Obtiene el precio canónico vigente de un producto, considerando promociones por fecha y moneda.
   *
   * @param {string} tenantId
   * @param {string} productId
   * @param {string} [variantId]
   * @returns {Promise<{ price: number, promotionalPrice: number|null, effectivePrice: number, hasActivePromo: boolean, currencyCode: string }>}
   */
  async getPrice(tenantId, productId, variantId = null) {
    const product = await this.getProduct(tenantId, productId);
    if (!product) {
      return { price: 0, promotionalPrice: null, effectivePrice: 0, hasActivePromo: false, currencyCode: 'PEN' };
    }

    const now = new Date();
    let hasActivePromo = false;

    if (product.promotionalPrice && product.promotionalPrice > 0) {
      const start = product.promoStartDate ? new Date(product.promoStartDate) : null;
      const end = product.promoEndDate ? new Date(product.promoEndDate) : null;
      if ((!start || now >= start) && (!end || now <= end)) {
        hasActivePromo = true;
      }
    }

    const effectivePrice = hasActivePromo ? product.promotionalPrice : product.price;

    return {
      price: product.price,
      promotionalPrice: hasActivePromo ? product.promotionalPrice : null,
      effectivePrice: effectivePrice,
      hasActivePromo: hasActivePromo,
      currencyCode: product.currencyCode || 'PEN'
    };
  }

  /**
   * Genera el índice de catálogo compacto en formato CSV para el system prompt del agente.
   * Mantiene paridad byte-for-byte con el formato generado por catalogCacheService:
   * "ID,Nombre,Precio,Tipo,Disponible,Categoria\n"
   *
   * @param {string} tenantId
   * @param {object} [options]
   * @returns {Promise<string>}
   */
  async getCompactCatalogCsv(tenantId, options = {}) {
    if (!this._validateTenantId(tenantId)) {
      return "ID,Nombre,Precio,Tipo,Disponible,Categoria\nNo hay productos en el catálogo actualmente.";
    }

    const currencyCode = await this.getTenantCurrency(tenantId);

    const where = {
      user: { tenantId: tenantId.trim() }
    };
    if (options.isAvailable !== undefined) {
      where.isAvailable = Boolean(options.isAvailable);
    }

    const products = await this.db.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        price: true,
        promotionalPrice: true,
        category: true,
        type: true,
        isAvailable: true
      },
      orderBy: { name: 'asc' }
    });

    if (!products || products.length === 0) {
      return "ID,Nombre,Precio,Tipo,Disponible,Categoria\nNo hay productos en el catálogo actualmente.";
    }

    let csv = "ID,Nombre,Precio,Tipo,Disponible,Categoria\n";
    for (const p of products) {
      const priceToUse = (p.promotionalPrice && p.promotionalPrice > 0) ? p.promotionalPrice : p.price;
      const id = sanitizeForCsv(p.id);
      const name = sanitizeForCsv(p.name);
      const prodType = p.type === 'SERVICE' ? 'SERVICE' : 'PHYSICAL_PRODUCT';
      const availableStr = p.isAvailable ? 'Sí' : 'No';
      const cat = sanitizeForCsv(p.category || 'General');
      const formattedPrice = currencyCode === 'PEN' ? `S/. ${priceToUse}` : `${currencyCode} ${priceToUse}`;
      csv += `${id},${name},${formattedPrice},${prodType},${availableStr},${cat}\n`;
    }

    return csv;
  }
}

export default VelionNativeProvider;
