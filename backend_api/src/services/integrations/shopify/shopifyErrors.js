/**
 * SHOPIFY INTEGRATION ERROR TAXONOMY
 * ==================================
 * Errores fuertemente tipados para todas las operaciones con Shopify.
 * Todos los errores sanitizan mensajes para evitar fugas de credenciales.
 */

export class ShopifyError extends Error {
  constructor(message, code = 'SHOPIFY_ERROR', details = null) {
    // Redactar cualquier posible token o secreto del mensaje
    const sanitized = ShopifyError.sanitize(message);
    super(sanitized);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }

  static sanitize(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/shpat_[a-zA-Z0-9_-]+/g, '[REDACTED_ACCESS_TOKEN]')
      .replace(/shprt_[a-zA-Z0-9_-]+/g, '[REDACTED_REFRESH_TOKEN]')
      .replace(/shpca_[a-zA-Z0-9_-]+/g, '[REDACTED_CLIENT_APP]')
      .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/client_secret=[^&\s]+/gi, 'client_secret=[REDACTED]');
  }
}

export class ShopifyDomainError extends ShopifyError {
  constructor(message, details = null) {
    super(message, 'INVALID_SHOP_DOMAIN', details);
  }
}

export class ShopifyConfigError extends ShopifyError {
  constructor(message, details = null) {
    super(message, 'SHOPIFY_CONFIG_ERROR', details);
  }
}

export class ShopifyOAuthError extends ShopifyError {
  constructor(message, code = 'OAUTH_ERROR', details = null) {
    super(message, code, details);
  }
}

export class ShopifyAuthError extends ShopifyError {
  constructor(message = 'Autenticación con Shopify fallida o token revocado.', details = null) {
    super(message, 'AUTH_ERROR', details);
  }
}

export class ShopifyReauthRequiredError extends ShopifyError {
  constructor(message = 'El refresh token es inválido o expiró. Se requiere reautorización de la tienda.', details = null) {
    super(message, 'REAUTH_REQUIRED', details);
  }
}

export class ShopifyDomainConflictError extends ShopifyError {
  constructor(message = 'Esta tienda Shopify ya está conectada a otra cuenta de Velion.', details = null) {
    super(message, 'DOMAIN_CONFLICT', details);
  }
}

export class ShopifyIntegrationNotConnectedError extends ShopifyError {
  constructor(message = 'La integración con Shopify no está activa para este tenant.', details = null) {
    super(message, 'NOT_CONNECTED', details);
  }
}

export class ShopifyTimeoutError extends ShopifyError {
  constructor(message = 'La petición a Shopify excedió el tiempo límite.', details = null) {
    super(message, 'TIMEOUT', details);
  }
}

export class ShopifyNetworkError extends ShopifyError {
  constructor(message = 'Error de red al comunicarse con Shopify.', details = null) {
    super(message, 'NETWORK_ERROR', details);
  }
}

export class ShopifyThrottledError extends ShopifyError {
  constructor(message = 'Límite de tasa (throttling) de Shopify alcanzado.', details = null) {
    super(message, 'THROTTLED', details);
  }
}

export class ShopifyGraphqlError extends ShopifyError {
  constructor(errors, message = 'Error en respuesta GraphQL de Shopify.') {
    const sanitizedErrors = Array.isArray(errors)
      ? errors.map(e => ({ message: ShopifyError.sanitize(e.message), path: e.path }))
      : errors;
    super(message, 'GRAPHQL_ERROR', sanitizedErrors);
  }
}

export class ShopifyUserError extends ShopifyError {
  constructor(userErrors, message = 'Error de validación en mutación Shopify.') {
    super(message, 'USER_ERROR', userErrors);
  }
}

export class ShopifySyncConflictError extends ShopifyError {
  constructor(message = 'Una sincronización de catálogo ya está en ejecución para este tenant.', details = null) {
    super(message, 'SYNC_ALREADY_RUNNING', details);
  }
}

export class ShopifySyncError extends ShopifyError {
  constructor(message, code = 'SYNC_ERROR', details = null) {
    super(message, code, details);
  }
}

export class ShopifyDraftOrderError extends ShopifyError {
  constructor(message, code = 'DRAFT_ORDER_ERROR', details = null) {
    super(message, code, details);
  }
}

export class ShopifyDraftOrderConflictError extends ShopifyError {
  constructor(message = 'Una creación de Draft Order ya está en ejecución para esta orden.', details = null) {
    super(message, 'DRAFT_ORDER_CONCURRENT_DISPATCH', details);
  }
}

export class ShopifyUnknownResultError extends ShopifyError {
  constructor(message = 'El resultado de la creación de Draft Order es ambiguo tras fallo de red o timeout.', details = null) {
    super(message, 'UNKNOWN_RESULT', details);
  }
}

export class ShopifyCurrencyMismatchError extends ShopifyError {
  constructor(message = 'Discrepancia entre la moneda esperada de la orden y la moneda devuelta por Shopify.', details = null) {
    super(message, 'DRAFT_CURRENCY_MISMATCH', details);
  }
}

export class ShopifyReconciliationError extends ShopifyError {
  constructor(message, code = 'RECONCILIATION_ERROR', details = null) {
    super(message, code, details);
  }
}

