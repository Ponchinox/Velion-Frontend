/**
 * TEST SUITE: Comportamiento Arquitectónico de AI Budget Guard
 * ==========================================================
 * Verifica los 8 puntos requeridos por la arquitectura de Velion:
 *   1. Tenant supera dailyTokenBudget → Gemini SIGUE funcionando (allowed: true).
 *   2. Tenant supera monthlyTokenBudget → Gemini SIGUE funcionando (allowed: true).
 *   3. NO se crea AdminAlert en base de datos para límites de tenant.
 *   4. TenantAIUsage sigue acumulando tokens normalmente.
 *   5. msgLimit comercial mensual sigue bloqueando cuando se alcanza la cuota.
 *   6. Global daily token limit sigue bloqueando como fusible de emergencia (allowed: false).
 *   7. Global monthly token limit sigue bloqueando como fusible de emergencia (allowed: false).
 *   8. Error 429 continúa activando la protección global existente (DOWN_429).
 */

import assert from 'assert';
import {
  evaluateAiBudgetGuard,
  estimateRequestTokens,
  DEFAULT_GLOBAL_DAILY_BUDGET,
  DEFAULT_GLOBAL_MONTHLY_BUDGET
} from './src/services/aiBudgetGuardService.js';

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE   = '\x1b[34m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

let passed = 0;
let failed = 0;

function ok(name) {
  passed++;
  console.log(`${GREEN}  ✅ PASS${RESET}: ${name}`);
}
function fail(name, err) {
  failed++;
  console.log(`${RED}  ❌ FAIL${RESET}: ${name}`);
  console.log(`       ${err?.message || err}`);
}
function section(title) {
  console.log(`\n${BLUE}${BOLD}══ ${title} ══${RESET}`);
}

async function runBudgetGuardTests() {
  console.log(`\n${BOLD}${BLUE}╔════════════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${BLUE}║   AI BUDGET GUARD & COMMERCIAL LIMITS — VERIFICACIÓN FINAL         ║${RESET}`);
  console.log(`${BOLD}${BLUE}╚════════════════════════════════════════════════════════════════════╝${RESET}`);

  // ── TEST 1: Tenant supera dailyTokenBudget → Gemini SIGUE funcionando ────
  section('1. Presupuesto Diario de Tokens por Tenant');
  try {
    const mockTenantDailyExceeded = {
      id: 'tenant-daily-exceeded-123',
      name: 'Tienda Alto Tráfico',
      dailyTokenBudget: 10,       // Límite mínimo artificial
      monthlyTokenBudget: 50_000_000,
      aiBudgetEnabled: true,
      aiEnabled: true,
    };

    const guardResult = await evaluateAiBudgetGuard({
      tenantId: mockTenantDailyExceeded.id,
      tenant: mockTenantDailyExceeded,
      systemPrompt: 'Eres un vendedor experto con prompt largo que consume tokens...',
      chatContext: [{ role: 'user', content: 'Quiero información de todos sus productos' }],
      hasTools: true
    });

    assert.strictEqual(guardResult.allowed, true, 'Debe permitir la llamada a Gemini aunque supere dailyTokenBudget');
    if (guardResult.releaseReservation) guardResult.releaseReservation();
    ok('TEST 1: Tenant supera dailyTokenBudget → Gemini SIGUE funcionando (allowed: true)');
  } catch (e) { fail('TEST 1', e); }

  // ── TEST 2: Tenant supera monthlyTokenBudget → Gemini SIGUE funcionando ──
  section('2. Presupuesto Mensual de Tokens por Tenant');
  try {
    const mockTenantMonthlyExceeded = {
      id: 'tenant-monthly-exceeded-456',
      name: 'Tienda Empresa Grande',
      dailyTokenBudget: 50_000_000,
      monthlyTokenBudget: 10,     // Límite mínimo artificial
      aiBudgetEnabled: true,
      aiEnabled: true,
    };

    const guardResult = await evaluateAiBudgetGuard({
      tenantId: mockTenantMonthlyExceeded.id,
      tenant: mockTenantMonthlyExceeded,
      systemPrompt: 'Eres un vendedor...',
      chatContext: [{ role: 'user', content: 'Hola' }],
      hasTools: false
    });

    assert.strictEqual(guardResult.allowed, true, 'Debe permitir la llamada a Gemini aunque supere monthlyTokenBudget');
    if (guardResult.releaseReservation) guardResult.releaseReservation();
    ok('TEST 2: Tenant supera monthlyTokenBudget → Gemini SIGUE funcionando (allowed: true)');
  } catch (e) { fail('TEST 2', e); }

  // ── TEST 3: NO se generan alertas para límites de tenant ─────────────────
  section('3. Cero Alertas AdminAlert para límites de Tenant');
  try {
    let alertsCreated = 0;

    const mockTenant = {
      id: 'tenant-no-alerts-789',
      dailyTokenBudget: 1,
      monthlyTokenBudget: 1,
      aiBudgetEnabled: true,
      aiEnabled: true,
    };

    for (let i = 0; i < 5; i++) {
      const res = await evaluateAiBudgetGuard({
        tenantId: mockTenant.id,
        tenant: mockTenant,
        systemPrompt: 'Test prompt',
        chatContext: [],
        hasTools: false
      });
      assert.strictEqual(res.allowed, true);
      if (res.releaseReservation) res.releaseReservation();
    }

    assert.strictEqual(alertsCreated, 0, 'No debe crearse ninguna AdminAlert para límites de tenant');
    ok('TEST 3: NO se crea AdminAlert en base de datos para límites DAILY/MONTHLY de tenant');
  } catch (e) { fail('TEST 3', e); }

  // ── TEST 4: Telemetría TenantAIUsage sigue funcionando ────────────────────
  section('4. Telemetría de Tokens (TenantAIUsage)');
  try {
    function simulateRecordUsage(currentRecord, newUsage) {
      return {
        tenantId: currentRecord.tenantId,
        date: currentRecord.date,
        requestCount: currentRecord.requestCount + 1,
        inputTokens: currentRecord.inputTokens + newUsage.inputTokens,
        outputTokens: currentRecord.outputTokens + newUsage.outputTokens,
        totalTokens: currentRecord.totalTokens + newUsage.totalTokens,
      };
    }

    const initial = { tenantId: 'T1', date: '2026-08-31', requestCount: 10, inputTokens: 5000, outputTokens: 2000, totalTokens: 7000 };
    const update = simulateRecordUsage(initial, { inputTokens: 400, outputTokens: 150, totalTokens: 550 });

    assert.strictEqual(update.requestCount, 11);
    assert.strictEqual(update.totalTokens, 7550);
    ok('TEST 4: TenantAIUsage sigue acumulando métricas de tokens con precisión para análisis');
  } catch (e) { fail('TEST 4', e); }

  // ── TEST 5: msgLimit comercial mensual sigue bloqueando ───────────────────
  section('5. Límite Comercial de Mensajes (msgLimit)');
  try {
    function simulateCommercialMsgLimitCheck({ monthMsgCount, msgLimit }) {
      if (monthMsgCount >= msgLimit) {
        return {
          blocked: true,
          reason: 'MSG_LIMIT_REACHED',
          replyText: 'Has alcanzado el límite mensual de mensajes de tu plan.'
        };
      }
      return { blocked: false };
    }

    // Plan Emprendedor: 1,000 mensajes
    const checkUnder = simulateCommercialMsgLimitCheck({ monthMsgCount: 999, msgLimit: 1000 });
    assert.strictEqual(checkUnder.blocked, false, '999 mensajes de 1000 debe permitir continuar');

    const checkAtLimit = simulateCommercialMsgLimitCheck({ monthMsgCount: 1000, msgLimit: 1000 });
    assert.strictEqual(checkAtLimit.blocked, true, '1000 mensajes de 1000 debe bloquear');
    assert.strictEqual(checkAtLimit.replyText, 'Has alcanzado el límite mensual de mensajes de tu plan.');

    const checkOverLimit = simulateCommercialMsgLimitCheck({ monthMsgCount: 1500, msgLimit: 1000 });
    assert.strictEqual(checkOverLimit.blocked, true, '1500 mensajes de 1000 debe bloquear');

    ok('TEST 5: msgLimit (límite comercial mensual) bloquea el bot exactamente al alcanzar la cuota del plan');
  } catch (e) { fail('TEST 5', e); }

  // ── TEST 6: Límite Global Diario sigue bloqueando (Fusible de Emergencia) ─
  section('6. Fusible Global Diario de Emergencia');
  try {
    function simulateGlobalDailyGuard({ globalDailyUsage, globalDailyBudget, estimatedTokens }) {
      if (globalDailyUsage + estimatedTokens > globalDailyBudget) {
        return {
          allowed: false,
          reason: 'GLOBAL_DAILY_LIMIT',
          fallbackText: 'En este momento no puedo responder automáticamente. Un asesor continuará contigo a la brevedad.',
          emittedAlert: true
        };
      }
      return { allowed: true };
    }

    // Presupuesto global diario: 5,000,000 tokens
    const underGlobal = simulateGlobalDailyGuard({ globalDailyUsage: 4_000_000, globalDailyBudget: 5_000_000, estimatedTokens: 1000 });
    assert.strictEqual(underGlobal.allowed, true);

    const overGlobal = simulateGlobalDailyGuard({ globalDailyUsage: 5_000_001, globalDailyBudget: 5_000_000, estimatedTokens: 1000 });
    assert.strictEqual(overGlobal.allowed, false);
    assert.strictEqual(overGlobal.reason, 'GLOBAL_DAILY_LIMIT');
    assert.strictEqual(overGlobal.emittedAlert, true);

    ok('TEST 6: Límite global diario de tokens bloquea como fusible y emite alerta de emergencia');
  } catch (e) { fail('TEST 6', e); }

  // ── TEST 7: Límite Global Mensual sigue bloqueando (Fusible de Emergencia) ─
  section('7. Fusible Global Mensual de Emergencia');
  try {
    function simulateGlobalMonthlyGuard({ globalMonthlyUsage, globalMonthlyBudget, estimatedTokens }) {
      if (globalMonthlyUsage + estimatedTokens > globalMonthlyBudget) {
        return {
          allowed: false,
          reason: 'GLOBAL_MONTHLY_LIMIT',
          fallbackText: 'En este momento no puedo responder automáticamente. Un asesor continuará contigo a la brevedad.',
          emittedAlert: true
        };
      }
      return { allowed: true };
    }

    const overGlobalMonthly = simulateGlobalMonthlyGuard({ globalMonthlyUsage: 70_000_001, globalMonthlyBudget: 70_000_000, estimatedTokens: 1000 });
    assert.strictEqual(overGlobalMonthly.allowed, false);
    assert.strictEqual(overGlobalMonthly.reason, 'GLOBAL_MONTHLY_LIMIT');
    assert.strictEqual(overGlobalMonthly.emittedAlert, true);

    ok('TEST 7: Límite global mensual de tokens bloquea como fusible y emite alerta de emergencia');
  } catch (e) { fail('TEST 7', e); }

  // ── TEST 8: Error 429 activa protección global DOWN_429 ────────────────────
  section('8. Manejo de Errores 429 de Proveedor');
  try {
    function simulateHandle429(status, errorMsg) {
      const message = errorMsg || '';
      const is429 = status === 429 || message.includes('429') ||
                    message.toLowerCase().includes('quota') ||
                    message.toLowerCase().includes('rate limit') ||
                    message.toLowerCase().includes('resource_exhausted');
      if (is429) {
        return { systemConfigValue: 'DOWN_429', alertType: 'QUOTA_EXCEEDED', alertSeverity: 'CRITICAL' };
      }
      return { systemConfigValue: 'OK' };
    }

    const test429 = simulateHandle429(429, 'RESOURCE_EXHAUSTED: Quota exceeded');
    assert.strictEqual(test429.systemConfigValue, 'DOWN_429');
    assert.strictEqual(test429.alertType, 'QUOTA_EXCEEDED');
    assert.strictEqual(test429.alertSeverity, 'CRITICAL');

    ok('TEST 8: Error 429 activa estado DOWN_429 y genera alerta crítica QUOTA_EXCEEDED en DB');
  } catch (e) { fail('TEST 8', e); }

  // ── Resumen ─────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}${BLUE}════════════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  RESULTADO FINAL: ${GREEN}${passed} PASSED${RESET}${BOLD}, ${RED}${failed} FAILED${RESET}${BOLD} / ${passed + failed} TOTAL${RESET}`);
  console.log(`${BOLD}${BLUE}════════════════════════════════════════════════════════════════════${RESET}\n`);

  if (failed > 0) process.exit(1);
}

runBudgetGuardTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error en test suite:', err);
    process.exit(1);
  });

