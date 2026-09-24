import { CommerceProvider } from './CommerceProvider.js';
import prisma from '../../db.js';

/**
 * Normaliza textos para el CSV (elimina comas y saltos de línea que rompan el formato).
 * Preserva exactamente la lógica canónica de catalogCacheService y VelionNativeProvider.
 */
function sanitizeForCsv(text) {
  if (!text) return '';
  return text.toString().replace(/[\r\n,]/g, ' ').trim();
}

/**
 * ShopifyCachedProvider
 *
 * Implementación del CommerceProvider para el catálogo sincronizado localmente desde Shopify.
 *
 * PRINCIPIO ARQUITECTÓNICO CENTRAL:
 * CERO llamadas de red a Shopify en runtime.
 * Prohibido el uso de fetch(), GraphQL, OAuth o shopifyGraphqlClient.
 * Lee exclusivamente los modelos locales 'ExternalProduct', 'ExternalProductVariant'
 * e 'Integration' de PostgreSQL a través de Prisma.
 *
 * UNIDAD VENDIBLE:
 * 1 Shopify Variant = 1 Commerce Item.
 * Commerce ID: 'shopify:<ExternalProductVariant.id>'
 */
export class ShopifyCachedProvider extends CommerceProvider {
  /**
   * @param {object} [db] - Cliente Prisma o adaptador in-memory para testing
   */
  constructor(db = null) {
    super('SHOPIFY');
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
   * Obtiene la moneda base de la tienda Shopify configurada para el tenant.
   * @param {string} tenantId
   * @returns {Promise<string|null>}
   */
  async getShopCurrency(tenantId) {
    if (!this._validateTenantId(tenantId) || !this.db?.integration?.findFirst) {
      return null;
    }
    try {
      const integration = await this.db.integration.findFirst({
        where: { tenantId: tenantId.trim(), provider: 'SHOPIFY' },
        select: { shopCurrencyCode: true }
      });
      return integration?.shopCurrencyCode || null;
    } catch {
      return null;
    }
  }

  /**
   * Normaliza ExternalProduct + ExternalProductVariant a la forma canónica
   * compatible con el contrato de Velion Commerce Item.
   * @private
   */
  _normalizeItem(variant, externalProduct, currencyCode = null) {
    const p = externalProduct || {};
    const rawVariantTitle = variant.title ? variant.title.trim() : '';
    const isDefaultTitle = !rawVariantTitle || rawVariantTitle.toLowerCase() === 'default title';
    const displayName = isDefaultTitle ? p.title : `${p.title} - ${rawVariantTitle}`;
    const isAvailable = Boolean(p.isAvailable && variant.availableForSale);

    return {
      id: `shopify:${variant.id}`,
      name: displayName,
      description: p.description || '',
      category: p.category || 'General',
      tags: Array.isArray(p.tags) ? p.tags : [],
      type: 'PHYSICAL_PRODUCT',
      price: variant.price,
      promotionalPrice: null,
      promoStartDate: null,
      promoEndDate: null,
      isAvailable: isAvailable,
      imageUrl: p.imageUrl || null,
      images: Array.isArray(p.images) ? p.images : [],
      videoUrl: null,
      sku: variant.sku || null,
      normalizedSku: variant.normalizedSku || null,
      inventoryQuantity: variant.inventoryQuantity,
      availableForSale: variant.availableForSale,
      source: 'SHOPIFY',
      currencyCode: currencyCode,
      externalProductId: p.id,
      externalVariantId: variant.externalVariantId,
      createdAt: variant.createdAt,
      updatedAt: variant.updatedAt
    };
  }

  /**
   * Obtiene un producto/variante por ID dentro del contexto del tenant.
   * Valida el namespace 'shopify:<uuid>', extrae el UUID local de la variante
   * y garantiza aislamiento multi-tenant estricto (tenantId + provider = 'SHOPIFY').
   *
   * @param {string} tenantId - ID del tenant (obligatorio)
   * @param {string} productId - ID con prefijo 'shopify:<variantLocalId>'
   * @returns {Promise<object|null>}
   */
  async getProduct(tenantId, productId) {
    if (!this._validateTenantId(tenantId) || !productId || typeof productId !== 'string') {
      return null;
    }

    const trimmedId = productId.trim();
    if (!trimmedId.startsWith('shopify:')) {
      return null;
    }

    const variantLocalId = trimmedId.slice('shopify:'.length).trim();
    if (!variantLocalId) {
      return null;
    }

    try {
      const variant = await this.db.externalProductVariant.findFirst({
        where: {
          id: variantLocalId,
          tenantId: tenantId.trim(),
          provider: 'SHOPIFY'
        },
        include: {
          externalProduct: true
        }
      });

      if (!variant || !variant.externalProduct) {
        return null;
      }

      const currencyCode = await this.getShopCurrency(tenantId);
      return this._normalizeItem(variant, variant.externalProduct, currencyCode);
    } catch (error) {
      console.error(`❌ [ShopifyCachedProvider] Error al obtener producto "${productId}" para tenant "${tenantId}":`, error.message);
      return null;
    }
  }

  /**
   * Busca productos/variantes en la caché local sincronizada del tenant.
   *
   * @param {string} tenantId - ID del tenant (obligatorio)
   * @param {object} [options] - Opciones de filtrado (isAvailable, category, query)
   * @returns {Promise<Array<object>>}
   */
  async searchProducts(tenantId, options = {}) {
    if (!this._validateTenantId(tenantId)) {
      return [];
    }

    try {
      const where = {
        tenantId: tenantId.trim(),
        provider: 'SHOPIFY'
      };

      if (options.isAvailable !== undefined) {
        const avail = Boolean(options.isAvailable);
        where.availableForSale = avail;
        where.externalProduct = {
          isAvailable: avail
        };
      }

      if (options.category && typeof options.category === 'string') {
        where.externalProduct = {
          ...(where.externalProduct || {}),
          category: options.category.trim()
        };
      }

      const variants = await this.db.externalProductVariant.findMany({
        where,
        include: {
          externalProduct: true
        },
        orderBy: { title: 'asc' }
      });

      if (!variants || variants.length === 0) {
        return [];
      }

      const currencyCode = await this.getShopCurrency(tenantId);
      let normalizedItems = variants
        .filter(v => Boolean(v.externalProduct))
        .map(v => this._normalizeItem(v, v.externalProduct, currencyCode));

      if (options.query && typeof options.query === 'string') {
        const q = options.query.toLowerCase().trim();
        normalizedItems = normalizedItems.filter(item => {
          const nameMatch = item.name.toLowerCase().includes(q);
          const skuMatch = item.sku && item.sku.toLowerCase().includes(q);
          const catMatch = item.category && item.category.toLowerCase().includes(q);
          return nameMatch || skuMatch || catMatch;
        });
      }

      return normalizedItems;
    } catch (error) {
      console.error(`❌ [ShopifyCachedProvider] Error en searchProducts para tenant "${tenantId}":`, error.message);
      return [];
    }
  }

  /**
   * Obtiene la disponibilidad y existencias de una variante de Shopify.
   *
   * REGLA COMERCIAL CRÍTICA:
   * La disponibilidad comercial NUNCA se decide mediante 'inventoryQuantity > 0'.
   * Respeta 'availableForSale' (Shopify permite productos con stock 0 y venta continua habilitada).
   *
   * @param {string} tenantId
   * @param {string} productId - 'shopify:<variantLocalId>'
   * @param {string} [variantId]
   * @returns {Promise<{ inStock: boolean, inventoryQuantity: number|null, isTracked: boolean }>}
   */
  async getStock(tenantId, productId, variantId = null) {
    const item = await this.getProduct(tenantId, productId);
    if (!item) {
      return { inStock: false, inventoryQuantity: null, isTracked: false };
    }

    // SHOPIFY_INVENTORY_TRACKING_KNOWN = NO
    // El cache local V1 de Shopify no almacena el booleano InventoryItem.tracked.
    // Prohibido inferir isTracked a partir de inventoryQuantity, inventoryItemId o availableForSale.
    // La autoridad de disponibilidad comercial es estrictamente:
    // product.isAvailable && variant.availableForSale
    // isTracked adopta la semántica conservadora compatible con contrato: false.
    return {
      inStock: Boolean(item.isAvailable),
      inventoryQuantity: item.inventoryQuantity,
      isTracked: false
    };
  }

  /**
   * Obtiene el precio canónico vigente de una variante de Shopify.
   * No aplica promociones nativas sobre ítems puramente Shopify.
   *
   * @param {string} tenantId
   * @param {string} productId - 'shopify:<variantLocalId>'
   * @param {string} [variantId]
   * @returns {Promise<{ price: number, promotionalPrice: number|null, effectivePrice: number, hasActivePromo: boolean }>}
   */
  async getPrice(tenantId, productId, variantId = null) {
    const item = await this.getProduct(tenantId, productId);
    if (!item) {
      return { price: 0, promotionalPrice: null, effectivePrice: 0, hasActivePromo: false, currencyCode: null };
    }

    return {
      price: item.price,
      promotionalPrice: null,
      effectivePrice: item.price,
      hasActivePromo: false,
      currencyCode: item.currencyCode || null
    };
  }

  /**
   * Genera el índice de catálogo compacto en formato CSV para el prompt de la IA.
   * Mantiene estricta compatibilidad con el encabezado canónico:
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

    const items = await this.searchProducts(tenantId, options);
    if (!items || items.length === 0) {
      return "ID,Nombre,Precio,Tipo,Disponible,Categoria\nNo hay productos en el catálogo actualmente.";
    }

    const currencyCode = await this.getShopCurrency(tenantId);
    let csv = "ID,Nombre,Precio,Tipo,Disponible,Categoria\n";
    for (const item of items) {
      const id = sanitizeForCsv(item.id);
      const name = sanitizeForCsv(item.name);
      const priceToUse = item.price;
      const prodType = 'PHYSICAL_PRODUCT';
      const availableStr = item.isAvailable ? 'Sí' : 'No';
      const cat = sanitizeForCsv(item.category || 'General');
      const formattedPrice = (currencyCode && currencyCode !== 'PEN')
        ? `${currencyCode} ${priceToUse}`
        : (currencyCode === 'PEN' ? `S/. ${priceToUse}` : `${priceToUse}`);
      csv += `${id},${name},${formattedPrice},${prodType},${availableStr},${cat}\n`;
    }

    return csv;
  }
}

export default ShopifyCachedProvider;
