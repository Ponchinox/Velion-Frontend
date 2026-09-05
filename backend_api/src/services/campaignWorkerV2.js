import { Prisma } from '@prisma/client';
import prisma from '../db.js';
import { sendText as gatewaySendText, sendMedia as gatewaySendMedia, resolveGatewayCtx } from './whatsappGateway.js';
import { HUMAN_HANDOFF_MS } from './humanHandoffService.js';

let customGatewaySender = null;

/**
 * Inyecta un mock handler para el WhatsApp Gateway durante tests.
 * Si está activo, sendClaimedLog delega en él y JAMÁS realiza llamadas externas.
 */
export function setCampaignGatewaySender(senderFn) {
  customGatewaySender = typeof senderFn === 'function' ? senderFn : null;
}

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
 * Clasifica un destino de campaña.
 * - Destinos vacíos o grupos (@g.us) se excluyen siempre.
 * - Destinos @lid explícitos y @s.whatsapp.net son elegibles.
 * - Números telefónicos estándar y E.164 de cualquier longitud válida (incluyendo 14 y 15 dígitos) son elegibles.
 * - Una cadena numérica solo se clasifica como LID huérfano si existe evidencia autoritativa en BD (${digits}@lid).
 * - Si no existe evidencia en BD, se clasifica como teléfono normal sin descartarlo por longitud.
 */
export function classifyDestination(phone, tenantLidSet = new Set()) {
  const raw = String(phone || '').trim();
  if (!raw) return { eligible: false, reason: 'empty' };
  if (raw.includes('@g.us')) return { eligible: false, reason: 'group' };

  if (raw.includes('@lid')) {
    return { eligible: true, type: 'lid', destination: raw };
  }

  if (raw.includes('@s.whatsapp.net')) {
    return { eligible: true, type: 'phone_jid', destination: raw };
  }

  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8) {
    return { eligible: false, reason: 'too_short' };
  }

  // Detección de LID numérico huérfano con evidencia autoritativa en BD
  const candidateLid = `${digits}@lid`;
  const isKnownLid = tenantLidSet instanceof Set
    ? tenantLidSet.has(candidateLid)
    : Array.isArray(tenantLidSet)
      ? tenantLidSet.includes(candidateLid)
      : false;

  if (isKnownLid) {
    return { eligible: true, type: 'resolved_lid', destination: candidateLid };
  }

  // Sin evidencia de LID: tratado de forma segura como teléfono normal (soporta E.164 14/15 dígitos)
  return { eligible: true, type: 'phone', destination: digits };
}

/**
 * Clave de deduplicación consistente con la normalización usada por el gateway actual.
 */
function computeDedupKey(phone) {
  const raw = String(phone || '').trim();
  if (raw.includes('@lid') || raw.includes('@s.whatsapp.net')) return raw;
  return raw.replace(/\D/g, '');
}

/**
 * Extrae la evidencia de identidad autoritativa existente en el tenant:
 * - LIDs explícitos conocidos
 * - Mapeos persistidos entre teléfono y LID (Customer.persistentProfile o Contact.tags)
 */
export async function getTenantIdentityEvidence(tenantId) {
  const tenantLidSet = new Set();
  const phoneToLidMap = new Map();
  const lidToPhoneMap = new Map();

  // 1. Evidencia en Contacts
  const contacts = await prisma.contact.findMany({
    where: { tenantId },
    select: { id: true, phone: true, tags: true }
  });

  for (const c of contacts) {
    const p = String(c.phone || '').trim();
    if (p.includes('@lid')) {
      tenantLidSet.add(p);
    }
    if (Array.isArray(c.tags)) {
      for (const tag of c.tags) {
        const lidMatch = String(tag).match(/^lid:(.+@lid)$/i);
        if (lidMatch) {
          const cleanP = p.replace(/\D/g, '');
          if (cleanP) {
            phoneToLidMap.set(cleanP, lidMatch[1].trim());
            lidToPhoneMap.set(lidMatch[1].trim(), cleanP);
          }
        }
        const phoneMatch = String(tag).match(/^phone:(\d+)$/i);
        if (phoneMatch && p.includes('@lid')) {
          phoneToLidMap.set(phoneMatch[1], p);
          lidToPhoneMap.set(p, phoneMatch[1]);
        }
      }
    }
  }

  // 2. Evidencia en Customers
  const customers = await prisma.customer.findMany({
    where: { tenantId },
    select: { id: true, phone: true, persistentProfile: true, tags: true }
  });

  for (const cust of customers) {
    const p = String(cust.phone || '').trim();
    if (p.includes('@lid')) {
      tenantLidSet.add(p);
    }
    const profile = (typeof cust.persistentProfile === 'object' && cust.persistentProfile !== null)
      ? cust.persistentProfile
      : null;

    if (profile) {
      if (profile.linkedLid && typeof profile.linkedLid === 'string') {
        const cleanP = p.replace(/\D/g, '');
        const cleanLid = profile.linkedLid.trim();
        if (cleanP && cleanLid.includes('@lid')) {
          phoneToLidMap.set(cleanP, cleanLid);
          lidToPhoneMap.set(cleanLid, cleanP);
          tenantLidSet.add(cleanLid);
        }
      }
      if (profile.linkedPhone && typeof profile.linkedPhone === 'string') {
        const cleanP = String(profile.linkedPhone).replace(/\D/g, '');
        const lid = p.includes('@lid') ? p : null;
        if (cleanP && lid) {
          phoneToLidMap.set(cleanP, lid);
          lidToPhoneMap.set(lid, cleanP);
        }
      }
    }

    if (Array.isArray(cust.tags)) {
      for (const tag of cust.tags) {
        const lidMatch = String(tag).match(/^lid:(.+@lid)$/i);
        if (lidMatch) {
          const cleanP = p.replace(/\D/g, '');
          if (cleanP) {
            phoneToLidMap.set(cleanP, lidMatch[1].trim());
            lidToPhoneMap.set(lidMatch[1].trim(), cleanP);
          }
        }
        const phoneMatch = String(tag).match(/^phone:(\d+)$/i);
        if (phoneMatch && p.includes('@lid')) {
          phoneToLidMap.set(phoneMatch[1], p);
          lidToPhoneMap.set(p, phoneMatch[1]);
        }
      }
    }
  }

  return { tenantLidSet, phoneToLidMap, lidToPhoneMap };
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
 * Resuelve audiencia (all | manual) revalidando siempre contra el tenant actual.
 * DEDUPLICACIÓN POR IDENTIDAD REAL AUTORITATIVA:
 * - NO se deduplica por nombre: dos contactos con mismo nombre pueden ser personas distintas.
 * - La equivalencia phone <-> LID se basa ÚNICAMENTE en relaciones autoritativas en BD.
 * - Si existe mapping real entre phone y @lid, se PRIORIZA el phone E.164.
 * - Máximo 1 CampaignLog por persona física autoritativa por occurrence.
 */
export async function resolveEligibleContacts({ tenantId, audience, contactIds, identityEvidence = null }) {
  let candidateContacts = [];

  const isManual = audience === 'manual' || Array.isArray(audience) || Array.isArray(contactIds);
  if (isManual) {
    const rawIds = Array.isArray(contactIds) ? contactIds : (Array.isArray(audience) ? audience : []);
    const ids = rawIds.filter((id) => typeof id === 'string' && id);
    if (ids.length > 0) {
      candidateContacts = await prisma.contact.findMany({ where: { id: { in: ids }, tenantId } });
    }
  } else {
    candidateContacts = await prisma.contact.findMany({ where: { tenantId } });
  }

  if (candidateContacts.length === 0) {
    return { totalContacts: 0, eligibleContacts: [] };
  }

  // 1. Obtener evidencia autoritativa de BD (LIDs conocidos y relaciones persistidas)
  const { tenantLidSet, phoneToLidMap, lidToPhoneMap } = identityEvidence || await getTenantIdentityEvidence(tenantId);

  // 2. Clasificar cada contacto candidato
  const classifiedList = [];
  for (const contact of candidateContacts) {
    const classification = classifyDestination(contact.phone, tenantLidSet);
    if (!classification.eligible) continue;
    classifiedList.push({
      contact,
      destination: classification.destination,
      type: classification.type
    });
  }

  // 3. Deduplicación por Identidad Real Autoritativa
  const phoneItems = classifiedList.filter((i) => i.type === 'phone' || i.type === 'phone_jid');
  const lidItems = classifiedList.filter((i) => i.type === 'lid' || i.type === 'resolved_lid');

  const seenDestinations = new Set();
  const coveredLids = new Set();
  const eligible = [];

  // A. Primero procesamos teléfonos estándar (preferencia universal E.164)
  for (const item of phoneItems) {
    const destKey = item.destination.replace(/\D/g, '');
    if (seenDestinations.has(destKey)) continue;
    seenDestinations.add(destKey);

    // Si este teléfono tiene un @lid equivalente autoritativo, marcar dicho @lid como cubierto
    if (phoneToLidMap && phoneToLidMap.has(destKey)) {
      coveredLids.add(phoneToLidMap.get(destKey));
    }

    eligible.push({
      ...item.contact,
      phone: item.destination
    });
  }

  // B. Luego procesamos @lid solo si no está cubierto por un teléfono real en la campaña
  for (const item of lidItems) {
    const destKey = item.destination;
    if (seenDestinations.has(destKey)) continue;

    // Si ya existe un envío telefónico para esta misma persona física autoritativa, omitir @lid
    if (coveredLids.has(destKey)) {
      continue;
    }
    if (lidToPhoneMap && lidToPhoneMap.has(destKey)) {
      const mappedPhone = lidToPhoneMap.get(destKey);
      if (seenDestinations.has(mappedPhone)) {
        continue;
      }
    }

    seenDestinations.add(destKey);
    eligible.push({
      ...item.contact,
      phone: item.destination
    });
  }

  return { totalContacts: candidateContacts.length, eligibleContacts: eligible };
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
  const finalDelayMin = delayMin !== undefined ? Number(delayMin) : 10;
  const finalDelayMax = delayMax !== undefined ? Number(delayMax) : 20;

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
        delayMin: finalDelayMin,
        delayMax: finalDelayMax,
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
      delayMin: finalDelayMin,
      delayMax: finalDelayMax,
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
 * Envía el log reclamado mediante el gateway activo (Evolution/Meta) o el mock inyectado.
 * CAMPAIGNS 100% DETERMINÍSTICO:
 * - El mensaje base se entrega de forma literal.
 * - Únicamente se reemplazan los placeholders {Nombre} y [Nombre].
 * - REGLA ESTRICTA: Solo un msgId (string no vacío) confirma el envío.
 */
export async function sendClaimedLog(log, campaign, gatewayCtx, rawMessageText, contactName) {
  const baseText = rawMessageText || campaign.baseMessage || '';
  const personalizedMessage = baseText
    .replace(/\[Nombre\]/gi, contactName || 'amigo')
    .replace(/\{Nombre\}/gi, contactName || 'amigo');

  let success = false;
  let errorMsg = null;

  try {
    let msgId = null;

    if (customGatewaySender) {
      // Gateway mock inyectado en suite de tests (cero llamadas externas)
      msgId = await customGatewaySender({
        log,
        campaign,
        gatewayCtx,
        to: log.customerPhone,
        text: personalizedMessage,
        media: campaign.media,
        contactName
      });
    } else if (campaign.media) {
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

      // Despacho 100% determinístico sin IA
      await sendClaimedLog(claimed, campaign, gatewayCtx, campaign.baseMessage, contact?.name);

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
