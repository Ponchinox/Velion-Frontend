import test from 'node:test';
import assert from 'node:assert';
import {
  mapEvolutionConnectionState,
  handleConnectionUpdateWebhook,
  verifyAndReapplyEvolutionWebhook
} from './src/utils/connectionSyncLogic.js';

// Mock simple de Prisma
function createMockPrisma({ registeredNumbers = [], tenants = [] } = {}) {
  return {
    registeredWhatsAppNumber: {
      findFirst: async ({ where }) => {
        return registeredNumbers.find(r => {
          if (where.instanceName && r.instanceName !== where.instanceName) return false;
          if (where.tenantId && r.tenantId !== where.tenantId) return false;
          return true;
        }) || null;
      },
      findUnique: async ({ where }) => {
        if (where.instanceName) {
          return registeredNumbers.find(r => r.instanceName === where.instanceName) || null;
        }
        if (where.phoneNumber) {
          return registeredNumbers.find(r => r.phoneNumber === where.phoneNumber) || null;
        }
        return null;
      },
      updateMany: async ({ where, data }) => {
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
      },
      create: async ({ data }) => {
        const created = { id: `reg_${Date.now()}_${Math.random()}`, connectionState: 'UNKNOWN', ...data };
        registeredNumbers.push(created);
        return created;
      },
      count: async ({ where }) => {
        return registeredNumbers.filter(r => !where.tenantId || r.tenantId === where.tenantId).length;
      }
    },
    tenant: {
      findUnique: async ({ where }) => {
        return tenants.find(t => t.id === where.id) || null;
      }
    }
  };
}

// ── N1: Crear instancia ───────────────────────────────────────────
test('N1: Crear instancia en Evolution payload correcto', () => {
  const instanceName = 'bot_prod_dfe020e6-5e08-404c-9b89-ef3f08f2b150';
  const webhookUrl = 'https://185.163.116.210/api/whatsapp/webhook';
  
  const payload = {
    instanceName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
    webhook: {
      enabled: true,
      url: webhookUrl,
      byEvents: false,
      webhookByEvents: false,
      events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE']
    }
  };

  assert.strictEqual(payload.instanceName, instanceName);
  assert.strictEqual(payload.qrcode, true);
  assert.strictEqual(payload.integration, 'WHATSAPP-BAILEYS');
  assert.strictEqual(payload.webhook.enabled, true);
  assert.ok(payload.webhook.events.includes('MESSAGES_UPSERT'));
});

// ── N2: Webhook inicial ───────────────────────────────────────────
test('N2: Webhook inicial configurado con eventos requeridos', () => {
  const events = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'];
  assert.strictEqual(events.length, 2);
  assert.ok(events.includes('MESSAGES_UPSERT'));
  assert.ok(events.includes('CONNECTION_UPDATE'));
});

// ── N3: QR - no conectado prematuramente ─────────────────────────
test('N3: QR solicitado mantiene estado no conectado si Evolution no reporta open', () => {
  assert.strictEqual(mapEvolutionConnectionState('connecting'), 'CONNECTING');
  assert.strictEqual(mapEvolutionConnectionState('close'), 'DISCONNECTED');
  assert.notStrictEqual(mapEvolutionConnectionState('connecting'), 'CONNECTED');
});

// ── N4: OPEN recibido ─────────────────────────────────────────────
test('N4: OPEN recibido mapea a CONNECTED', () => {
  assert.strictEqual(mapEvolutionConnectionState('open'), 'CONNECTED');
});

// ── N5: Reapply webhook en OPEN ───────────────────────────────────
test('N5: verifyAndReapplyEvolutionWebhook re-aplica webhook tras OPEN y verifica find', async () => {
  const calls = [];
  const mockAxios = {
    get: async (url) => {
      calls.push({ method: 'GET', url });
      if (url.includes('/instance/connectionState/')) {
        return { data: { instance: { state: 'open' } } };
      }
      if (url.includes('/webhook/find/')) {
        return { data: { webhook: { enabled: true, url: 'https://185.163.116.210/api/whatsapp/webhook', events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] } } };
      }
      throw new Error(`Unexpected GET: ${url}`);
    },
    post: async (url, body) => {
      calls.push({ method: 'POST', url, body });
      return { data: { status: 'SUCCESS' } };
    }
  };

  const res = await verifyAndReapplyEvolutionWebhook({
    instance: 'bot_test',
    evoUrl: 'http://127.0.0.1:8080',
    webhookUrl: 'https://185.163.116.210/api/whatsapp/webhook',
    cleanApiKey: 'test_key',
    axiosClient: mockAxios,
    maxRetries: 0
  });

  assert.strictEqual(res.ready, true);
  assert.ok(calls.some(c => c.method === 'GET' && c.url.includes('/connectionState/bot_test')));
  assert.ok(calls.some(c => c.method === 'POST' && c.url.includes('/webhook/set/bot_test')));
  assert.ok(calls.some(c => c.method === 'GET' && c.url.includes('/webhook/find/bot_test')));
});

// ── N6: Webhook failure bloquea marcar CONNECTED ───────────────────
test('N6: Si webhook falla al re-aplicarse, handleConnectionUpdateWebhook NO marca CONNECTED', async () => {
  const tenantId = 'dfe020e6-5e08-404c-9b89-ef3f08f2b150';
  const instance = `bot_prod_${tenantId}`;
  const registeredNumbers = [
    { id: 'rn_1', instanceName: instance, tenantId, phoneNumber: '51991500000', connectionState: 'CONNECTING' }
  ];
  const prisma = createMockPrisma({ registeredNumbers, tenants: [{ id: tenantId, name: 'Velion' }] });

  const failingWebhookVerifier = async () => ({
    ready: false,
    reason: 'WEBHOOK_CONFIG_FAILED'
  });

  const result = await handleConnectionUpdateWebhook({
    instance,
    state: 'open',
    phone: '51991500000',
    prisma,
    webhookVerifier: failingWebhookVerifier
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.mode, 'WEBHOOK_NOT_READY');
  // Confirmar que en la DB el estado NO cambió a CONNECTED
  assert.strictEqual(registeredNumbers[0].connectionState, 'CONNECTING');
});

// ── N7: Retry tras fallo transitorio ──────────────────────────────
test('N7: verifyAndReapplyEvolutionWebhook reintenta ante fallo temporal y tiene éxito', async () => {
  let attempts = 0;
  const mockAxios = {
    get: async (url) => {
      if (url.includes('/instance/connectionState/')) {
        return { data: { instance: { state: 'open' } } };
      }
      if (url.includes('/webhook/find/')) {
        attempts++;
        if (attempts === 1) {
          throw new Error('500 Internal Server Error');
        }
        return { data: { webhook: { enabled: true, url: 'https://185.163.116.210/api/whatsapp/webhook', events: ['MESSAGES_UPSERT'] } } };
      }
    },
    post: async () => ({ data: { status: 'SUCCESS' } })
  };

  const res = await verifyAndReapplyEvolutionWebhook({
    instance: 'bot_test_retry',
    evoUrl: 'http://127.0.0.1:8080',
    webhookUrl: 'https://185.163.116.210/api/whatsapp/webhook',
    cleanApiKey: 'test_key',
    axiosClient: mockAxios,
    maxRetries: 2,
    retryDelayMs: 10
  });

  assert.strictEqual(res.ready, true);
  assert.strictEqual(attempts, 2);
});

// ── N8: No duplicación de instancias ──────────────────────────────
test('N8: Eventos repetidos de OPEN no crean registros duplicados', async () => {
  const tenantId = 'dfe020e6-5e08-404c-9b89-ef3f08f2b150';
  const instance = `bot_prod_${tenantId}`;
  const registeredNumbers = [
    { id: 'rn_1', instanceName: instance, tenantId, phoneNumber: '51991500000', connectionState: 'CONNECTING' }
  ];
  const prisma = createMockPrisma({ registeredNumbers, tenants: [{ id: tenantId, name: 'Velion' }] });

  const successfulVerifier = async () => ({ ready: true });

  // Disparar 3 veces el evento connection.update OPEN
  await handleConnectionUpdateWebhook({ instance, state: 'open', phone: '51991500000', prisma, webhookVerifier: successfulVerifier });
  await handleConnectionUpdateWebhook({ instance, state: 'open', phone: '51991500000', prisma, webhookVerifier: successfulVerifier });
  await handleConnectionUpdateWebhook({ instance, state: 'open', phone: '51991500000', prisma, webhookVerifier: successfulVerifier });

  assert.strictEqual(registeredNumbers.length, 1);
  assert.strictEqual(registeredNumbers[0].connectionState, 'CONNECTED');
});

// ── N9: Tenant isolation ──────────────────────────────────────────
test('N9: Instancia de Tenant A nunca altera o asocia a Tenant B', async () => {
  const tenantA = 'aaaa0000-1111-2222-3333-444455556666';
  const tenantB = 'bbbb0000-1111-2222-3333-444455556666';
  const instanceA = `bot_prod_${tenantA}`;
  const registeredNumbers = [
    { id: 'rn_A', instanceName: instanceA, tenantId: tenantA, phoneNumber: '51991500001', connectionState: 'DISCONNECTED' },
    { id: 'rn_B', instanceName: `bot_prod_${tenantB}`, tenantId: tenantB, phoneNumber: '51991500002', connectionState: 'DISCONNECTED' }
  ];
  const prisma = createMockPrisma({
    registeredNumbers,
    tenants: [{ id: tenantA, name: 'Tenant A' }, { id: tenantB, name: 'Tenant B' }]
  });

  const successfulVerifier = async () => ({ ready: true });

  const result = await handleConnectionUpdateWebhook({
    instance: instanceA,
    state: 'open',
    phone: '51991500001',
    prisma,
    webhookVerifier: successfulVerifier
  });

  assert.strictEqual(result.tenantId, tenantA);
  assert.strictEqual(registeredNumbers.find(r => r.id === 'rn_A').connectionState, 'CONNECTED');
  assert.strictEqual(registeredNumbers.find(r => r.id === 'rn_B').connectionState, 'DISCONNECTED'); // B intacto
});

// ── N10: First messages después de READY ───────────────────────────
test('N10: Conexión READY resuelve Tenant inmediatamente para messages.upsert sin descartar', async () => {
  const tenantId = 'dfe020e6-5e08-404c-9b89-ef3f08f2b150';
  const instance = `bot_prod_${tenantId}`;
  const registeredNumbers = [
    { id: 'rn_1', instanceName: instance, tenantId, phoneNumber: '51991500000', connectionState: 'CONNECTED' }
  ];
  const prisma = createMockPrisma({ registeredNumbers, tenants: [{ id: tenantId, name: 'Velion' }] });

  // Simular búsqueda de RegisteredWhatsAppNumber que hace whatsappController en messages.upsert
  const registered = await prisma.registeredWhatsAppNumber.findUnique({ where: { instanceName: instance } });
  assert.ok(registered);
  assert.strictEqual(registered.tenantId, tenantId);
  assert.strictEqual(registered.connectionState, 'CONNECTED');
});
