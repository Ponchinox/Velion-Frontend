process.env.NODE_ENV = 'test';
process.env.EVOLUTION_API_KEY = 'test_evo_secret_key_123';
process.env.META_APP_SECRET = 'test_meta_app_secret_abc';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'test_meta_verify_token_xyz';

import assert from 'node:assert';
import crypto from 'crypto';
import prisma from './src/db.js';
import { verifyMetaSignature } from './src/middlewares/metaWebhookAuth.js';
import {
  receiveEvolutionWebhook,
  receiveMetaWebhook,
  receiveWebhook,
  receiveMetaVerification
} from './src/controllers/whatsappController.js';

console.log('======================================================================');
console.log('🧪 P0 META WEBHOOK AUTHENTICATION & STATUS SCOPING TEST SUITE');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

function createMockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    sendStatus(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    send(data) {
      this.body = data;
      return this;
    }
  };
  return res;
}

function computeMetaSignature(rawBody, secret) {
  const hash = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return `sha256=${hash}`;
}

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}:`, err.message);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE DE PRUEBAS OBLIGATORIAS (TEST A - TEST L)
// ─────────────────────────────────────────────────────────────────────────────

// TEST A: POST Evolution sin API key => rejected (401)
await runTest('TEST A: POST Evolution sin API key => rejected (401)', async () => {
  const req = {
    headers: {},
    query: {},
    body: { event: 'messages.upsert', data: {} }
  };
  const res = createMockResponse();

  await receiveEvolutionWebhook(req, res);
  assert.strictEqual(res.statusCode, 401, 'Debe responder 401');
  assert.deepStrictEqual(res.body, { error: 'Unauthorized' });
});

// TEST B: POST /api/whatsapp/webhook con body que dice Meta, sin Evolution API key => rejected (401)
await runTest('TEST B: POST /api/whatsapp/webhook con body que dice Meta, sin Evolution API key => rejected (body NO elige provider)', async () => {
  const req = {
    headers: {},
    query: {},
    body: {
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba_123', changes: [] }]
    }
  };
  const res = createMockResponse();

  // Se envía a receiveEvolutionWebhook (la función de POST /webhook)
  await receiveEvolutionWebhook(req, res);
  assert.strictEqual(res.statusCode, 401, 'Debe responder 401 rechazando el bypass por body');

  // Comprobar también el alias de retrocompatibilidad
  const resAlias = createMockResponse();
  await receiveWebhook(req, resAlias);
  assert.strictEqual(resAlias.statusCode, 401, 'El alias receiveWebhook debe rechazar igualmente sin API key');
});

// TEST C: POST Meta sin X-Hub-Signature-256 => rejected => 0 DB mutations
await runTest('TEST C: POST Meta sin X-Hub-Signature-256 => rejected (401) sin mutaciones en DB', async () => {
  const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }), 'utf8');
  const req = {
    headers: {},
    rawBody,
    body: { object: 'whatsapp_business_account' }
  };
  const res = createMockResponse();
  let nextCalled = false;

  verifyMetaSignature(req, res, () => {
    nextCalled = true;
  });

  assert.strictEqual(nextCalled, false, 'next() NO debe ser llamado');
  assert.strictEqual(res.statusCode, 401, 'Debe responder 401 por falta de firma');
});

// TEST D: POST Meta con firma incorrecta => rejected => 0 DB mutations
await runTest('TEST D: POST Meta con firma incorrecta => rejected (401) sin mutaciones en DB', async () => {
  const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }), 'utf8');
  const req = {
    headers: {
      'x-hub-signature-256': 'sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    },
    rawBody,
    body: { object: 'whatsapp_business_account' }
  };
  const res = createMockResponse();
  let nextCalled = false;

  verifyMetaSignature(req, res, () => {
    nextCalled = true;
  });

  assert.strictEqual(nextCalled, false, 'next() NO debe ser llamado');
  assert.strictEqual(res.statusCode, 401, 'Debe responder 401 por firma incorrecta');
});

// TEST E: POST Meta con firma correcta, pero no existe cuenta Meta registrada => ignored/rejected safely => 0 Message mutations
await runTest('TEST E: POST Meta con firma correcta pero sin cuenta Meta en DB => safely ignored con 0 mutations', async () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba_unknown',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '123456789',
            phone_number_id: 'meta_unregistered_phone_id_999'
          },
          statuses: [{
            id: 'wamid.HBgTESTE123',
            status: 'delivered',
            recipient_id: '51999999999'
          }]
        }
      }]
    }]
  };
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = computeMetaSignature(rawBody, process.env.META_APP_SECRET);

  const req = {
    headers: { 'x-hub-signature-256': signature },
    rawBody,
    body: payload
  };
  const res = createMockResponse();
  let signatureVerified = false;

  verifyMetaSignature(req, res, () => {
    signatureVerified = true;
  });
  assert.strictEqual(signatureVerified, true, 'La firma válida debe pasar el middleware');

  // Backup original prisma methods
  const origFindNumber = prisma.registeredWhatsAppNumber.findFirst;
  const origFindMessage = prisma.message.findFirst;
  const origUpdateMessage = prisma.message.update;

  let messageMutated = false;
  let messageLookupCalled = false;

  prisma.registeredWhatsAppNumber.findFirst = async () => null; // No registered account
  prisma.message.findFirst = async () => {
    messageLookupCalled = true;
    return null;
  };
  prisma.message.update = async () => {
    messageMutated = true;
  };

  try {
    const webhookRes = createMockResponse();
    await receiveMetaWebhook(req, webhookRes);
    assert.strictEqual(webhookRes.statusCode, 200, 'Meta webhook responde 200 OK para evitar reintentos');

    // Wait microtask for internal processing
    await new Promise(r => setTimeout(r, 50));

    assert.strictEqual(messageLookupCalled, false, 'No debe intentar lookup de mensajes si no hay cuenta registrada');
    assert.strictEqual(messageMutated, false, '0 mutaciones de mensajes deben ocurrir');
  } finally {
    prisma.registeredWhatsAppNumber.findFirst = origFindNumber;
    prisma.message.findFirst = origFindMessage;
    prisma.message.update = origUpdateMessage;
  }
});

// TEST F: Meta account tenant A + statusId perteneciente a tenant B => no mutation
await runTest('TEST F: Meta account tenant A + statusId perteneciente a tenant B => no mutation', async () => {
  const tenantA = 'tenant_a_uuid';
  const tenantB = 'tenant_b_uuid';
  const phoneIdA = 'phone_id_meta_tenant_a';
  const messageIdB = 'wamid.HBgTESTF_TENANT_B';

  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba_a',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '123456789',
            phone_number_id: phoneIdA
          },
          statuses: [{
            id: messageIdB,
            status: 'read',
            recipient_id: '51999999999'
          }]
        }
      }]
    }]
  };

  const origFindNumber = prisma.registeredWhatsAppNumber.findFirst;
  const origFindMessage = prisma.message.findFirst;
  const origUpdateMessage = prisma.message.update;
  const origFindAttempt = prisma.followUpAttempt.findFirst;

  let messageUpdated = false;
  let queriedTenantId = null;

  prisma.registeredWhatsAppNumber.findFirst = async ({ where }) => {
    if (where.provider === 'META' && where.metaPhoneNumberId === phoneIdA) {
      return { id: 'num_a', tenantId: tenantA, provider: 'META', metaPhoneNumberId: phoneIdA };
    }
    return null;
  };

  prisma.followUpAttempt.findFirst = async () => null;

  prisma.message.findFirst = async ({ where }) => {
    queriedTenantId = where.tenantId;
    // Si la query busca en tenantA, el mensaje de tenantB no existe en tenantA
    if (where.externalId === messageIdB && where.tenantId === tenantB) {
      return { id: 'msg_b', externalId: messageIdB, tenantId: tenantB, status: 'sent' };
    }
    return null;
  };

  prisma.message.update = async () => {
    messageUpdated = true;
  };

  try {
    const req = { body: payload };
    const res = createMockResponse();
    await receiveMetaWebhook(req, res);

    await new Promise(r => setTimeout(r, 50));

    assert.strictEqual(queriedTenantId, tenantA, 'La búsqueda de mensaje debe estar scoped estrictamente a tenantA');
    assert.strictEqual(messageUpdated, false, 'El mensaje de tenantB NO debe ser mutado por callback de tenantA');
  } finally {
    prisma.registeredWhatsAppNumber.findFirst = origFindNumber;
    prisma.message.findFirst = origFindMessage;
    prisma.message.update = origUpdateMessage;
    prisma.followUpAttempt.findFirst = origFindAttempt;
  }
});

// TEST G: Meta account tenant A + externalId de mensaje Evolution tenant A => no mutation
await runTest('TEST G: Meta account tenant A + externalId de mensaje Evolution tenant A => no mutation', async () => {
  const tenantA = 'tenant_a_uuid';
  const phoneIdA = 'phone_id_meta_tenant_a';
  const evoExternalId = '3EB0D478A1234567890ABCDEF'; // Formato Baileys / Evolution

  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba_a',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '123456789',
            phone_number_id: phoneIdA
          },
          statuses: [{
            id: evoExternalId,
            status: 'delivered',
            recipient_id: '51999999999'
          }]
        }
      }]
    }]
  };

  const origFindNumber = prisma.registeredWhatsAppNumber.findFirst;
  const origFindMessage = prisma.message.findFirst;
  const origUpdateMessage = prisma.message.update;
  const origFindAttempt = prisma.followUpAttempt.findFirst;

  let messageUpdated = false;
  let messageFindCalled = false;

  prisma.registeredWhatsAppNumber.findFirst = async () => ({
    id: 'num_a',
    tenantId: tenantA,
    provider: 'META',
    metaPhoneNumberId: phoneIdA
  });

  prisma.followUpAttempt.findFirst = async () => null;

  prisma.message.findFirst = async () => {
    messageFindCalled = true;
    return { id: 'msg_evo', externalId: evoExternalId, tenantId: tenantA, status: 'sent' };
  };

  prisma.message.update = async () => {
    messageUpdated = true;
  };

  try {
    const req = { body: payload };
    const res = createMockResponse();
    await receiveMetaWebhook(req, res);

    await new Promise(r => setTimeout(r, 50));

    assert.strictEqual(messageFindCalled, false, 'No debe buscar el mensaje si no cumple con prefijo canónico wamid de Meta');
    assert.strictEqual(messageUpdated, false, 'El mensaje de Evolution NO debe ser mutado por callback de Meta');
  } finally {
    prisma.registeredWhatsAppNumber.findFirst = origFindNumber;
    prisma.message.findFirst = origFindMessage;
    prisma.message.update = origUpdateMessage;
    prisma.followUpAttempt.findFirst = origFindAttempt;
  }
});

// TEST H: Meta account tenant A + statusId de mensaje Meta tenant A => status update permitido
await runTest('TEST H: Meta account tenant A + statusId de mensaje Meta tenant A => status update permitido', async () => {
  const tenantA = 'tenant_a_uuid';
  const phoneIdA = 'phone_id_meta_tenant_a';
  const metaExternalId = 'wamid.HBgTESTH_META_SUCCESS_123';
  const recipient = '51987654321';

  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba_a',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '123456789',
            phone_number_id: phoneIdA
          },
          statuses: [{
            id: metaExternalId,
            status: 'delivered',
            recipient_id: recipient
          }]
        }
      }]
    }]
  };

  const origFindNumber = prisma.registeredWhatsAppNumber.findFirst;
  const origFindMessage = prisma.message.findFirst;
  const origUpdateMessage = prisma.message.update;
  const origFindAttempt = prisma.followUpAttempt.findFirst;

  let updatedData = null;

  prisma.registeredWhatsAppNumber.findFirst = async () => ({
    id: 'num_a',
    tenantId: tenantA,
    provider: 'META',
    metaPhoneNumberId: phoneIdA
  });

  prisma.followUpAttempt.findFirst = async () => null;

  prisma.message.findFirst = async ({ where }) => {
    if (where.externalId === metaExternalId && where.tenantId === tenantA) {
      return {
        id: 'msg_meta_valid',
        externalId: metaExternalId,
        tenantId: tenantA,
        status: 'sent',
        chatId: 'chat_123',
        chat: {
          tenantId: tenantA,
          contact: { phone: recipient }
        }
      };
    }
    return null;
  };

  prisma.message.update = async ({ where, data }) => {
    updatedData = { where, data };
    return { id: where.id, ...data };
  };

  try {
    const req = { body: payload };
    const res = createMockResponse();
    await receiveMetaWebhook(req, res);

    await new Promise(r => setTimeout(r, 50));

    assert.ok(updatedData, 'Message.update debe haber sido llamado');
    assert.strictEqual(updatedData.where.id, 'msg_meta_valid');
    assert.strictEqual(updatedData.data.status, 'delivered', 'Estado debe cambiar a delivered');
  } finally {
    prisma.registeredWhatsAppNumber.findFirst = origFindNumber;
    prisma.message.findFirst = origFindMessage;
    prisma.message.update = origUpdateMessage;
    prisma.followUpAttempt.findFirst = origFindAttempt;
  }
});

// TEST I: GET Meta handshake válido => continúa funcionando
await runTest('TEST I: GET Meta handshake válido => continúa funcionando', async () => {
  const req = {
    query: {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'test_meta_verify_token_xyz',
      'hub.challenge': 'CHALLENGE_ACCEPTED_98765'
    }
  };
  const res = createMockResponse();

  receiveMetaVerification(req, res);
  assert.strictEqual(res.statusCode, 200, 'Debe responder 200');
  assert.strictEqual(res.body, 'CHALLENGE_ACCEPTED_98765', 'Debe retornar el challenge exacto');
});

// TEST J: GET handshake inválido => rejected
await runTest('TEST J: GET handshake inválido => rejected (403)', async () => {
  const req = {
    query: {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'WRONG_TOKEN',
      'hub.challenge': 'CHALLENGE_123'
    }
  };
  const res = createMockResponse();

  receiveMetaVerification(req, res);
  assert.strictEqual(res.statusCode, 403, 'Debe responder 403 Forbidden');
  assert.deepStrictEqual(res.body, { error: 'Forbidden' });
});

// TEST K: Evolution webhook válido => comportamiento existente intacto
await runTest('TEST K: Evolution webhook válido con API key => comportamiento existente intacto', async () => {
  const origFindNumber = prisma.registeredWhatsAppNumber.findFirst;
  const origFindUnique = prisma.registeredWhatsAppNumber.findUnique;
  prisma.registeredWhatsAppNumber.findFirst = async () => null;
  prisma.registeredWhatsAppNumber.findUnique = async () => null;

  try {
    const req = {
      headers: {
        apikey: 'test_evo_secret_key_123'
      },
      query: {},
      body: {
        event: 'messages.upsert',
        instance: 'bot_prod_tenant123',
        data: {
          key: { id: '3EB0D478A123', fromMe: false, remoteJid: '51999999999@s.whatsapp.net' },
          message: { conversation: 'Hola bot' }
        }
      }
    };
    const res = createMockResponse();

    await receiveEvolutionWebhook(req, res);
    assert.strictEqual(res.statusCode, 200, 'Debe responder 200 OK y aceptar el evento');

    // Permitir que la cola procese el evento antes de restaurar los mocks
    await new Promise(r => setTimeout(r, 60));
  } finally {
    prisma.registeredWhatsAppNumber.findFirst = origFindNumber;
    prisma.registeredWhatsAppNumber.findUnique = origFindUnique;
  }
});

// TEST L: rawBody utilizado exactamente para HMAC; JSON parse/restringify no se usa para calcular firma
await runTest('TEST L: rawBody utilizado exactamente para HMAC; alteración de espacios en rawBody invalida firma', async () => {
  // Payload JSON con espacios específicos
  const rawBodyOriginal = Buffer.from('{"object": "whatsapp_business_account"  ,  "entry": []}', 'utf8');
  const signature = computeMetaSignature(rawBodyOriginal, process.env.META_APP_SECRET);

  // 1. Con el rawBody exacto: debe pasar
  const reqValid = {
    headers: { 'x-hub-signature-256': signature },
    rawBody: rawBodyOriginal,
    body: JSON.parse(rawBodyOriginal.toString())
  };
  const resValid = createMockResponse();
  let nextCalledValid = false;
  verifyMetaSignature(reqValid, resValid, () => {
    nextCalledValid = true;
  });
  assert.strictEqual(nextCalledValid, true, 'Firma con rawBody exacto debe ser válida');

  // 2. Si alguien usara JSON.stringify(req.body) para calcular la firma,
  // los espacios se normalizarían y la firma calculada no coincidiría con el rawBody original.
  const rawBodyReserialized = Buffer.from(JSON.stringify(reqValid.body), 'utf8');
  // Confirmar que los buffers difieren en whitespace
  assert.notStrictEqual(rawBodyOriginal.toString(), rawBodyReserialized.toString(), 'Los buffers difieren en whitespace');

  // Probar qué pasa si el servidor recibiera la firma calculada sobre el JSON reserializado pero el rawBody fue el original:
  const mismatchSignature = computeMetaSignature(rawBodyReserialized, process.env.META_APP_SECRET);
  const reqTampered = {
    headers: { 'x-hub-signature-256': mismatchSignature },
    rawBody: rawBodyOriginal,
    body: reqValid.body
  };
  const resTampered = createMockResponse();
  let nextCalledTampered = false;
  verifyMetaSignature(reqTampered, resTampered, () => {
    nextCalledTampered = true;
  });
  assert.strictEqual(nextCalledTampered, false, 'Firma calculada sobre JSON reserializado DEBE ser rechazada');
  assert.strictEqual(resTampered.statusCode, 401, 'Debe retornar 401');
});

console.log('\n======================================================================');
console.log(`🎉 SUITE DE SEGURIDAD META WEBHOOK: ${passedTests}/${totalTests} TESTS PASS`);
console.log('======================================================================');
