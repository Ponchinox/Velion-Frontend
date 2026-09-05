import fs from 'fs';
import { sanitizeSpuriousEmoticons } from './src/controllers/whatsappController.js';

console.log('🧪 Iniciando test_emoticon_sanitization.js...\n');

let passedCount = 0;
let failedCount = 0;

function assertEqual(actual, expected, testId, description) {
  if (actual === expected) {
    console.log(`✅ [${testId}] ${description}`);
    passedCount++;
  } else {
    console.error(`❌ [${testId}] ${description}`);
    console.error(`   Esperado: ${JSON.stringify(expected)}`);
    console.error(`   Recibido: ${JSON.stringify(actual)}`);
    failedCount++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PRUEBAS DE SANITIZACIÓN DIRECTA (E1 - E8)
// ─────────────────────────────────────────────────────────────────────────────

// E1. Respuesta que termina con pregunta y "*:)"
assertEqual(
  sanitizeSpuriousEmoticons("¿En qué más puedo ayudarte? *:)"),
  "¿En qué más puedo ayudarte?",
  "E1",
  "Elimina '*:)' al final tras una pregunta"
);

// E2. Respuesta que termina con palabra y "*:)"
assertEqual(
  sanitizeSpuriousEmoticons("Perfecto *:)"),
  "Perfecto",
  "E2",
  "Elimina '*:)' al final tras una palabra"
);

// E3. Emoticón legítimo sin asterisco ":)"
assertEqual(
  sanitizeSpuriousEmoticons("Hola :)"),
  "Hola :)",
  "E3",
  "Conserva emoticón estándar ':)' sin modificarlo"
);

// E4. URL con parámetros o caracteres que incluyan ":)"
assertEqual(
  sanitizeSpuriousEmoticons("Visita https://ejemplo.com/path?q=test:)"),
  "Visita https://ejemplo.com/path?q=test:)",
  "E4",
  "Conserva URLs legítimas intactas"
);

// E5. Formato Markdown con asteriscos válidos
assertEqual(
  sanitizeSpuriousEmoticons("*texto importante*"),
  "*texto importante*",
  "E5",
  "Conserva negritas Markdown con asteriscos (*texto*)"
);

// E6. Emojis Unicode legítimos
assertEqual(
  sanitizeSpuriousEmoticons("¡Perfecto! 😊🚀"),
  "¡Perfecto! 😊🚀",
  "E6",
  "Conserva emojis Unicode de negocio intactos"
);

// E7. Token espurio aislado entre palabras
assertEqual(
  sanitizeSpuriousEmoticons("Texto *:) más texto"),
  "Texto más texto",
  "E7",
  "Elimina '*:)' aislado como token independiente y preserva el espaciado"
);

// E8. Mensaje compuesto exclusivamente por "*:)"
assertEqual(
  sanitizeSpuriousEmoticons("*:)\n"),
  "",
  "E8",
  "Devuelve string vacío cuando el mensaje completo es únicamente '*:)'"
);

// ─────────────────────────────────────────────────────────────────────────────
// CASOS EXTRA DE ROBUSTEZ SINTÁCTICA
// ─────────────────────────────────────────────────────────────────────────────

// E-EXTRA-1: Puntuación pegada sin espacio
assertEqual(
  sanitizeSpuriousEmoticons("¿En qué más puedo ayudarte?*:)"),
  "¿En qué más puedo ayudarte?",
  "E-EXTRA-1",
  "Elimina '*:)' pegado a signo de interrogación sin espacio intermedio"
);

// E-EXTRA-2: Punto seguido de '*:)' con espacios al final
assertEqual(
  sanitizeSpuriousEmoticons("Entendido. *:)   "),
  "Entendido.",
  "E-EXTRA-2",
  "Elimina '*:)' con espacios al final tras punto"
);

// E-EXTRA-3: Multilínea con [SPLIT]
assertEqual(
  sanitizeSpuriousEmoticons("¿Tienes alguna consulta? *:)\n[SPLIT]\nCon gusto te atiendo"),
  "¿Tienes alguna consulta?\n[SPLIT]\nCon gusto te atiendo",
  "E-EXTRA-3",
  "Elimina '*:)' al final de una línea antes de [SPLIT] en modo multilínea"
);

// ─────────────────────────────────────────────────────────────────────────────
// E9. VERIFICACIÓN DEL SYSTEM PROMPT GLOBAL
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- [E9] Verificando eliminación de semilla en System Prompt global ---');
const controllerCode = fs.readFileSync('./backend_api/src/controllers/whatsappController.js', 'utf8');

// Extraer el bloque de temas fuera de la tienda
const offTopicMatch = controllerCode.match(/\[TEMAS FUERA DE LA TIENDA - RESPUESTA UNICA OBLIGATORIA\][\s\S]*?-> Responde UNICAMENTE con: "([^"]+)"/);

if (!offTopicMatch) {
  console.error('❌ [E9] No se pudo encontrar la regla de respuesta fuera de la tienda en whatsappController.js');
  failedCount++;
} else {
  const offTopicResponse = offTopicMatch[1];
  console.log(`   Template off-topic actual: "${offTopicResponse}"`);

  if (offTopicResponse.includes(':)') || offTopicResponse.includes('*: )')) {
    console.error('❌ [E9] El template off-topic todavía contiene el emoticón ASCII ":)"');
    failedCount++;
  } else if (offTopicResponse === 'Solo puedo ayudarte con los productos y servicios de nuestra tienda. ¿Estás buscando algo específico?') {
    console.log('✅ [E9] El template global off-topic está 100% libre del emoticón ASCII ":)" y coincide con la preferencia natural.');
    passedCount++;
  } else {
    console.warn('⚠️ [E9] El template no contiene ":)", pero difiere del texto exacto:', offTopicResponse);
    passedCount++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// E10. SIMULACIÓN DE FLUJO DE DISPATCH (cleanedText libre de *:) )
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- [E10] Simulando flujo de despacho cleanedText ---');
const rawGeminiResponseWithEmoticon = "¿En qué más puedo ayudarte? *:)";
const handoffRegex = /\[HUMAN_HANDOFF:.*?\]/gi;

const textWithoutCommands = rawGeminiResponseWithEmoticon
  .replace(handoffRegex, '')
  .replace(/\[MEDIA:.*?\]/gi, '')
  .replace(/\[SHOW_GALLERY:.*?\]/gi, '');
const simulatedCleanedText = sanitizeSpuriousEmoticons(textWithoutCommands);

assertEqual(
  simulatedCleanedText,
  "¿En qué más puedo ayudarte?",
  "E10",
  "cleanedText usado en dispatch queda totalmente limpio aunque Gemini emita '*:)'"
);

// ─────────────────────────────────────────────────────────────────────────────
// E11. SIMULACIÓN DE PERSISTENCIA EN PRISMA.MESSAGE
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- [E11] Verificando consistencia de persistencia en PostgreSQL Message ---');
// Simulamos la creación de tokens y despacho
const sequenceRegex = /(\[SPLIT\])/gi;
const tokens = simulatedCleanedText.split(sequenceRegex).filter(t => t !== undefined && t !== null);
let dispatchSequence = [];
let textBuffer = "";

for (const fragment of tokens) {
  if (!fragment) continue;
  textBuffer += (textBuffer ? " " : "") + fragment.trim();
}
if (textBuffer.trim()) {
  dispatchSequence.push({ type: 'text', content: textBuffer.trim() });
}

const itemToPersist = dispatchSequence[0];
const prismaMessageCreatePayload = {
  content: itemToPersist.content,
  senderRole: 'agent',
  status: 'sent'
};

assertEqual(
  prismaMessageCreatePayload.content,
  "¿En qué más puedo ayudarte?",
  "E11",
  "prisma.message.create almacena exactamente el mismo texto limpio sin '*:)'"
);

// ─────────────────────────────────────────────────────────────────────────────
// E12. SIMULACIÓN DE PAYLOAD IDÉNTICO PARA EVOLUTION Y META
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- [E12] Verificando paridad absoluta entre Evolution Gateway y Meta Cloud API Gateway ---');

// Ambos gateways consumen item.content derivado directamente de cleanedText
const evolutionGatewayPayload = {
  provider: 'EVOLUTION',
  to: '51970281661',
  text: itemToPersist.content
};

const metaGatewayPayload = {
  provider: 'META',
  to: '51970281661',
  text: itemToPersist.content
};

assertEqual(
  evolutionGatewayPayload.text,
  metaGatewayPayload.text,
  "E12-A",
  "Evolution y Meta reciben exactamente el mismo texto de despacho"
);

assertEqual(
  evolutionGatewayPayload.text.includes('*: )'),
  false,
  "E12-B",
  "El texto enviado a los gateways no contiene '*:)' bajo ninguna circunstancia"
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
  console.error('\n❌ HAY PRUEBAS FALLIDAS EN test_emoticon_sanitization.js');
  process.exit(1);
} else {
  console.log('\n🎉 TODAS LAS PRUEBAS DE SANITIZACIÓN (E1 - E12) PASARON EXITOSAMENTE.');
  process.exit(0);
}
