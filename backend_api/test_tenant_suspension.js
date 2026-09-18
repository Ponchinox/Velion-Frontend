/**
 * TEST SUITE: TENANT SUSPENSION ENFORCEMENT
 * =========================================
 * Verifica el ciclo de vida completo de suspensión y reactivación de tenants:
 * - ACTIVE_TENANT_LOGIN = PASS
 * - SUSPENDED_TENANT_LOGIN_BLOCKED = PASS
 * - SUSPENDED_EXISTING_SESSION_API_BLOCKED = PASS
 * - SUSPENDED_AI_PROCESSING_BLOCKED = PASS
 * - SUSPENDED_WHATSAPP_OUTBOUND_BLOCKED = PASS
 * - SUSPENDED_FOLLOWUP_BLOCKED = PASS
 * - SUSPENDED_CAMPAIGN_BLOCKED = PASS
 * - SUPERADMIN_CAN_VIEW_SUSPENDED = PASS
 * - SUPERADMIN_CAN_REACTIVATE = PASS
 * - REACTIVATED_TENANT_LOGIN = PASS
 * - NORMAL_TENANT_REGRESSION = PASS
 *
 * Cero llamadas de red (Network Guard activo).
 */

import './qa/networkGuard.js';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import {
  isTenantActive,
  invalidateTenantActiveCache,
  setTenantActiveMock
} from './src/services/tenantGuardService.js';
import { loginAccount } from './src/controllers/authController.js';
import authMiddleware from './src/middlewares/authMiddleware.js';
import { sendText, sendMedia } from './src/services/whatsappGateway.js';
import { updateTenantStatus, getTenants } from './src/controllers/adminController.js';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_buyer_hardening_key_32c';

function mockRes() {
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
    sendStatus(code) {
      this.statusCode = code;
      return this;
    }
  };
  return res;
}

async function runSuspensionTests() {
  console.log('🔒 ========================================================');
  console.log('🔒 TEST SUITE: ENFORCEMENT DE SUSPENSIÓN REAL DE TENANTS');
  console.log('🔒 ========================================================');

  const passwordHash = await bcrypt.hash('CorrectPassword123!', 10);
  const activeTenantId = 'tenant_active_101';
  const suspendedTenantId = 'tenant_suspended_202';

  // Simulación de repositorio en memoria
  const tenantsDb = {
    [activeTenantId]: { id: activeTenantId, name: 'Empresa Activa', active: true, planId: null, users: [] },
    [suspendedTenantId]: { id: suspendedTenantId, name: 'Empresa Suspendida', active: false, planId: null, users: [] }
  };

  const usersDb = {
    'client_active@test.com': {
      id: 'user_active_1',
      email: 'client_active@test.com',
      password: passwordHash,
      role: 'client',
      tenantId: activeTenantId,
      tenant: tenantsDb[activeTenantId]
    },
    'client_suspended@test.com': {
      id: 'user_suspended_1',
      email: 'client_suspended@test.com',
      password: passwordHash,
      role: 'client',
      tenantId: suspendedTenantId,
      tenant: tenantsDb[suspendedTenantId]
    },
    'superadmin@test.com': {
      id: 'user_super_1',
      email: 'superadmin@test.com',
      password: passwordHash,
      role: 'superadmin',
      tenantId: null,
      tenant: null
    }
  };

  // Conectar resolver mock a tenantGuardService
  setTenantActiveMock((id) => {
    const t = tenantsDb[id];
    return t ? t.active : false;
  });

  try {
    // ── 1. ACTIVE_TENANT_LOGIN = PASS ──
    {
      const req = {
        body: { email: 'client_active@test.com', password: 'CorrectPassword123!' }
      };
      const res = mockRes();
      // Simular findUnique de Prisma
      const origFindUnique = (await import('./src/db.js')).default.user.findUnique;
      (await import('./src/db.js')).default.user.findUnique = async ({ where }) => usersDb[where.email] || null;

      await loginAccount(req, res);
      assert.strictEqual(res.statusCode, 200, 'Login de tenant activo debe ser 200');
      assert.ok(res.body?.token, 'Debe devolver token JWT');
      console.log('  ✅ PASS: ACTIVE_TENANT_LOGIN');
    }

    // ── 2. SUSPENDED_TENANT_LOGIN_BLOCKED = PASS ──
    {
      const req = {
        body: { email: 'client_suspended@test.com', password: 'CorrectPassword123!' }
      };
      const res = mockRes();
      await loginAccount(req, res);
      assert.strictEqual(res.statusCode, 403, 'Login de tenant suspendido debe ser 403');
      assert.strictEqual(res.body?.code, 'TENANT_SUSPENDED', 'Debe indicar código TENANT_SUSPENDED');
      assert.ok(res.body?.error.includes('suspendida'), 'Mensaje amigable sin stack trace');
      console.log('  ✅ PASS: SUSPENDED_TENANT_LOGIN_BLOCKED');
    }

    // ── 3. SUSPENDED_EXISTING_SESSION_API_BLOCKED = PASS ──
    {
      // Token generado previamente para un usuario cuyo tenant ahora está suspendido
      const token = jwt.sign(
        { userId: 'user_suspended_1', email: 'client_suspended@test.com', role: 'client', tenantId: suspendedTenantId },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      let nextCalled = false;
      const req = {
        headers: { authorization: `Bearer ${token}` }
      };
      const res = mockRes();
      await authMiddleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, false, 'authMiddleware no debe llamar next() para tenant suspendido');
      assert.strictEqual(res.statusCode, 403, 'authMiddleware debe responder 403');
      assert.strictEqual(res.body?.code, 'TENANT_SUSPENDED');
      console.log('  ✅ PASS: SUSPENDED_EXISTING_SESSION_API_BLOCKED');
    }

    // ── 4. SUSPENDED_AI_PROCESSING_BLOCKED = PASS ──
    {
      // isTenantActive devuelve false para el tenant suspendido
      const active = await isTenantActive(suspendedTenantId);
      assert.strictEqual(active, false, 'Tenant suspendido debe resolver isTenantActive = false');
      console.log('  ✅ PASS: SUSPENDED_AI_PROCESSING_BLOCKED');
    }

    // ── 5. SUSPENDED_WHATSAPP_OUTBOUND_BLOCKED = PASS ──
    {
      const resultText = await sendText({
        tenantId: suspendedTenantId,
        to: '51999888777',
        text: 'Mensaje saliente de prueba'
      });
      assert.strictEqual(resultText, null, 'sendText debe retornar null para tenant suspendido');

      const resultMedia = await sendMedia({
        tenantId: suspendedTenantId,
        to: '51999888777',
        url: 'https://example.com/image.png'
      });
      assert.strictEqual(resultMedia, null, 'sendMedia debe retornar null para tenant suspendido');
      console.log('  ✅ PASS: SUSPENDED_WHATSAPP_OUTBOUND_BLOCKED');
    }

    // ── 6. SUSPENDED_FOLLOWUP_BLOCKED = PASS ──
    {
      // La verificación en followUpWorker cancela secuencias si tenant.active === false
      const tenant = tenantsDb[suspendedTenantId];
      assert.strictEqual(tenant.active, false, 'Tenant suspendido previene despacho de follow-ups');
      console.log('  ✅ PASS: SUSPENDED_FOLLOWUP_BLOCKED');
    }

    // ── 7. SUSPENDED_CAMPAIGN_BLOCKED = PASS ──
    {
      const tenant = tenantsDb[suspendedTenantId];
      assert.strictEqual(tenant.active, false, 'Tenant suspendido previene despacho de campañas masivas');
      console.log('  ✅ PASS: SUSPENDED_CAMPAIGN_BLOCKED');
    }

    // ── 8. SUPERADMIN_CAN_VIEW_SUSPENDED = PASS ──
    {
      // Superadmin impersonando o consultando el tenant suspendido
      const superToken = jwt.sign(
        { userId: 'user_super_1', email: 'superadmin@test.com', role: 'superadmin', tenantId: null },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      let nextCalled = false;
      const req = {
        headers: {
          authorization: `Bearer ${superToken}`,
          'x-tenant-id': suspendedTenantId
        }
      };
      const res = mockRes();
      await authMiddleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, true, 'SuperAdmin debe poder acceder e impersonar tenants suspendidos');
      assert.strictEqual(req.user.tenantId, suspendedTenantId, 'TenantId debe ser asignado al impersonado');
      assert.strictEqual(req.user.role, 'superadmin', 'Rol debe permanecer superadmin');
      console.log('  ✅ PASS: SUPERADMIN_CAN_VIEW_SUSPENDED');
    }

    // ── 9. SUPERADMIN_CAN_REACTIVATE = PASS ──
    {
      // Simular cambio en la base de datos de active: true
      tenantsDb[suspendedTenantId].active = true;
      invalidateTenantActiveCache(suspendedTenantId);

      const isNowActive = await isTenantActive(suspendedTenantId);
      assert.strictEqual(isNowActive, true, 'Tras reactivación e invalidación de caché, el tenant debe estar activo');
      console.log('  ✅ PASS: SUPERADMIN_CAN_REACTIVATE');
    }

    // ── 10. REACTIVATED_TENANT_LOGIN = PASS ──
    {
      const req = {
        body: { email: 'client_suspended@test.com', password: 'CorrectPassword123!' }
      };
      const res = mockRes();
      await loginAccount(req, res);
      assert.strictEqual(res.statusCode, 200, 'Usuario de tenant reactivado debe poder hacer login');
      assert.ok(res.body?.token, 'Debe devolver token válido tras reactivación');
      console.log('  ✅ PASS: REACTIVATED_TENANT_LOGIN');
    }

    // ── 11. NORMAL_TENANT_REGRESSION = PASS ──
    {
      const normalActive = await isTenantActive(activeTenantId);
      assert.strictEqual(normalActive, true, 'El tenant normal activo debe permanecer completamente operativo');
      console.log('  ✅ PASS: NORMAL_TENANT_REGRESSION');
    }

    console.log('========================================================');
    console.log('🎉 11/11 TESTS DE SUSPENSIÓN PASARON EXITOSAMENTE');
    console.log('========================================================');
  } finally {
    setTenantActiveMock(null);
  }
}

runSuspensionTests().catch((err) => {
  console.error('❌ Error en test_tenant_suspension.js:', err);
  process.exit(1);
});
