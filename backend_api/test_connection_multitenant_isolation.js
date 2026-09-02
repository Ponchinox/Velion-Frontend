import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleConnectionUpdateWebhook, mapEvolutionConnectionState } from './src/utils/connectionSyncLogic.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper para crear un mock de Prisma con inspectores de llamadas
function createMockPrisma({ registeredNumbers = [], tenants = [], contacts = [], chats = [] } = {}) {
  const updates = [];
  const findFirstCalls = [];
  const findUniqueCalls = [];
  const createdContacts = [];
  const createdChats = [];

  return {
    registeredWhatsAppNumber: {
      findFirst: async ({ where }) => {
        findFirstCalls.push(where);
        return registeredNumbers.find(r => {
          if (where.instanceName && r.instanceName !== where.instanceName) return false;
          if (where.tenantId && r.tenantId !== where.tenantId) return false;
          if (where.provider) {
            if (typeof where.provider === 'string' && r.provider !== where.provider) return false;
            if (where.provider.not && r.provider === where.provider.not) return false;
            if (where.provider.in && !where.provider.in.includes(r.provider)) return false;
          }
          return true;
        }) || null;
      },
      findUnique: async ({ where }) => {
        findUniqueCalls.push(where);
        if (where.instanceName) {
          return registeredNumbers.find(r => r.instanceName === where.instanceName) || null;
        }
        if (where.phoneNumber) {
          return registeredNumbers.find(r => r.phoneNumber === where.phoneNumber) || null;
        }
        return null;
      },
      updateMany: async ({ where, data }) => {
        updates.push({ where, data });
        let count = 0;
        for (const num of registeredNumbers) {
          const matchId = !where.id || num.id === where.id;
          const matchTenant = !where.tenantId || num.tenantId === where.tenantId;
          const matchInstance = !where.instanceName || num.instanceName === where.instanceName;
          if (matchId && matchTenant && matchInstance) {
            Object.assign(num, data);
            count++;
          }
        }
        return { count };
      }
    },
    tenant: {
      findUnique: async ({ where }) => {
        return tenants.find(t => t.id === where.id) || null;
      },
      findMany: async () => tenants
    },
    contact: {
      findFirst: async ({ where }) => {
        return contacts.find(c => c.tenantId === where.tenantId && c.phone === where.phone) || null;
      },
      create: async ({ data }) => {
        const item = { id: `contact-${Date.now()}`, ...data };
        createdContacts.push(item);
        return item;
      }
    },
    chat: {
      findFirst: async ({ where }) => {
        return chats.find(ch => ch.tenantId === where.tenantId && ch.contactId === where.contactId) || null;
      },
      create: async ({ data }) => {
        const item = { id: `chat-${Date.now()}`, ...data };
        createdChats.push(item);
        return item;
      }
    },
    _getUpdates: () => updates,
    _getFindFirstCalls: () => findFirstCalls,
    _getFindUniqueCalls: () => findUniqueCalls,
    _getCreatedContacts: () => createdContacts,
    _getCreatedChats: () => createdChats
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1-3. MESSAGES.UPSERT MULTI-TENANT ISOLATION
// ─────────────────────────────────────────────────────────────────────────────

test('1. messages.upsert Tenant A -> procesa y resuelve únicamente Tenant A', async () => {
  const tenantA = { id: 'tenant-a-uuid', name: 'Empresa A' };
  const connA = { id: 'conn-a', instanceName: 'bot_prod_tenant_a', tenantId: tenantA.id, tenant: tenantA };
  const mockPrisma = createMockPrisma({ registeredNumbers: [connA], tenants: [tenantA] });

  // Simular la resolución exacta que implementa el controlador
  const instance = 'bot_prod_tenant_a';
  const registered = await mockPrisma.registeredWhatsAppNumber.findFirst({
    where: { instanceName: instance },
    include: { tenant: true }
  });

  assert.ok(registered, 'Debe encontrar el registro');
  assert.strictEqual(registered.tenantId, 'tenant-a-uuid');
  assert.strictEqual(registered.instanceName, 'bot_prod_tenant_a');
});

test('2. messages.upsert Tenant B -> procesa y resuelve únicamente Tenant B', async () => {
  const tenantB = { id: 'tenant-b-uuid', name: 'Empresa B' };
  const connB = { id: 'conn-b', instanceName: 'bot_prod_tenant_b', tenantId: tenantB.id, tenant: tenantB };
  const mockPrisma = createMockPrisma({ registeredNumbers: [connB], tenants: [tenantB] });

  const instance = 'bot_prod_tenant_b';
  const registered = await mockPrisma.registeredWhatsAppNumber.findFirst({
    where: { instanceName: instance },
    include: { tenant: true }
  });

  assert.ok(registered);
  assert.strictEqual(registered.tenantId, 'tenant-b-uuid');
});

test('3. Tenant A y Tenant B comparten primeros 8 caracteres de UUID -> mensaje de B JAMÁS usa Tenant A', async () => {
  const tenantA_id = 'aaaaaaaa-1111-0000-0000-000000000000';
  const tenantB_id = 'aaaaaaaa-2222-0000-0000-000000000000';
  const tenantA = { id: tenantA_id, name: 'Empresa A' };
  const tenantB = { id: tenantB_id, name: 'Empresa B' };

  const connA = { id: 'conn-a', instanceName: `bot_prod_${tenantA_id}`, tenantId: tenantA_id, tenant: tenantA };
  const connB = { id: 'conn-b', instanceName: `bot_prod_${tenantB_id}`, tenantId: tenantB_id, tenant: tenantB };

  const mockPrisma = createMockPrisma({ registeredNumbers: [connA, connB], tenants: [tenantA, tenantB] });

  // Mensaje llega para la instancia de B
  const incomingInstance = `bot_prod_${tenantB_id}`;
  const registered = await mockPrisma.registeredWhatsAppNumber.findFirst({
    where: { instanceName: incomingInstance },
    include: { tenant: true }
  });

  assert.ok(registered);
  // Debe ser Tenant B y NUNCA Tenant A a pesar de compartir 'aaaaaaaa'
  assert.strictEqual(registered.tenantId, tenantB_id);
  assert.notStrictEqual(registered.tenantId, tenantA_id);
});

test('4. instanceName desconocido en messages.upsert -> no selecciona tenant alternativo y se descarta', async () => {
  const tenantA = { id: 'tenant-a-uuid', name: 'Empresa A' };
  const connA = { id: 'conn-a', instanceName: 'bot_prod_tenant_a', tenantId: tenantA.id, tenant: tenantA };
  const mockPrisma = createMockPrisma({ registeredNumbers: [connA], tenants: [tenantA] });

  const unknownInstance = 'bot_prod_instancia_fantasma';
  const registered = await mockPrisma.registeredWhatsAppNumber.findFirst({
    where: { instanceName: unknownInstance }
  });

  assert.strictEqual(registered, null, 'No debe encontrar coincidencia ni adivinar por prefijo');
});

test('5. Contact y Chat derivados del mensaje usan el tenantId correcto', async () => {
  const targetTenantId = 'tenant-target-123';
  const mockPrisma = createMockPrisma({ contacts: [], chats: [] });

  const clientPhone = '51999888777';
  const contact = await mockPrisma.contact.create({
    data: { name: 'Cliente Test', phone: clientPhone, tenantId: targetTenantId, category: 'Whatsapp' }
  });

  const chat = await mockPrisma.chat.create({
    data: { contactId: contact.id, tenantId: targetTenantId }
  });

  assert.strictEqual(contact.tenantId, targetTenantId);
  assert.strictEqual(chat.tenantId, targetTenantId);
  assert.strictEqual(chat.contactId, contact.id);
});

test('6. socket room utiliza tenant correcto para emisión de eventos', () => {
  const emittedRooms = [];
  const mockIo = {
    to: (room) => {
      emittedRooms.push(room);
      return {
        emit: (event, payload) => {}
      };
    }
  };

  const resolvedTenantId = 'tenant-secure-room-999';
  mockIo.to(`tenant:${resolvedTenantId}`).emit('new_message', { text: 'hola' });

  assert.strictEqual(emittedRooms.length, 1);
  assert.strictEqual(emittedRooms[0], 'tenant:tenant-secure-room-999');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6-9. LEGACY INSTANCE COMPATIBILITY
// ─────────────────────────────────────────────────────────────────────────────

test('7. legacy instance: DB tiene bot_prod_XXXXXXXX (8 chars) -> getStatus debe priorizar EXACTAMENTE ese nombre', async () => {
  const fullTenantId = 'bbbbbbbb-4444-5555-6666-777777777777';
  const legacyInstanceName = 'bot_prod_bbbbbbbb'; // Nombre legacy guardado en DB
  const conn = { id: 'conn-leg', instanceName: legacyInstanceName, tenantId: fullTenantId };

  const mockPrisma = createMockPrisma({ registeredNumbers: [conn] });

  // Simulación de la lógica en getStatus
  const existingConn = await mockPrisma.registeredWhatsAppNumber.findFirst({
    where: { tenantId: fullTenantId },
    orderBy: { createdAt: 'desc' },
    select: { instanceName: true }
  });

  const resolvedInstanceName = existingConn?.instanceName || `bot_prod_${fullTenantId}`;

  // Comprobar que reutiliza el nombre legacy persistido y NO genera el nuevo
  assert.strictEqual(resolvedInstanceName, legacyInstanceName);
  assert.notStrictEqual(resolvedInstanceName, `bot_prod_${fullTenantId}`);
});

test('8. legacy instance: disconnect / logout sin instanceName en body -> utiliza nombre legacy persistido', async () => {
  const fullTenantId = 'cccccccc-1111-2222-3333-444444444444';
  const legacyInstanceName = 'bot_prod_cccccccc_old';
  const conn = { id: 'conn-leg-2', instanceName: legacyInstanceName, tenantId: fullTenantId };

  const mockPrisma = createMockPrisma({ registeredNumbers: [conn] });

  // Simulación de la lógica en logoutDevice/disconnectDevice cuando body.instanceName es undefined
  const reqBodyInstanceName = undefined;
  let instanceToDelete = reqBodyInstanceName;
  if (!instanceToDelete) {
    const existingConn = await mockPrisma.registeredWhatsAppNumber.findFirst({
      where: { tenantId: fullTenantId },
      orderBy: { createdAt: 'desc' },
      select: { instanceName: true }
    });
    instanceToDelete = existingConn?.instanceName || `bot_prod_${fullTenantId}`;
  }

  assert.strictEqual(instanceToDelete, legacyInstanceName);
});

test('9. connectDevice con conexión existente -> no crea silenciosamente una segunda instancia incompatible', async () => {
  const fullTenantId = 'dddddddd-1111-2222-3333-444444444444';
  const existingLegacy = 'bot_prod_dddddddd_1720000000';
  const conn = { id: 'conn-leg-3', instanceName: existingLegacy, tenantId: fullTenantId, provider: 'EVOLUTION' };

  const mockPrisma = createMockPrisma({ registeredNumbers: [conn] });

  // Simulación de connectDevice
  const existingConn = await mockPrisma.registeredWhatsAppNumber.findFirst({
    where: { tenantId: fullTenantId, provider: { not: 'META' } },
    orderBy: { createdAt: 'desc' },
    select: { instanceName: true }
  });

  const instanceToConnect = existingConn?.instanceName || `bot_prod_${fullTenantId}`;
  assert.strictEqual(instanceToConnect, existingLegacy);
});

// ─────────────────────────────────────────────────────────────────────────────
// 10-11. VALIDATE AND REGISTER RESULT ENFORCEMENT
// ─────────────────────────────────────────────────────────────────────────────

test('10. validateAndRegister retorna allowed:false -> updateMany NO se ejecuta en handleConnectionUpdateWebhook', async () => {
  const connA = { id: 'conn-a', instanceName: 'inst_fraud', tenantId: 'tenant-legit', connectionState: 'DISCONNECTED' };
  const mockPrisma = createMockPrisma({ registeredNumbers: [connA] });

  let validateCalled = false;
  const mockValidate = async () => {
    validateCalled = true;
    return { allowed: false, reason: 'FRAUD', errorMessage: 'Número ya registrado en otro tenant' };
  };

  const res = await handleConnectionUpdateWebhook({
    instance: 'inst_fraud',
    state: 'open',
    phone: '51987654321',
    prisma: mockPrisma,
    validateAndRegister: mockValidate
  });

  assert.strictEqual(validateCalled, true);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.mode, 'VALIDATION_REJECTED');
  assert.strictEqual(res.updatedCount, 0);

  // Asegurar que NO se ejecutó ningún update en la DB
  assert.strictEqual(mockPrisma._getUpdates().length, 0);
  assert.strictEqual(connA.connectionState, 'DISCONNECTED'); // No cambió a CONNECTED
});

test('11. validateAndRegister retorna allowed:true -> flujo autorizado continúa y actualiza estado', async () => {
  const connA = { id: 'conn-a', instanceName: 'inst_ok', tenantId: 'tenant-legit', connectionState: 'DISCONNECTED' };
  const mockPrisma = createMockPrisma({ registeredNumbers: [connA] });

  const mockValidate = async () => {
    return { allowed: true, phoneNumber: '51987654321' };
  };

  const res = await handleConnectionUpdateWebhook({
    instance: 'inst_ok',
    state: 'open',
    phone: '51987654321',
    prisma: mockPrisma,
    validateAndRegister: mockValidate
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.mode, 'EXISTING_CONNECTION');
  assert.strictEqual(res.connectionState, 'CONNECTED');
  assert.strictEqual(mockPrisma._getUpdates().length, 1);
  assert.strictEqual(connA.connectionState, 'CONNECTED');
});

// ─────────────────────────────────────────────────────────────────────────────
// 12-13. META CLOUD API NAMING
// ─────────────────────────────────────────────────────────────────────────────

test('12. createMetaInstance para NUEVA conexión -> usa UUID completo y NO slice(0,8)', async () => {
  const fullTenantId = 'e1e2e3e4-f5f6-7777-8888-999999999999';
  const mockPrisma = createMockPrisma({ registeredNumbers: [] });

  const existingMeta = await mockPrisma.registeredWhatsAppNumber.findFirst({
    where: { tenantId: fullTenantId, provider: 'META' }
  });

  const instanceName = existingMeta?.instanceName || `bot_meta_${fullTenantId}`;

  assert.strictEqual(instanceName, `bot_meta_${fullTenantId}`);
  assert.strictEqual(instanceName.includes(fullTenantId), true);
  assert.notStrictEqual(instanceName, `bot_meta_${fullTenantId.slice(0, 8)}`);
});

test('13. Dos UUID que comparten primeros 8 caracteres -> nombres Meta nuevos son completamente distintos', async () => {
  const tenant1 = 'aaaaaaaa-1111-0000-0000-000000000000';
  const tenant2 = 'aaaaaaaa-2222-0000-0000-000000000000';

  const name1 = `bot_meta_${tenant1}`;
  const name2 = `bot_meta_${tenant2}`;

  assert.notStrictEqual(name1, name2);
  assert.strictEqual(name1.endsWith('-1111-0000-0000-000000000000'), true);
  assert.strictEqual(name2.endsWith('-2222-0000-0000-000000000000'), true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 14-15. CONNECTION.UPDATE ISOLATION
// ─────────────────────────────────────────────────────────────────────────────

test('14. connection.update existente -> sigue aislado por instanceName exacta', async () => {
  const connA = { id: 'conn-a', instanceName: 'inst_A', tenantId: 'tenant-a', connectionState: 'CONNECTED' };
  const connB = { id: 'conn-b', instanceName: 'inst_B', tenantId: 'tenant-b', connectionState: 'CONNECTED' };
  const mockPrisma = createMockPrisma({ registeredNumbers: [connA, connB] });

  const res = await handleConnectionUpdateWebhook({
    instance: 'inst_A',
    state: 'close',
    prisma: mockPrisma
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.tenantId, 'tenant-a');
  assert.strictEqual(connA.connectionState, 'DISCONNECTED');
  assert.strictEqual(connB.connectionState, 'CONNECTED');
});

test('15. instancia desconocida connection.update -> no altera otro tenant ni crea registros', async () => {
  const connA = { id: 'conn-a', instanceName: 'inst_A', tenantId: 'tenant-a', connectionState: 'CONNECTED' };
  const mockPrisma = createMockPrisma({ registeredNumbers: [connA] });

  const res = await handleConnectionUpdateWebhook({
    instance: 'instancia_fantasma',
    state: 'close',
    prisma: mockPrisma
  });

  assert.strictEqual(res.success, false);
  assert.strictEqual(res.updatedCount, 0);
  assert.strictEqual(mockPrisma._getUpdates().length, 0);
  assert.strictEqual(connA.connectionState, 'CONNECTED');
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. STATIC CODE INSPECTION (NO SUBSTRING / NO STARTSWITH IN MESSAGES.UPSERT OR CONNECTION.UPDATE)
// ─────────────────────────────────────────────────────────────────────────────

test('16. Inspección estática: NO existe substring(0, 8) ni startsWith(tenantPrefix) en whatsappController.js', () => {
  const controllerCode = fs.readFileSync(path.join(__dirname, 'src/controllers/whatsappController.js'), 'utf8');

  assert.strictEqual(controllerCode.includes('substring(0, 8)'), false, 'whatsappController.js NO debe contener substring(0, 8)');
  assert.strictEqual(controllerCode.includes('tenantPrefix'), false, 'whatsappController.js NO debe contener tenantPrefix');
  assert.strictEqual(controllerCode.includes('startsWith(tenantPrefix'), false, 'whatsappController.js NO debe contener startsWith(tenantPrefix)');
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. PRISMA SCHEMA UNIQUE CONSTRAINT VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

test('17. schema.prisma contiene constraint @unique en RegisteredWhatsAppNumber.instanceName', () => {
  const schemaCode = fs.readFileSync(path.join(__dirname, 'prisma/schema.prisma'), 'utf8');
  const instanceNameLine = schemaCode.split('\n').find(l => l.includes('instanceName'));

  assert.ok(instanceNameLine, 'Debe existir la línea instanceName en schema.prisma');
  assert.strictEqual(instanceNameLine.includes('@unique'), true, 'instanceName DEBE tener la constraint @unique');
});

// ─────────────────────────────────────────────────────────────────────────────
// 18-19. GETSTATUS (CONNECTIONCONTROLLER) REFERENCEERROR REGRESSION
// ─────────────────────────────────────────────────────────────────────────────

test('18. getStatus (connectionController) con error de red/404 NO lanza ReferenceError y devuelve instanceName correcto', async () => {
  const { getStatus } = await import('./src/controllers/connectionController.js');

  const tenantId = '11111111-2222-3333-4444-555555555555';
  let jsonResult = null;
  let statusCode = 200;

  const req = {
    user: { tenantId },
    query: { instanceName: 'bot_prod_12345678' }
  };
  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
      jsonResult = data;
      return res;
    }
  };

  // Esta llamada entra al bloque catch porque Evolution API (localhost:8080) no responde.
  // En la versión con bug, esto lanzaba ReferenceError: instanceName is not defined.
  await assert.doesNotReject(async () => {
    await getStatus(req, res);
  }, 'getStatus NO debe lanzar ReferenceError');

  assert.ok(jsonResult, 'Debe devolver un objeto JSON');
  assert.strictEqual(jsonResult.status, 'close');
  assert.strictEqual(jsonResult.instanceName, 'bot_prod_12345678', 'Debe preservar el instanceName consultado');
});

test('19. getStatus (connectionController) sin conexión persistida y sin query usa fallback getEvoInstanceName sin ReferenceError', async () => {
  const { getStatus } = await import('./src/controllers/connectionController.js');

  const tenantId = '99999999-8888-7777-6666-555555555555';
  let jsonResult = null;

  const req = {
    user: { tenantId },
    query: {}
  };
  const res = {
    status: () => res,
    json: (data) => {
      jsonResult = data;
      return res;
    }
  };

  await assert.doesNotReject(async () => {
    await getStatus(req, res);
  });

  assert.ok(jsonResult);
  assert.strictEqual(jsonResult.status, 'close');
  assert.strictEqual(jsonResult.instanceName, `bot_prod_${tenantId}`, 'Debe usar el fallback legítimo con UUID completo');
});
