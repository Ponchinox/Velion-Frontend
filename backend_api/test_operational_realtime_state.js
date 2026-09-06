/**
 * ==============================================================================
 * VELION BUSINESS AGENT — FASE 2D-A TEST SUITE (D1–D30)
 * OPERATIONAL REALTIME + TASK STATE MACHINE
 * ==============================================================================
 */

import assert from 'assert';
import {
  createOperationalItem,
  getOperationalItemById,
  startOperationalTask,
  completeOperationalTask,
  cancelOperationalTask,
  archiveOperationalNote,
  updateOperationalItem
} from './src/services/operationalItemService.js';
import {
  sanitizeOperationalItemForSocket,
  emitOperationalItemCreated,
  emitOperationalItemUpdated
} from './src/services/operationalItemEventService.js';
import {
  getItems,
  getItemById,
  createItem,
  updateItem,
  startItem,
  completeItem,
  archiveItem,
  cancelItem
} from './src/controllers/operationalItemController.js';
import operationalItemRoutes from './src/routes/operationalItemRoutes.js';
import { handleOperationalTool } from './src/controllers/whatsappController.js';

console.log('🧪 ============================================================');
console.log('🧪 VELION BUSINESS AGENT FASE 2D-A — REALTIME & STATE (D1-D30)');
console.log('🧪 ============================================================\n');

// ─── MOCK PRISMA IN-MEMORY ───────────────────────────────────────────────────

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
      findFirst: async ({ where }) => store.tenants.get(where.id) || null
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
      },
      findMany: async ({ where, take = 50, skip = 0, orderBy }) => {
        let items = Array.from(store.operationalItems.values()).filter(item => {
          if (where.tenantId && item.tenantId !== where.tenantId) return false;
          if (where.type && item.type !== where.type) return false;
          if (where.status && item.status !== where.status) return false;
          if (where.chatId && item.chatId !== where.chatId) return false;
          if (where.customerId && item.customerId !== where.customerId) return false;
          if (where.category && item.category !== where.category) return false;
          if (where.dueDateLocal && item.dueDateLocal !== where.dueDateLocal) return false;
          return true;
        });
        if (orderBy) {
          const field = Object.keys(orderBy)[0];
          const dir = orderBy[field];
          items.sort((a, b) => {
            const valA = a[field] || '';
            const valB = b[field] || '';
            if (dir === 'asc') return valA > valB ? 1 : -1;
            return valA < valB ? 1 : -1;
          });
        }
        return items.slice(skip, skip + take);
      },
      count: async ({ where }) => {
        return Array.from(store.operationalItems.values()).filter(item => {
          if (where.tenantId && item.tenantId !== where.tenantId) return false;
          if (where.type && item.type !== where.type) return false;
          if (where.status && item.status !== where.status) return false;
          if (where.chatId && item.chatId !== where.chatId) return false;
          if (where.customerId && item.customerId !== where.customerId) return false;
          if (where.category && item.category !== where.category) return false;
          if (where.dueDateLocal && item.dueDateLocal !== where.dueDateLocal) return false;
          return true;
        }).length;
      },
      update: async ({ where, data }) => {
        const item = store.operationalItems.get(where.id);
        if (!item) throw new Error('Record to update not found.');
        const updated = {
          ...item,
          ...data,
          updatedAt: new Date()
        };
        store.operationalItems.set(where.id, updated);
        return updated;
      }
    }
  };
}

// ─── MOCK SOCKET.IO ──────────────────────────────────────────────────────────

function createMockIo() {
  const emittedEvents = [];
  return {
    emittedEvents,
    to(room) {
      return {
        emit: (eventName, payload) => {
          emittedEvents.push({ room, eventName, payload });
        }
      };
    },
    reset() {
      emittedEvents.length = 0;
    }
  };
}

// ─── MOCK HTTP INVOCATION HELPER ─────────────────────────────────────────────

function createMockResponse() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
  return res;
}

async function invokeController(fn, req) {
  const res = createMockResponse();
  await fn(req, res);
  return { status: res.statusCode, body: res.body };
}

// ─── SUITE PRINCIPAL D1–D30 ──────────────────────────────────────────────────

async function runTests() {
  let passed = 0;
  const total = 30;

  const mockPrisma = createMockPrisma();
  const mockIo = createMockIo();
  global.io = mockIo;

  // Tenants y Users de prueba
  const tenantA = 'tenant_alpha';
  const tenantB = 'tenant_beta';

  const userA = { id: 'usr_alpha_1', tenantId: tenantA, email: 'alpha1@velion.pe', role: 'ADMIN' };
  const userA2 = { id: 'usr_alpha_2', tenantId: tenantA, email: 'alpha2@velion.pe', role: 'OPERATOR' };
  const userB = { id: 'usr_beta_1', tenantId: tenantB, email: 'beta1@velion.pe', role: 'ADMIN' };

  mockPrisma._store.tenants.set(tenantA, { id: tenantA, name: 'Alpha Corp' });
  mockPrisma._store.tenants.set(tenantB, { id: tenantB, name: 'Beta Corp' });

  mockPrisma._store.users.set(userA.id, userA);
  mockPrisma._store.users.set(userA2.id, userA2);
  mockPrisma._store.users.set(userB.id, userB);

  const customerA = { id: 'cust_alpha_1', tenantId: tenantA, name: 'Alpha Customer' };
  const contactA = { id: 'cnt_alpha_1', tenantId: tenantA, phone: '51999888777' };
  const chatA = { id: 'chat_alpha_1', tenantId: tenantA, contactId: contactA.id };

  mockPrisma._store.customers.set(customerA.id, customerA);
  mockPrisma._store.contacts.set(contactA.id, contactA);
  mockPrisma._store.chats.set(chatA.id, chatA);

  const testMessages = [
    'msg_ai_note_d21',
    'msg_ai_task_d22',
    'msg_ai_task_d23',
    'msg_ai_note_d24_dedupe',
    'msg_ai_task_d25_dedupe',
    'msg_ai_task_d27_nosocket'
  ];
  for (const mid of testMessages) {
    mockPrisma._store.messages.set(mid, { id: mid, tenantId: tenantA, chatId: chatA.id, content: 'Contenido mensaje' });
  }

  // Helper para crear requests autenticados
  function buildReq({ user = userA, params = {}, query = {}, body = {}, io = mockIo } = {}) {
    return {
      user,
      params,
      query,
      body,
      io,
      prismaClient: mockPrisma
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D1. PENDING TASK -> start -> IN_PROGRESS
  // ───────────────────────────────────────────────────────────────────────────
  let taskD1;
  {
    const res = await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'FOLLOW_UP',
      summary: 'D1: Tarea pendiente para iniciar',
      dueDateLocal: '2026-09-10',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma });
    taskD1 = res.item;
    assert.strictEqual(taskD1.status, 'PENDING');

    const started = await startOperationalTask({
      tenantId: tenantA,
      id: taskD1.id,
      userId: userA.id
    }, { prismaClient: mockPrisma });

    assert.strictEqual(started.status, 'IN_PROGRESS', 'D1: Estado debe transicionar a IN_PROGRESS');
    passed++;
    console.log('  ✅ PASS: [D1] PENDING TASK -> start -> IN_PROGRESS');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D2. IN_PROGRESS start otra vez => idempotente
  // ───────────────────────────────────────────────────────────────────────────
  {
    const reStarted = await startOperationalTask({
      tenantId: tenantA,
      id: taskD1.id,
      userId: userA.id
    }, { prismaClient: mockPrisma });

    assert.strictEqual(reStarted.status, 'IN_PROGRESS', 'D2: Re-start debe ser idempotente');
    assert.strictEqual(reStarted.id, taskD1.id);
    passed++;
    console.log('  ✅ PASS: [D2] IN_PROGRESS start otra vez => idempotente');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D3. COMPLETED start => reject
  // ───────────────────────────────────────────────────────────────────────────
  {
    const completed = await completeOperationalTask({
      tenantId: tenantA,
      id: taskD1.id,
      userId: userA.id
    }, { prismaClient: mockPrisma });
    assert.strictEqual(completed.status, 'COMPLETED');

    await assert.rejects(
      async () => {
        await startOperationalTask({
          tenantId: tenantA,
          id: taskD1.id,
          userId: userA.id
        }, { prismaClient: mockPrisma });
      },
      /INVALID_TASK_TRANSITION/,
      'D3: No se puede iniciar una tarea COMPLETED'
    );
    passed++;
    console.log('  ✅ PASS: [D3] COMPLETED start => reject');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D4. CANCELED start => reject
  // ───────────────────────────────────────────────────────────────────────────
  {
    const taskCancel = (await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'COORDINATION',
      summary: 'D4: Tarea para cancelar e intentar iniciar',
      dueDateLocal: '2026-09-10',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    await cancelOperationalTask({ tenantId: tenantA, id: taskCancel.id }, { prismaClient: mockPrisma });

    await assert.rejects(
      async () => {
        await startOperationalTask({
          tenantId: tenantA,
          id: taskCancel.id,
          userId: userA.id
        }, { prismaClient: mockPrisma });
      },
      /INVALID_TASK_TRANSITION/,
      'D4: No se puede iniciar una tarea CANCELED'
    );
    passed++;
    console.log('  ✅ PASS: [D4] CANCELED start => reject');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D5. NOTE start => reject
  // ───────────────────────────────────────────────────────────────────────────
  {
    const noteD5 = (await createOperationalItem({
      tenantId: tenantA,
      type: 'NOTE',
      category: 'GENERAL',
      summary: 'D5: Nota operacional',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    await assert.rejects(
      async () => {
        await startOperationalTask({
          tenantId: tenantA,
          id: noteD5.id,
          userId: userA.id
        }, { prismaClient: mockPrisma });
      },
      /CANNOT_START_NON_TASK/,
      'D5: Iniciar una NOTE debe ser rechazado con CANNOT_START_NON_TASK'
    );
    passed++;
    console.log('  ✅ PASS: [D5] NOTE start => reject');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D6. PENDING -> complete => COMPLETED
  // ───────────────────────────────────────────────────────────────────────────
  {
    const taskD6 = (await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'FOLLOW_UP',
      summary: 'D6: Tarea directa PENDING a COMPLETED',
      dueDateLocal: '2026-09-10',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    const completed = await completeOperationalTask({
      tenantId: tenantA,
      id: taskD6.id,
      userId: userA.id
    }, { prismaClient: mockPrisma });

    assert.strictEqual(completed.status, 'COMPLETED', 'D6: Transición directa PENDING -> COMPLETED válida');
    assert.ok(completed.completedAt instanceof Date || typeof completed.completedAt === 'string');
    assert.strictEqual(completed.completedByUserId, userA.id);
    passed++;
    console.log('  ✅ PASS: [D6] PENDING -> complete => COMPLETED');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D7. IN_PROGRESS -> complete => COMPLETED
  // ───────────────────────────────────────────────────────────────────────────
  {
    const taskD7 = (await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'COORDINATION',
      summary: 'D7: Tarea IN_PROGRESS a COMPLETED',
      dueDateLocal: '2026-09-10',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    await startOperationalTask({ tenantId: tenantA, id: taskD7.id, userId: userA.id }, { prismaClient: mockPrisma });

    const completed = await completeOperationalTask({
      tenantId: tenantA,
      id: taskD7.id,
      userId: userA2.id
    }, { prismaClient: mockPrisma });

    assert.strictEqual(completed.status, 'COMPLETED', 'D7: IN_PROGRESS -> COMPLETED válida');
    assert.strictEqual(completed.completedByUserId, userA2.id);
    passed++;
    console.log('  ✅ PASS: [D7] IN_PROGRESS -> complete => COMPLETED');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D8. CANCELED -> complete => reject
  // ───────────────────────────────────────────────────────────────────────────
  {
    const taskD8 = (await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'SUPPORT',
      summary: 'D8: Tarea cancelada no se puede completar',
      dueDateLocal: '2026-09-10',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    await cancelOperationalTask({ tenantId: tenantA, id: taskD8.id }, { prismaClient: mockPrisma });

    await assert.rejects(
      async () => {
        await completeOperationalTask({
          tenantId: tenantA,
          id: taskD8.id,
          userId: userA.id
        }, { prismaClient: mockPrisma });
      },
      /INVALID_TASK_TRANSITION/,
      'D8: Tarea CANCELED no puede completarse'
    );
    passed++;
    console.log('  ✅ PASS: [D8] CANCELED -> complete => reject');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D9. COMPLETED -> complete => no sobrescribe completedAt
  // ───────────────────────────────────────────────────────────────────────────
  let completedInitialTimestamp;
  let taskD9;
  {
    taskD9 = (await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'FOLLOW_UP',
      summary: 'D9: Tarea completada para probar preservación de timestamp',
      dueDateLocal: '2026-09-10',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    const firstComplete = await completeOperationalTask({
      tenantId: tenantA,
      id: taskD9.id,
      userId: userA.id
    }, { prismaClient: mockPrisma });

    completedInitialTimestamp = firstComplete.completedAt;
    assert.ok(completedInitialTimestamp, 'completedAt debe existir');

    // Esperar un pequeño delta de reloj y volver a invocar complete
    const secondComplete = await completeOperationalTask({
      tenantId: tenantA,
      id: taskD9.id,
      userId: userA.id
    }, { prismaClient: mockPrisma });

    assert.strictEqual(
      secondComplete.completedAt.toString(),
      completedInitialTimestamp.toString(),
      'D9: completedAt no debe ser reescrito'
    );
    passed++;
    console.log('  ✅ PASS: [D9] COMPLETED -> complete => no sobrescribe completedAt');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D10. COMPLETED -> complete => no sobrescribe completedByUserId
  // ───────────────────────────────────────────────────────────────────────────
  {
    const thirdComplete = await completeOperationalTask({
      tenantId: tenantA,
      id: taskD9.id,
      userId: userA2.id // Intentar completar con otro usuario
    }, { prismaClient: mockPrisma });

    assert.strictEqual(
      thirdComplete.completedByUserId,
      userA.id,
      'D10: completedByUserId original debe ser preservado autoritativamente'
    );
    passed++;
    console.log('  ✅ PASS: [D10] COMPLETED -> complete => no sobrescribe completedByUserId');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D11. PENDING -> cancel => CANCELED
  // ───────────────────────────────────────────────────────────────────────────
  {
    const taskD11 = (await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'COORDINATION',
      summary: 'D11: PENDING a CANCELED',
      dueDateLocal: '2026-09-11',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    const canceled = await cancelOperationalTask({ tenantId: tenantA, id: taskD11.id }, { prismaClient: mockPrisma });
    assert.strictEqual(canceled.status, 'CANCELED', 'D11: PENDING -> CANCELED debe ser exitoso');
    passed++;
    console.log('  ✅ PASS: [D11] PENDING -> cancel => CANCELED');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D12. IN_PROGRESS -> cancel => CANCELED
  // ───────────────────────────────────────────────────────────────────────────
  {
    const taskD12 = (await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'FOLLOW_UP',
      summary: 'D12: IN_PROGRESS a CANCELED',
      dueDateLocal: '2026-09-11',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    await startOperationalTask({ tenantId: tenantA, id: taskD12.id, userId: userA.id }, { prismaClient: mockPrisma });
    const canceled = await cancelOperationalTask({ tenantId: tenantA, id: taskD12.id }, { prismaClient: mockPrisma });

    assert.strictEqual(canceled.status, 'CANCELED', 'D12: IN_PROGRESS -> CANCELED debe ser exitoso');
    passed++;
    console.log('  ✅ PASS: [D12] IN_PROGRESS -> cancel => CANCELED');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D13. COMPLETED -> cancel => reject
  // ───────────────────────────────────────────────────────────────────────────
  {
    const taskD13 = (await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'ORDER_REQUEST',
      summary: 'D13: COMPLETED no se puede cancelar',
      dueDateLocal: '2026-09-11',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    await completeOperationalTask({ tenantId: tenantA, id: taskD13.id, userId: userA.id }, { prismaClient: mockPrisma });

    await assert.rejects(
      async () => {
        await cancelOperationalTask({ tenantId: tenantA, id: taskD13.id }, { prismaClient: mockPrisma });
      },
      /INVALID_TASK_TRANSITION/,
      'D13: No se puede cancelar una tarea COMPLETED'
    );
    passed++;
    console.log('  ✅ PASS: [D13] COMPLETED -> cancel => reject');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D14. CANCELED -> cancel => idempotente
  // ───────────────────────────────────────────────────────────────────────────
  {
    const taskD14 = (await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'SUPPORT',
      summary: 'D14: Cancel doble idempotente',
      dueDateLocal: '2026-09-11',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    await cancelOperationalTask({ tenantId: tenantA, id: taskD14.id }, { prismaClient: mockPrisma });
    const reCanceled = await cancelOperationalTask({ tenantId: tenantA, id: taskD14.id }, { prismaClient: mockPrisma });

    assert.strictEqual(reCanceled.status, 'CANCELED', 'D14: Cancel repetido debe ser idempotente');
    passed++;
    console.log('  ✅ PASS: [D14] CANCELED -> cancel => idempotente');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D15. Tenant B no puede start item A
  // ───────────────────────────────────────────────────────────────────────────
  {
    const taskD15 = (await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'FOLLOW_UP',
      summary: 'D15: Tarea de tenant A',
      dueDateLocal: '2026-09-12',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    await assert.rejects(
      async () => {
        await startOperationalTask({
          tenantId: tenantB,
          id: taskD15.id,
          userId: userB.id
        }, { prismaClient: mockPrisma });
      },
      /ITEM_NOT_FOUND/,
      'D15: Tenant B debe recibir ITEM_NOT_FOUND al intentar iniciar item de Tenant A'
    );
    passed++;
    console.log('  ✅ PASS: [D15] Tenant B no puede start item A');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D16. start requiere User del tenant
  // ───────────────────────────────────────────────────────────────────────────
  {
    const taskD16 = (await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'FOLLOW_UP',
      summary: 'D16: Tarea de tenant A para probar usuario mismatch',
      dueDateLocal: '2026-09-12',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    await assert.rejects(
      async () => {
        await startOperationalTask({
          tenantId: tenantA,
          id: taskD16.id,
          userId: userB.id // Usuario de tenant B
        }, { prismaClient: mockPrisma });
      },
      /USER_TENANT_MISMATCH/,
      'D16: Usuario de otro tenant debe ser rechazado con USER_TENANT_MISMATCH'
    );
    passed++;
    console.log('  ✅ PASS: [D16] start requiere User del tenant');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D17. POST /:id/start existe
  // ───────────────────────────────────────────────────────────────────────────
  {
    const routes = operationalItemRoutes.stack
      .filter(layer => layer.route)
      .map(layer => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods)
      }));

    const hasStart = routes.some(r => r.path === '/:id/start' && r.methods.includes('post'));
    assert.strictEqual(hasStart, true, 'D17: La ruta POST /:id/start debe estar registrada en el router');
    passed++;
    console.log('  ✅ PASS: [D17] POST /:id/start existe');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D18. POST /:id/start NOTE => 400
  // ───────────────────────────────────────────────────────────────────────────
  {
    const noteD18 = (await createOperationalItem({
      tenantId: tenantA,
      type: 'NOTE',
      category: 'GENERAL',
      summary: 'D18: Nota para intentar start vía HTTP',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    const req = buildReq({
      user: userA,
      params: { id: noteD18.id }
    });
    const res = await invokeController(startItem, req);
    assert.strictEqual(res.status, 400, 'D18: Start sobre NOTE debe responder 400');
    assert.ok(res.body.error.includes('CANNOT_START_NON_TASK'));
    passed++;
    console.log('  ✅ PASS: [D18] POST /:id/start NOTE => 400');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D19. POST /:id/start cross tenant => 404
  // ───────────────────────────────────────────────────────────────────────────
  {
    const taskD19 = (await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'COORDINATION',
      summary: 'D19: Tarea de tenant A para acceso por tenant B',
      dueDateLocal: '2026-09-12',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    const req = buildReq({
      user: userB,
      params: { id: taskD19.id }
    });
    const res = await invokeController(startItem, req);
    assert.strictEqual(res.status, 404, 'D19: Cross-tenant start debe responder 404 estricto');
    passed++;
    console.log('  ✅ PASS: [D19] POST /:id/start cross tenant => 404');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D20. start => operational_item_updated tenant room
  // ───────────────────────────────────────────────────────────────────────────
  {
    const taskD20 = (await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'FOLLOW_UP',
      summary: 'D20: Tarea para verificar evento socket en start',
      dueDateLocal: '2026-09-12',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    mockIo.reset();
    const req = buildReq({
      user: userA,
      params: { id: taskD20.id }
    });
    const res = await invokeController(startItem, req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.item.status, 'IN_PROGRESS');

    assert.strictEqual(mockIo.emittedEvents.length, 1, 'D20: Exactamente 1 evento socket emitido');
    const ev = mockIo.emittedEvents[0];
    assert.strictEqual(ev.room, `tenant:${tenantA}`, 'D20: Emitido a sala del tenant');
    assert.strictEqual(ev.eventName, 'operational_item_updated', 'D20: Evento operational_item_updated');
    assert.strictEqual(ev.payload.item.id, taskD20.id);
    assert.strictEqual(ev.payload.item.status, 'IN_PROGRESS');
    passed++;
    console.log('  ✅ PASS: [D20] start => operational_item_updated tenant room');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D21. Gemini NOTE nueva => operational_item_created
  // ───────────────────────────────────────────────────────────────────────────
  {
    mockIo.reset();
    const ctx = {
      tenant: { id: tenantA },
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: 'msg_ai_note_d21',
      tenantDetails: { timezone: 'America/Lima' },
      isGenerationSuperseded: () => false,
      prismaClient: mockPrisma
    };

    const toolRes = await handleOperationalTool('register_operational_note', {
      category: 'SERVICE_INSTRUCTION',
      summary: 'D21: Nota creada por Gemini AI'
    }, ctx);

    assert.strictEqual(toolRes.success, true);
    assert.strictEqual(mockIo.emittedEvents.length, 1, 'D21: Debe emitirse 1 evento socket');
    const ev = mockIo.emittedEvents[0];
    assert.strictEqual(ev.room, `tenant:${tenantA}`);
    assert.strictEqual(ev.eventName, 'operational_item_created');
    assert.strictEqual(ev.payload.item.id, toolRes.itemId);
    assert.strictEqual(ev.payload.item.type, 'NOTE');
    passed++;
    console.log('  ✅ PASS: [D21] Gemini NOTE nueva => operational_item_created');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D22. Gemini TASK nueva => operational_item_created
  // ───────────────────────────────────────────────────────────────────────────
  {
    mockIo.reset();
    const ctx = {
      tenant: { id: tenantA },
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: 'msg_ai_task_d22',
      tenantDetails: { timezone: 'America/Lima' },
      isGenerationSuperseded: () => false,
      prismaClient: mockPrisma
    };

    const toolRes = await handleOperationalTool('create_operational_task', {
      category: 'COORDINATION',
      summary: 'D22: Tarea creada por Gemini AI',
      dueDaysOffset: 1,
      dueTime: '15:30'
    }, ctx);

    assert.strictEqual(toolRes.success, true);
    assert.strictEqual(mockIo.emittedEvents.length, 1, 'D22: Debe emitirse 1 evento socket');
    const ev = mockIo.emittedEvents[0];
    assert.strictEqual(ev.room, `tenant:${tenantA}`);
    assert.strictEqual(ev.eventName, 'operational_item_created');
    assert.strictEqual(ev.payload.item.id, toolRes.itemId);
    assert.strictEqual(ev.payload.item.type, 'TASK');
    passed++;
    console.log('  ✅ PASS: [D22] Gemini TASK nueva => operational_item_created');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D23. Gemini generation superseded antes de mutation => 0 socket
  // ───────────────────────────────────────────────────────────────────────────
  {
    mockIo.reset();
    const initialItemCount = mockPrisma._store.operationalItems.size;

    const ctx = {
      tenant: { id: tenantA },
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: 'msg_ai_task_d23',
      tenantDetails: { timezone: 'America/Lima' },
      isGenerationSuperseded: () => true, // Generación obsoleta!
      prismaClient: mockPrisma
    };

    const toolRes = await handleOperationalTool('create_operational_task', {
      category: 'FOLLOW_UP',
      summary: 'D23: Tarea obsoleta que no debe crearse'
    }, ctx);

    assert.strictEqual(toolRes.success, false);
    assert.strictEqual(toolRes.error, 'GENERATION_SUPERSEDED');
    assert.strictEqual(mockPrisma._store.operationalItems.size, initialItemCount, 'D23: 0 inserciones en DB');
    assert.strictEqual(mockIo.emittedEvents.length, 0, 'D23: 0 eventos socket emitidos');
    passed++;
    console.log('  ✅ PASS: [D23] Gemini generation superseded antes de mutation => 0 socket');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D24. Gemini deduplicated NOTE => 0 segundo socket create
  // ───────────────────────────────────────────────────────────────────────────
  {
    mockIo.reset();
    const ctx = {
      tenant: { id: tenantA },
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: 'msg_ai_note_d24_dedupe',
      tenantDetails: { timezone: 'America/Lima' },
      isGenerationSuperseded: () => false,
      prismaClient: mockPrisma
    };

    // Primera invocación -> se emite 1 socket
    const toolRes1 = await handleOperationalTool('register_operational_note', {
      category: 'GENERAL',
      summary: 'D24: Nota para prueba de deduplicación socket'
    }, ctx);
    assert.strictEqual(toolRes1.success, true);
    assert.strictEqual(mockIo.emittedEvents.length, 1);

    // Segunda invocación con mismo sourceMessageId y datos (retry de webhook)
    mockIo.reset();
    const toolRes2 = await handleOperationalTool('register_operational_note', {
      category: 'GENERAL',
      summary: 'D24: Nota para prueba de deduplicación socket'
    }, ctx);
    assert.strictEqual(toolRes2.success, true);
    assert.strictEqual(mockIo.emittedEvents.length, 0, 'D24: Deduplicación no debe reemitir operational_item_created');
    passed++;
    console.log('  ✅ PASS: [D24] Gemini deduplicated NOTE => 0 segundo socket create');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D25. Gemini deduplicated TASK => 0 segundo socket create
  // ───────────────────────────────────────────────────────────────────────────
  {
    mockIo.reset();
    const ctx = {
      tenant: { id: tenantA },
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: 'msg_ai_task_d25_dedupe',
      tenantDetails: { timezone: 'America/Lima' },
      isGenerationSuperseded: () => false,
      prismaClient: mockPrisma
    };

    // Primera invocación -> se emite 1 socket
    const toolRes1 = await handleOperationalTool('create_operational_task', {
      category: 'COORDINATION',
      summary: 'D25: Tarea para prueba de deduplicación socket',
      dueDaysOffset: 1
    }, ctx);
    assert.strictEqual(toolRes1.success, true);
    assert.strictEqual(mockIo.emittedEvents.length, 1);

    // Segunda invocación con mismo sourceMessageId y datos
    mockIo.reset();
    const toolRes2 = await handleOperationalTool('create_operational_task', {
      category: 'COORDINATION',
      summary: 'D25: Tarea para prueba de deduplicación socket',
      dueDaysOffset: 1
    }, ctx);
    assert.strictEqual(toolRes2.success, true);
    assert.strictEqual(mockIo.emittedEvents.length, 0, 'D25: Deduplicación TASK no debe reemitir socket create');
    passed++;
    console.log('  ✅ PASS: [D25] Gemini deduplicated TASK => 0 segundo socket create');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D26. Socket únicamente tenant correcto
  // ───────────────────────────────────────────────────────────────────────────
  {
    mockIo.reset();
    emitOperationalItemCreated({
      io: mockIo,
      tenantId: tenantA,
      item: { id: 'test_item_d26', type: 'TASK', status: 'PENDING' }
    });

    assert.strictEqual(mockIo.emittedEvents.length, 1);
    assert.strictEqual(mockIo.emittedEvents[0].room, `tenant:${tenantA}`);
    assert.notStrictEqual(mockIo.emittedEvents[0].room, `tenant:${tenantB}`);
    assert.notStrictEqual(mockIo.emittedEvents[0].room, 'GLOBAL');
    passed++;
    console.log('  ✅ PASS: [D26] Socket únicamente tenant correcto');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D27. socket unavailable => DB success no se convierte en failure
  // ───────────────────────────────────────────────────────────────────────────
  {
    // Socket con error o null
    const brokenIo = {
      to() {
        throw new Error('Socket network transport broken');
      }
    };

    // Creación vía servicio y helper con broken socket
    const createdItem = (await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'SUPPORT',
      summary: 'D27: Tarea con socket roto no debe abortar',
      dueDateLocal: '2026-09-15',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    assert.doesNotThrow(() => {
      emitOperationalItemCreated({
        io: brokenIo,
        tenantId: tenantA,
        item: createdItem
      });
    }, 'D27: Excepción en socket no debe propagarse');

    // Creación vía Gemini con global.io = null
    const oldIo = global.io;
    global.io = null;

    const ctx = {
      tenant: { id: tenantA },
      customer: customerA,
      contact: contactA,
      chat: chatA,
      sourceMessageId: 'msg_ai_task_d27_nosocket',
      tenantDetails: { timezone: 'America/Lima' },
      isGenerationSuperseded: () => false,
      prismaClient: mockPrisma
    };

    const toolRes = await handleOperationalTool('create_operational_task', {
      category: 'SUPPORT',
      summary: 'D27: Tarea Gemini con socket null debe ser guardada en DB'
    }, ctx);

    assert.strictEqual(toolRes.success, true, 'D27: Invocación exitosa a pesar de socket no disponible');
    global.io = oldIo; // Restaurar
    passed++;
    console.log('  ✅ PASS: [D27] socket unavailable => DB success no se convierte en failure');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D28. payload no contiene dedupeKey ni tenantId redundante
  // ───────────────────────────────────────────────────────────────────────────
  {
    const rawItem = {
      id: 'item_payload_d28',
      tenantId: tenantA,
      dedupeKey: 'sha256_super_secret_internal_key',
      type: 'TASK',
      category: 'COORDINATION',
      title: 'Título de prueba',
      summary: 'Resumen sanitizado',
      subjectName: 'Cliente Juan',
      status: 'PENDING',
      priority: 'NORMAL',
      customerId: 'cust_123',
      contactId: 'cnt_123',
      chatId: 'chat_123',
      orderId: null,
      sourceMessageId: 'msg_123',
      dueDateLocal: '2026-09-12',
      dueTimeLocal: '10:00',
      dueAt: new Date('2026-09-12T15:00:00.000Z'),
      details: null,
      createdByType: 'AI',
      createdByUserId: null,
      completedAt: null,
      completedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const sanitized = sanitizeOperationalItemForSocket(rawItem);
    assert.strictEqual(sanitized.dedupeKey, undefined, 'D28: dedupeKey debe ser estrictamente omitido');
    assert.strictEqual(sanitized.tenantId, undefined, 'D28: tenantId debe ser omitido en payload sanitizado');
    assert.strictEqual(sanitized.id, 'item_payload_d28');
    assert.strictEqual(sanitized.dueAt, '2026-09-12T15:00:00.000Z');
    passed++;
    console.log('  ✅ PASS: [D28] payload no contiene dedupeKey');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D29. REST create sigue emitiendo created
  // ───────────────────────────────────────────────────────────────────────────
  {
    mockIo.reset();
    const req = buildReq({
      user: userA,
      body: {
        type: 'TASK',
        category: 'FOLLOW_UP',
        summary: 'D29: Tarea creada vía REST',
        dueDateLocal: '2026-09-20'
      }
    });

    const res = await invokeController(createItem, req);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(mockIo.emittedEvents.length, 1);
    const ev = mockIo.emittedEvents[0];
    assert.strictEqual(ev.room, `tenant:${tenantA}`);
    assert.strictEqual(ev.eventName, 'operational_item_created');
    assert.strictEqual(ev.payload.item.id, res.body.item.id);
    passed++;
    console.log('  ✅ PASS: [D29] REST create sigue emitiendo created');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // D30. REST patch/complete/archive/cancel siguen emitiendo updated
  // ───────────────────────────────────────────────────────────────────────────
  {
    // 1. PATCH
    const itemTask = (await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'FOLLOW_UP',
      summary: 'D30: Tarea para probar emisiones de update',
      dueDateLocal: '2026-09-20',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    mockIo.reset();
    const patchReq = buildReq({
      user: userA,
      params: { id: itemTask.id },
      body: { summary: 'D30: Resumen modificado vía PATCH' }
    });
    const patchRes = await invokeController(updateItem, patchReq);
    assert.strictEqual(patchRes.status, 200);
    assert.strictEqual(mockIo.emittedEvents.length, 1);
    assert.strictEqual(mockIo.emittedEvents[0].eventName, 'operational_item_updated');

    // 2. COMPLETE
    mockIo.reset();
    const completeReq = buildReq({
      user: userA,
      params: { id: itemTask.id }
    });
    const completeRes = await invokeController(completeItem, completeReq);
    assert.strictEqual(completeRes.status, 200);
    assert.strictEqual(mockIo.emittedEvents.length, 1);
    assert.strictEqual(mockIo.emittedEvents[0].eventName, 'operational_item_updated');

    // 3. ARCHIVE (NOTE)
    const itemNote = (await createOperationalItem({
      tenantId: tenantA,
      type: 'NOTE',
      category: 'GENERAL',
      summary: 'D30: Nota para probar archive',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    mockIo.reset();
    const archiveReq = buildReq({
      user: userA,
      params: { id: itemNote.id }
    });
    const archiveRes = await invokeController(archiveItem, archiveReq);
    assert.strictEqual(archiveRes.status, 200);
    assert.strictEqual(mockIo.emittedEvents.length, 1);
    assert.strictEqual(mockIo.emittedEvents[0].eventName, 'operational_item_updated');

    // 4. CANCEL
    const itemTaskToCancel = (await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'FOLLOW_UP',
      summary: 'D30: Tarea para probar cancel',
      dueDateLocal: '2026-09-20',
      createdByType: 'USER',
      createdByUserId: userA.id
    }, { prismaClient: mockPrisma })).item;

    mockIo.reset();
    const cancelReq = buildReq({
      user: userA,
      params: { id: itemTaskToCancel.id }
    });
    const cancelRes = await invokeController(cancelItem, cancelReq);
    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(mockIo.emittedEvents.length, 1);
    assert.strictEqual(mockIo.emittedEvents[0].eventName, 'operational_item_updated');

    passed++;
    console.log('  ✅ PASS: [D30] REST patch/complete/archive/cancel siguen emitiendo updated');
  }

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n======================================================================');
  console.log(`RESULTADOS D1–D${total}: ${passed} pasaron, 0 fallaron.`);
  console.log('======================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ ERROR EN SUITE D1-D30:\n', err);
  process.exit(1);
});
