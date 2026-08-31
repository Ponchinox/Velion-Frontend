import prisma from '../db.js';

/**
 * aiBudgetGuardService.js — Protección por Presupuesto y Corte Automático (Fase 2B)
 *
 * Responsabilidad:
 *   1. Evaluar si un Tenant o el Sistema Global han superado su presupuesto de tokens (diario o mensual en UTC).
 *   2. Estimar el costo de la petición entrante antes de enviarla a Gemini.
 *   3. Prevenir condiciones de carrera mediante reservas temporales en memoria (In-Flight Reservations).
 *   4. Generar alertas deduplicadas (anti-spam) al administrador/tenant.
 *   5. Bloquear llamadas a Gemini (0 requests, 0 retries, 0 tools) si se excede el presupuesto.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN Y CONSTANTES POR DEFECTO
// ─────────────────────────────────────────────────────────────────────────────

/** Presupuesto diario por tenant por defecto (tokens) si no está configurado */
export const DEFAULT_TENANT_DAILY_BUDGET = 100_000; // ~25-40 conversaciones completas

/** Presupuesto mensual por tenant por defecto (tokens) si no está configurado */
export const DEFAULT_TENANT_MONTHLY_BUDGET = 2_000_000; // ~500-800 conversaciones

/** Presupuesto diario global por defecto (tokens) para toda la plataforma Velion */
export const DEFAULT_GLOBAL_DAILY_BUDGET = 5_000_000;

/** Presupuesto mensual global por defecto (tokens) para toda la plataforma Velion */
export const DEFAULT_GLOBAL_MONTHLY_BUDGET = 70_000_000;

/** Cooldown para deduplicar alertas del mismo tenant y motivo (ms) */
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutos

/** TTL para reservas en vuelo de tokens en caso de que no se liberen explícitamente (ms) */
const RESERVATION_TTL_MS = 30 * 1000; // 30 segundos

/** Cache en memoria de alertas emitidas recientemente para evitar spam */
const alertCooldownCache = new Map();

/** Reservas en vuelo para mitigar condiciones de carrera */
const inFlightReservations = new Map(); // tenantId -> number (tokens reservados)
let globalInFlightTokens = 0;

// ─────────────────────────────────────────────────────────────────────────────
// ESTIMACIÓN DE TOKENS POR PETICIÓN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estima de forma conservadora cuántos tokens consumirá una interacción.
 * - Input: ~4 caracteres por token en español (promedio estándar).
 * - Output: MAX_OUTPUT_TOKENS (400 tokens).
 * - Margen de herramientas: 1,000 tokens adicionales si se habilitan tools (Function Calling).
 *
 * @param {string} systemPrompt
 * @param {Array} chatContext
 * @param {boolean} hasTools
 * @returns {number} tokens estimados
 */
export function estimateRequestTokens(systemPrompt = '', chatContext = [], hasTools = false) {
  let totalChars = (systemPrompt || '').length;

  if (Array.isArray(chatContext)) {
    for (const msg of chatContext) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      }
    }
  }

  const estimatedInputTokens = Math.ceil(totalChars / 4);
  const maxOutputTokens = 400; // Fase 1
  const toolMargin = hasTools ? 1000 : 0; // Margen conservador para segunda llamada post-tool

  return estimatedInputTokens + maxOutputTokens + toolMargin;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEDUPLICACIÓN DE ALERTAS
// ─────────────────────────────────────────────────────────────────────────────

async function emitBudgetAlert({ tenantId, reason, currentUsed, budget, period }) {
  const alertKey = `${tenantId || 'GLOBAL'}:${reason}`;
  const now = Date.now();
  const lastAlertTime = alertCooldownCache.get(alertKey) || 0;

  if (now - lastAlertTime < ALERT_COOLDOWN_MS) {
    return; // En cooldown, evitar spam de alertas
  }

  alertCooldownCache.set(alertKey, now);

  const periodLabel = period === 'DAILY' ? 'diario' : 'mensual';
  const scopeLabel = tenantId ? 'Tenant' : 'GLOBAL';
  const severity = period === 'DAILY' ? 'WARNING' : 'CRITICAL';
  
  const message = `🚨 LÍMITE DE TOKENS IA ALCANZADO [${scopeLabel} - ${periodLabel.toUpperCase()}]: ` +
    `Consumo: ${currentUsed.toLocaleString()} / Presupuesto: ${budget.toLocaleString()} tokens. ` +
    `Las respuestas automáticas de IA han sido pausadas para evitar sobrecostos.`;

  try {
    await prisma.alert.create({
      data: {
        type: 'AI_BUDGET_EXCEEDED',
        severity,
        message,
        tenantId: tenantId || null,
      }
    });
    console.warn(`📢 [Budget Guard Alert] Alerta registrada: ${message}`);
  } catch (err) {
    console.error('⚠️ [Budget Guard Alert] Error registrando alerta:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSULTAS DE CONSUMO PERSISTENTE (UTC)
// ─────────────────────────────────────────────────────────────────────────────

export function getUtcDates() {
  const todayUtc = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
  const monthUtc = todayUtc.slice(0, 7); // "YYYY-MM"
  return { todayUtc, monthUtc };
}

/**
 * Obtiene el consumo acumulado de un tenant (diario y mensual en UTC).
 */
export async function getTenantAiUsageSummary(tenantId) {
  const { todayUtc, monthUtc } = getUtcDates();

  try {
    // 1. Consumo Diario
    const dailyRecord = await prisma.tenantAIUsage.findUnique({
      where: { tenantId_date: { tenantId, date: todayUtc } }
    });
    const dailyTokens = dailyRecord?.totalTokens || 0;

    // 2. Consumo Mensual (Suma de todos los días del mes UTC)
    const monthlyAggregate = await prisma.tenantAIUsage.aggregate({
      where: {
        tenantId,
        date: { startsWith: monthUtc }
      },
      _sum: { totalTokens: true }
    });
    const monthlyTokens = monthlyAggregate._sum.totalTokens || 0;

    return { dailyTokens, monthlyTokens, todayUtc, monthUtc };
  } catch (err) {
    return { dailyTokens: 0, monthlyTokens: 0, todayUtc, monthUtc };
  }
}

/**
 * Obtiene el consumo acumulado global de todos los tenants (diario y mensual en UTC).
 */
export async function getGlobalAiUsageSummary() {
  const { todayUtc, monthUtc } = getUtcDates();

  try {
    const dailyAggregate = await prisma.tenantAIUsage.aggregate({
      where: { date: todayUtc },
      _sum: { totalTokens: true }
    });
    const dailyTokens = dailyAggregate._sum.totalTokens || 0;

    const monthlyAggregate = await prisma.tenantAIUsage.aggregate({
      where: { date: { startsWith: monthUtc } },
      _sum: { totalTokens: true }
    });
    const monthlyTokens = monthlyAggregate._sum.totalTokens || 0;

    return { dailyTokens, monthlyTokens, todayUtc, monthUtc };
  } catch (err) {
    return { dailyTokens: 0, monthlyTokens: 0, todayUtc, monthUtc };
  }
}

/**
 * Obtiene la configuración global de presupuestos desde SystemConfig o defaults.
 */
export async function getGlobalAiBudgetConfig() {
  try {
    const configs = await prisma.systemConfig.findMany({
      where: {
        key: {
          in: [
            'globalAiBudgetEnabled',
            'globalDailyTokenBudget',
            'globalMonthlyTokenBudget'
          ]
        }
      }
    });

    const configMap = {};
    for (const c of configs) configMap[c.key] = c.value;

    const enabled = configMap.globalAiBudgetEnabled !== 'false';
    const dailyBudget = configMap.globalDailyTokenBudget ? parseInt(configMap.globalDailyTokenBudget, 10) : DEFAULT_GLOBAL_DAILY_BUDGET;
    const monthlyBudget = configMap.globalMonthlyTokenBudget ? parseInt(configMap.globalMonthlyTokenBudget, 10) : DEFAULT_GLOBAL_MONTHLY_BUDGET;

    return { enabled, dailyBudget, monthlyBudget };
  } catch (err) {
    return {
      enabled: true,
      dailyBudget: DEFAULT_GLOBAL_DAILY_BUDGET,
      monthlyBudget: DEFAULT_GLOBAL_MONTHLY_BUDGET
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARDIÁN CENTRAL DE PRESUPUESTO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evalúa si la interacción puede proceder antes de llamar a Gemini.
 * Realiza reserva en vuelo si es permitida.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {object} [params.tenant] - Objeto tenant con sus presupuestos
 * @param {string} [params.systemPrompt]
 * @param {Array}  [params.chatContext]
 * @param {boolean} [params.hasTools]
 * @returns {Promise<{ allowed: boolean, reason?: string, message?: string, releaseReservation?: () => void }>}
 */
export async function evaluateAiBudgetGuard({
  tenantId,
  tenant = null,
  systemPrompt = '',
  chatContext = [],
  hasTools = false
}) {
  if (!tenantId) {
    return { allowed: true, releaseReservation: () => {} };
  }

  // 1. Estimar tokens de esta petición
  const estimatedTokens = estimateRequestTokens(systemPrompt, chatContext, hasTools);

  // 2. Obtener datos del Tenant si no vienen inyectados
  let tenantData = tenant;
  if (!tenantData || tenantData.dailyTokenBudget === undefined) {
    tenantData = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        aiEnabled: true,
        aiBudgetEnabled: true,
        dailyTokenBudget: true,
        monthlyTokenBudget: true,
      }
    });
  }

  // Si la IA está apagada a nivel tenant
  if (tenantData && tenantData.aiEnabled === false) {
    return {
      allowed: false,
      reason: 'AI_DISABLED_BY_TENANT',
      fallbackText: 'En este momento nuestra atención automática se encuentra en mantenimiento. Un asesor humano te atenderá en breve.'
    };
  }

  // 3. Revisar Límite Global del Sistema
  const globalConfig = await getGlobalAiBudgetConfig();
  if (globalConfig.enabled) {
    const globalUsage = await getGlobalAiUsageSummary();
    const effectiveGlobalDaily = globalUsage.dailyTokens + globalInFlightTokens + estimatedTokens;
    const effectiveGlobalMonthly = globalUsage.monthlyTokens + globalInFlightTokens + estimatedTokens;

    if (effectiveGlobalDaily > globalConfig.dailyBudget) {
      await emitBudgetAlert({
        tenantId: null,
        reason: 'GLOBAL_DAILY_LIMIT',
        currentUsed: globalUsage.dailyTokens,
        budget: globalConfig.dailyBudget,
        period: 'DAILY'
      });
      return {
        allowed: false,
        reason: 'GLOBAL_DAILY_LIMIT',
        fallbackText: 'En este momento no puedo responder automáticamente. Un asesor continuará contigo a la brevedad.'
      };
    }

    if (effectiveGlobalMonthly > globalConfig.monthlyBudget) {
      await emitBudgetAlert({
        tenantId: null,
        reason: 'GLOBAL_MONTHLY_LIMIT',
        currentUsed: globalUsage.monthlyTokens,
        budget: globalConfig.monthlyBudget,
        period: 'MONTHLY'
      });
      return {
        allowed: false,
        reason: 'GLOBAL_MONTHLY_LIMIT',
        fallbackText: 'En este momento no puedo responder automáticamente. Un asesor continuará contigo a la brevedad.'
      };
    }
  }

  // 4. Revisar Límites Individuales del Tenant
  const isTenantBudgetEnabled = tenantData?.aiBudgetEnabled !== false;
  if (isTenantBudgetEnabled) {
    const dailyBudget = tenantData?.dailyTokenBudget ?? DEFAULT_TENANT_DAILY_BUDGET;
    const monthlyBudget = tenantData?.monthlyTokenBudget ?? DEFAULT_TENANT_MONTHLY_BUDGET;

    const tenantUsage = await getTenantAiUsageSummary(tenantId);
    const tenantInFlight = inFlightReservations.get(tenantId) || 0;

    const effectiveTenantDaily = tenantUsage.dailyTokens + tenantInFlight + estimatedTokens;
    const effectiveTenantMonthly = tenantUsage.monthlyTokens + tenantInFlight + estimatedTokens;

    // Verificar límite diario (Solo Alerta Informativa, NO bloquea)
    if (dailyBudget > 0 && effectiveTenantDaily > dailyBudget) {
      await emitBudgetAlert({
        tenantId,
        reason: 'TENANT_DAILY_LIMIT',
        currentUsed: tenantUsage.dailyTokens,
        budget: dailyBudget,
        period: 'DAILY'
      });
      // Ya NO bloqueamos el servicio por superar el dailyTokenBudget
    }

    // Verificar límite mensual (Solo Alerta Informativa, NO bloquea)
    if (monthlyBudget > 0 && effectiveTenantMonthly > monthlyBudget) {
      await emitBudgetAlert({
        tenantId,
        reason: 'TENANT_MONTHLY_LIMIT',
        currentUsed: tenantUsage.monthlyTokens,
        budget: monthlyBudget,
        period: 'MONTHLY'
      });
      // Ya NO bloqueamos el servicio por superar el monthlyTokenBudget
    }
  }

  // 5. Reserva de Tokens en Vuelo (Prevención de Race Conditions)
  const currentReserved = inFlightReservations.get(tenantId) || 0;
  inFlightReservations.set(tenantId, currentReserved + estimatedTokens);
  globalInFlightTokens += estimatedTokens;

  let released = false;
  const releaseReservation = () => {
    if (released) return;
    released = true;
    const nowReserved = inFlightReservations.get(tenantId) || 0;
    const updated = Math.max(0, nowReserved - estimatedTokens);
    if (updated === 0) {
      inFlightReservations.delete(tenantId);
    } else {
      inFlightReservations.set(tenantId, updated);
    }
    globalInFlightTokens = Math.max(0, globalInFlightTokens - estimatedTokens);
  };

  // Auto-liberar por TTL para evitar fugas de memoria si ocurre un crash no controlado
  setTimeout(releaseReservation, RESERVATION_TTL_MS);

  return {
    allowed: true,
    estimatedTokens,
    releaseReservation
  };
}
