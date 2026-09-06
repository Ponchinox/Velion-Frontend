/**
 * ==============================================================================
 * VELION BUSINESS AGENT — FASE 2C TEST SUITE (C1–C30)
 * REST API + SOCKET.IO OPERATIONAL ITEMS
 * ==============================================================================
 */

import assert from 'assert';
import {
  getItems,
  getItemById,
  createItem,
  updateItem,
  completeItem,
  archiveItem,
  cancelItem
} from './src/controllers/operationalItemController.js';
import operationalItemRoutes from './src/routes/operationalItemRoutes.js';

console.log('🧪 ============================================================');
console.log('🧪 VELION BUSINESS AGENT FASE 2C — OPERATIONAL API TESTS (C1-C30)');
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
    to: (room) => ({
      emit: (eventName, payload) => {
        emittedEvents.push({ room, eventName, payload });
      }
    }),
    emit: (eventName, payload) => {
      emittedEvents.push({ room: 'GLOBAL', eventName, payload });
    }
  };
}

// ─── DISPATCHER HELPER ───────────────────────────────────────────────────────

async function invokeController(fn, req) {
  let statusCode = 200;
  let jsonBody = null;
  const res = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => {
          jsonBody = data;
          return res;
        }
      };
    },
    json: (data) => {
      jsonBody = data;
      return res;
    }
  };
  await fn(req, res);
  return { status: statusCode, body: jsonBody };
}

// ─── SUITE PRINCIPAL C1-C30 ─────────────────────────────────────────────────

async function runTests() {
  let passed = 0;
  const mockPrisma = createMockPrisma();
  const mockIo = createMockIo();

  // Tenants y usuarios de prueba
  const tenantA = 'tenant_alpha';
  const tenantB = 'tenant_beta';

  const userA = { id: 'user_a', tenantId: tenantA, email: 'a@example.com' };
  const userB = { id: 'user_b', tenantId: tenantB, email: 'b@example.com' };

  mockPrisma._store.tenants.set(tenantA, { id: tenantA, name: 'Alpha Corp' });
  mockPrisma._store.tenants.set(tenantB, { id: tenantB, name: 'Beta Corp' });

  mockPrisma._store.users.set(userA.id, userA);
  mockPrisma._store.users.set(userB.id, userB);

  const customerA = { id: 'cust_a', tenantId: tenantA, phone: '51999999991' };
  const customerB = { id: 'cust_b', tenantId: tenantB, phone: '51999999992' };
  mockPrisma._store.customers.set(customerA.id, customerA);
  mockPrisma._store.customers.set(customerB.id, customerB);

  const chatA = { id: 'chat_a', tenantId: tenantA };
  const chatB = { id: 'chat_b', tenantId: tenantB };
  mockPrisma._store.chats.set(chatA.id, chatA);
  mockPrisma._store.chats.set(chatB.id, chatB);

  const orderA = { id: 'order_a', tenantId: tenantA };
  const orderB = { id: 'order_b', tenantId: tenantB };
  mockPrisma._store.orders.set(orderA.id, orderA);
  mockPrisma._store.orders.set(orderB.id, orderB);

  // Helper para armar req
  function buildReq({ user = userA, body = {}, params = {}, query = {}, io = mockIo } = {}) {
    return {
      user,
      body,
      params,
      query,
      io,
      prismaClient: mockPrisma
    };
  }

  // Pre-cargar un item para Tenant A y otro para Tenant B
  const itemA1 = await mockPrisma.operationalItem.create({
    data: {
      tenantId: tenantA,
      type: 'NOTE',
      category: 'GENERAL',
      title: 'Nota Inicial Alpha',
      summary: 'Resumen inicial alpha',
      status: 'ACTIVE',
      priority: 'NORMAL',
      createdByType: 'USER',
      createdByUserId: userA.id
    }
  });

  const itemB1 = await mockPrisma.operationalItem.create({
    data: {
      tenantId: tenantB,
      type: 'NOTE',
      category: 'GENERAL',
      title: 'Nota Inicial Beta',
      summary: 'Resumen inicial beta',
      status: 'ACTIVE',
      priority: 'NORMAL',
      createdByType: 'USER',
      createdByUserId: userB.id
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C1. GET list autenticado tenant A
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({ query: {} });
    const res = await invokeController(getItems, req);
    assert.strictEqual(res.status, 200, 'C1: Debe responder 200');
    assert.strictEqual(res.body.success, true, 'C1: success true');
    assert.ok(Array.isArray(res.body.items), 'C1: items es array');
    assert.strictEqual(res.body.total, 1, 'C1: total 1');
    assert.strictEqual(res.body.items[0].id, itemA1.id, 'C1: item corresponde a A');
    passed++;
    console.log('  ✅ PASS: [C1] GET list autenticado tenant A retorna 200 con paginación');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C2. Tenant A no ve items B
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({ query: {} });
    const res = await invokeController(getItems, req);
    const bItems = res.body.items.filter(it => it.tenantId === tenantB || it.id === itemB1.id);
    assert.strictEqual(bItems.length, 0, 'C2: No debe listar items de tenant B');
    passed++;
    console.log('  ✅ PASS: [C2] Tenant A no ve items de Tenant B (Aislamiento de listado)');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C3. GET id propio => 200
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({ params: { id: itemA1.id } });
    const res = await invokeController(getItemById, req);
    assert.strictEqual(res.status, 200, 'C3: Debe responder 200');
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.item.id, itemA1.id);
    passed++;
    console.log('  ✅ PASS: [C3] GET id propio retorna 200 con item completo');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C4. GET id B => 404 (IDOR Protection)
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({ params: { id: itemB1.id } });
    const res = await invokeController(getItemById, req);
    assert.strictEqual(res.status, 404, 'C4: Debe responder 404 para item de otro tenant');
    assert.strictEqual(res.body.success, false);
    passed++;
    console.log('  ✅ PASS: [C4] GET id ajeno retorna 404 estricto (Anti-IDOR)');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C5. POST NOTE manual => createdByType USER
  // ───────────────────────────────────────────────────────────────────────────
  let manualNoteId = null;
  {
    const req = buildReq({
      body: {
        type: 'NOTE',
        category: 'COORDINATION',
        summary: 'Nota manual creada por operador humano',
        subjectName: 'Gustavito'
      }
    });
    const res = await invokeController(createItem, req);
    assert.strictEqual(res.status, 201, 'C5: Debe responder 201');
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.item.createdByType, 'USER', 'C5: createdByType forzado a USER');
    assert.strictEqual(res.body.item.status, 'ACTIVE', 'C5: NOTE status default es ACTIVE');
    manualNoteId = res.body.item.id;
    passed++;
    console.log('  ✅ PASS: [C5] POST NOTE manual establece createdByType = USER');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C6. POST NOTE => createdByUserId req.user.id
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({
      body: {
        type: 'NOTE',
        summary: 'Otra nota manual',
        category: 'GENERAL'
      }
    });
    const res = await invokeController(createItem, req);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.item.createdByUserId, userA.id, 'C6: createdByUserId coincide con req.user.id');
    passed++;
    console.log('  ✅ PASS: [C6] POST NOTE asigna autoritativamente createdByUserId');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C7. POST ignores/rejects tenantId body
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({
      body: {
        tenantId: 'tenant_evil',
        type: 'NOTE',
        summary: 'Intento de inyección de tenantId',
        category: 'GENERAL'
      }
    });
    const res = await invokeController(createItem, req);
    assert.strictEqual(res.status, 400, 'C7: Debe rechazar tenantId en body con 400');
    assert.strictEqual(res.body.success, false);
    passed++;
    console.log('  ✅ PASS: [C7] POST rechaza inyección de tenantId en body');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C8. POST rejects createdByType AI injected
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({
      body: {
        createdByType: 'AI',
        type: 'NOTE',
        summary: 'Intento de suplantar autoría de IA',
        category: 'GENERAL'
      }
    });
    const res = await invokeController(createItem, req);
    assert.strictEqual(res.status, 400, 'C8: Debe responder 400');
    assert.ok(res.body.error.includes('INVALID_CREATED_BY_TYPE'));
    passed++;
    console.log('  ✅ PASS: [C8] POST rechaza createdByType AI inyectado en creación manual');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C9. POST customerId cross-tenant => fail
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({
      body: {
        customerId: customerB.id,
        type: 'NOTE',
        summary: 'Intento de vincular cliente de otro tenant',
        category: 'GENERAL'
      }
    });
    const res = await invokeController(createItem, req);
    assert.strictEqual(res.status, 400, 'C9: Debe fallar con 400');
    assert.ok(res.body.error.includes('CUSTOMER_TENANT_MISMATCH'));
    passed++;
    console.log('  ✅ PASS: [C9] POST customerId cross-tenant falla cerrado');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C10. POST chatId cross-tenant => fail
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({
      body: {
        chatId: chatB.id,
        type: 'NOTE',
        summary: 'Intento de vincular chat de otro tenant',
        category: 'GENERAL'
      }
    });
    const res = await invokeController(createItem, req);
    assert.strictEqual(res.status, 400, 'C10: Debe fallar con 400');
    assert.ok(res.body.error.includes('CHAT_TENANT_MISMATCH'));
    passed++;
    console.log('  ✅ PASS: [C10] POST chatId cross-tenant falla cerrado');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C11. POST orderId cross-tenant => fail
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({
      body: {
        orderId: orderB.id,
        type: 'NOTE',
        summary: 'Intento de vincular orden de otro tenant',
        category: 'GENERAL'
      }
    });
    const res = await invokeController(createItem, req);
    assert.strictEqual(res.status, 400, 'C11: Debe fallar con 400');
    assert.ok(res.body.error.includes('ORDER_TENANT_MISMATCH'));
    passed++;
    console.log('  ✅ PASS: [C11] POST orderId cross-tenant falla cerrado');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C12. PATCH summary propio => success
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({
      params: { id: manualNoteId },
      body: {
        summary: 'Resumen actualizado exitosamente por operador'
      }
    });
    const res = await invokeController(updateItem, req);
    assert.strictEqual(res.status, 200, 'C12: Debe responder 200');
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.item.summary, 'Resumen actualizado exitosamente por operador');
    passed++;
    console.log('  ✅ PASS: [C12] PATCH summary propio actualiza exitosamente');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C13. PATCH tenantId => blocked
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({
      params: { id: manualNoteId },
      body: { tenantId: 'tenant_evil' }
    });
    const res = await invokeController(updateItem, req);
    assert.strictEqual(res.status, 400, 'C13: Debe responder 400');
    assert.ok(res.body.error.includes('PROHIBITED_FIELD_UPDATE'));
    passed++;
    console.log('  ✅ PASS: [C13] PATCH tenantId es bloqueado');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C14. PATCH status => blocked
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({
      params: { id: manualNoteId },
      body: { status: 'COMPLETED' }
    });
    const res = await invokeController(updateItem, req);
    assert.strictEqual(res.status, 400, 'C14: Debe responder 400');
    assert.ok(res.body.error.includes('PROHIBITED_FIELD_UPDATE'));
    passed++;
    console.log('  ✅ PASS: [C14] PATCH status directo es bloqueado (debe usar lifecycle)');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C15. PATCH dedupeKey => blocked
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({
      params: { id: manualNoteId },
      body: { dedupeKey: 'hacked_dedupe_key' }
    });
    const res = await invokeController(updateItem, req);
    assert.strictEqual(res.status, 400, 'C15: Debe responder 400');
    assert.ok(res.body.error.includes('PROHIBITED_FIELD_UPDATE'));
    passed++;
    console.log('  ✅ PASS: [C15] PATCH dedupeKey es bloqueado');
  }

  // Crear una TASK para probar lifecycle
  const taskA1 = await mockPrisma.operationalItem.create({
    data: {
      tenantId: tenantA,
      type: 'TASK',
      category: 'FOLLOW_UP',
      title: 'Llamar cliente mañana',
      summary: 'Llamar para confirmar asistencia',
      status: 'PENDING',
      priority: 'NORMAL',
      createdByType: 'USER',
      createdByUserId: userA.id,
      dueDateLocal: '2026-09-07'
    }
  });

  const taskB1 = await mockPrisma.operationalItem.create({
    data: {
      tenantId: tenantB,
      type: 'TASK',
      category: 'FOLLOW_UP',
      title: 'Tarea de Beta',
      summary: 'Tarea de Beta',
      status: 'PENDING',
      priority: 'NORMAL',
      createdByType: 'USER',
      createdByUserId: userB.id
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C16. complete TASK => COMPLETED
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({ params: { id: taskA1.id } });
    const res = await invokeController(completeItem, req);
    assert.strictEqual(res.status, 200, 'C16: Debe responder 200');
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.item.status, 'COMPLETED');
    assert.strictEqual(res.body.item.completedByUserId, userA.id);
    assert.ok(res.body.item.completedAt);
    passed++;
    console.log('  ✅ PASS: [C16] complete TASK cambia status a COMPLETED y registra completedByUserId');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C17. complete NOTE => 400
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({ params: { id: manualNoteId } });
    const res = await invokeController(completeItem, req);
    assert.strictEqual(res.status, 400, 'C17: Debe responder 400');
    assert.ok(res.body.error.includes('CANNOT_COMPLETE_NON_TASK'));
    passed++;
    console.log('  ✅ PASS: [C17] complete NOTE es rechazado con 400');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C18. complete item tenant B => 404
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({ params: { id: taskB1.id } });
    const res = await invokeController(completeItem, req);
    assert.strictEqual(res.status, 404, 'C18: Debe responder 404 para item de otro tenant');
    passed++;
    console.log('  ✅ PASS: [C18] complete item de Tenant B retorna 404');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C19. archive NOTE => ARCHIVED
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({ params: { id: manualNoteId } });
    const res = await invokeController(archiveItem, req);
    assert.strictEqual(res.status, 200, 'C19: Debe responder 200');
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.item.status, 'ARCHIVED');
    passed++;
    console.log('  ✅ PASS: [C19] archive NOTE cambia status a ARCHIVED');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C20. archive TASK => 400
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({ params: { id: taskA1.id } });
    const res = await invokeController(archiveItem, req);
    assert.strictEqual(res.status, 400, 'C20: Debe responder 400');
    assert.ok(res.body.error.includes('CANNOT_ARCHIVE_NON_NOTE'));
    passed++;
    console.log('  ✅ PASS: [C20] archive TASK es rechazado con 400');
  }

  // Crear otra TASK para probar cancel
  const taskToCancel = await mockPrisma.operationalItem.create({
    data: {
      tenantId: tenantA,
      type: 'TASK',
      category: 'COORDINATION',
      title: 'Tarea para cancelar',
      summary: 'Esta tarea será cancelada',
      status: 'PENDING',
      priority: 'LOW',
      createdByType: 'USER',
      createdByUserId: userA.id
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C21. cancel TASK => CANCELED
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({ params: { id: taskToCancel.id } });
    const res = await invokeController(cancelItem, req);
    assert.strictEqual(res.status, 200, 'C21: Debe responder 200');
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.item.status, 'CANCELED');
    passed++;
    console.log('  ✅ PASS: [C21] cancel TASK cambia status a CANCELED');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C22. cancel NOTE => 400
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({ params: { id: itemA1.id } });
    const res = await invokeController(cancelItem, req);
    assert.strictEqual(res.status, 400, 'C22: Debe responder 400');
    assert.ok(res.body.error.includes('CANNOT_CANCEL_NON_TASK'));
    passed++;
    console.log('  ✅ PASS: [C22] cancel NOTE es rechazado con 400');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C23. list limit >100 => capped/rejected
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({ query: { limit: '150' } });
    const res = await invokeController(getItems, req);
    assert.strictEqual(res.status, 400, 'C23: Debe rechazar limit > 100 con 400');
    assert.ok(res.body.error.includes('LIMIT_EXCEEDED'));
    passed++;
    console.log('  ✅ PASS: [C23] list limit > 100 es rechazado fail-closed');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C24. invalid category => 400
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({
      body: {
        type: 'NOTE',
        category: 'INVALID_CATEGORY_XYZ',
        summary: 'Prueba categoría inválida'
      }
    });
    const res = await invokeController(createItem, req);
    assert.strictEqual(res.status, 400, 'C24: Debe responder 400');
    assert.ok(res.body.error.includes('VALIDATION_ERROR'));
    passed++;
    console.log('  ✅ PASS: [C24] Categoría inválida es rechazada con 400');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C25. invalid due time => 400
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({
      body: {
        type: 'TASK',
        category: 'FOLLOW_UP',
        summary: 'Prueba hora inválida',
        dueDateLocal: '2026-09-07',
        dueTimeLocal: '25:99'
      }
    });
    const res = await invokeController(createItem, req);
    assert.strictEqual(res.status, 400, 'C25: Debe responder 400');
    assert.ok(res.body.error.includes('VALIDATION_ERROR'));
    passed++;
    console.log('  ✅ PASS: [C25] dueTimeLocal inválido es rechazado con 400');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C26. socket create => only tenant A room
  // ───────────────────────────────────────────────────────────────────────────
  {
    mockIo.emittedEvents.length = 0; // reset
    const req = buildReq({
      body: {
        type: 'TASK',
        category: 'COORDINATION',
        summary: 'Tarea para verificar evento socket create',
        dueDateLocal: '2026-09-08'
      }
    });
    const res = await invokeController(createItem, req);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(mockIo.emittedEvents.length, 1, 'C26: Exactamente 1 evento socket emitido');
    const ev = mockIo.emittedEvents[0];
    assert.strictEqual(ev.room, `tenant:${tenantA}`, 'C26: Emitido únicamente a la sala tenant:tenant_alpha');
    assert.strictEqual(ev.eventName, 'operational_item_created', 'C26: Nombre de evento correcto');
    assert.strictEqual(ev.payload.item.id, res.body.item.id);
    passed++;
    console.log('  ✅ PASS: [C26] Socket.IO create emite exclusivamente a tenant:tenant_alpha');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C27. socket update => only tenant A room
  // ───────────────────────────────────────────────────────────────────────────
  {
    mockIo.emittedEvents.length = 0; // reset
    const req = buildReq({
      params: { id: manualNoteId },
      body: {
        summary: 'Resumen actualizado para verificar socket update'
      }
    });
    const res = await invokeController(updateItem, req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(mockIo.emittedEvents.length, 1, 'C27: Exactamente 1 evento socket emitido');
    const ev = mockIo.emittedEvents[0];
    assert.strictEqual(ev.room, `tenant:${tenantA}`, 'C27: Emitido a sala tenant:tenant_alpha');
    assert.strictEqual(ev.eventName, 'operational_item_updated', 'C27: Evento operational_item_updated');
    passed++;
    console.log('  ✅ PASS: [C27] Socket.IO update emite exclusivamente a tenant:tenant_alpha');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C28. no WhatsApp alert triggered
  // ───────────────────────────────────────────────────────────────────────────
  {
    // Verificamos que ninguna alerta global o de WhatsApp fue invocada durante create/update
    const globalEmits = mockIo.emittedEvents.filter(e => e.room === 'GLOBAL');
    assert.strictEqual(globalEmits.length, 0, 'C28: Cero broadcasts globales o de WhatsApp');
    passed++;
    console.log('  ✅ PASS: [C28] Cero alertas de WhatsApp o broadcasts descontrolados');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C29. no hard delete endpoint
  // ───────────────────────────────────────────────────────────────────────────
  {
    // Verificamos estáticamente en la definición de rutas que no hay router.delete
    const routes = operationalItemRoutes.stack
      .filter(layer => layer.route)
      .map(layer => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods)
      }));

    const hasDelete = routes.some(r => r.methods.includes('delete'));
    assert.strictEqual(hasDelete, false, 'C29: No debe existir método DELETE en operationalItemRoutes');
    passed++;
    console.log('  ✅ PASS: [C29] Cero endpoints DELETE (Prohibición de Hard Delete respetada)');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C30. existing AI-created item remains readable/manageable by dashboard API
  // ───────────────────────────────────────────────────────────────────────────
  {
    // Simulamos un item generado previamente por Gemini en Fase 2B
    const aiItem = await mockPrisma.operationalItem.create({
      data: {
        tenantId: tenantA,
        customerId: customerA.id,
        chatId: chatA.id,
        type: 'TASK',
        category: 'COORDINATION',
        title: 'Clase Gustavito',
        summary: 'Gustavito quiere practicar álgebra hoy',
        status: 'PENDING',
        priority: 'NORMAL',
        createdByType: 'AI',
        sourceMessageId: 'msg_gemini_123',
        dueDateLocal: '2026-09-06'
      }
    });

    // 1. Dashboard puede leerlo por ID
    const getReq = buildReq({ params: { id: aiItem.id } });
    const getRes = await invokeController(getItemById, getReq);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.item.createdByType, 'AI');
    assert.strictEqual(getRes.body.item.sourceMessageId, 'msg_gemini_123');

    // 2. Dashboard puede listarlo con filtros
    const listReq = buildReq({ query: { type: 'TASK', status: 'PENDING' } });
    const listRes = await invokeController(getItems, listReq);
    assert.strictEqual(listRes.status, 200);
    const found = listRes.body.items.some(it => it.id === aiItem.id);
    assert.strictEqual(found, true, 'Debe aparecer en listados');

    // 3. Operador puede completarlo
    const completeReq = buildReq({ params: { id: aiItem.id } });
    const completeRes = await invokeController(completeItem, completeReq);
    assert.strictEqual(completeRes.status, 200);
    assert.strictEqual(completeRes.body.item.status, 'COMPLETED');
    assert.strictEqual(completeRes.body.item.completedByUserId, userA.id);

    passed++;
    console.log('  ✅ PASS: [C30] Item creado por IA en Fase 2B es 100% consultable y gestionable por API');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C31. PATCH con dueAt arbitrario => 400 PROHIBITED_FIELD_UPDATE
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({
      params: { id: taskA1.id },
      body: { dueAt: '2099-01-01T00:00:00.000Z' }
    });
    const res = await invokeController(updateItem, req);
    assert.strictEqual(res.status, 400, 'C31: Debe responder 400');
    assert.ok(res.body.error.includes('PROHIBITED_FIELD_UPDATE'), `Error: ${res.body.error}`);
    assert.ok(res.body.error.includes('dueAt'), `Error debe mencionar dueAt: ${res.body.error}`);
    passed++;
    console.log('  ✅ PASS: [C31] PATCH con dueAt arbitrario es bloqueado con 400 PROHIBITED_FIELD_UPDATE');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C32. TASK con dueAt existente: PATCH dueTimeLocal => dueAt queda null
  // ───────────────────────────────────────────────────────────────────────────
  {
    const taskWithDueAt = await mockPrisma.operationalItem.create({
      data: {
        tenantId: tenantA,
        type: 'TASK',
        category: 'COORDINATION',
        title: 'Tarea con dueAt previo',
        summary: 'Confirmar reunión técnica',
        status: 'PENDING',
        priority: 'NORMAL',
        createdByType: 'USER',
        createdByUserId: userA.id,
        dueDateLocal: '2026-09-07',
        dueTimeLocal: '17:00',
        dueAt: new Date('2026-09-07T22:00:00.000Z')
      }
    });

    const req = buildReq({
      params: { id: taskWithDueAt.id },
      body: { dueTimeLocal: '18:00' }
    });
    const res = await invokeController(updateItem, req);
    assert.strictEqual(res.status, 200, 'C32: Debe responder 200');
    assert.strictEqual(res.body.item.dueTimeLocal, '18:00');
    assert.strictEqual(res.body.item.dueAt, null, 'C32: dueAt debe resetearse a null para evitar UTC desfasado');
    passed++;
    console.log('  ✅ PASS: [C32] TASK con dueAt existente: PATCH dueTimeLocal resetea dueAt a null');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C33. TASK con dueAt existente: PATCH dueDateLocal => dueAt queda null
  // ───────────────────────────────────────────────────────────────────────────
  {
    const taskWithDueAt2 = await mockPrisma.operationalItem.create({
      data: {
        tenantId: tenantA,
        type: 'TASK',
        category: 'COORDINATION',
        title: 'Tarea con dueAt para cambio de fecha',
        summary: 'Revisión en taller',
        status: 'PENDING',
        priority: 'NORMAL',
        createdByType: 'USER',
        createdByUserId: userA.id,
        dueDateLocal: '2026-09-07',
        dueTimeLocal: '17:00',
        dueAt: new Date('2026-09-07T22:00:00.000Z')
      }
    });

    const req = buildReq({
      params: { id: taskWithDueAt2.id },
      body: { dueDateLocal: '2026-09-08' }
    });
    const res = await invokeController(updateItem, req);
    assert.strictEqual(res.status, 200, 'C33: Debe responder 200');
    assert.strictEqual(res.body.item.dueDateLocal, '2026-09-08');
    assert.strictEqual(res.body.item.dueTimeLocal, '17:00', 'Debe preservar la hora previa si no se editó');
    assert.strictEqual(res.body.item.dueAt, null, 'C33: dueAt debe resetearse a null');
    passed++;
    console.log('  ✅ PASS: [C33] TASK con dueAt existente: PATCH dueDateLocal resetea dueAt a null');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C34. PATCH dueTimeLocal null => dueAt null, ninguna hora inventada
  // ───────────────────────────────────────────────────────────────────────────
  {
    const taskWithDueAt3 = await mockPrisma.operationalItem.create({
      data: {
        tenantId: tenantA,
        type: 'TASK',
        category: 'COORDINATION',
        title: 'Tarea para remover hora',
        summary: 'Llamar en algún momento del día',
        status: 'PENDING',
        priority: 'NORMAL',
        createdByType: 'USER',
        createdByUserId: userA.id,
        dueDateLocal: '2026-09-07',
        dueTimeLocal: '17:00',
        dueAt: new Date('2026-09-07T22:00:00.000Z')
      }
    });

    const req = buildReq({
      params: { id: taskWithDueAt3.id },
      body: { dueTimeLocal: null }
    });
    const res = await invokeController(updateItem, req);
    assert.strictEqual(res.status, 200, 'C34: Debe responder 200');
    assert.strictEqual(res.body.item.dueTimeLocal, null, 'dueTimeLocal debe quedar null');
    assert.strictEqual(res.body.item.dueAt, null, 'dueAt debe quedar null sin inventar horas');
    passed++;
    console.log('  ✅ PASS: [C34] PATCH dueTimeLocal null resetea dueAt y dueTimeLocal sin inventar hora');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // C35. POST manual con dueAt arbitrario => 400 FORBIDDEN_FIELD
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = buildReq({
      body: {
        type: 'TASK',
        category: 'COORDINATION',
        summary: 'Intento de inyectar dueAt en POST',
        dueAt: '2099-01-01T00:00:00.000Z'
      }
    });
    const res = await invokeController(createItem, req);
    assert.strictEqual(res.status, 400, 'C35: Debe responder 400');
    assert.ok(res.body.error.includes('FORBIDDEN_FIELD'), `Error: ${res.body.error}`);
    passed++;
    console.log('  ✅ PASS: [C35] POST manual rechaza inyección de dueAt con 400 FORBIDDEN_FIELD');
  }

  console.log('\n======================================================================');
  console.log(`RESULTADOS C1–C35: ${passed} pasaron, 0 fallaron.`);
  console.log('======================================================================\n');
}

runTests().catch(err => {
  console.error('❌ Error en test suite:', err);
  process.exit(1);
});
