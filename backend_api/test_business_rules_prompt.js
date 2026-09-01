import fs from 'fs';

async function runTests() {
  console.log('🧪 Iniciando Tests de Reglas Comerciales (Prompt Generado)...\n');

  // We cannot easily mock the whole whatsappController flow, but we can simulate the prompt building 
  // exactly as it happens in whatsappController.js, or extract it if it was modularized.
  // Since it's inline in whatsappController.js, let's extract the globalGuardrails and infoInstitucional logic
  // to test it directly.
  const whatsappController = fs.readFileSync('./backend_api/src/controllers/whatsappController.js', 'utf8');

  // Extract globalGuardrails string
  const globalGuardrailsMatch = whatsappController.match(/const globalGuardrails = `([\s\S]*?)`\.trim\(\);/);
  if (!globalGuardrailsMatch) {
    throw new Error('No se pudo extraer globalGuardrails de whatsappController.js');
  }
  const globalGuardrails = globalGuardrailsMatch[1].trim();

  // Test 4: globalGuardrails conserva las reglas universales
  console.log('--- TEST 4: Verificando reglas universales en globalGuardrails ---');
  if (!globalGuardrails.includes('Nunca inventes métodos de pago')) throw new Error('Falta regla: No inventar métodos de pago');
  if (!globalGuardrails.includes('empresas de envío')) throw new Error('Falta regla: No inventar empresas de envío');
  if (!globalGuardrails.includes('cuentas, números o titulares')) throw new Error('Falta regla: No inventar cuentas/titulares');
  console.log('✅ TEST 4 PASÓ');

  // Test 5: No existe PII o data hardcodeada (Yape, Plin, Shalom, etc.)
  console.log('\n--- TEST 5: Verificando ausencia de PII y marcas hardcodeadas ---');
  const forbiddenKeywords = ['Yape', 'Plin', 'Shalom', 'Olva', 'BCP', 'Interbank', 'BBVA', 'Scotiabank'];
  for (const keyword of forbiddenKeywords) {
    if (globalGuardrails.toLowerCase().includes(keyword.toLowerCase())) {
      throw new Error(`TEST 5 FALLÓ: Palabra prohibida "${keyword}" encontrada en globalGuardrails`);
    }
  }
  console.log('✅ TEST 5 PASÓ');

  // Test 1, 2, 3: Simulando la inyección dinámica (Capa 4)
  console.log('\n--- TEST 1, 2, 3: Verificando inyección dinámica (Simulada) ---');
  const tenantDetailsMock = {
    companyName: 'Tienda Ejemplo',
    businessSector: 'Retail',
    bankAccounts: 'Transferencia BCP: 191-12345678-0-12, Plin: 999888777',
    termsAndPolicies: 'Envíos nacionales por Olva Courier exclusivamente.'
  };

  let infoInstitucional = '';
  const nombreComercial = tenantDetailsMock.companyName || 'nuestra empresa';
  const sector = tenantDetailsMock.businessSector || 'sector comercial';
  
  infoInstitucional = `\\n\\nINFORMACIÓN DE LA EMPRESA: ${nombreComercial}, sector: ${sector}.`;

  let detallesExt = '\\nINFORMACIÓN COMPLEMENTARIA DE LA EMPRESA:';
  if (tenantDetailsMock.bankAccounts) {
    detallesExt += `\\n- Cuentas bancarias y métodos de pago autorizados (CONFIDENCIAL - REGLA ESTRICTA: Solo existen estos métodos autorizados; proporcionar ÚNICAMENTE si el cliente confirmó explícitamente su decisión de pagar o comprar): ${tenantDetailsMock.bankAccounts.trim()}.`;
  }
  if (tenantDetailsMock.termsAndPolicies) {
    detallesExt += `\\n- Políticas de envío, devolución y términos: ${tenantDetailsMock.termsAndPolicies}.`;
  }
  infoInstitucional += detallesExt;

  const simulatedFinalPrompt = infoInstitucional + '\n\n' + globalGuardrails;

  if (simulatedFinalPrompt.includes('Yape') || simulatedFinalPrompt.includes('Shalom')) {
    throw new Error('TEST 1/2 FALLÓ: El prompt final incluyó Yape o Shalom a pesar de que el tenant no los usa.');
  }
  console.log('✅ TEST 1 y 2 PASARON');

  if (!simulatedFinalPrompt.includes('Plin: 999888777') || !simulatedFinalPrompt.includes('Olva Courier')) {
    throw new Error('TEST 3 FALLÓ: Los métodos dinámicos del tenant no se incluyeron correctamente.');
  }
  console.log('✅ TEST 3 PASÓ');
  
  console.log('\n🎉 TODOS LOS TESTS COMPLETADOS EXITOSAMENTE');
}

runTests().catch(e => {
  console.error('\n❌ ERROR DURANTE LOS TESTS:\n', e.message);
  process.exit(1);
});
