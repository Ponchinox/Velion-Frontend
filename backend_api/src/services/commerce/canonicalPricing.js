/**
 * canonicalPricing.js
 *
 * Fuente Única de Verdad (Single Source of Truth) para resolución de precios
 * y promociones en Velion.
 *
 * Compartido de forma canónica entre:
 * - CommerceService / VelionNativeProvider / ShopifyCachedProvider
 * - AI System Prompt (<catalog_index> / getCompactCatalogCsv)
 * - AI Tool Execution (get_product_details)
 * - Order Engine (orderCommercialService / syncCommercialOrder)
 * - Métricas de Inventario y Promociones (tenantDashboardController)
 */

/**
 * Determina si una promoción está vigente en el instante de tiempo dado (por defecto: ahora).
 *
 * Reglas de validez:
 * 1. promotionalPrice debe ser un número válido mayor a 0.
 * 2. Si price está definido y es mayor a 0, promotionalPrice debe ser estrictamente menor a price.
 * 3. Si promoStartDate está definida, now >= promoStartDate.
 * 4. Si promoEndDate está definida, now <= promoEndDate.
 * 5. Si no tiene fechas (ambas null o vacías), la promoción es indefinida y se considera activa
 *    mientras exista promotionalPrice válido.
 *
 * @param {object} product - Producto o item comercial ({ price, promotionalPrice, promoStartDate, promoEndDate })
 * @param {Date} [now] - Fecha de referencia (por defecto: new Date())
 * @returns {boolean}
 */
export function isPromotionActive(product, now = new Date()) {
  if (!product) return false;

  const promo = Number(product.promotionalPrice);
  if (!product.promotionalPrice || isNaN(promo) || promo <= 0) {
    return false;
  }

  const regular = Number(product.price);
  if (!isNaN(regular) && regular > 0 && promo >= regular) {
    return false;
  }

  const refTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (isNaN(refTime)) return false;

  if (product.promoStartDate) {
    const start = new Date(product.promoStartDate).getTime();
    if (!isNaN(start) && refTime < start) {
      return false;
    }
  }

  if (product.promoEndDate) {
    const end = new Date(product.promoEndDate).getTime();
    if (!isNaN(end) && refTime > end) {
      return false;
    }
  }

  return true;
}

/**
 * Obtiene el precio canónico vigente (efectivo) de un producto.
 * Si la promoción está activa -> retorna promotionalPrice.
 * En cualquier otro caso -> retorna price (o 0 si no existe).
 *
 * @param {object} product
 * @param {Date} [now]
 * @returns {number}
 */
export function getCanonicalProductPrice(product, now = new Date()) {
  if (!product) return 0;
  if (isPromotionActive(product, now)) {
    return Number(product.promotionalPrice);
  }
  return Number(product.price) || 0;
}

/**
 * Resuelve el desglose completo del precio y estado promocional de un producto.
 *
 * @param {object} product
 * @param {Date} [now]
 * @returns {{
 *   price: number,
 *   promotionalPrice: number|null,
 *   effectivePrice: number,
 *   hasActivePromo: boolean,
 *   promoDescription: string,
 *   promoStartDate: Date|null,
 *   promoEndDate: Date|null,
 *   currencyCode: string
 * }}
 */
export function resolveEffectivePrice(product, now = new Date()) {
  if (!product) {
    return {
      price: 0,
      promotionalPrice: null,
      effectivePrice: 0,
      hasActivePromo: false,
      promoDescription: 'Sin oferta vigente',
      promoStartDate: null,
      promoEndDate: null,
      currencyCode: 'PEN'
    };
  }

  const regularPrice = Number(product.price) || 0;
  const hasPromo = isPromotionActive(product, now);
  const promoPrice = hasPromo ? Number(product.promotionalPrice) : null;
  const effectivePrice = hasPromo ? promoPrice : regularPrice;

  let promoDescription = 'Sin oferta vigente';
  if (hasPromo) {
    if (product.promoEndDate) {
      const end = new Date(product.promoEndDate);
      if (!isNaN(end.getTime())) {
        const day = String(end.getDate()).padStart(2, '0');
        const month = String(end.getMonth() + 1).padStart(2, '0');
        promoDescription = `Oferta vigente (hasta ${day}/${month})`;
      } else {
        promoDescription = 'Oferta vigente';
      }
    } else {
      promoDescription = 'Oferta vigente';
    }
  }

  return {
    price: regularPrice,
    promotionalPrice: promoPrice,
    effectivePrice,
    hasActivePromo: hasPromo,
    promoDescription,
    promoStartDate: product.promoStartDate || null,
    promoEndDate: product.promoEndDate || null,
    currencyCode: product.currencyCode || 'PEN'
  };
}

export default {
  isPromotionActive,
  getCanonicalProductPrice,
  resolveEffectivePrice
};
