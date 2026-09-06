import assert from 'node:assert';
import {
  VALID_TYPES,
  VALID_CATEGORIES,
  VALID_PRIORITIES,
  VALID_NOTE_STATUSES,
  VALID_TASK_STATUSES,
  MAX_SUMMARY_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_SUBJECT_LENGTH,
  sanitizeOperationalText,
  isValidDateString,
  isValidTimeString,
  buildOperationalItemDedupeKey,
  validateOperationalItemPayload,
  createOperationalItem,
  getOperationalItemById,
  listOperationalItems,
  updateOperationalItem,
  completeOperationalTask,
  archiveOperationalNote,
  cancelOperationalTask
} from './src/services/operationalItemService.js';

console.log('🧪 ============================================================');
console.log('🧪 VELION BUSINESS AGENT FASE 2A — OPERATIONAL ITEMS TESTS (A1-A30)');
console.log('🧪 ============================================================\n');

// ─── MOCK PRISMA CLIENT IN-MEMORY ─────────────────────────────────────────────

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
        // Enforce unique constraint: [tenantId, dedupeKey] (when dedupeKey is non-null)
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

async function runTests() {
  let passed = 0;
  const mockPrisma = createMockPrisma();

  // Setup fixtures
  const tenantA = 'tenant_alpha';
  const tenantB = 'tenant_beta';

  const userA = { id: 'user_a', tenantId: tenantA, email: 'a@example.com' };
  const userB = { id: 'user_b', tenantId: tenantB, email: 'b@example.com' };

  const customerA = { id: 'cust_a', tenantId: tenantA, phone: '51999999991' };
  const customerB = { id: 'cust_b', tenantId: tenantB, phone: '51999999992' };

  const contactA = { id: 'contact_a', tenantId: tenantA, phone: '51999999991' };
  const contactB = { id: 'contact_b', tenantId: tenantB, phone: '51999999992' };

  const chatA = { id: 'chat_a', tenantId: tenantA, contactId: 'contact_a' };
  const chatB = { id: 'chat_b', tenantId: tenantB, contactId: 'contact_b' };

  const messageA = { id: 'msg_a', tenantId: tenantA, chatId: 'chat_a', content: 'Anota que hoy Gustavito quiere algebra' };
  const messageB = { id: 'msg_b', tenantId: tenantB, chatId: 'chat_b', content: 'Mensaje de tenant B' };

  const orderA = { id: 'order_a', tenantId: tenantA, customerId: 'cust_a' };
  const orderB = { id: 'order_b', tenantId: tenantB, customerId: 'cust_b' };

  mockPrisma._store.users.set(userA.id, userA);
  mockPrisma._store.users.set(userB.id, userB);
  mockPrisma._store.customers.set(customerA.id, customerA);
  mockPrisma._store.customers.set(customerB.id, customerB);
  mockPrisma._store.contacts.set(contactA.id, contactA);
  mockPrisma._store.contacts.set(contactB.id, contactB);
  mockPrisma._store.chats.set(chatA.id, chatA);
  mockPrisma._store.chats.set(chatB.id, chatB);
  mockPrisma._store.messages.set(messageA.id, messageA);
  mockPrisma._store.messages.set(messageB.id, messageB);
  mockPrisma._store.orders.set(orderA.id, orderA);
  mockPrisma._store.orders.set(orderB.id, orderB);

  // A1: NOTE => default ACTIVE
  {
    const res = await createOperationalItem({
      tenantId: tenantA,
      type: 'NOTE',
      category: 'COORDINATION',
      summary: 'Gustavito desea practicar algebra hoy',
      subjectName: 'Gustavito'
    }, { prismaClient: mockPrisma });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.item.type, 'NOTE');
    assert.strictEqual(res.item.status, 'ACTIVE');
    passed++;
    console.log('✅ A1: NOTE => default status ACTIVE');
  }

  // A2: TASK => default PENDING
  {
    const res = await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      category: 'FOLLOW_UP',
      summary: 'Llamar al cliente para coordinar matricula',
      dueDateLocal: '2026-09-10'
    }, { prismaClient: mockPrisma });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.item.type, 'TASK');
    assert.strictEqual(res.item.status, 'PENDING');
    passed++;
    console.log('✅ A2: TASK => default status PENDING');
  }

  // A3: NOTE + COMPLETED => reject
  {
    await assert.rejects(
      createOperationalItem({
        tenantId: tenantA,
        type: 'NOTE',
        status: 'COMPLETED',
        summary: 'Nota con status invalido'
      }, { prismaClient: mockPrisma }),
      /VALIDATION_ERROR.*Estado inválido 'COMPLETED' para tipo NOTE/
    );
    passed++;
    console.log('✅ A3: NOTE + COMPLETED => rejected as invalid state combination');
  }

  // A4: TASK + ARCHIVED => reject
  {
    await assert.rejects(
      createOperationalItem({
        tenantId: tenantA,
        type: 'TASK',
        status: 'ARCHIVED',
        summary: 'Tarea con status invalido'
      }, { prismaClient: mockPrisma }),
      /VALIDATION_ERROR.*Estado inválido 'ARCHIVED' para tipo TASK/
    );
    passed++;
    console.log('✅ A4: TASK + ARCHIVED => rejected as invalid state combination');
  }

  // A5: summary vacío => reject
  {
    await assert.rejects(
      createOperationalItem({
        tenantId: tenantA,
        type: 'NOTE',
        summary: '    '
      }, { prismaClient: mockPrisma }),
      /VALIDATION_ERROR.*summary es obligatorio/
    );
    passed++;
    console.log('✅ A5: Empty summary => rejected');
  }

  // A6: summary >300 => normalización y truncado seguro a 300 caracteres
  {
    const longText = 'A'.repeat(350);
    const sanitized = sanitizeOperationalText(longText, MAX_SUMMARY_LENGTH);
    assert.strictEqual(sanitized.length, 300);
    const res = await createOperationalItem({
      tenantId: tenantA,
      type: 'NOTE',
      summary: longText
    }, { prismaClient: mockPrisma });
    assert.strictEqual(res.item.summary.length, 300);
    passed++;
    console.log('✅ A6: summary >300 characters is safely normalized and truncated');
  }

  // A7: subjectName >80 => truncated cleanly to 80
  {
    const longSubject = 'Estudiante '.repeat(15);
    const sanitized = sanitizeOperationalText(longSubject, MAX_SUBJECT_LENGTH);
    assert.strictEqual(sanitized.length, 80);
    const res = await createOperationalItem({
      tenantId: tenantA,
      type: 'NOTE',
      summary: 'Aviso con subject largo',
      subjectName: longSubject
    }, { prismaClient: mockPrisma });
    assert.strictEqual(res.item.subjectName.length, 80);
    passed++;
    console.log('✅ A7: subjectName >80 is safely sanitized and truncated');
  }

  // A8: invalid category => reject
  {
    await assert.rejects(
      createOperationalItem({
        tenantId: tenantA,
        type: 'NOTE',
        category: 'INVALID_CATEGORY',
        summary: 'Test categoria'
      }, { prismaClient: mockPrisma }),
      /VALIDATION_ERROR.*Categoría inválida/
    );
    passed++;
    console.log('✅ A8: Invalid category => rejected');
  }

  // A9: invalid priority => reject
  {
    await assert.rejects(
      createOperationalItem({
        tenantId: tenantA,
        type: 'TASK',
        priority: 'CRITICAL', // Solo LOW, NORMAL, HIGH
        summary: 'Test prioridad'
      }, { prismaClient: mockPrisma }),
      /VALIDATION_ERROR.*Prioridad inválida/
    );
    passed++;
    console.log('✅ A9: Invalid priority (e.g. CRITICAL) => rejected');
  }

  // A10: dueTime sin dueDate => reject
  {
    await assert.rejects(
      createOperationalItem({
        tenantId: tenantA,
        type: 'TASK',
        dueTimeLocal: '17:00',
        summary: 'Hora sin fecha'
      }, { prismaClient: mockPrisma }),
      /VALIDATION_ERROR.*No se puede especificar dueTimeLocal sin un dueDateLocal/
    );
    passed++;
    console.log('✅ A10: dueTimeLocal without dueDateLocal => rejected');
  }

  // A11: dueDate YYYY-MM-DD válida
  {
    assert.strictEqual(isValidDateString('2026-09-07'), true);
    assert.strictEqual(isValidDateString('2026-02-30'), false); // 30 feb invalido
    assert.strictEqual(isValidDateString('07-09-2026'), false);
    passed++;
    console.log('✅ A11: Strict YYYY-MM-DD date validation');
  }

  // A12: dueTime HH:mm válida
  {
    assert.strictEqual(isValidTimeString('17:00'), true);
    assert.strictEqual(isValidTimeString('09:30'), true);
    assert.strictEqual(isValidTimeString('25:00'), false);
    assert.strictEqual(isValidTimeString('12:61'), false);
    passed++;
    console.log('✅ A12: Strict HH:mm 24h time validation');
  }

  // A13: fecha sin hora se conserva SIN hora inventada (dueTimeLocal: null, dueAt: null)
  {
    const res = await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      summary: 'Llamame manana',
      dueDateLocal: '2026-09-07'
    }, { prismaClient: mockPrisma });
    assert.strictEqual(res.item.dueDateLocal, '2026-09-07');
    assert.strictEqual(res.item.dueTimeLocal, null);
    assert.strictEqual(res.item.dueAt, null);
    passed++;
    console.log('✅ A13: Date without time preserved with null time (NO arbitrary hour invented)');
  }

  // A14: tenant A customerId de B => reject
  {
    await assert.rejects(
      createOperationalItem({
        tenantId: tenantA,
        type: 'NOTE',
        customerId: customerB.id,
        summary: 'Cross-tenant customer'
      }, { prismaClient: mockPrisma }),
      /CUSTOMER_TENANT_MISMATCH/
    );
    passed++;
    console.log('✅ A14: Cross-tenant customerId rejected fail-closed');
  }

  // A15: tenant A chatId de B => reject
  {
    await assert.rejects(
      createOperationalItem({
        tenantId: tenantA,
        type: 'NOTE',
        chatId: chatB.id,
        summary: 'Cross-tenant chat'
      }, { prismaClient: mockPrisma }),
      /CHAT_TENANT_MISMATCH/
    );
    passed++;
    console.log('✅ A15: Cross-tenant chatId rejected fail-closed');
  }

  // A16: tenant A orderId de B => reject
  {
    await assert.rejects(
      createOperationalItem({
        tenantId: tenantA,
        type: 'TASK',
        orderId: orderB.id,
        summary: 'Cross-tenant order'
      }, { prismaClient: mockPrisma }),
      /ORDER_TENANT_MISMATCH/
    );
    passed++;
    console.log('✅ A16: Cross-tenant orderId rejected fail-closed');
  }

  // A17: tenant A sourceMessageId de B => reject
  {
    await assert.rejects(
      createOperationalItem({
        tenantId: tenantA,
        type: 'NOTE',
        sourceMessageId: messageB.id,
        summary: 'Cross-tenant message'
      }, { prismaClient: mockPrisma }),
      /MESSAGE_TENANT_MISMATCH/
    );
    passed++;
    console.log('✅ A17: Cross-tenant sourceMessageId rejected fail-closed');
  }

  // A18: AI cannot inject createdByUserId
  {
    await assert.rejects(
      createOperationalItem({
        tenantId: tenantA,
        type: 'NOTE',
        createdByType: 'AI',
        createdByUserId: userA.id,
        summary: 'AI intentando inyectar userId'
      }, { prismaClient: mockPrisma }),
      /AI_CANNOT_HAVE_USER_ID/
    );
    passed++;
    console.log('✅ A18: AI creation cannot assign createdByUserId');
  }

  // A19: USER creator must belong to tenant
  {
    await assert.rejects(
      createOperationalItem({
        tenantId: tenantA,
        type: 'TASK',
        createdByType: 'USER',
        createdByUserId: userB.id, // Pertenece a tenant B
        summary: 'Usuario de tenant B creando en tenant A'
      }, { prismaClient: mockPrisma }),
      /USER_TENANT_MISMATCH/
    );
    passed++;
    console.log('✅ A19: USER creator must belong strictly to same tenantId');
  }

  // A20: same dedupeKey concurrent/repeated => exactly one row semantics
  {
    const res1 = await createOperationalItem({
      tenantId: tenantA,
      sourceMessageId: messageA.id,
      type: 'NOTE',
      category: 'COORDINATION',
      summary: 'Gustavito algebra'
    }, { prismaClient: mockPrisma });
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.deduplicated, false);

    // Segunda llamada concurrente/idéntica con mismo mensaje y payload
    const res2 = await createOperationalItem({
      tenantId: tenantA,
      sourceMessageId: messageA.id,
      type: 'NOTE',
      category: 'COORDINATION',
      summary: 'Gustavito algebra'
    }, { prismaClient: mockPrisma });
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.deduplicated, true);
    assert.strictEqual(res2.item.id, res1.item.id);
    passed++;
    console.log('✅ A20: Database unique constraint idempotency returns existing row on deduplication');
  }

  // A21: complete TASK => completedAt + completedBy
  {
    const task = await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      summary: 'Llamar al alumno Manolo'
    }, { prismaClient: mockPrisma });

    const completed = await completeOperationalTask({
      tenantId: tenantA,
      id: task.item.id,
      userId: userA.id
    }, { prismaClient: mockPrisma });

    assert.strictEqual(completed.status, 'COMPLETED');
    assert.ok(completed.completedAt instanceof Date);
    assert.strictEqual(completed.completedByUserId, userA.id);
    passed++;
    console.log('✅ A21: completeOperationalTask sets COMPLETED, timestamp and completedByUserId');
  }

  // A22: complete NOTE => reject
  {
    const note = await createOperationalItem({
      tenantId: tenantA,
      type: 'NOTE',
      summary: 'Nota informativa general'
    }, { prismaClient: mockPrisma });

    await assert.rejects(
      completeOperationalTask({
        tenantId: tenantA,
        id: note.item.id,
        userId: userA.id
      }, { prismaClient: mockPrisma }),
      /CANNOT_COMPLETE_NON_TASK/
    );
    passed++;
    console.log('✅ A22: complete on NOTE rejected (notes must be archived, not completed)');
  }

  // A23: archive NOTE => success
  {
    const note = await createOperationalItem({
      tenantId: tenantA,
      type: 'NOTE',
      summary: 'Recado de asistencia'
    }, { prismaClient: mockPrisma });

    const archived = await archiveOperationalNote({
      tenantId: tenantA,
      id: note.item.id
    }, { prismaClient: mockPrisma });

    assert.strictEqual(archived.status, 'ARCHIVED');
    passed++;
    console.log('✅ A23: archiveOperationalNote sets status to ARCHIVED');
  }

  // A24: archive TASK => reject
  {
    const task = await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      summary: 'Tarea de soporte'
    }, { prismaClient: mockPrisma });

    await assert.rejects(
      archiveOperationalNote({
        tenantId: tenantA,
        id: task.item.id
      }, { prismaClient: mockPrisma }),
      /CANNOT_ARCHIVE_NON_NOTE/
    );
    passed++;
    console.log('✅ A24: archive on TASK rejected (tasks must be completed or canceled)');
  }

  // A25: list tenant A => zero records Tenant B
  {
    // Crear item en tenant B
    await createOperationalItem({
      tenantId: tenantB,
      type: 'NOTE',
      summary: 'Nota secreta de tenant B'
    }, { prismaClient: mockPrisma });

    const listA = await listOperationalItems({
      tenantId: tenantA
    }, { prismaClient: mockPrisma });

    const itemsFromB = listA.items.filter(it => it.tenantId === tenantB);
    assert.strictEqual(itemsFromB.length, 0);
    assert.ok(listA.items.length > 0);
    passed++;
    console.log('✅ A25: Multi-tenant query isolation (Tenant A sees 0 records from Tenant B)');
  }

  // A26: cancel TASK => sets CANCELED
  {
    const task = await createOperationalItem({
      tenantId: tenantA,
      type: 'TASK',
      summary: 'Tarea descartada'
    }, { prismaClient: mockPrisma });

    const canceled = await cancelOperationalTask({
      tenantId: tenantA,
      id: task.item.id
    }, { prismaClient: mockPrisma });

    assert.strictEqual(canceled.status, 'CANCELED');
    passed++;
    console.log('✅ A26: cancelOperationalTask sets status to CANCELED');
  }

  // A27: generic update cannot change tenantId
  {
    const item = await createOperationalItem({
      tenantId: tenantA,
      type: 'NOTE',
      summary: 'Intento de hack de tenant'
    }, { prismaClient: mockPrisma });

    await assert.rejects(
      updateOperationalItem({
        tenantId: tenantA,
        id: item.item.id,
        updates: { tenantId: tenantB }
      }, { prismaClient: mockPrisma }),
      /PROHIBITED_FIELD_UPDATE.*tenantId/
    );
    passed++;
    console.log('✅ A27: Prohibited field update blocks tenantId alteration');
  }

  // A28: generic update cannot change dedupeKey
  {
    const item = await createOperationalItem({
      tenantId: tenantA,
      type: 'NOTE',
      summary: 'Intento de hack de dedupeKey'
    }, { prismaClient: mockPrisma });

    await assert.rejects(
      updateOperationalItem({
        tenantId: tenantA,
        id: item.item.id,
        updates: { dedupeKey: 'forged_dedupe_key' }
      }, { prismaClient: mockPrisma }),
      /PROHIBITED_FIELD_UPDATE.*dedupeKey/
    );
    passed++;
    console.log('✅ A28: Prohibited field update blocks dedupeKey alteration');
  }

  // A29: details oversized => reject
  {
    const bigPayload = { nested: 'x'.repeat(4500) };
    await assert.rejects(
      createOperationalItem({
        tenantId: tenantA,
        type: 'NOTE',
        summary: 'Payload con details gigante',
        details: bigPayload
      }, { prismaClient: mockPrisma }),
      /VALIDATION_ERROR.*details excede el límite máximo/
    );
    passed++;
    console.log('✅ A29: Oversized details (>4KB) rejected');
  }

  // A30: sourceMessage / chat ownership consistency (message belongs to specified chat)
  {
    // Crear otro chat en tenant A
    const otherChatA = { id: 'chat_a_other', tenantId: tenantA, contactId: 'contact_a' };
    mockPrisma._store.chats.set(otherChatA.id, otherChatA);

    await assert.rejects(
      createOperationalItem({
        tenantId: tenantA,
        type: 'NOTE',
        chatId: otherChatA.id,
        sourceMessageId: messageA.id, // messageA pertenece a chat_a, no a chat_a_other
        summary: 'Inconsistencia mensaje-chat'
      }, { prismaClient: mockPrisma }),
      /MESSAGE_CHAT_MISMATCH/
    );
    passed++;
    console.log('✅ A30: Cross-chat message consistency verified (sourceMessageId must match chatId)');
  }

  // BONUS: Privacy & Redaction Sanity Check
  {
    const sensitive = 'Mi tarjeta es 4532 1122 3344 5566 y mi CVV: 789 y password=supersecret';
    const cleaned = sanitizeOperationalText(sensitive);
    assert.ok(cleaned.includes('[TARJETA_REDACTADA]'));
    assert.ok(cleaned.includes('[CVV_REDACTADO]'));
    assert.ok(cleaned.includes('[SECRETO_REDACTADO]'));
    assert.ok(!cleaned.includes('4532'));
    assert.ok(!cleaned.includes('789'));
    assert.ok(!cleaned.includes('supersecret'));
    console.log('✅ BONUS: Privacy redaction masks credit cards, CVVs, and credentials');
  }

  console.log(`\n🎉 TODAS LAS PRUEBAS COMPLETADAS EXITOSAMENTE: ${passed}/30 tests pasaron.`);
}

runTests().catch(err => {
  console.error('\n❌ ERROR EN PRUEBAS A1-A30:', err);
  process.exit(1);
});
