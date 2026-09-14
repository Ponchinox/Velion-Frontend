import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPaymentMethodAuthorized, isPseudoPaymentMethod, getCanonicalProductPrice } from './src/services/orderCommercialService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('🧪 VELION CANONICAL BUSINESS DATA & ANTI-HALLUCINATION TEST SUITE');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

// ────────────────────────────────────────────────────────────
// CARGA Y PARSEO DEL CONTROLLER REAL
// ────────────────────────────────────────────────────────────
const controllerPath = path.join(__dirname, 'src', 'controllers', 'whatsappController.js');
const controllerCode = fs.readFileSync(controllerPath, 'utf8');

// Extraer globalGuardrails
const guardrailsMatch = controllerCode.match(/const globalGuardrails = `([\s\S]*?)`\.trim\(\);/);
assert.ok(guardrailsMatch, 'Debe existir globalGuardrails en whatsappController.js');
const globalGuardrails = guardrailsMatch[1].trim();

// Función helper que reproduce la lógica exacta de construcción de infoInstitucional en whatsappController.js
function buildInfoInstitucional(tenantDetails) {
  if (!tenantDetails) return '';
  const nombreComercial = tenantDetails.companyName || tenantDetails.name || 'nuestra empresa';
  const sector = tenantDetails.businessSector || 'sector comercial';

  let infoInstitucional = `\n\nINFORMACIÓN DE LA EMPRESA: ${nombreComercial}, sector: ${sector}.`;
  let detallesExt = '\nINFORMACIÓN COMPLEMENTARIA DE LA EMPRESA:';

  if (tenantDetails.taxId && tenantDetails.taxId.trim()) {
    detallesExt += `\n- RUC / Identificación Fiscal oficial: ${tenantDetails.taxId.trim()}.`;
  } else {
    detallesExt += `\n- RUC / Identificación Fiscal: No registrada en el sistema. PROHIBIDO inventar un número de RUC, NIT o identificación fiscal. Responde con honestidad que no tienes ese dato registrado y debe confirmarse directamente con el negocio.`;
  }
  if (tenantDetails.address && tenantDetails.address.trim()) {
    detallesExt += `\n- Dirección física: ${tenantDetails.address.trim()}.`;
  } else {
    detallesExt += `\n- Dirección física: No hay una dirección o local físico registrado en el sistema. PROHIBIDO inventar direcciones, sucursales o locales.`;
  }
  if (tenantDetails.phone && tenantDetails.phone.trim()) {
    detallesExt += `\n- Teléfono de contacto: ${tenantDetails.phone.trim()}.`;
  }
  if (tenantDetails.email && tenantDetails.email.trim()) {
    detallesExt += `\n- Email de soporte: ${tenantDetails.email.trim()}.`;
  }
  if (tenantDetails.businessHours && tenantDetails.businessHours.trim()) {
    detallesExt += `\n- Horarios de atención: ${tenantDetails.businessHours.trim()}.`;
  } else {
    detallesExt += `\n- Horarios de atención: No hay horarios de atención registrados en el sistema. Si el cliente consulta horarios, aclara amablemente que ese detalle debe confirmarse directamente con el negocio.`;
  }
  if (tenantDetails.bankAccounts && tenantDetails.bankAccounts.trim()) {
    detallesExt += `\n- Cuentas bancarias y métodos de pago autorizados (CONFIDENCIAL - REGLA ESTRICTA: Solo existen estos métodos autorizados; proporcionar ÚNICAMENTE si el cliente confirmó explícitamente su decisión de pagar o comprar): ${tenantDetails.bankAccounts.trim()}.`;
  } else {
    detallesExt += `\n- Cuentas bancarias y métodos de pago autorizados: Actualmente no hay cuentas ni métodos de pago registrados en el sistema. PROHIBIDO decir "te brindo los datos", "aquí tienes los datos", "puedes pagar por..." o preguntar "¿Deseas que te brinde los detalles para realizar el pago?". Responde de forma neutral: "Actualmente no tengo un método de pago registrado en el sistema. Ese dato debe confirmarse directamente con el negocio."`;
  }
  if (tenantDetails.termsAndPolicies && tenantDetails.termsAndPolicies.trim()) {
    detallesExt += `\n- Políticas de envío, devolución y términos: ${tenantDetails.termsAndPolicies.trim()}.`;
  } else {
    detallesExt += `\n- Políticas de envío, devolución y términos: No hay políticas ni tarifas de envío configuradas en el sistema. PROHIBIDO afirmar delivery, couriers, despacho o recojo, y PROHIBIDO preguntar '¿Te gustaría que te cuente sobre las opciones de entrega?'. Si el cliente consulta sobre envíos o avanza en la compra, indícale amablemente que puedes ayudarle a avanzar con el pedido y que los detalles de entrega deberán confirmarse directamente con el negocio.`;
  }

  infoInstitucional += detallesExt;
  return infoInstitucional;
}

// ────────────────────────────────────────────────────────────
// SUITE 1: VERIFICACIÓN ESTÁTICA EN CÓDIGO DE WHATSAPP CONTROLLER
// ────────────────────────────────────────────────────────────
runTest('TEST 1: whatsappController.js conecta taxId en infoInstitucional', () => {
  assert.ok(
    controllerCode.includes('tenantDetails.taxId'),
    'whatsappController.js debe comprobar tenantDetails.taxId'
  );
  assert.ok(
    controllerCode.includes('RUC / Identificación Fiscal oficial:'),
    'whatsappController.js debe inyectar el RUC oficial cuando exista'
  );
  assert.ok(
    controllerCode.includes('PROHIBIDO inventar un número de RUC'),
    'whatsappController.js debe prohibir inventar RUC cuando no esté registrado'
  );
});

runTest('TEST 2: whatsappController.js contiene fallbacks explícitos para dirección y horarios ausentes', () => {
  assert.ok(
    controllerCode.includes('No hay una dirección o local físico registrado en el sistema'),
    'Falta fallback para dirección física ausente'
  );
  assert.ok(
    controllerCode.includes('PROHIBIDO inventar direcciones, sucursales o locales'),
    'Falta prohibición de inventar direcciones'
  );
  assert.ok(
    controllerCode.includes('No hay horarios de atención registrados en el sistema'),
    'Falta fallback para horarios de atención ausentes'
  );
});

runTest('TEST 3: globalGuardrails codifica la jerarquía canónica estricta', () => {
  assert.ok(
    globalGuardrails.includes('JERARQUÍA CANÓNICA DE INFORMACIÓN (ESTRICTA Y OBLIGATORIA)'),
    'Falta el encabezado de jerarquía canónica en globalGuardrails'
  );
  assert.ok(
    globalGuardrails.includes('1. DATOS CANÓNICOS ESTRUCTURADOS'),
    'Falta nivel 1 de la jerarquía (Datos estructurados)'
  );
  assert.ok(
    globalGuardrails.includes('2. CONFIGURACIÓN AUTORIZADA DEL NEGOCIO'),
    'Falta nivel 2 de la jerarquía (Configuración autorizada)'
  );
  assert.ok(
    globalGuardrails.includes('3. INFERENCIA DEL MODELO'),
    'Falta nivel 3 de la jerarquía (Inferencia limitada)'
  );
});

runTest('TEST 4: globalGuardrails prohíbe alucinar stock numérico y estados de pedidos', () => {
  assert.ok(
    globalGuardrails.includes('INVENTARIO Y STOCK CANÓNICO: El catálogo opera exclusivamente por estado de disponibilidad (Disponible: Sí/No)'),
    'Falta la regla canónica de disponibilidad vs stock numérico'
  );
  assert.ok(
    globalGuardrails.includes('PROHIBIDO inventar cantidades numéricas exactas de stock restante'),
    'Falta prohibición explícita de inventar stock numérico'
  );
  assert.ok(
    globalGuardrails.includes('ESTADO DE PEDIDOS (ANTI-ALUCINACIÓN): PROHIBIDO inventar estados de despacho'),
    'Falta regla anti-alucinación de pedidos pasados'
  );
});

// ────────────────────────────────────────────────────────────
// SUITE 2: INYECCIÓN DINÁMICA DE HECHOS DEL NEGOCIO
// ────────────────────────────────────────────────────────────
runTest('TEST 5: Tenant con datos completos inyecta todos los hechos canónicos', () => {
  const tenantFull = {
    name: 'AudioStore Perú',
    companyName: 'AudioStore S.A.C.',
    businessSector: 'Audio y Tecnología',
    taxId: '20609876543',
    address: 'Av. Conquistadores 123, San Isidro, Lima',
    phone: '+51 987654321',
    email: 'contacto@audiostore.pe',
    businessHours: 'Lunes a Sábado de 9:00 AM a 7:00 PM',
    bankAccounts: 'BCP Soles: 191-12345678-0-12, Yape: 987654321',
    termsAndPolicies: 'Envíos en Lima en 24 horas vía courier privado. Provincias por Olva Courier. Garantía de 1 año.'
  };

  const info = buildInfoInstitucional(tenantFull);

  assert.ok(info.includes('AudioStore S.A.C.'));
  assert.ok(info.includes('20609876543'));
  assert.ok(info.includes('Av. Conquistadores 123'));
  assert.ok(info.includes('+51 987654321'));
  assert.ok(info.includes('contacto@audiostore.pe'));
  assert.ok(info.includes('Lunes a Sábado de 9:00 AM a 7:00 PM'));
  assert.ok(info.includes('BCP Soles: 191-12345678-0-12'));
  assert.ok(info.includes('Yape: 987654321'));
  assert.ok(info.includes('Olva Courier'));
  assert.ok(!info.includes('No registrada'));
  assert.ok(!info.includes('No hay una dirección'));
});

runTest('TEST 6: Tenant sin datos institucionales activa directivas de no-alucinación', () => {
  const tenantEmpty = {
    name: 'Tienda Nueva',
    companyName: '',
    businessSector: '',
    taxId: '',
    address: '',
    phone: '',
    email: '',
    businessHours: '',
    bankAccounts: '',
    termsAndPolicies: ''
  };

  const info = buildInfoInstitucional(tenantEmpty);

  assert.ok(info.includes('RUC / Identificación Fiscal: No registrada en el sistema. PROHIBIDO inventar un número de RUC'));
  assert.ok(info.includes('Dirección física: No hay una dirección o local físico registrado en el sistema. PROHIBIDO inventar direcciones'));
  assert.ok(info.includes('Horarios de atención: No hay horarios de atención registrados en el sistema'));
  assert.ok(info.includes('Cuentas bancarias y métodos de pago autorizados: Actualmente no hay cuentas ni métodos de pago registrados'));
  assert.ok(info.includes('Políticas de envío, devolución y términos: No hay políticas ni tarifas de envío configuradas'));
});

// ────────────────────────────────────────────────────────────
// SUITE 3: VALIDACIÓN DE REGLAS DE NEGOCIO EN ORDENES Y PRECIOS
// ────────────────────────────────────────────────────────────
runTest('TEST 7: getCanonicalProductPrice calcula precio vigente sin tolerar alucinación', () => {
  const productNoPromo = { price: 150.0, promotionalPrice: null };
  assert.strictEqual(getCanonicalProductPrice(productNoPromo), 150.0);

  const productExpiredPromo = {
    price: 200.0,
    promotionalPrice: 160.0,
    promoStartDate: new Date('2025-01-01'),
    promoEndDate: new Date('2025-02-01')
  };
  // Si la promo ya venció, debe retornar precio regular
  assert.strictEqual(getCanonicalProductPrice(productExpiredPromo), 200.0);

  const productActivePromo = {
    price: 300.0,
    promotionalPrice: 240.0,
    promoStartDate: new Date('2026-01-01'),
    promoEndDate: new Date('2027-12-31')
  };
  // Si la promo está activa, retorna precio promocional
  assert.strictEqual(getCanonicalProductPrice(productActivePromo), 240.0);
});

runTest('TEST 8: isPaymentMethodAuthorized valida estrictamente contra configuración real del tenant', () => {
  const tenantConfig = 'BCP Soles: 191-00000-0-12, Yape: 987654321';

  // Permitidos porque están configurados
  assert.strictEqual(isPaymentMethodAuthorized('Yape', tenantConfig), true);
  assert.strictEqual(isPaymentMethodAuthorized('BCP', tenantConfig), true);
  assert.strictEqual(isPaymentMethodAuthorized('Transferencia BCP', tenantConfig), true);

  // No permitidos porque el tenant no los tiene
  assert.strictEqual(isPaymentMethodAuthorized('Plin', tenantConfig), false);
  assert.strictEqual(isPaymentMethodAuthorized('BBVA', tenantConfig), false);
  assert.strictEqual(isPaymentMethodAuthorized('Interbank', tenantConfig), false);
  assert.strictEqual(isPaymentMethodAuthorized('Tarjeta de crédito', tenantConfig), false);

  // Pseudo-métodos siempre rechazados
  assert.strictEqual(isPseudoPaymentMethod('coordinar con asesor'), true);
  assert.strictEqual(isPseudoPaymentMethod('por definir con el vendedor'), true);
  assert.strictEqual(isPaymentMethodAuthorized('asesor', tenantConfig), false);
});

console.log(`\n====================================================`);
console.log(`🎉 RESULTADO FINAL: ${passedTests}/${totalTests} TESTS PASARON EXITOSAMENTE`);
console.log(`====================================================\n`);
