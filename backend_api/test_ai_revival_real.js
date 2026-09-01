/**
 * test_ai_revival_real.js
 * SEMANTICA REAL del filtraje de chatContext con marcadores ai_cancelled.
 * UTILIZA el codigo REAL de produccion de whatsappController.js
 */
import assert from 'node:assert';
import { buildChatContext } from './src/controllers/whatsappController.js';

console.log('======================================================================');
console.log('VELION AI REVIVAL REAL SUITE - ANTI-REVIVAL SEMANTICO (INTEGRACION REAL)');
console.log('======================================================================');
let passed = 0; let total = 0;
async function runTest(name, fn) {
  total++;
  try { await fn(); passed++; console.log('  PASS: ' + name); }
  catch (err) { console.error('  FAIL: ' + name + ': ' + err.message); throw err; }
}

async function main() {

  // TEST 1: Flujo completo del incidente del reloj negro
  await runTest('TEST 1: Mensaje cancelado NO presenta tarea pendiente como turno abierto', async () => {
    const db = [
      { id: '1', senderRole: 'contact', content: 'Hola que tal', status: 'sent' },
      { id: '2', senderRole: 'model', content: 'Hola! En que puedo ayudarte?', status: 'sent' },
      { id: '3', senderRole: 'contact', content: 'Muestrame fotos de un reloj negro para hombre', status: 'sent' },
      { id: '4', senderRole: 'model', content: '[Respuesta cancelada por desactivacion de IA]', status: 'ai_cancelled' },
      { id: '5', senderRole: 'contact', content: 'Hola buenos dias', status: 'sent' }
    ];

    const ctx = buildChatContext(db);

    // Estructura correcta: user, model, user(reloj), model([...]), user(hola)
    assert.strictEqual(ctx.length, 5, '5 entradas en contexto');
    assert.strictEqual(ctx[0].role, 'user'); assert.ok(ctx[0].content.includes('Hola que tal'));
    assert.strictEqual(ctx[1].role, 'model'); assert.ok(ctx[1].content.includes('En que puedo'));
    assert.strictEqual(ctx[2].role, 'user'); assert.ok(ctx[2].content.includes('reloj negro'));
    // El marcador se convierte en model [...] - cierra el turno
    assert.strictEqual(ctx[3].role, 'model'); assert.strictEqual(ctx[3].content, '[...]');
    // El saludo es el ultimo turno nuevo independiente
    assert.strictEqual(ctx[4].role, 'user'); assert.ok(ctx[4].content.includes('Hola buenos dias'));

    // El marcador interno NUNCA expone el texto de cancelacion
    assert.ok(ctx.every(m => !m.content.includes('Respuesta cancelada')), 'Contenido cancelado no expuesto');
  });

  // TEST 2: Contexto referencial disponible, sin revival automatico
  await runTest('TEST 2: Contexto referencial del reloj disponible cuando cliente lo menciona', async () => {
    const db = [
      { id: '1', senderRole: 'contact', content: 'Muestrame el reloj negro', status: 'sent' },
      { id: '2', senderRole: 'model', content: '[Respuesta cancelada por desactivacion de IA]', status: 'ai_cancelled' },
      { id: '3', senderRole: 'contact', content: 'Y cuanto cuesta ese reloj?', status: 'sent' }
    ];

    const ctx = buildChatContext(db);

    // Gemini ve: user(reloj), model([...]), user(precio)
    assert.strictEqual(ctx.length, 3, '3 entradas');
    assert.ok(ctx[0].content.includes('reloj negro'), 'Contexto del reloj disponible como referencia');
    assert.strictEqual(ctx[1].content, '[...]', 'Turno cerrado con marcador neutro');
    assert.ok(ctx[2].content.includes('cuanto cuesta'), 'Nueva pregunta como ultimo turno');
  });

  // TEST 3: Mensajes durante AI OFF se cierran con el marcador de settingsController
  await runTest('TEST 3: Mensajes durante OFF se cierran semánticamente con el marcador AI ON', async () => {
    const db = [
      // Estos llegaron con AI OFF
      { id: '1', senderRole: 'contact', content: 'Quiero el reloj', status: 'sent' },
      { id: '2', senderRole: 'contact', content: 'Cuanto cuesta?', status: 'sent' },
      { id: '3', senderRole: 'contact', content: 'Hacen envios?', status: 'sent' },
      // El settingsController inserta UN SOLO marcador al activar la IA
      { id: '4', senderRole: 'model', content: '[Período AI OFF cerrado]', status: 'ai_cancelled' },
      // Luego AI ON - cliente escribe
      { id: '5', senderRole: 'contact', content: 'Hola', status: 'sent' }
    ];

    const ctx = buildChatContext(db);

    // Contexto esperado: 1 turno de usuario (colapsado) -> model [...] -> user(hola)
    assert.strictEqual(ctx.length, 3, 'Se colapsan los 3 mensajes de usuario y luego sigue el cierre');
    
    assert.strictEqual(ctx[0].role, 'user');
    assert.ok(ctx[0].content.includes('Quiero el reloj') && ctx[0].content.includes('Hacen envios?'));
    
    assert.strictEqual(ctx[1].role, 'model');
    assert.strictEqual(ctx[1].content, '[...]');
    
    assert.strictEqual(ctx[2].role, 'user');
    assert.strictEqual(ctx[2].content, 'Hola');
  });

  // TEST 4: Referencia a historial durante OFF - funciona contextualmente
  await runTest('TEST 4: Cliente referencia lo preguntado durante OFF - contexto util', async () => {
    const db = [
      { id: '1', senderRole: 'contact', content: 'Quiero el reloj negro', status: 'sent' },
      { id: '2', senderRole: 'contact', content: 'Cuanto cuesta?', status: 'sent' },
      { id: '3', senderRole: 'model', content: '[Período AI OFF cerrado]', status: 'ai_cancelled' },
      { id: '4', senderRole: 'contact', content: 'Sobre el reloj que te pregunte, sigue disponible?', status: 'sent' }
    ];

    const ctx = buildChatContext(db);
    assert.strictEqual(ctx.length, 3);
    assert.ok(ctx[0].content.includes('reloj negro'), 'Contexto del reloj disponible');
    assert.ok(ctx[2].content.includes('sigue disponible'), 'Ultima intencion legible');
  });

  // TEST 5: Reinicio - marcador en DB sobrevive, semantica preservada
  await runTest('TEST 5: Marcador de cancelacion sobrevive reinicio del backend', async () => {
    // Simula lo que quedo en DB tras el marcador y un reinicio de Node.js
    const dbAfterRestart = [
      { id: '1', senderRole: 'contact', content: 'Muestrame el reloj negro', status: 'sent' },
      { id: '2', senderRole: 'model', content: '[Respuesta cancelada por desactivacion de IA]', status: 'ai_cancelled' },
      { id: '3', senderRole: 'contact', content: 'Hola de nuevo', status: 'sent' }
    ];

    const ctx = buildChatContext(dbAfterRestart);
    assert.strictEqual(ctx[1].content, '[...]', 'Marcador ai_cancelled sigue produciendo cierre semantico');
    assert.strictEqual(ctx[2].content, 'Hola de nuevo', 'Nuevo mensaje es turno independiente');
  });

  // TEST 6: AI siempre ON - historial normal
  await runTest('TEST 6: AI siempre ON - chatContext completamente normal', async () => {
    const db = [
      { id: '1', senderRole: 'contact', content: 'Hola', status: 'sent' },
      { id: '2', senderRole: 'model', content: 'Hola! Puedo ayudarte?', status: 'sent' },
      { id: '3', senderRole: 'contact', content: 'Quiero audifonos inalambricos', status: 'sent' },
      { id: '4', senderRole: 'model', content: 'Tenemos varias opciones...', status: 'sent' },
      { id: '5', senderRole: 'contact', content: 'Me gusta el Sony WH-1000XM5', status: 'sent' }
    ];

    const ctx = buildChatContext(db);
    assert.strictEqual(ctx.length, 5, 'Todas las entradas presentes');
    assert.ok(ctx.every(m => m.content !== '[...]'), 'Sin marcadores de cancelacion');
    assert.strictEqual(ctx[ctx.length - 1].content, 'Me gusta el Sony WH-1000XM5');
  });

  console.log('');
  console.log('======================================================================');
  console.log('RESULTADO FINAL: ' + passed + '/' + total + ' TESTS COMPLETADOS CON EXITO');
  console.log('======================================================================');
  if (passed !== total) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
