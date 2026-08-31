import assert from 'node:assert';
import prisma from './src/db.js';

console.log('======================================================================');
console.log('🧪 VELION ORDER CREATION & SAFE PAYMENT GUARD TEST SUITE');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}:`, err.message);
    throw err;
  }
}

async function main() {
  const stamp = Date.now();
  const tenantAId = `test-og-tenant-a-${stamp}`;
  const tenantBId = `test-og-tenant-b-${stamp}`;

  // 1. Crear Tenants
  const tenantA = await prisma.tenant.create({
    data: {
      id: tenantAId,
      name: `Tenant OrderGuard A ${stamp}`,
      aiEnabled: true,
      msgLimit: 1000,
    }
  });

  const tenantB = await prisma.tenant.create({
    data: {
      id: tenantBId,
      name: `Tenant OrderGuard B ${stamp}`,
      aiEnabled: true,
      msgLimit: 1000,
    }
  });

  // 2. Crear Usuarios dueños de catálogo para los tenants
  const userA = await prisma.user.create({
    data: {
      email: `owner-a-${stamp}@test.com`,
      password: 'dummy_hashed_password',
      role: 'ADMIN',
      tenantId: tenantA.id
    }
  });

  const userB = await prisma.user.create({
    data: {
      email: `owner-b-${stamp}@test.com`,
      password: 'dummy_hashed_password',
      role: 'ADMIN',
      tenantId: tenantB.id
    }
  });

  // 3. Crear Productos
  const productA = await prisma.product.create({
    data: {
      name: 'Audífonos Xiaomi Mini',
      price: 30.00,
      category: 'Audio',
      isAvailable: true,
      userId: userA.id
    }
  });

  const productB = await prisma.product.create({
    data: {
      name: 'Audífonos Lenovo Pro',
      price: 45.00,
      category: 'Audio',
      isAvailable: true,
      userId: userB.id
    }
  });

  // 4. Crear Clientes
  const phoneA = `51966${stamp.toString().slice(-6)}`;
  const customerA = await prisma.customer.create({
    data: {
      tenantId: tenantA.id,
      phone: phoneA,
      name: 'Comprador A',
      commercialState: {}
    }
  });

  try {
    // Helper simulador de la lógica interna de update_commercial_state en whatsappController
    async function simulateUpdateCommercialState({ tenant, customer, clientNumber = '51966000000', args }) {
      const currentCommercialState = (typeof customer.commercialState === 'object' && customer.commercialState !== null)
        ? customer.commercialState
        : {};

      let updatedState = { ...currentCommercialState, ...args };

      const triggerStages = ['PAYMENT_PENDING', 'PAYMENT_VERIFIED', 'COMPLETED'];
      if (triggerStages.includes(updatedState.currentStage)) {
        const orderId = updatedState.activeOrderId;

        const rawQty = updatedState.quantity;
        const parsedQty = parseInt(rawQty, 10);
        const isQtyValid = Number.isInteger(parsedQty) && parsedQty >= 1;

        let productPrice = parseFloat(updatedState.budget) || 0;
        let verifiedProduct = null;
        if (updatedState.productId) {
          verifiedProduct = await prisma.product.findFirst({
            where: {
              id: updatedState.productId,
              user: { tenantId: tenant.id }
            },
            select: { id: true, name: true, price: true, promotionalPrice: true }
          });
          if (verifiedProduct) {
            productPrice = (verifiedProduct.promotionalPrice && verifiedProduct.promotionalPrice > 0)
              ? verifiedProduct.promotionalPrice
              : verifiedProduct.price;
          }
        }

        const isConfirmed = Boolean(updatedState.customerConfirmed === true);
        const hasValidProduct = Boolean(verifiedProduct);
        const hasShippingDestination = Boolean(updatedState.shippingCity || updatedState.shippingAddress);
        const hasPaymentMethod = Boolean(updatedState.paymentMethod);
        const hasLogistics = hasShippingDestination && hasPaymentMethod;
        const canCreateOrder = isConfirmed && isQtyValid && hasValidProduct && hasLogistics;

        // ─── ESTADOS SEGUROS PARA ÓRDENES CREADAS POR IA ───
        let orderStatus = 'PENDING';
        let payStatus = 'UNPAID';
        if (updatedState.currentStage === 'PAYMENT_VERIFIED' || updatedState.currentStage === 'COMPLETED') {
          payStatus = 'VERIFYING';
        }

        if (!orderId) {
          if (canCreateOrder) {
            const quantity = parsedQty;
            const total = quantity * productPrice;

            const newOrder = await prisma.order.create({
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
                    productId: verifiedProduct?.id || updatedState.productId || null,
                    name: verifiedProduct?.name || updatedState.productName || 'Producto sin nombre',
                    quantity: quantity,
                    price: productPrice,
                    variant: updatedState.variant || null
                  }]
                }
              }
            });
            updatedState.activeOrderId = newOrder.id;

            await prisma.alert.create({
              data: {
                type: 'NEW_ORDER',
                severity: 'INFO',
                message: `📦 PEDIDO CREADO | Cliente: +${clientNumber} (${customer.name || 'Sin Nombre'}) | ${updatedState.productName || verifiedProduct?.name || 'Producto'} x${quantity}`,
                tenantId: tenant.id
              }
            });
          }
        } else {
          const quantity = isQtyValid ? parsedQty : 1;
          const total = quantity * productPrice;

          const existingOrder = await prisma.order.findUnique({
            where: { id: orderId },
            select: { status: true, paymentStatus: true }
          });

          let updateOrderStatus = existingOrder?.status || 'PENDING';
          let updatePayStatus = existingOrder?.paymentStatus || 'UNPAID';

          if (updatePayStatus !== 'PAID') {
            if (updatedState.currentStage === 'PAYMENT_VERIFIED' || updatedState.currentStage === 'COMPLETED') {
              updatePayStatus = 'VERIFYING';
            }
          }
          if (updateOrderStatus !== 'COMPLETED' && updateOrderStatus !== 'CANCELED') {
            updateOrderStatus = 'PENDING';
          }

          await prisma.order.update({
            where: { id: orderId },
            data: {
              status: updateOrderStatus,
              paymentStatus: updatePayStatus,
              paymentMethod: updatedState.paymentMethod || null,
              shippingCity: updatedState.shippingCity || null,
              shippingAddress: updatedState.shippingAddress || null,
              customerNeeds: updatedState.customerNeeds || null,
              totalAmount: total
            }
          });
          await prisma.orderItem.deleteMany({ where: { orderId: orderId } });
          await prisma.orderItem.create({
            data: {
              orderId: orderId,
              productId: verifiedProduct?.id || updatedState.productId || null,
              name: verifiedProduct?.name || updatedState.productName || 'Producto sin nombre',
              quantity: quantity,
              price: productPrice,
              variant: updatedState.variant || null
            }
          });

          if (updatedState.currentStage === 'PAYMENT_VERIFIED') {
            await prisma.alert.create({
              data: {
                type: 'PAYMENT_VERIFY',
                severity: 'HIGH',
                message: `💳 VERIFICACIÓN DE PAGO REQUERIDA | Cliente: +${clientNumber} (${customer.name || 'Sin Nombre'})`,
                tenantId: tenant.id
              }
            });
          }

          if (updatedState.currentStage === 'COMPLETED') {
            delete updatedState.activeOrderId;
          }
        }
      }

      await prisma.customer.update({
        where: { id: customer.id },
        data: { commercialState: updatedState }
      });
      return updatedState;
    }

    // ──────────────────────────────────────────────────────────────────────────
    console.log('══ TEST A: "¿Tienen Xiaomi?" -> PRODUCT_SELECTED -> NO Order, NO Alerta ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST A: Consulta de producto no crea Order ni Alerta', async () => {
      await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerA,
        args: {
          currentStage: 'PRODUCT_SELECTED',
          productId: productA.id,
          productName: productA.name,
          customerConfirmed: false
        }
      });

      const orders = await prisma.order.findMany({ where: { tenantId: tenantA.id } });
      const alerts = await prisma.alert.findMany({ where: { tenantId: tenantA.id, type: 'NEW_ORDER' } });
      assert.strictEqual(orders.length, 0, 'No debe existir ningún Order');
      assert.strictEqual(alerts.length, 0, 'No debe existir ninguna Alerta');
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST B: "¿Cuánto cuesta?" -> DETAILS_PROVIDED -> NO Order ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST B: Consulta de precio / características no crea Order', async () => {
      await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerA,
        args: {
          currentStage: 'DETAILS_PROVIDED',
          productId: productA.id,
          productName: productA.name,
          customerConfirmed: false
        }
      });

      const orders = await prisma.order.findMany({ where: { tenantId: tenantA.id } });
      assert.strictEqual(orders.length, 0, 'No debe existir Order en DETAILS_PROVIDED');
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST C: "¿Envían a Tarapoto?" -> SHIPPING_COORDINATED -> NO Order ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST C: Preguntar por ciudad y envío en SHIPPING_COORDINATED NO crea Order', async () => {
      const state = await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerA,
        args: {
          currentStage: 'SHIPPING_COORDINATED',
          productId: productA.id,
          productName: productA.name,
          shippingCity: 'Tarapoto',
          customerConfirmed: false
        }
      });

      const orders = await prisma.order.findMany({ where: { tenantId: tenantA.id } });
      assert.strictEqual(orders.length, 0, 'SHIPPING_COORDINATED no debe crear Order');
      assert.strictEqual(state.shippingCity, 'Tarapoto', 'La ciudad se conserva en commercialState borrador');
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST D: "Quiero uno" (sin método de pago) -> NO Order todavía ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST D: Intención explícita sin método de pago permanece en borrador (NO Order)', async () => {
      const state = await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerA,
        args: {
          currentStage: 'SHIPPING_COORDINATED',
          productId: productA.id,
          productName: productA.name,
          shippingCity: 'Tarapoto',
          quantity: 1,
          customerConfirmed: true
        }
      });

      const orders = await prisma.order.findMany({ where: { tenantId: tenantA.id } });
      assert.strictEqual(orders.length, 0, 'No crea Order mientras falte el método de pago');
      assert.strictEqual(state.customerConfirmed, true);
      assert.strictEqual(state.quantity, 1);
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST E: "Quiero uno para Tarapoto, pagaré con Yape" -> Order Creado + Alerta ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST E: Datos completos + confirmación explícita crea Order y emite alerta', async () => {
      const state = await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerA,
        args: {
          currentStage: 'PAYMENT_PENDING',
          productId: productA.id,
          productName: productA.name,
          quantity: 1,
          shippingCity: 'Tarapoto',
          paymentMethod: 'Yape',
          customerConfirmed: true
        }
      });

      const orders = await prisma.order.findMany({ where: { tenantId: tenantA.id }, include: { items: true } });
      const alerts = await prisma.alert.findMany({ where: { tenantId: tenantA.id, type: 'NEW_ORDER' } });

      assert.strictEqual(orders.length, 1, 'Exactamente 1 Order creado');
      assert.strictEqual(orders[0].shippingCity, 'Tarapoto');
      assert.strictEqual(orders[0].paymentMethod, 'Yape');
      assert.strictEqual(orders[0].status, 'PENDING');
      assert.strictEqual(orders[0].paymentStatus, 'UNPAID');
      assert.strictEqual(orders[0].totalAmount, 30.00);
      assert.strictEqual(orders[0].items.length, 1);
      assert.strictEqual(orders[0].items[0].quantity, 1);
      assert.strictEqual(orders[0].items[0].price, 30.00);
      assert.strictEqual(alerts.length, 1, 'Exactamente 1 Alerta NEW_ORDER creada');
      assert.strictEqual(state.activeOrderId, orders[0].id);
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST F: Cliente nunca dice cantidad -> NO asumir x1 -> NO Order ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST F: Falta de cantidad explícita (null/undefined) bloquea creación de Order', async () => {
      const customerF = await prisma.customer.create({
        data: { tenantId: tenantA.id, phone: `51955${stamp.toString().slice(-6)}`, name: 'Comprador F' }
      });

      await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerF,
        args: {
          currentStage: 'PAYMENT_PENDING',
          productId: productA.id,
          productName: productA.name,
          quantity: null,
          shippingCity: 'Lima',
          paymentMethod: 'Yape',
          customerConfirmed: true
        }
      });

      const ordersF = await prisma.order.findMany({ where: { customerId: customerF.id } });
      assert.strictEqual(ordersF.length, 0, 'No debe asumir x1 ni crear Order sin cantidad explícita');
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST G: Cliente pregunta por dos productos -> NO inventar cuál compra ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST G: Consulta comparativa sin selección ni confirmación no crea Order', async () => {
      const customerG = await prisma.customer.create({
        data: { tenantId: tenantA.id, phone: `51944${stamp.toString().slice(-6)}`, name: 'Comprador G' }
      });

      await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerG,
        args: {
          currentStage: 'EXPLORING',
          customerNeeds: 'Comparando Xiaomi vs Lenovo',
          customerConfirmed: false
        }
      });

      const ordersG = await prisma.order.findMany({ where: { customerId: customerG.id } });
      assert.strictEqual(ordersG.length, 0, 'No crea Order');
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST H: Cliente cambia de producto antes de confirmar -> NO Order fantasma ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST H: Cambiar de producto en fase borrador no deja órdenes fantasma', async () => {
      const customerH = await prisma.customer.create({
        data: { tenantId: tenantA.id, phone: `51933${stamp.toString().slice(-6)}`, name: 'Comprador H' }
      });

      await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerH,
        args: { currentStage: 'PRODUCT_SELECTED', productId: productA.id, customerConfirmed: false }
      });

      const stateH = await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerH,
        args: { currentStage: 'PRODUCT_SELECTED', productId: 'otro-prod-id', productName: 'Audífonos Pro', customerConfirmed: false }
      });

      const ordersH = await prisma.order.findMany({ where: { customerId: customerH.id } });
      assert.strictEqual(ordersH.length, 0, 'Cero órdenes creadas');
      assert.strictEqual(stateH.productName, 'Audífonos Pro');
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST I: customerConfirmed=false + SHIPPING_COORDINATED -> NO Order ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST I: customerConfirmed=false con SHIPPING_COORDINATED nunca crea Order', async () => {
      const customerI = await prisma.customer.create({
        data: { tenantId: tenantA.id, phone: `51922${stamp.toString().slice(-6)}`, name: 'Comprador I' }
      });

      await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerI,
        args: {
          currentStage: 'SHIPPING_COORDINATED',
          productId: productA.id,
          shippingCity: 'Cusco',
          quantity: 2,
          customerConfirmed: false
        }
      });

      const ordersI = await prisma.order.findMany({ where: { customerId: customerI.id } });
      assert.strictEqual(ordersI.length, 0, 'No crea Order');
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST J: customerConfirmed=true pero quantity=null -> NO Order ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST J: customerConfirmed=true con quantity null no crea Order', async () => {
      const customerJ = await prisma.customer.create({
        data: { tenantId: tenantA.id, phone: `51911${stamp.toString().slice(-6)}`, name: 'Comprador J' }
      });

      await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerJ,
        args: {
          currentStage: 'PAYMENT_PENDING',
          productId: productA.id,
          paymentMethod: 'Contraentrega',
          shippingCity: 'Arequipa',
          quantity: null,
          customerConfirmed: true
        }
      });

      const ordersJ = await prisma.order.findMany({ where: { customerId: customerJ.id } });
      assert.strictEqual(ordersJ.length, 0, 'No crea Order sin cantidad válida');
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST K: customerConfirmed=true + quantity=1 pero productId ausente -> NO Order ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST K: customerConfirmed=true sin producto verificado del tenant no crea Order', async () => {
      const customerK = await prisma.customer.create({
        data: { tenantId: tenantA.id, phone: `51900${stamp.toString().slice(-6)}`, name: 'Comprador K' }
      });

      await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerK,
        args: {
          currentStage: 'PAYMENT_PENDING',
          productId: 'non-existent-product-id',
          quantity: 1,
          paymentMethod: 'Yape',
          shippingCity: 'Trujillo',
          customerConfirmed: true
        }
      });

      const ordersK = await prisma.order.findMany({ where: { customerId: customerK.id } });
      assert.strictEqual(ordersK.length, 0, 'No crea Order si el producto no existe en el tenant');
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST L: Order ya existe / activeOrderId presente -> Actualiza sin duplicar ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST L: activeOrderId actualiza la orden existente y no crea duplicados', async () => {
      const stateBefore = await prisma.customer.findUnique({ where: { id: customerA.id } });
      const initialOrderId = stateBefore.commercialState.activeOrderId;
      assert.ok(initialOrderId !== undefined, 'Existe activeOrderId');

      await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: stateBefore,
        args: {
          currentStage: 'PAYMENT_PENDING',
          productId: productA.id,
          productName: productA.name,
          quantity: 2,
          shippingCity: 'Tarapoto',
          shippingAddress: 'Jr. San Martín 123',
          paymentMethod: 'Yape',
          customerConfirmed: true
        }
      });

      const ordersA = await prisma.order.findMany({ where: { tenantId: tenantA.id }, include: { items: true } });
      assert.strictEqual(ordersA.length, 1, 'Sigue existiendo exactamente 1 sola Orden (no se duplicó)');
      assert.strictEqual(ordersA[0].id, initialOrderId, 'Mismo orderId');
      assert.strictEqual(ordersA[0].totalAmount, 60.00, 'Monto actualizado a 2 x 30 = 60');
      assert.strictEqual(ordersA[0].shippingAddress, 'Jr. San Martín 123');
      assert.strictEqual(ordersA[0].items[0].quantity, 2);
    });

    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n══ TEST M: Tenant A nunca puede usar Product/Order de Tenant B (Multi-Tenant) ══');
    // ──────────────────────────────────────────────────────────────────────────
    await runTest('TEST M: Aislamiento estricto: Tenant A no puede crear orden con producto de Tenant B', async () => {
      const customerM = await prisma.customer.create({
        data: { tenantId: tenantA.id, phone: `51977${stamp.toString().slice(-6)}`, name: 'Comprador M' }
      });

      await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerM,
        args: {
          currentStage: 'PAYMENT_PENDING',
          productId: productB.id,
          quantity: 1,
          paymentMethod: 'Yape',
          shippingCity: 'Chiclayo',
          customerConfirmed: true
        }
      });

      const ordersM = await prisma.order.findMany({ where: { customerId: customerM.id } });
      assert.strictEqual(ordersM.length, 0, 'Tenant A no puede crear orden con producto ajeno de Tenant B');
    });

    // ==========================================================================
    // 🛡️ SUITE DE PAGO SEGURO Y LOGÍSTICA ESTRICTA (TESTS P1 - P9)
    // ==========================================================================

    console.log('\n══ TEST P1: Cliente dice "ya pagué" -> PAYMENT_VERIFIED -> paymentStatus VERIFYING (NO PAID) ══');
    await runTest('TEST P1: Declaración de pago queda en VERIFYING (nunca PAID por IA)', async () => {
      const customerP1 = await prisma.customer.create({
        data: { tenantId: tenantA.id, phone: `51981${stamp.toString().slice(-6)}`, name: 'Comprador P1' }
      });

      const stateP1 = await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerP1,
        args: {
          currentStage: 'PAYMENT_VERIFIED',
          productId: productA.id,
          productName: productA.name,
          quantity: 1,
          shippingCity: 'Piura',
          paymentMethod: 'Yape',
          customerConfirmed: true
        }
      });

      const orderP1 = await prisma.order.findUnique({ where: { id: stateP1.activeOrderId } });
      assert.ok(orderP1, 'Orden debe existir');
      assert.strictEqual(orderP1.paymentStatus, 'VERIFYING', 'paymentStatus debe ser VERIFYING');
      assert.notStrictEqual(orderP1.paymentStatus, 'PAID', 'NUNCA debe ser PAID');
      assert.strictEqual(orderP1.status, 'PENDING', 'status debe ser PENDING');
    });

    console.log('\n══ TEST P2: Gemini intenta PAYMENT_VERIFIED -> backend NO marca PAID ══');
    await runTest('TEST P2: Intento de autoverificación por IA no produce estado PAID', async () => {
      const customerP2 = await prisma.customer.create({
        data: { tenantId: tenantA.id, phone: `51982${stamp.toString().slice(-6)}`, name: 'Comprador P2' }
      });

      const stateP2 = await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerP2,
        args: {
          currentStage: 'PAYMENT_VERIFIED',
          productId: productA.id,
          quantity: 1,
          shippingAddress: 'Av. Grau 456',
          paymentMethod: 'Yape',
          customerConfirmed: true
        }
      });

      const orderP2 = await prisma.order.findUnique({ where: { id: stateP2.activeOrderId } });
      assert.strictEqual(orderP2.paymentStatus, 'VERIFYING');
      assert.strictEqual(orderP2.status, 'PENDING');
    });

    console.log('\n══ TEST P3: Gemini intenta COMPLETED -> backend NO marca COMPLETED ni PAID ══');
    await runTest('TEST P3: Gemini en COMPLETED no puede completar financieramente el Order', async () => {
      const customerP3 = await prisma.customer.create({
        data: { tenantId: tenantA.id, phone: `51983${stamp.toString().slice(-6)}`, name: 'Comprador P3' }
      });

      const stateP3 = await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerP3,
        args: {
          currentStage: 'COMPLETED',
          productId: productA.id,
          quantity: 1,
          shippingCity: 'Iquitos',
          paymentMethod: 'Yape',
          customerConfirmed: true
        }
      });

      const ordersP3 = await prisma.order.findMany({ where: { customerId: customerP3.id } });
      assert.strictEqual(ordersP3.length, 1);
      assert.strictEqual(ordersP3[0].status, 'PENDING', 'status debe permanecer PENDING, no COMPLETED');
      assert.strictEqual(ordersP3[0].paymentStatus, 'VERIFYING', 'paymentStatus debe ser VERIFYING, no PAID');
      assert.strictEqual(stateP3.currentStage, 'COMPLETED', 'commercialState conserva el stage conversacional');
    });

    console.log('\n══ TEST P4: Order nuevo siempre empieza en estado de pago seguro ══');
    await runTest('TEST P4: Nuevo Order solo nace en PENDING+UNPAID o PENDING+VERIFYING', async () => {
      const customerP4 = await prisma.customer.create({
        data: { tenantId: tenantA.id, phone: `51984${stamp.toString().slice(-6)}`, name: 'Comprador P4' }
      });

      const stateP4 = await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerP4,
        args: {
          currentStage: 'PAYMENT_PENDING',
          productId: productA.id,
          quantity: 1,
          shippingCity: 'Pucallpa',
          paymentMethod: 'Contraentrega',
          customerConfirmed: true
        }
      });

      const orderP4 = await prisma.order.findUnique({ where: { id: stateP4.activeOrderId } });
      assert.strictEqual(orderP4.status, 'PENDING');
      assert.strictEqual(orderP4.paymentStatus, 'UNPAID');
    });

    console.log('\n══ TEST P5: shippingCity presente pero paymentMethod ausente -> NO Order ══');
    await runTest('TEST P5: Ciudad sin método de pago bloquea la creación de Order (hasLogistics=false)', async () => {
      const customerP5 = await prisma.customer.create({
        data: { tenantId: tenantA.id, phone: `51985${stamp.toString().slice(-6)}`, name: 'Comprador P5' }
      });

      await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerP5,
        args: {
          currentStage: 'PAYMENT_PENDING',
          productId: productA.id,
          quantity: 1,
          shippingCity: 'Tarapoto',
          paymentMethod: null, // ⚠️ Falta método de pago
          customerConfirmed: true
        }
      });

      const ordersP5 = await prisma.order.findMany({ where: { customerId: customerP5.id } });
      assert.strictEqual(ordersP5.length, 0, 'No debe crear Order sin método de pago');
    });

    console.log('\n══ TEST P6: paymentMethod presente pero sin shippingCity/shippingAddress -> NO Order ══');
    await runTest('TEST P6: Método de pago sin destino de entrega bloquea creación de Order', async () => {
      const customerP6 = await prisma.customer.create({
        data: { tenantId: tenantA.id, phone: `51986${stamp.toString().slice(-6)}`, name: 'Comprador P6' }
      });

      await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerP6,
        args: {
          currentStage: 'PAYMENT_PENDING',
          productId: productA.id,
          quantity: 1,
          shippingCity: null, // ⚠️ Falta ciudad
          shippingAddress: null, // ⚠️ Falta dirección
          paymentMethod: 'Yape',
          customerConfirmed: true
        }
      });

      const ordersP6 = await prisma.order.findMany({ where: { customerId: customerP6.id } });
      assert.strictEqual(ordersP6.length, 0, 'No debe crear Order sin destino de entrega');
    });

    console.log('\n══ TEST P7: shipping destination + paymentMethod + producto + qty + confirmed -> SÍ Order ══');
    await runTest('TEST P7: Todos los requisitos logísticos y comerciales satisfechos crea Order', async () => {
      const customerP7 = await prisma.customer.create({
        data: { tenantId: tenantA.id, phone: `51987${stamp.toString().slice(-6)}`, name: 'Comprador P7' }
      });

      const stateP7 = await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: customerP7,
        args: {
          currentStage: 'PAYMENT_PENDING',
          productId: productA.id,
          quantity: 3,
          shippingAddress: 'Calle Las Flores 789',
          paymentMethod: 'Contraentrega',
          customerConfirmed: true
        }
      });

      const ordersP7 = await prisma.order.findMany({ where: { customerId: customerP7.id } });
      assert.strictEqual(ordersP7.length, 1);
      assert.strictEqual(ordersP7[0].id, stateP7.activeOrderId);
      assert.strictEqual(ordersP7[0].totalAmount, 90.00);
      assert.strictEqual(ordersP7[0].paymentStatus, 'UNPAID');
    });

    console.log('\n══ TEST P8: activeOrderId existente + Gemini intenta COMPLETED -> No altera PAID/COMPLETED ══');
    await runTest('TEST P8: Actualización por IA no puede forzar status COMPLETED en orden existente', async () => {
      const stateBeforeP8 = await prisma.customer.findUnique({ where: { id: customerA.id } });
      const orderIdP8 = stateBeforeP8.commercialState.activeOrderId;
      assert.ok(orderIdP8, 'Debe haber activeOrderId');

      await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: stateBeforeP8,
        args: {
          currentStage: 'COMPLETED',
          productId: productA.id,
          quantity: 2,
          shippingCity: 'Tarapoto',
          paymentMethod: 'Yape',
          customerConfirmed: true
        }
      });

      const updatedOrderP8 = await prisma.order.findUnique({ where: { id: orderIdP8 } });
      assert.strictEqual(updatedOrderP8.status, 'PENDING', 'status no puede pasar a COMPLETED por IA');
      assert.strictEqual(updatedOrderP8.paymentStatus, 'VERIFYING', 'paymentStatus pasa a VERIFYING, no PAID');
    });

    console.log('\n══ TEST P9: Acción humana autorizada de verificación -> SÍ puede marcar PAID/COMPLETED ══');
    await runTest('TEST P9: Ruta administrativa humana preserva la facultad de marcar PAID y COMPLETED', async () => {
      const stateP9 = await prisma.customer.findUnique({ where: { id: customerA.id } });
      const orderIdP9 = (await prisma.order.findFirst({ where: { customerId: customerA.id } })).id;

      // El comerciante verifica el comprobante manualmente en el Dashboard
      const manualUpdatedOrder = await prisma.order.update({
        where: { id: orderIdP9 },
        data: {
          paymentStatus: 'PAID',
          status: 'COMPLETED'
        }
      });

      assert.strictEqual(manualUpdatedOrder.paymentStatus, 'PAID');
      assert.strictEqual(manualUpdatedOrder.status, 'COMPLETED');

      // Si Gemini vuelve a interactuar posteriormente, NO destruye el status PAID fijado por el humano
      await simulateUpdateCommercialState({
        tenant: tenantA,
        customer: stateP9,
        args: {
          currentStage: 'COMPLETED',
          productId: productA.id,
          quantity: 2,
          shippingCity: 'Tarapoto',
          paymentMethod: 'Yape',
          customerConfirmed: true
        }
      });

      const preservedOrder = await prisma.order.findUnique({ where: { id: orderIdP9 } });
      assert.strictEqual(preservedOrder.paymentStatus, 'PAID', 'Estado PAID humano preservado');
      assert.strictEqual(preservedOrder.status, 'COMPLETED', 'Estado COMPLETED humano preservado');
    });

  } finally {
    // Limpieza
    try {
      await prisma.orderItem.deleteMany({ where: { order: { tenantId: { in: [tenantA.id, tenantB.id] } } } });
      await prisma.order.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
      await prisma.alert.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
      await prisma.product.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
      await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
      await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    } catch {}
  }

  console.log('\n======================================================================');
  console.log(`📊 RESULTADO FINAL: ${passedTests}/${totalTests} TESTS COMPLETADOS CON ÉXITO`);
  console.log('======================================================================');
}

main().catch(err => {
  console.error('Fatal error running suite:', err);
  process.exit(1);
});
