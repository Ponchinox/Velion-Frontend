import prisma from '../db.js';
import { cancelFollowUpOnOrderEvent } from './followUpService.js';

/**
 * Calcula el precio canónico vigente de un producto (respetando promociones por fecha).
 * NUNCA utiliza `budget` ni parámetros del LLM.
 */
export function getCanonicalProductPrice(product) {
  if (!product) return 0;
  if (product.promotionalPrice && product.promotionalPrice > 0) {
    const now = new Date();
    const start = product.promoStartDate ? new Date(product.promoStartDate) : null;
    const end = product.promoEndDate ? new Date(product.promoEndDate) : null;
    if ((!start || now >= start) && (!end || now <= end)) {
      return product.promotionalPrice;
    }
  }
  return product.price;
}

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
export async function syncCommercialOrder({
  tenant,
  customer,
  clientNumber,
  currentCommercialState = {},
  args = {},
  onNotification = null,
  prismaClient = prisma
}) {
  const db = prismaClient;
  if (!tenant?.id) {
    throw new Error('syncCommercialOrder requiere un tenant con id válido.');
  }
  if (!customer?.id) {
    throw new Error('syncCommercialOrder requiere un customer con id válido.');
  }

  // 1. Obtener y validar métodos de pago reales del tenant (fuente canónica: tenant.bankAccounts)
  let tenantBankAccounts = tenant.bankAccounts;
  if (tenantBankAccounts === undefined && db.tenant?.findUnique) {
    try {
      const tRecord = await db.tenant.findUnique({
        where: { id: tenant.id },
        select: { bankAccounts: true }
      });
      tenantBankAccounts = tRecord?.bankAccounts;
    } catch (tErr) {
      console.warn(`⚠️ [Order Security] No se pudo consultar tenant en BD:`, tErr.message);
    }
  }

  const tenantHasConfiguredPayments = Boolean(tenantBankAccounts && tenantBankAccounts.trim());

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
  const triggerStages = ['PAYMENT_PENDING', 'PAYMENT_VERIFIED', 'COMPLETED'];

  if (triggerStages.includes(updatedState.currentStage)) {
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

        if (updatedState.productId) {
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
              type: true
            }
          });
          if (verifiedProduct) {
            productPrice = getCanonicalProductPrice(verifiedProduct);
          }
        }

        const isConfirmed = Boolean(updatedState.customerConfirmed === true);
        const hasValidProduct = Boolean(verifiedProduct);
        const productType = verifiedProduct?.type || 'PHYSICAL_PRODUCT';
        const isService = productType === 'SERVICE';

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
          // 3. Exige: customerConfirmed + producto válido del tenant + método de pago real configurado
          canCreateOrder = isConfirmed && hasValidProduct && isPaymentValidForOrder;
        } else {
          // BIFURCACIÓN PHYSICAL_PRODUCT:
          // Requiere confirmación explícita + cantidad válida + destino (ciudad/dirección) + método de pago
          const hasShippingDestination = Boolean(updatedState.shippingCity || updatedState.shippingAddress);
          const hasLogistics = hasShippingDestination && isPaymentValidForOrder;
          canCreateOrder = isConfirmed && isQtyValid && hasValidProduct && hasLogistics;
        }

        if (canCreateOrder) {
          const quantity = finalQuantity;
          const total = quantity * productPrice;

          const newOrder = await db.order.create({
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
              items: {
                create: [{
                  productId: verifiedProduct.id,
                  name: verifiedProduct.name,
                  quantity: quantity,
                  price: productPrice,
                  variant: updatedState.variant || null
                }]
              }
            }
          });

          updatedState.activeOrderId = newOrder.id;

          let alertMessage = '';
          if (isService) {
            const qtyNote = quantity > 1 ? ` (${quantity} personas)` : '';
            alertMessage = `💼 SERVICIO REGISTRADO | Cliente: +${clientNumber} (${customer.name || 'Sin Nombre'}) | ${verifiedProduct.name}${qtyNote}`;
          } else {
            alertMessage = `📦 PEDIDO CREADO | Cliente: +${clientNumber} (${customer.name || 'Sin Nombre'}) | ${verifiedProduct.name} x${quantity}`;
          }

          await db.alert.create({
            data: {
              type: 'NEW_ORDER',
              severity: 'INFO',
              message: alertMessage,
              tenantId: tenant.id
            }
          });

          if (typeof onNotification === 'function') {
            await onNotification({
              type: 'NEW_ORDER',
              orderId: newOrder.id,
              total,
              quantity,
              productName: verifiedProduct.name,
              shippingCity: isService ? null : updatedState.shippingCity,
              shippingAddress: isService ? null : updatedState.shippingAddress,
              productType
            });
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
          select: { id: true, name: true, price: true, promotionalPrice: true, promoStartDate: true, promoEndDate: true, type: true }
        });

        if (!verifiedNewProduct) {
          // FIX 2: Si el productId es inválido o ajeno al tenant, ABORTAR toda la mutación de la tool call
          console.warn(`⚠️ [Order Security] Producto rechazado en orden ${orderId}: ID "${args.productId}" no existe o no pertenece al tenant ${tenant.id.slice(0, 8)}`);
          return {
            error: 'El producto solicitado no está disponible o no existe.',
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
          await onNotification({
            type: 'PAYMENT_VERIFY',
            orderId: existingOrder.id,
            total,
            quantity,
            productName: finalProductName
          });
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

    try {
      await cancelFollowUpOnOrderEvent({ tenantId: tenant.id, customerId: customer.id, order: { status: 'CANCELED' }, prismaClient: db });
    } catch (fuErr) {
      console.warn('⚠️ [Order Security] Error cancelando seguimiento en EXPLORING:', fuErr.message);
    }
  }

  // Persistir estado en el Customer
  await db.customer.update({
    where: { id: customer.id },
    data: { commercialState: updatedState }
  });

  return { success: true, state: updatedState };
}
