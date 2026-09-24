import { VelionNativeProvider } from './VelionNativeProvider.js';
import { ShopifyCachedProvider } from './ShopifyCachedProvider.js';
import prisma from '../../db.js';

/**
 * Normaliza textos para el CSV (elimina comas y saltos de línea que rompan el formato).
 */
function sanitizeForCsv(text) {
  if (!text) return '';
  return text.toString().replace(/[\r\n,]/g, ' ').trim();
}

/**
 * CommerceService
 *
 * Orquestador central de operaciones comerciales de Velion Agent.
 * Actúa como punto único de entrada para catálogo, stock y precios.
 *
 * FASE 4C: Orquestación multi-modo según la configuración del tenant:
 * - VELION_ONLY: 100% VelionNativeProvider (paridad byte-for-byte con Fase 1).
 * - SHOPIFY_ONLY: 100% ShopifyCachedProvider. Falla controladamente con
 *                 'SHOPIFY_INTEGRATION_NOT_CONNECTED' si no está conectado.
 * - COMBINED: Resolución combinada Native + Shopify cache con SKU Matching 1:1 estricto.
 *             Si Shopify se desconecta, degrada de forma segura a Native-only.
 *
 * INVARIANTE ARQUITECTÓNICO:
 * CERO llamadas live de red a Shopify en runtime de conversaciones.
 */
export class CommerceService {
  /**
   * @param {object} [db] - Adaptador opcional para testing in-memory
   */
  constructor(db = null) {
    this.db = (db && (db.prisma || db.db)) || db || prisma;
    this.nativeProvider = new VelionNativeProvider(this.db);
    this.shopifyCachedProvider = new ShopifyCachedProvider(this.db);
  }

  /**
   * Actualiza la conexión a base de datos de los proveedores (para testing)
   * @param {object} dbClient
   */
  setDb(dbClient) {
    this.db = dbClient || prisma;
    this.nativeProvider.setDb(dbClient);
    this.shopifyCachedProvider.setDb(dbClient);
  }

  /**
   * Retorna la instancia del proveedor nativo
   * @returns {VelionNativeProvider}
   */
  getNativeProvider() {
    return this.nativeProvider;
  }

  /**
   * Retorna la instancia del proveedor Shopify cached
   * @returns {ShopifyCachedProvider}
   */
  getShopifyCachedProvider() {
    return this.shopifyCachedProvider;
  }

  /**
   * Consulta la configuración comercial del tenant desde la tabla Integration.
   * Si no existe integración de Shopify, asume VELION_ONLY de forma segura.
   *
   * @param {string} tenantId
   * @returns {Promise<{ catalogMode: string, priceSource: string, stockSource: string, isConnected: boolean, integration: object|null }>}
   */
  async getTenantConfig(tenantId, options = {}) {
    if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
      return {
        catalogMode: options?.catalogMode || 'VELION_ONLY',
        priceSource: options?.priceSource || 'VELION',
        stockSource: options?.stockSource || 'VELION',
        isConnected: false,
        integration: null
      };
    }

    try {
      if (!this.db?.integration?.findFirst) {
        return {
          catalogMode: options?.catalogMode || 'VELION_ONLY',
          priceSource: options?.priceSource || 'VELION',
          stockSource: options?.stockSource || 'VELION',
          isConnected: false,
          integration: null
        };
      }

      let nativeCurrency = 'PEN';
      try {
        if (this.db?.tenant?.findUnique) {
          const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId.trim() },
            select: { currencyCode: true }
          });
          if (tenant?.currencyCode) nativeCurrency = tenant.currencyCode;
        }
      } catch {}

      const integration = await this.db.integration.findFirst({
        where: {
          tenantId: tenantId.trim(),
          provider: 'SHOPIFY'
        },
        select: {
          id: true,
          status: true,
          catalogMode: true,
          priceSource: true,
          stockSource: true,
          shopCurrencyCode: true
        }
      });

      const catalogMode = options?.catalogMode || integration?.catalogMode || (integration ? 'COMBINED' : 'VELION_ONLY');
      const priceSource = options?.priceSource || integration?.priceSource || (integration ? 'SHOPIFY' : 'VELION');
      const stockSource = options?.stockSource || integration?.stockSource || (integration ? 'SHOPIFY' : 'VELION');
      const isConnected = Boolean(integration && integration.status === 'CONNECTED');
      const shopCurrency = integration?.shopCurrencyCode || null;

      return {
        catalogMode,
        priceSource,
        stockSource,
        isConnected,
        integration,
        nativeCurrency,
        shopCurrency
      };
    } catch (error) {
      console.error(`❌ [CommerceService] Error consultando configuración del tenant "${tenantId}":`, error.message);
      return {
        catalogMode: options?.catalogMode || 'VELION_ONLY',
        priceSource: options?.priceSource || 'VELION',
        stockSource: options?.stockSource || 'VELION',
        isConnected: false,
        integration: null
      };
    }
  }

  /**
   * Realiza la resolución del catálogo combinado (Native + Shopify cache)
   * aplicando coincidencia exacta 1:1 por normalizedSku.
   *
   * REGLAS ESTRICTAS DE RESOLUCIÓN:
   * 1. normalizedSku != null en ambos lados.
   * 2. Exactamente 1 candidato Native y 1 candidato Shopify para ese SKU (UNIQUE_1_TO_1_MATCH).
   * 3. Si hay ambigüedad (2+ nativos o 2+ Shopify con el mismo SKU): NO merge, permanecen separados.
   * 4. En ítems combinados:
   *    - ID: Product.id nativo (preserva compatibilidad con IA y flujos existentes).
   *    - Contenido descriptivo: Velion Native.
   *    - Precio: gobernado por priceSource (VELION o SHOPIFY).
   *    - Stock/Disponibilidad: gobernado por stockSource (VELION o SHOPIFY).
   *
   * @param {string} tenantId
   * @param {object} [config]
   * @returns {Promise<Array<object>>}
   */
  async resolveCombinedCatalog(tenantId, config = null, options = {}) {
    const cfg = config || await this.getTenantConfig(tenantId);
    if (!cfg.isConnected) {
      // Degradar de forma segura a catálogo nativo
      return this.nativeProvider.searchProducts(tenantId, options);
    }

    const [nativeProducts, shopifyItems] = await Promise.all([
      this.nativeProvider.searchProducts(tenantId, options),
      this.shopifyCachedProvider.searchProducts(tenantId, options)
    ]);

    // Mapear candidatos por normalizedSku
    const nativeBySku = new Map();
    for (const np of nativeProducts) {
      if (np.normalizedSku && typeof np.normalizedSku === 'string' && np.normalizedSku.trim()) {
        const skuKey = np.normalizedSku.trim();
        if (!nativeBySku.has(skuKey)) nativeBySku.set(skuKey, []);
        nativeBySku.get(skuKey).push(np);
      }
    }

    const shopifyBySku = new Map();
    for (const sp of shopifyItems) {
      if (sp.normalizedSku && typeof sp.normalizedSku === 'string' && sp.normalizedSku.trim()) {
        const skuKey = sp.normalizedSku.trim();
        if (!shopifyBySku.has(skuKey)) shopifyBySku.set(skuKey, []);
        shopifyBySku.get(skuKey).push(sp);
      }
    }

    const mergedItems = [];
    const matchedNativeIds = new Set();
    const matchedShopifyIds = new Set();

    // Evaluar cada SKU presente en Native
    for (const [sku, nativeList] of nativeBySku.entries()) {
      const shopifyList = shopifyBySku.get(sku) || [];

      // Detección de ambigüedad
      if (nativeList.length > 1) {
        console.warn(`⚠️ [CommerceService] AMBIGUOUS_NATIVE_SKU: Tenant "${tenantId}" tiene ${nativeList.length} productos nativos con SKU "${sku}". Permanecen separados.`);
        continue;
      }
      if (shopifyList.length > 1) {
        console.warn(`⚠️ [CommerceService] AMBIGUOUS_SHOPIFY_SKU: Tenant "${tenantId}" tiene ${shopifyList.length} variantes Shopify con SKU "${sku}". Permanecen separados.`);
        continue;
      }

      // Exactamente 1 a 1: UNIQUE_1_TO_1_MATCH
      if (nativeList.length === 1 && shopifyList.length === 1) {
        const nat = nativeList[0];
        const shp = shopifyList[0];

        // Resolver precio según priceSource
        let basePrice = nat.price;
        let effectivePrice = nat.price;
        let promotionalPrice = null;
        let hasActivePromo = false;

        if (cfg.priceSource === 'SHOPIFY') {
          basePrice = shp.price;
          effectivePrice = shp.price;
          promotionalPrice = null;
          hasActivePromo = false;
        } else {
          // VELION: reutilizar cálculo de promociones de VelionNativeProvider
          const priceInfo = await this.nativeProvider.getPrice(tenantId, nat.id);
          basePrice = priceInfo.price;
          effectivePrice = priceInfo.effectivePrice;
          promotionalPrice = priceInfo.promotionalPrice;
          hasActivePromo = priceInfo.hasActivePromo;
        }

        // Resolver stock según stockSource
        let isAvailable = Boolean(nat.isAvailable);
        let inStock = isAvailable;
        let inventoryQuantity = null;

        if (cfg.stockSource === 'SHOPIFY') {
          isAvailable = Boolean(shp.isAvailable);
          inStock = isAvailable;
          inventoryQuantity = shp.inventoryQuantity;
        }

        mergedItems.push({
          id: nat.id, // ID nativo conservado
          name: nat.name,
          description: nat.description,
          category: nat.category,
          tags: nat.tags,
          type: nat.type,
          price: basePrice,
          effectivePrice: effectivePrice,
          promotionalPrice: promotionalPrice,
          promoStartDate: nat.promoStartDate || null,
          promoEndDate: nat.promoEndDate || null,
          hasActivePromo: hasActivePromo,
          isAvailable: isAvailable,
          inStock: inStock,
          imageUrl: nat.imageUrl,
          images: nat.images,
          videoUrl: nat.videoUrl,
          sku: nat.sku || shp.sku,
          normalizedSku: sku,
          inventoryQuantity: inventoryQuantity,
          source: 'MERGED',
          currencyCode: cfg.priceSource === 'SHOPIFY' ? (cfg.shopCurrency || 'USD') : (cfg.nativeCurrency || 'PEN'),
          nativeProductId: nat.id,
          shopifyVariantLocalId: shp.id ? shp.id.replace('shopify:', '') : null,
          externalProductId: shp.externalProductId || null,
          externalVariantId: shp.externalVariantId || null
        });

        matchedNativeIds.add(nat.id);
        matchedShopifyIds.add(shp.id);
      }
    }

    // Unmatched Native
    const unmatchedNative = nativeProducts
      .filter(np => !matchedNativeIds.has(np.id))
      .map(np => ({ ...np, source: 'VELION', currencyCode: np.currencyCode || cfg.nativeCurrency || 'PEN' }));

    // Unmatched Shopify
    const unmatchedShopify = shopifyItems
      .filter(sp => !matchedShopifyIds.has(sp.id))
      .map(sp => ({ ...sp, source: 'SHOPIFY', currencyCode: sp.currencyCode || cfg.shopCurrency || null }));

    return [...mergedItems, ...unmatchedNative, ...unmatchedShopify];
  }

  /**
   * Obtiene un producto por ID dentro del contexto del tenant.
   * Rutea según el prefijo del ID y el catalogMode configurado.
   *
   * @param {string} tenantId - ID del tenant (obligatorio)
   * @param {string} productId - ID del producto
   * @returns {Promise<object|null>}
   */
  async getProduct(tenantId, productId, options = {}) {
    if (!tenantId || !productId || typeof productId !== 'string') {
      return null;
    }

    const config = await this.getTenantConfig(tenantId, options);
    const isShopifyPrefixed = productId.trim().startsWith('shopify:');

    // 1. Caso ID Shopify: 'shopify:<uuid>'
    if (isShopifyPrefixed) {
      if (config.catalogMode === 'VELION_ONLY') {
        return null; // En VELION_ONLY los ítems Shopify son invisibles
      }
      if (config.catalogMode === 'SHOPIFY_ONLY' && !config.isConnected) {
        throw new Error('SHOPIFY_INTEGRATION_NOT_CONNECTED');
      }
      if (config.catalogMode === 'COMBINED' && !config.isConnected) {
        return null; // Degrado seguro a nativo
      }
      return this.shopifyCachedProvider.getProduct(tenantId, productId);
    }

    // 2. Caso ID Nativo (UUID)
    if (config.catalogMode === 'SHOPIFY_ONLY') {
      if (!config.isConnected) {
        throw new Error('SHOPIFY_INTEGRATION_NOT_CONNECTED');
      }
      return null; // En SHOPIFY_ONLY los ítems nativos puros son invisibles
    }

    const nativeProduct = await this.nativeProvider.getProduct(tenantId, productId);
    if (!nativeProduct) {
      return null;
    }

    // En modo COMBINED: verificar si este producto tiene match 1:1 con variante Shopify
    if (config.catalogMode === 'COMBINED' && config.isConnected && nativeProduct.normalizedSku) {
      try {
        const matchingVariants = await this.db.externalProductVariant.findMany({
          where: {
            tenantId: tenantId.trim(),
            provider: 'SHOPIFY',
            normalizedSku: nativeProduct.normalizedSku
          },
          include: { externalProduct: true }
        });

        if (matchingVariants.length === 1) {
          const countNativeWithSku = await this.db.product.count({
            where: {
              user: { tenantId: tenantId.trim() },
              normalizedSku: nativeProduct.normalizedSku
            }
          });

          if (countNativeWithSku === 1) {
            const shp = matchingVariants[0];

            // Aplicar priceSource
            if (config.priceSource === 'SHOPIFY') {
              nativeProduct.price = shp.price;
              nativeProduct.promotionalPrice = null;
              nativeProduct.promoStartDate = null;
              nativeProduct.promoEndDate = null;
              nativeProduct.currencyCode = config.shopCurrency || 'USD';
            } else {
              nativeProduct.currencyCode = config.nativeCurrency || 'PEN';
            }

            // Aplicar stockSource
            if (config.stockSource === 'SHOPIFY') {
              nativeProduct.isAvailable = Boolean(shp.externalProduct?.isAvailable && shp.availableForSale);
            }

            nativeProduct.source = 'MERGED';
            nativeProduct.shopifyVariantLocalId = shp.id;
            nativeProduct.externalProductId = shp.externalProduct?.id || null;
            nativeProduct.externalVariantId = shp.externalVariantId || null;
          }
        }
      } catch (err) {
        console.warn(`⚠️ [CommerceService] Advertencia al resolver match en getProduct:`, err.message);
      }
    }

    if (!nativeProduct.source) {
      nativeProduct.source = 'VELION';
    }
    if (!nativeProduct.currencyCode) {
      nativeProduct.currencyCode = config.nativeCurrency || 'PEN';
    }

    return nativeProduct;
  }

  /**
   * Busca productos en el catálogo del tenant según catalogMode.
   *
   * @param {string} tenantId - ID del tenant (obligatorio)
   * @param {object} [options]
   * @returns {Promise<Array<object>>}
   */
  async searchProducts(tenantId, options = {}) {
    const config = await this.getTenantConfig(tenantId, options);

    if (config.catalogMode === 'VELION_ONLY') {
      return this.nativeProvider.searchProducts(tenantId, options);
    }

    if (config.catalogMode === 'SHOPIFY_ONLY') {
      if (!config.isConnected) {
        throw new Error('SHOPIFY_INTEGRATION_NOT_CONNECTED');
      }
      return this.shopifyCachedProvider.searchProducts(tenantId, options);
    }

    // Modo COMBINED
    if (!config.isConnected) {
      return this.nativeProvider.searchProducts(tenantId, options);
    }

    const resolved = await this.resolveCombinedCatalog(tenantId, config);
    let filtered = resolved;

    if (options.isAvailable !== undefined) {
      filtered = filtered.filter(p => Boolean(p.isAvailable) === Boolean(options.isAvailable));
    }

    if (options.category && typeof options.category === 'string') {
      const cat = options.category.toLowerCase().trim();
      filtered = filtered.filter(p => p.category && p.category.toLowerCase().includes(cat));
    }

    if (options.query && typeof options.query === 'string') {
      const q = options.query.toLowerCase().trim();
      filtered = filtered.filter(p => {
        const nameMatch = p.name && p.name.toLowerCase().includes(q);
        const skuMatch = p.sku && p.sku.toLowerCase().includes(q);
        const catMatch = p.category && p.category.toLowerCase().includes(q);
        return nameMatch || skuMatch || catMatch;
      });
    }

    return filtered;
  }

  /**
   * Obtiene el estado de disponibilidad e inventario de un producto.
   *
   * @param {string} tenantId - ID del tenant (obligatorio)
   * @param {string} productId - ID del producto
   * @param {string} [variantId]
   * @param {object} [options]
   * @returns {Promise<{ inStock: boolean, inventoryQuantity: number|null, isTracked: boolean }>}
   */
  async getStock(tenantId, productId, variantId = null, options = {}) {
    if (!productId || typeof productId !== 'string') {
      return { inStock: false, inventoryQuantity: null, isTracked: false };
    }

    const config = await this.getTenantConfig(tenantId, options);
    const isShopifyPrefixed = productId.trim().startsWith('shopify:');

    if (isShopifyPrefixed) {
      if (config.catalogMode === 'VELION_ONLY') {
        return { inStock: false, inventoryQuantity: null, isTracked: false };
      }
      if (config.catalogMode === 'SHOPIFY_ONLY' && !config.isConnected) {
        throw new Error('SHOPIFY_INTEGRATION_NOT_CONNECTED');
      }
      if (config.catalogMode === 'COMBINED' && !config.isConnected) {
        return { inStock: false, inventoryQuantity: null, isTracked: false };
      }
      return this.shopifyCachedProvider.getStock(tenantId, productId, variantId);
    }

    if (config.catalogMode === 'SHOPIFY_ONLY') {
      if (!config.isConnected) {
        throw new Error('SHOPIFY_INTEGRATION_NOT_CONNECTED');
      }
      return { inStock: false, inventoryQuantity: null, isTracked: false };
    }

    // En COMBINED: si el ítem nativo está fusionado y stockSource === 'SHOPIFY', usar stock de Shopify
    if (config.catalogMode === 'COMBINED' && config.isConnected && config.stockSource === 'SHOPIFY') {
      const product = await this.getProduct(tenantId, productId, options);
      if (product && product.source === 'MERGED') {
        return {
          inStock: Boolean(product.isAvailable),
          inventoryQuantity: null,
          isTracked: false
        };
      }
    }

    return this.nativeProvider.getStock(tenantId, productId, variantId);
  }

  /**
   * Obtiene el precio canónico vigente de un producto.
   *
   * @param {string} tenantId - ID del tenant (obligatorio)
   * @param {string} productId - ID del producto
   * @param {string} [variantId]
   * @param {object} [options]
   * @returns {Promise<{ price: number, promotionalPrice: number|null, effectivePrice: number, hasActivePromo: boolean }>}
   */
  async getPrice(tenantId, productId, variantId = null, options = {}) {
    if (!productId || typeof productId !== 'string') {
      return { price: 0, promotionalPrice: null, effectivePrice: 0, hasActivePromo: false };
    }

    const config = await this.getTenantConfig(tenantId, options);
    const isShopifyPrefixed = productId.trim().startsWith('shopify:');

    if (isShopifyPrefixed) {
      if (config.catalogMode === 'VELION_ONLY') {
        return { price: 0, promotionalPrice: null, effectivePrice: 0, hasActivePromo: false };
      }
      if (config.catalogMode === 'SHOPIFY_ONLY' && !config.isConnected) {
        throw new Error('SHOPIFY_INTEGRATION_NOT_CONNECTED');
      }
      if (config.catalogMode === 'COMBINED' && !config.isConnected) {
        return { price: 0, promotionalPrice: null, effectivePrice: 0, hasActivePromo: false };
      }
      return this.shopifyCachedProvider.getPrice(tenantId, productId, variantId);
    }

    if (config.catalogMode === 'SHOPIFY_ONLY') {
      if (!config.isConnected) {
        throw new Error('SHOPIFY_INTEGRATION_NOT_CONNECTED');
      }
      return { price: 0, promotionalPrice: null, effectivePrice: 0, hasActivePromo: false };
    }

    // En COMBINED: si el ítem nativo está fusionado y priceSource === 'SHOPIFY', usar precio de Shopify
    if (config.catalogMode === 'COMBINED' && config.isConnected && config.priceSource === 'SHOPIFY') {
      const product = await this.getProduct(tenantId, productId, options);
      if (product && product.source === 'MERGED') {
        return {
          price: product.price,
          promotionalPrice: null,
          effectivePrice: product.price,
          hasActivePromo: false,
          currencyCode: product.currencyCode || config.shopCurrency || 'USD'
        };
      }
    }

    const nativePrice = await this.nativeProvider.getPrice(tenantId, productId, variantId);
    return {
      ...nativePrice,
      currencyCode: nativePrice.currencyCode || config.nativeCurrency || 'PEN'
    };
  }

  /**
   * Genera el índice de catálogo en formato CSV para el prompt de la IA.
   *
   * Formato canónico estricto:
   * "ID,Nombre,Precio,Tipo,Disponible,Categoria\n"
   *
   * @param {string} tenantId - ID del tenant (obligatorio)
   * @param {object} [options]
   * @returns {Promise<string>}
   */
  async getCompactCatalogCsv(tenantId, options = {}) {
    const config = await this.getTenantConfig(tenantId, options);

    // 1. Modo VELION_ONLY: paridad 100% byte-for-byte con Fase 1
    if (config.catalogMode === 'VELION_ONLY') {
      return this.nativeProvider.getCompactCatalogCsv(tenantId, options);
    }

    // 2. Modo SHOPIFY_ONLY
    if (config.catalogMode === 'SHOPIFY_ONLY') {
      if (!config.isConnected) {
        throw new Error('SHOPIFY_INTEGRATION_NOT_CONNECTED');
      }
      return this.shopifyCachedProvider.getCompactCatalogCsv(tenantId, options);
    }

    // 3. Modo COMBINED: si no está conectado, degradación elegante a Native-only
    if (!config.isConnected) {
      return this.nativeProvider.getCompactCatalogCsv(tenantId, options);
    }

    const resolvedItems = await this.resolveCombinedCatalog(tenantId, config, options);
    const itemsToInclude = (options.isAvailable !== undefined)
      ? resolvedItems.filter(item => Boolean(item.isAvailable) === Boolean(options.isAvailable))
      : resolvedItems;

    if (!itemsToInclude || itemsToInclude.length === 0) {
      return "ID,Nombre,Precio,Tipo,Disponible,Categoria\nNo hay productos en el catálogo actualmente.";
    }

    let csv = "ID,Nombre,Precio,Tipo,Disponible,Categoria\n";
    for (const item of itemsToInclude) {
      const priceToUse = (item.promotionalPrice && item.promotionalPrice > 0) ? item.promotionalPrice : item.price;
      const id = sanitizeForCsv(item.id);
      const name = sanitizeForCsv(item.name);
      const prodType = item.type === 'SERVICE' ? 'SERVICE' : 'PHYSICAL_PRODUCT';
      const availableStr = item.isAvailable ? 'Sí' : 'No';
      const cat = sanitizeForCsv(item.category || 'General');
      const curr = item.currencyCode || (item.source === 'SHOPIFY' ? config.shopCurrency : config.nativeCurrency) || 'PEN';
      const formattedPrice = (curr && curr !== 'PEN')
        ? `${curr} ${priceToUse}`
        : (curr === 'PEN' ? `S/. ${priceToUse}` : `${priceToUse}`);
      csv += `${id},${name},${formattedPrice},${prodType},${availableStr},${cat}\n`;
    }

    return csv;
  }
}

// Instancia singleton por defecto para runtime
export const commerceService = new CommerceService();
export default commerceService;
