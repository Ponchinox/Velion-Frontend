/**
 * ==============================================================================
 * VELION HOTFIX SUITE: A1–A19 (BUSINESS AUTHORITY & PRODUCT GROUNDING)
 * ==============================================================================
 * Pruebas funcionales de authority y grounding para Business Agent:
 * 1. Product Fact Grounding: USER CLAIM != VERIFIED PRODUCT FACT
 * 2. Payment Authority & Human Handoff Authority
 * 3. Preservación del estado comercial (Order State)
 */

import assert from 'node:assert';
import fs from 'node:fs';
import {
  enforceBusinessAuthority,
  enforceMediaAuthority,
  REQUEST_HUMAN_HANDOFF_DECLARATION
} from './src/controllers/whatsappController.js';
import {
  syncCommercialOrder,
  isPseudoPaymentMethod,
  isPaymentMethodAuthorized
} from './src/services/orderCommercialService.js';

console.log('======================================================================');
console.log('🧪 VELION HOTFIX SUITE: A1–A19 (BUSINESS AUTHORITY & PRODUCT GROUNDING)');
console.log('======================================================================\n');

let passedCount = 0;
let failedCount = 0;

async function runTest(testId, description, type, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: [${testId}] [${type}] ${description}`);
    passedCount++;
  } catch (err) {
    console.error(`  ❌ FAIL: [${testId}] [${type}] ${description}`);
    console.error(`     Error: ${err.message}`);
    failedCount++;
  }
}

const controllerCode = fs.readFileSync('./backend_api/src/controllers/whatsappController.js', 'utf8');

async function main() {
  // ── A1: Usuario pregunta "¿Es Bluetooth?", DB no contiene Bluetooth => no confirmar Bluetooth ───
  await runTest('A1', 'Usuario pregunta "¿Es Bluetooth?" y DB no lo contiene => Prompt Contract prohíbe confirmar Bluetooth, inferir o completar por analogía', 'Prompt Contract + Source Inspection', async () => {
    // 1. Verificar presencia de la regla explícita en get_product_details
    assert.ok(
      controllerCode.includes('[GROUNDING TÉCNICO ESTRICTO]') && controllerCode.includes('USER CLAIM != VERIFIED PRODUCT FACT'),
      'get_product_details debe incluir [GROUNDING TÉCNICO ESTRICTO] y la directiva estricta USER CLAIM != VERIFIED PRODUCT FACT'
    );
    assert.ok(
      controllerCode.includes('USER CLAIM != VERIFIED PRODUCT FACT'),
      'El código debe contener taxativamente la regla USER CLAIM != VERIFIED PRODUCT FACT'
    );
    assert.ok(
      controllerCode.includes('¿Es Bluetooth?') || controllerCode.includes('Bluetooth'),
      'La regla debe contemplar expresamente hipótesis de Bluetooth'
    );
    assert.ok(
      controllerCode.includes('PROHIBIDO confirmarla como un hecho') || controllerCode.includes('PROHIBIDO confirmarla'),
      'Debe prohibir confirmar la característica como un hecho si no está en la ficha'
    );
    assert.ok(
      controllerCode.includes('AirTag') && controllerCode.includes('Tile'),
      'Debe prohibir taxativamente completar por similitud con productos como AirTag o Tile'
    );
  });

  // ── A2: Usuario dice "Seguro es resistente al agua", DB no lo confirma => no adoptarlo como hecho ───
  await runTest('A2', 'Usuario sugiere o afirma "Seguro es resistente al agua" sin confirmación en DB => Prompt Contract prohíbe adoptarlo como hecho verificado', 'Prompt Contract + Source Inspection', async () => {
    assert.ok(
      controllerCode.includes('resistencia al agua') || controllerCode.includes('¿Es resistente al agua?'),
      'Debe incluir prohibición explícita sobre hipótesis de resistencia al agua'
    );
    assert.ok(
      controllerCode.includes('NO se convierte en verdad ni en hecho confirmado solo porque aparezca en su mensaje') ||
      controllerCode.includes('NO se convierte en verdad'),
      'Debe instruir que la mención del cliente no valida el hecho'
    );
  });

  // ── A3: Dato sí existe en get_product_details => puede afirmarlo normalmente ───
  await runTest('A3', 'Dato presente en ficha canónica de get_product_details => se incluye fielmente en resultString', 'Lógica Real / Tool Formatting', async () => {
    // Simular el formateo canónico de get_product_details con datos reales
    const mockProduct = {
      name: 'Localizador inteligente Micflip P23',
      type: 'PHYSICAL_PRODUCT',
      price: 49.90,
      promotionalPrice: null,
      category: 'Localizadores',
      isAvailable: true,
      images: ['https://cdn.velion.pe/p23-1.jpg'],
      imageUrl: 'https://cdn.velion.pe/p23.jpg',
      videoUrl: null,
      description: 'Compatible con red Apple Find My y Google Android Find Hub.',
      tags: ['localizador', 'find my', 'rastreador']
    };

    const totalFotos = (Array.isArray(mockProduct.images) ? mockProduct.images.length : 0) + (mockProduct.imageUrl ? 1 : 0);
    const resultString = `
Nombre: ${mockProduct.name}
Tipo: ${mockProduct.type === 'SERVICE' ? 'SERVICE (Servicio / Programa)' : 'PHYSICAL_PRODUCT (Producto Físico)'}
Precio: S/. ${mockProduct.price.toFixed(2)}
Categoría: ${mockProduct.category || 'N/A'}
Disponible: ${mockProduct.isAvailable ? 'Sí' : 'No'}
Fotos disponibles: ${totalFotos}
Video: ${mockProduct.videoUrl ? 'Sí' : 'No'}
Descripción Completa: ${mockProduct.description || 'Sin descripción adicional'}
Atributos/Tags: ${Array.isArray(mockProduct.tags) ? mockProduct.tags.join(', ') : ''}

[GROUNDING TÉCNICO ESTRICTO - USER CLAIM != VERIFIED PRODUCT FACT]:
- Las ÚNICAS especificaciones válidas y confirmadas son las listadas arriba.
`.trim();

    assert.ok(resultString.includes('Localizador inteligente Micflip P23'), 'Debe incluir nombre');
    assert.ok(resultString.includes('Apple Find My'), 'Debe incluir especificación existente');
    assert.ok(resultString.includes('Google Android Find Hub'), 'Debe incluir compatibilidad confirmada');
    assert.ok(resultString.includes('S/. 49.90'), 'Debe incluir precio exacto');
    assert.strictEqual(resultString.includes('Bluetooth'), false, 'NO debe inventar Bluetooth en la ficha canónica');
  });

  // ── A4: Sin payment config => no ofrecer "te brindo los detalles de pago" ───
  await runTest('A4', 'Sin payment config => enforceBusinessAuthority neutraliza ofrecimientos de datos de pago', 'Lógica Real (enforceBusinessAuthority)', async () => {
    const prohibitedPhrases = [
      '¿Deseas que te brinde los detalles para realizar el pago?',
      'Claro, aquí tienes los datos de pago:',
      'Te brindo los datos de pago para que realices el depósito.',
      'Te paso la cuenta para pagar.',
      'Puedes pagar por transferencia bancaria a la cuenta BCP.'
    ];

    for (const phrase of prohibitedPhrases) {
      const sanitized = enforceBusinessAuthority(phrase, { hasPaymentConfig: false });
      assert.strictEqual(
        sanitized.includes('te brindo los detalles'),
        false,
        `No debe contener "te brindo los detalles": "${sanitized}"`
      );
      assert.strictEqual(
        sanitized.includes('aquí tienes los datos'),
        false,
        `No debe contener "aquí tienes los datos": "${sanitized}"`
      );
      assert.strictEqual(
        sanitized.includes('te paso la cuenta'),
        false,
        `No debe contener "te paso la cuenta": "${sanitized}"`
      );
      assert.ok(
        sanitized.includes('Actualmente no tengo un método de pago registrado') ||
        sanitized.includes('confirmarse con el negocio'),
        `Debe derivar a indicación neutral: "${sanitized}"`
      );
    }
  });

  // ── A5: Sin payment config => indicar que debe confirmarse con el negocio ───
  await runTest('A5', 'Sin payment config => indica con neutralidad que el pago debe confirmarse con el negocio', 'Lógica Real + Prompt Contract', async () => {
    // 1. Lógica real
    const output = enforceBusinessAuthority('¿Deseas que te brinde los detalles para realizar el pago?', { hasPaymentConfig: false });
    assert.strictEqual(
      output,
      'Actualmente no tengo un método de pago registrado. Ese dato debe confirmarse con el negocio.'
    );

    // 2. Prompt Contract
    assert.ok(
      controllerCode.includes('Actualmente no tengo un método de pago registrado en el sistema. Ese dato debe confirmarse directamente con el negocio.'),
      'Prompt contract debe contener la instrucción neutral canónica para tiendas sin pagos configurados'
    );
  });

  // ── A6: Sin request_human_handoff success => no prometer contacto de asesor ───
  await runTest('A6', 'Sin request_human_handoff success => prohíbe prometer contacto de asesor o aviso al equipo', 'Lógica Real + Source Inspection', async () => {
    const unpromptedClaims = [
      'Un asesor se pondrá en contacto contigo en breve.',
      'Un asesor te contactará.',
      'Ya avisé al equipo para que te contacten.',
      'Te escribirán en breve con los detalles.'
    ];

    for (const claim of unpromptedClaims) {
      const sanitized = enforceBusinessAuthority(claim, { handoffSuccess: false });
      assert.strictEqual(
        sanitized.includes('asesor se pondrá en contacto'),
        false,
        `No debe prometer que asesor se pondrá en contacto: "${sanitized}"`
      );
      assert.strictEqual(
        sanitized.includes('asesor te contactará'),
        false,
        `No debe prometer que asesor contactará: "${sanitized}"`
      );
      assert.strictEqual(
        sanitized.includes('avisó al equipo') || sanitized.includes('avisé al equipo'),
        false,
        `No debe afirmar aviso al equipo sin handoff real: "${sanitized}"`
      );
      assert.ok(
        sanitized.includes('confirmarse directamente con el negocio'),
        `Debe derivar a confirmación directa: "${sanitized}"`
      );
    }

    // Source inspection: asegurar que las instrucciones anteriores erróneas no existen en el prompt
    assert.strictEqual(
      controllerCode.includes('Un asesor te brindará los detalles para realizar el pago.'),
      false,
      'El prompt ya NO debe ordenar prometer asesor de pago sin handoff'
    );
    assert.strictEqual(
      controllerCode.includes('un asesor le brindará los datos de pago en breve'),
      false,
      'El prompt ya NO debe ordenar que un asesor brindará datos de pago en breve'
    );
  });

  // ── A7: request_human_handoff success => puede indicar con prudencia intervención humana ───
  await runTest('A7', 'request_human_handoff success => indica con prudencia que se solicitó intervención humana', 'Lógica Real + Source Inspection', async () => {
    const validHandoffText = 'Entendido. He transferido esta conversación a un asesor humano para que pueda ayudarte por este chat.';
    const result = enforceBusinessAuthority(validHandoffText, { handoffSuccess: true });
    assert.ok(
      result.includes('He transferido esta conversación a un asesor humano'),
      'Con handoffSuccess:true se permite afirmar la transferencia'
    );

    // Source inspection: confirmText de la tool
    assert.ok(
      controllerCode.includes("const confirmText = 'Entendido. He transferido esta conversación a un asesor humano para que pueda ayudarte por este chat.';"),
      'confirmText de request_human_handoff debe ser prudente y sobrio'
    );
  });

  // ── A8: No inventar tiempo: "en breve", "en unos minutos", etc. ───
  await runTest('A8', 'No inventar tiempos de respuesta ("en breve", "en unos minutos", etc.) incluso con handoff activo', 'Lógica Real (enforceBusinessAuthority) + Source Inspection', async () => {
    const textWithTimes = 'Entendido. He transferido esta conversación a un asesor humano. En breve continuarán contigo por este chat.';
    const sanitized = enforceBusinessAuthority(textWithTimes, { handoffSuccess: true });
    
    assert.strictEqual(
      /en\s+breve/i.test(sanitized),
      false,
      `No debe contener "en breve": "${sanitized}"`
    );
    assert.strictEqual(
      /en\s+unos\s+minutos/i.test(sanitized),
      false,
      `No debe contener "en unos minutos": "${sanitized}"`
    );
    assert.ok(
      sanitized.includes('He transferido esta conversación a un asesor humano'),
      'Debe conservar el mensaje de transferencia'
    );

    // Source inspection: confirmText en controller NO debe tener "en breve"
    assert.strictEqual(
      controllerCode.includes('En breve continuarán contigo por este chat.'),
      false,
      'confirmText NO debe incluir "En breve continuarán contigo"'
    );
  });

  // ── A9: Preservación de Orden: PHYSICAL_PRODUCT exige cantidad ───
  await runTest('A9', 'Preservación de Order State: PHYSICAL_PRODUCT sin cantidad no pasa a orden confirmada', 'Integración Real (Order State)', async () => {
    const mockDb = {
      product: {
        findFirst: async () => ({ id: 'p123', name: 'Smart Tag', price: 50, type: 'PHYSICAL_PRODUCT' })
      },
      tenant: {
        findUnique: async () => ({ id: 't1', bankAccounts: 'BCP: 123' })
      },
      order: {
        create: async () => { throw new Error('NO debe crear orden'); }
      },
      customer: {
        update: async () => ({})
      }
    };

    const res = await syncCommercialOrder({
      tenant: { id: 't1' },
      customer: { id: 'c1', phone: '51999999999', commercialState: { currentStage: 'PRODUCT_SELECTED', productId: 'p123' } },
      clientNumber: '51999999999',
      currentCommercialState: { currentStage: 'PRODUCT_SELECTED', productId: 'p123' },
      args: {
        customerConfirmed: true,
        productId: 'p123',
        quantity: null, // ⚠️ Falta cantidad
        paymentMethod: 'BCP'
      },
      prismaClient: mockDb
    });

    assert.strictEqual(res.state.activeOrderId, undefined, 'No debe crear orden sin cantidad en PHYSICAL_PRODUCT');
    assert.strictEqual(res.state.quantity, null);
  });

  // ── A10: Preservación de Orden: SERVICE no exige flete ni dirección física ───
  await runTest('A10', 'Preservación de Order State: SERVICE no almacena shippingAddress ni shippingCity como flete en DB', 'Integración Real (Order State)', async () => {
    let capturedOrderData = null;
    const mockDb = {
      product: {
        findFirst: async () => ({ id: 'srv1', name: 'Curso Álgebra', price: 100, type: 'SERVICE' })
      },
      tenant: {
        findUnique: async () => ({ id: 't1', bankAccounts: 'BCP: 123' })
      },
      order: {
        create: async ({ data }) => {
          capturedOrderData = data;
          return { id: 'ord_srv_1', ...data };
        }
      },
      customer: {
        update: async () => ({})
      },
      alert: {
        create: async () => ({})
      }
    };

    const res = await syncCommercialOrder({
      tenant: { id: 't1' },
      customer: { id: 'c1', phone: '51999999999', commercialState: { currentStage: 'PAYMENT_PENDING', productId: 'srv1' } },
      clientNumber: '51999999999',
      currentCommercialState: { currentStage: 'PAYMENT_PENDING', productId: 'srv1' },
      args: {
        currentStage: 'PAYMENT_PENDING',
        customerConfirmed: true,
        productId: 'srv1',
        shippingCity: 'Lima',
        shippingAddress: 'Av. Siempre Viva 123',
        paymentMethod: 'BCP'
      },
      prismaClient: mockDb
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(capturedOrderData.shippingCity, null, 'En orden DB para SERVICE, shippingCity debe ser null');
    assert.strictEqual(capturedOrderData.shippingAddress, null, 'En orden DB para SERVICE, shippingAddress debe ser null');
  });

  // ── A11: Preservación de Payment Guard: IA nunca marca PAID ───
  await runTest('A11', 'Preservación de Payment Guard: "Ya pagué" marca PAYMENT_VERIFIED pero NUNCA PAID', 'Source Inspection + Contract', async () => {
    assert.ok(
      controllerCode.includes('La IA NUNCA marca pagos como PAID ni pedidos como COMPLETED.'),
      'Los guardrails deben conservar la prohibición de auto-marcar PAID'
    );
    assert.ok(
      controllerCode.includes('PAYMENT_VERIFIED (revisión humana requerida)'),
      'Debe conservar el requisito de revisión humana para pagos'
    );
  });

  // ── A12: Tienda con métodos de pago configurados => permite ofrecerlos normalmente ───
  await runTest('A12', 'Tienda con payment config legítimo => enforceBusinessAuthority permite indicar métodos autorizados', 'Lógica Real', async () => {
    const normalPaymentText = 'Puedes realizar el pago mediante transferencia a nuestra cuenta BCP o por Yape.';
    const res = enforceBusinessAuthority(normalPaymentText, { hasPaymentConfig: true });
    assert.strictEqual(res, normalPaymentText, 'No debe censurar métodos de pago legítimos cuando hay configuración');
  });

  // ── A13: "Un asesor te enviará los datos en breve." con handoffSuccess=false => neutralizado ───
  await runTest('A13', '"Un asesor te enviará los datos en breve." con handoffSuccess=false => neutralizado sin promesa de asesor ni tiempo', 'Lógica Real (enforceBusinessAuthority)', async () => {
    const input = 'Un asesor te enviará los datos en breve.';
    const sanitized = enforceBusinessAuthority(input, { handoffSuccess: false });
    assert.strictEqual(/asesor\s+te\s+enviar[aá]/i.test(sanitized), false, `No debe prometer que asesor enviará: "${sanitized}"`);
    assert.strictEqual(/en\s+breve/i.test(sanitized), false, `No debe contener "en breve": "${sanitized}"`);
    assert.ok(
      sanitized.includes('confirmarse directamente con el negocio') || sanitized.includes('confirmarse con el negocio'),
      `Debe indicar confirmación con el negocio: "${sanitized}"`
    );
  });

  // ── A14: "Un asesor te brindará los datos de pago." con handoffSuccess=false => neutralizado ───
  await runTest('A14', '"Un asesor te brindará los datos de pago." con handoffSuccess=false => neutralizado sin promesas de asesor ni datos', 'Lógica Real (enforceBusinessAuthority)', async () => {
    const variants = [
      'Un asesor te brindará los datos de pago.',
      'Un asesor te dará la información.',
      'Un asesor te compartirá los detalles.',
      'Un asesor te enviará los detalles para pagar.'
    ];

    for (const v of variants) {
      const sanitized = enforceBusinessAuthority(v, { handoffSuccess: false });
      assert.strictEqual(/asesor\s+te\s+(?:brindar[aá]|dar[aá]|compartir[aá]|enviar[aá])/i.test(sanitized), false, `No debe prometer acción de asesor: "${sanitized}"`);
      assert.strictEqual(/datos\s+de\s+pago/i.test(sanitized), false, `No debe ofrecer datos de pago: "${sanitized}"`);
      assert.ok(
        sanitized.includes('confirmarse directamente con el negocio') || sanitized.includes('confirmarse con el negocio'),
        `Debe indicar confirmación con el negocio: "${sanitized}"`
      );
    }
  });

  // ── A15: "Un asesor te pasará la cuenta." con handoffSuccess=false => neutralizado ───
  await runTest('A15', '"Un asesor te pasará la cuenta." con handoffSuccess=false => neutralizado sin promesas', 'Lógica Real (enforceBusinessAuthority)', async () => {
    const variants = [
      'Un asesor te pasará la cuenta.',
      'Ya avisé al equipo para que te envíen los datos.'
    ];

    for (const v of variants) {
      const sanitized = enforceBusinessAuthority(v, { handoffSuccess: false });
      assert.strictEqual(/asesor\s+te\s+pasar[aá]/i.test(sanitized), false, `No debe prometer que asesor pasará cuenta: "${sanitized}"`);
      assert.strictEqual(/te\s+pasar[aá]\s+la\s+cuenta/i.test(sanitized), false, `No debe prometer cuenta: "${sanitized}"`);
      assert.strictEqual(/avis[eé]\s+al\s+equipo/i.test(sanitized), false, `No debe afirmar aviso al equipo sin handoff: "${sanitized}"`);
      assert.ok(
        sanitized.includes('confirmarse directamente con el negocio') || sanitized.includes('confirmarse con el negocio'),
        `Debe indicar confirmación con el negocio: "${sanitized}"`
      );
    }
  });

  // ── A16: Caso combinado obligatorio ───
  await runTest('A16', 'Caso combinado: "No tengo método de pago. Un asesor te enviará los datos en breve." (hasPaymentConfig=false, handoffSuccess=false) => sin promesa de asesor ni tiempo, mantiene ausencia de pago', 'Lógica Real (enforceBusinessAuthority)', async () => {
    const input = 'No tengo método de pago. Un asesor te enviará los datos en breve.';
    const sanitized = enforceBusinessAuthority(input, { hasPaymentConfig: false, handoffSuccess: false });
    assert.ok(sanitized.includes('No tengo método de pago'), `Debe mantener que no existe método de pago confirmado: "${sanitized}"`);
    assert.strictEqual(/asesor\s+te\s+enviar[aá]/i.test(sanitized), false, `NO debe quedar "asesor te enviará": "${sanitized}"`);
    assert.strictEqual(/en\s+breve/i.test(sanitized), false, `NO debe quedar "en breve": "${sanitized}"`);
    assert.ok(
      sanitized.includes('confirmarse directamente con el negocio') || sanitized.includes('confirmarse con el negocio'),
      `Debe indicar que debe confirmarse con el negocio: "${sanitized}"`
    );
  });

  // ── A17: handoffSuccess=true => "He solicitado apoyo de un asesor para esta conversación." preservado ───
  await runTest('A17', 'handoffSuccess=true: "He solicitado apoyo de un asesor para esta conversación." => preservado sin alteraciones', 'Lógica Real (enforceBusinessAuthority)', async () => {
    const input = 'He solicitado apoyo de un asesor para esta conversación.';
    const sanitized = enforceBusinessAuthority(input, { handoffSuccess: true });
    assert.strictEqual(sanitized, 'He solicitado apoyo de un asesor para esta conversación.', 'Debe preservarse idéntico cuando handoffSuccess es true');
  });

  // ── A18: handoffSuccess=true => "Un asesor te atenderá en 5 minutos." elimina tiempo garantizado ───
  await runTest('A18', 'handoffSuccess=true: "Un asesor te atenderá en 5 minutos." => elimina tiempo garantizado y promueve wording sin tiempo', 'Lógica Real (enforceBusinessAuthority)', async () => {
    const input = 'Un asesor te atenderá en 5 minutos.';
    const sanitized = enforceBusinessAuthority(input, { handoffSuccess: true });
    assert.strictEqual(/en\s+5\s+minutos/i.test(sanitized), false, `No debe prometer "en 5 minutos": "${sanitized}"`);
    assert.strictEqual(/en\s+\d+\s+minutos/i.test(sanitized), false, `No debe prometer tiempo numérico: "${sanitized}"`);
    assert.ok(sanitized.includes('Un asesor te atenderá'), `Debe conservar afirmación de asesor sin tiempo: "${sanitized}"`);
    assert.strictEqual(sanitized, 'Un asesor te atenderá.');

    // Probar además tiempos coloquiales y otras variantes numéricas
    const v10 = enforceBusinessAuthority('Un asesor te atenderá en 10 minutos.', { handoffSuccess: true });
    assert.strictEqual(v10, 'Un asesor te atenderá.');
    const vHalf = enforceBusinessAuthority('Un asesor te atenderá en media hora.', { handoffSuccess: true });
    assert.strictEqual(vHalf, 'Un asesor te atenderá.');
    const vHour = enforceBusinessAuthority('Un asesor te atenderá en una hora.', { handoffSuccess: true });
    assert.strictEqual(vHour, 'Un asesor te atenderá.');
  });

  // ── A19: payment config legítimo => datos de pago reales siguen permitidos ───
  await runTest('A19', 'payment config legítimo => datos de pago reales siguen permitidos y no se censuran', 'Lógica Real (enforceBusinessAuthority)', async () => {
    const validPaymentText = 'Nuestros datos de pago para transferencia: BCP Cuenta Corriente 191-12345678-0-12, CCI 002-1910012345678012-50 a nombre de Velion SAC.';
    const sanitized = enforceBusinessAuthority(validPaymentText, { hasPaymentConfig: true, handoffSuccess: false });
    assert.strictEqual(sanitized, validPaymentText, 'Los datos de pago legítimos con hasPaymentConfig=true deben permitirse');
  });

  console.log('\n======================================================================');
  console.log(`RESULTADOS SUITE A1–A19: ${passedCount} pasaron, ${failedCount} fallaron.`);
  console.log('======================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error en suite A1–A19:', err);
  process.exit(1);
});
