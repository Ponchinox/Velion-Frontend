import defaultPrisma from '../db.js';
import { getCanonicalProductPrice } from './orderCommercialService.js';
import { generateAIResponse } from './aiService.js';

/**
 * followUpAiService.js — Generación Contextual con IA y Guardrails de Follow-ups V1
 *
 * Características:
 * - Consulta de catálogo con aislamiento estricto por tenant (Tenant-Scoped Product Lookup).
 * - contextSnapshot se usa solo para contexto conversacional; precios y stock se obtienen en vivo.
 * - Guardrails inquebrantables: Prohibido inventar precios, descuentos, stock, o urgencias falsas.
 * - Fallback determinista seguro y neutro si la IA no está disponible o falla.
 */

/**
 * Consulta un producto verificando estrictamente la pertenencia al tenant.
 * NUNCA consulta por solo productId sin filtrar por tenant.
 */
export async function getTenantVerifiedProduct(arg1, arg2, arg3) {
  let tenantId, productId, prismaClient;
  if (arg1 && typeof arg1 === 'object' && arg1.tenantId !== undefined) {
    tenantId = arg1.tenantId;
    productId = arg1.productId;
    prismaClient = arg1.prismaClient || defaultPrisma;
  } else {
    tenantId = arg1;
    productId = arg2;
    prismaClient = arg3 || defaultPrisma;
  }
  if (!tenantId || !productId) return null;
  const db = prismaClient;
  return await db.product.findFirst({
    where: {
      id: productId,
      user: { tenantId }
    },
    select: {
      id: true,
      name: true,
      price: true,
      promotionalPrice: true,
      promoStartDate: true,
      promoEndDate: true,
      isAvailable: true,
      type: true,
      description: true
    }
  });
}

/**
 * Genera la plantilla determinista neutral si la IA no puede o no debe ejecutarse.
 * Si se dispone de pendingTopic o followUpGoal, personaliza el fallback determinista.
 */
export function getDeterministicFallbackMessage({ customerName, productName, attemptNumber, pendingTopic = null, followUpGoal = null }) {
  const cleanName = (customerName && String(customerName).trim()) ? String(customerName).trim() : 'amigo';
  const prod = (productName && String(productName).trim()) ? String(productName).trim() : 'tu pedido';

  if (pendingTopic && typeof pendingTopic === 'string') {
    const topicLower = pendingTopic.toLowerCase();
    if (topicLower.includes('talla') || topicLower.includes('medida') || topicLower.includes('size')) {
      return `Hola ${cleanName} 👋, ¿pudiste confirmar la talla que necesitas para ${prod}? ¡Avísanos para separártelo!`;
    }
    if (topicLower.includes('color') || topicLower.includes('modelo') || topicLower.includes('variante')) {
      return `Hola ${cleanName} 👋, quedamos atentos para confirmar el color o modelo de ${prod}. ¿Cuál prefieres?`;
    }
    if (topicLower.includes('direccion') || topicLower.includes('dirección') || topicLower.includes('envio') || topicLower.includes('envío') || topicLower.includes('ciudad')) {
      return `Hola ${cleanName} 👋, ¿pudiste confirmar la dirección para coordinar el envío de ${prod}?`;
    }
    if (topicLower.includes('decision') || topicLower.includes('decisión') || topicLower.includes('compra')) {
      return `Hola ${cleanName} 👋, ¿pudiste decidir si deseas llevar ${prod}? ¡Quedamos atentos a cualquier consulta!`;
    }
  }

  if (followUpGoal && typeof followUpGoal === 'string' && followUpGoal.trim().length > 5) {
    return `Hola ${cleanName} 👋, te escribimos para consultar si deseas coordinar lo de ${prod}. ¡Avísanos si tienes alguna duda!`;
  }

  if (attemptNumber === 1) {
    return `Hola ${cleanName} 👋, quedamos atentos por si tienes alguna duda con ${prod}. ¡Avísanos si deseas coordinar los detalles!`;
  }
  if (attemptNumber === 2) {
    return `Hola ${cleanName}, ¿pudiste revisar lo de ${prod} o necesitas ayuda con alguna consulta adicional?`;
  }
  return `Hola ${cleanName}, te dejamos este mensajito por si aún te interesa ${prod}. Cualquier consulta futura, aquí estaremos para ayudarte. ¡Lindo día!`;
}

/**
 * Genera el mensaje de seguimiento contextual para un intento específico.
 */
export async function generateFollowUpMessage({
  sequence,
  customer,
  tenant,
  attemptNumber = 1,
  semanticMetadata = null,
  prismaClient = defaultPrisma
}) {
  const db = prismaClient;
  let verifiedProduct = null;

  // 1. Obtener producto verificado con scoping de tenant
  if (sequence.productId) {
    verifiedProduct = await getTenantVerifiedProduct({
      tenantId: sequence.tenantId,
      productId: sequence.productId,
      prismaClient: db
    });

    // P2-A: Si sequence.productId existe pero el producto fue eliminado o está no disponible -> SKIP seguro
    if (!verifiedProduct || verifiedProduct.isAvailable === false) {
      return { success: false, reason: 'PRODUCT_UNAVAILABLE' };
    }
  }

  const effectiveProductName = verifiedProduct?.name || sequence.productName || 'tu producto de interés';
  const customerName = customer?.name || 'amigo';

  // Si no hay producto válido ni en catálogo ni en la secuencia, no se puede generar texto coherente
  if (!effectiveProductName) {
    return { success: false, reason: 'NO_VALID_PRODUCT_FOR_FOLLOW_UP' };
  }

  // Extraer metadata semántica del Decision Engine (inyectada o en contextSnapshot)
  const semantic = semanticMetadata || sequence?.contextSnapshot?.decisionEngine?.gateB || null;
  const pendingTopic = semantic?.pendingTopic || null;
  const followUpGoal = semantic?.followUpGoal || null;
  const suggestedMessageFocus = semantic?.suggestedMessageFocus || null;

  // En entorno de pruebas o modo seguro, usar fallback determinista directo
  if (process.env.NODE_ENV === 'test' || process.env.CAMPAIGN_TEST_MODE === '1') {
    const fallbackText = getDeterministicFallbackMessage({
      customerName,
      productName: effectiveProductName,
      attemptNumber,
      pendingTopic,
      followUpGoal
    });
    return { success: true, text: fallbackText, origin: 'fallback' };
  }

  // 2. Construcción de prompt con guardrails anti-alucinación
  let priceNote = '';
  if (verifiedProduct) {
    const canonicalPrice = getCanonicalProductPrice(verifiedProduct);
    if (canonicalPrice > 0) {
      priceNote = `Precio canónico oficial del producto: ${canonicalPrice} (Usa este precio exacto si el cliente preguntó por el costo; no lo cambies).`;
    }
  }

  const lastDoubt = sequence.contextSnapshot?.lastDoubt ? `Última consulta o duda del cliente: "${sequence.contextSnapshot.lastDoubt}"` : '';

  let intentGoal = '';
  if (followUpGoal) {
    intentGoal = `Objetivo comercial específico: "${followUpGoal}".`;
  } else if (attemptNumber === 1) {
    intentGoal = 'Objetivo: Retomar con amabilidad la conversación sobre el producto, ofreciendo resolver cualquier duda pendiente o coordinar la compra.';
  } else if (attemptNumber === 2) {
    intentGoal = 'Objetivo: Preguntar con cortesía si aún requiere ayuda con el producto o prefiere consultar otra alternativa.';
  } else {
    intentGoal = 'Objetivo: Despedida cortés y no invasiva, dejando la puerta abierta para cuando decida retomar, sin presionar.';
  }

  const topicDirective = pendingTopic
    ? `\n- TEMA PENDIENTE EXACTO DEL CLIENTE: "${pendingTopic}". Redacta preguntando DIRECTAMENTE por este punto específico.`
    : '';

  const focusDirective = suggestedMessageFocus
    ? `\n- ENFOQUE SUGERIDO: "${suggestedMessageFocus}".`
    : '';

  const promptSystem = `Eres el asistente de ventas de "${tenant.companyName || tenant.name}".
Debes redactar un mensaje de seguimiento (follow-up) de WhatsApp para un cliente que estuvo consultando por un producto y no completó su compra.

DATOS DEL CLIENTE Y PRODUCTO:
- Nombre del cliente: ${customerName}
- Producto de interés: ${effectiveProductName}
${priceNote}
${lastDoubt}${topicDirective}${focusDirective}

DIRECTIVAS CRÍTICAS:
1. ${intentGoal}
2. Máximo 2 a 3 líneas cortas y naturales (formato WhatsApp, con 1 o 2 emojis discretos).
3. PROHIBIDO terminantemente inventar promociones, rebajas, descuentos, escasez artificial o urgencias falsas ("solo por hoy", "últimas unidades").
4. NO inventes características técnicas ni métodos de pago no confirmados.
5. Devuelve ÚNICAMENTE el texto final del mensaje, sin preámbulos, explicaciones ni comillas envolventes.`;

  try {
    const response = await generateAIResponse({
      systemPrompt: promptSystem,
      userMessage: `Genera el mensaje de seguimiento #${attemptNumber} para ${customerName}.`,
      tenantId: tenant.id
    });

    const generatedText = response?.text?.trim();
    if (generatedText && generatedText.length > 10) {
      return { success: true, text: generatedText, origin: 'ai' };
    }
  } catch (err) {
    console.warn(`⚠️ [FollowUp AI] Error generando mensaje contextual (${err.message}). Usando fallback determinista.`);
  }

  // Fallback determinista seguro
  const fallbackText = getDeterministicFallbackMessage({
    customerName,
    productName: effectiveProductName,
    attemptNumber,
    pendingTopic,
    followUpGoal
  });
  return { success: true, text: fallbackText, origin: 'fallback' };
}
