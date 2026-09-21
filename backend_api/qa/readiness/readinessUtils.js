/**
 * readinessUtils.js — Utilidades y Mocks Compartidos para Production Readiness
 * ============================================================================
 * Garantías:
 * - Network Guard activo antes de cualquier importación.
 * - S/0.00 costo, 0 llamadas salientes WAN, 0 conexiones PostgreSQL.
 * - Capturador de excepciones globales y telemetría de memoria/latencia.
 */

import '../networkGuard.js';
import { networkGuardMetrics } from '../networkGuard.js';
import {
  _resetProcessingStateForTesting,
  _resetChatGenerationVersionsForTesting,
  processingLocks,
  pendingQueues,
  messageBuffers,
  getChatGenerationVersion,
  incrementChatGenerationVersion
} from '../../src/controllers/whatsappController.js';
import {
  globalCircuitBreaker,
  groqCircuitBreaker
} from '../../src/services/aiService.js';

/**
 * Gestor de eventos globales no manejados para garantizar 0 crashes silenciosos
 */
export class GlobalErrorTracker {
  constructor() {
    this.unhandledRejections = [];
    this.uncaughtExceptions = [];
    this._onRejection = (reason) => {
      this.unhandledRejections.push(reason);
      console.error('🚨 [GLOBAL ERROR TRACKER] unhandledRejection detectada:', reason?.message || reason);
    };
    this._onException = (error) => {
      this.uncaughtExceptions.push(error);
      console.error('🚨 [GLOBAL ERROR TRACKER] uncaughtException detectada:', error?.message || error);
    };
  }

  start() {
    this.unhandledRejections = [];
    this.uncaughtExceptions = [];
    process.on('unhandledRejection', this._onRejection);
    process.on('uncaughtException', this._onException);
  }

  stop() {
    process.removeListener('unhandledRejection', this._onRejection);
    process.removeListener('uncaughtException', this._onException);
  }

  assertClean() {
    if (this.unhandledRejections.length > 0) {
      throw new Error(`Se detectaron ${this.unhandledRejections.length} unhandledRejection(s): ${this.unhandledRejections.map(e => e?.message || e).join('; ')}`);
    }
    if (this.uncaughtExceptions.length > 0) {
      throw new Error(`Se detectaron ${this.uncaughtExceptions.length} uncaughtException(s): ${this.uncaughtExceptions.map(e => e?.message || e).join('; ')}`);
    }
  }
}

/**
 * Interceptor de envíos del Gateway para registrar mensajes y detectar duplicados
 */
export class InterceptedGateway {
  constructor() {
    this.outbounds = [];
    this.mediaOutbounds = [];
    this.duplicateOutbounds = [];
    this.duplicateMedia = [];
    this._seenTextKeys = new Map(); // key -> count
    this._seenMediaKeys = new Map(); // key -> count
  }

  reset() {
    this.outbounds = [];
    this.mediaOutbounds = [];
    this.duplicateOutbounds = [];
    this.duplicateMedia = [];
    this._seenTextKeys.clear();
    this._seenMediaKeys.clear();
  }

  recordText(dest, text, meta = {}) {
    const key = `${dest}:::${String(text).trim()}`;
    const count = (this._seenTextKeys.get(key) || 0) + 1;
    this._seenTextKeys.set(key, count);

    const record = { dest, text, meta, timestamp: Date.now() };
    this.outbounds.push(record);

    if (count > 1) {
      this.duplicateOutbounds.push(record);
      console.warn(`⚠️ [DUPLICATE OUTBOUND TEXT] Para ${dest}: "${String(text).slice(0, 40)}..." (veces: ${count})`);
    }
    return `msg-mock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  recordMedia(dest, mediaObj, meta = {}) {
    const key = `${dest}:::${mediaObj.url || mediaObj.mediaUrl || ''}`;
    const count = (this._seenMediaKeys.get(key) || 0) + 1;
    this._seenMediaKeys.set(key, count);

    const record = { dest, ...mediaObj, meta, timestamp: Date.now() };
    this.mediaOutbounds.push(record);

    if (count > 1) {
      this.duplicateMedia.push(record);
      console.warn(`⚠️ [DUPLICATE OUTBOUND MEDIA] Para ${dest}: ${mediaObj.url} (veces: ${count})`);
    }
    return `media-mock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }
}

function matchesOrConditions(record, orList) {
  if (!Array.isArray(orList) || orList.length === 0) return true;
  return orList.some((cond) => {
    for (const [key, val] of Object.entries(cond)) {
      if (val && typeof val === 'object' && 'contains' in val) {
        const targetVal = String(record[key] || '');
        if (targetVal.includes(String(val.contains))) return true;
      } else if (record[key] === val) {
        return true;
      }
    }
    return false;
  });
}

function projectSelect(record, select) {
  if (!record || !select) return record ? { ...record } : null;
  const res = {};
  for (const k in select) {
    if (select[k]) res[k] = record[k];
  }
  return res;
}

/**
 * Almacén en RAM para Prisma Client con soporte multitenant y operaciones comunes
 */
export function createMockPrismaStore(initialData = {}) {
  const tenants = new Map();
  const products = new Map();
  const contacts = new Map();
  const chats = new Map();
  const customers = new Map();
  const messages = [];
  const operationalItems = new Map();
  const registeredNumbers = new Map();

  let idSeq = 1;
  const genId = (prefix = 'id') => `${prefix}-${Date.now()}-${idSeq++}`;

  if (initialData.tenants) {
    for (const t of initialData.tenants) tenants.set(t.id, { ...t });
  }
  if (initialData.products) {
    for (const p of initialData.products) products.set(p.id, { ...p });
  }

  return {
    _raw: { tenants, products, contacts, chats, customers, messages, operationalItems, registeredNumbers },

    tenant: {
      findUnique: async ({ where, select }) => {
        const t = tenants.get(where.id);
        if (!t) return null;
        return projectSelect(t, select);
      },
      findFirst: async ({ where, select }) => {
        for (const t of tenants.values()) {
          if (where?.id && t.id !== where.id) continue;
          return projectSelect(t, select);
        }
        return null;
      },
      create: async ({ data }) => {
        const id = data.id || genId('tenant');
        const rec = { id, ...data };
        tenants.set(id, rec);
        return { ...rec };
      }
    },

    product: {
      findUnique: async ({ where }) => {
        return products.get(where.id) ? { ...products.get(where.id) } : null;
      },
      findFirst: async ({ where, select }) => {
        for (const p of products.values()) {
          if (where?.id && p.id !== where.id) continue;
          if (where?.tenantId && p.tenantId !== where.tenantId) continue;
          if (where?.user?.tenantId && p.tenantId !== where.user.tenantId) continue;
          return projectSelect(p, select);
        }
        return null;
      },
      findMany: async ({ where }) => {
        const list = [];
        for (const p of products.values()) {
          if (where?.tenantId && p.tenantId !== where.tenantId) continue;
          if (where?.user?.tenantId && p.tenantId !== where.user.tenantId) continue;
          list.push({ ...p });
        }
        return list;
      },
      create: async ({ data }) => {
        const id = data.id || genId('prod');
        const rec = { id, ...data };
        products.set(id, rec);
        return { ...rec };
      }
    },

    contact: {
      findFirst: async ({ where, select }) => {
        for (const c of contacts.values()) {
          if (where?.id && c.id !== where.id) continue;
          if (where?.tenantId && c.tenantId !== where.tenantId) continue;
          if (where?.phone && c.phone !== where.phone) continue;
          if (where?.OR && !matchesOrConditions(c, where.OR)) continue;
          return projectSelect(c, select);
        }
        return null;
      },
      create: async ({ data }) => {
        const id = data.id || genId('contact');
        const rec = { id, botPaused: false, ...data };
        contacts.set(id, rec);
        return { ...rec };
      },
      update: async ({ where, data }) => {
        const rec = contacts.get(where.id);
        if (!rec) return null;
        Object.assign(rec, data);
        return { ...rec };
      }
    },

    chat: {
      findFirst: async ({ where, select }) => {
        for (const ch of chats.values()) {
          if (where?.id && ch.id !== where.id) continue;
          if (where?.tenantId && ch.tenantId !== where.tenantId) continue;
          if (where?.contactId && ch.contactId !== where.contactId) continue;
          if (where?.OR && !matchesOrConditions(ch, where.OR)) continue;
          return projectSelect(ch, select);
        }
        return null;
      },
      create: async ({ data }) => {
        const id = data.id || genId('chat');
        const rec = { id, botPaused: false, ...data };
        chats.set(id, rec);
        return { ...rec };
      },
      update: async ({ where, data }) => {
        const rec = chats.get(where.id);
        if (!rec) return null;
        Object.assign(rec, data);
        return { ...rec };
      }
    },

    customer: {
      findFirst: async ({ where, select }) => {
        for (const c of customers.values()) {
          if (where?.tenantId && c.tenantId !== where.tenantId) continue;
          if (where?.phone && c.phone !== where.phone) continue;
          if (where?.id && c.id !== where.id) continue;
          if (where?.OR && !matchesOrConditions(c, where.OR)) continue;
          return projectSelect(c, select);
        }
        return null;
      },
      findMany: async ({ where } = {}) => {
        const list = [];
        for (const c of customers.values()) {
          if (where?.tenantId && c.tenantId !== where.tenantId) continue;
          if (where?.phone && c.phone !== where.phone) continue;
          list.push({ ...c });
        }
        return list;
      },
      findUnique: async ({ where }) => {
        if (where?.tenantId_phone) {
          const key = `${where.tenantId_phone.tenantId}:${where.tenantId_phone.phone}`;
          return customers.get(key) ? { ...customers.get(key) } : null;
        }
        if (where?.id) {
          for (const c of customers.values()) {
            if (c.id === where.id) return { ...c };
          }
        }
        return null;
      },
      create: async ({ data }) => {
        const id = data.id || genId('cust');
        const key = `${data.tenantId}:${data.phone}`;
        const rec = { id, isBanned: false, isBotPaused: false, ...data };
        customers.set(key, rec);
        return { ...rec };
      },
      update: async ({ where, data }) => {
        let rec = null;
        if (where?.id) {
          for (const c of customers.values()) {
            if (c.id === where.id) {
              rec = c;
              break;
            }
          }
        }
        if (rec) {
          Object.assign(rec, data);
          return { ...rec };
        }
        return null;
      }
    },

    message: {
      findFirst: async ({ where, orderBy, select }) => {
        const filtered = messages.filter(m => {
          if (where?.chatId && m.chatId !== where.chatId) return false;
          if (where?.tenantId && m.tenantId !== where.tenantId) return false;
          if (where?.senderRole && m.senderRole !== where.senderRole) return false;
          return true;
        });
        if (orderBy?.createdAt === 'desc') {
          filtered.sort((a, b) => b.createdAt - a.createdAt);
        }
        const item = filtered[0] || null;
        if (!item || !select) return item ? { ...item } : null;
        const res = {};
        for (const k in select) if (select[k]) res[k] = item[k];
        return res;
      },
      findMany: async ({ where, orderBy, take }) => {
        let list = messages.filter(m => {
          if (where?.chatId && m.chatId !== where.chatId) return false;
          if (where?.tenantId && m.tenantId !== where.tenantId) return false;
          return true;
        });
        if (orderBy?.createdAt === 'desc') {
          list.sort((a, b) => b.createdAt - a.createdAt);
        }
        if (typeof take === 'number') {
          list = list.slice(0, take);
        }
        return list.map(m => ({ ...m }));
      },
      create: async ({ data }) => {
        const id = data.id || genId('msg');
        const rec = { id, createdAt: new Date(), ...data };
        messages.push(rec);
        return { ...rec };
      }
    },

    operationalItem: {
      create: async ({ data }) => {
        const id = data.id || genId('op-item');
        const rec = { id, createdAt: new Date(), ...data };
        operationalItems.set(id, rec);
        return { ...rec };
      },
      findFirst: async ({ where }) => {
        for (const item of operationalItems.values()) {
          if (where?.id && item.id !== where.id) continue;
          if (where?.tenantId && item.tenantId !== where.tenantId) continue;
          if (where?.dedupeKey && item.dedupeKey !== where.dedupeKey) continue;
          return { ...item };
        }
        return null;
      },
      findMany: async ({ where }) => {
        const list = [];
        for (const item of operationalItems.values()) {
          if (where?.id && item.id !== where.id) continue;
          if (where?.tenantId && item.tenantId !== where.tenantId) continue;
          list.push({ ...item });
        }
        return list;
      }
    },

    $transaction: async (operations) => {
      const results = [];
      for (const op of operations) {
        results.push(await op);
      }
      return results;
    }
  };
}

/**
 * Resetea completamente el estado en memoria entre pruebas
 */
export function resetTestingEnvironment() {
  _resetProcessingStateForTesting();
  _resetChatGenerationVersionsForTesting();
  processingLocks.clear();
  pendingQueues.clear();
  for (const b of messageBuffers.values()) {
    if (b.timer) clearTimeout(b.timer);
  }
  messageBuffers.clear();

  // Reset circuit breakers
  globalCircuitBreaker.state = 'CLOSED';
  globalCircuitBreaker.consecutiveFailures = 0;
  globalCircuitBreaker.lastFailureTime = 0;

  groqCircuitBreaker.state = 'CLOSED';
  groqCircuitBreaker.consecutiveFailures = 0;
  groqCircuitBreaker.lastFailureTime = 0;
}

/**
 * Obtiene métricas del uso de memoria actual en megabytes
 */
export function getMemorySnapshotMb() {
  const mem = process.memoryUsage();
  return {
    rssMb: Number((mem.rss / (1024 * 1024)).toFixed(2)),
    heapUsedMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(2)),
    heapTotalMb: Number((mem.heapTotal / (1024 * 1024)).toFixed(2)),
    externalMb: Number((mem.external / (1024 * 1024)).toFixed(2))
  };
}
