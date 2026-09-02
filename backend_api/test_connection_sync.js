import test from 'node:test';
import assert from 'node:assert';
import { mapEvolutionConnectionState, determineReconciliationUpdates, applyReconciliationUpdates } from './src/utils/connectionSyncLogic.js';

test('1. open -> CONNECTED', () => {
  assert.strictEqual(mapEvolutionConnectionState('open'), 'CONNECTED');
});

test('2. connecting -> CONNECTING', () => {
  assert.strictEqual(mapEvolutionConnectionState('connecting'), 'CONNECTING');
});

test('3. close -> DISCONNECTED', () => {
  assert.strictEqual(mapEvolutionConnectionState('close'), 'DISCONNECTED');
});

test('4. estado desconocido -> UNKNOWN', () => {
  assert.strictEqual(mapEvolutionConnectionState('refused'), 'UNKNOWN');
  assert.strictEqual(mapEvolutionConnectionState(null), 'UNKNOWN');
});

test('6. DB CONNECTED + Evolution close -> devuelve/persiste DISCONNECTED', async () => {
  const connections = [{ id: 1, instanceName: 'bot_1', connectionState: 'CONNECTED' }];
  const fetchMock = async (conn) => ({ state: 'close' });
  
  const updates = await determineReconciliationUpdates(connections, fetchMock);
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].action, 'update_state');
  assert.strictEqual(updates[0].newVelionState, 'DISCONNECTED');
});

test('7. DB DISCONNECTED + Evolution open -> CONNECTED', async () => {
  const connections = [{ id: 1, instanceName: 'bot_1', connectionState: 'DISCONNECTED' }];
  const fetchMock = async (conn) => ({ state: 'open' });
  
  const updates = await determineReconciliationUpdates(connections, fetchMock);
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].action, 'update_state');
  assert.strictEqual(updates[0].newVelionState, 'CONNECTED');
});

test('8. timeout/network/5xx -> conserva último estado', async () => {
  const connections = [{ id: 1, instanceName: 'bot_1', connectionState: 'CONNECTED' }];
  const fetchMock = async (conn) => { throw { status: 504 }; }; // timeout
  
  const updates = await determineReconciliationUpdates(connections, fetchMock);
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].action, 'preserve_state_on_error');
  assert.strictEqual(updates[0].error, 504);
});

test('9. fallo de una instancia -> no falla toda la lista', async () => {
  const connections = [
    { id: 1, instanceName: 'bot_1', connectionState: 'CONNECTED' },
    { id: 2, instanceName: 'bot_2', connectionState: 'CONNECTED' }
  ];
  
  const fetchMock = async (conn) => {
    if (conn.id === 1) throw { status: 500 };
    return { state: 'close' };
  };
  
  const updates = await determineReconciliationUpdates(connections, fetchMock);
  assert.strictEqual(updates.length, 2);
  assert.strictEqual(updates[0].action, 'preserve_state_on_error');
  assert.strictEqual(updates[1].action, 'update_state');
  assert.strictEqual(updates[1].newVelionState, 'DISCONNECTED');
});

test('11. 404 (instancia no existe en Evolution) -> DISCONNECTED explícitamente', async () => {
  const connections = [{ id: 1, instanceName: 'bot_1', connectionState: 'CONNECTED' }];
  const fetchMock = async (conn) => { throw { status: 404 }; };
  
  const updates = await determineReconciliationUpdates(connections, fetchMock);
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].action, 'update_state');
  assert.strictEqual(updates[0].newVelionState, 'DISCONNECTED');
});

test('Si Evolution devuelve mismo estado -> no hace nada', async () => {
  const connections = [{ id: 1, instanceName: 'bot_1', connectionState: 'CONNECTED' }];
  const fetchMock = async (conn) => ({ state: 'open' });
  
  const updates = await determineReconciliationUpdates(connections, fetchMock);
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].action, 'no_change');
});

test('RACE CONDITION: Webhook más reciente sobreescribe reconciliación lenta (Optimistic Update con fallo y recuperación)', async () => {
  const T0 = new Date('2026-09-01T21:00:00Z');
  
  // 1. Estado original que getProvider leyó
  const connDB = { id: 1, instanceName: 'bot_1', connectionState: 'CONNECTING', connectionStateUpdatedAt: T0 };
  
  // 2. Evolution responde lento con un "close" obsoleto (stale)
  const updates = [{ conn: { ...connDB }, newVelionState: 'DISCONNECTED', action: 'update_state' }];
  
  // 3. Mock de Prisma
  const mockPrisma = {
    registeredWhatsAppNumber: {
      updateMany: async ({ where }) => {
        // En este mock, simulamos que el Webhook ya cambió el updatedAt a T1, 
        // así que el count de afectados será 0 (falla Optimistic Update).
        return { count: 0 };
      },
      findUnique: async () => {
        // Al fallar la actualización optimista, la lógica consulta la DB para recuperar el dato fresco.
        // Simulamos que la DB tiene el valor fresco del Webhook (CONNECTED).
        return { connectionState: 'CONNECTED' };
      }
    }
  };

  // Ejecutamos applyReconciliationUpdates
  const finalConns = await applyReconciliationUpdates(updates, mockPrisma);
  
  // El connectionState final que devuelve getProvider NO debe ser el DISCONNECTED stale de Evolution,
  // debe ser el CONNECTED fresco del webhook, resguardando la consistencia real!
  assert.strictEqual(finalConns[0].connectionState, 'CONNECTED');
});
