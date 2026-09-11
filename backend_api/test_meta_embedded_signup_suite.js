/**
 * TEST SUITE: Meta Embedded Signup v4 + WhatsApp Business App Coexistence
 * Pruebas determinísticas META-01 a META-22.
 *
 * Ejecutar con: node backend_api/test_meta_embedded_signup_suite.js
 */

import assert from 'assert';
import axios from 'axios';
import prisma from './src/db.js';
import {
  getMetaOnboardingConfig,
  handleMetaOnboardingCallback,
  handleMetaLegacyConnect,
  getMetaGraphVersion,
} from './src/controllers/metaOnboardingController.js';
import { getStatus, getProvider, logoutDevice } from './src/controllers/connectionController.js';
import { encryptText, decryptText } from './src/utils/cryptoUtils.js';
import { resolveGatewayCtx } from './src/services/whatsappGateway.js';

// Helper mock para simular req / res de Express
function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
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
    },
    sendStatus(code) {
      this.statusCode = code;
      return this;
    }
  };
  return res;
}

// Variables originales para restaurar al finalizar
const originalEnv = { ...process.env };
const originalAxiosGet = axios.get;
const originalAxiosPost = axios.post;
const originalAxiosDelete = axios.delete;

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    if (err.stack) console.error(err.stack);
    throw err;
  }
}

async function cleanup() {
  process.env = { ...originalEnv };
  axios.get = originalAxiosGet;
  axios.post = originalAxiosPost;
  axios.delete = originalAxiosDelete;
}

console.log('\n======================================================');
console.log('🚀 INICIANDO TEST SUITE: META EMBEDDED SIGNUP (META-01 a META-22)');
console.log('======================================================\n');

try {
  // META-01: Config completa
  await runTest('META-01: Config completa devuelve 200 con appId y configId sin secretos', async () => {
    process.env.META_APP_ID = 'app_123456';
    process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = 'config_789';
    process.env.META_GRAPH_API_VERSION = 'v21.0';

    const req = {};
    const res = createMockRes();

    await getMetaOnboardingConfig(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.configured, true);
    assert.strictEqual(res.body.appId, 'app_123456');
    assert.strictEqual(res.body.configId, 'config_789');
    assert.strictEqual(res.body.graphApiVersion, 'v21.0');
    assert.strictEqual(res.body.appSecret, undefined, 'App Secret NUNCA debe viajar en config');
  });

  // META-02: Config incompleta
  await runTest('META-02: Config incompleta retorna 503 META_NOT_CONFIGURED', async () => {
    delete process.env.META_APP_ID;
    delete process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;

    const req = {};
    const res = createMockRes();

    await getMetaOnboardingConfig(req, res);

    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.body.configured, false);
    assert.strictEqual(res.body.code, 'META_NOT_CONFIGURED');
  });

  // META-03 & META-10 & META-11: Code exchange server-side con subscribed_apps y token cifrado
  await runTest('META-03 & META-10 & META-11: Code exchange server-side, subscribed_apps exitoso y token cifrado no expuesto', async () => {
    process.env.META_APP_ID = 'app_test_id';
    process.env.META_APP_SECRET = 'secret_test_key';
    process.env.JWT_SECRET = 'jwt_test_secret_32_characters_long!';

    let subscribedAppsCalled = false;
    let exchangedCode = null;

    axios.get = async (url, opts) => {
      if (url.includes('/oauth/access_token')) {
        exchangedCode = opts.params.code;
        return { data: { access_token: 'EAAB_test_token_secret_123' } };
      }
      if (url.includes('/phone_numbers')) {
        return {
          data: {
            data: [
              { id: 'phone_id_999', display_phone_number: '+51 987 654 321', platform_type: 'CLOUD_API' }
            ]
          }
        };
      }
      return { data: {} };
    };

    axios.post = async (url) => {
      if (url.includes('/subscribed_apps')) {
        subscribedAppsCalled = true;
        return { data: { success: true } };
      }
      return { data: {} };
    };

    const testTenantId = 'tenant_meta_test_01';
    // Mock prisma
    const originalFindFirst = prisma.registeredWhatsAppNumber.findFirst;
    const originalCreate = prisma.registeredWhatsAppNumber.create;
    const originalUpdate = prisma.registeredWhatsAppNumber.update;

    let persistedData = null;
    prisma.registeredWhatsAppNumber.findFirst = async () => null;
    prisma.registeredWhatsAppNumber.create = async ({ data }) => {
      persistedData = data;
      return { id: 'reg_1', ...data };
    };

    try {
      const req = {
        user: { tenantId: testTenantId },
        body: { code: 'code_meta_valid_123', wabaId: 'waba_id_555' }
      };
      const res = createMockRes();

      await handleMetaOnboardingCallback(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.provider, 'META');
      assert.strictEqual(res.body.phoneNumber, '51987654321');
      assert.strictEqual(res.body.metaPhoneNumberId, 'phone_id_999');
      assert.strictEqual(res.body.connectionState, 'CONNECTED');
      // Token NUNCA expuesto en res.body
      assert.strictEqual(res.body.metaAccessToken, undefined);
      assert.strictEqual(res.body.accessToken, undefined);

      // Verificación de llamadas
      assert.strictEqual(exchangedCode, 'code_meta_valid_123');
      assert.strictEqual(subscribedAppsCalled, true, 'subscribed_apps debió ser invocado');

      // Verificación de almacenamiento cifrado
      assert.ok(persistedData.metaAccessToken.includes(':'), 'Token debe estar cifrado en formato iv:authTag:cipher');
      assert.strictEqual(decryptText(persistedData.metaAccessToken), 'EAAB_test_token_secret_123');
      assert.strictEqual(persistedData.connectionState, 'CONNECTED');
      assert.strictEqual(persistedData.instanceName, null);
    } finally {
      prisma.registeredWhatsAppNumber.findFirst = originalFindFirst;
      prisma.registeredWhatsAppNumber.create = originalCreate;
      prisma.registeredWhatsAppNumber.update = originalUpdate;
    }
  });

  // META-04: Tenant isolation
  await runTest('META-04: Aislamiento estricto por req.user.tenantId', async () => {
    process.env.META_APP_ID = 'app_1';
    process.env.META_APP_SECRET = 'sec_1';

    const reqWithoutTenant = { user: {}, body: { code: 'some_code' } };
    const res = createMockRes();

    await handleMetaOnboardingCallback(reqWithoutTenant, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.error, 'Usuario no asociado a ningún Tenant.');
  });

  // META-05: Invalid code
  await runTest('META-05: Código de autorización inválido devuelve 502 META_CODE_EXCHANGE_FAILED', async () => {
    process.env.META_APP_ID = 'app_1';
    process.env.META_APP_SECRET = 'sec_1';

    axios.get = async () => {
      const err = new Error('Invalid OAuth Code');
      err.response = { status: 400, data: { error: { message: 'Code has expired or is invalid.' } } };
      throw err;
    };

    const req = { user: { tenantId: 't1' }, body: { code: 'invalid_code' } };
    const res = createMockRes();

    await handleMetaOnboardingCallback(req, res);
    assert.strictEqual(res.statusCode, 502);
    assert.strictEqual(res.body.code, 'META_CODE_EXCHANGE_FAILED');
  });

  // META-06: WABA not found
  await runTest('META-06: WABA no encontrada en payload ni en debug_token devuelve 422 META_WABA_NOT_FOUND', async () => {
    process.env.META_APP_ID = 'app_1';
    process.env.META_APP_SECRET = 'sec_1';

    axios.get = async (url) => {
      if (url.includes('/oauth/access_token')) {
        return { data: { access_token: 'EAAB_token' } };
      }
      if (url.includes('/debug_token')) {
        return { data: { data: { granular_scopes: [] } } }; // Sin scope WABA
      }
      return { data: {} };
    };

    const req = { user: { tenantId: 't1' }, body: { code: 'valid_code' } };
    const res = createMockRes();

    await handleMetaOnboardingCallback(req, res);
    assert.strictEqual(res.statusCode, 422);
    assert.strictEqual(res.body.code, 'META_WABA_NOT_FOUND');
  });

  // META-07: Invalid / Empty Phone numbers in WABA
  await runTest('META-07: WABA sin números de teléfono registrados devuelve 422 META_NO_PHONES_IN_WABA', async () => {
    process.env.META_APP_ID = 'app_1';
    process.env.META_APP_SECRET = 'sec_1';

    axios.get = async (url) => {
      if (url.includes('/oauth/access_token')) return { data: { access_token: 'EAAB_token' } };
      if (url.includes('/phone_numbers')) return { data: { data: [] } };
      return { data: {} };
    };

    const req = { user: { tenantId: 't1' }, body: { code: 'valid_code', wabaId: 'waba_empty' } };
    const res = createMockRes();

    await handleMetaOnboardingCallback(req, res);
    assert.strictEqual(res.statusCode, 422);
    assert.strictEqual(res.body.code, 'META_NO_PHONES_IN_WABA');
  });

  // META-08: Manual credentials invalid
  await runTest('META-08: Conexión manual con credenciales inválidas rechazada con 422', async () => {
    axios.get = async (url) => {
      if (url.includes('/phone_number_bad')) {
        const err = new Error('Graph Error');
        err.response = { status: 400, data: { error: { message: 'Invalid phone number id' } } };
        throw err;
      }
      return { data: {} };
    };

    const req = {
      user: { tenantId: 't1' },
      body: {
        metaPhoneNumberId: 'phone_number_bad',
        metaWabaId: 'waba_1',
        metaAccessToken: 'bad_token',
        phoneNumber: '+51987654321'
      }
    };
    const res = createMockRes();

    await handleMetaLegacyConnect(req, res);
    assert.strictEqual(res.statusCode, 422);
    assert.strictEqual(res.body.code, 'META_INVALID_PHONE_ID_OR_TOKEN');
  });

  // META-09: Manual credentials valid
  await runTest('META-09: Conexión manual con credenciales válidas suscribe y persiste CONNECTED', async () => {
    let subCalled = false;
    axios.get = async (url) => {
      if (url.includes('/phone_numbers')) {
        return { data: { data: [{ id: 'p_valid' }] } };
      }
      if (url.includes('/p_valid')) {
        return { data: { id: 'p_valid', display_phone_number: '+51 999 888 777' } };
      }
      if (url.includes('/w_valid')) {
        return { data: { id: 'w_valid', name: 'Mi Negocio' } };
      }
      return { data: {} };
    };
    axios.post = async (url) => {
      if (url.includes('/subscribed_apps')) {
        subCalled = true;
        return { data: { success: true } };
      }
      return { data: {} };
    };

    const originalFindFirst = prisma.registeredWhatsAppNumber.findFirst;
    const originalCreate = prisma.registeredWhatsAppNumber.create;
    let saved = null;
    prisma.registeredWhatsAppNumber.findFirst = async () => null;
    prisma.registeredWhatsAppNumber.create = async ({ data }) => {
      saved = data;
      return { id: 'reg_man', ...data };
    };

    try {
      const req = {
        user: { tenantId: 't1' },
        body: {
          metaPhoneNumberId: 'p_valid',
          metaWabaId: 'w_valid',
          metaAccessToken: 'valid_manual_token',
          phoneNumber: '+51999888777'
        }
      };
      const res = createMockRes();

      await handleMetaLegacyConnect(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.onboardingMethod, 'MANUAL_ADVANCED');
      assert.strictEqual(subCalled, true);
      assert.strictEqual(saved.connectionState, 'CONNECTED');
      assert.strictEqual(decryptText(saved.metaAccessToken), 'valid_manual_token');
    } finally {
      prisma.registeredWhatsAppNumber.findFirst = originalFindFirst;
      prisma.registeredWhatsAppNumber.create = originalCreate;
    }
  });

  // META-12: Meta inbound routing
  await runTest('META-12: Meta inbound routing resuelve tenant correctamente', async () => {
    const originalFindFirst = prisma.registeredWhatsAppNumber.findFirst;
    prisma.registeredWhatsAppNumber.findFirst = async ({ where }) => {
      if (where.provider === 'META' && where.metaPhoneNumberId === 'phone_100') {
        return {
          id: 'reg_100',
          phoneNumber: '51987654321',
          tenantId: 'tenant_meta_100',
          tenant: { id: 'tenant_meta_100', name: 'Tienda Oficial' }
        };
      }
      return null;
    };

    try {
      const found = await prisma.registeredWhatsAppNumber.findFirst({
        where: { provider: 'META', metaPhoneNumberId: 'phone_100' },
        include: { tenant: true }
      });
      assert.ok(found);
      assert.strictEqual(found.tenant.id, 'tenant_meta_100');
    } finally {
      prisma.registeredWhatsAppNumber.findFirst = originalFindFirst;
    }
  });

  // META-13: Evolution no afectado
  await runTest('META-13: Conexión de Meta no altera ni destruye instancias Evolution', async () => {
    let evoDeleteCalled = false;
    axios.delete = async (url) => {
      if (url.includes('/instance/delete')) evoDeleteCalled = true;
      return { data: {} };
    };

    const originalDeleteMany = prisma.registeredWhatsAppNumber.deleteMany;
    prisma.registeredWhatsAppNumber.deleteMany = async () => ({ count: 1 });

    const originalFindFirst = prisma.registeredWhatsAppNumber.findFirst;
    prisma.registeredWhatsAppNumber.findFirst = async () => ({
      id: 'reg_meta_only',
      provider: 'META',
      instanceName: null,
      metaWabaId: 'waba_1',
      metaAccessToken: 'tok'
    });

    try {
      const req = { user: { tenantId: 't1' }, body: { provider: 'META' } };
      const res = createMockRes();

      await logoutDevice(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.status, 'DISCONNECTED');
      assert.strictEqual(evoDeleteCalled, false, 'Logout de META jamás debe llamar a Evolution delete');
    } finally {
      prisma.registeredWhatsAppNumber.deleteMany = originalDeleteMany;
      prisma.registeredWhatsAppNumber.findFirst = originalFindFirst;
    }
  });

  // META-14: Disconnect tenant-scoped
  await runTest('META-14: Desconexión de Meta respeta tenantId del usuario', async () => {
    let deletedWhere = null;
    const originalDeleteMany = prisma.registeredWhatsAppNumber.deleteMany;
    const originalFindFirst = prisma.registeredWhatsAppNumber.findFirst;

    prisma.registeredWhatsAppNumber.findFirst = async () => ({ id: 'conn_77', provider: 'META', tenantId: 'tenant_scoped' });
    prisma.registeredWhatsAppNumber.deleteMany = async ({ where }) => {
      deletedWhere = where;
      return { count: 1 };
    };

    try {
      const req = { user: { tenantId: 'tenant_scoped' }, body: { connectionId: 'conn_77', provider: 'META' } };
      const res = createMockRes();

      await logoutDevice(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(deletedWhere.tenantId, 'tenant_scoped');
      assert.strictEqual(deletedWhere.id, 'conn_77');
    } finally {
      prisma.registeredWhatsAppNumber.deleteMany = originalDeleteMany;
      prisma.registeredWhatsAppNumber.findFirst = originalFindFirst;
    }
  });

  // META-15: Reconnect
  await runTest('META-15: Reconexión tras desconexión actualiza registro a CONNECTED', async () => {
    process.env.META_APP_ID = 'app_1';
    process.env.META_APP_SECRET = 'sec_1';

    axios.get = async (url) => {
      if (url.includes('/oauth/access_token')) return { data: { access_token: 'new_token_123' } };
      if (url.includes('/phone_numbers')) return { data: { data: [{ id: 'p1', display_phone_number: '51987654321' }] } };
      return { data: {} };
    };
    axios.post = async () => ({ data: { success: true } });

    const originalFindFirst = prisma.registeredWhatsAppNumber.findFirst;
    const originalUpdate = prisma.registeredWhatsAppNumber.update;

    let updatedData = null;
    prisma.registeredWhatsAppNumber.findFirst = async () => ({ id: 'existing_reg', provider: 'META', connectionState: 'DISCONNECTED' });
    prisma.registeredWhatsAppNumber.update = async ({ data }) => {
      updatedData = data;
      return { id: 'existing_reg', ...data };
    };

    try {
      const req = { user: { tenantId: 't1' }, body: { code: 'reconnect_code', wabaId: 'w1' } };
      const res = createMockRes();

      await handleMetaOnboardingCallback(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(updatedData.connectionState, 'CONNECTED');
      assert.strictEqual(res.body.connectionState, 'CONNECTED');
    } finally {
      prisma.registeredWhatsAppNumber.findFirst = originalFindFirst;
      prisma.registeredWhatsAppNumber.update = originalUpdate;
    }
  });

  // META-16: Coexistence completion payload
  await runTest('META-16: Payload de Coexistence detecta plataforma y reporta isCoexistence', async () => {
    process.env.META_APP_ID = 'app_1';
    process.env.META_APP_SECRET = 'sec_1';

    axios.get = async (url) => {
      if (url.includes('/oauth/access_token')) return { data: { access_token: 'token_coex' } };
      if (url.includes('/phone_numbers')) {
        return {
          data: {
            data: [
              { id: 'phone_coex', display_phone_number: '+51 987 654 321', platform_type: 'CLOUD_API' }
            ]
          }
        };
      }
      return { data: {} };
    };
    axios.post = async () => ({ data: { success: true } });

    const originalFindFirst = prisma.registeredWhatsAppNumber.findFirst;
    const originalCreate = prisma.registeredWhatsAppNumber.create;
    prisma.registeredWhatsAppNumber.findFirst = async () => null;
    prisma.registeredWhatsAppNumber.create = async ({ data }) => ({ id: 'reg_coex', ...data });

    try {
      const req = { user: { tenantId: 't1' }, body: { code: 'coex_code', wabaId: 'w_coex', phoneNumberId: 'phone_coex' } };
      const res = createMockRes();

      await handleMetaOnboardingCallback(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.isCoexistence, true);
    } finally {
      prisma.registeredWhatsAppNumber.findFirst = originalFindFirst;
      prisma.registeredWhatsAppNumber.create = originalCreate;
    }
  });

  // META-17: Normal Cloud API completion payload
  await runTest('META-17: Normal Cloud API completion payload completa exitosamente', async () => {
    process.env.META_APP_ID = 'app_1';
    process.env.META_APP_SECRET = 'sec_1';

    axios.get = async (url) => {
      if (url.includes('/oauth/access_token')) return { data: { access_token: 'token_std' } };
      if (url.includes('/phone_numbers')) {
        return {
          data: {
            data: [
              { id: 'phone_std', display_phone_number: '+51 900 111 222' }
            ]
          }
        };
      }
      return { data: {} };
    };
    axios.post = async () => ({ data: { success: true } });

    const originalFindFirst = prisma.registeredWhatsAppNumber.findFirst;
    const originalCreate = prisma.registeredWhatsAppNumber.create;
    prisma.registeredWhatsAppNumber.findFirst = async () => null;
    prisma.registeredWhatsAppNumber.create = async ({ data }) => ({ id: 'reg_std', ...data });

    try {
      const req = { user: { tenantId: 't1' }, body: { code: 'std_code', wabaId: 'w_std' } };
      const res = createMockRes();

      await handleMetaOnboardingCallback(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.phoneNumber, '51900111222');
      assert.strictEqual(res.body.onboardingMethod, 'EMBEDDED_SIGNUP');
    } finally {
      prisma.registeredWhatsAppNumber.findFirst = originalFindFirst;
      prisma.registeredWhatsAppNumber.create = originalCreate;
    }
  });

  // META-18: Token cifrado puede ser leído correctamente por whatsappGateway
  await runTest('META-18: Token cifrado con AES-256-GCM es descifrado correctamente por resolveGatewayCtx', async () => {
    const rawToken = 'EAAB_real_meta_cloud_token_secret_xyz';
    const encryptedToken = encryptText(rawToken);

    const originalFindFirst = prisma.registeredWhatsAppNumber.findFirst;
    prisma.registeredWhatsAppNumber.findFirst = async () => ({
      provider: 'META',
      metaPhoneNumberId: 'p_123',
      metaAccessToken: encryptedToken
    });

    try {
      const ctx = await resolveGatewayCtx('tenant_enc_test');
      assert.strictEqual(ctx.provider, 'META');
      assert.strictEqual(ctx.metaPhoneNumberId, 'p_123');
      assert.strictEqual(ctx.metaAccessToken, rawToken, 'El Gateway debe recibir el token en texto claro ya descifrado');
    } finally {
      prisma.registeredWhatsAppNumber.findFirst = originalFindFirst;
    }
  });

  // META-19: Token legacy plaintext sigue funcionando durante migración
  await runTest('META-19: Token legacy plaintext sin cifrar es retornado como tal por resolveGatewayCtx', async () => {
    const legacyPlainToken = 'EAAB_legacy_plaintext_token_without_colons';

    const originalFindFirst = prisma.registeredWhatsAppNumber.findFirst;
    prisma.registeredWhatsAppNumber.findFirst = async () => ({
      provider: 'META',
      metaPhoneNumberId: 'p_legacy',
      metaAccessToken: legacyPlainToken
    });

    try {
      const ctx = await resolveGatewayCtx('tenant_legacy_test');
      assert.strictEqual(ctx.provider, 'META');
      assert.strictEqual(ctx.metaAccessToken, legacyPlainToken, 'Token legacy en texto claro debe conservarse sin error');
    } finally {
      prisma.registeredWhatsAppNumber.findFirst = originalFindFirst;
    }
  });

  // META-20: Provider META jamás consulta endpoints Evolution para status/logout
  await runTest('META-20: Provider META jamás consulta Evolution API para getStatus', async () => {
    let evoGetCalled = false;
    axios.get = async (url) => {
      if (url.includes('/instance/connectionState')) {
        evoGetCalled = true;
      }
      return { data: {} };
    };

    const originalFindFirst = prisma.registeredWhatsAppNumber.findFirst;
    prisma.registeredWhatsAppNumber.findFirst = async () => ({
      id: 'reg_meta',
      provider: 'META',
      phoneNumber: '51987654321',
      metaPhoneNumberId: 'phone_meta_20',
      metaWabaId: 'waba_20',
      connectionState: 'CONNECTED'
    });

    try {
      const req = { user: { tenantId: 't1' }, query: {} };
      const res = createMockRes();

      await getStatus(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.status, 'open');
      assert.strictEqual(res.body.provider, 'META');
      assert.strictEqual(res.body.connectionState, 'CONNECTED');
      assert.strictEqual(evoGetCalled, false, 'getStatus jamás debe llamar a Evolution para provider META');
    } finally {
      prisma.registeredWhatsAppNumber.findFirst = originalFindFirst;
    }
  });

  // META-21: Phone Number ID válido pero perteneciente a otro WABA -> REJECT
  await runTest('META-21: Phone Number ID perteneciente a otro WABA es rechazado con 422 META_PHONE_NOT_IN_WABA', async () => {
    process.env.META_APP_ID = 'app_1';
    process.env.META_APP_SECRET = 'sec_1';

    axios.get = async (url) => {
      if (url.includes('/oauth/access_token')) return { data: { access_token: 'tok' } };
      if (url.includes('/phone_numbers')) {
        // La WABA solo tiene phone_alpha, pero el usuario envió phone_bravo
        return { data: { data: [{ id: 'phone_alpha', display_phone_number: '51999999999' }] } };
      }
      return { data: {} };
    };

    const req = {
      user: { tenantId: 't1' },
      body: { code: 'valid_code', wabaId: 'waba_1', phoneNumberId: 'phone_bravo' }
    };
    const res = createMockRes();

    await handleMetaOnboardingCallback(req, res);
    assert.strictEqual(res.statusCode, 422);
    assert.strictEqual(res.body.code, 'META_PHONE_NOT_IN_WABA');
  });

  // META-22: subscribed_apps falla -> onboarding NO queda CONNECTED
  await runTest('META-22: Fallo en subscribed_apps impide que el onboarding quede CONNECTED (Fail-Closed)', async () => {
    process.env.META_APP_ID = 'app_1';
    process.env.META_APP_SECRET = 'sec_1';

    axios.get = async (url) => {
      if (url.includes('/oauth/access_token')) return { data: { access_token: 'tok' } };
      if (url.includes('/phone_numbers')) return { data: { data: [{ id: 'p1', display_phone_number: '51987654321' }] } };
      return { data: {} };
    };

    axios.post = async (url) => {
      if (url.includes('/subscribed_apps')) {
        const err = new Error('Subscribed Apps Rejected');
        err.response = { status: 400, data: { error: { message: 'Permissions missing to subscribe' } } };
        throw err;
      }
      return { data: {} };
    };

    let dbSaved = false;
    const originalCreate = prisma.registeredWhatsAppNumber.create;
    prisma.registeredWhatsAppNumber.create = async () => {
      dbSaved = true;
      return {};
    };

    try {
      const req = { user: { tenantId: 't1' }, body: { code: 'code_fail_sub', wabaId: 'w1' } };
      const res = createMockRes();

      await handleMetaOnboardingCallback(req, res);
      assert.strictEqual(res.statusCode, 502);
      assert.strictEqual(res.body.code, 'META_SUBSCRIBE_FAILED');
      assert.strictEqual(dbSaved, false, 'No debió persistirse en BD si subscribed_apps falló');
    } finally {
      prisma.registeredWhatsAppNumber.create = originalCreate;
    }
  });

} finally {
  await cleanup();
}

console.log('\n======================================================');
console.log(`🏁 RESULTADO FINAL: ${passedTests}/${totalTests} TESTS PASADOS`);
console.log('======================================================\n');
if (passedTests !== totalTests) {
  process.exit(1);
}
