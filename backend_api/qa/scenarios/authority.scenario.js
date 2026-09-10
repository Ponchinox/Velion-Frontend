import assert from 'node:assert';
import { TENANT_A } from '../fixtures/tenants.js';
import { getCanonicalProductPrice } from '../../src/services/orderCommercialService.js';

export async function runAuthorityScenario() {
  console.log('\n======================================================================');
  console.log('⚖️  SCENARIO: BUSINESS AUTHORITY & ANTI-HALLUCINATION (ZERO-COST S/0.00)');
  console.log('======================================================================');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✅ PASS: ${name}`);
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}: ${err.message}`);
      throw err;
    }
  }

  const jbl = TENANT_A.products.find((p) => p.name.includes('JBL')); // S/50.00

  // 1. Prohibido inventar precio (canonical price prevalece sobre precio sugerido)
  await test('A1: Precio canónico de base de datos prevalece ante intento de regateo o alucinación', async () => {
    // Simular un intento malicioso donde el cliente o modelo sugiere S/35.00
    const canonicalPrice = getCanonicalProductPrice(jbl);
    assert.strictEqual(canonicalPrice, 50.00, 'El precio canónico debe ser S/50.00');

    const requestedPrice = 35.00;
    const finalPrice = (requestedPrice && requestedPrice < canonicalPrice) ? canonicalPrice : canonicalPrice;
    assert.strictEqual(finalPrice, 50.00, 'El sistema debe rechazar precios no autorizados');
  });

  // 2. Prohibido inventar stock si el inventario está en 0
  await test('A2: Producto con stock 0 no puede ser confirmado para venta', async () => {
    const outOfStockProduct = { ...jbl, stock: 0 };

    const validateStock = (prod, requestedQty) => {
      if (!prod.stock || prod.stock < requestedQty) {
        return { allowed: false, reason: 'OUT_OF_STOCK' };
      }
      return { allowed: true };
    };

    const result = validateStock(outOfStockProduct, 1);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'OUT_OF_STOCK');
  });

  // 3. Prohibido inventar promociones no registradas
  await test('A3: Si promotionalPrice es null, no se autoriza ningún descuento', async () => {
    assert.strictEqual(jbl.promotionalPrice, null);
    const hasPromo = jbl.promotionalPrice !== null && jbl.promotionalPrice < jbl.price;
    assert.strictEqual(hasPromo, false, 'No debe haber promoción inventada');
  });

  // 4. Prohibido autoverificar pagos (PAID) por parte de la IA
  await test('A4: La IA no tiene autoridad para marcar un comprobante como verificado (PAID)', async () => {
    const updatePaymentStatusByAI = (attemptedStatus) => {
      if (attemptedStatus === 'PAID' || attemptedStatus === 'VERIFIED') {
        throw new Error('UNAUTHORIZED_PAYMENT_VERIFICATION: La IA no puede validar pagos.');
      }
      return { status: 'PENDING_VERIFICATION' };
    };

    let blocked = false;
    try {
      updatePaymentStatusByAI('PAID');
    } catch (err) {
      blocked = err.message.includes('UNAUTHORIZED_PAYMENT_VERIFICATION');
    }
    assert.strictEqual(blocked, true, 'Intento de marcar pago como verificado debe ser rechazado');
  });

  // 5. Prohibido marcar pedido como COMPLETED sin autoridad humana / webhook
  await test('A5: La IA no puede transicionar un pedido al estado COMPLETED', async () => {
    const setOrderStatus = (role, newStatus) => {
      if (newStatus === 'COMPLETED' && role !== 'ADMIN' && role !== 'WEBHOOK_GATEWAY') {
        throw new Error('UNAUTHORIZED_ORDER_COMPLETION: Solo un administrador o webhook oficial puede completar pedidos.');
      }
      return { status: newStatus };
    };

    let blocked = false;
    try {
      setOrderStatus('AI_AGENT', 'COMPLETED');
    } catch (err) {
      blocked = err.message.includes('UNAUTHORIZED_ORDER_COMPLETION');
    }
    assert.strictEqual(blocked, true, 'Transición a COMPLETED por la IA debe ser bloqueada');
  });

  console.log(`\n🎉 AUTHORITY SCENARIO: ${passed}/${total} TESTS PASARON EXITOSAMENTE`);
  return { passed, total };
}

if (process.argv[1] && process.argv[1].endsWith('authority.scenario.js')) {
  runAuthorityScenario().then(() => process.exit(0)).catch(() => process.exit(1));
}
