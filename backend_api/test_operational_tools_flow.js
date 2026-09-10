/**
 * ==============================================================================
 * VELION BUSINESS AGENT FASE 2B — OPERATIONAL TOOLS FLOW TESTS (T1–T30)
 * ==============================================================================
 * Suite exhaustiva de pruebas unitarias y de integración para la Fase 2B:
 * Conexión de Gemini con tools operacionales reales:
 *   1. register_operational_note
 *   2. create_operational_task
 *
 * Cobertura de pruebas:
 *   T1:  register_operational_note declaration existe.
 *   T2:  acepta category + summary + subjectName.
 *   T3:  no expone tenantId en declaración.
 *   T4:  no expone customerId ni campos privados en declaración.
 *   T5:  backend fuerza tenant.id autorizado (ignora inyecciones).
 *   T6:  backend fuerza customer.id autorizado (ignora inyecciones).
 *   T7:  backend fuerza chat.id autorizado (ignora inyecciones).
 *   T8:  backend fuerza sourceMessageId autorizado (ignora inyecciones).
 *   T9:  note success habilita confirmación verídica en prompt.
 *   T10: note failure prohíbe falsa confirmación (exige acuse de recibo).
 *   T11: saludo ("Hola") => CASUAL_OR_GREETING, prohibido crear tools.
 *   T12: agradecimiento ("Gracias", "👍") => anti-basura, sin tools.
 *   T13: precio ("¿Cuánto cuesta?") => SALES, prohíbe note.
 *   T14: solicitud humana ("Quiero hablar con una persona") => handoff, no task.
 *   T15: "Llámame mañana" => create_operational_task (FOLLOW_UP).
 *   T16: dueDaysOffset 1 => calcula fecha de mañana local.
 *   T17: sin hora => dueTimeLocal null.
 *   T18: sin hora => dueAt null.
 *   T19: mañana 17:00 => dueTimeLocal '17:00'.
 *   T20: dueAt cálculo UTC exacto en backend (America/Lima -> UTC).
 *   T21: Gemini no puede suministrar dueAt (backend ignora dueAt inyectado).
 *   T22: generation superseded => aborta con 0 mutaciones en DB.
 *   T23: double FC en misma sesión => dedupe idempotente sin duplicar filas.
 *   T24: same source message retry => idempotencia por dedupeKey.
 *   T25: IDs cross-tenant inyectados => fail closed / rechazado.
 *   T26: SERVICE intacto (sin cantidad forzada, sin shippingAddress).
 *   T27: PHYSICAL intacto (exige cantidad, coordina envío).
 *   T28: payment guards intactos (customerConfirmed, PAYMENT_VERIFIED no auto-PAID).
 *   T29: human handoff intacto (30m ventana, alert comercial).
 *   T30: new-message-during-generation guards intactos en todas las tools.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import {
  REGISTER_OPERATIONAL_NOTE_DECLARATION,
  CREATE_OPERATIONAL_TASK_DECLARATION,
  REQUEST_HUMAN_HANDOFF_DECLARATION,
  SEND_PRODUCT_MEDIA_DECLARATION,
  calculateDueDateLocal,
  calculateDueAtUtc,
  handleOperationalTool,
  getChatGenerationVersion,
  incrementChatGenerationVersion,
  _resetChatGenerationVersionsForTesting
} from './src/controllers/whatsappController.js';

console.log('======================================================================');
console.log('🧪 VELION BUSINESS AGENT FASE 2B — OPERATIONAL TOOLS FLOW (T1–T30)');
console.log('======================================================================\n');

let passedCount = 0;
let failedCount = 0;

async function runTest(testId, description, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: [${testId}] ${description}`);
    passedCount++;
  } catch (err) {
    console.error(`  ❌ FAIL: [${testId}] ${description}`);
    console.error(`     Error: ${err.message}`);
    failedCount++;
  }
}

// ─── IN-MEMORY PRISMA CLIENT MOCK ─────────────────────────────────────────────

function createMockPrisma() {
  const store = {
    tenants: new Map(),
    users: new Map(),
    customers: new Map(),
    contacts: new Map(),
    chats: new Map(),
    messages: new Map(),
    orders: new Map(),
    operationalItems: new Map()
  };

  return {
    _store: store,

    tenant: {
      findFirst: async ({ where }) => store.tenants.get(where?.id) || null,
      findUnique: async ({ where }) => store.tenants.get(where?.id) || null
    },
    user: {
      findFirst: async ({ where }) => {
        for (const u of store.users.values()) {
          if (where.id && u.id !== where.id) continue;
          if (where.tenantId && u.tenantId !== where.tenantId) continue;
          return u;
        }
        return null;
      }
    },
    customer: {
      findFirst: async ({ where }) => {
        for (const c of store.customers.values()) {
          if (where.id && c.id !== where.id) continue;
          if (where.tenantId && c.tenantId !== where.tenantId) continue;
          return c;
        }
        return null;
      }
    },
    contact: {
      findFirst: async ({ where }) => {
        for (const c of store.contacts.values()) {
          if (where.id && c.id !== where.id) continue;
          if (where.tenantId && c.tenantId !== where.tenantId) continue;
          return c;
        }
        return null;
      }
    },
    chat: {
      findFirst: async ({ where }) => {
        for (const ch of store.chats.values()) {
          if (where.id && ch.id !== where.id) continue;
          if (where.tenantId && ch.tenantId !== where.tenantId) continue;
          return ch;
        }
        return null;
      }
    },
    message: {
      findFirst: async ({ where }) => {
        for (const m of store.messages.values()) {
          if (where.id && m.id !== where.id) continue;
          if (where.tenantId && m.tenantId !== where.tenantId) continue;
          if (where.chatId && m.chatId !== where.chatId) continue;
          return m;
        }
        return null;
      }
    },
    order: {
      findFirst: async ({ where }) => {
        for (const o of store.orders.values()) {
          if (where.id && o.id !== where.id) continue;
          if (where.tenantId && o.tenantId !== where.tenantId) continue;
          return o;
        }
        return null;
      }
    },
    operationalItem: {
      create: async ({ data }) => {
        if (data.dedupeKey) {
          for (const item of store.operationalItems.values()) {
            if (item.tenantId === data.tenantId && item.dedupeKey === data.dedupeKey) {
              const err = new Error('Unique constraint failed on the fields: (tenantId, dedupeKey)');
              err.code = 'P2002';
              throw err;
            }
          }
        }
        const id = data.id || `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const newItem = {
          ...data,
          id,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        store.operationalItems.set(id, newItem);
        return newItem;
      },
      findFirst: async ({ where }) => {
        for (const item of store.operationalItems.values()) {
          if (where.id && item.id !== where.id) continue;
          if (where.tenantId && item.tenantId !== where.tenantId) continue;
          if (where.dedupeKey && item.dedupeKey !== where.dedupeKey) continue;
          return item;
        }
        return null;
      }
    }
  };
}

// ─── LECTURA ESTÁTICA DEL CONTROLADOR PARA VALIDACIÓN DE PROMPTS Y GUARDS ───
const controllerSource = fs.readFileSync('./backend_api/src/controllers/whatsappController.js', 'utf8');

async function main() {
  const mockDb = createMockPrisma();

  // Entidades autorizadas para pruebas
  const tenantA = { id: 'tenant-alpha-001', name: 'Alpha Academy' };
  const customerA = { id: 'cust-alpha-001', tenantId: tenantA.id, name: 'Mamá de Gustavito' };
  const contactA = { id: 'contact-alpha-001', tenantId: tenantA.id, phone: '51999111222' };
  const chatA = { id: 'chat-alpha-001', tenantId: tenantA.id, contactId: contactA.id };
  const messageA = { id: 'msg-alpha-001', tenantId: tenantA.id, chatId: chatA.id, content: 'Hoy Gustavito quiere practicar álgebra' };

  mockDb._store.tenants.set(tenantA.id, tenantA);
  mockDb._store.customers.set(customerA.id, customerA);
  mockDb._store.contacts.set(contactA.id, contactA);
  mockDb._store.chats.set(chatA.id, chatA);
  mockDb._store.messages.set(messageA.id, messageA);

  // ─────────────────────────────────────────────────────────────────────────────
  // T1: register_operational_note declaration existe
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T1', 'register_operational_note declaration existe y tiene nombre exacto', async () => {
    assert.ok(REGISTER_OPERATIONAL_NOTE_DECLARATION, 'Debe existir la declaración exportada');
    assert.strictEqual(REGISTER_OPERATIONAL_NOTE_DECLARATION.name, 'register_operational_note');
    assert.strictEqual(typeof REGISTER_OPERATIONAL_NOTE_DECLARATION.description, 'string');
    assert.ok(REGISTER_OPERATIONAL_NOTE_DECLARATION.description.length > 20);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T2: acepta category + summary + subjectName
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T2', 'register_operational_note acepta category, summary y subjectName opcional', async () => {
    const props = REGISTER_OPERATIONAL_NOTE_DECLARATION.parameters.properties;
    assert.ok(props.category, 'category debe existir en properties');
    assert.strictEqual(props.category.type, 'STRING');
    assert.ok(Array.isArray(props.category.enum));
    assert.ok(props.category.enum.includes('COORDINATION'));
    assert.ok(props.category.enum.includes('ATTENDANCE'));
    assert.ok(props.category.enum.includes('SERVICE_INSTRUCTION'));
    assert.ok(props.summary, 'summary debe existir en properties');
    assert.strictEqual(props.summary.type, 'STRING');
    assert.ok(props.subjectName, 'subjectName debe existir en properties');
    assert.strictEqual(props.subjectName.type, 'STRING');
    assert.deepStrictEqual(REGISTER_OPERATIONAL_NOTE_DECLARATION.parameters.required, ['category', 'summary']);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T3: no expone tenantId
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T3', 'Ninguna tool operacional expone tenantId en su esquema LLM', async () => {
    assert.strictEqual(REGISTER_OPERATIONAL_NOTE_DECLARATION.parameters.properties.tenantId, undefined);
    assert.strictEqual(CREATE_OPERATIONAL_TASK_DECLARATION.parameters.properties.tenantId, undefined);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T4: no expone customerId ni campos privados
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T4', 'No expone customerId, contactId, chatId, sourceMessageId, dedupeKey ni dueAt', async () => {
    const noteProps = REGISTER_OPERATIONAL_NOTE_DECLARATION.parameters.properties;
    const taskProps = CREATE_OPERATIONAL_TASK_DECLARATION.parameters.properties;
    const forbidden = ['customerId', 'contactId', 'chatId', 'sourceMessageId', 'orderId', 'status', 'dedupeKey', 'createdByUserId', 'dueAt'];

    for (const field of forbidden) {
      assert.strictEqual(noteProps[field], undefined, `NOTE no debe exponer ${field}`);
      assert.strictEqual(taskProps[field], undefined, `TASK no debe exponer ${field}`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T5: backend fuerza tenant.id
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T5', 'Backend fuerza tenant.id autorizado e ignora tenantId inyectado en args', async () => {
    const res = await handleOperationalTool('register_operational_note', {
      tenantId: 'attacker-evil-tenant',
      category: 'COORDINATION',
      summary: 'Hoy Gustavito practica álgebra',
      subjectName: 'Gustavito'
    }, {
      tenant: tenantA,
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: messageA.id,
      prismaClient: mockDb
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.itemId);
    const created = mockDb._store.operationalItems.get(res.itemId);
    assert.strictEqual(created.tenantId, tenantA.id, 'tenantId DEBE ser el del contexto backend');
    assert.notStrictEqual(created.tenantId, 'attacker-evil-tenant');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T6: backend fuerza customer.id
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T6', 'Backend fuerza customer.id autorizado e ignora customerId inyectado', async () => {
    const res = await handleOperationalTool('register_operational_note', {
      customerId: 'attacker-customer-id',
      category: 'SERVICE_INSTRUCTION',
      summary: 'Preferencia de metodología',
      subjectName: 'Gustavito'
    }, {
      tenant: tenantA,
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: messageA.id,
      prismaClient: mockDb
    });

    assert.strictEqual(res.success, true);
    const created = mockDb._store.operationalItems.get(res.itemId);
    assert.strictEqual(created.customerId, customerA.id);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T7: backend fuerza chat.id
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T7', 'Backend fuerza chat.id autorizado e ignora chatId inyectado', async () => {
    const res = await handleOperationalTool('register_operational_note', {
      chatId: 'attacker-chat-id',
      category: 'ATTENDANCE',
      summary: 'Llegará 10 minutos tarde',
      subjectName: 'Gustavito'
    }, {
      tenant: tenantA,
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: messageA.id,
      prismaClient: mockDb
    });

    assert.strictEqual(res.success, true);
    const created = mockDb._store.operationalItems.get(res.itemId);
    assert.strictEqual(created.chatId, chatA.id);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T8: backend fuerza sourceMessageId
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T8', 'Backend fuerza sourceMessageId autorizado e ignora valor en args', async () => {
    const res = await handleOperationalTool('register_operational_note', {
      sourceMessageId: 'fake-message-id',
      category: 'GENERAL',
      summary: 'Aviso general para el tutor'
    }, {
      tenant: tenantA,
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: messageA.id,
      prismaClient: mockDb
    });

    assert.strictEqual(res.success, true);
    const created = mockDb._store.operationalItems.get(res.itemId);
    assert.strictEqual(created.sourceMessageId, messageA.id);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T9: note success permite confirmación
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T9', 'Note success retorna payload compacto y el prompt autoriza confirmación verídica', async () => {
    const res = await handleOperationalTool('register_operational_note', {
      category: 'COORDINATION',
      summary: 'Hoy Gustavito practica física',
      subjectName: 'Gustavito'
    }, {
      tenant: tenantA,
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: messageA.id,
      prismaClient: mockDb
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.type, 'NOTE');
    assert.strictEqual(res.category, 'COORDINATION');
    assert.ok(res.itemId);
    assert.ok(controllerSource.includes('Solo si la herramienta retorna éxito (success: true) puedes afirmar: "Listo, quedó registrado para el equipo."'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T10: note failure prohíbe falsa confirmación
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T10', 'Note failure retorna success:false y el prompt prohíbe afirmar guardado', async () => {
    const res = await handleOperationalTool('register_operational_note', {
      category: 'COORDINATION',
      summary: '' // Vacío => falla
    }, {
      tenant: tenantA,
      customer: customerA,
      contact: contactA,
      chat: chatA,
      prismaClient: mockDb
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'SUMMARY_REQUIRED');
    assert.ok(controllerSource.includes('Si la herramienta falla o no se ejecuta, NUNCA afirmes falsamente que se guardó. En su lugar responde con acuse de recibo: "Entendido, el mensaje queda visible aquí en la conversación para que el equipo pueda revisarlo."'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T11: saludo => no operational tool
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T11', 'Prompt prohíbe taxativamente crear notas o tareas ante saludos casuales', async () => {
    assert.ok(controllerSource.includes('8. CASUAL_OR_GREETING: Saludos de cortesía ("Hola", "Buen día profesor", "Gracias") sin requerimiento activo.'));
    assert.ok(controllerSource.includes('CASUAL / SALUDO ("Hola", "Profesor buen día"): Responde de forma cordial, corta y atenta. NO menciones precios ni productos. PROHIBIDO crear notas o tareas.'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T12: agradecimiento => no tool
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T12', 'Anti-basura prohíbe tools ante agradecimientos ("Gracias", "Ok", "👍")', async () => {
    assert.ok(controllerSource.includes('ANTI-BASURA: PROHIBIDO invocar \'register_operational_note\' o \'create_operational_task\' ante saludos ("Hola"), agradecimientos ("Gracias", "Ok", "👍")'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T13: precio => SALES, no note
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T13', 'Consultas de precio activan SALES y prohíben crear OperationalItems', async () => {
    assert.ok(controllerSource.includes('1. SALES: Consultas directas de precios, catálogo, características de compra'));
    assert.ok(controllerSource.includes('PRINCIPIO CARDINAL: NO conviertas automáticamente cada conversación en una venta.'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T14: solicitud humana => handoff, no task
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T14', '"Quiero hablar con una persona" invoca request_human_handoff, no task', async () => {
    assert.ok(controllerSource.includes('"Quiero hablar con una persona": Usa \'request_human_handoff\', NUNCA \'create_operational_task\'.'));
    assert.strictEqual(REQUEST_HUMAN_HANDOFF_DECLARATION.name, 'request_human_handoff');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T15: "Llámame mañana" => TASK
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T15', '"Llámame mañana" corresponde a create_operational_task sin handoff inmediato', async () => {
    assert.ok(controllerSource.includes('"Llámame mañana": Usa \'create_operational_task\', NO transferir de inmediato con \'request_human_handoff\'.'));
    assert.strictEqual(CREATE_OPERATIONAL_TASK_DECLARATION.name, 'create_operational_task');
    assert.ok(CREATE_OPERATIONAL_TASK_DECLARATION.parameters.properties.dueDaysOffset);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T16: dueDaysOffset 1 => mañana
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T16', 'dueDaysOffset 1 genera la fecha de mañana en timezone especificado', async () => {
    const fixedBase = new Date('2026-09-06T15:00:00Z'); // Mediodía Lima (2026-09-06)
    const dueDate = calculateDueDateLocal(1, 'America/Lima', fixedBase);
    assert.strictEqual(dueDate, '2026-09-07');

    const dueToday = calculateDueDateLocal(0, 'America/Lima', fixedBase);
    assert.strictEqual(dueToday, '2026-09-06');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T17: sin hora => dueTimeLocal null
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T17', 'create_operational_task sin hora asigna dueTimeLocal null sin inventar hora', async () => {
    const res = await handleOperationalTool('create_operational_task', {
      category: 'FOLLOW_UP',
      summary: 'Llamar al cliente para coordinar matrícula',
      dueDaysOffset: 1
      // dueTime no enviado
    }, {
      tenant: tenantA,
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: messageA.id,
      prismaClient: mockDb
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.type, 'TASK');
    assert.strictEqual(res.dueTime, null);
    const created = mockDb._store.operationalItems.get(res.itemId);
    assert.strictEqual(created.dueTimeLocal, null);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T18: sin hora => dueAt null
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T18', 'create_operational_task sin hora deja dueAt estrictamente null', async () => {
    const created = Array.from(mockDb._store.operationalItems.values()).pop();
    assert.strictEqual(created.dueAt, null);
    assert.strictEqual(calculateDueAtUtc('2026-09-07', null, 'America/Lima'), null);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T19: mañana 17:00 => dueTimeLocal 17:00
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T19', 'create_operational_task con 17:00 asigna dueTimeLocal 17:00', async () => {
    const res = await handleOperationalTool('create_operational_task', {
      category: 'FOLLOW_UP',
      summary: 'Llamar mañana a las 5',
      dueDaysOffset: 1,
      dueTime: '17:00'
    }, {
      tenant: tenantA,
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: messageA.id,
      prismaClient: mockDb
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.dueTime, '17:00');
    const created = mockDb._store.operationalItems.get(res.itemId);
    assert.strictEqual(created.dueTimeLocal, '17:00');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T20: dueAt backend correcto
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T20', 'dueAt UTC exacto: 2026-09-07 17:00 America/Lima => 2026-09-07T22:00:00.000Z', async () => {
    const dueAt = calculateDueAtUtc('2026-09-07', '17:00', 'America/Lima');
    assert.ok(dueAt instanceof Date);
    assert.strictEqual(dueAt.toISOString(), '2026-09-07T22:00:00.000Z');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T21: Gemini no puede enviar dueAt
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T21', 'Gemini no puede enviar dueAt (backend ignora dueAt inyectado)', async () => {
    const res = await handleOperationalTool('create_operational_task', {
      category: 'FOLLOW_UP',
      summary: 'Llamar a las 5',
      dueDaysOffset: 1,
      dueTime: '17:00',
      dueAt: '1999-01-01T00:00:00Z' // Inyectado
    }, {
      tenant: tenantA,
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: messageA.id,
      prismaClient: mockDb
    });

    assert.strictEqual(res.success, true);
    const created = mockDb._store.operationalItems.get(res.itemId);
    // El dueAt real debe ser calculado por backend (22:00 UTC), jamás el 1999 inyectado
    const expectedDueAt = calculateDueAtUtc(calculateDueDateLocal(1, 'America/Lima'), '17:00', 'America/Lima');
    assert.strictEqual(created.dueAt.toISOString(), expectedDueAt.toISOString());
    assert.notStrictEqual(created.dueAt.toISOString(), '1999-01-01T00:00:00.000Z');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T22: generation superseded => 0 mutation
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T22', 'isGenerationSuperseded aborta con error GENERATION_SUPERSEDED y 0 mutaciones', async () => {
    const itemsCountBefore = mockDb._store.operationalItems.size;

    const res = await handleOperationalTool('register_operational_note', {
      category: 'COORDINATION',
      summary: 'Nota durante colisión'
    }, {
      tenant: tenantA,
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: messageA.id,
      isGenerationSuperseded: () => true, // Simulamos llegada de mensaje nuevo
      prismaClient: mockDb
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'GENERATION_SUPERSEDED');
    assert.strictEqual(mockDb._store.operationalItems.size, itemsCountBefore, 'No debió crearse ningún registro en DB');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T23: double FC => dedupe
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T23', 'Doble invocación de tool con mismos datos retorna item deduplicado sin error', async () => {
    const msgUnique = { id: 'msg-unique-t23', tenantId: tenantA.id, chatId: chatA.id };
    mockDb._store.messages.set(msgUnique.id, msgUnique);

    const call1 = await handleOperationalTool('register_operational_note', {
      category: 'COORDINATION',
      summary: 'Dedupe test note'
    }, {
      tenant: tenantA,
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: msgUnique.id,
      prismaClient: mockDb
    });

    const call2 = await handleOperationalTool('register_operational_note', {
      category: 'COORDINATION',
      summary: 'Dedupe test note'
    }, {
      tenant: tenantA,
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: msgUnique.id,
      prismaClient: mockDb
    });

    assert.strictEqual(call1.success, true);
    assert.strictEqual(call2.success, true);
    assert.strictEqual(call1.itemId, call2.itemId, 'Ambas llamadas deben referenciar al mismo ID');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T24: same source message retry => one item
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T24', 'Reintento sobre el mismo sourceMessageId no crea fila duplicada', async () => {
    const msgRetry = { id: 'msg-retry-t24', tenantId: tenantA.id, chatId: chatA.id };
    mockDb._store.messages.set(msgRetry.id, msgRetry);

    const res1 = await handleOperationalTool('create_operational_task', {
      category: 'FOLLOW_UP',
      summary: 'Llamar mañana por la tarde',
      dueDaysOffset: 1
    }, {
      tenant: tenantA,
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: msgRetry.id,
      prismaClient: mockDb
    });

    const res2 = await handleOperationalTool('create_operational_task', {
      category: 'FOLLOW_UP',
      summary: 'Llamar mañana por la tarde',
      dueDaysOffset: 1
    }, {
      tenant: tenantA,
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: msgRetry.id,
      prismaClient: mockDb
    });

    assert.strictEqual(res1.itemId, res2.itemId);
    const matches = Array.from(mockDb._store.operationalItems.values()).filter(i => i.sourceMessageId === msgRetry.id);
    assert.strictEqual(matches.length, 1, 'Debe existir exactamente 1 fila en BD para ese mensaje');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T25: IDs cross-tenant inyectados => ignorados/fail closed
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T25', 'Inyección de customer cross-tenant es bloqueada de forma fail-closed', async () => {
    const tenantOther = { id: 'tenant-beta-999' };
    const customerOther = { id: 'cust-beta-999', tenantId: tenantOther.id };
    mockDb._store.customers.set(customerOther.id, customerOther);

    // Intentar asociar customerOther (Tenant B) al Tenant A
    const res = await handleOperationalTool('register_operational_note', {
      category: 'GENERAL',
      summary: 'Intento de fuga cross-tenant'
    }, {
      tenant: tenantA,
      customer: customerOther, // Perteneciente a otro tenant
      contact: contactA,
      chat: chatA,
      sourceMessageId: messageA.id,
      prismaClient: mockDb
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'NOTE_REGISTRATION_FAILED');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T26: SERVICE intacto
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T26', 'Flujo comercial de SERVICE permanece intacto en guardrails', async () => {
    assert.ok(controllerSource.includes('SERVICIO / PROGRAMA (SERVICE): Aplica a academias, cursos, programas, talleres'));
    assert.ok(controllerSource.includes('PROHIBIDO preguntar "¿cuántas unidades deseas?" o asumir vacantes/accesos.'));
    assert.ok(controllerSource.includes('NUNCA guardes shippingCity ni shippingAddress para un SERVICE, ni uses SHIPPING_COORDINATED.'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T27: PHYSICAL intacto
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T27', 'Flujo comercial de PHYSICAL_PRODUCT permanece intacto en guardrails', async () => {
    assert.ok(controllerSource.includes('PRODUCTO FÍSICO (PHYSICAL_PRODUCT): Si el cliente no indicó cuántas unidades desea, pregúntale amablemente cuántas unidades desea llevar.'));
    assert.ok(controllerSource.includes('NUNCA asumas quantity=1 en productos físicos sin confirmación.'));
    assert.ok(controllerSource.includes('Requiere coordinar envío/entrega física'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T28: payment guards intactos
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T28', 'Guardrails de pago permanecen intactos (nunca PAID sin verificación)', async () => {
    assert.ok(controllerSource.includes('VERIFICACIÓN DE PAGO: Que el cliente diga "ya pagué", "te envié el comprobante" o adjunte una foto NO significa que el pago esté verificado.'));
    assert.ok(controllerSource.includes('La IA solo puede registrar PAYMENT_VERIFIED (revisión humana requerida). La IA NUNCA marca pagos como PAID'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T29: human handoff intacto
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T29', 'Declaración y comportamiento de request_human_handoff permanecen intactos', async () => {
    assert.strictEqual(REQUEST_HUMAN_HANDOFF_DECLARATION.name, 'request_human_handoff');
    assert.ok(controllerSource.includes('HUMAN HANDOFF: ventana de pausa manual (30 minutos)'));
    assert.ok(controllerSource.includes('TRANSFERENCIA HUMANA: SOLO llama a \'request_human_handoff\' si el cliente lo pide DIRECTAMENTE'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T30: new-message-during-generation intacto
  // ─────────────────────────────────────────────────────────────────────────────
  await runTest('T30', 'Versioning de chat e interrupción de generación permanecen operativos', async () => {
    _resetChatGenerationVersionsForTesting();
    const chatKey = 'tenant-alpha-001:51999111222';
    assert.strictEqual(getChatGenerationVersion(chatKey), 0);
    const v1 = incrementChatGenerationVersion(chatKey);
    assert.strictEqual(v1, 1);
    assert.strictEqual(getChatGenerationVersion(chatKey), 1);
    assert.ok(controllerSource.includes('funcName === \'register_operational_note\' || funcName === \'create_operational_task\''));
  });

  console.log('\n======================================================================');
  console.log(`RESULTADOS T1–T30: ${passedCount} pasaron, ${failedCount} fallaron.`);
  console.log('======================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error fatal ejecutando suite T1–T30:', err);
  process.exit(1);
});
