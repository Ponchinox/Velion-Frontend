/**
 * Unified In-Memory Prisma Mock for Velion QA
 * ============================================
 * Implementa un almacén completamente en RAM con la API estándar de Prisma Client.
 * Garantiza:
 * - 0 conexiones a PostgreSQL
 * - 0 escrituras en base de datos de producción
 * - Aislamiento determinista entre suites
 */

export function createUnifiedMockPrisma(initialData = {}) {
  const tenants = new Map();
  const users = new Map();
  const products = new Map();
  const customers = new Map();
  const orders = new Map();
  const orderItems = new Map();
  const contacts = new Map();
  const campaignLogs = new Map();
  const systemConfigs = new Map();
  const tenantAIUsages = new Map();

  let idSeq = 1;
  const genId = (prefix = 'id') => `${prefix}-${Date.now()}-${idSeq++}`;

  // Cargar datos iniciales si se proporcionan
  if (initialData.tenants) {
    for (const t of initialData.tenants) tenants.set(t.id, { ...t });
  }
  if (initialData.products) {
    for (const p of initialData.products) products.set(p.id, { ...p });
  }

  return {
    _raw: { tenants, users, products, customers, orders, contacts, systemConfigs, tenantAIUsages },

    tenant: {
      async findUnique({ where, select }) {
        const item = tenants.get(where.id);
        if (!item) return null;
        if (!select) return { ...item };
        const res = {};
        for (const k in select) if (select[k]) res[k] = item[k];
        return res;
      },
      async findFirst({ where }) {
        for (const t of tenants.values()) {
          if (where?.id && t.id !== where.id) continue;
          return { ...t };
        }
        return null;
      },
      async create({ data }) {
        const id = data.id || genId('tenant');
        const record = { id, ...data };
        tenants.set(id, record);
        return { ...record };
      }
    },

    product: {
      async findUnique({ where }) {
        return products.get(where.id) ? { ...products.get(where.id) } : null;
      },
      async findFirst({ where, select }) {
        for (const p of products.values()) {
          if (where?.id && p.id !== where.id) continue;
          if (where?.user?.tenantId && p.tenantId !== where.user.tenantId) continue;
          if (where?.tenantId && p.tenantId !== where.tenantId) continue;

          if (!select) return { ...p };
          const res = {};
          for (const k in select) if (select[k]) res[k] = p[k];
          return res;
        }
        return null;
      },
      async findMany({ where }) {
        const list = [];
        for (const p of products.values()) {
          if (where?.tenantId && p.tenantId !== where.tenantId) continue;
          if (where?.user?.tenantId && p.tenantId !== where.user.tenantId) continue;
          list.push({ ...p });
        }
        return list;
      },
      async create({ data }) {
        const id = data.id || genId('prod');
        const record = { id, ...data };
        products.set(id, record);
        return { ...record };
      }
    },

    systemConfig: {
      async findMany({ where }) {
        const keys = where?.key?.in || [];
        const res = [];
        for (const [k, v] of systemConfigs.entries()) {
          if (keys.length === 0 || keys.includes(k)) {
            res.push({ key: k, value: v });
          }
        }
        return res;
      }
    },

    tenantAIUsage: {
      async findUnique({ where }) {
        const key = `${where.tenantId_date.tenantId}_${where.tenantId_date.date}`;
        return tenantAIUsages.get(key) || null;
      },
      async aggregate({ where }) {
        let sumTokens = 0;
        for (const [k, v] of tenantAIUsages.entries()) {
          if (k.startsWith(where.tenantId)) {
            sumTokens += (v.totalTokens || 0);
          }
        }
        return { _sum: { totalTokens: sumTokens } };
      }
    }
  };
}
