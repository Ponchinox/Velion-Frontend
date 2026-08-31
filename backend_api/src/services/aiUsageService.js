import prisma from '../db.js';

/**
 * aiUsageService.js — Medición Persistente de Consumo de Gemini por Tenant (Fase 2A)
 *
 * Responsabilidad:
 *   Registrar y acumular de forma atómica el consumo de tokens y llamadas a Gemini por Tenant y fecha UTC.
 *   - Garantiza máximo 1 registro por tenant por día (clave compuesta tenantId_date).
 *   - Utiliza explícitamente fecha UTC (YYYY-MM-DD) para evitar desfasajes entre servidores (Render / Hetzner).
 *   - No bloqueante: si falla la escritura en BD, loguea el error y permite que el bot continúe respondiendo.
 */

/**
 * Registra o incrementa el consumo de IA para un Tenant específico en fecha UTC.
 *
 * @param {object} params
 * @param {string} params.tenantId    - ID del tenant (obligatorio)
 * @param {number} [params.inputTokens=0]  - Tokens de entrada reportados por Gemini (usageMetadata)
 * @param {number} [params.outputTokens=0] - Tokens de salida reportados por Gemini (usageMetadata)
 * @param {number} [params.totalTokens=0]  - Tokens totales reportados por Gemini (usageMetadata)
 * @param {number} [params.requestCount=1] - Peticiones HTTP reales completadas con métricas
 * @param {number} [params.toolCalls=0]    - Herramientas (Function Calling) ejecutadas
 * @param {number} [params.retryCount=0]   - Reintentos ejecutados (incluso si fallaron por timeout)
 */
export async function recordTenantAiUsage({
  tenantId,
  inputTokens = 0,
  outputTokens = 0,
  totalTokens = 0,
  requestCount = 1,
  toolCalls = 0,
  retryCount = 0,
}) {
  if (!tenantId || typeof tenantId !== 'string') {
    console.warn('⚠️ [AI Usage] No se proporcionó tenantId para registrar consumo de IA.');
    return;
  }

  // ── 📅 FECHA DIARIA EN UTC EXPLÍCITO (YYYY-MM-DD) ──
  // Evita problemas de zona horaria entre entornos locales, Render y Hetzner
  const todayUtc = new Date().toISOString().split('T')[0];

  const inTok   = Math.max(0, parseInt(inputTokens, 10) || 0);
  const outTok  = Math.max(0, parseInt(outputTokens, 10) || 0);
  const totTok  = Math.max(0, parseInt(totalTokens, 10) || (inTok + outTok));
  const reqs    = Math.max(0, parseInt(requestCount, 10) || 0);
  const tools   = Math.max(0, parseInt(toolCalls, 10) || 0);
  const retries = Math.max(0, parseInt(retryCount, 10) || 0);

  try {
    const usage = await prisma.tenantAIUsage.upsert({
      where: {
        tenantId_date: {
          tenantId,
          date: todayUtc,
        },
      },
      create: {
        tenantId,
        date: todayUtc,
        requestCount: reqs,
        inputTokens:  inTok,
        outputTokens: outTok,
        totalTokens:  totTok,
        toolCalls:    tools,
        retryCount:   retries,
      },
      update: {
        requestCount: { increment: reqs },
        inputTokens:  { increment: inTok },
        outputTokens: { increment: outTok },
        totalTokens:  { increment: totTok },
        toolCalls:    { increment: tools },
        retryCount:   { increment: retries },
      },
    });

    console.log(
      `📊 [AI Usage] tenant=${tenantId.slice(0, 8)}... date=${todayUtc} (UTC) | ` +
      `+req=${reqs} +in=${inTok} +out=${outTok} +tot=${totTok} +tools=${tools} +retries=${retries} | ` +
      `Acumulado Día: reqs=${usage.requestCount} totTokens=${usage.totalTokens}`
    );

    return usage;
  } catch (err) {
    // ── REGLA CRÍTICA: NO BLOQUEAR EL BOT ──
    console.error(`❌ [AI Usage Error] Error no bloqueante al registrar métricas para tenant ${tenantId.slice(0, 8)}:`, err.message);
    return null;
  }
}
