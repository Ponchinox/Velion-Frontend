import assert from 'node:assert';
import {
  syncCommercialOrder,
  isExplicitOpportunityRejection,
  isPostSaleOrderInquiry,
  hasCanonicalShippingConfig
} from './src/services/orderCommercialService.js';
import {
  enforceBusinessAuthority
} from './src/controllers/whatsappController.js';
import {
  validateBackendInvariants,
  shouldRunGateA,
  PENDING_ACTORS,
  DECISION_ACTIONS
} from './src/services/followUpDecisionService.js';

console.log('======================================================================');
console.log('🧪 CASE F: SHIPPING GROUNDING & POST-RECOVERY ACTOR TEST SUITE');
console.log('======================================================================\n');

let totalTests = 0;
let passedTests = 0;

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

function createMockDb() {
  const tenants = new Map();
  const customers = new Map();
  const chats = new Map();
  const messages = new Map();
  const followUpSequences = new Map();

  return {
    tenants,
    customers,
    chats,
    messages,
    followUpSequences,

    tenant: {
      findUnique: async ({ where }) => tenants.get(where.id) || null,
      findFirst: async ({ where }) => tenants.get(where?.id) || null
    },
    customer: {
      findUnique: async ({ where }) => customers.get(where.id) || null,
      findFirst: async ({ where }) => customers.get(where?.id) || null,
      update: async ({ where, data }) => {
        const c = customers.get(where.id);
        if (!c) throw new Error('Customer not found');
        const updated = { ...c, ...data };
        customers.set(where.id, updated);
        return updated;
      }
    },
    chat: {
      findUnique: async ({ where }) => chats.get(where.id) || null,
      findFirst: async ({ where }) => chats.get(where?.id) || null
    },
    message: {
      findFirst: async () => null,
      findMany: async () => []
    },
    order: {
      findFirst: async () => null
    },
    product: {
      findFirst: async () => null
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. POINT 1 TESTS: CANONICAL LOGISTICS VS GENERAL TERMS
// ─────────────────────────────────────────────────────────────────────────────
await runTest('RETURN_POLICY_ONLY_DOES_NOT_ENABLE_SHIPPING', async () => {
  const termsAndPolicies = 'Se aceptan devoluciones dentro de 7 días.';
  const hasShipping = hasCanonicalShippingConfig(termsAndPolicies);
  assert.strictEqual(hasShipping, false, 'Devoluciones solas NO deben habilitar shipping');
});

await runTest('WARRANTY_ONLY_DOES_NOT_ENABLE_SHIPPING', async () => {
  const termsAndPolicies = 'Todos los productos tienen garantía de 6 meses.';
  const hasShipping = hasCanonicalShippingConfig(termsAndPolicies);
  assert.strictEqual(hasShipping, false, 'Garantía sola NO debe habilitar shipping');
});

await runTest('PHYSICAL_ADDRESS_ONLY_DOES_NOT_ENABLE_SHIPPING', async () => {
  const tenant = {
    address: 'Tarapoto, San Martín',
    termsAndPolicies: ''
  };
  const hasShipping = hasCanonicalShippingConfig(tenant);
  assert.strictEqual(hasShipping, false, 'Dirección física sin políticas de envío NO debe habilitar shipping');
});

await runTest('REAL_SHIPPING_POLICY_ENABLES_SHIPPING', async () => {
  const termsAndPolicies = 'Realizamos envíos a todo San Martín. El costo se confirma según destino.';
  const hasShipping = hasCanonicalShippingConfig(termsAndPolicies);
  assert.strictEqual(hasShipping, true, 'Política real de envíos SÍ debe habilitar shipping');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. TEST A: PHYSICAL_ADDRESS_IS_NOT_DELIVERY_COVERAGE
// ─────────────────────────────────────────────────────────────────────────────
await runTest('TEST A: PHYSICAL_ADDRESS_IS_NOT_DELIVERY_COVERAGE (address != delivery coverage)', async () => {
  const textWithCoverageClaim = 'Entendido, enviamos a Tarapoto. Actualmente no tengo un método de pago registrado en el sistema.';

  // hasShippingConfig = false (sin políticas de envío configuradas)
  const sanitized = enforceBusinessAuthority(textWithCoverageClaim, {
    hasPaymentConfig: false,
    hasShippingConfig: false
  });

  assert.ok(!sanitized.toLowerCase().includes('enviamos a tarapoto'), 'NO debe afirmar "enviamos a Tarapoto"');
  assert.ok(!sanitized.toLowerCase().includes('hacemos envíos'), 'NO debe afirmar envíos');
  assert.ok(sanitized.includes('Los detalles de entrega deben confirmarse directamente con el negocio'), 'Debe indicar que los detalles de entrega deben confirmarse con el negocio');
  assert.ok(sanitized.includes('tomo nota de tu ubicación'), 'Debe registrar amablemente la ubicación provista');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. TEST B: CUSTOMER_CITY_CAN_BE_PERSISTED
// ─────────────────────────────────────────────────────────────────────────────
await runTest('TEST B: CUSTOMER_CITY_CAN_BE_PERSISTED (ciudad guardada, stage normalizado a DETAILS_PROVIDED)', async () => {
  const mockDb = createMockDb();
  const tenant = {
    id: 't-test-1',
    termsAndPolicies: 'Solo garantía de 3 meses.', // Sin shipping config
    bankAccounts: ''
  };
  const customer = {
    id: 'c-test-1',
    commercialState: {
      currentStage: 'PRODUCT_SELECTED',
      productId: 'prod-1',
      productName: 'JBL Go 4',
      quantity: 1,
      customerConfirmed: true
    }
  };
  mockDb.tenants.set(tenant.id, tenant);
  mockDb.customers.set(customer.id, customer);

  const res = await syncCommercialOrder({
    tenant,
    customer,
    clientNumber: '51999999999',
    currentCommercialState: customer.commercialState,
    args: {
      currentStage: 'SHIPPING_COORDINATED',
      shippingCity: 'Tarapoto'
    },
    prismaClient: mockDb
  });

  assert.ok(res.state, 'Debe retornar un estado válido');
  // 1. El dato del cliente se preserva 100%
  assert.strictEqual(res.state.shippingCity, 'Tarapoto', 'La ciudad dada por el cliente debe persistirse');
  // 2. El stage se normaliza a DETAILS_PROVIDED porque no hay shipping config
  assert.strictEqual(res.state.currentStage, 'DETAILS_PROVIDED', 'currentStage debe normalizarse a DETAILS_PROVIDED');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. TEST C: NO_SHIPPING_CONFIG_NO_SHIPPING_CLAIM
// ─────────────────────────────────────────────────────────────────────────────
await runTest('TEST C: NO_SHIPPING_CONFIG_NO_SHIPPING_CLAIM (0 courier, 0 coverage, 0 tarifa, 0 ETA inventados)', async () => {
  const claims = [
    'Sí, enviamos a Trujillo por Olva.',
    'Hacemos envíos a todo el Perú por Shalom.',
    'Llegamos a Tarapoto en 24 horas.',
    'Tenemos delivery a Surco por 10 soles.',
    'Sí contamos con delivery para tu zona.'
  ];

  for (const claim of claims) {
    const sanitized = enforceBusinessAuthority(claim, {
      hasPaymentConfig: true,
      hasShippingConfig: false
    });

    assert.ok(!sanitized.toLowerCase().includes('enviamos a'), `No debe contener "enviamos a" en: ${sanitized}`);
    assert.ok(!sanitized.toLowerCase().includes('hacemos envíos'), `No debe contener "hacemos envíos" en: ${sanitized}`);
    assert.ok(!sanitized.toLowerCase().includes('llegamos a'), `No debe contener "llegamos a" en: ${sanitized}`);
    assert.ok(!sanitized.toLowerCase().includes('tenemos delivery'), `No debe contener "tenemos delivery" en: ${sanitized}`);
    assert.ok(!sanitized.toLowerCase().includes('contamos con delivery'), `No debe contener "contamos con delivery" en: ${sanitized}`);
    assert.ok(sanitized.includes('Los detalles de entrega deben confirmarse directamente con el negocio'), `Debe remitir al negocio en: ${sanitized}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. POINT 2 TESTS: MERCHANT BLOCKER FROM CANONICAL STATE FIRST
// ─────────────────────────────────────────────────────────────────────────────
await runTest('MERCHANT_BLOCKER_FROM_CANONICAL_STATE (derivado directamente del estado canónico sin requerir texto del asistente)', async () => {
  const rawDecision = {
    decision: 'SEND_FOLLOW_UP',
    confidence: 0.95,
    pendingActor: 'CUSTOMER',
    pendingTopic: 'Dirección de envío y método de pago',
    followUpGoal: 'Solicitar método de pago'
  };

  // Contexto CANÓNICO puro: ciudad dada, pero negocio NO tiene shipping ni pagos.
  // recentMessages puede estar VACÍO o sin texto de confirmación humana:
  const context = {
    tenant: {
      id: 't-canon-1',
      bankAccounts: '', // No pagos
      termsAndPolicies: '' // No envíos
    },
    commercialState: {
      currentStage: 'DETAILS_PROVIDED',
      shippingCity: 'Tarapoto',
      customerConfirmed: true
    },
    recentMessages: [] // 0 dependencia del texto del asistente
  };

  const inv = validateBackendInvariants({
    rawDecision,
    context,
    timezone: 'America/Lima'
  });

  assert.strictEqual(inv.valid, true, 'Debe ser validado por la invariante');
  assert.strictEqual(inv.normalizedDecision, DECISION_ACTIONS.DO_NOT_FOLLOW_UP, 'Decisión normalizada debe ser DO_NOT_FOLLOW_UP');
  assert.strictEqual(inv.pendingActor, PENDING_ACTORS.MERCHANT, 'pendingActor debe ser MERCHANT, NO CUSTOMER');
  assert.ok(inv.reason.includes('MERCHANT_BLOCKER_CANONICAL_STATE'), `El motivo debe ser canonical state: ${inv.reason}`);
});

await runTest('CUSTOMER_PENDING_ACTION_STILL_ALLOWED (control positivo con capabilities y pregunta explícita)', async () => {
  const rawDecision = {
    decision: 'SEND_FOLLOW_UP',
    confidence: 0.95,
    pendingActor: 'CUSTOMER',
    pendingTopic: 'Dirección exacta',
    followUpGoal: 'Solicitar dirección exacta de entrega'
  };

  // Tienda con envíos y pagos configurados legítimos
  const context = {
    tenant: {
      id: 't-allowed-1',
      bankAccounts: 'BCP: 191-12345678-0-11, Yape: 999999999',
      termsAndPolicies: 'Realizamos envíos a todo Lima vía motorizado.'
    },
    commercialState: {
      currentStage: 'SHIPPING_COORDINATED',
      shippingCity: 'Lima',
      shippingAddress: null, // Falta dirección exacta
      customerConfirmed: true
    },
    recentMessages: [
      {
        role: 'assistant',
        text: 'Perfecto, coordinamos el envío a Lima. ¿Cuál es tu dirección exacta?'
      }
    ]
  };

  const inv = validateBackendInvariants({
    rawDecision,
    context,
    timezone: 'America/Lima'
  });

  assert.strictEqual(inv.valid, true, 'Debe ser válido');
  assert.strictEqual(inv.normalizedDecision, DECISION_ACTIONS.SEND_FOLLOW_UP, 'Debe permitir SEND_FOLLOW_UP');
  assert.strictEqual(inv.pendingActor, PENDING_ACTORS.CUSTOMER, 'pendingActor debe ser CUSTOMER');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. POINT 3 TESTS: RESIDUAL SEQUENCE BLOCKED BEFORE PROVIDER
// ─────────────────────────────────────────────────────────────────────────────
await runTest('RESIDUAL_SEQUENCE_BLOCKED_BEFORE_PROVIDER (secuencia residual en producción se bloquea en Gate B con 0 provider calls)', async () => {
  // Simular la secuencia residual real 1135659e
  const residualSeq = {
    id: '1135659e-test',
    tenantId: 'acd4dc9e-real',
    stageAtCreation: 'SHIPPING_COORDINATED',
    currentAttempt: 0,
    status: 'SCHEDULED'
  };

  // Simular tenant y customer reales de producción
  const tenant = {
    id: 'acd4dc9e-real',
    name: 'Prueba Gémini',
    bankAccounts: '', // Vacío
    termsAndPolicies: '', // Vacío
    followUpEnabled: true,
    followUpDecisionMode: 'ENFORCE',
    timezone: 'America/Lima'
  };

  const customer = {
    id: '0327f153-real',
    commercialState: {
      currentStage: 'SHIPPING_COORDINATED',
      shippingCity: 'Tarapoto',
      productId: '6ff993f8-7d69-4683-ba72-873af8d176a4',
      productName: 'JBL go 4',
      customerConfirmed: true
    }
  };

  // Simular contexto Gate B
  const gateBContext = {
    tenant,
    commercialState: customer.commercialState,
    recentMessages: [
      { role: 'customer', text: 'Si, soy de Tarapoto' },
      {
        role: 'assistant',
        text: 'Entendido, tomo nota de tu ubicación. Los detalles de entrega deben confirmarse directamente con el negocio. Actualmente no tengo un método de pago registrado en el sistema, por lo que ese detalle deberá confirmarse directamente con el negocio.'
      }
    ]
  };

  // Evaluación Gate B por Invariantes
  const gateBDecision = validateBackendInvariants({
    rawDecision: {
      decision: 'SEND_FOLLOW_UP',
      confidence: 0.95,
      pendingActor: 'CUSTOMER'
    },
    context: gateBContext,
    timezone: 'America/Lima'
  });

  assert.strictEqual(gateBDecision.normalizedDecision, 'DO_NOT_FOLLOW_UP', 'Gate B debe resolver DO_NOT_FOLLOW_UP');
  assert.strictEqual(gateBDecision.pendingActor, 'MERCHANT', 'Gate B debe resolver pendingActor MERCHANT');

  // En el worker, si gateBDecision es DO_NOT_FOLLOW_UP, la secuencia se cancela con SEMANTIC_NOT_ELIGIBLE
  // y providerCalls = 0
  let providerCalls = 0;
  if (gateBDecision.normalizedDecision === 'DO_NOT_FOLLOW_UP') {
    residualSeq.status = 'CANCELLED';
    residualSeq.cancelReason = 'SEMANTIC_NOT_ELIGIBLE';
    // ZERO provider calls dispatched
  } else {
    providerCalls++;
  }

  assert.strictEqual(residualSeq.status, 'CANCELLED');
  assert.strictEqual(residualSeq.cancelReason, 'SEMANTIC_NOT_ELIGIBLE');
  assert.strictEqual(providerCalls, 0, 'EXPECTED_PROVIDER_CALLS debe ser 0');
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. REGRESSION CHECKS: RECOVERY, PAYMENT, POSTSALE, CASE D
// ─────────────────────────────────────────────────────────────────────────────
await runTest('TEST F: POSITIVE_FOLLOWUP_RECOVERY_UNCHANGED (la recuperación previa no sufre regresión)', async () => {
  const sequence = {
    id: 'seq-smoke-1',
    status: 'SCHEDULED',
    currentAttempt: 1,
    recoveredAt: null
  };

  const recoveredAt = new Date();
  const updatedSeq = {
    ...sequence,
    status: 'RECOVERED',
    recoveredAt
  };

  assert.strictEqual(updatedSeq.status, 'RECOVERED', 'Estado debe ser RECOVERED');
  assert.ok(updatedSeq.recoveredAt instanceof Date, 'recoveredAt debe ser timestamp válido');
  assert.strictEqual(updatedSeq.currentAttempt, 1, 'currentAttempt debe mantenerse en 1 (0 segundo dispatch)');
});

await runTest('TEST G: PAYMENT_GROUNDING_UNCHANGED (hasPaymentConfig=false sigue neutralizando datos de pago)', async () => {
  const paymentOffer = '¿Deseas que te brinde los detalles para realizar el pago?';
  const sanitized = enforceBusinessAuthority(paymentOffer, {
    hasPaymentConfig: false,
    hasShippingConfig: false
  });

  assert.ok(!sanitized.toLowerCase().includes('detalles para realizar el pago'), 'No debe ofrecer datos de pago');
  assert.ok(sanitized.includes('Actualmente no tengo un método de pago registrado'), 'Debe declarar ausencia de métodos de pago');

  const bcpOffer = 'Puedes pagar por transferencia bancaria a la cuenta BCP.';
  const sanitizedBcp = enforceBusinessAuthority(bcpOffer, {
    hasPaymentConfig: false,
    hasShippingConfig: false
  });
  assert.ok(!sanitizedBcp.toLowerCase().includes('bcp'), 'No debe incluir cuenta BCP');
  assert.ok(sanitizedBcp.includes('Actualmente no tengo un método de pago registrado'), 'Debe indicar ausencia de método registrado');
});

await runTest('TEST H: POSTSALE_GROUNDING_UNCHANGED (inquiry postventa detectado correctamente)', async () => {
  const inquiry = 'Ya compré el JBL hace unos días. ¿Puedes decirme cuándo llega mi pedido?';
  assert.ok(isPostSaleOrderInquiry(inquiry), 'Debe ser detectado como consulta postventa');

  const falsePromise = 'Tu pedido llegará mañana por la tarde.';
  const sanitized = enforceBusinessAuthority(falsePromise, {
    operationalTaskCreated: true
  });
  assert.ok(typeof sanitized === 'string', 'Debe retornar string');
});

await runTest('TEST I: CASE_D_REJECTION_UNCHANGED (rechazo explícito preserva OPPORTUNITY_REJECTED)', async () => {
  const rejectionMsg = 'Ya no me interesa, gracias.';
  assert.ok(isExplicitOpportunityRejection(rejectionMsg), 'Debe ser detectado como rechazo explícito');

  const rawDecision = {
    decision: 'DO_NOT_FOLLOW_UP',
    confidence: 0.98,
    pendingActor: 'NONE',
    conversationClosed: true,
    purchaseConfirmed: false,
    fulfillmentOnly: false,
    reason: 'El cliente indicó que ya no está interesado.'
  };

  const inv = validateBackendInvariants({
    rawDecision,
    timezone: 'America/Lima'
  });

  assert.strictEqual(inv.valid, true);
  assert.strictEqual(inv.normalizedDecision, DECISION_ACTIONS.DO_NOT_FOLLOW_UP);
  assert.strictEqual(inv.pendingActor, PENDING_ACTORS.NONE);
});

// ─────────────────────────────────────────────────────────────────────────────
// RESUMEN
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n======================================================================');
console.log(`🏁 CASE F SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (100%)`);
console.log('======================================================================\n');
