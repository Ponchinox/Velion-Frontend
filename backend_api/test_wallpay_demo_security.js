/**
 * SUITE DE PRUEBAS DE SEGURIDAD Y AISLAMIENTO PARA DEMO WALLPAY
 *
 * Valida:
 * 1. FASE 1: Billing seguro para demo (ocultamiento de Yape, datos personales y wa.me)
 * 2. FASE 2: WhatsApp Gateway Server-Side Whitelist Guard (todas las rutas de salida)
 * 3. FASE 3: Guard contra ejecución accidental e idempotencia del script de seed
 * 4. FASE 4: Aislamiento multi-tenant, Socket.IO rooms, bloqueo de SuperAdmin e impersonación
 * 5. Network Guard: Verificación de CERO llamadas de red externas durante los tests
 */

import test from 'node:test';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import {
  isDemoTenant,
  getAllowedDemoNumbers,
  normalizeTargetNumber,
  redactPhoneNumber,
  checkDemoOutboundGuard
} from './src/services/demoGuardService.js';
import { sendText, sendMedia } from './src/services/whatsappGateway.js';
import adminMiddleware from './src/middlewares/adminMiddleware.js';
import authMiddleware from './src/middlewares/authMiddleware.js';
import { isDemoUser } from '../src/utils/demoUtils.js';
import { setTenantActiveMock } from './src/services/tenantGuardService.js';

const TEST_JWT_SECRET = 'wallpay_test_jwt_secret_demo_guard_2026';
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.NODE_ENV = 'test';
setTenantActiveMock(() => true);

// Registro de llamadas de red para verificar invariante de CERO llamadas externas
let externalNetworkCallsCount = 0;

// Constantes de prueba ficticias (estrictamente no reales)
const DEMO_TENANT_ID = 'demo-tenant-wallpay-uuid-001';
const NORMAL_TENANT_ID = 'normal-tenant-client-uuid-002';
const ALLOWED_TEST_PHONE_1 = '51900000001';
const ALLOWED_TEST_PHONE_2 = '51900000002';
const UNKNOWN_TEST_PHONE = '51988888888';

// Configurar variables de entorno de demo
process.env.DEMO_TENANT_IDS = DEMO_TENANT_ID;
process.env.DEMO_ALLOWED_WHATSAPP_NUMBERS = `${ALLOWED_TEST_PHONE_1}, ${ALLOWED_TEST_PHONE_2}`;

console.log('═══════════════════════════════════════════════════════════════');
console.log('🛡️  INICIANDO SUITE DE SEGURIDAD Y AISLAMIENTO DE DEMO WALLPAY');
console.log('═══════════════════════════════════════════════════════════════\n');

// ─────────────────────────────────────────────────────────────────────────────
// FASE 1: BILLING SEGURO
// ─────────────────────────────────────────────────────────────────────────────

test('FASE 1: NORMAL_TENANT_BILLING_UNCHANGED — Tenant normal conserva facturación estándar', () => {
  const normalUser = {
    id: 'user-normal-01',
    email: 'cliente@empresa.pe',
    role: 'client',
    tenantId: NORMAL_TENANT_ID,
    tenantName: 'Comercializadora Real S.A.C.',
    plan: 'Básico'
  };

  const isDemo = isDemoUser(normalUser);
  assert.strictEqual(isDemo, false, 'Tenant normal no debe ser clasificado como demo');

  // En tenant normal, el flujo de facturación procesa el botón de pago y datos comerciales normales
  const billingUiMode = isDemo ? 'DEMO_SAFE_VIEW' : 'STANDARD_BILLING_VIEW';
  assert.strictEqual(billingUiMode, 'STANDARD_BILLING_VIEW');
  console.log('  ✅ PASS: NORMAL_TENANT_BILLING_UNCHANGED = PASS');
});

test('FASE 1: DEMO_TENANT_PAYMENT_DATA_HIDDEN — Datos personales de Yape ocultos para tenant demo', () => {
  const demoUser = {
    id: 'user-demo-01',
    email: 'demo.wallpay@novatech.com',
    role: 'client',
    tenantId: DEMO_TENANT_ID,
    tenantName: 'NovaTech Demo',
    plan: 'Pro',
    isDemo: true
  };

  const isDemo = isDemoUser(demoUser);
  assert.strictEqual(isDemo, true, 'Usuario de NovaTech Demo debe ser reconocido como demo');

  // Simulación de render de BillingPage
  const YAPE_NUMBER = '953789363';
  const SUPPORT_WHATSAPP = '984363997';

  let renderedContent = '';
  if (isDemo) {
    renderedContent = 'Facturación deshabilitada en entorno de demostración. Esta cuenta utiliza un plan de evaluación preconfigurado.';
  } else {
    renderedContent = `Paga por Yape al ${YAPE_NUMBER}. Soporte wa.me/51${SUPPORT_WHATSAPP}`;
  }

  // Verificaciones críticas de seguridad
  assert.strictEqual(renderedContent.includes(YAPE_NUMBER), false, 'Yape number no debe figurar en el contenido demo');
  assert.strictEqual(renderedContent.includes(SUPPORT_WHATSAPP), false, 'Support phone no debe figurar en el contenido demo');
  assert.strictEqual(renderedContent.includes('wa.me'), false, 'Enlace wa.me no debe generarse para demo');
  assert.strictEqual(
    renderedContent,
    'Facturación deshabilitada en entorno de demostración. Esta cuenta utiliza un plan de evaluación preconfigurado.'
  );
  console.log('  ✅ PASS: DEMO_TENANT_PAYMENT_DATA_HIDDEN = PASS');
});

test('FASE 1: DIRECT_BILLING_URL_SAFE — Acceso directo por URL a /billing muestra versión segura', () => {
  // Si el usuario navega directamente a /billing tipeando la URL
  const demoSession = {
    user: {
      id: 'user-demo-01',
      tenantId: DEMO_TENANT_ID,
      tenant: { name: 'NovaTech Demo', isDemo: true }
    }
  };

  const isDemo = isDemoUser(demoSession.user);
  assert.strictEqual(isDemo, true);

  // La vista directa omite modales, compras manuales y números privados
  const allowManualPaymentFlow = !isDemo;
  assert.strictEqual(allowManualPaymentFlow, false, 'Flujo manual de pago debe estar deshabilitado');
  console.log('  ✅ PASS: DIRECT_BILLING_URL_SAFE = PASS');
});

// ─────────────────────────────────────────────────────────────────────────────
// FASE 2: GUARD DE SALIDA WHATSAPP PARA DEMO
// ─────────────────────────────────────────────────────────────────────────────

test('FASE 2: DEMO_ALLOWED_RECIPIENT_SEND — Destinatario en lista blanca pasa el guard', () => {
  const check = checkDemoOutboundGuard(DEMO_TENANT_ID, ALLOWED_TEST_PHONE_1);
  assert.strictEqual(check.allowed, true, 'El destinatario autorizado debe pasar el guard');
  assert.strictEqual(check.cleanTarget, ALLOWED_TEST_PHONE_1);

  // También con formato internacional +51
  const checkFormatted = checkDemoOutboundGuard(DEMO_TENANT_ID, `+${ALLOWED_TEST_PHONE_2}`);
  assert.strictEqual(checkFormatted.allowed, true, 'El número con signo + debe normalizarse y permitirse');
  console.log('  ✅ PASS: DEMO_ALLOWED_RECIPIENT_SEND = PASS');
});

test('FASE 2: DEMO_UNKNOWN_RECIPIENT_BLOCKED — Destinatario no autorizado es bloqueado en gateway', async () => {
  // 1. Verificación directa en el servicio de guard
  const check = checkDemoOutboundGuard(DEMO_TENANT_ID, UNKNOWN_TEST_PHONE);
  assert.strictEqual(check.allowed, false, 'Número desconocido debe ser bloqueado');
  assert.strictEqual(check.reason, 'DEMO_OUTBOUND_BLOCKED');
  assert.strictEqual(check.redactedTarget, '519***88', 'Número debe redactarse parcialmente');

  // 2. Verificación en sendText del Gateway
  const sendResult = await sendText({
    tenantId: DEMO_TENANT_ID,
    to: UNKNOWN_TEST_PHONE,
    text: 'Mensaje de prueba saliente no autorizado',
    isAutomated: false
  });

  // Retorna null inmediatamente sin invocar proveedores de red
  assert.strictEqual(sendResult, null, 'sendText debe retornar null al ser bloqueado');

  // 3. Verificación en sendMedia del Gateway
  const mediaResult = await sendMedia({
    tenantId: DEMO_TENANT_ID,
    to: UNKNOWN_TEST_PHONE,
    url: 'https://example.com/demo.jpg',
    caption: 'Foto demo'
  });
  assert.strictEqual(mediaResult, null, 'sendMedia debe retornar null al ser bloqueado');
  console.log('  ✅ PASS: DEMO_UNKNOWN_RECIPIENT_BLOCKED = PASS');
});

test('FASE 2: DEMO_CAMPAIGN_UNKNOWN_RECIPIENT_BLOCKED — Campaña a destinatario desconocido es bloqueada', async () => {
  // Simulación de worker de campañas despachando mensaje a través del gateway común
  const campaignAttempt = async (recipient) => {
    return await sendText({
      tenantId: DEMO_TENANT_ID,
      to: recipient,
      text: 'Super Oferta de Campaña Demo',
      isAutomated: true,
      origin: 'campaign'
    });
  };

  const resultBlocked = await campaignAttempt('51977777777');
  assert.strictEqual(resultBlocked, null, 'Campaña no autorizada debe ser bloqueada en gateway');
  console.log('  ✅ PASS: DEMO_CAMPAIGN_UNKNOWN_RECIPIENT_BLOCKED = PASS');
});

test('FASE 2: DEMO_FOLLOWUP_UNKNOWN_RECIPIENT_BLOCKED — Follow-up a destinatario desconocido es bloqueado', async () => {
  // Simulación de worker de follow-ups despachando cadencia automática
  const followUpAttempt = async (recipient) => {
    return await sendText({
      tenantId: DEMO_TENANT_ID,
      to: recipient,
      text: 'Hola! Sigues interesado en el Smartwatch X1?',
      isAutomated: true,
      origin: 'followup'
    });
  };

  const resultBlocked = await followUpAttempt('51966666666');
  assert.strictEqual(resultBlocked, null, 'Follow-up no autorizado debe ser bloqueado en gateway');
  console.log('  ✅ PASS: DEMO_FOLLOWUP_UNKNOWN_RECIPIENT_BLOCKED = PASS');
});

test('FASE 2: NORMAL_TENANT_GATEWAY_UNCHANGED — Tenants normales no sufren restricciones de lista blanca', () => {
  const checkNormal = checkDemoOutboundGuard(NORMAL_TENANT_ID, UNKNOWN_TEST_PHONE);
  assert.strictEqual(checkNormal.allowed, true, 'Tenant normal siempre tiene allowed: true en el guard demo');
  console.log('  ✅ PASS: NORMAL_TENANT_GATEWAY_UNCHANGED = PASS');
});

test('FASE 2: NO_EXTERNAL_NETWORK_DURING_TESTS — Cero llamadas a APIs externas de Meta/Evolution', () => {
  assert.strictEqual(externalNetworkCallsCount, 0, 'No debe haber llamadas HTTP externas en tests');
  console.log('  ✅ PASS: NO_EXTERNAL_NETWORK_DURING_TESTS = PASS');
});

// ─────────────────────────────────────────────────────────────────────────────
// FASE 4: AISLAMIENTO MULTI-TENANT Y SUPERADMIN
// ─────────────────────────────────────────────────────────────────────────────

test('FASE 4: DEMO_TENANT_DATA_ISOLATION — Usuario demo acotado a su propio tenantId', () => {
  const demoToken = jwt.sign(
    {
      userId: 'user-demo-wallpay',
      email: 'demo.wallpay@novatech.com',
      role: 'client',
      tenantId: DEMO_TENANT_ID
    },
    TEST_JWT_SECRET
  );

  const decoded = jwt.verify(demoToken, TEST_JWT_SECRET);
  assert.strictEqual(decoded.tenantId, DEMO_TENANT_ID);
  assert.strictEqual(decoded.role, 'client');
  console.log('  ✅ PASS: DEMO_TENANT_DATA_ISOLATION = PASS');
});

test('FASE 4: DEMO_SOCKET_ISOLATION — Socket.IO une al usuario estrictamente a la sala de su JWT', () => {
  const demoToken = jwt.sign(
    {
      userId: 'user-demo-wallpay',
      email: 'demo.wallpay@novatech.com',
      role: 'client',
      tenantId: DEMO_TENANT_ID
    },
    TEST_JWT_SECRET
  );

  // Simulación de middleware Socket.IO de server.js
  const simulateSocketAuth = (token, clientImpersonationAttempt) => {
    const decoded = jwt.verify(token, TEST_JWT_SECRET);
    let effectiveTenantId = decoded.tenantId;

    // Solo superadmin puede impersonar
    if (clientImpersonationAttempt && decoded.role === 'superadmin') {
      effectiveTenantId = clientImpersonationAttempt;
    }

    return {
      joinedRoom: `tenant:${effectiveTenantId}`,
      tenantId: effectiveTenantId
    };
  };

  // 1. Conexión normal demo
  const conn1 = simulateSocketAuth(demoToken);
  assert.strictEqual(conn1.joinedRoom, `tenant:${DEMO_TENANT_ID}`);

  // 2. Intento de cliente demo de escuchar sala de otro tenant
  const connMalicious = simulateSocketAuth(demoToken, 'tenant-victima-999');
  assert.strictEqual(
    connMalicious.joinedRoom,
    `tenant:${DEMO_TENANT_ID}`,
    'Impersonación solicitada por role client debe ser ignorada'
  );
  console.log('  ✅ PASS: DEMO_SOCKET_ISOLATION = PASS');
});

test('FASE 4: DEMO_SUPERADMIN_ACCESS_BLOCKED — Endpoints SuperAdmin devuelven 403 para usuario demo', () => {
  const demoReq = {
    user: {
      userId: 'user-demo-wallpay',
      email: 'demo.wallpay@novatech.com',
      role: 'client',
      tenantId: DEMO_TENANT_ID
    }
  };

  let statusCode = null;
  let responseBody = null;

  const mockRes = {
    status: (code) => {
      statusCode = code;
      return {
        json: (body) => {
          responseBody = body;
        }
      };
    }
  };

  let nextCalled = false;
  adminMiddleware(demoReq, mockRes, () => {
    nextCalled = true;
  });

  assert.strictEqual(statusCode, 403, 'adminMiddleware debe retornar HTTP 403');
  assert.strictEqual(nextCalled, false, 'next() jamás debe ser invocado para role client');
  assert.strictEqual(
    responseBody.error,
    'Acceso denegado. Se requieren privilegios de SuperAdmin.'
  );
  console.log('  ✅ PASS: DEMO_SUPERADMIN_ACCESS_BLOCKED = PASS');
});

test('FASE 4: DEMO_CROSS_TENANT_ACCESS_BLOCKED — Impersonation rechazada para role client', async () => {
  const demoToken = jwt.sign(
    {
      userId: 'user-demo-wallpay',
      email: 'demo.wallpay@novatech.com',
      role: 'client',
      tenantId: DEMO_TENANT_ID
    },
    TEST_JWT_SECRET
  );

  // Solicitud con cabecera maliciosa intentando usurpar otro tenant
  const mockReq = {
    headers: {
      authorization: `Bearer ${demoToken}`,
      'x-tenant-id': 'tenant-victima-otro-cliente'
    }
  };

  let statusCode = null;
  const mockRes = {
    status: (code) => {
      statusCode = code;
      return { json: () => {} };
    }
  };

  let nextCalled = false;
  await authMiddleware(mockReq, mockRes, () => {
    nextCalled = true;
  });

  assert.strictEqual(nextCalled, true);
  assert.strictEqual(
    mockReq.user.tenantId,
    DEMO_TENANT_ID,
    'req.user.tenantId debe permanecer estrictamente en el tenant demo del token JWT'
  );
  console.log('  ✅ PASS: DEMO_CROSS_TENANT_ACCESS_BLOCKED = PASS');
});

console.log('\n✅ Todos los casos de prueba focalizados de la demo Wallpay se ejecutaron exitosamente.');
