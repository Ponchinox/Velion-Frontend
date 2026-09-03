import prisma from '../db.js';

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

  // 1. Validación estricta de métodos de pago autorizados
  if (args.paymentMethod) {
    const rawMethod = String(args.paymentMethod).toLowerCase().trim();
    const isYape = rawMethod.includes('yape');
    const isContraentrega = rawMethod.includes('contraentrega') ||
                            rawMethod.includes('contra entrega') ||
                            rawMethod.includes('contra-entrega') ||
                            rawMethod.includes('efectivo');

    if (!isYape && !isContraentrega) {
      console.warn(`⚠️ [Order Security] Método de pago no autorizado rechazado: "${args.paymentMethod}"`);
      return {
        error: 'Método de pago no autorizado. La tienda ÚNICAMENTE acepta Yape o Contraentrega (con adelanto de flete por Shalom si es provincia). No aceptes ni guardes otros medios de pago.'
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
            select: { id: true, name: true, price: true, promotionalPrice: true, promoStartDate: true, promoEndDate: true }
          });
          if (verifiedProduct) {
            productPrice = getCanonicalProductPrice(verifiedProduct);
          }
        }

        const isConfirmed = Boolean(updatedState.customerConfirmed === true);
        const hasValidProduct = Boolean(verifiedProduct);
        const hasShippingDestination = Boolean(updatedState.shippingCity || updatedState.shippingAddress);
        const hasPaymentMethod = Boolean(updatedState.paymentMethod);
        const hasLogistics = hasShippingDestination && hasPaymentMethod;
        const canCreateOrder = isConfirmed && isQtyValid && hasValidProduct && hasLogistics;

        if (canCreateOrder) {
          const quantity = parsedQty;
          const total = quantity * productPrice;

          const newOrder = await db.order.create({
            data: {
              tenantId: tenant.id,
              customerId: customer.id,
              status: orderStatus,
              paymentStatus: payStatus,
              paymentMethod: updatedState.paymentMethod || null,
              shippingCity: updatedState.shippingCity || null,
              shippingAddress: updatedState.shippingAddress || null,
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

          await db.alert.create({
            data: {
              type: 'NEW_ORDER',
              severity: 'INFO',
              message: `📦 PEDIDO CREADO | Cliente: +${clientNumber} (${customer.name || 'Sin Nombre'}) | ${verifiedProduct.name} x${quantity}`,
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
              shippingCity: updatedState.shippingCity,
              shippingAddress: updatedState.shippingAddress
            });
          }
        } else {
          console.log(`ℹ️ [FC update_commercial_state] Draft comercial en memoria (Requisitos Order: confirmed=${isConfirmed}, qty=${isQtyValid}, prod=${hasValidProduct}, dest=${hasShippingDestination}, pay=${hasPaymentMethod}).`);
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

      const hasExplicitProductChange = Boolean(
        args.productId &&
        typeof args.productId === 'string' &&
        args.productId.trim() !== '' &&
        args.productId !== existingItem?.productId
      );

      if (hasExplicitProductChange) {
        // CASO B / C: El LLM solicita explícitamente cambiar a un productId distinto
        const verifiedNewProduct = await db.product.findFirst({
          where: {
            id: args.productId.trim(),
            user: { tenantId: tenant.id }
          },
          select: { id: true, name: true, price: true, promotionalPrice: true, promoStartDate: true, promoEndDate: true }
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
            shippingCity: updatedState.shippingCity || existingOrder.shippingCity || null,
            shippingAddress: updatedState.shippingAddress || existingOrder.shippingAddress || null,
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
  }

  // Persistir estado en el Customer
  await db.customer.update({
    where: { id: customer.id },
    data: { commercialState: updatedState }
  });

  return { success: true, state: updatedState };
}
