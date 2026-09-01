/**
 * test_ai_off_interval.js
 * Prueba exhaustiva de la seleccion de chats a cerrar basados en [T0, T1).
 */
import assert from 'node:assert';
import { getChatsToCloseByAiOff } from './src/controllers/settingsController.js';

console.log('======================================================================');
console.log('VELION AI OFF INTERVAL - [T0, T1) Y REGLAS DE SELECCION');
console.log('======================================================================');
let passed = 0; let total = 0;
async function runTest(name, fn) {
  total++;
  try { await fn(); passed++; console.log('  PASS: ' + name); }
  catch (err) { console.error('  FAIL: ' + name + ': ' + err.message); throw err; }
}

async function main() {
  const T0 = new Date('2026-01-01T12:00:00Z');
  const T1 = new Date('2026-01-01T15:00:00Z');

  await runTest('TEST 1: Mensaje contact ANTES de T0 -> NO marker', async () => {
    const db = [{ chatId: 'chat1', senderRole: 'contact', createdAt: new Date('2026-01-01T11:00:00Z') }];
    assert.strictEqual(getChatsToCloseByAiOff(db, T0, T1).length, 0);
  });

  await runTest('TEST 2: Mensaje contact entre T0 y T1 -> SÍ marker', async () => {
    const db = [{ chatId: 'chat1', senderRole: 'contact', createdAt: new Date('2026-01-01T13:00:00Z') }];
    const res = getChatsToCloseByAiOff(db, T0, T1);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0], 'chat1');
  });

  await runTest('TEST 3: Mensaje contact DESPUÉS de T1 -> NO marker', async () => {
    const db = [{ chatId: 'chat1', senderRole: 'contact', createdAt: new Date('2026-01-01T16:00:00Z') }];
    assert.strictEqual(getChatsToCloseByAiOff(db, T0, T1).length, 0);
  });

  await runTest('TEST 4: Agent responde durante OFF -> ultimo msj es agent -> NO marker', async () => {
    const db = [{ chatId: 'chat1', senderRole: 'agent', createdAt: new Date('2026-01-01T14:00:00Z') }];
    assert.strictEqual(getChatsToCloseByAiOff(db, T0, T1).length, 0);
  });

  await runTest('TEST 11: message createdAt == T0 -> INCLUIDO', async () => {
    const db = [{ chatId: 'chat1', senderRole: 'contact', createdAt: new Date('2026-01-01T12:00:00Z') }];
    assert.strictEqual(getChatsToCloseByAiOff(db, T0, T1).length, 1);
  });

  await runTest('TEST 12: message createdAt == T1 -> EXCLUIDO', async () => {
    const db = [{ chatId: 'chat1', senderRole: 'contact', createdAt: new Date('2026-01-01T15:00:00Z') }];
    assert.strictEqual(getChatsToCloseByAiOff(db, T0, T1).length, 0);
  });

  console.log('');
  console.log('======================================================================');
  console.log('RESULTADO FINAL: ' + passed + '/' + total + ' TESTS COMPLETADOS CON EXITO');
  console.log('======================================================================');
  if (passed !== total) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
