import { isExplicitProductVideoIntent, isExplicitProductPhotoIntent } from '../controllers/whatsappController.js';

const STOP_WORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'en', 'para', 'por', 'con', 'sin', 'que', 'y', 'o', 'u', 'a',
  'del', 'al', 'es', 'son', 'cuanto', 'cuesta', 'cuestan', 'vale', 'valen',
  'precio', 'precios', 'tienes', 'tienen', 'hay', 'vendes', 'venden',
  'stock', 'disponible', 'disponibles', 'me', 'interesa', 'quiero', 'quisiera',
  'buenas', 'tardes', 'dias', 'noches', 'hola', 'favor', 'pf', 'porfavor'
]);

// Patrón estructural de contexto de soporte, reclamo, falla o postventa
const SUPPORT_OR_COMPLAINT_PATTERN = /\b(problema|problemas|danado|danada|roto|rota|fallo|fallas?|averiad[oa]s?|defectuos[oa]s?|no\s+funciona|no\s+prende|no\s+enciende|no\s+llego|no\s+ha\s+llegado|reclamo|reclamos|queja|quejas|devolucion|devolver|servicio\s+tecnico)\b/i;

// Patrón estructural de rechazo, desinterés o cancelación
const NEGATIVE_INTENT_PATTERN = /\b(ya\s+no\s+quiero|no\s+quiero|no\s+me\s+interesa|no\s+deseo|no\s+voy\s+a\s+llevar|descarto|cancelar|cancelo|no\s+lo\s+quiero|no\s+la\s+quiero)\b/i;

/**
 * Normaliza un texto para comparación (minúsculas, sin acentos, sin puntuación especial)
 */
export function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detecta si el mensaje expresa una intención de soporte, queja, reclamo o problema postventa
 */
export function isSupportOrComplaintIntent(text) {
  if (!text || typeof text !== 'string') return false;
  const normalized = normalizeText(text);
  return SUPPORT_OR_COMPLAINT_PATTERN.test(normalized);
}

/**
 * Detecta si el mensaje expresa un rechazo o cancelación general
 */
export function isNegativeProductIntent(text) {
  if (!text || typeof text !== 'string') return false;
  const normalized = normalizeText(text);
  return NEGATIVE_INTENT_PATTERN.test(normalized);
}

/**
 * Extrae tokens significativos descartando palabras vacías y tokens de 1 letra
 */
export function extractSignificantTokens(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return normalized
    .split(' ')
    .filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

/**
 * Resuelve de forma inequívoca el producto objetivo a partir del mensaje del usuario y catálogo.
 *
 * @param {string} userMessageText
 * @param {Array<object>} availableProducts - Lista de productos disponibles del tenant
 * @param {string|null} currentProductId - ID del producto en contexto comercial previo si existe
 * @param {object} [options={}]
 * @param {boolean} [options.isExplicitMedia=false] - Indica si el usuario pidió explícitamente foto/video
 * @returns {object|null} Producto unívoco o null si no hay coincidencia o hay ambigüedad
 */
export function resolveTargetProduct(
  userMessageText,
  availableProducts = [],
  currentProductId = null,
  { isExplicitMedia = false, lastConsultedProductId = null } = {}
) {
  if (!Array.isArray(availableProducts) || availableProducts.length === 0) {
    return null;
  }

  const normalizedUserText = normalizeText(userMessageText);
  const userTokens = new Set(extractSignificantTokens(userMessageText));

  // 1. Búsqueda directa por coincidencia en el mensaje del usuario
  const matchedProducts = [];

  for (const product of availableProducts) {
    if (!product || !product.name) continue;
    const normalizedProdName = normalizeText(product.name);
    const prodTokens = extractSignificantTokens(product.name);

    // Coincidencia exacta de substring
    if (normalizedUserText.includes(normalizedProdName)) {
      matchedProducts.push(product);
      continue;
    }

    // Coincidencia por todos los tokens significativos del producto presentes en el mensaje
    if (prodTokens.length > 0 && prodTokens.every(t => userTokens.has(t))) {
      matchedProducts.push(product);
      continue;
    }

    // Si el nombre del producto contiene al menos 2 tokens significativos y el usuario tiene al menos el 80% de ellos
    if (prodTokens.length >= 2) {
      const matchCount = prodTokens.filter(t => userTokens.has(t)).length;
      if (matchCount / prodTokens.length >= 0.8) {
        matchedProducts.push(product);
        continue;
      }
    }
  }

  // ── CASO A: Múltiples productos coinciden en el mensaje ──
  if (matchedProducts.length > 1) {
    // Desambiguación por preferencia explícita (ej. "No quiero Producto A, prefiero Producto B")
    const nonNegatedProducts = [];
    const clauses = userMessageText.split(/[,.;]|\bpero\b|\by\b/i);

    for (const prod of matchedProducts) {
      const prodNorm = normalizeText(prod.name);
      // Buscar la cláusula específica donde aparece este producto
      const relevantClause = clauses.find(c => normalizeText(c).includes(prodNorm)) || userMessageText;
      const clauseNorm = normalizeText(relevantClause);

      const isNegated = /\b(no\s+(?:quiero|deseo|me\s+interesa|voy\s+a\s+llevar)|ya\s+no\s+quiero|descarto)\b/i.test(clauseNorm);
      if (!isNegated) {
        nonNegatedProducts.push(prod);
      }
    }

    // Si la desambiguación arrojó exactamente un producto no negado / preferido
    if (nonNegatedProducts.length === 1) {
      return nonNegatedProducts[0];
    }

    // Si sigue habiendo ambigüedad o es una comparación abierta ("¿cuál recomiendas entre A y B?"): fail-closed
    return null;
  }

  // ── CASO B: Exactamente un producto coincide en el mensaje ──
  if (matchedProducts.length === 1) {
    const singleProduct = matchedProducts[0];
    const prodNorm = normalizeText(singleProduct.name);

    // Verificar si el único producto fue expresamente rechazado en el mensaje
    const isSingleNegated = new RegExp(`(?:no\\s+(?:quiero|deseo|me\\s+interesa)|ya\\s+no\\s+quiero|descarto)\\s+.*${prodNorm}`, 'i').test(normalizedUserText) ||
      isNegativeProductIntent(userMessageText);

    if (isSingleNegated) {
      // Producto explícitamente rechazado por el usuario
      return { ...singleProduct, _isRejected: true };
    }

    return singleProduct;
  }

  // ── CASO C: Ningún producto mencionado en el texto actual ──
  // REGLA DE LATEST INTENT: Solo recurrir a contexto previo si el usuario solicitó explícitamente multimedia
  // para el producto en contexto (ej. "¿Tienes foto?", "Muéstrame video", "Fotos").
  // NUNCA auto-disparar imagen para un producto de turnos previos si el usuario no lo mencionó ni pidió foto.
  if (isExplicitMedia) {
    // 1. Preferir lastConsultedProductId válido/canónico del tenant
    if (lastConsultedProductId) {
      const consulted = availableProducts.find(p => p.id === lastConsultedProductId);
      if (consulted) {
        return consulted;
      }
    }

    // 2. Fallback a currentProductId (producto seleccionado/confirmado en commercialState)
    if (currentProductId) {
      const existing = availableProducts.find(p => p.id === currentProductId);
      if (existing) {
        return existing;
      }
    }
  }

  return null;
}

/**
 * Obtiene la URL canónica de imagen de un producto según las reglas de precedencia
 */
export function getCanonicalProductImageUrl(product) {
  if (!product) return null;
  if (product.imageUrl && typeof product.imageUrl === 'string') {
    const trimmed = product.imageUrl.trim();
    if (trimmed !== '' && trimmed !== 'Sin imagen' && trimmed.startsWith('http')) {
      return trimmed;
    }
  }
  if (Array.isArray(product.images) && product.images.length > 0) {
    const first = product.images.find(img => typeof img === 'string' && img.trim() !== '' && img.trim() !== 'Sin imagen' && img.trim().startsWith('http'));
    if (first) return first.trim();
  }
  return null;
}

/**
 * Obtiene la URL canónica de video de un producto si existe
 */
export function getCanonicalProductVideoUrl(product) {
  if (!product) return null;
  if (product.videoUrl && typeof product.videoUrl === 'string') {
    const trimmed = product.videoUrl.trim();
    if (trimmed !== '' && trimmed !== 'Sin video' && trimmed.startsWith('http')) {
      return trimmed;
    }
  }
  return null;
}

/**
 * Orquestador principal de multimedia de producto.
 * Decide de forma determinista si se debe despachar una imagen o video para el turno actual.
 *
 * @param {object} params
 * @param {string} params.userMessageText - Mensaje actual del cliente
 * @param {Array<object>} params.availableProducts - Catálogo activo del tenant
 * @param {object|null} params.currentCommercialState - Estado comercial actual
 * @param {Array<string>} [params.sentMediaProductIds=[]] - IDs de productos cuya imagen ya fue enviada
 * @returns {object} { shouldDispatch, targetProduct, mediaType, url, isExplicit, reason }
 */
export function orchestrateProductMedia({
  userMessageText,
  availableProducts = [],
  currentCommercialState = {},
  sentMediaProductIds = []
}) {
  const currentProductId = currentCommercialState?.productId || null;
  const lastConsultedProductId = currentCommercialState?.lastConsultedProductId || null;
  const isExplicitVideo = isExplicitProductVideoIntent(userMessageText);
  const isExplicitPhoto = isExplicitProductPhotoIntent(userMessageText);
  const isExplicitMedia = isExplicitVideo || isExplicitPhoto;

  const targetProduct = resolveTargetProduct(userMessageText, availableProducts, currentProductId, {
    isExplicitMedia,
    lastConsultedProductId
  });

  if (!targetProduct) {
    return {
      shouldDispatch: false,
      targetProduct: null,
      mediaType: null,
      url: null,
      isExplicit: false,
      reason: 'NO_TARGET_PRODUCT_RESOLVED'
    };
  }

  // ── FILTRO 1: RECHAZO O DESINTERÉS EXPLÍCITO HACIA EL PRODUCTO ──
  if (targetProduct._isRejected) {
    return {
      shouldDispatch: false,
      targetProduct,
      mediaType: null,
      url: null,
      isExplicit: false,
      reason: 'NEGATIVE_PRODUCT_INTENT'
    };
  }

  // ── FILTRO 2: CONTEXTO DE SOPORTE, RECLAMO O POSTVENTA (EXCEPTUANDO PETICIÓN EXPLÍCITA) ──
  const isSupportContext = isSupportOrComplaintIntent(userMessageText) || currentCommercialState?.currentStage === 'SUPPORT';
  if (isSupportContext && !isExplicitMedia) {
    return {
      shouldDispatch: false,
      targetProduct,
      mediaType: null,
      url: null,
      isExplicit: false,
      reason: 'SUPPORT_OR_POST_SALE_CONTEXT'
    };
  }

  // ── CASO 1: VIDEO (ESTRICTAMENTE EXPLICIT-ONLY) ──
  if (isExplicitVideo) {
    const videoUrl = getCanonicalProductVideoUrl(targetProduct);
    if (!videoUrl) {
      return {
        shouldDispatch: false,
        targetProduct,
        mediaType: 'video',
        url: null,
        isExplicit: true,
        reason: 'NO_VIDEO_REGISTERED'
      };
    }

    return {
      shouldDispatch: true,
      targetProduct,
      mediaType: 'video',
      url: videoUrl,
      isExplicit: true,
      reason: 'EXPLICIT_VIDEO_REQUESTED'
    };
  }

  // ── CASO 2: IMAGEN (AUTO-IMAGE DETERMINISTA + DEDUPLICACIÓN) ──
  const imageUrl = getCanonicalProductImageUrl(targetProduct);
  if (!imageUrl) {
    return {
      shouldDispatch: false,
      targetProduct,
      mediaType: 'image',
      url: null,
      isExplicit: isExplicitPhoto,
      reason: 'NO_IMAGE_REGISTERED'
    };
  }

  const alreadySent = Array.isArray(sentMediaProductIds) && sentMediaProductIds.includes(targetProduct.id);

  // Si ya se envió previamente:
  // - Solo se permite reenvío si el usuario lo solicita de forma EXPLÍCITA ("¿tienes foto?", "mándame una foto", "mándame otra vez")
  // - En caso contrario, se bloquea por deduplicación para no saturar al cliente en cada turno
  if (alreadySent) {
    if (isExplicitPhoto) {
      return {
        shouldDispatch: true,
        targetProduct,
        mediaType: 'image',
        url: imageUrl,
        isExplicit: true,
        reason: 'EXPLICIT_PHOTO_RE_REQUESTED'
      };
    }
    return {
      shouldDispatch: false,
      targetProduct,
      mediaType: 'image',
      url: imageUrl,
      isExplicit: false,
      reason: 'ALREADY_SENT_DEDUP'
    };
  }

  // Primera vez que se consulta este producto y existe imagen válida -> Auto-dispatch de exactamente 1 imagen
  return {
    shouldDispatch: true,
    targetProduct,
    mediaType: 'image',
    url: imageUrl,
    isExplicit: isExplicitPhoto,
    reason: isExplicitPhoto ? 'EXPLICIT_PHOTO_FIRST_REQUEST' : 'AUTO_IMAGE_ON_PRODUCT_INQUIRY'
  };
}
