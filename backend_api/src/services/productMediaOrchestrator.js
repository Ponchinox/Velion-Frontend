import { isExplicitProductVideoIntent, isExplicitProductPhotoIntent, detectProductMediaIntent } from '../controllers/whatsappController.js';

const STOP_WORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'en', 'para', 'por', 'con', 'sin', 'que', 'y', 'o', 'u', 'a',
  'del', 'al', 'es', 'son', 'cuanto', 'cuesta', 'cuestan', 'vale', 'valen',
  'precio', 'precios', 'tienes', 'tienen', 'hay', 'vendes', 'venden',
  'stock', 'disponible', 'disponibles', 'me', 'interesa', 'quiero', 'quisiera',
  'buenas', 'tardes', 'dias', 'noches', 'hola', 'favor', 'pf', 'porfavor',
  'su', 'sus', 'mi', 'mis', 'tu', 'tus', 'vi', 'vio', 'visto',
  'producto', 'productos', 'articulo', 'articulos', 'item', 'items', 'tienda'
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
 * Detecta si el mensaje hace referencia a un producto de forma genérica o indeterminada
 * (ej. "un producto", "el producto", "un modelo", "de un producto que me interesa").
 */
export function isGenericProductReference(text) {
  if (!text || typeof text !== 'string') return false;
  const normalized = normalizeText(text);
  const genericPatterns = [
    /\b(?:de\s+)?un\s+producto(?:\s+que\s+me\s+(?:ha\s+)?interes(?:a|ado))?\b/,
    /\bdel\s+producto\b/,
    /\bde\s+algun\s+producto\b/,
    /\bel\s+producto\b/,
    /\bun\s+articulo\b/,
    /\bdel\s+articulo\b/,
    /\bun\s+modelo\b/,
    /\bde\s+un\s+modelo\b/
  ];
  return genericPatterns.some(p => p.test(normalized));
}

/**
 * Detecta si el usuario corrige, refuta o desmiente haber mencionado o seleccionado un producto
 * (ej. "Pero no te he mencionado el producto", "no te he dicho qué producto").
 */
export function isUserProductDisavowal(text) {
  if (!text || typeof text !== 'string') return false;
  const normalized = normalizeText(text);
  const patterns = [
    /\bno\s+(?:te\s+)?(?:he\s+)?(?:mencionado|dicho|especificado|indicado)\s+(?:el|ningun|que)\s+producto\b/,
    /\bno\s+(?:te\s+)?(?:dije|mencione|especifique|indique)\s+(?:el|ningun|que)\s+producto\b/,
    /\b(?:pero\s+)?no\s+(?:te\s+)?(?:he\s+)?(?:dicho|mencionado)\s+(?:que\s+producto|el\s+producto|ningun\s+producto)\b/,
    /\b(?:no\s+es|ese\s+no\s+es|aquel\s+no\s+es)\s+(?:el|ese)?\s*producto\b/,
    /\bquien\s+dijo\s+(?:que\s+era\s+ese|ese\s+producto)\b/,
    /\b(?:aún|aun|todavia)\s+no\s+(?:te\s+)?(?:digo|he\s+dicho|menciono|he\s+mencionado)\b/
  ];
  return patterns.some(rgx => rgx.test(normalized));
}

/**
 * Tokens de acciones o términos genéricos que NO identifican un producto específico
 */
const MEDIA_ACTION_TOKENS = new Set([
  'foto', 'fotos', 'imagen', 'imagenes', 'video', 'videos',
  'vista', 'vistas', 'ver', 'muestrame', 'mandame', 'enviame',
  'pasame', 'ensename', 'comparteme', 'comparte', 'catalogo',
  'opciones', 'modelos', 'variedades', 'tienes', 'tienen', 'hay',
  'vendes', 'venden', 'quiero', 'quisiera', 'mas', 'otra', 'unas', 'unos',
  'aver', 'haber', 'buenas', 'hola', 'favor', 'porfavor',
  'mandas', 'envias', 'pasas', 'compartes', 'mandar', 'enviar', 'pasar', 'compartir', 'mostrar', 'ensenar'
]);

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
 * Raíz o lema simplificado para mitigar plurales (smartwatches -> smartwatch, relojes -> reloj, etc.)
 */
export function stemToken(w) {
  if (!w || typeof w !== 'string') return '';
  return w.length > 3 ? w.replace(/e?s$/, '') : w;
}

/**
 * Compara dos tokens considerando coincidencia exacta o equivalencia de plurales
 */
export function tokensMatch(t1, t2) {
  if (!t1 || !t2) return false;
  if (t1 === t2) return true;
  const s1 = stemToken(t1);
  const s2 = stemToken(t2);
  return s1 === s2;
}

/**
 * Detecta si el mensaje actual del cliente corresponde a una consulta de categoría o grupo
 * con múltiples candidatos posibles en el catálogo, sin haber especificado un modelo unívoco.
 *
 * @param {string} userMessageText
 * @param {Array<object>} availableProducts
 * @returns {{ isAmbiguous: boolean, candidateProducts: Array<object>, candidateCount: number, reason?: string, distinguishedProduct?: object }}
 */
export function detectCategoryOrMultiProductQuery(userMessageText, availableProducts = []) {
  if (!userMessageText || typeof userMessageText !== 'string' || !Array.isArray(availableProducts) || availableProducts.length === 0) {
    return { isAmbiguous: false, candidateProducts: [], candidateCount: 0 };
  }

  const normalizedUserText = normalizeText(userMessageText);
  const allUserTokens = extractSignificantTokens(userMessageText);
  // Tokens de búsqueda de producto, excluyendo verbos de multimedia/acciones genéricas
  const searchTokens = allUserTokens.filter(t => !MEDIA_ACTION_TOKENS.has(t) && !STOP_WORDS.has(t));

  if (searchTokens.length === 0) {
    return { isAmbiguous: false, candidateProducts: [], candidateCount: 0 };
  }

  // Buscar productos que coincidan con al menos uno de los searchTokens en nombre, categoría o tags
  const matchedCandidates = [];
  for (const product of availableProducts) {
    if (!product || !product.name) continue;
    const prodNameNorm = normalizeText(product.name);
    const prodCatNorm = product.category ? normalizeText(product.category) : '';
    const prodTagsNorm = Array.isArray(product.tags) ? product.tags.map(t => normalizeText(t)).join(' ') : '';
    const prodTokens = extractSignificantTokens(product.name);
    const prodCatTokens = product.category ? extractSignificantTokens(product.category) : [];
    const prodTagTokens = Array.isArray(product.tags) ? product.tags.flatMap(t => extractSignificantTokens(t)) : [];

    const matchesName = searchTokens.some(st =>
      prodTokens.some(pt => tokensMatch(st, pt)) || (st.length > 3 && prodNameNorm.includes(st))
    );
    const matchesCategory = searchTokens.some(st =>
      prodCatTokens.some(ct => tokensMatch(st, ct)) || (st.length > 3 && prodCatNorm && prodCatNorm.includes(st))
    );
    const matchesTags = searchTokens.some(st =>
      prodTagTokens.some(tt => tokensMatch(st, tt)) || (st.length > 3 && prodTagsNorm && prodTagsNorm.includes(st))
    );

    if (matchesName || matchesCategory || matchesTags) {
      matchedCandidates.push(product);
    }
  }

  if (matchedCandidates.length <= 1) {
    return { isAmbiguous: false, candidateProducts: matchedCandidates, candidateCount: matchedCandidates.length };
  }

  // Hay 2 o más candidatos. Verificar si el usuario proporcionó tokens distintivos que individualizan a EXACTAMENTE UNO
  const uniquelyDistinguished = [];
  for (const cand of matchedCandidates) {
    const candTokens = extractSignificantTokens(cand.name);
    // Tokens que tiene cand pero que NO tienen los demás candidatos
    const otherTokens = new Set();
    for (const other of matchedCandidates) {
      if (other.id !== cand.id) {
        extractSignificantTokens(other.name).forEach(t => otherTokens.add(t));
      }
    }
    const distinguishingTokens = candTokens.filter(t => !otherTokens.has(t));
    const hasDistinguishing = distinguishingTokens.some(dt => allUserTokens.includes(dt) || normalizedUserText.includes(dt));
    if (hasDistinguishing) {
      uniquelyDistinguished.push(cand);
    }
  }

  if (uniquelyDistinguished.length === 1) {
    // El usuario especificó un token distintivo único (ej. "thinking plus" o "xiaomi")
    return { isAmbiguous: false, candidateProducts: matchedCandidates, candidateCount: matchedCandidates.length, distinguishedProduct: uniquelyDistinguished[0] };
  }

  return {
    isAmbiguous: true,
    candidateProducts: matchedCandidates,
    candidateCount: matchedCandidates.length,
    reason: 'AMBIGUOUS_PRODUCT_SELECTION'
  };
}

/**
 * Comprueba si un producto específico fue unívocamente indicado/elegido por el usuario en el mensaje actual
 */
export function isProductExplicitlySpecifiedByUser(userMessageText, product, candidateProducts = []) {
  if (!product || !userMessageText) return false;
  const normalizedUserText = normalizeText(userMessageText);
  const normalizedProdName = normalizeText(product.name);

  if (normalizedUserText.includes(normalizedProdName)) {
    return true;
  }

  const userTokens = new Set(extractSignificantTokens(userMessageText));
  const prodTokens = extractSignificantTokens(product.name);

  if (candidateProducts.length <= 1) {
    // Si no hay ambigüedad de candidatos múltiples, basta con coincidencia de tokens estándar
    return prodTokens.length > 0 && prodTokens.every(t => userTokens.has(t));
  }

  // Si hay múltiples candidatos, el usuario debe haber mencionado tokens distintivos de este producto
  const otherTokens = new Set();
  for (const other of candidateProducts) {
    if (other.id !== product.id) {
      extractSignificantTokens(other.name).forEach(t => otherTokens.add(t));
    }
  }
  const distinguishingTokens = prodTokens.filter(t => !otherTokens.has(t));
  return distinguishingTokens.some(dt => userTokens.has(dt) || normalizedUserText.includes(dt));
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
  { isExplicitMedia = false, lastConsultedProductId = null, isProductConfirmed = false, confirmedProductId = null } = {}
) {
  if (!Array.isArray(availableProducts) || availableProducts.length === 0) {
    return null;
  }

  // GUARD DE DESMENTIDO: Si el usuario expresa que no ha mencionado o que no es ese producto, nunca resolver
  if (isUserProductDisavowal(userMessageText)) {
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
    if (prodTokens.length > 0 && prodTokens.every(t => Array.from(userTokens).some(ut => tokensMatch(ut, t)))) {
      matchedProducts.push(product);
      continue;
    }

    // Si el nombre del producto contiene al menos 2 tokens significativos y el usuario tiene al menos el 50% de ellos
    if (prodTokens.length >= 2) {
      const matchCount = prodTokens.filter(t => Array.from(userTokens).some(ut => tokensMatch(ut, t))).length;
      if (matchCount >= 2 && (matchCount / prodTokens.length >= 0.5)) {
        matchedProducts.push(product);
        continue;
      }
    }

    // Coincidencia por token distintivo único de marca o modelo (ej. "airpods", "geneva", "jbl")
    // si dicho token tiene al menos 3 caracteres y ningún otro producto disponible lo posee
    const hasUniqueDistinguishingToken = prodTokens.some(t => {
      if (t.length < 3) return false;
      const userMatched = Array.from(userTokens).some(ut => tokensMatch(ut, t));
      if (!userMatched) return false;
      return !availableProducts.some(other =>
        other.id !== product.id &&
        extractSignificantTokens(other.name).some(ot => tokensMatch(ot, t))
      );
    });
    if (hasUniqueDistinguishingToken) {
      matchedProducts.push(product);
      continue;
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
      return { ...nonNegatedProducts[0], _isConfirmed: true };
    }

    // Si sigue habiendo ambigüedad: fail-closed explícito (NUNCA caer a producto viejo)
    return {
      isAmbiguous: true,
      reason: 'AMBIGUOUS_PRODUCT_SELECTION',
      candidateProducts: nonNegatedProducts.length > 0 ? nonNegatedProducts : matchedProducts
    };
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
      return { ...singleProduct, _isRejected: true, _isConfirmed: false };
    }

    // El usuario mencionó explícitamente este producto de forma unívoca en su mensaje
    return { ...singleProduct, _isConfirmed: true };
  }

  // ── CASO C: Ningún producto individual alcanzó coincidencia unívoca en el texto actual ──
  // Precaution 2: Una referencia genérica como "el producto", "del producto", "este producto", "ese producto", "un producto"
  // SÍ debe reutilizar contexto cuando exista confirmedProductId válido (o isProductConfirmed === true).
  // Pero si NO existe un producto confirmado por el usuario, PROHIBIDO asumir o reusar y PROHIBIDO interpretar como categoría.
  const isGeneric = isGenericProductReference(userMessageText);
  const effectiveConfirmedId = confirmedProductId || (isProductConfirmed ? (lastConsultedProductId || currentProductId) : null);

  if (isGeneric && !effectiveConfirmedId) {
    return null;
  }

  // GUARD DE CATEGORÍA: Si el usuario consultó por una categoría o grupo con múltiples candidatos,
  // PROHIBIDO hacer fallback a un producto stale previo.
  const categoryCheck = detectCategoryOrMultiProductQuery(userMessageText, availableProducts);
  if (categoryCheck.isAmbiguous) {
    return {
      isAmbiguous: true,
      reason: 'AMBIGUOUS_PRODUCT_SELECTION',
      candidateProducts: categoryCheck.candidateProducts
    };
  }

  // REGLA DE CONTEXTO: Solo recurrir a contexto previo si el usuario solicitó explícitamente multimedia.
  // Para referencias GENÉRICAS ("un producto que me interesa"), exigimos confirmedProductId (guardia de arriba).
  // Para solicitudes elípticas NO genéricas ("Fotos", "Video", "muéstrame"), lastConsultedProductId es suficiente.
  if (isExplicitMedia) {
    // 1. Prioridad: confirmedProductId explícito
    if (effectiveConfirmedId) {
      const confirmed = availableProducts.find(p => p.id === effectiveConfirmedId);
      if (confirmed) {
        return { ...confirmed, _isConfirmed: true };
      }
    }

    // 2. Fallback: lastConsultedProductId (solo si la solicitud NO es genérica)
    if (!isGeneric && lastConsultedProductId) {
      const consulted = availableProducts.find(p => p.id === lastConsultedProductId);
      if (consulted) {
        return { ...consulted, _isConfirmed: false };
      }
    }

    // 3. Fallback final: currentProductId (solo si no es genérica)
    if (!isGeneric && currentProductId) {
      const existing = availableProducts.find(p => p.id === currentProductId);
      if (existing) {
        return { ...existing, _isConfirmed: false };
      }
    }
  }

  return null;
}

/**
 * Fuente canónica y determinista de disponibilidad de medios de un producto.
 * Normaliza todas las fuentes reales de multimedia del modelo Product (imageUrl, images, videoUrl, videos)
 * y retorna listas deduplicadas y flags de disponibilidad verificadas.
 *
 * @param {object} product
 * @returns {{ images: Array<string>, videos: Array<string>, hasImage: boolean, hasVideo: boolean }}
 */
export function getCanonicalProductMedia(product) {
  if (!product || typeof product !== 'object') {
    return {
      images: [],
      videos: [],
      hasImage: false,
      hasVideo: false
    };
  }

  // 1. Extraer y normalizar todas las fuentes potenciales de imágenes
  const rawImages = [];
  if (product.imageUrl) rawImages.push(product.imageUrl);
  if (Array.isArray(product.images)) {
    rawImages.push(...product.images);
  } else if (typeof product.images === 'string') {
    const trimmed = product.images.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) rawImages.push(...parsed);
      } catch {}
    } else if (trimmed.includes(',')) {
      rawImages.push(...trimmed.split(',').map(s => s.trim()));
    } else if (trimmed) {
      rawImages.push(trimmed);
    }
  }

  const seenImages = new Set();
  const canonicalImages = [];
  for (const item of rawImages) {
    if (!item || typeof item !== 'string') continue;
    const clean = item.trim();
    if (clean === '' || clean.toLowerCase() === 'sin imagen') continue;
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) continue;
    if (!seenImages.has(clean)) {
      seenImages.add(clean);
      canonicalImages.push(clean);
    }
  }

  // 2. Extraer y normalizar todas las fuentes potenciales de videos
  const rawVideos = [];
  if (product.videoUrl) rawVideos.push(product.videoUrl);
  if (Array.isArray(product.videos)) {
    rawVideos.push(...product.videos);
  } else if (typeof product.videos === 'string') {
    const trimmed = product.videos.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) rawVideos.push(...parsed);
      } catch {}
    } else if (trimmed.includes(',')) {
      rawVideos.push(...trimmed.split(',').map(s => s.trim()));
    } else if (trimmed) {
      rawVideos.push(trimmed);
    }
  }
  if (Array.isArray(product.videoUrls)) {
    rawVideos.push(...product.videoUrls);
  }

  const seenVideos = new Set();
  const canonicalVideos = [];
  for (const item of rawVideos) {
    if (!item || typeof item !== 'string') continue;
    const clean = item.trim();
    if (clean === '' || clean.toLowerCase() === 'sin video') continue;
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) continue;
    if (!seenVideos.has(clean)) {
      seenVideos.add(clean);
      canonicalVideos.push(clean);
    }
  }

  return {
    images: canonicalImages,
    videos: canonicalVideos,
    hasImage: canonicalImages.length > 0,
    hasVideo: canonicalVideos.length > 0
  };
}

/**
 * Construye la lista canónica, deduplicada y ordenada de imágenes de un producto.
 * Preserva compatibilidad delegando en getCanonicalProductMedia.
 *
 * @param {object} product
 * @returns {Array<string>} URLs válidas y deduplicadas
 */
export function getCanonicalProductImages(product) {
  return getCanonicalProductMedia(product).images;
}

/**
 * Obtiene la URL canónica de portada/imagen principal de un producto según las reglas de precedencia.
 * Preserva compatibilidad hacia atrás retornando el primer elemento de la galería canónica.
 *
 * @param {object} product
 * @returns {string|null}
 */
export function getCanonicalProductImageUrl(product) {
  const images = getCanonicalProductImages(product);
  return images.length > 0 ? images[0] : null;
}

/**
 * Obtiene o reinicializa el estado acotado de galería para un producto dado.
 * Si productMediaState.productId !== targetProductId, resetea sentImageUrls a [].
 *
 * @param {object} commercialState
 * @param {string} targetProductId
 * @returns {object} { productId, sentImageUrls, updatedAt }
 */
export function resolveProductMediaState(commercialState = {}, targetProductId) {
  if (!targetProductId) {
    return {
      productId: null,
      sentImageUrls: [],
      updatedAt: new Date().toISOString()
    };
  }

  const existing = commercialState?.productMediaState;
  if (existing && existing.productId === targetProductId && Array.isArray(existing.sentImageUrls)) {
    return {
      productId: targetProductId,
      sentImageUrls: [...existing.sentImageUrls],
      updatedAt: existing.updatedAt || new Date().toISOString()
    };
  }

  return {
    productId: targetProductId,
    sentImageUrls: [],
    updatedAt: new Date().toISOString()
  };
}

/**
 * Clasifica el tipo de solicitud de foto según el texto del usuario y el contexto previo:
 * - 'SINGLE_PHOTO': Petición inicial o solicitud de exactamente una foto (ej. "foto", "¿tienes foto?", "muéstrame una foto")
 * - 'NEXT_PHOTO': Solicitud de la siguiente foto individual (ej. "otra foto", "muéstrame otra", "una más")
 * - 'MORE_PHOTOS': Solicitud de fotos adicionales o de toda la galería restante (ej. "más fotos", "¿tienes más fotos?", "todas las fotos")
 *
 * @param {string} text - Texto del usuario
 * @param {object} [options]
 * @param {boolean} [options.hasAlreadySentPhoto=false] - Si ya se ha enviado al menos una foto de este producto
 * @returns {'SINGLE_PHOTO' | 'NEXT_PHOTO' | 'MORE_PHOTOS'}
 */
export function classifyPhotoRequestType(text, { hasAlreadySentPhoto = false } = {}) {
  if (!text || typeof text !== 'string') return 'SINGLE_PHOTO';
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  // 1. NEXT_PHOTO: Solicitudes explícitas de "otra" (singular / siguiente foto individual)
  const nextPhotoPattern = /\b(otra\s+fotos?|otra\s+imagen(?:es)?|otra\s+vista|una\s+mas|siguiente\s+fotos?|siguiente\s+imagen)\b/i;
  const nextPhotoActionPattern = /\b(muestrame|mandame|enviame|pasame|ensename|ver|tienes?|hay)\s+otra\b/i;
  const isNextPhotoExact = /^(?:otra|una\s+mas)[\s?.!]*$/i.test(normalized);

  if (nextPhotoPattern.test(normalized) || nextPhotoActionPattern.test(normalized) || isNextPhotoExact) {
    return 'NEXT_PHOTO';
  }

  // 2. MORE_PHOTOS: Solicitudes explícitas de "más fotos", "todas las fotos", "demás fotos"
  const morePhotosExplicitPattern = /\b(mas\s+fotos?|mas\s+imagenes?|todas\s+las\s+fotos?|todas\s+las\s+imagenes?|demas\s+fotos?|resto\s+de\s+fotos?|otras\s+fotos?|otras\s+imagenes?|ver\s+mas\s+fotos?|ver\s+mas\s+imagenes?)\b/i;
  if (morePhotosExplicitPattern.test(normalized)) {
    return 'MORE_PHOTOS';
  }

  // 3. Si ya se envió previamente una foto del producto:
  // Frases como "¿tienes más?", "mándame más", "ver más", o simplemente "fotos" / "las fotos" en plural
  // se interpretan naturalmente como solicitud de ver las fotos restantes
  if (hasAlreadySentPhoto) {
    if (/\b(tienes?|hay|mandame|enviame|pasame|comparte(?:me)?|quiero|ver)\s+mas\b/i.test(normalized)) {
      return 'MORE_PHOTOS';
    }
    if (/^(?:la\s+|las\s+)?fotos?(?:\s+(?:por\s+favor|pf|plz|favor))?[\s?.!]*$/i.test(normalized)) {
      return 'MORE_PHOTOS';
    }
  }

  return 'SINGLE_PHOTO';
}

/**
 * Obtiene la lista de imágenes restantes no enviadas de un producto dado el estado de galería.
 *
 * @param {object} product
 * @param {object} productMediaState - { productId, sentImageUrls }
 * @returns {object} { remainingImages, isExhausted, totalImages, sentCount, canonicalImages }
 */
export function getRemainingProductImages(product, productMediaState = {}) {
  const canonicalImages = getCanonicalProductImages(product);
  if (canonicalImages.length === 0) {
    return {
      remainingImages: [],
      isExhausted: false,
      totalImages: 0,
      sentCount: 0,
      canonicalImages: []
    };
  }

  const sentUrls = new Set(Array.isArray(productMediaState?.sentImageUrls) ? productMediaState.sentImageUrls : []);
  const remainingImages = canonicalImages.filter(url => !sentUrls.has(url));
  const isExhausted = canonicalImages.length > 0 && remainingImages.length === 0;

  return {
    remainingImages,
    isExhausted,
    totalImages: canonicalImages.length,
    sentCount: sentUrls.size,
    canonicalImages
  };
}

/**
 * Selecciona la siguiente imagen no enviada de un producto dado el estado de galería.
 * Preserva compatibilidad hacia atrás retornando nextImageUrl además de remainingImages.
 *
 * @param {object} product
 * @param {object} productMediaState - { productId, sentImageUrls }
 * @returns {object} { nextImageUrl, remainingImages, isExhausted, totalImages, sentCount, canonicalImages }
 */
export function getNextUnseenProductImage(product, productMediaState = {}) {
  const { remainingImages, isExhausted, totalImages, sentCount, canonicalImages } = getRemainingProductImages(product, productMediaState);

  return {
    nextImageUrl: remainingImages.length > 0 ? remainingImages[0] : null,
    remainingImages,
    isExhausted,
    totalImages,
    sentCount,
    canonicalImages
  };
}

/**
 * Obtiene la URL canónica de video de un producto si existe
 */
export function getCanonicalProductVideoUrl(product) {
  const videos = getCanonicalProductMedia(product).videos;
  return videos.length > 0 ? videos[0] : null;
}

/**
 * Encuentra todos los productos del catálogo que son mencionados en el mensaje del usuario,
 * ordenados por su posición de aparición en el texto.
 */
export function findMentionedProducts(userMessageText, availableProducts = []) {
  if (!userMessageText || typeof userMessageText !== 'string' || !Array.isArray(availableProducts) || availableProducts.length === 0) {
    return [];
  }

  const normalizedUserText = normalizeText(userMessageText);
  const userTokens = new Set(extractSignificantTokens(userMessageText));
  const found = [];

  for (const product of availableProducts) {
    if (!product || !product.name) continue;
    const normalizedProdName = normalizeText(product.name);
    const prodTokens = extractSignificantTokens(product.name);

    let matchIndex = -1;
    let matchLength = 0;

    // A. Coincidencia exacta de substring
    const subIdx = normalizedUserText.indexOf(normalizedProdName);
    if (subIdx !== -1) {
      matchIndex = subIdx;
      matchLength = normalizedProdName.length;
    } else if (prodTokens.length > 0 && prodTokens.every(t => Array.from(userTokens).some(ut => tokensMatch(ut, t)))) {
      // B. Todos los tokens presentes
      let firstIdx = Infinity;
      let lastIdx = -1;
      let lastTokenLen = 0;
      for (const t of prodTokens) {
        const idx = normalizedUserText.indexOf(t);
        if (idx !== -1 && idx < firstIdx) firstIdx = idx;
        if (idx !== -1 && idx > lastIdx) {
          lastIdx = idx;
          lastTokenLen = t.length;
        }
      }
      matchIndex = firstIdx === Infinity ? 0 : firstIdx;
      matchLength = lastIdx !== -1 ? (lastIdx + lastTokenLen - firstIdx) : prodTokens.map(t => t.length).reduce((a, b) => a + b, 0);
    } else if (prodTokens.length >= 2) {
      // C. >= 50% de los tokens
      const matchingTokens = prodTokens.filter(t => Array.from(userTokens).some(ut => tokensMatch(ut, t)));
      if (matchingTokens.length >= 2 && (matchingTokens.length / prodTokens.length >= 0.5)) {
        let firstIdx = Infinity;
        let lastIdx = -1;
        let lastTokenLen = 0;
        for (const t of matchingTokens) {
          const idx = normalizedUserText.indexOf(t);
          if (idx !== -1 && idx < firstIdx) firstIdx = idx;
          if (idx !== -1 && idx > lastIdx) {
            lastIdx = idx;
            lastTokenLen = t.length;
          }
        }
        matchIndex = firstIdx === Infinity ? 0 : firstIdx;
        matchLength = lastIdx !== -1 ? (lastIdx + lastTokenLen - firstIdx) : matchingTokens.map(t => t.length).reduce((a, b) => a + b, 0);
      }
    }

    // D. Token distintivo único (>= 3 chars)
    if (matchIndex === -1) {
      const distinctTokens = prodTokens.filter(t => {
        if (t.length < 3) return false;
        const userMatched = Array.from(userTokens).some(ut => tokensMatch(ut, t));
        if (!userMatched) return false;
        return !availableProducts.some(other =>
          other.id !== product.id &&
          extractSignificantTokens(other.name).some(ot => tokensMatch(ot, t))
        );
      });
      if (distinctTokens.length > 0) {
        let firstIdx = Infinity;
        let lastIdx = -1;
        let lastTokenLen = 0;
        for (const t of distinctTokens) {
          const idx = normalizedUserText.indexOf(t);
          if (idx !== -1 && idx < firstIdx) firstIdx = idx;
          if (idx !== -1 && idx > lastIdx) {
            lastIdx = idx;
            lastTokenLen = t.length;
          }
        }
        matchIndex = firstIdx === Infinity ? 0 : firstIdx;
        matchLength = lastIdx !== -1 ? (lastIdx + lastTokenLen - firstIdx) : distinctTokens[0].length;
      }
    }

    if (matchIndex !== -1) {
      found.push({
        product,
        _matchIndex: matchIndex,
        _matchLength: matchLength
      });
    }
  }

  // Deduplicar productos idénticos
  const uniqueFound = [];
  for (const item of found) {
    if (!uniqueFound.some(u => u.product.id === item.product.id)) {
      uniqueFound.push(item);
    }
  }

  // Ordenar por orden lógico de aparición en el mensaje (Regla 3)
  uniqueFound.sort((a, b) => a._matchIndex - b._matchIndex);
  return uniqueFound;
}

/**
 * Busca el índice relativo en `inBetween` donde se produce la separación de cláusula entre dos productos.
 */
function findClauseBoundaryOffset(inBetween) {
  if (!inBetween || typeof inBetween !== 'string') return -1;

  // 1. Divisores fuertes explícitos: + o ;
  const strongMatch = inBetween.search(/[+;]/);
  if (strongMatch !== -1) return strongMatch;

  // 2. Conjunciones coordinantes de contraste o adición
  const coordMatch = inBetween.search(/\b(?:pero|ademas|además|tambien|también|mientras)\b/i);
  if (coordMatch !== -1) return coordMatch;

  // 3. Frase de medios que introduce el siguiente producto: e.g. "y foto de", ", video del", "y pasame"
  const nextMediaMatch = inBetween.search(/(?:[,;]|\by\b)\s*(?:(?:quiero|deseo|mandame|mándame|enviame|envíame|pasame|pásame|ver|dame)\s+)?(?:un[as]?\s+|el\s+|la\s+|los\s+|las\s+)?(?:foto|video|imagen|ambos|fotos|videos|im[aá]genes)\b/i);
  if (nextMediaMatch !== -1) return nextMediaMatch;

  // 4. Fallback a "y" o coma, enmascarando expresiones compuestas como "foto y video"
  const masked = inBetween.replace(/\b(fotos?|videos?|im[aá]genes?)\s+(?:y|\+)\s+(fotos?|videos?|im[aá]genes?)\b/gi, (m) => '_'.repeat(m.length));
  const fallbackMatch = masked.search(/(?:[,;]|\by\b)/i);
  if (fallbackMatch !== -1) return fallbackMatch;

  return -1;
}

/**
 * Extrae los segmentos de texto asociados a cada producto mencionado, respetando el orden lógico.
 */
export function extractProductSegments(userMessageText, matchedItems = []) {
  if (!matchedItems || matchedItems.length <= 1) {
    return [{ product: matchedItems[0]?.product, segmentText: userMessageText }];
  }

  const segments = [];
  for (let i = 0; i < matchedItems.length; i++) {
    const current = matchedItems[i];
    const prev = i > 0 ? matchedItems[i - 1] : null;
    const next = i < matchedItems.length - 1 ? matchedItems[i + 1] : null;

    let start = 0;
    if (prev) {
      const prevEnd = prev._matchIndex + (prev._matchLength || prev.product.name.length);
      const inBetween = userMessageText.slice(prevEnd, current._matchIndex);
      const boundaryOffset = findClauseBoundaryOffset(inBetween);
      start = boundaryOffset !== -1 ? prevEnd + boundaryOffset : prevEnd;
    }

    let end = userMessageText.length;
    if (next) {
      const currentEnd = current._matchIndex + (current._matchLength || current.product.name.length);
      const inBetween = userMessageText.slice(currentEnd, next._matchIndex);
      const boundaryOffset = findClauseBoundaryOffset(inBetween);
      end = boundaryOffset !== -1 ? currentEnd + boundaryOffset : next._matchIndex;
    }

    segments.push({
      product: current.product,
      segmentText: userMessageText.slice(start, end).trim()
    });
  }
  return segments;
}

/**
 * Divide el mensaje en cláusulas manteniendo intactas expresiones compuestas como "foto y video".
 */
export function splitMessageIntoClauses(userMessageText) {
  if (!userMessageText || typeof userMessageText !== 'string') return [];

  const placeholders = [];
  const protectedText = userMessageText.replace(
    /\b(fotos?|videos?|im[aá]genes?)\s+(?:y|\+)\s+(fotos?|videos?|im[aá]genes?)\b/gi,
    (match) => {
      const ph = `__MEDIA_PAIR_${placeholders.length}__`;
      placeholders.push({ ph, original: match });
      return ph;
    }
  );

  const rawClauses = protectedText.split(
    /(?:[+;]|\b(?:pero|ademas|además|tambien|también|mientras)\b|(?:\by\b|[,])\s*(?=(?:(?:quiero|deseo|mandame|mándame|enviame|envíame|pasame|pásame|ver|dame)\s+)?(?:un[as]?\s+|el\s+|la\s+|los\s+|las\s+)?(?:foto|video|imagen|ambos|fotos|videos|im[aá]genes)\b)|(?:\by\b|[,])\s*(?=(?:los|las|el|la|de|del)\s+))/i
  );

  const clauses = [];
  for (let clause of rawClauses) {
    if (!clause) continue;
    for (const { ph, original } of placeholders) {
      clause = clause.replaceAll(ph, original);
    }
    const trimmed = clause.trim();
    if (trimmed.length > 0) clauses.push(trimmed);
  }

  return clauses.length > 0 ? clauses : [userMessageText];
}

/**
 * Resuelve requerimientos de multimedia cuando un mismo mensaje contiene varios productos.
 *
 * @param {object} params
 * @param {string} params.userMessageText
 * @param {Array<object>} params.availableProducts
 * @param {object} [params.currentCommercialState]
 * @returns {object|null}
 */
export function resolveMultiProductMediaRequests({
  userMessageText,
  availableProducts = [],
  currentCommercialState = {}
}) {
  if (!userMessageText || typeof userMessageText !== 'string') return null;
  if (!Array.isArray(availableProducts) || availableProducts.length === 0) return null;

  // Guardia de desmentido o referencia genérica sin producto confirmado
  if (isUserProductDisavowal(userMessageText)) return null;
  if (isGenericProductReference(userMessageText) && !currentCommercialState?.confirmedProductId && !currentCommercialState?.isProductConfirmed) {
    return null;
  }

  const globalIntent = detectProductMediaIntent(userMessageText) || 'image';

  // Analizar por cláusulas
  const clauses = splitMessageIntoClauses(userMessageText);
  const clauseResolved = [];
  const ambiguousGroups = [];

  for (const clause of clauses) {
    // 1. Revisar si la cláusula menciona algún producto explícito
    const clauseMentioned = findMentionedProducts(clause, availableProducts);
    if (clauseMentioned.length > 0) {
      for (const m of clauseMentioned) {
        const clauseNorm = normalizeText(clause);
        const isNegated = /\b(no\s+(?:quiero|deseo|me\s+interesa|voy\s+a\s+llevar)|ya\s+no\s+quiero|descarto)\b/i.test(clauseNorm);
        if (!isNegated && !clauseResolved.some(r => r.product.id === m.product.id)) {
          clauseResolved.push({
            product: m.product,
            clauseText: clause
          });
        }
      }
    } else {
      // 2. Si no menciona un producto unívoco, verificar si es una consulta de categoría ambigua (ej. "reloj")
      const catCheck = detectCategoryOrMultiProductQuery(clause, availableProducts);
      if (catCheck && catCheck.isAmbiguous && Array.isArray(catCheck.candidateProducts) && catCheck.candidateProducts.length > 1) {
        ambiguousGroups.push(catCheck.candidateProducts);
      }
    }
  }

  // Si el análisis por cláusulas no encontró >= 2 items (productos + grupos ambiguos),
  // intentar también con findMentionedProducts en todo el mensaje
  if (clauseResolved.length + ambiguousGroups.length <= 1) {
    const fullMentioned = findMentionedProducts(userMessageText, availableProducts);
    if (fullMentioned.length > 1) {
      const nonNegatedFull = [];
      for (const item of fullMentioned) {
        const prodNorm = normalizeText(item.product.name);
        const relevantClause = clauses.find(c => normalizeText(c).includes(prodNorm)) || userMessageText;
        const clauseNorm = normalizeText(relevantClause);
        const isNegated = /\b(no\s+(?:quiero|deseo|me\s+interesa|voy\s+a\s+llevar)|ya\s+no\s+quiero|descarto)\b/i.test(clauseNorm);
        if (!isNegated && !nonNegatedFull.some(u => u.product.id === item.product.id)) {
          nonNegatedFull.push(item);
        }
      }

      if (nonNegatedFull.length > 1) {
        const segments = extractProductSegments(userMessageText, nonNegatedFull);
        clauseResolved.length = 0;
        for (let i = 0; i < nonNegatedFull.length; i++) {
          clauseResolved.push({
            product: nonNegatedFull[i].product,
            clauseText: segments[i]?.segmentText || userMessageText
          });
        }
      }
    }
  }

  // Si no hay múltiples productos ni combinación de producto explícito + ambigüedad:
  if (clauseResolved.length + ambiguousGroups.length <= 1) {
    return null; // Caso monoproducto o sin producto; se procesa por el flujo estándar
  }

  // Si solo hay grupos ambiguos y ningún producto válido resuelto:
  if (clauseResolved.length === 0 && ambiguousGroups.length > 0) {
    return {
      isMultiProduct: true,
      shouldDispatch: false,
      isAmbiguous: true,
      reason: 'AMBIGUOUS_PRODUCT_SELECTION',
      mediaRequests: [],
      mediaItems: [],
      urls: [],
      url: null,
      hasAmbiguousProducts: true,
      ambiguousGroups
    };
  }

  // Procesar cada producto válido en orden de aparición en el mensaje original (Regla 3)
  const mediaRequests = [];
  const allMediaItems = [];
  const seenUrls = new Set();

  for (const item of clauseResolved) {
    let requestedType = detectProductMediaIntent(item.clauseText);
    if (!requestedType) {
      requestedType = globalIntent;
    }

    const canonical = getCanonicalProductMedia(item.product);
    const productMediaItems = [];
    const missingMedia = [];

    if (requestedType === 'both') {
      if (canonical.hasImage && canonical.hasVideo) {
        if (!seenUrls.has(canonical.images[0])) {
          productMediaItems.push({ type: 'image', url: canonical.images[0], productId: item.product.id, productName: item.product.name });
          seenUrls.add(canonical.images[0]);
        }
        if (!seenUrls.has(canonical.videos[0])) {
          productMediaItems.push({ type: 'video', url: canonical.videos[0], productId: item.product.id, productName: item.product.name });
          seenUrls.add(canonical.videos[0]);
        }
      } else if (canonical.hasImage && !canonical.hasVideo) {
        if (!seenUrls.has(canonical.images[0])) {
          productMediaItems.push({ type: 'image', url: canonical.images[0], productId: item.product.id, productName: item.product.name });
          seenUrls.add(canonical.images[0]);
        }
        missingMedia.push('video');
      } else if (!canonical.hasImage && canonical.hasVideo) {
        if (!seenUrls.has(canonical.videos[0])) {
          productMediaItems.push({ type: 'video', url: canonical.videos[0], productId: item.product.id, productName: item.product.name });
          seenUrls.add(canonical.videos[0]);
        }
        missingMedia.push('image');
      } else {
        missingMedia.push('image', 'video');
      }
    } else if (requestedType === 'video') {
      if (canonical.hasVideo) {
        if (!seenUrls.has(canonical.videos[0])) {
          productMediaItems.push({ type: 'video', url: canonical.videos[0], productId: item.product.id, productName: item.product.name });
          seenUrls.add(canonical.videos[0]);
        }
      } else {
        missingMedia.push('video');
      }
    } else {
      // requestedType === 'image'
      if (canonical.hasImage) {
        if (!seenUrls.has(canonical.images[0])) {
          productMediaItems.push({ type: 'image', url: canonical.images[0], productId: item.product.id, productName: item.product.name });
          seenUrls.add(canonical.images[0]);
        }
      } else {
        missingMedia.push('image');
      }
    }

    mediaRequests.push({
      product: item.product,
      productId: item.product.id,
      productName: item.product.name,
      requestedType,
      hasImage: canonical.hasImage,
      hasVideo: canonical.hasVideo,
      missingMedia,
      mediaItems: productMediaItems
    });

    allMediaItems.push(...productMediaItems);
  }

  const hasAnyVideo = allMediaItems.some(m => m.type === 'video');
  const hasAnyImage = allMediaItems.some(m => m.type === 'image');
  const allUrls = allMediaItems.map(m => m.url);

  return {
    isMultiProduct: true,
    shouldDispatch: allMediaItems.length > 0,
    mediaRequests,
    mediaItems: allMediaItems,
    urls: allUrls,
    url: allUrls[0] || null,
    mediaType: (hasAnyVideo && hasAnyImage) ? 'both' : (hasAnyVideo ? 'video' : 'image'),
    hasImage: hasAnyImage,
    hasVideo: hasAnyVideo,
    hasAmbiguousProducts: ambiguousGroups.length > 0,
    ambiguousGroups,
    isExplicit: true,
    reason: 'MULTI_PRODUCT_MEDIA_REQUEST'
  };
}

/**
 * Orquestador principal de multimedia de producto.
 * Decide de forma determinista si se debe despachar una imagen, video o ambos para el turno actual.
 *
 * @param {object} params
 * @param {string} params.userMessageText - Mensaje actual del cliente
 * @param {Array<object>} params.availableProducts - Catálogo activo del tenant
 * @param {object|null} params.currentCommercialState - Estado comercial actual
 * @param {Array<string>} [params.sentMediaProductIds=[]] - IDs de productos cuya imagen ya fue enviada
 * @returns {object} { shouldDispatch, targetProduct, mediaType, url, urls, mediaItems, isExplicit, reason }
 */
export function orchestrateProductMedia({
  userMessageText,
  availableProducts = [],
  currentCommercialState = {},
  sentMediaProductIds = []
}) {
  const currentProductId = currentCommercialState?.productId || null;
  const lastConsultedProductId = currentCommercialState?.lastConsultedProductId || null;
  const isProductConfirmed = Boolean(currentCommercialState?.isProductConfirmed);
  const confirmedProductId = currentCommercialState?.confirmedProductId || null;

  const isExplicitVideo = isExplicitProductVideoIntent(userMessageText);
  const isExplicitPhoto = isExplicitProductPhotoIntent(userMessageText);
  const isExplicitMedia = isExplicitVideo || isExplicitPhoto;

  // ── MULTI-PRODUCT MEDIA DISPATCH CHECK ──
  const multiResult = resolveMultiProductMediaRequests({
    userMessageText,
    availableProducts,
    currentCommercialState
  });

  if (multiResult && multiResult.isMultiProduct) {
    return multiResult;
  }

  const targetProduct = resolveTargetProduct(userMessageText, availableProducts, currentProductId, {
    isExplicitMedia,
    lastConsultedProductId,
    isProductConfirmed,
    confirmedProductId
  });

  if (!targetProduct) {
    return {
      shouldDispatch: false,
      targetProduct: null,
      mediaType: null,
      url: null,
      urls: [],
      mediaItems: [],
      isExplicit: Boolean(isExplicitMedia),
      needsClarification: Boolean(isExplicitMedia),
      reason: isExplicitMedia ? 'PRODUCT_CLARIFICATION_REQUIRED' : 'NO_TARGET_PRODUCT_RESOLVED'
    };
  }

  // ── FILTRO 0: AMBIGÜEDAD DE CATEGORÍA O MÚLTIPLES PRODUCTOS CANDIDATOS ──
  if (targetProduct.isAmbiguous || targetProduct._isAmbiguous) {
    return {
      shouldDispatch: false,
      targetProduct: null,
      mediaType: null,
      url: null,
      urls: [],
      mediaItems: [],
      isExplicit: Boolean(isExplicitMedia),
      isAmbiguous: true,
      candidateCount: targetProduct.candidateProducts?.length || 0,
      candidateProducts: targetProduct.candidateProducts || [],
      reason: 'AMBIGUOUS_PRODUCT_SELECTION'
    };
  }

  // ── FILTRO 1: RECHAZO O DESINTERÉS EXPLÍCITO HACIA EL PRODUCTO ──
  if (targetProduct._isRejected) {
    return {
      shouldDispatch: false,
      targetProduct,
      mediaType: null,
      url: null,
      urls: [],
      mediaItems: [],
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
      urls: [],
      mediaItems: [],
      isExplicit: false,
      reason: 'SUPPORT_OR_POST_SALE_CONTEXT'
    };
  }

  const canonicalMedia = getCanonicalProductMedia(targetProduct);

  // ── CASO 1: AMBOS MEDIOS SOLICITADOS (FOTO Y VIDEO) ──
  if (isExplicitVideo && isExplicitPhoto) {
    if (canonicalMedia.hasImage && canonicalMedia.hasVideo) {
      return {
        shouldDispatch: true,
        targetProduct,
        mediaType: 'both',
        url: canonicalMedia.images[0],
        urls: [canonicalMedia.images[0], canonicalMedia.videos[0]],
        mediaItems: [
          { type: 'image', url: canonicalMedia.images[0] },
          { type: 'video', url: canonicalMedia.videos[0] }
        ],
        hasImage: true,
        hasVideo: true,
        isExplicit: true,
        reason: 'EXPLICIT_PHOTO_AND_VIDEO_REQUESTED'
      };
    } else if (canonicalMedia.hasImage && !canonicalMedia.hasVideo) {
      return {
        shouldDispatch: true,
        targetProduct,
        mediaType: 'image',
        url: canonicalMedia.images[0],
        urls: [canonicalMedia.images[0]],
        mediaItems: [
          { type: 'image', url: canonicalMedia.images[0] }
        ],
        hasImage: true,
        hasVideo: false,
        isExplicit: true,
        reason: 'EXPLICIT_BOTH_REQUESTED_ONLY_IMAGE_AVAILABLE'
      };
    } else if (!canonicalMedia.hasImage && canonicalMedia.hasVideo) {
      return {
        shouldDispatch: true,
        targetProduct,
        mediaType: 'video',
        url: canonicalMedia.videos[0],
        urls: [canonicalMedia.videos[0]],
        mediaItems: [
          { type: 'video', url: canonicalMedia.videos[0] }
        ],
        hasImage: false,
        hasVideo: true,
        isExplicit: true,
        reason: 'EXPLICIT_BOTH_REQUESTED_ONLY_VIDEO_AVAILABLE'
      };
    } else {
      return {
        shouldDispatch: false,
        targetProduct,
        mediaType: 'both',
        url: null,
        urls: [],
        mediaItems: [],
        hasImage: false,
        hasVideo: false,
        isExplicit: true,
        reason: 'NO_MEDIA_REGISTERED'
      };
    }
  }

  // ── CASO 2: SOLO VIDEO (ESTRICTAMENTE EXPLICIT-ONLY) ──
  if (isExplicitVideo) {
    if (!canonicalMedia.hasVideo) {
      return {
        shouldDispatch: false,
        targetProduct,
        mediaType: 'video',
        url: null,
        urls: [],
        mediaItems: [],
        hasImage: canonicalMedia.hasImage,
        hasVideo: false,
        isExplicit: true,
        reason: 'NO_VIDEO_REGISTERED'
      };
    }

    return {
      shouldDispatch: true,
      targetProduct,
      mediaType: 'video',
      url: canonicalMedia.videos[0],
      urls: [canonicalMedia.videos[0]],
      mediaItems: [
        { type: 'video', url: canonicalMedia.videos[0] }
      ],
      hasImage: canonicalMedia.hasImage,
      hasVideo: true,
      isExplicit: true,
      reason: 'EXPLICIT_VIDEO_REQUESTED'
    };
  }

  // ── CASO 3: IMAGEN (AUTO-IMAGE DETERMINISTA + ROTACIÓN DE GALERÍA) ──
  if (!canonicalMedia.hasImage) {
    return {
      shouldDispatch: false,
      targetProduct,
      mediaType: 'image',
      url: null,
      urls: [],
      mediaItems: [],
      hasImage: false,
      hasVideo: canonicalMedia.hasVideo,
      isExplicit: isExplicitPhoto,
      reason: 'NO_IMAGE_REGISTERED'
    };
  }

  const mediaState = resolveProductMediaState(currentCommercialState, targetProduct.id);
  const { nextImageUrl, remainingImages, isExhausted } = getNextUnseenProductImage(targetProduct, mediaState);

  const alreadySent = Array.isArray(sentMediaProductIds) && sentMediaProductIds.includes(targetProduct.id);

  if (alreadySent) {
    if (isExplicitPhoto) {
      if (isExhausted) {
        return {
          shouldDispatch: false,
          targetProduct,
          mediaType: 'image',
          url: null,
          urls: [],
          mediaItems: [],
          isExplicit: true,
          isExhausted: true,
          totalImages: canonicalMedia.images.length,
          isSingleImage: canonicalMedia.images.length === 1,
          reason: 'ALL_PRODUCT_IMAGES_ALREADY_SENT'
        };
      }

      const requestType = classifyPhotoRequestType(userMessageText, {
        hasAlreadySentPhoto: (mediaState.sentImageUrls.length > 0)
      });

      if (requestType === 'MORE_PHOTOS') {
        return {
          shouldDispatch: true,
          targetProduct,
          mediaType: 'image',
          url: remainingImages[0],
          urls: remainingImages,
          mediaItems: remainingImages.map(u => ({ type: 'image', url: u })),
          isExplicit: true,
          requestType: 'MORE_PHOTOS',
          totalImages: canonicalMedia.images.length,
          reason: 'MORE_PHOTOS_REQUESTED'
        };
      }

      return {
        shouldDispatch: true,
        targetProduct,
        mediaType: 'image',
        url: nextImageUrl,
        urls: [nextImageUrl],
        mediaItems: [{ type: 'image', url: nextImageUrl }],
        isExplicit: true,
        requestType: 'NEXT_PHOTO',
        totalImages: canonicalMedia.images.length,
        reason: 'EXPLICIT_PHOTO_RE_REQUESTED'
      };
    }
    return {
      shouldDispatch: false,
      targetProduct,
      mediaType: 'image',
      url: canonicalMedia.images[0],
      urls: [canonicalMedia.images[0]],
      mediaItems: [{ type: 'image', url: canonicalMedia.images[0] }],
      isExplicit: false,
      totalImages: canonicalMedia.images.length,
      reason: 'ALREADY_SENT_DEDUP'
    };
  }

  // Primera vez que se consulta este producto y existe imagen válida -> Auto-dispatch de exactamente 1 imagen (portada)
  return {
    shouldDispatch: true,
    targetProduct,
    mediaType: 'image',
    url: canonicalMedia.images[0],
    urls: [canonicalMedia.images[0]],
    mediaItems: [{ type: 'image', url: canonicalMedia.images[0] }],
    isExplicit: isExplicitPhoto,
    requestType: 'SINGLE_PHOTO',
    totalImages: canonicalMedia.images.length,
    reason: isExplicitPhoto ? 'EXPLICIT_PHOTO_FIRST_REQUEST' : 'AUTO_IMAGE_ON_PRODUCT_INQUIRY'
  };
}
