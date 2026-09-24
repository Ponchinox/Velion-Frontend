import prisma from '../db.js';
import { cancelFollowUpOnOrderEvent } from './followUpService.js';
import { CommerceService, commerceService } from './commerce/CommerceService.js';
import shopifyDraftOrderService from './integrations/shopify/shopifyDraftOrderService.js';

import { 
  getCanonicalProductPrice, 
  isPromotionActive, 
  resolveEffectivePrice 
} from './commerce/canonicalPricing.js';

export {
  getCanonicalProductPrice,
  isPromotionActive,
  resolveEffectivePrice
};

/**
 * Limpia los campos efímeros del borrador de compra en commercialState.
 * Conserva currentStage, intent y cualquier dato permanente o no perteneciente al draft.
 */
export function cleanCommercialDraft(state) {
  const cleaned = { ...state };
  delete cleaned.activeOrderId;
  delete cleaned.customerConfirmed;
  delete cleaned.productId;
  delete cleaned.productName;
  delete cleaned.quantity;
  delete cleaned.variant;
  delete cleaned.shippingCity;
  delete cleaned.shippingAddress;
  delete cleaned.paymentMethod;
  delete cleaned.budget;
  delete cleaned.customerNeeds;
  delete cleaned.missingFields;
  return cleaned;
}

/**
 * Detecta si el mensaje del usuario expresa un rechazo o desinterés explícito
 * sobre la oportunidad o producto comercial en curso.
 * Diferenciado de isFollowUpOptOutRequested (que es opt-out global de contacto).
 *
 * Casos positivos:
 * - "No, mejor ya no me interesa el JBL"
 * - "Ya no me interesa"
 * - "No quiero nada, gracias"
 * - "Ya no lo quiero" / "No lo quiero"
 * - "No voy a comprar" / "No voy a llevar"
 * - "Cancela el pedido" / "Cancela la orden"
 * - "Descarto esa opción" / "Mejor ya no"
 *
 * Casos negativos (NO deben coincidir):
 * - "¿No tienes otros audífonos?"
 * - "¿No hay en color negro?"
 * - "No sé si me quede bien"
 * - "No puedo pagar con tarjeta?"
 * - "¿No hacen envíos a provincia?"
 */
export function isExplicitOpportunityRejection(text) {
  if (!text || typeof text !== 'string') return false;
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  // 1. Presencia de intención alternativa, contrapropuesta comercial o cambio de producto/variante
  // Fail-open: Si el cliente propone una alternativa o sigue explorando, NO es abandono de oportunidad.
  const ALTERNATIVE_INTENT_PATTERN = /\b(pero\s+(?:si|quiero|prefiero|busco|deseo|tienes|muestrame)|prefiero\b|quiero\s+(?:solo\b|el\b|la\b|los\b|las\b|otr[oa]s?\b|un[oa]s?\b|mas\b)|(?:muestrame|ensename|pasame|mandame|recomiendame|tienes?|tendras?|hay)\s+(?:otr[oa]s?|mas|algun[oa]?|alternativa)|(?:que|cual|cuales)\s+otr[oa]s?|(?:puedo|se\s+puede|es\s+posible)\s+(?:pagar|recoger|hacer|enviar))\b/i;

  if (ALTERNATIVE_INTENT_PATTERN.test(normalized)) {
    return false;
  }

  // 2. Rechazo acotado a un atributo/variante, método de entrega, método de pago, cantidad o condición temporal
  const ATTRIBUTE_OR_MODALITY_REJECTION = /\b(no\s+(?:quiero|me\s+interesa|deseo))\s+(?:el\s+|la\s+|los\s+|las\s+|ese\s+|esa\s+|este\s+|esta\s+)?(?:delivery|envio|recojo|domicilio|pagar|tarjeta|transferencia|efectivo|yape|plin|color|tamano|modelo|talla|version|\d+)\b|\bno\s+(?:quiero|voy\s+a)\s+(?:comprar|llevar|pedir)?\s*(?:hoy|ahora|por\s+hoy)\b/i;

  if (ATTRIBUTE_OR_MODALITY_REJECTION.test(normalized)) {
    return false;
  }

  // 3. Abandono explícito de la oportunidad / producto
  const OPPORTUNITY_REJECTION_PATTERN = /\b(ya\s+no\s+(?:quiero|deseo|me\s+interesa|compro|voy\s+a\s+(?:llevar|comprar))|no\s+(?:me\s+interesa|quiero(?:\s+(?:nada|el|la|los|las|eso|ninguno|comprarl[oa]))?|deseo|lo\s+quiero|la\s+quiero|los\s+quiero|(?:lo\s+|la\s+|los\s+)?voy\s+a\s+(?:llevar|comprar|pedir))|descarto|descartado|(?:cancela|cancelar|cancelo)(?:\s+(?:el|la|mi|este|esta|todo)\s+(?:pedido|orden|compra))?|mejor\s+ya\s+no|paso,\s*gracias|paso\s+por\s+ahora)\b/i;

  return OPPORTUNITY_REJECTION_PATTERN.test(normalized);
}

/**
 * Detecta si el mensaje del usuario es una consulta de soporte postventa o estado de entrega/pedido.
 * Ejemplos:
 * - "Ya compré el JBL hace unos días. ¿Puedes decirme cuándo llega mi pedido?"
 * - "¿Dónde está mi paquete?"
 * - "¿Cuándo llega mi pedido?"
 * - "Estado de mi envío"
 * - "Ya pagué, ¿cuándo me lo envían?"
 */
export function isPostSaleOrderInquiry(text) {
  if (!text || typeof text !== 'string') return false;
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  const POST_SALE_PATTERN = /\b(?:ya\s+(?:compre|pague|cancele|hice\s+(?:el\s+|mi\s+)?(?:pago|pedido|compra)|deposite|transferi)|(?:ya\s+)?(?:pudieron|pudo|pudiste)\s+(?:revisar|ver|chequear|confirmar)|(?:donde\s+esta|cuando\s+(?:me\s+)?(?:llega|entregan|envian)|estado\s+de(?:l)?|seguimiento\s+de(?:l)?|tracking\s+de(?:l)?|que\s+fue\s+de(?:l)?)\s+(?:mi\s+)?(?:pedido|paquete|compra|envio|orden|despacho)|(?:numero|codigo)\s+de\s+(?:seguimiento|tracking|guia|envio)|informacion\s+de(?:l)?\s+(?:mi\s+)?(?:envio|pedido|despacho))\b/i;

  return POST_SALE_PATTERN.test(normalized);
}

/**
 * Determina de forma estricta y fail-closed si un tenant cuenta con configuración canónica de envíos.
 * La presencia de dirección física, políticas de garantía o devoluciones NO constituye configuración de envíos.
 * Requiere términos logísticos explícitos (envío, delivery, despacho, flete, courier).
 *
 * @param {object|string} tenantOrTerms - Objeto tenant o string de termsAndPolicies
 * @returns {boolean}
 */
export function hasCanonicalShippingConfig(tenantOrTerms) {
  const text = typeof tenantOrTerms === 'string'
    ? tenantOrTerms
    : (tenantOrTerms?.termsAndPolicies || '');

  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Debe contener términos logísticos explícitos
  const hasLogisticsTerms = /\b(?:env[ií]os?|delivery|despachos?|fletes?|couriers?|entrega\s+a\s+domicilio)\b/i.test(trimmed);
  if (!hasLogisticsTerms) return false;

  // Si explícitamente niega envíos ("no realizamos envíos", "no hacemos delivery", "sin delivery"):
  if (/\b(?:no\s+(?:hacemos|realizamos|contamos\s+con|tenemos)\s+(?:env[ií]os?|delivery)|sin\s+(?:env[ií]os?|delivery))\b/i.test(trimmed)) {
    return false;
  }

  return true;
}

/**
 * Detecta pseudo-métodos de pago que intentan evadir la configuración real del tenant.
 * Ej: "asesor", "por coordinar con asesor", "coordinar con asesor", etc.
 */
export function isPseudoPaymentMethod(method) {
  if (!method || typeof method !== 'string') return true;
  const clean = method.toLowerCase().trim();
  const pseudoKeywords = [
    'asesor', 'coordinar', 'por coordinar', 'humano', 'pendiente',
    'por definir', 'por acordar', 'acordar', 'a coordinar', 'consultar',
    'sin definir', 'ninguno', 'no especificado', 'no sabe', 'desconocido'
  ];
  return pseudoKeywords.some(kw => clean.includes(kw));
}

/**
 * Valida si un método de pago solicitado coincide con los métodos autorizados en la configuración del tenant.
 * Evita estrictamente falsos positivos (ej. "Banco BBVA" no debe pasar si el tenant solo tiene "Banco BCP").
 */
export function isPaymentMethodAuthorized(paymentMethod, bankAccountsConfig) {
  if (!paymentMethod || typeof paymentMethod !== 'string') return false;
  if (isPseudoPaymentMethod(paymentMethod)) return false;
  if (!bankAccountsConfig || !bankAccountsConfig.trim()) return false;

  const rawConfig = bankAccountsConfig.toLowerCase().trim();
  const rawMethod = paymentMethod.toLowerCase().trim();

  // Canales específicos mutuamente excluyentes o distintivos
  const specificChannels = {
    yape: ['yape'],
    plin: ['plin', 'tunki', 'agora'],
    bcp: ['bcp', 'banco de credito', 'crédito', 'credito'],
    bbva: ['bbva', 'continental', 'banco continental'],
    interbank: ['interbank'],
    scotiabank: ['scotiabank'],
    nacion: ['banco de la nacion', 'banco de la nación', 'bn'],
    contraentrega: ['contraentrega', 'contra entrega', 'contra-entrega', 'efectivo', 'pago en puerta', 'contra-reembolso'],
    tarjeta: ['tarjeta', 'pos', 'culqi', 'mercado pago', 'mercadopago', 'stripe', 'niubiz', 'izipay', 'visa', 'mastercard']
  };

  // 1. Si el método menciona un canal específico (ej. BBVA), la configuración DEBE soportar ese canal específico
  for (const [, words] of Object.entries(specificChannels)) {
    const methodHasChannel = words.some(w => rawMethod.includes(w));
    if (methodHasChannel) {
      const configHasChannel = words.some(w => rawConfig.includes(w));
      if (!configHasChannel) {
        return false; // Conflicto de canal: el método pide un canal que la tienda NO tiene
      }
    }
  }

  // 2. Si el método es genérico bancario ("transferencia", "depósito", "banco", "cuenta")
  const isGenericBankOrTransfer = ['transferencia', 'deposito', 'depósito', 'banco', 'cuenta', 'cci'].some(w => rawMethod.includes(w));
  if (isGenericBankOrTransfer) {
    const configSupportsBank = ['bcp', 'bbva', 'interbank', 'scotiabank', 'nacion', 'banco', 'cuenta', 'transferencia', 'deposito', 'depósito', 'cci'].some(w => rawConfig.includes(w));
    if (configSupportsBank) return true;
  }

  // 3. Coincidencia directa por canal autorizado
  for (const [, words] of Object.entries(specificChannels)) {
    const methodMatches = words.some(w => rawMethod.includes(w));
    const configMatches = words.some(w => rawConfig.includes(w));
    if (methodMatches && configMatches) return true;
  }

  // 4. Coincidencia directa exacta de substring (para métodos personalizados no tipificados)
  if (rawConfig.includes(rawMethod)) return true;

  return false;
}

// In-process concurrency lock map per customer
const customerOrderLocks = new Map();

async function withCustomerLock(lockKey, fn) {
  const existing = customerOrderLocks.get(lockKey);
  const wasConcurrent = Boolean(existing && existing.inFlight);

  let releaseLock;
  const currentLock = new Promise((resolve) => {
    releaseLock = resolve;
  });

  const lockEntry = {
    promise: currentLock,
    inFlight: true,
    lastCreatedOrder: existing?.lastCreatedOrder || null
  };
  customerOrderLocks.set(lockKey, lockEntry);

  try {
    if (existing) {
      await existing.promise;
    }
    return await fn({ wasConcurrent, lockEntry, previousEntry: existing });
  } finally {
    lockEntry.inFlight = false;
    releaseLock();
    if (customerOrderLocks.get(lockKey) === lockEntry) {
      setTimeout(() => {
        if (customerOrderLocks.get(lockKey) === lockEntry) {
          customerOrderLocks.delete(lockKey);
        }
      }, 5000).unref?.();
    }
  }
}

async function executeTransaction(db, callback) {
  if (typeof db.$transaction === 'function') {
    return await db.$transaction(async (tx) => {
      return await callback(tx || db);
    });
  }
  return await callback(db);
}

/**
 * Sincroniza el estado comercial y la orden (Order / OrderItem) de forma determinista y multi-tenant.
 *
 * @param {object} params
 * @param {object} params.tenant - Objeto del tenant autenticado ({ id, name, ... })
 * @param {object} params.customer - Objeto del cliente ({ id, phone, name, commercialState, ... })
 * @param {string} params.clientNumber - Teléfono limpio del cliente
 * @param {object} params.currentCommercialState - Estado comercial actual previo
 * @param {object} params.args - Argumentos proporcionados por el LLM en Function Calling
 * @param {function} [params.onNotification] - Callback opcional para enviar notificaciones externas
 * @returns {Promise<object>} { success: boolean, state: object, error?: string }
 */
export async function syncCommercialOrder(params) {
  const { tenant, customer } = params || {};
  if (!customer?.id) {
    return _syncCommercialOrderInternal(params, {});
  }
  const lockKey = `${tenant?.id || 'global'}:${customer.id}`;
  return withCustomerLock(lockKey, (lockMeta) => _syncCommercialOrderInternal(params, lockMeta));
}

async function _syncCommercialOrderInternal(params, lockMeta = {}) {
  const {
    tenant,
    customer,
    clientNumber,
    currentCommercialState = {},
    args = {},
    onNotification = null,
    prismaClient = prisma
  } = params || {};
  const db = prismaClient;
  if (!tenant?.id) {
    throw new Error('syncCommercialOrder requiere un tenant con id válido.');
  }
  if (!customer?.id) {
    throw new Error('syncCommercialOrder requiere un customer con id válido.');
  }

  let customerAlreadyPersisted = false;
  let notificationWarning = null;
  let createdOrder = null;
  let draftOrderResult = null;

  // 1. Obtener y validar métodos de pago y políticas de envío reales del tenant
  let tenantBankAccounts = tenant.bankAccounts;
  let tenantTerms = tenant.termsAndPolicies;
  if ((tenantBankAccounts === undefined || tenantTerms === undefined) && db.tenant?.findUnique) {
    try {
      const tRecord = await db.tenant.findUnique({
        where: { id: tenant.id },
        select: { bankAccounts: true, termsAndPolicies: true }
      });
      if (tenantBankAccounts === undefined) tenantBankAccounts = tRecord?.bankAccounts;
      if (tenantTerms === undefined) tenantTerms = tRecord?.termsAndPolicies;
    } catch (tErr) {
      console.warn(`⚠️ [Order Security] No se pudo consultar tenant en BD:`, tErr.message);
    }
  }

  const tenantHasConfiguredPayments = Boolean(tenantBankAccounts && tenantBankAccounts.trim());
  const tenantHasShippingConfig = hasCanonicalShippingConfig(tenantTerms);

  if (args.paymentMethod) {
    // A. Rechazar rotundamente pseudo-métodos ("asesor", "por coordinar con asesor", etc.)
    if (isPseudoPaymentMethod(args.paymentMethod)) {
      console.warn(`⚠️ [Order Security] Pseudo-método de pago rechazado: "${args.paymentMethod}"`);
      return {
        error: 'El asesor no es un método de pago. La tienda requiere un método de pago legítimo configurado para registrar transacciones.',
        state: currentCommercialState
      };
    }

    // B. Tenant sin métodos de pago configurados -> fail-closed absoluto
    if (!tenantHasConfiguredPayments) {
      console.warn(`⚠️ [Order Security] Tenant ${tenant.id?.slice(0, 8)} no tiene métodos de pago configurados. Rechazando "${args.paymentMethod}".`);
      return {
        error: 'La tienda no tiene métodos de pago registrados en este momento. No inventes medios de pago ni guardes métodos no autorizados.',
        state: currentCommercialState
      };
    }

    // C. Tenant con métodos de pago configurados -> validar contra su configuración
    const authorized = isPaymentMethodAuthorized(args.paymentMethod, tenantBankAccounts);
    if (!authorized) {
      console.warn(`⚠️ [Order Security] Método de pago "${args.paymentMethod}" no coincide con las cuentas del tenant ${tenant.id?.slice(0, 8)}.`);
      return {
        error: `Método de pago no autorizado. La tienda únicamente opera con los métodos configurados: ${tenantBankAccounts.trim()}. No aceptes otros medios de pago.`,
        state: currentCommercialState
      };
    }
  }

  let updatedState = { ...currentCommercialState, ...args };
  if (args.productId) {
    updatedState.lastConsultedProductId = args.productId;
    updatedState.lastConsultedProductAt = new Date().toISOString();
  }
  if (args.productName) {
    updatedState.lastConsultedProductName = args.productName;
  }

  // ── SHIPPING AUTHORITY GUARD ──
  // Si el cliente o el modelo indican currentStage='SHIPPING_COORDINATED' pero la tienda NO tiene configuración/políticas de envío:
  // Preservar la ciudad y dirección proporcionadas por el cliente como hechos válidos (customer input fact),
  // pero normalizar el stage a DETAILS_PROVIDED para no atribuir falsamente una capacidad logística no demostrada.
  if (updatedState.currentStage === 'SHIPPING_COORDINATED' && !tenantHasShippingConfig) {
    console.log(`ℹ️ [Order Commercial] Tenant sin shipping config: normalizando stage de SHIPPING_COORDINATED a DETAILS_PROVIDED (preservando shippingCity="${updatedState.shippingCity || ''}")`);
    updatedState.currentStage = 'DETAILS_PROVIDED';
  }

  // ── EARLY OUT-OF-STOCK GUARD PARA PRODUCT_SELECTED CONFIRMADO ──
  if (updatedState.productId && updatedState.customerConfirmed === true && updatedState.currentStage === 'PRODUCT_SELECTED') {
    const commerceSvc = (prismaClient && prismaClient !== prisma)
      ? new CommerceService(prismaClient)
      : commerceService;
    let prodCheck = null;
    try {
      prodCheck = await commerceSvc.getProduct(tenant.id, updatedState.productId);
    } catch {}
    if (prodCheck && prodCheck.isAvailable === false) {
      console.warn(`🛑 [Order Guard - Stock] Rechazando selección confirmada de producto agotado "${updatedState.productId}".`);
      return {
        error: 'PRODUCT_OUT_OF_STOCK',
        message: 'Este producto está agotado actualmente.',
        state: currentCommercialState
      };
    }
  }

  const triggerStages = ['PAYMENT_PENDING', 'PAYMENT_VERIFIED', 'COMPLETED'];

  if (triggerStages.includes(updatedState.currentStage)) {
    // ── COMMERCE ROUTER & RESOLUTION (FASE 5B) ──
    const commerceSvc = (prismaClient && prismaClient !== prisma)
      ? new CommerceService(prismaClient)
      : commerceService;

    let resolvedCommerceItem = null;
    let itemSource = 'VELION';
    let isShopifyOrder = false;
    let shopifyIntegration = null;
    let externalProductId = null;
    let externalVariantId = null;
    let sourceSku = null;

    // Mixed cart guard: Si hay múltiples items en el draft o argumentos, verificar consistencia de procedencia
    if (Array.isArray(updatedState.items) && updatedState.items.length > 1) {
      const sources = new Set();
      for (const itm of updatedState.items) {
        let itmSource = 'VELION';
        if (itm.productId) {
          try {
            const p = await commerceSvc.getProduct(tenant.id, itm.productId);
            itmSource = p?.source || (String(itm.productId).startsWith('shopify:') ? 'SHOPIFY' : 'VELION');
          } catch {}
        }
        sources.add(itmSource);
      }
      if (sources.has('VELION') && (sources.has('SHOPIFY') || sources.has('MERGED'))) {
        return {
          error: 'MIXED_PROVIDER_ORDER_NOT_SUPPORTED',
          message: 'No se permiten pedidos mixtos que combinen productos locales de Velion con productos de Shopify.',
          state: currentCommercialState
        };
      }
    }

    if (updatedState.productId) {
      try {
        resolvedCommerceItem = await commerceSvc.getProduct(tenant.id, updatedState.productId);
        if (resolvedCommerceItem) {
          itemSource = resolvedCommerceItem.source || (String(updatedState.productId).startsWith('shopify:') ? 'SHOPIFY' : 'VELION');
        } else if (String(updatedState.productId).startsWith('shopify:')) {
          itemSource = 'SHOPIFY';
        }
      } catch (checkErr) {
        if (checkErr.message === 'SHOPIFY_INTEGRATION_NOT_CONNECTED') {
          return {
            error: 'SHOPIFY_INTEGRATION_NOT_CONNECTED',
            message: 'La integración con Shopify no está conectada.',
            state: currentCommercialState
          };
        }
        console.warn(`⚠️ [Order Router] Advertencia al verificar item "${updatedState.productId}":`, checkErr.message);
      }
    }

    if (itemSource === 'SHOPIFY' || itemSource === 'MERGED') {
      isShopifyOrder = true;
      shopifyIntegration = await db.integration.findFirst({
        where: { tenantId: tenant.id, provider: 'SHOPIFY' },
        select: {
          id: true,
          status: true,
          shopDomain: true,
          externalOrderMode: true,
          priceSource: true,
          shopCurrencyCode: true
        }
      });

      if (!shopifyIntegration || shopifyIntegration.status !== 'CONNECTED' || !shopifyIntegration.shopDomain) {
        return {
          error: 'SHOPIFY_INTEGRATION_NOT_CONNECTED',
          message: 'La integración de Shopify no está activa para este tenant.',
          state: currentCommercialState
        };
      }

      if (shopifyIntegration.externalOrderMode === 'NONE' || !shopifyIntegration.externalOrderMode) {
        return {
          error: 'EXTERNAL_ORDER_DISABLED',
          message: 'La creación de pedidos externos está deshabilitada.',
          state: currentCommercialState
        };
      }

      if (shopifyIntegration.externalOrderMode === 'SHOPIFY_COMPLETE') {
        return {
          error: 'SHOPIFY_COMPLETE_NOT_IMPLEMENTED',
          message: 'El modo SHOPIFY_COMPLETE no está soportado en esta fase.',
          state: currentCommercialState
        };
      }

      if (shopifyIntegration.priceSource === 'VELION') {
        return {
          error: 'SHOPIFY_PRICE_OVERRIDE_CURRENCY_UNRESOLVED',
          message: 'priceSource VELION no está permitido para pedidos Shopify en Fase 5B.',
          state: currentCommercialState
        };
      }

      if (!shopifyIntegration.shopCurrencyCode) {
        return {
          error: 'SHOPIFY_CURRENCY_UNRESOLVED',
          message: 'Moneda de tienda Shopify no resuelta.',
          state: currentCommercialState
        };
      }

      if (resolvedCommerceItem) {
        externalProductId = resolvedCommerceItem.externalProductId || null;
        externalVariantId = resolvedCommerceItem.externalVariantId || null;
        sourceSku = resolvedCommerceItem.sku || null;

        if (!externalVariantId && resolvedCommerceItem.shopifyVariantLocalId) {
          const vRecord = await db.externalProductVariant.findUnique({
            where: { id: resolvedCommerceItem.shopifyVariantLocalId }
          });
          if (vRecord) {
            externalVariantId = vRecord.externalVariantId;
            externalProductId = externalProductId || vRecord.externalProductId;
            sourceSku = sourceSku || vRecord.sku;
          }
        }
        if (!externalVariantId && resolvedCommerceItem.normalizedSku) {
          const vRecord = await db.externalProductVariant.findFirst({
            where: { tenantId: tenant.id, provider: 'SHOPIFY', normalizedSku: resolvedCommerceItem.normalizedSku }
          });
          if (vRecord) {
            externalVariantId = vRecord.externalVariantId;
            externalProductId = externalProductId || vRecord.externalProductId;
            sourceSku = sourceSku || vRecord.sku;
          }
        }
      }
    }

    const orderId = updatedState.activeOrderId;

    // Parsear cantidad
    const rawQty = updatedState.quantity;
    const parsedQty = parseInt(rawQty, 10);
    const isQtyValid = Number.isInteger(parsedQty) && parsedQty >= 1;

    // Estados seguros para órdenes creadas o actualizadas por IA: NUNCA pueden ser 'PAID'
    let orderStatus = 'PENDING';
    let payStatus = 'UNPAID';
    if (updatedState.currentStage === 'PAYMENT_VERIFIED' || updatedState.currentStage === 'COMPLETED') {
      payStatus = 'VERIFYING';
    }

    if (!orderId) {
      // ─────────────────────────────────────────────────────────────────────────
      // CREACIÓN DE NUEVA ORDEN
      // ─────────────────────────────────────────────────────────────────────────
      // COMPLETED NUNCA es trigger de creación de nueva orden
      const creationStages = ['PAYMENT_PENDING', 'PAYMENT_VERIFIED'];
      if (!creationStages.includes(updatedState.currentStage)) {
        if (updatedState.currentStage === 'COMPLETED') {
          console.log(`ℹ️ [FC update_commercial_state] Etapa COMPLETED sin activeOrderId. Limpiando draft comercial sin crear nueva orden.`);
          updatedState = cleanCommercialDraft(updatedState);
          updatedState.currentStage = 'COMPLETED';
        }
      } else {
        let verifiedProduct = null;
        let productPrice = 0;

        if (isShopifyOrder && resolvedCommerceItem) {
          verifiedProduct = resolvedCommerceItem;
          productPrice = resolvedCommerceItem.price;
        } else if (updatedState.productId) {
          verifiedProduct = await db.product.findFirst({
            where: {
              id: updatedState.productId,
              user: { tenantId: tenant.id }
            },
            select: {
              id: true,
              name: true,
              price: true,
              promotionalPrice: true,
              promoStartDate: true,
              promoEndDate: true,
              type: true,
              isAvailable: true
            }
          });
          if (verifiedProduct) {
            productPrice = getCanonicalProductPrice(verifiedProduct);
          }
        }

        const isNativeAvailable = verifiedProduct ? (verifiedProduct.isAvailable !== false) : false;
        const isItemAvailable = isShopifyOrder
          ? Boolean(resolvedCommerceItem?.isAvailable)
          : isNativeAvailable;

        if (verifiedProduct && !isItemAvailable) {
          console.warn(`🛑 [Order Guard - Stock] Rechazando compra de producto agotado "${updatedState.productId}" (${updatedState.productName || verifiedProduct?.name || ''}).`);
          return {
            error: 'PRODUCT_OUT_OF_STOCK',
            message: 'Este producto está agotado actualmente.',
            state: currentCommercialState
          };
        }

        const isConfirmed = Boolean(updatedState.customerConfirmed === true);
        const hasValidProduct = Boolean(verifiedProduct);
        const productType = verifiedProduct?.type || 'PHYSICAL_PRODUCT';
        const isService = productType === 'SERVICE' && !isShopifyOrder;

        // Determinar validez de método de pago para crear orden (Estricto Fail-Closed)
        let isPaymentValidForOrder = false;
        if (updatedState.paymentMethod && !isPseudoPaymentMethod(updatedState.paymentMethod)) {
          if (tenantHasConfiguredPayments) {
            isPaymentValidForOrder = isPaymentMethodAuthorized(updatedState.paymentMethod, tenantBankAccounts);
          } else {
            isPaymentValidForOrder = false; // Sin bankAccounts válidas -> JAMÁS se permite crear Order
          }
        }

        let canCreateOrder = false;
        let finalQuantity = parsedQty;

        if (isService) {
          // BIFURCACIÓN SERVICE:
          // 1. Normalizar cantidad a 1 internamente si no fue especificada o es menor a 1
          finalQuantity = (isQtyValid && parsedQty >= 1) ? parsedQty : 1;
          // 2. NO exige shipping destination ni logística de envíos
          // 3. Exige: customerConfirmed + producto válido del tenant + método de pago real configurado + producto disponible
          canCreateOrder = isConfirmed && hasValidProduct && isItemAvailable && isPaymentValidForOrder;
        } else {
          // BIFURCACIÓN PHYSICAL_PRODUCT:
          // Requiere confirmación explícita + cantidad válida + destino (ciudad/dirección) + método de pago + producto disponible
          const hasShippingDestination = Boolean(updatedState.shippingCity || updatedState.shippingAddress);
          const hasLogistics = hasShippingDestination && isPaymentValidForOrder;
          canCreateOrder = isConfirmed && isQtyValid && hasValidProduct && isItemAvailable && hasLogistics;
        }

        if (canCreateOrder) {
          const quantity = finalQuantity;
          const total = quantity * productPrice;

          try {
            await executeTransaction(db, async (tx) => {
              let existingActiveOrderId = updatedState.activeOrderId;

              // 1. Concurrency Guard en memoria (para llamadas concurrentes esperando el lock)
              const { wasConcurrent, lockEntry, previousEntry } = lockMeta;
              if (!existingActiveOrderId && wasConcurrent && previousEntry?.lastCreatedOrder?.orderId) {
                const prev = previousEntry.lastCreatedOrder;
                if (prev.productId === verifiedProduct?.id && (Date.now() - prev.timestamp) < 5000) {
                  existingActiveOrderId = prev.orderId;
                }
              }

              // 2. PostgreSQL Row-level Lock si está disponible (multi-proceso / cluster)
              if (!existingActiveOrderId && typeof tx.$queryRaw === 'function') {
                try {
                  const lockedRows = await tx.$queryRaw`SELECT "id", "commercialState" FROM "Customer" WHERE "id" = ${customer.id} FOR UPDATE`;
                  if (lockedRows && lockedRows.length > 0) {
                    const rawState = lockedRows[0].commercialState;
                    const parsedState = (typeof rawState === 'object' && rawState !== null)
                      ? rawState
                      : (typeof rawState === 'string' ? JSON.parse(rawState) : null);
                    if (parsedState?.activeOrderId && parsedState?.lastOrderCreatedAt && (Date.now() - parsedState.lastOrderCreatedAt) < 5000) {
                      existingActiveOrderId = parsedState.activeOrderId;
                    }
                  }
                } catch (rawErr) {
                  // Fallback silencioso para DBs/mocks sin queryRaw FOR UPDATE
                }
              }

              if (existingActiveOrderId) {
                console.log(`🛡️ [Order Concurrency] Orden activa concurrente detectada (${existingActiveOrderId}) para customer ${customer.id}. Evitando duplicación.`);
                updatedState.activeOrderId = existingActiveOrderId;
                await tx.customer.update({
                  where: { id: customer.id },
                  data: { commercialState: updatedState }
                });
                createdOrder = { id: existingActiveOrderId, isExisting: true };
                customerAlreadyPersisted = true;
                return;
              }

              // 3. Creación atómica de Orden con OrderItems
              const newOrder = await tx.order.create({
                data: {
                  tenantId: tenant.id,
                  customerId: customer.id,
                  status: orderStatus,
                  paymentStatus: payStatus,
                  paymentMethod: updatedState.paymentMethod || null,
                  shippingCity: isService ? null : (updatedState.shippingCity || null),
                  shippingAddress: isService ? null : (updatedState.shippingAddress || null),
                  customerNeeds: updatedState.customerNeeds || null,
                  totalAmount: total,
                  currencyCode: isShopifyOrder ? shopifyIntegration.shopCurrencyCode : (tenant.currencyCode || 'PEN'),
                  externalProvider: isShopifyOrder ? 'SHOPIFY' : null,
                  externalSyncStatus: isShopifyOrder ? 'NOT_STARTED' : null,
                  externalSyncAttempts: 0,
                  items: {
                    create: [{
                      productId: (verifiedProduct.source === 'VELION' || !verifiedProduct.source)
                        ? verifiedProduct.id
                        : (verifiedProduct.nativeProductId || null),
                      name: verifiedProduct.name,
                      quantity: quantity,
                      price: productPrice,
                      variant: updatedState.variant || null,
                      sourceProvider: isShopifyOrder ? (verifiedProduct.source || 'SHOPIFY') : 'VELION',
                      externalProductId: isShopifyOrder ? externalProductId : null,
                      externalVariantId: isShopifyOrder ? externalVariantId : null,
                      sourceSku: isShopifyOrder ? sourceSku : null
                    }]
                  }
                }
              });

              const nowTime = Date.now();
              updatedState.activeOrderId = newOrder.id;
              updatedState.lastOrderCreatedAt = nowTime;
              if (lockEntry) {
                lockEntry.lastCreatedOrder = {
                  orderId: newOrder.id,
                  productId: verifiedProduct.id,
                  timestamp: nowTime
                };
              }

              // 4. Creación atómica de Alerta transaccional
              let alertMessage = '';
              if (isService) {
                const qtyNote = quantity > 1 ? ` (${quantity} personas)` : '';
                alertMessage = `💼 SERVICIO REGISTRADO | Cliente: +${clientNumber} (${customer.name || 'Sin Nombre'}) | ${verifiedProduct.name}${qtyNote}`;
              } else if (isShopifyOrder) {
                alertMessage = `📦 PEDIDO SHOPIFY CREADO | Cliente: +${clientNumber} (${customer.name || 'Sin Nombre'}) | ${verifiedProduct.name} x${quantity} | ${shopifyIntegration.shopCurrencyCode} ${total}`;
              } else {
                alertMessage = `📦 PEDIDO CREADO | Cliente: +${clientNumber} (${customer.name || 'Sin Nombre'}) | ${verifiedProduct.name} x${quantity}`;
              }

              await tx.alert.create({
                data: {
                  type: 'NEW_ORDER',
                  severity: 'INFO',
                  message: alertMessage,
                  tenantId: tenant.id
                }
              });

              // 5. Persistencia atómica de activeOrderId en customer.commercialState
              await tx.customer.update({
                where: { id: customer.id },
                data: { commercialState: updatedState }
              });

              createdOrder = newOrder;
              customerAlreadyPersisted = true;
            });
          } catch (txError) {
            console.error('❌ [Order Commercial] Fallo atómico en creación de orden (rollback garantizado):', txError.message);
            delete updatedState.activeOrderId;
            return {
              error: 'ORDER_CREATION_FAILED',
              message: 'Error al procesar la creación de la orden en la base de datos.',
              state: currentCommercialState
            };
          }

          // 6. Despacho a Shopify Draft Order (Post-commit fuera de la transacción)
          if (isShopifyOrder && createdOrder) {
            try {
              draftOrderResult = await shopifyDraftOrderService.createDraftOrderForOrder(createdOrder.id, tenant.id, {
                prismaClient: db,
                graphqlExecutor: params?.graphqlExecutor,
                lockClient: params?.lockClient
              });
              if (draftOrderResult?.invoiceUrl) {
                updatedState.externalCheckoutUrl = draftOrderResult.invoiceUrl;
              }
            } catch (draftErr) {
              console.warn(`⚠️ [Order Commercial] createDraftOrderForOrder falló para orden ${createdOrder.id}:`, draftErr.message);
              if (['SHOPIFY_INTEGRATION_NOT_CONNECTED', 'EXTERNAL_ORDER_DISABLED', 'SHOPIFY_COMPLETE_NOT_IMPLEMENTED', 'SHOPIFY_PRICE_OVERRIDE_CURRENCY_UNRESOLVED', 'SHOPIFY_CURRENCY_UNRESOLVED'].includes(draftErr.code)) {
                return {
                  error: draftErr.code,
                  message: draftErr.message,
                  state: currentCommercialState
                };
              }
            }
          }

          // 7. Notificaciones externas POST-COMMIT (desacopladas de la transacción)
          if (createdOrder && !createdOrder.isExisting && typeof onNotification === 'function') {
            try {
              await onNotification({
                type: 'NEW_ORDER',
                orderId: createdOrder.id,
                total,
                quantity,
                productName: verifiedProduct.name,
                shippingCity: isService ? null : updatedState.shippingCity,
                shippingAddress: isService ? null : updatedState.shippingAddress,
                productType
              });
            } catch (notifErr) {
              console.warn('⚠️ [Order Commercial] Notificación externa post-commit falló (orden preservada):', notifErr.message);
              notificationWarning = 'ORDER_CREATED_NOTIFICATION_FAILED';
            }
          }
        } else {
          console.log(`ℹ️ [FC update_commercial_state] Draft comercial en memoria (Tipo: ${productType}, confirmed=${isConfirmed}, qty=${isService ? 1 : isQtyValid}, prod=${hasValidProduct}, pay=${isPaymentValidForOrder}).`);
        }
      }
    } else {
      // ─────────────────────────────────────────────────────────────────────────
      // ACTUALIZACIÓN DE ORDEN EXISTENTE
      // ─────────────────────────────────────────────────────────────────────────
      // 1. VALIDACIÓN DETERMINISTA DE TENANT OWNERSHIP
      const existingOrder = await db.order.findFirst({
        where: {
          id: orderId,
          tenantId: tenant.id
        },
        include: {
          items: true
        }
      });

      if (!existingOrder) {
        console.warn(`⚠️ [Order Security] Intento de actualizar orden inexistente o ajena al tenant ${tenant.id.slice(0, 8)}: ID ${orderId}`);
        // Fallar cerrado sin modificar absolutamente nada en BD
        return {
          error: 'Orden no encontrada o no pertenece a este tenant.',
          state: currentCommercialState
        };
      }

      const existingItem = existingOrder.items?.[0] || null;

      // 2. DETERMINACIÓN DE PRODUCTO Y PRECIO DETERMINÍSTICO (PROHIBICIÓN TOTAL DE budget)
      let finalProductId = null;
      let finalProductName = 'Producto sin nombre';
      let finalUnitPrice = 0;
      let verifiedNewProduct = null;

      const hasExplicitProductChange = Boolean(
        args.productId &&
        typeof args.productId === 'string' &&
        args.productId.trim() !== '' &&
        args.productId !== existingItem?.productId
      );

      if (hasExplicitProductChange) {
        // CASO B / C: El LLM solicita explícitamente cambiar a un productId distinto
        verifiedNewProduct = await db.product.findFirst({
          where: {
            id: args.productId.trim(),
            user: { tenantId: tenant.id }
          },
          select: { id: true, name: true, price: true, promotionalPrice: true, promoStartDate: true, promoEndDate: true, type: true, isAvailable: true }
        });

        if (!verifiedNewProduct) {
          // FIX 2: Si el productId es inválido o ajeno al tenant, ABORTAR toda la mutación de la tool call
          console.warn(`⚠️ [Order Security] Producto rechazado en orden ${orderId}: ID "${args.productId}" no existe o no pertenece al tenant ${tenant.id.slice(0, 8)}`);
          return {
            error: 'El producto solicitado no está disponible o no existe.',
            state: currentCommercialState
          };
        }

        if (verifiedNewProduct.isAvailable === false) {
          console.warn(`🛑 [Order Guard - Stock] Rechazando cambio a producto agotado "${args.productId}" en orden ${orderId}.`);
          return {
            error: 'PRODUCT_OUT_OF_STOCK',
            message: 'Este producto está agotado actualmente.',
            state: currentCommercialState
          };
        }

        // Producto nuevo válido del mismo tenant -> tomar precio canónico
        finalProductId = verifiedNewProduct.id;
        finalProductName = verifiedNewProduct.name;
        finalUnitPrice = getCanonicalProductPrice(verifiedNewProduct);
        updatedState.productId = verifiedNewProduct.id;
        updatedState.productName = verifiedNewProduct.name;
      } else {
        // CASO A: No se solicita cambio de producto
        if (!existingItem) {
          // FIX 1 CASO A: Orden existente sin items y sin nuevo producto válido -> fail-closed
          console.warn(`⚠️ [Order Security] Orden ${orderId} no contiene items válidos y no se especificó un producto válido para reconstruirla.`);
          return {
            error: 'La orden está incompleta y no puede actualizarse de forma segura.',
            state: currentCommercialState
          };
        }

        // CONSERVAR producto y precio unitario ya pactado en la orden
        finalProductId = existingItem.productId;
        finalProductName = existingItem.name;
        finalUnitPrice = existingItem.price;
      }

      // Determinar si el producto de la orden es un servicio
      let isExistingService = false;
      if (hasExplicitProductChange && verifiedNewProduct) {
        isExistingService = verifiedNewProduct.type === 'SERVICE';
      } else if (existingItem?.productId) {
        const prodRecord = await db.product.findFirst({
          where: { id: existingItem.productId },
          select: { type: true }
        });
        isExistingService = prodRecord?.type === 'SERVICE';
      }

      // Cantidad a recalcular
      const quantity = isQtyValid ? parsedQty : (existingItem?.quantity || 1);
      const total = quantity * finalUnitPrice;

      // Preservar estados fijados por acción humana previa
      let updateOrderStatus = existingOrder.status || 'PENDING';
      let updatePayStatus = existingOrder.paymentStatus || 'UNPAID';

      // Si el pago no está PAID por humano, permitir pasar a VERIFYING si el cliente afirma haber pagado
      if (updatePayStatus !== 'PAID') {
        if (updatedState.currentStage === 'PAYMENT_VERIFIED' || updatedState.currentStage === 'COMPLETED') {
          updatePayStatus = 'VERIFYING';
        }
      }
      // La IA nunca puede cambiar status a COMPLETED directamente
      if (updateOrderStatus !== 'COMPLETED' && updateOrderStatus !== 'CANCELED') {
        updateOrderStatus = 'PENDING';
      }

      // Mutación atómica en transacción
      await db.$transaction([
        db.order.update({
          where: { id: existingOrder.id },
          data: {
            status: updateOrderStatus,
            paymentStatus: updatePayStatus,
            paymentMethod: updatedState.paymentMethod || existingOrder.paymentMethod || null,
            shippingCity: isExistingService ? null : (updatedState.shippingCity || existingOrder.shippingCity || null),
            shippingAddress: isExistingService ? null : (updatedState.shippingAddress || existingOrder.shippingAddress || null),
            customerNeeds: updatedState.customerNeeds || existingOrder.customerNeeds || null,
            totalAmount: total
          }
        }),
        db.orderItem.deleteMany({
          where: { orderId: existingOrder.id }
        }),
        db.orderItem.create({
          data: {
            orderId: existingOrder.id,
            productId: finalProductId,
            name: finalProductName,
            quantity: quantity,
            price: finalUnitPrice,
            variant: updatedState.variant || existingItem?.variant || null
          }
        })
      ]);

      if (updatedState.currentStage === 'PAYMENT_VERIFIED') {
        await db.alert.create({
          data: {
            type: 'PAYMENT_VERIFY',
            severity: 'HIGH',
            message: `💳 VERIFICACIÓN DE PAGO REQUERIDA | Cliente: +${clientNumber} (${customer.name || 'Sin Nombre'})`,
            tenantId: tenant.id
          }
        });

        if (typeof onNotification === 'function') {
          try {
            await onNotification({
              type: 'PAYMENT_VERIFY',
              orderId: existingOrder.id,
              total,
              quantity,
              productName: finalProductName
            });
          } catch (notifErr) {
            console.warn('⚠️ [Order Commercial] Notificación PAYMENT_VERIFY falló:', notifErr.message);
          }
        }

        try {
          await cancelFollowUpOnOrderEvent({ tenantId: tenant.id, customerId: customer.id, order: { id: existingOrder.id, paymentStatus: 'VERIFYING' }, prismaClient: db });
        } catch (fuErr) {
          console.warn('⚠️ [Order Security] Error cancelando seguimiento en PAYMENT_VERIFIED:', fuErr.message);
        }
      }

      if (updatedState.currentStage === 'COMPLETED') {
        updatedState = cleanCommercialDraft(updatedState);
        updatedState.currentStage = 'COMPLETED';
      }
    }
  } else if (updatedState.currentStage === 'EXPLORING') {
    if (updatedState.activeOrderId) {
      // Cancelación segura con scoping multi-tenant y matriz determinística de autoridad
      const orderToCancel = await db.order.findFirst({
        where: {
          id: updatedState.activeOrderId,
          tenantId: tenant.id
        },
        select: { id: true, status: true, paymentStatus: true }
      });

      if (orderToCancel) {
        // MATRIZ DE AUTORIDAD DE CANCELACIÓN:
        // CASO A: ÚNICAMENTE si la orden está PENDING y UNPAID se autoriza la cancelación por IA
        if (orderToCancel.status === 'PENDING' && orderToCancel.paymentStatus === 'UNPAID') {
          console.log(`⚠️ [FC] Orden cancelada por el usuario o la IA. Actualizando estado de la orden ${orderToCancel.id} a CANCELED.`);
          await db.order.update({
            where: { id: orderToCancel.id },
            data: { status: 'CANCELED' }
          });

          await db.alert.create({
            data: {
              type: 'ORDER_CANCELED',
              severity: 'WARNING',
              message: `🚫 PEDIDO CANCELADO | Cliente: +${clientNumber} (${customer.name || 'Sin Nombre'})`,
              tenantId: tenant.id
            }
          });

          try {
            await cancelFollowUpOnOrderEvent({ tenantId: tenant.id, customerId: customer.id, order: { id: orderToCancel.id, status: 'CANCELED', paymentStatus: orderToCancel.paymentStatus }, prismaClient: db });
          } catch (fuErr) {
            console.warn('⚠️ [Order Security] Error cancelando seguimiento en CANCELED:', fuErr.message);
          }
        } else {
          // CASO B (VERIFYING): NO cancelar, NO modificar Order, NO alerta
          // CASO C (PAID): PROHIBIDO cancelar automáticamente, NO modificar Order, NO alerta
          // CASO D (COMPLETED): PROHIBIDO cancelar automáticamente, NO modificar Order, NO alerta
          // CASO E (CANCELED): NO-OP, no volver a actualizar, no segunda alerta
          console.log(`🛡️ [Order Security] Orden ${orderToCancel.id} en estado status="${orderToCancel.status}", paymentStatus="${orderToCancel.paymentStatus}". Cancelación automática deshabilitada. Desvinculando del draft.`);
        }
      } else {
        console.warn(`⚠️ [Order Security] Intento de cancelar orden inexistente o ajena al tenant ${tenant.id.slice(0, 8)}: ${updatedState.activeOrderId}`);
      }
    }

    // PARTE 6: Al volver a EXPLORING, limpiar siempre los campos del draft para evitar contaminar una nueva compra
    updatedState = cleanCommercialDraft(updatedState);
    updatedState.currentStage = 'EXPLORING';

    const cancelReason = args.cancelReason || args.reason || (updatedState.activeOrderId ? 'ORDER_CANCELED' : 'OPPORTUNITY_REJECTED');
    try {
      await cancelFollowUpOnOrderEvent({ tenantId: tenant.id, customerId: customer.id, reason: cancelReason, prismaClient: db });
    } catch (fuErr) {
      console.warn('⚠️ [Order Security] Error cancelando seguimiento en EXPLORING:', fuErr.message);
    }
  }

  // Persistir estado en el Customer solo si no fue persistido ya dentro de la transacción
  if (!customerAlreadyPersisted) {
    await db.customer.update({
      where: { id: customer.id },
      data: { commercialState: updatedState }
    });
  }

  const result = { success: true, state: updatedState };
  if (createdOrder) {
    result.order = createdOrder;
  }
  if (draftOrderResult) {
    result.draftOrder = draftOrderResult.draftOrder;
    result.invoiceUrl = draftOrderResult.invoiceUrl || null;
  }
  if (notificationWarning) {
    result.warning = notificationWarning;
  }
  return result;
}

/**
 * Maneja el rechazo o desinterés explícito del cliente hacia la oportunidad comercial actual.
 * Transiciona el estado a EXPLORING, limpia los campos del borrador (preservando sentMediaProductIds
 * y metadatos no efímeros) y cancela de forma determinística cualquier seguimiento activo.
 *
 * @param {object} params
 * @param {object} params.tenant
 * @param {object} params.customer
 * @param {string} params.clientNumber
 * @param {object} [params.prismaClient]
 * @returns {Promise<{ success: boolean, state: object }>}
 */
export async function handleOpportunityRejection({
  tenant,
  customer,
  clientNumber,
  prismaClient = prisma
}) {
  const db = prismaClient;
  if (!tenant?.id || !customer?.id) return { success: false, state: null };

  const currentCommercialState = (typeof customer.commercialState === 'object' && customer.commercialState !== null)
    ? customer.commercialState
    : {};

  const activeStages = ['PRODUCT_SELECTED', 'DETAILS_PROVIDED', 'SHIPPING_COORDINATED', 'PAYMENT_PENDING'];
  const hasActiveOpportunity = activeStages.includes(currentCommercialState.currentStage);

  if (!hasActiveOpportunity) {
    return { success: false, state: currentCommercialState };
  }

  // 1. Sincronizar transición a EXPLORING usando syncCommercialOrder existente
  const result = await syncCommercialOrder({
    tenant,
    customer,
    clientNumber,
    currentCommercialState,
    args: { currentStage: 'EXPLORING', reason: 'OPPORTUNITY_REJECTED' },
    prismaClient: db
  });

  // 2. Asegurar cancelación de secuencias con motivo explícito OPPORTUNITY_REJECTED
  try {
    await cancelFollowUpOnOrderEvent({
      tenantId: tenant.id,
      customerId: customer.id,
      reason: 'OPPORTUNITY_REJECTED',
      prismaClient: db
    });
  } catch (fuErr) {
    console.warn('⚠️ [Rejection Handler] Error cancelando seguimiento:', fuErr.message);
  }

  return { success: true, state: result.state };
}
