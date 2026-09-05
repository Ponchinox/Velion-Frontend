import { Prisma } from '@prisma/client';
import prisma from '../db.js';
import { generateAIResponse } from './aiService.js';
import { evaluateAiBudgetGuard } from './aiBudgetGuardService.js';
import { sendText as gatewaySendText, sendMedia as gatewaySendMedia, resolveGatewayCtx } from './whatsappGateway.js';
import { HUMAN_HANDOFF_MS } from './humanHandoffService.js';

/**
 * CAMPAIGN WORKER V2 — Motor persistente y reanudable de campañas masivas (Fase A).
 *
 * Características Core:
 * - Pre-creación de CampaignLog 'pending' con occurrenceKey determinística (imm_${id} o occ_${iso}).
 * - Reclamación atómica pending -> processing vía FOR UPDATE SKIP LOCKED.
 * - Scheduler persistente en PostgreSQL con FOR UPDATE SKIP LOCKED (cero timers volátiles).
 * - Cero Recurrence Drift: lastRunAt se fija como COALESCE(nextRunAt, NOW()) al reclamar.
 * - Recurrencia determinística (NONE, EVERY_15_DAYS, MONTHLY con preservación de anchorDay).
 * - Recovery seguro de logs huérfanos con ventana stale (> 5 minutos) y soporte de registros legacy (claimedAt = null).
 * - Reconstrucción idempotente en reinicios/crash: createMany con skipDuplicates sobre la audiencia completa.
 * - Validación estricta del contrato de WhatsApp Gateway (msgId string no vacío).
 */

const PAUSE_BACKOFF_MS = 30000;
const MAX_PAUSE_RETRIES = 3;
const RESUME_TICK_MS = 60000;
const SCHEDULER_TICK_MS = 30000;
export const STALE_PROCESSING_MS = 5 * 60 * 1000; // 5 minutos

// Guardia en memoria: evita lanzar dos loops concurrentes para la misma campaña
// dentro del mismo proceso (la exclusión mutua real entre procesos la da SKIP LOCKED).
const activeWorkers = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Función pura exportable para calcular la siguiente fecha de ejecución.
 * - NONE: null
 * - EVERY_15_DAYS: fecha base + 15 días en UTC (conserva hora/minuto/segundo)
 * - MONTHLY: siguiente mes calendario preservando anchorDay original en UTC (ej. 31 ene -> 28 feb -> 31 mar).
 */
export function calculateNextRun({ recurrenceType, fromDate, anchorDay }) {
  if (!fromDate) return null;
  const base = new Date(fromDate);
  if (isNaN(base.getTime())) return null;

  if (recurrenceType === 'NONE' || !recurrenceType) {
    return null;
  }

  if (recurrenceType === 'EVERY_15_DAYS') {
    const next = new Date(base.getTime());
    next.setUTCDate(next.getUTCDate() + 15);
    return next;
  }

  if (recurrenceType === 'MONTHLY') {
    const day = typeof anchorDay === 'number' && anchorDay >= 1 && anchorDay <= 31
      ? anchorDay
      : base.getUTCDate();

    const currentYear = base.getUTCFullYear();
    const currentMonth = base.getUTCMonth(); // 0-11

    const targetYear = currentMonth === 11 ? currentYear + 1 : currentYear;
    const targetMonth = (currentMonth + 1) % 12;

    // Último día válido del mes objetivo (día 0 del mes siguiente en UTC)
    const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    const safeDay = Math.min(day, lastDayOfTargetMonth);

    return new Date(Date.UTC(
      targetYear,
      targetMonth,
      safeDay,
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds()
    ));
  }

  return null;
}

/**
 * Clasifica un destino de campaña. Los JIDs (@lid, @s.whatsapp.net) son elegibles
 * porque el gateway actual (whatsappGateway.js) ya sabe rutearlos sin normalizar.
 * Los grupos (@g.us) y los teléfonos con longitud fuera de rango se excluyen.
 */
function classifyDestination(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return { eligible: false };
  if (raw.includes('@g.us')) return { eligible: false };
  const isJid = raw.includes('@lid') || raw.includes('@s.whatsapp.net');
  if (isJid) return { eligible: true };
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return { eligible: false };
  return { eligible: true };
}

/**
 * Clave de deduplicación consistente con la normalización usada por el gateway actual.
 */
function computeDedupKey(phone) {
  const raw = String(phone || '').trim();
  if (raw.includes('@lid') || raw.includes('@s.whatsapp.net')) return raw;
  return raw.replace(/\D/g, '');
}

function stableVariationIndex(key, mod) {
  let hash = 0;
  const str = String(key || '');
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return mod > 0 ? hash % mod : 0;
}

/**
 * Determina si un Contact está actualmente dentro de la ventana de Human Handoff (30 min).
 * Replica la lógica de whatsappController.js sin tocar ese archivo.
 */
async function isContactCurrentlyPaused(tenantId, contact) {
  if (!contact || !contact.botPaused) return false;

  const cleanPhone = contact.phone.includes('@lid') || contact.phone.includes('@s.whatsapp.net')
    ? contact.phone.trim()
    : contact.phone.replace(/\D/g, '');

  const customer = await prisma.customer.findFirst({
    where: {
      tenantId,
      OR: [
        { phone: contact.phone },
        { phone: { contains: cleanPhone } }
      ]
    }
  });

  const lastInterventionIso = (customer && typeof customer.persistentProfile === 'object' && customer.persistentProfile !== null)
    ? customer.persistentProfile.lastHumanInterventionAt
    : null;

  const lastActivityDate = lastInterventionIso ? new Date(lastInterventionIso) : (contact.updatedAt || new Date(0));
  const elapsedMs = Date.now() - new Date(lastActivityDate).getTime();

  return elapsedMs < HUMAN_HANDOFF_MS;
}

/**
 * Resuelve el conjunto de teléfonos actualmente en pausa (Human Handoff vigente) dentro
 * de un tenant, restringido a los destinos indicados.
 */
async function getPausedPhones(tenantId, phones) {
  const paused = new Set();
  if (!phones.length) return paused;

  const contacts = await prisma.contact.findMany({
    where: { tenantId, phone: { in: phones }, botPaused: true }
  });

  for (const contact of contacts) {
    if (await isContactCurrentlyPaused(tenantId, contact)) {
      paused.add(contact.phone);
    }
  }

  return paused;
}

/**
 * Resuelve audiencia (all | manual) revalidando siempre contra el tenant actual,
 * deduplica por destino normalizado y descarta destinos no ruteables.
 */
export async function resolveEligibleContacts({ tenantId, audience, contactIds }) {
  let contacts = [];

  const isManual = audience === 'manual' || Array.isArray(audience) || Array.isArray(contactIds);
  if (isManual) {
    const rawIds = Array.isArray(contactIds) ? contactIds : (Array.isArray(audience) ? audience : []);
    const ids = rawIds.filter((id) => typeof id === 'string' && id);
    if (ids.length > 0) {
      contacts = await prisma.contact.findMany({ where: { id: { in: ids }, tenantId } });
    }
  } else {
    contacts = await prisma.contact.findMany({ where: { tenantId } });
  }

  const seen = new Set();
  const eligible = [];
  for (const contact of contacts) {
    const classification = classifyDestination(contact.phone);
    if (!classification.eligible) continue;
    const dedupKey = computeDedupKey(contact.phone);
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    eligible.push(contact);
  }

  return { totalContacts: contacts.length, eligibleContacts: eligible };
}

/**
 * Crea la Campaign. Si es programada a futuro, guarda scheduled sin pre-crear logs aún.
 * Si es inmediata, pre-crea logs 'pending' con occurrenceKey determinística (imm_${id}) y deja status 'running'.
 */
export async function launchCampaignV2({
  tenantId,
  name,
  baseMessage,
  media,
  delayMin,
  delayMax,
  audience,
  audienceType,
  contactIds,
  scheduledAt,
  recurrenceType
}) {
  const normAudienceType = audienceType || (Array.isArray(audience) || audience === 'manual' || Array.isArray(contactIds) ? 'manual' : 'all');
  const normRecurrence = recurrenceType || 'NONE';
  const targetIds = Array.isArray(contactIds) ? contactIds : (Array.isArray(audience) ? audience : null);

  let isScheduledFuture = false;
  let scheduledDate = null;
  let anchorDay = null;

  if (scheduledAt) {
    scheduledDate = new Date(scheduledAt);
    if (!isNaN(scheduledDate.getTime()) && scheduledDate.getTime() > Date.now()) {
      isScheduledFuture = true;
      anchorDay = scheduledDate.getUTCDate();
    }
  }

  if (isScheduledFuture) {
    // Campaña programada a futuro: No se crean logs hoy para evitar envíos anticipados
    const campaign = await prisma.campaign.create({
      data: {
        name,
        baseMessage,
        media: media || null,
        delayMin,
        delayMax,
        status: 'scheduled',
        scheduledAt: scheduledDate,
        nextRunAt: scheduledDate,
        anchorDay,
        recurrenceType: normRecurrence,
        audienceType: normAudienceType,
        targetContactIds: targetIds,
        tenantId
      }
    });

    return { campaign, totalContacts: 0, eligibleCount: 0, scheduled: true };
  }

  // Campaña inmediata:
  const now = new Date();
  anchorDay = now.getUTCDate();

  const campaign = await prisma.campaign.create({
    data: {
      name,
      baseMessage,
      media: media || null,
      delayMin,
      delayMax,
      status: 'running',
      scheduledAt: scheduledDate,
      lastRunAt: now,
      anchorDay,
      recurrenceType: normRecurrence,
      audienceType: normAudienceType,
      targetContactIds: targetIds,
      tenantId
    }
  });

  // Clave determinística fija dependiente del ID de campaña (nunca de Date.now() en RAM)
  const occurrenceKey = `imm_${campaign.id}`;

  const { totalContacts, eligibleContacts } = await resolveEligibleContacts({
    tenantId,
    audience: normAudienceType,
    contactIds: targetIds
  });

  if (eligibleContacts.length === 0) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'completed' } });
    return { campaign: { ...campaign, status: 'completed' }, totalContacts, eligibleCount: 0, scheduled: false };
  }

  await prisma.campaignLog.createMany({
    data: eligibleContacts.map((contact) => ({
      campaignId: campaign.id,
      customerPhone: contact.phone,
      status: 'pending',
      sentMessage: '',
      occurrenceKey
    })),
    skipDuplicates: true
  });

  return { campaign, totalContacts, eligibleCount: eligibleContacts.length, scheduled: false };
}

/**
 * Genera las 3 variaciones IA del mensaje base si aplica y el presupuesto lo permite.
 * Para recordatorios sin IA, retorna directamente [baseMessage].
 */
async function generateCampaignVariations(campaign, tenant) {
  const sysPrompt = 'Eres un redactor de marketing persuasivo y experto en WhatsApp. Genera exactamente 3 variaciones naturales, frescas y atractivas del mensaje base proporcionado. Mantén la intención comercial intacta. Usa SIEMPRE la etiqueta [Nombre] donde iría el nombre del cliente. Separa las 3 variaciones usando exactamente esta cadena: "|||". NO agregues viñetas, números, ni saludos adicionales al inicio.';
  const userPrompt = `Mensaje base a reescribir:\n${campaign.baseMessage}`;

  let variations = [campaign.baseMessage];

  if (tenant?.aiEnabled !== false && tenant?.aiBudgetEnabled !== false) {
    const budgetGuard = await evaluateAiBudgetGuard({
      tenantId: tenant.id,
      tenant,
      systemPrompt: sysPrompt,
      chatContext: [{ role: 'user', content: userPrompt }],
      hasTools: false
    });

    if (budgetGuard.allowed) {
      try {
        const aiResponse = await generateAIResponse(
          sysPrompt,
          [{ role: 'user', content: userPrompt }],
          [], null, null, [], null, tenant.id
        );
        if (aiResponse && aiResponse.includes('|||')) {
          const splitVars = aiResponse.split('|||').map((v) => v.trim()).filter((v) => v.length > 0);
          if (splitVars.length > 0) {
            variations = splitVars;
          }
        } else if (aiResponse) {
          variations = [aiResponse.trim()];
        }
      } catch (aiError) {
        console.error('⚠️ [Campaign Worker V2] Error generando variaciones con IA:', aiError.message);
      } finally {
        if (budgetGuard.releaseReservation) budgetGuard.releaseReservation();
      }
    } else {
      console.warn(`🛡️ [Campaign Worker V2] Budget Guard bloqueó la IA para la campaña. Motivo: ${budgetGuard.reason}`);
    }
  }

  return variations;
}

/**
 * Reclamación atómica de un CampaignLog pending -> processing usando
 * FOR UPDATE SKIP LOCKED, fijando claimedAt = NOW() para control de stale.
 */
export async function claimNextLog(campaignId, tenantId) {
  const pendingRows = await prisma.campaignLog.findMany({
    where: { campaignId, status: 'pending' },
    distinct: ['customerPhone'],
    select: { customerPhone: true }
  });
  const pausedPhones = await getPausedPhones(tenantId, pendingRows.map((r) => r.customerPhone));

  let rows;
  if (pausedPhones.size > 0) {
    rows = await prisma.$queryRaw`
      WITH candidate AS (
        SELECT id FROM "CampaignLog"
        WHERE "campaignId" = ${campaignId}
          AND status = 'pending'
          AND "customerPhone" NOT IN (${Prisma.join(Array.from(pausedPhones))})
        ORDER BY id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "CampaignLog" 
      SET status = 'processing',
          "claimedAt" = NOW()
      WHERE id IN (SELECT id FROM candidate)
      RETURNING *;
    `;
  } else {
    rows = await prisma.$queryRaw`
      WITH candidate AS (
        SELECT id FROM "CampaignLog"
        WHERE "campaignId" = ${campaignId}
          AND status = 'pending'
        ORDER BY id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "CampaignLog" 
      SET status = 'processing',
          "claimedAt" = NOW()
      WHERE id IN (SELECT id FROM candidate)
      RETURNING *;
    `;
  }

  return rows[0] || null;
}

/**
 * Aplica el resultado del envío al CampaignLog reclamado: processing -> sent/failed.
 */
export async function applySendResult(logId, { success, message, errorMsg }) {
  await prisma.campaignLog.update({
    where: { id: logId },
    data: {
      status: success ? 'sent' : 'failed',
      sentMessage: message,
      sentAt: new Date(),
      errorMessage: success ? null : (typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg))
    }
  });
}

/**
 * Envía el log reclamado mediante el gateway activo (Evolution/Meta).
 * REGLA ESTRICTA: Solo un msgId (string no vacío) confirma el envío.
 * Si el gateway retorna null, undefined o empty string => status: failed. JAMÁS sent.
 */
export async function sendClaimedLog(log, campaign, gatewayCtx, variationText, contactName) {
  const personalizedMessage = variationText
    .replace(/\[Nombre\]/gi, contactName || 'amigo')
    .replace(/\{Nombre\}/gi, contactName || 'amigo');

  let success = false;
  let errorMsg = null;

  try {
    let msgId = null;
    if (campaign.media) {
      msgId = await gatewaySendMedia({
        ...gatewayCtx,
        to: log.customerPhone,
        url: campaign.media,
        caption: personalizedMessage,
        isAutomated: true,
        origin: 'campaign'
      });
    } else {
      msgId = await gatewaySendText({
        ...gatewayCtx,
        to: log.customerPhone,
        text: personalizedMessage,
        isAutomated: true,
        origin: 'campaign'
      });
    }

    if (typeof msgId === 'string' && msgId.trim().length > 0) {
      success = true;
    } else {
      success = false;
      errorMsg = 'El proveedor de WhatsApp no devolvió un identificador de mensaje válido (envío no confirmado).';
    }
  } catch (sendError) {
    success = false;
    errorMsg = sendError.response?.data?.message || sendError.message || 'Error de transporte en WhatsApp Gateway.';
  }

  await applySendResult(log.id, { success, message: personalizedMessage, errorMsg });

  return success;
}

/**
 * Loop principal de despacho de una campaña en ejecución.
 * Al terminar:
 * - Si es recurrente (EVERY_15_DAYS o MONTHLY): calcula nextRunAt a partir de lastRunAt programado y pasa a 'scheduled'.
 * - Si es de una sola vez (NONE): pasa a 'completed'.
 */
export async function runCampaignWorker(campaignId) {
  if (activeWorkers.has(campaignId)) return;
  activeWorkers.add(campaignId);

  try {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.status !== 'running') return;

    const tenant = await prisma.tenant.findUnique({ where: { id: campaign.tenantId } });
    if (!tenant) return;

    const gatewayCtx = await resolveGatewayCtx(campaign.tenantId);
    const variations = await generateCampaignVariations(campaign, tenant);

    let pauseRetries = 0;

    while (true) {
      const current = await prisma.campaign.findUnique({ where: { id: campaignId } });
      if (!current || current.status !== 'running') break;

      const claimed = await claimNextLog(campaignId, campaign.tenantId);

      if (!claimed) {
        const [pendingCount, processingCount] = await Promise.all([
          prisma.campaignLog.count({ where: { campaignId, status: 'pending' } }),
          prisma.campaignLog.count({ where: { campaignId, status: 'processing' } })
        ]);

        if (pendingCount === 0 && processingCount === 0) {
          // Finalización del lote actual
          if (current.recurrenceType && current.recurrenceType !== 'NONE') {
            const nextRun = calculateNextRun({
              recurrenceType: current.recurrenceType,
              fromDate: current.lastRunAt || new Date(),
              anchorDay: current.anchorDay
            });
            await prisma.campaign.update({
              where: { id: campaignId },
              data: {
                status: 'scheduled',
                nextRunAt: nextRun
              }
            });
            console.log(`🔁 [Campaign Worker V2] Campaña recurrente ${campaignId} reprogramada para ${nextRun?.toISOString()}`);
          } else {
            await prisma.campaign.update({
              where: { id: campaignId },
              data: { status: 'completed' }
            });
          }
          break;
        }

        // Quedan pending aplazados por Human Handoff (o en proceso por otro worker).
        pauseRetries++;
        if (pauseRetries > MAX_PAUSE_RETRIES) break;
        await sleep(PAUSE_BACKOFF_MS);
        continue;
      }

      pauseRetries = 0;

      const contact = await prisma.contact.findFirst({
        where: { tenantId: campaign.tenantId, phone: claimed.customerPhone }
      });
      const variationIndex = stableVariationIndex(claimed.customerPhone, variations.length);
      await sendClaimedLog(claimed, campaign, gatewayCtx, variations[variationIndex], contact?.name);

      const delayMs = Math.floor(Math.random() * (campaign.delayMax - campaign.delayMin + 1) + campaign.delayMin) * 1000;
      await sleep(delayMs);
    }
  } catch (error) {
    console.error(`❌ [Campaign Worker V2] Error crítico procesando la campaña ${campaignId}:`, error);
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'failed' } }).catch(() => {});
  } finally {
    activeWorkers.delete(campaignId);
  }
}

/**
 * Recovery seguro de logs processing huérfanos.
 * REGLA ESTRICTA:
 * - Solo recupera registros en 'processing'.
 * - Recupera los que lleven MÁS DE 5 MINUTOS (claimedAt < staleCutoff)
 * - O aquellos legacy cuyo claimedAt sea NULL (registros processing heredados).
 * - NUNCA toca registros pending, sent o failed con claimedAt null.
 */
export async function recoverOrphanedProcessing() {
  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MS);
  const result = await prisma.campaignLog.updateMany({
    where: {
      status: 'processing',
      OR: [
        { claimedAt: { lt: staleCutoff } },
        { claimedAt: null }
      ]
    },
    data: {
      status: 'failed',
      errorMessage: 'Worker interrupted during send; stale processing threshold (5m) exceeded or legacy processing'
    }
  });
  if (result.count > 0) {
    console.log(`♻️ [Campaign Worker V2] Recovery: ${result.count} log(s) 'processing' huérfanos (>5 min o legacy) marcados como 'failed'.`);
  }
  return result.count;
}

/**
 * Scheduler persistente en PostgreSQL:
 * Busca campañas con status = 'scheduled' y nextRunAt <= NOW().
 * Reclamación atómica con FOR UPDATE SKIP LOCKED.
 * CERO DRIFT: fija lastRunAt = COALESCE(nextRunAt, NOW()), preservando la hora/minuto programada.
 * Deriva occurrenceKey a partir de lastRunAt persistido (occ_${iso}).
 */
export async function dispatchDueCampaigns() {
  const claimedCampaigns = await prisma.$queryRaw`
    WITH candidate AS (
      SELECT id FROM "Campaign"
      WHERE status = 'scheduled'
        AND "nextRunAt" <= NOW()
      ORDER BY "nextRunAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "Campaign"
    SET status = 'running',
        "lastRunAt" = COALESCE("nextRunAt", NOW())
    WHERE id IN (SELECT id FROM candidate)
    RETURNING *;
  `;

  const campaign = claimedCampaigns[0];
  if (!campaign) return null;

  try {
    const occurrenceDate = campaign.lastRunAt || new Date();
    const occurrenceKey = `occ_${new Date(occurrenceDate).toISOString()}`;

    const { eligibleContacts } = await resolveEligibleContacts({
      tenantId: campaign.tenantId,
      audience: campaign.audienceType,
      contactIds: campaign.targetContactIds
    });

    if (eligibleContacts.length > 0) {
      await prisma.campaignLog.createMany({
        data: eligibleContacts.map((contact) => ({
          campaignId: campaign.id,
          customerPhone: contact.phone,
          status: 'pending',
          sentMessage: '',
          occurrenceKey
        })),
        skipDuplicates: true
      });
    }

    runCampaignWorker(campaign.id).catch((err) => {
      console.error(`❌ [Campaign Worker V2] Error ejecutando worker para campaña ${campaign.id}:`, err);
    });

    return campaign;
  } catch (err) {
    console.error(`❌ [Campaign Worker V2] Error despachando campaña programada ${campaign.id}:`, err);
    return null;
  }
}

/**
 * Reanuda campañas 'running' tras crash o reinicio.
 * Reconstrucción idempotente:
 * Resuelve la audiencia completa y ejecuta createMany con skipDuplicates.
 * Si ya se habían creado 10 de 100 logs, el unique constraint conserva los 10
 * y crea exactamente los 90 faltantes (total 100, 0 duplicados).
 * No depende de totalCount === 0.
 */
export async function resumeRunningCampaigns() {
  const campaigns = await prisma.campaign.findMany({
    where: { status: 'running' },
    select: {
      id: true,
      tenantId: true,
      audienceType: true,
      targetContactIds: true,
      scheduledAt: true,
      recurrenceType: true,
      lastRunAt: true,
      updatedAt: true
    }
  });

  let resumedCount = 0;

  for (const c of campaigns) {
    // Clave de ocurrencia determinística y consistente:
    const occurrenceKey = c.scheduledAt || (c.recurrenceType && c.recurrenceType !== 'NONE')
      ? `occ_${new Date(c.lastRunAt || c.updatedAt).toISOString()}`
      : `imm_${c.id}`;

    // Reconstrucción idempotente de logs faltantes
    const { eligibleContacts } = await resolveEligibleContacts({
      tenantId: c.tenantId,
      audience: c.audienceType,
      contactIds: c.targetContactIds
    });

    if (eligibleContacts.length > 0) {
      await prisma.campaignLog.createMany({
        data: eligibleContacts.map((contact) => ({
          campaignId: c.id,
          customerPhone: contact.phone,
          status: 'pending',
          sentMessage: '',
          occurrenceKey
        })),
        skipDuplicates: true
      });
    }

    const pendingCount = await prisma.campaignLog.count({
      where: { campaignId: c.id, status: 'pending' }
    });

    if (!activeWorkers.has(c.id) && pendingCount > 0) {
      resumedCount++;
      runCampaignWorker(c.id).catch((err) => {
        console.error(`❌ [Campaign Worker V2] Error reanudando campaña ${c.id}:`, err);
      });
    }
  }

  return resumedCount;
}

/**
 * Punto de entrada único al iniciar el servidor.
 */
export async function initCampaignWorkerV2() {
  await recoverOrphanedProcessing();
  await resumeRunningCampaigns();
  await dispatchDueCampaigns();

  setInterval(() => {
    resumeRunningCampaigns().catch(() => {});
  }, RESUME_TICK_MS);

  setInterval(() => {
    dispatchDueCampaigns().catch(() => {});
  }, SCHEDULER_TICK_MS);
}
