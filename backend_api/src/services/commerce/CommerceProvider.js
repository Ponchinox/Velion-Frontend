/**
 * CommerceProvider.js
 *
 * Contrato base e interfaz abstracta para proveedores de comercio (Velion Native, Shopify, etc.).
 * Define las operaciones comerciales abstractas requeridas por Velion Agent.
 *
 * REGLA MULTI-TENANT: Todas las operaciones exigen tenantId explícito de forma obligatoria.
 * Ninguna operación puede consultar globalmente ni cruzar datos entre tenants.
 */
export class CommerceProvider {
  /**
   * @param {string} providerName - Identificador del proveedor ('VELION_NATIVE', 'SHOPIFY', etc.)
   */
  constructor(providerName) {
    if (!providerName || typeof providerName !== 'string') {
      throw new Error('CommerceProvider requiere un providerName válido.');
    }
    this.providerName = providerName;
  }

  /**
   * Retorna el nombre del proveedor.
   * @returns {string}
   */
  getProviderName() {
    return this.providerName;
  }

  /**
   * Obtiene un producto por ID dentro del contexto del tenant.
   * @param {string} tenantId - ID del tenant (obligatorio)
   * @param {string} productId - ID del producto
   * @returns {Promise<object|null>}
   */
  async getProduct(tenantId, productId) {
    throw new Error(`[${this.providerName}] getProduct(tenantId, productId) debe ser implementado.`);
  }

  /**
   * Busca productos en el catálogo del tenant.
   * @param {string} tenantId - ID del tenant (obligatorio)
   * @param {object} [options] - Opciones de filtrado (isAvailable, category, etc.)
   * @returns {Promise<Array<object>>}
   */
  async searchProducts(tenantId, options = {}) {
    throw new Error(`[${this.providerName}] searchProducts(tenantId, options) debe ser implementado.`);
  }

  /**
   * Obtiene la disponibilidad y existencias de un producto.
   * @param {string} tenantId - ID del tenant (obligatorio)
   * @param {string} productId - ID del producto
   * @param {string} [variantId] - ID de variante opcional
   * @returns {Promise<{ inStock: boolean, inventoryQuantity: number|null, isTracked: boolean }>}
   */
  async getStock(tenantId, productId, variantId = null) {
    throw new Error(`[${this.providerName}] getStock(tenantId, productId, variantId) debe ser implementado.`);
  }

  /**
   * Obtiene el precio canónico vigente de un producto.
   * @param {string} tenantId - ID del tenant (obligatorio)
   * @param {string} productId - ID del producto
   * @param {string} [variantId] - ID de variante opcional
   * @returns {Promise<{ price: number, promotionalPrice: number|null, effectivePrice: number, hasActivePromo: boolean }>}
   */
  async getPrice(tenantId, productId, variantId = null) {
    throw new Error(`[${this.providerName}] getPrice(tenantId, productId, variantId) debe ser implementado.`);
  }

  /**
   * Genera el índice de catálogo compacto en formato CSV para el prompt de la IA.
   * Formato canónico: ID,Nombre,Precio,Tipo,Categoria
   * @param {string} tenantId - ID del tenant (obligatorio)
   * @param {object} [options] - Opciones adicionales
   * @returns {Promise<string>}
   */
  async getCompactCatalogCsv(tenantId, options = {}) {
    throw new Error(`[${this.providerName}] getCompactCatalogCsv(tenantId, options) debe ser implementado.`);
  }
}

export default CommerceProvider;
