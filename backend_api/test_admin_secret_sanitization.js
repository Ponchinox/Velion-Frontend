/**
 * TEST: ADMIN SECRET SANITIZATION & LEAK PREVENTION SUITE
 * =======================================================
 * Verifica exhaustivamente que:
 * 1. GET /api/admin/settings (getGlobalConfig) NUNCA retorne valores reales de secretos globales.
 * 2. saveGlobalConfig NO permita a la UI escribir ni persistir API keys globales en SystemConfig.
 * 3. Placeholders enmascarados ("••••••••") sean descartados y no sobrescriban la configuración.
 * 4. La respuesta de getGlobalConfig contenga metadata segura (configured: boolean, masked: string).
 * 5. Cero filtración de secretos reales en respuestas JSON.
 */

import { getGlobalConfig, saveGlobalConfig } from './src/controllers/adminController.js';
import prisma from './src/db.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`✅ PASS: ${message}`);
}

async function runSuite() {
  console.log('======================================================================');
  console.log('🛡️ VELION SECURITY AUDIT: ADMIN SECRET SANITIZATION');
  console.log('======================================================================\n');

  // Guardar estado original de process.env
  const originalEnv = { ...process.env };

  try {
    // Inyectar secretos mock deliberados en el entorno para probar si se fugan
    const CANARY_GEMINI_KEY = 'TEST_CANARY_GEMINI_SECRET_KEY_99999';
    const CANARY_GROQ_KEY = 'TEST_CANARY_GROQ_SECRET_KEY_88888';
    const CANARY_EVO_KEY = 'TEST_CANARY_EVOLUTION_SECRET_KEY_77777';
    const CANARY_SMTP_PASS = 'TEST_CANARY_SMTP_PASSWORD_66666';
    const CANARY_SHOPIFY_SECRET = 'TEST_CANARY_SHOPIFY_CLIENT_SECRET_55555';
    const CANARY_META_SECRET = 'TEST_CANARY_META_APP_SECRET_44444';
    const CANARY_STRIPE_SECRET = 'TEST_CANARY_STRIPE_SECRET_KEY_33333';

    process.env.GEMINI_API_KEY = CANARY_GEMINI_KEY;
    process.env.GROQ_API_KEY = CANARY_GROQ_KEY;
    process.env.EVOLUTION_API_KEY = CANARY_EVO_KEY;
    process.env.SMTP_PASSWORD = CANARY_SMTP_PASS;
    process.env.SHOPIFY_CLIENT_SECRET = CANARY_SHOPIFY_SECRET;
    process.env.META_APP_SECRET = CANARY_META_SECRET;
    process.env.STRIPE_SECRET_KEY = CANARY_STRIPE_SECRET;

    // -------------------------------------------------------------------------
    // TEST 1: getGlobalConfig no devuelve secretos en crudo
    // -------------------------------------------------------------------------
    console.log('--- Test 1: getGlobalConfig Secret Leak Audit ---');

    let responseData = null;
    let responseStatus = 200;

    const mockReq = { user: { role: 'superadmin' } };
    const mockRes = {
      status(code) {
        responseStatus = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      }
    };

    await getGlobalConfig(mockReq, mockRes);

    assert(responseStatus === 200, 'getGlobalConfig debe responder HTTP 200');
    assert(responseData !== null, 'getGlobalConfig debe devolver un payload JSON');

    const jsonString = JSON.stringify(responseData);

    // Comprobar que ningún secreto canario aparece en la respuesta serializada
    assert(!jsonString.includes(CANARY_GEMINI_KEY), 'GEMINI_API_KEY no debe aparecer en la respuesta de getGlobalConfig');
    assert(!jsonString.includes(CANARY_GROQ_KEY), 'GROQ_API_KEY no debe aparecer en la respuesta de getGlobalConfig');
    assert(!jsonString.includes(CANARY_EVO_KEY), 'EVOLUTION_API_KEY no debe aparecer en la respuesta de getGlobalConfig');
    assert(!jsonString.includes(CANARY_SMTP_PASS), 'SMTP_PASSWORD no debe aparecer en la respuesta de getGlobalConfig');
    assert(!jsonString.includes(CANARY_SHOPIFY_SECRET), 'SHOPIFY_CLIENT_SECRET no debe aparecer en la respuesta');
    assert(!jsonString.includes(CANARY_META_SECRET), 'META_APP_SECRET no debe aparecer en la respuesta');
    assert(!jsonString.includes(CANARY_STRIPE_SECRET), 'STRIPE_SECRET_KEY no debe aparecer en la respuesta');

    // -------------------------------------------------------------------------
    // TEST 2: Metadata segura en configMap.secrets
    // -------------------------------------------------------------------------
    console.log('\n--- Test 2: Safe Secret Metadata Structure ---');

    assert(Boolean(responseData.secrets), 'La respuesta debe incluir el objeto seguro "secrets"');
    assert(responseData.secrets.gemini.configured === true, 'secrets.gemini debe reportarse como configured=true');
    assert(responseData.secrets.gemini.masked === '••••••••', 'secrets.gemini.masked debe ser exactamente "••••••••"');
    assert(responseData.secrets.groq.configured === true, 'secrets.groq debe reportarse como configured=true');
    assert(responseData.secrets.evolution.configured === true, 'secrets.evolution debe reportarse como configured=true');
    assert(responseData.secrets.shopify.configured === true, 'secrets.shopify debe reportarse como configured=true');

    // Comprobar campos legacy enmascarados
    assert(responseData.geminiKey === '••••••••', 'geminiKey legacy debe ser "••••••••" y nunca el valor real');
    assert(responseData.groqKey === '••••••••', 'groqKey legacy debe ser "••••••••" y nunca el valor real');
    assert(responseData.evoApiKey === '••••••••', 'evoApiKey legacy debe ser "••••••••" y nunca el valor real');
    assert(responseData.smtpPassword === '••••••••', 'smtpPassword legacy debe ser "••••••••" y nunca el valor real');

    // -------------------------------------------------------------------------
    // TEST 3: saveGlobalConfig prohíbe escribir secretos globales en DB
    // -------------------------------------------------------------------------
    console.log('\n--- Test 3: saveGlobalConfig Prohibits Writing Global Secrets ---');

    let saveMessage = null;
    const mockSaveReq = {
      body: {
        systemPrompt: 'Prompt de prueba para sanitización',
        geminiKey: 'HACKED_KEY_ATTEMPT_123',
        groqKey: 'HACKED_KEY_ATTEMPT_456',
        evoApiKey: 'HACKED_KEY_ATTEMPT_789',
        smtpPassword: 'HACKED_PASSWORD_ATTEMPT',
        DATABASE_URL: 'postgresql://hacker:pwd@evil.com/db'
      }
    };

    const mockSaveRes = {
      status(code) {
        responseStatus = code;
        return this;
      },
      json(data) {
        saveMessage = data;
        return this;
      }
    };

    await saveGlobalConfig(mockSaveReq, mockSaveRes);

    assert(Boolean(saveMessage), 'saveGlobalConfig debe responder exitosamente');

    // Verificar en la base de datos real local que ninguna clave prohibida fue insertada en SystemConfig
    const forbiddenKeysInDb = await prisma.systemConfig.findMany({
      where: {
        key: {
          in: ['geminiKey', 'groqKey', 'evoApiKey', 'smtpPassword', 'DATABASE_URL']
        }
      }
    });

    assert(forbiddenKeysInDb.length === 0, 'Ningún secreto global debe haber sido insertado en SystemConfig');

    // Comprobar que la clave legítima sí fue guardada
    const savedPrompt = await prisma.systemConfig.findUnique({
      where: { key: 'systemPrompt' }
    });
    assert(savedPrompt?.value === 'Prompt de prueba para sanitización', 'La clave editable legítima (systemPrompt) debe haberse guardado');

    // -------------------------------------------------------------------------
    // TEST 4: saveGlobalConfig ignora placeholders enmascarados
    // -------------------------------------------------------------------------
    console.log('\n--- Test 4: Masked Placeholders Are Ignored on Save ---');

    const mockMaskSaveReq = {
      body: {
        systemPrompt: '••••••••', // usuario envía máscara por accidente
        errorWebhook: '********'
      }
    };

    await saveGlobalConfig(mockMaskSaveReq, mockSaveRes);

    const checkPromptAfterMask = await prisma.systemConfig.findUnique({
      where: { key: 'systemPrompt' }
    });

    assert(
      checkPromptAfterMask?.value === 'Prompt de prueba para sanitización',
      'El placeholder enmascarado ("••••••••") no debe haber sobrescrito el valor anterior'
    );

    console.log('\n======================================================================');
    console.log(`🎉 TODOS LOS TESTS DE SANITIZACIÓN PASARON: ${passedTests}/${totalTests}`);
    console.log('======================================================================\n');

  } finally {
    // Restaurar entorno
    process.env = originalEnv;
  }
}

runSuite().catch(err => {
  console.error('❌ Error fatal en la suite de sanitización:', err);
  process.exit(1);
});
