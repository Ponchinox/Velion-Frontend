import defaultPrisma from '../db.js';
import { areBackgroundJobsEnabled } from '../config/serverConfig.js';
import { sendText as gatewaySendText, resolveGatewayCtx } from './whatsappGateway.js';
import { isHandoffActive } from './humanHandoffGate.js';
import {
  isValidIanaTimezone,
  applyQuietHours,
  calculateAttemptTimestamp
} from './followUpService.js';
import { generateFollowUpMessage } from './followUpAiService.js';

export const FOLLOW_UP_TICK_MS = 30000; // 30 segundos
export const STALE_PROCESSING_MS = 5 * 60 * 1000; // 5 minutos
const BATCH_SIZE = 5;

// Lock en memoria por proceso para evitar solapamiento de ticks
let isProcessingTick = false;
const activeSequenceLocks = new Set();

let customGatewaySender = null;

/**
 * Inyecta un sender mock para pruebas unitarias/integración (cero llamadas de red).
 */
export function setFollowUpGatewaySender(senderFn) {
  customGatewaySender = typeof senderFn === 'function' ? senderFn : null;
}

/**
 * Reclamación atómica de secuencias listas para procesar en PostgreSQL.
 * CORRECCIÓN CRÍTICA #1: Reclama tanto 'SCHEDULED' como 'WAITING_NEXT' cuando nextRunAt <= NOW().
 */
export async function claimDueSequences(limit = BATCH_SIZE, prismaClient = defaultPrisma) {
  const db = prismaClient;
  const rows = await db.$queryRaw`
    WITH candidate AS (
      SELECT id FROM "FollowUpSequence"
      WHERE status IN ('SCHEDULED', 'WAITING_NEXT')
        AND "nextRunAt" IS NOT NULL
        AND "nextRunAt" <= NOW()
      ORDER BY "nextRunAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "FollowUpSequence"
    SET status = 'PROCESSING',
        "claimedAt" = NOW()
    WHERE id IN (SELECT id FROM candidate)
    RETURNING *;
  `;

  return rows;
}

/**
 * Recupera de forma segura secuencias e intentos huérfanos tras un reinicio de PM2 o crash.
 * CORRECCIÓN CRÍTICA #2 y #3:
 * - Si dispatchStartedAt IS NULL -> Seguro reanudar/reusar el mismo intento.
 * - Si dispatchStartedAt IS NOT NULL -> Resultado ambiguo -> UNKNOWN_DELIVERY, jamás reintentar ese intento.
 * - Si sequence quedó en PROCESSING sin attempt -> Reprogramar de forma segura sin congelar.
 */
export async function recoverStaleProcessing(prismaClient = defaultPrisma) {
  const db = prismaClient;
  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MS);

  // 1. Buscar secuencias congeladas en PROCESSING por más de 5 minutos
  const staleSequences = await db.followUpSequence.findMany({
    where: {
      status: 'PROCESSING',
      claimedAt: { lt: staleCutoff }
    },
    include: {
      attempts: true,
      tenant: true
    }
  });

  let recoveredCount = 0;

  for (const seq of staleSequences) {
    const targetAttemptNum = seq.currentAttempt + 1;
    const existingAttempt = seq.attempts.find((a) => a.attemptNumber === targetAttemptNum);

    if (!existingAttempt) {
      // CASO A: Proceso cayó antes de crear FollowUpAttempt. El proveedor nunca fue contactado.
      console.log(`♻️ [FollowUp Recovery] Secuencia ${seq.id} en PROCESSING sin attempt. Reprogramando de forma segura.`);
      await db.followUpSequence.update({
        where: { id: seq.id },
        data: {
          status: seq.currentAttempt === 0 ? 'SCHEDULED' : 'WAITING_NEXT',
          claimedAt: null
        }
      });
      recoveredCount++;
    } else if (existingAttempt.status === 'SENT') {
      // CASO G DEFENSIVO: Proceso cayó tras persistir SENT pero antes de actualizar la secuencia.
      console.log(`♻️ [FollowUp Recovery Caso G] Secuencia ${seq.id} en PROCESSING con intento #${targetAttemptNum} SENT. Avanzando secuencia.`);
      const nextOffsetHours = targetAttemptNum === 1 ? 24 : 48;
      const hasNextAttempt = targetAttemptNum < seq.maxAttempts;
      const nextTargetDate = hasNextAttempt && seq.tenant?.timezone
        ? applyQuietHours(new Date(seq.anchorAt.getTime() + nextOffsetHours * 3600 * 1000), seq.tenant.timezone)
        : null;

      await db.followUpSequence.update({
        where: { id: seq.id },
        data: {
          currentAttempt: targetAttemptNum,
          lastRunAt: existingAttempt.sentAt || new Date(),
          claimedAt: null,
          status: hasNextAttempt ? 'WAITING_NEXT' : 'EXHAUSTED',
          nextRunAt: nextTargetDate
        }
      });
      recoveredCount++;
    } else if (existingAttempt.status === 'PROCESSING' || existingAttempt.status === 'PENDING') {
      if (!existingAttempt.dispatchStartedAt) {
        // CASO B: Proceso cayó antes de iniciar el HTTP al proveedor. Es seguro reencolar el mismo intento.
        console.log(`♻️ [FollowUp Recovery] Intento #${targetAttemptNum} de secuencia ${seq.id} cayó ANTES de dispatch. Reencolando mismo intento.`);
        await db.followUpAttempt.update({
          where: { id: existingAttempt.id },
          data: {
            status: 'PENDING',
            claimedAt: null
          }
        });
        await db.followUpSequence.update({
          where: { id: seq.id },
          data: {
            status: seq.currentAttempt === 0 ? 'SCHEDULED' : 'WAITING_NEXT',
            claimedAt: null
          }
        });
        recoveredCount++;
      } else {
        // CASO C: Proceso cayó después de persistir dispatchStartedAt.
        // Entrega potencialmente ambigua -> Marcar UNKNOWN_DELIVERY y NO reintentar.
        console.log(`⚠️ [FollowUp Recovery] Intento #${targetAttemptNum} de secuencia ${seq.id} cayó TRAS iniciar dispatch. Marcando UNKNOWN_DELIVERY.`);
        await db.followUpAttempt.update({
          where: { id: existingAttempt.id },
          data: {
            status: 'UNKNOWN_DELIVERY',
            errorMessage: 'Worker interrumpido durante el despacho; threshold de 5 min excedido tras dispatchStartedAt'
          }
        });

        const nextOffsetHours = targetAttemptNum === 1 ? 24 : 48;
        const hasNextAttempt = targetAttemptNum < seq.maxAttempts;
        const nextTargetDate = hasNextAttempt && seq.tenant?.timezone
          ? applyQuietHours(new Date(seq.anchorAt.getTime() + nextOffsetHours * 3600 * 1000), seq.tenant.timezone)
          : null;

        await db.followUpSequence.update({
          where: { id: seq.id },
          data: {
            currentAttempt: targetAttemptNum,
            lastRunAt: new Date(),
            claimedAt: null,
            status: hasNextAttempt ? 'WAITING_NEXT' : 'EXHAUSTED',
            nextRunAt: nextTargetDate
          }
        });
        recoveredCount++;
      }
    }
  }

  return recoveredCount;
}

/**
 * Alias para reclamar una única secuencia lista
 */
export async function claimDueSequence(prismaClient = defaultPrisma) {
  const rows = await claimDueSequences(1, prismaClient);
  return rows && rows.length > 0 ? rows[0] : null;
}

/**
 * Ejecuta el flujo completo de un intento de seguimiento para una secuencia reclamada.
 */
export async function processFollowUpSequence(sequenceRecord, prismaClient = defaultPrisma, options = {}) {
  const db = prismaClient;
  const seqId = typeof sequenceRecord === 'string' ? sequenceRecord : sequenceRecord?.id;

  if (!seqId) return { success: false, reason: 'INVALID_SEQUENCE_ID' };
  if (activeSequenceLocks.has(seqId)) return { success: false, reason: 'SEQUENCE_LOCKED' };
  activeSequenceLocks.add(seqId);

  try {
    // ─── CARGAR ENTIDADES RELACIONADAS ───
    const seq = await db.followUpSequence.findUnique({
      where: { id: seqId },
      include: {
        tenant: true,
        customer: true,
        chat: true,
        order: true
      }
    });

    if (!seq || seq.status !== 'PROCESSING') return;

    // ─── PRE-FLIGHT GATE 1 (SISTEMA, HORARIOS Y POLÍTICAS) ───

    // 1. Tenant activo y follow-up habilitado
    if (!seq.tenant || seq.tenant.active === false || seq.tenant.followUpEnabled !== true) {
      console.log(`🛑 [FollowUp Gate 1] Tenant ${seq.tenantId} tiene Follow-ups inactivo. Cancelando secuencia.`);
      await db.followUpSequence.update({
        where: { id: seqId },
        data: { status: 'CANCELLED', cancelReason: 'TENANT_FOLLOW_UP_DISABLED', claimedAt: null }
      });
      return { success: false, status: 'CANCELLED', reason: 'FOLLOW_UP_DISABLED' };
    }

    // 2. CORRECCIÓN #4: Timezone Fail-Closed
    if (!isValidIanaTimezone(seq.tenant.timezone)) {
      console.warn(`🛑 [FollowUp Gate 1 - Fail Closed] Tenant ${seq.tenantId} no tiene timezone válido. Abortando envío sin asumir UTC.`);
      await db.followUpSequence.update({
        where: { id: seqId },
        data: { status: 'SCHEDULED', claimedAt: null } // Permanece en espera hasta que se configure timezone válido
      });
      return { success: false, status: 'SCHEDULED', reason: 'INVALID_TIMEZONE' };
    }

    // 3. Horario silencioso (09:00 - 20:00 local)
    const now = new Date(Date.now());
    const quietCheckedDate = applyQuietHours(now, seq.tenant.timezone);
    if (!quietCheckedDate || quietCheckedDate.getTime() > now.getTime() + 60000) {
      // Estamos fuera de horario local. Reprogramamos al siguiente horario permitido.
      console.log(`🌙 [FollowUp Gate 1] Fuera de horario permitido para ${seq.customer.phone}. Reprogramando a ${quietCheckedDate?.toISOString()}.`);
      await db.followUpSequence.update({
        where: { id: seqId },
        data: {
          status: seq.currentAttempt === 0 ? 'SCHEDULED' : 'WAITING_NEXT',
          nextRunAt: quietCheckedDate,
          claimedAt: null
        }
      });
      return { success: false, status: 'SCHEDULED', reason: 'QUIET_HOURS_RESCHEDULED' };
    }

    // 4. Human Handoff (Autoridad Fail-Closed)
    const handoffActive = await isHandoffActive({
      tenantId: seq.tenantId,
      contactId: seq.chat?.contactId,
      chatId: seq.chatId,
      phone: seq.customer.phone,
      prismaClient: db
    });
    if (handoffActive) {
      console.log(`👤 [FollowUp Gate 1] Handoff humano activo para ${seq.customer.phone}. Cancelando secuencia.`);
      await db.followUpSequence.update({
        where: { id: seqId },
        data: { status: 'CANCELLED', cancelReason: 'HUMAN_HANDOFF', claimedAt: null }
      });
      return { success: false, status: 'CANCELLED', reason: 'HUMAN_HANDOFF' };
    }

    // 5. Supresión de cliente (Opt-out)
    if (seq.customer.followUpSuppressed === true) {
      console.log(`🚫 [FollowUp Gate 1] Cliente ${seq.customer.phone} tiene seguimientos suprimidos. Cancelando.`);
      await db.followUpSequence.update({
        where: { id: seqId },
        data: { status: 'CANCELLED', cancelReason: 'OPT_OUT', claimedAt: null }
      });
      return { success: false, status: 'CANCELLED', reason: 'OPT_OUT' };
    }

    // 6. Autoridad de Orden y Pagos (CORRECCIÓN #8: VERIFYING cancela seguimiento)
    if (seq.order) {
      if (seq.order.paymentStatus === 'PAID') {
        const lastSentAttempt = await db.followUpAttempt.findFirst({
          where: { sequenceId: seq.id, status: 'SENT' },
          orderBy: { sentAt: 'desc' }
        });
        const isAttributable = Boolean(
          lastSentAttempt?.sentAt &&
          (now.getTime() >= new Date(lastSentAttempt.sentAt).getTime()) &&
          (now.getTime() - new Date(lastSentAttempt.sentAt).getTime() <= 72 * 3600 * 1000)
        );
        await db.followUpSequence.update({
          where: { id: seqId },
          data: {
            status: 'CANCELLED',
            cancelReason: 'ORDER_PAID',
            recoveredOrderId: isAttributable ? seq.order.id : null,
            recoveredAt: isAttributable ? now : null,
            claimedAt: null
          }
        });
        return { success: false, status: 'CANCELLED', reason: 'ORDER_PAID' };
      }
      if (seq.order.paymentStatus === 'VERIFYING') {
        await db.followUpSequence.update({
          where: { id: seqId },
          data: { status: 'CANCELLED', cancelReason: 'PAYMENT_VERIFYING', claimedAt: null }
        });
        return { success: false, status: 'CANCELLED', reason: 'PAYMENT_VERIFYING' };
      }
      if (seq.order.status === 'COMPLETED') {
        await db.followUpSequence.update({
          where: { id: seqId },
          data: { status: 'CANCELLED', cancelReason: 'ORDER_COMPLETED', claimedAt: null }
        });
        return { success: false, status: 'CANCELLED', reason: 'ORDER_COMPLETED' };
      }
      if (seq.order.status === 'CANCELED') {
        await db.followUpSequence.update({
          where: { id: seqId },
          data: { status: 'CANCELLED', cancelReason: 'ORDER_CANCELED', claimedAt: null }
        });
        return { success: false, status: 'CANCELLED', reason: 'ORDER_CANCELED' };
      }
    }

    // 7. Política de Canal Meta (Ventana de 24h)
    const gatewayCtx = options.providerOverride
      ? { provider: options.providerOverride }
      : await resolveGatewayCtx(seq.tenantId, db);
    if (gatewayCtx?.provider === 'META') {
      const lastInbound = await db.message.findFirst({
        where: { chatId: seq.chatId, senderRole: { in: ['contact', 'user'] } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true }
      });

      const lastInboundMs = lastInbound?.createdAt ? new Date(lastInbound.createdAt).getTime() : 0;
      const windowMarginMs = (24 * 60 - 30) * 60 * 1000; // 23 horas y 30 minutos

      if (Date.now() - lastInboundMs >= windowMarginMs) {
        console.log(`🛑 [FollowUp Gate 1 - Meta Window] Ventana de 24h vencida para Meta (${seq.customer.phone}). Omitiendo sin llamar a provider.`);
        const targetAttemptNum = seq.currentAttempt + 1;
        await db.followUpAttempt.upsert({
          where: { sequenceId_attemptNumber: { sequenceId: seq.id, attemptNumber: targetAttemptNum } },
          create: {
            sequenceId: seq.id,
            attemptNumber: targetAttemptNum,
            status: 'SKIPPED_POLICY',
            provider: 'META',
            scheduledAt: seq.nextRunAt || now,
            errorMessage: 'Meta 24-hour customer care window expired. Freeform message blocked by policy.'
          },
          update: {
            status: 'SKIPPED_POLICY',
            errorMessage: 'Meta 24-hour customer care window expired. Freeform message blocked by policy.'
          }
        });

        // Cierre terminal en V1 (no templates disponibles)
        // Cierre terminal en V1 (no templates disponibles)
        await db.followUpSequence.update({
          where: { id: seqId },
          data: { status: 'CANCELLED', cancelReason: 'META_WINDOW_CLOSED', claimedAt: null }
        });
        return { success: false, status: 'CANCELLED', reason: 'META_WINDOW_CLOSED' };
      }
    }

    // ─── DETERMINACIÓN DE INTENTO Y PREPARACIÓN DE ROW ───
    const targetAttemptNumber = seq.currentAttempt + 1;
    if (targetAttemptNumber > seq.maxAttempts) {
      await db.followUpSequence.update({
        where: { id: seqId },
        data: { status: 'EXHAUSTED', claimedAt: null }
      });
      return { success: false, status: 'EXHAUSTED', reason: 'MAX_ATTEMPTS_REACHED' };
    }

    // Upsert seguro para no crear múltiples rows para (sequenceId, attemptNumber)
    let attemptRecord = await db.followUpAttempt.findUnique({
      where: { sequenceId_attemptNumber: { sequenceId: seq.id, attemptNumber: targetAttemptNumber } }
    });

    if (!attemptRecord) {
      attemptRecord = await db.followUpAttempt.create({
        data: {
          sequenceId: seq.id,
          attemptNumber: targetAttemptNumber,
          status: 'PROCESSING',
          provider: gatewayCtx?.provider || 'EVOLUTION',
          scheduledAt: seq.nextRunAt || now,
          claimedAt: now
        }
      });
    } else {
      attemptRecord = await db.followUpAttempt.update({
        where: { id: attemptRecord.id },
        data: { status: 'PROCESSING', claimedAt: now }
      });
    }

    // ─── GENERACIÓN CONTEXTUAL DEL MENSAJE ───
    const aiGenResult = await generateFollowUpMessage({
      sequence: seq,
      customer: seq.customer,
      tenant: seq.tenant,
      attemptNumber: targetAttemptNumber,
      prismaClient: db
    });

    if (!aiGenResult.success || !aiGenResult.text) {
      const isProductUnavailable = aiGenResult.reason === 'PRODUCT_UNAVAILABLE';
      const cancelReason = isProductUnavailable ? 'PRODUCT_UNAVAILABLE' : 'AI_GENERATION_FAILED';
      const errDetail = isProductUnavailable ? 'PRODUCT_UNAVAILABLE' : (aiGenResult.reason || 'AI generation returned empty');

      console.log(`⚠️ [FollowUp AI] No se pudo generar mensaje válido (${cancelReason}). Marcando SKIPPED_POLICY.`);
      await db.followUpAttempt.update({
        where: { id: attemptRecord.id },
        data: { status: 'SKIPPED_POLICY', errorMessage: errDetail }
      });
      await db.followUpSequence.update({
        where: { id: seqId },
        data: { status: 'CANCELLED', cancelReason, claimedAt: null }
      });
      return { success: false, status: 'CANCELLED', reason: cancelReason };
    }

    const messageToSend = aiGenResult.text;

    // ─── PRE-FLIGHT GATE 2 (DOBLE COMPROBACIÓN PRE-DISPATCH INMEDIATA) ───
    const currentSeqState = await db.followUpSequence.findUnique({
      where: { id: seqId },
      select: { status: true, claimedAt: true }
    });

    if (!currentSeqState || currentSeqState.status !== 'PROCESSING') {
      console.log(`🛑 [FollowUp Gate 2] Estado de secuencia cambió a ${currentSeqState?.status}. Abortando despacho.`);
      await db.followUpAttempt.update({
        where: { id: attemptRecord.id },
        data: { status: 'SKIPPED_POLICY', errorMessage: 'Secuencia neutralizada durante la generación de IA' }
      });
      return { success: false, status: currentSeqState?.status || 'CANCELLED', reason: 'SEQUENCE_STATUS_CHANGED' };
    }

    // Detectar mensaje inbound de usuario recibido durante la generación (con margen de seguridad de 2s para sincronización de reloj)
    const claimTime = currentSeqState.claimedAt || seq.claimedAt;
    let racingInbound = null;
    if (claimTime) {
      const safeClaimTime = new Date(new Date(claimTime).getTime() - 2000);
      racingInbound = await db.message.findFirst({
        where: {
          chatId: seq.chatId,
          tenantId: seq.tenantId,
          senderRole: { in: ['contact', 'user'] },
          createdAt: { gte: safeClaimTime }
        },
        select: { id: true, createdAt: true }
      });
    }

    if (racingInbound) {
      console.log(`🛑 [FollowUp Gate 2 - Race Abort] Mensaje inbound detectado recibido durante generación. Neutralizando.`);
      await db.followUpAttempt.update({
        where: { id: attemptRecord.id },
        data: { status: 'SKIPPED_POLICY', errorMessage: 'Inbound message arrived before provider dispatch' }
      });
      await db.followUpSequence.update({
        where: { id: seqId },
        data: { status: 'NEUTRALIZED_INBOUND', claimedAt: null }
      });
      return { success: false, status: 'NEUTRALIZED_INBOUND', reason: 'INBOUND_ARRIVED_DURING_PROCESSING' };
    }

    // ─── CORRECCIÓN CRÍTICA #2: PERSISTIR dispatchStartedAt ANTES DEL HTTP CALL ───
    await db.followUpAttempt.update({
      where: { id: attemptRecord.id },
      data: { dispatchStartedAt: new Date() }
    });

    // ─── DESPACHO AL PROVEEDOR ───
    let msgId = null;
    let sendError = null;

    try {
      if (customGatewaySender) {
        if (customGatewaySender.length > 1) {
          msgId = await customGatewaySender(gatewayCtx, seq.customer.phone, messageToSend);
        } else {
          msgId = await customGatewaySender({
            to: seq.customer.phone,
            text: messageToSend,
            tenantId: seq.tenantId,
            attemptNumber: targetAttemptNumber,
            gatewayCtx
          });
        }
      } else {
        msgId = await gatewaySendText({
          ...gatewayCtx,
          tenantId: seq.tenantId,
          to: seq.customer.phone,
          text: messageToSend,
          isAutomated: true,
          origin: 'follow_up'
        });
      }
    } catch (err) {
      sendError = err;
    }

    // ─── EVALUACIÓN DE RESULTADO DE ENVÍO ───
    const sendConfirmed = typeof msgId === 'string' && msgId.trim().length > 0;

    if (sendConfirmed) {
      console.log(`✅ [FollowUp Dispatch] Intento #${targetAttemptNumber} enviado a ${seq.customer.phone} (msgId: ${msgId}).`);
      const nextOffsetHours = targetAttemptNumber === 1 ? 24 : 48;
      const hasNextAttempt = targetAttemptNumber < seq.maxAttempts;
      const nextTargetDate = hasNextAttempt
        ? applyQuietHours(new Date(seq.anchorAt.getTime() + nextOffsetHours * 3600 * 1000), seq.tenant.timezone)
        : null;
      const sentTime = new Date();

      if (typeof db.$transaction === 'function') {
        await db.$transaction([
          db.followUpAttempt.update({
            where: { id: attemptRecord.id },
            data: {
              status: 'SENT',
              sentMessage: messageToSend,
              providerMessageId: msgId,
              sentAt: sentTime,
              errorMessage: null
            }
          }),
          db.followUpSequence.update({
            where: { id: seqId },
            data: {
              currentAttempt: targetAttemptNumber,
              lastRunAt: sentTime,
              claimedAt: null,
              status: hasNextAttempt ? 'WAITING_NEXT' : 'EXHAUSTED',
              nextRunAt: nextTargetDate
            }
          })
        ]);
      } else {
        await db.followUpAttempt.update({
          where: { id: attemptRecord.id },
          data: {
            status: 'SENT',
            sentMessage: messageToSend,
            providerMessageId: msgId,
            sentAt: sentTime,
            errorMessage: null
          }
        });

        await db.followUpSequence.update({
          where: { id: seqId },
          data: {
            currentAttempt: targetAttemptNumber,
            lastRunAt: sentTime,
            claimedAt: null,
            status: hasNextAttempt ? 'WAITING_NEXT' : 'EXHAUSTED',
            nextRunAt: nextTargetDate
          }
        });
      }
      return { success: true, status: hasNextAttempt ? 'WAITING_NEXT' : 'EXHAUSTED' };
    } else {
      // Fallo o entrega ambigua
      const errMessage = sendError?.response?.data?.message || sendError?.message || 'Proveedor no devolvió identificador de mensaje válido';
      const isDefinitiveFailure = sendError?.response?.status === 400 || sendError?.response?.status === 404;

      if (isDefinitiveFailure) {
        console.error(`❌ [FollowUp Dispatch] Fallo definitivo del proveedor (${errMessage}). Marcando FAILED_SAFE.`);
        await db.followUpAttempt.update({
          where: { id: attemptRecord.id },
          data: { status: 'FAILED_SAFE', errorMessage: String(errMessage) }
        });
        await db.followUpSequence.update({
          where: { id: seqId },
          data: { status: 'CANCELLED', cancelReason: 'PROVIDER_PERMANENT_ERROR', claimedAt: null }
        });
      } else {
        // CORRECCIÓN CRÍTICA #1 y #2: Error ambiguo (timeout/reset tras dispatchStartedAt) -> UNKNOWN_DELIVERY
        console.warn(`⚠️ [FollowUp Dispatch Ambiguo] Resultado ambiguo (${errMessage}). Marcando UNKNOWN_DELIVERY sin auto-retry.`);
        await db.followUpAttempt.update({
          where: { id: attemptRecord.id },
          data: { status: 'UNKNOWN_DELIVERY', errorMessage: String(errMessage) }
        });

        const nextOffsetHours = targetAttemptNumber === 1 ? 24 : 48;
        const hasNextAttempt = targetAttemptNumber < seq.maxAttempts;
        const nextTargetDate = hasNextAttempt
          ? applyQuietHours(new Date(seq.anchorAt.getTime() + nextOffsetHours * 3600 * 1000), seq.tenant.timezone)
          : null;

        await db.followUpSequence.update({
          where: { id: seqId },
          data: {
            currentAttempt: targetAttemptNumber,
            lastRunAt: new Date(),
            claimedAt: null,
            status: hasNextAttempt ? 'WAITING_NEXT' : 'EXHAUSTED',
            nextRunAt: nextTargetDate
          }
        });
        return { success: true, status: hasNextAttempt ? 'WAITING_NEXT' : 'EXHAUSTED' };
      }
    }
  } catch (criticalErr) {
    console.error(`❌ [FollowUp Worker] Error no controlado en secuencia ${seqId}:`, criticalErr);
  } finally {
    activeSequenceLocks.delete(seqId);
  }
}

/**
 * Loop periódico del worker de Follow-ups.
 */
export async function runFollowUpWorkerTick(prismaClient = defaultPrisma) {
  if (isProcessingTick) return;
  if (!areBackgroundJobsEnabled()) return;

  isProcessingTick = true;
  try {
    // 1. Recuperar procesos huérfanos / caídos
    await recoverStaleProcessing(prismaClient);

    // 2. Reclamar secuencias pendientes vencidas (SCHEDULED o WAITING_NEXT)
    const claimedRows = await claimDueSequences(BATCH_SIZE, prismaClient);

    if (claimedRows && claimedRows.length > 0) {
      console.log(`⏰ [FollowUp Worker] ${claimedRows.length} secuencia(s) reclamada(s) para despacho.`);
      for (const row of claimedRows) {
        await processFollowUpSequence(row, prismaClient);
      }
    }
  } catch (err) {
    console.error('❌ [FollowUp Worker Tick] Error en ciclo de ejecución:', err.message);
  } finally {
    isProcessingTick = false;
  }
}

let workerIntervalHandle = null;

/**
 * Inicializa el worker en segundo plano si los background jobs están habilitados en el proceso.
 */
export function initFollowUpWorker() {
  if (!areBackgroundJobsEnabled()) {
    console.log('ℹ️ [FollowUp Worker] Background jobs deshabilitados para este proceso.');
    return { stop: () => {} };
  }

  if (workerIntervalHandle) clearInterval(workerIntervalHandle);

  workerIntervalHandle = setInterval(() => {
    runFollowUpWorkerTick().catch((err) => {
      console.error('❌ [FollowUp Worker Interval Error]:', err);
    });
  }, FOLLOW_UP_TICK_MS);

  if (workerIntervalHandle.unref) workerIntervalHandle.unref();

  // Ejecución inicial ligera asíncrona
  setTimeout(() => {
    runFollowUpWorkerTick().catch(() => {});
  }, 5000);

  console.log(`🚀 [FollowUp Worker] Inicializado con intervalo de ${FOLLOW_UP_TICK_MS / 1000}s.`);

  return {
    stop: () => {
      if (workerIntervalHandle) {
        clearInterval(workerIntervalHandle);
        workerIntervalHandle = null;
      }
    }
  };
}
