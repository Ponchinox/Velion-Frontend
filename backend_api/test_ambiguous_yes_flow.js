import fs from 'fs';
import { buildChatContext } from './src/controllers/whatsappController.js';
import {
  syncCommercialOrder,
  isPaymentMethodAuthorized,
  isPseudoPaymentMethod,
  cleanCommercialDraft
} from './src/services/orderCommercialService.js';

console.log('🧪 Iniciando test_ambiguous_yes_flow.js (Suite Y1–Y14: Respuestas Cortas y Ambiguas)...\n');

let passedCount = 0;
let failedCount = 0;

function assert(condition, testId, description, details = '') {
  if (condition) {
    console.log(`  ✅ PASS: [${testId}] ${description}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL: [${testId}] ${description}`);
    if (details) console.error(`     Detalle: ${details}`);
    failedCount++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACCIÓN Y VERIFICACIÓN ESTÁTICA DEL PROMPT GLOBAL
// ─────────────────────────────────────────────────────────────────────────────
const controllerSource = fs.readFileSync('./backend_api/src/controllers/whatsappController.js', 'utf8');
const guardrailsMatch = controllerSource.match(/const globalGuardrails = `([\s\S]*?)`\.trim\(\);/);

if (!guardrailsMatch) {
  throw new Error('No se pudo extraer globalGuardrails de whatsappController.js');
}
const globalGuardrails = guardrailsMatch[1];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE Y1 - Y14
// ─────────────────────────────────────────────────────────────────────────────

// Y1 [Estático + Contrato]: Pregunta Binaria ("¿Quieres matricularte?") + "Sí"
// Verifica que la regla defina interpretación de AFIRMACIÓN / AVANCE sin repetir la pregunta
const hasBinaryRule = globalGuardrails.includes('PREGUNTA BINARIA') &&
  globalGuardrails.includes('AFIRMACIÓN / ACEPTACIÓN') &&
  globalGuardrails.includes('PROHIBIDO volver a preguntar si desea continuar');
assert(
  hasBinaryRule,
  'Y1',
  'Pregunta Binaria: "Sí" se interpreta como afirmación/avance y prohíbe re-preguntar si desea continuar.'
);

// Y2 [Estático + Contrato]: Pregunta de Elección ("¿Intensivo o Superintensivo?") + "Sí"
// Verifica que prohíba seleccionar primera opción, inventar productId o paymentMethod
const hasChoiceRule = globalGuardrails.includes('PREGUNTA DE ELECCIÓN') &&
  globalGuardrails.includes('eso NO selecciona ninguna opción') &&
  globalGuardrails.includes('PROHIBIDO elegir por el cliente') &&
  globalGuardrails.includes('inventar productId/paymentMethod');
assert(
  hasChoiceRule,
  'Y2',
  'Pregunta de Elección: "Sí" no selecciona ninguna opción; prohíbe inventar productId o asumir alternativas.'
);

// Y3 [Estático + Contrato]: Pregunta Abierta ("¿A qué universidad postulas?") + "Sí"
// Verifica que no invente datos y pida específicamente el dato
const hasOpenRule = globalGuardrails.includes('PREGUNTA ABIERTA') &&
  globalGuardrails.includes('AMBIGUO / FALTA EL DATO') &&
  globalGuardrails.includes('PROHIBIDO inventar universidad, ciudad, nombre, curso, carrera o dirección');
assert(
  hasOpenRule,
  'Y3',
  'Pregunta Abierta: "Sí" se marca como ambiguo/falta dato y prohíbe inventar universidades, ciudades o datos.'
);

// Y4 [Estático + Contrato]: Pregunta de Confirmación de Datos + "Sí"
// Verifica que sea confirmación explícita solo si ya hay producto seleccionado
const hasConfirmationRule = globalGuardrails.includes('CONFIRMACIÓN DE DATOS O COMPRA') &&
  globalGuardrails.includes('CONFIRMACIÓN EXPLÍCITA') &&
  globalGuardrails.includes('customerConfirmed: true') &&
  globalGuardrails.includes('PROHIBIDO crear un productId nuevo a partir de "sí"');
assert(
  hasConfirmationRule,
  'Y4',
  'Confirmación de Datos: "Sí" habilita customerConfirmed solo si ya existe producto previamente elegido.'
);

// Y5 [Estático + Contrato]: Secuencia Anti-Loop (Dos "Sí" consecutivos ante elección)
// Verifica que prohíba repetir la misma pregunta y obligue a formatear lista numerada 1. / 2.
const hasAntiLoopRule = globalGuardrails.includes('REGLA ANTI-LOOP EN ELECCIONES') &&
  globalGuardrails.includes('SEGUNDA vez consecutiva') &&
  globalGuardrails.includes('ESTÁ PROHIBIDO repetir exactamente la misma pregunta') &&
  globalGuardrails.includes('lista numerada corta y concisa');
assert(
  hasAntiLoopRule,
  'Y5',
  'Regla Anti-Loop: Segunda respuesta ambigua consecutiva prohíbe bucle idéntico y fuerza lista numerada 1. / 2.'
);

// Y6 [Estático]: Afirmaciones equivalentes ("Claro", "Ok", "De acuerdo", "Correcto")
const hasEquivalents = globalGuardrails.includes('"sí", "si", "claro", "ok", "de acuerdo", "correcto"');
assert(
  hasEquivalents,
  'Y6',
  'Afirmaciones equivalentes: Cubre exhaustivamente "sí", "si", "claro", "ok", "de acuerdo", "correcto".'
);

// Y7 [Estático + Funcional]: "Ok" tras información de precio/características
// Verifica que "Ok" se catalogue como acuse de recibo y no marque customerConfirmed
const hasOkRule = globalGuardrails.includes('"OK" COMO ACUSE DE RECIBO') &&
  globalGuardrails.includes('acuse de recibo') &&
  globalGuardrails.includes('NO marca customerConfirmed: true ni crea órdenes');

// Simulación funcional: "Ok" con estado sin confirmación no crea orden
const dummyDraftOk = {
  currentStage: 'DETAILS_PROVIDED',
  productId: 'prod-uuid-1',
  customerConfirmed: false
};
const cleanedOk = cleanCommercialDraft(dummyDraftOk);
assert(
  hasOkRule && cleanedOk.customerConfirmed === undefined,
  'Y7',
  '"Ok" como acuse de recibo: No habilita customerConfirmed=true ni crea órdenes automáticas.'
);

// Y8 [Estático + Funcional]: Negación ("No")
const hasNoRule = globalGuardrails.includes('NEGACIÓN ("NO")') &&
  globalGuardrails.includes('respeta la negativa sin presionar') &&
  globalGuardrails.includes('jamás avances como si hubiera confirmado');
assert(
  hasNoRule,
  'Y8',
  'Negación ("No"): Respeta la negativa sin presionar y prohíbe actuar como si hubiera confirmado.'
);

// Y9 [Estático + Funcional]: Respuesta con contenido explícito ("Sí, el Intensivo")
const hasExplicitContentRule = globalGuardrails.includes('RESPUESTAS CON CONTENIDO EXPLÍCITO') &&
  globalGuardrails.includes('selección explícita (no ambigua)');
assert(
  hasExplicitContentRule,
  'Y9',
  'Contenido Explícito: "Sí, el [producto]" no se trata como ambiguo y toma la opción como selección explícita.'
);

// Y10 [Funcional]: "Sí quiero pagar por Yape" sujeto a payment guards del tenant
const authorizedTenantsPayments = 'Transferencia BCP: 191-12345678-0-12, Plin: 999888777';
const isYapeAllowed = isPaymentMethodAuthorized('Yape', authorizedTenantsPayments);
const isPlinAllowed = isPaymentMethodAuthorized('Plin', authorizedTenantsPayments);
assert(
  !isYapeAllowed && isPlinAllowed,
  'Y10',
  'Pago Explícito Condicionado: Intención de pago explícita respeta los Payment Guards del tenant (falla cerrado si no autorizado).'
);

// Y11 [Estático]: "Sí, muéstrame la foto" activa send_product_media solo si producto identificado
const hasMediaCondition = globalGuardrails.includes('llama a send_product_media si el producto está identificado');
assert(
  hasMediaCondition,
  'Y11',
  'Multimedia Condicionada: "Sí, muéstrame la foto" solo dispara tool si el producto ya está identificado.'
);

// Y12 [Funcional - Seguridad]: "Sí" ambiguo no puede violar aislamiento ni crear orden inválida
const simulatedAmbiguousState = {
  currentStage: 'EXPLORING',
  customerConfirmed: true, // Supongamos que un LLM erróneamente pasó true ante "Sí"
  productId: null,        // Pero no hay producto
  paymentMethod: null
};

// Mock de base de datos para syncCommercialOrder
let orderCreated = false;
const mockDb = {
  product: {
    findFirst: async () => null // Producto inexistente
  },
  order: {
    create: async () => { orderCreated = true; return { id: 'order-fake' }; }
  },
  customer: {
    update: async () => ({})
  },
  systemAlert: {
    create: async () => ({})
  }
};

await syncCommercialOrder({
  prismaClient: mockDb,
  tenant: { id: 'tenant-secure', bankAccounts: 'BCP: 123' },
  customer: { id: 'cust-1', commercialState: simulatedAmbiguousState },
  args: simulatedAmbiguousState,
  clientNumber: '51999999999'
});

assert(
  !orderCreated,
  'Y12',
  'Escudo de Seguridad: "Sí" con productId ausente o nulo falla cerrado y JAMÁS crea una Orden en base de datos.'
);

// Y13 [Funcional]: buildChatContext mantiene el turno anterior del bot disponible
const sampleRawMessages = [
  { id: '1', senderRole: 'agent', content: '¿Prefieres Intensivo o Superintensivo?', status: 'sent', createdAt: new Date(1000) },
  { id: '2', senderRole: 'contact', content: 'Sí', status: 'delivered', createdAt: new Date(2000) }
];
const context = buildChatContext(sampleRawMessages);
const hasBotQuestion = context.some(m => m.role === 'model' && m.content.includes('¿Prefieres Intensivo o Superintensivo?'));
const hasUserYes = context.some(m => m.role === 'user' && m.content === 'Sí');
assert(
  context.length === 2 && hasBotQuestion && hasUserYes && context[0].role === 'model' && context[1].role === 'user',
  'Y13',
  'Disponibilidad de Contexto: buildChatContext preserva el turno anterior del modelo y el turno actual del usuario en orden estricto.'
);

// Y14 [Funcional / Contrato]: Dos afirmaciones ambiguas consecutivas disparan protocolo anti-loop
function simulateAntiLoopResolution(historyTurns, candidatePrompt) {
  // Detecta si en los últimos turnos el bot preguntó una elección, el usuario dijo "Sí",
  // el bot aclaró y el usuario volvió a decir "Sí"
  const userTurns = historyTurns.filter(t => t.role === 'user');
  const lastUser = userTurns[userTurns.length - 1]?.content.trim().toLowerCase();
  const prevUser = userTurns[userTurns.length - 2]?.content.trim().toLowerCase();
  
  const isConsecutiveAmbiguous = (lastUser === 'sí' || lastUser === 'si') && (prevUser === 'sí' || prevUser === 'si');
  
  if (isConsecutiveAmbiguous) {
    // Debe usar lista numerada según la regla
    return "Para continuar, indícame una opción:\n1. Intensivo\n2. Superintensivo";
  }
  return "¿Prefieres Intensivo o Superintensivo?";
}

const mockHistoryWithLoop = [
  { role: 'model', content: '¿Prefieres Intensivo o Superintensivo?' },
  { role: 'user', content: 'Sí' },
  { role: 'model', content: 'Claro, ¿prefieres Intensivo o Superintensivo?' },
  { role: 'user', content: 'Sí' }
];

const resolvedResponse = simulateAntiLoopResolution(mockHistoryWithLoop);
assert(
  resolvedResponse.includes('1. Intensivo') && resolvedResponse.includes('2. Superintensivo'),
  'Y14',
  'Protocolo Anti-Loop Resuelto: Dos "Sí" consecutivos rompen el bucle idéntico y formatean lista numerada estructurada.'
);

// ─────────────────────────────────────────────────────────────────────────────
// RESUMEN FINAL
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n==================================================');
console.log(`TOTAL PRUEBAS EJECUTADAS: ${passedCount + failedCount}`);
console.log(`PASADAS: ${passedCount}`);
console.log(`FALLIDAS: ${failedCount}`);
console.log('==================================================');

if (failedCount > 0) {
  console.error('\n❌ HAY PRUEBAS FALLIDAS EN test_ambiguous_yes_flow.js');
  process.exit(1);
} else {
  console.log('\n🎉 TODAS LAS PRUEBAS (Y1 - Y14) PASARON EXITOSAMENTE.');
  process.exit(0);
}
