import defaultPrisma from '../db.js';
import { isHandoffActive } from './humanHandoffGate.js';

/**
 * followUpService.js — Núcleo de Lógica Comercial y Schedulig para Follow-ups V1
 *
 * Responsabilidades:
 * - Validación fail-closed de IANA timezones.
 * - Cálculo de cadencias absolutas (+6h, +24h, +48h) desde anchorAt.
 * - Aplicación estricta de horario silencioso (09:00 - 20:00 local).
 * - Creación y refresh seguro de secuencias de seguimiento.
 * - Neutralización temprana ante mensajes inbound.
 * - Manejo de cancelaciones por Handoff, Pagos (VERIFYING / PAID) y Órdenes.
 * - Supresión y Opt-out específico de seguimientos sin ban global.
 */

export const ALLOWED_HOURS_START = 9;  // 09:00 AM local
export const ALLOWED_HOURS_END = 20;   // 20:00 PM local (8 PM)

export const VALID_STAGES = Object.freeze([
  'PRODUCT_SELECTED',
  'DETAILS_PROVIDED',
  'SHIPPING_COORDINATED',
  'PAYMENT_PENDING'
]);

export const DISQUALIFIED_STAGES = Object.freeze([
  'EXPLORING',
  'PAYMENT_VERIFIED',
  'COMPLETED'
]);

/**
 * Detecta si el mensaje del usuario expresa una solicitud inequívoca de opt-out de seguimientos.
 * Excluye profanidades o insultos simples (Corrección #7: NO usar PROFANITY como opt-out automático).
 */
export function isFollowUpOptOutRequested(text) {
  if (!text || typeof text !== 'string') return false;
  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  const optOutPatterns = [
    /\b(no me (escribas?|escriban|mandes?|manden|contactes?|contacten|insistas?|insistan))\b/,
    /\b(deja de (escribirme|mandarme|contactarme|insistir|molestar|escribir|molestarme))\b/,
    /\b(dejen de (escribirme|mandarme|contactarme|insistir|molestar|escribir|molestarme))\b/,
    /\b(no quiero que me (escriban|contacten|insistan|manden))\b/,
    /\b(no quiero mas (mensajes|seguimiento|seguimientos|publicidad))\b/,
    /\b(quitenme de su lista|borrenme de su lista|eliminenme de su lista)\b/,
    /^(stop|basta|parar|cancelar suscripcion|alto|no mas mensajes)\.?$/
  ];

  return optOutPatterns.some(pattern => pattern.test(normalized));
}

/**
 * Valida de forma estricta si una zona horaria es IANA válida soportada por el entorno.
 * @param {string} tz
 * @returns {boolean}
 */
export function isValidIanaTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  const clean = tz.trim();
  if (clean.length < 3 || clean.length > 50) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: clean });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convierte una fecha y hora local a timestamp UTC preciso para una zona horaria IANA dada.
 * @param {string} ymd 'YYYY-MM-DD'
 * @param {string} hm 'HH:mm:ss'
 * @param {string} timeZone IANA timezone
 * @returns {Date|null}
 */
export function localToUtc(ymd, hm, timeZone) {
  if (!isValidIanaTimezone(timeZone)) return null;
  const [year, month, day] = ymd.split('-').map(Number);
  const [hours, minutes, seconds = 0] = hm.split(':').map(Number);

  const guess = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23'
  });

  const parts = formatter.formatToParts(guess);
  const map = {};
  for (const p of parts) map[p.type] = p.value;

  const localInTz = new Date(Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  ));

  const offsetMs = localInTz.getTime() - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

/**
 * Aplica el horario silencioso (09:00 - 20:00 local).
 * Si targetDate cae en horario nocturno/madrugada:
 * - Antes de 09:00 local -> se mueve a las 09:00:00 local del mismo día.
 * - Después de 20:00 local -> se mueve a las 09:00:00 local del DÍA SIGUIENTE.
 *
 * FAIL-CLOSED: Si timeZone es nulo o inválido, devuelve null.
 *
 * @param {Date} targetDate
 * @param {string} timeZone
 * @returns {Date|null}
 */
export function applyQuietHours(targetDate, timeZone) {
  if (!isValidIanaTimezone(timeZone)) return null;
  if (!targetDate || isNaN(targetDate.getTime())) return null;

  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const parts = dtf.formatToParts(targetDate);
  const map = {};
  for (const p of parts) map[p.type] = p.value;

  const localHour = Number(map.hour);
  const localMinute = Number(map.minute);
  const localSecond = Number(map.second || 0);
  const localYmd = `${map.year}-${map.month}-${map.day}`;

  const localSecOfDay = localHour * 3600 + localMinute * 60 + localSecond;
  const startSec = ALLOWED_HOURS_START * 3600; // 09:00:00 = 32400
  const endSec = ALLOWED_HOURS_END * 3600;     // 20:00:00 = 72000

  // Caso 1: Dentro de horario permitido [09:00:00 - 19:59:59] (20:00:00 en adelante NO permitido)
  if (localSecOfDay >= startSec && localSecOfDay < endSec) {
    return targetDate;
  }

  // Caso 2: Madrugada local (< 09:00:00 AM) -> Mismo día a las 09:00:00 AM
  if (localSecOfDay < startSec) {
    return localToUtc(localYmd, '09:00:00', timeZone);
  }

  // Caso 3: Noche local (>= 20:00:00 PM) -> Día siguiente a las 09:00:00 AM
  const [y, m, d] = localYmd.split('-').map(Number);
  const nextDayUtc = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
  const nextYmd = `${nextDayUtc.getUTCFullYear()}-${String(nextDayUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDayUtc.getUTCDate()).padStart(2, '0')}`;
  return localToUtc(nextYmd, '09:00:00', timeZone);
}

/**
 * Interpreta y normaliza un compromiso temporal explícito expresado por el cliente.
 * El backend es la autoridad final determinista.
 *
 * Validaciones:
 * - Timezone IANA válida requerida (Fail-closed).
 * - Fecha estrictamente en el futuro (> baseDate).
 * - Horizonte máximo de 14 días.
 * - Respeto de quiet hours (09:00 - 20:00 local).
 * - Expresiones ambiguas o no reconocidas retornan null (fallback a cadencia estándar).
 *
 * @param {string} text Texto temporal proporcionado (ej. "mañana te confirmo", "el lunes te pago")
 * @param {string} timeZone IANA timezone del tenant
 * @param {Date} [baseDate] Fecha base de referencia (default: new Date())
 * @returns {Date|null}
 */
export function parseCustomerExplicitTiming(text, timeZone, baseDate = new Date()) {
  if (!text || typeof text !== 'string' || !isValidIanaTimezone(timeZone)) return null;
  const raw = text.trim();
  if (raw.length < 2 || raw.length > 200) return null;

  // 1. Si es un string en formato ISO o YYYY-MM-DD
  const directDate = new Date(raw);
  if (!isNaN(directDate.getTime()) && raw.includes('-')) {
    const diffMs = directDate.getTime() - baseDate.getTime();
    if (diffMs <= 0 || diffMs > 14 * 24 * 3600 * 1000) return null;
    return applyQuietHours(directDate, timeZone);
  }

  // 2. Normalización de texto en español
  const normalized = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Obtener fecha actual en la zona horaria local del tenant
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hourCycle: 'h23'
  });
  const parts = dtf.formatToParts(baseDate);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const currentLocalYmd = `${map.year}-${map.month}-${map.day}`;
  const [curY, curM, curD] = currentLocalYmd.split('-').map(Number);

  let targetYmd = null;
  let targetTime = '10:00:00'; // Hora por defecto dentro de quiet hours

  if (/\b(tarde)\b/.test(normalized)) {
    targetTime = '15:00:00';
  } else if (/\b(noche)\b/.test(normalized)) {
    targetTime = '19:00:00';
  } else if (/\b(manana)\b/.test(normalized) && (/\b(en la manana|por la manana)\b/.test(normalized))) {
    targetTime = '10:00:00';
  }

  // Patrón A: "pasado mañana" / "pasado manana"
  if (/\b(pasado manana)\b/.test(normalized)) {
    const nextUtc = new Date(Date.UTC(curY, curM - 1, curD + 2, 12, 0, 0));
    targetYmd = `${nextUtc.getUTCFullYear()}-${String(nextUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(nextUtc.getUTCDate()).padStart(2, '0')}`;
  }
  // Patrón B: "mañana" / "manana"
  else if (/\b(manana)\b/.test(normalized)) {
    const nextUtc = new Date(Date.UTC(curY, curM - 1, curD + 1, 12, 0, 0));
    targetYmd = `${nextUtc.getUTCFullYear()}-${String(nextUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(nextUtc.getUTCDate()).padStart(2, '0')}`;
  }
  // Patrón C: "en X días" / "en X dias"
  else {
    const daysMatch = normalized.match(/\b(en|dentro de)\s+(\d+)\s+dias?\b/);
    if (daysMatch) {
      const daysCount = parseInt(daysMatch[2], 10);
      if (daysCount >= 1 && daysCount <= 14) {
        const nextUtc = new Date(Date.UTC(curY, curM - 1, curD + daysCount, 12, 0, 0));
        targetYmd = `${nextUtc.getUTCFullYear()}-${String(nextUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(nextUtc.getUTCDate()).padStart(2, '0')}`;
      } else {
        return null; // Rechazar si > 14 días
      }
    } else {
      // Patrón D: Días de la semana ("el lunes", "el martes", etc.)
      const weekdays = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
      for (let i = 0; i < weekdays.length; i++) {
        const dayName = weekdays[i];
        const regex = new RegExp(`\\b(el|este|proximo)\\s+${dayName}\\b|\\b${dayName}\\b`);
        if (regex.test(normalized)) {
          // Determinar qué día de la semana es hoy en la zona horaria local
          const todayUtc = new Date(Date.UTC(curY, curM - 1, curD, 12, 0, 0));
          const todayDayOfWeek = todayUtc.getUTCDay();
          let diffDays = (i - todayDayOfWeek + 7) % 7;
          if (diffDays === 0) diffDays = 7; // Si es el mismo día, programar al próximo
          const nextUtc = new Date(Date.UTC(curY, curM - 1, curD + diffDays, 12, 0, 0));
          targetYmd = `${nextUtc.getUTCFullYear()}-${String(nextUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(nextUtc.getUTCDate()).padStart(2, '0')}`;
          break;
        }
      }
    }
  }

  if (!targetYmd) return null;

  const candidateDate = localToUtc(targetYmd, targetTime, timeZone);
  if (!candidateDate) return null;

  // Validar futuro y horizonte máximo de 14 días
  const diffMs = candidateDate.getTime() - baseDate.getTime();
  if (diffMs <= 0) return null;
  if (diffMs > 14 * 24 * 3600 * 1000) return null;

  return applyQuietHours(candidateDate, timeZone);
}

/**
 * Calcula los timestamps absolutos de los 3 intentos desde anchorAt.
 * Offset 1: +6h
 * Offset 2: +24h
 * Offset 3: +48h
 */
export function calculateAttemptTimestamp(arg1, arg2, arg3) {
  let anchorAt, attemptNumber, timeZone;
  if (arg1 && typeof arg1 === 'object' && !(arg1 instanceof Date) && arg1.anchorAt !== undefined) {
    anchorAt = arg1.anchorAt;
    attemptNumber = arg1.attemptNumber;
    timeZone = arg1.timeZone;
  } else {
    anchorAt = arg1;
    attemptNumber = arg2;
    timeZone = arg3;
  }

  const baseMs = new Date(anchorAt).getTime();
  if (isNaN(baseMs)) return null;

  let offsetHours = 6;
  if (attemptNumber === 2) offsetHours = 24;
  else if (attemptNumber === 3) offsetHours = 48;

  const rawTarget = new Date(baseMs + offsetHours * 60 * 60 * 1000);
  if (timeZone && isValidIanaTimezone(timeZone)) {
    return applyQuietHours(rawTarget, timeZone);
  }
  return rawTarget;
}

/**
 * Filtro exhaustivo de elegibilidad comercial para iniciar o continuar un seguimiento.
 */
export function shouldCreateOrRefreshFollowUp({
  tenant,
  customer,
  currentCommercialState = {},
  chat,
  activeOrder = null,
  lastInboundMessage = null
}) {
  // 1. Tenant activo y con Follow-ups habilitado
  if (!tenant || tenant.active === false || tenant.followUpEnabled !== true) {
    return { eligible: false, reason: 'TENANT_FOLLOW_UP_DISABLED' };
  }

  // 2. Timezone obligatorio y válido (Fail-closed)
  if (!isValidIanaTimezone(tenant.timezone)) {
    return { eligible: false, reason: 'INVALID_OR_MISSING_TIMEZONE' };
  }

  // 3. Cliente con seguimiento suprimido (Opt-out)
  if (customer?.followUpSuppressed === true) {
    return { eligible: false, reason: 'CUSTOMER_SUPPRESSED' };
  }

  // 4. Inbound real obligatorio (Corrección #5: NO Customer.sessionUpdatedAt)
  const role = lastInboundMessage?.senderRole;
  const isUserRole = role === 'contact' || role === 'user';
  if (!lastInboundMessage || !isUserRole || !lastInboundMessage.createdAt) {
    return { eligible: false, reason: 'NO_INBOUND_ANCHOR' };
  }

  // 5. Etapa comercial calificadora
  const stage = currentCommercialState?.currentStage;
  if (!stage || !VALID_STAGES.includes(stage)) {
    return { eligible: false, reason: 'STAGE_NOT_ELIGIBLE' };
  }

  // 6. Verificación de órdenes existentes (Corrección #8: VERIFYING también detiene follow-up)
  if (activeOrder) {
    if (activeOrder.paymentStatus === 'PAID') {
      return { eligible: false, reason: 'ORDER_ALREADY_PAID_OR_COMPLETED' };
    }
    if (activeOrder.paymentStatus === 'VERIFYING') {
      return { eligible: false, reason: 'ORDER_PAYMENT_VERIFYING' };
    }
    if (activeOrder.status === 'COMPLETED') {
      return { eligible: false, reason: 'ORDER_ALREADY_PAID_OR_COMPLETED' };
    }
    if (activeOrder.status === 'CANCELED') {
      return { eligible: false, reason: 'ORDER_ALREADY_CANCELED' };
    }
  }

  return { eligible: true };
}

/**
 * Evalúa y programa/refresca una secuencia de seguimiento comercial tras el despacho de un mensaje del bot.
 */
export async function evaluateAndScheduleFollowUp({
  tenant,
  tenantId,
  customer,
  customerId,
  currentCommercialState = {},
  currentStage = null,
  productId = null,
  productName = null,
  chat,
  chatId,
  orderId = null,
  activeOrder = null,
  lastInboundMessage = null,
  explicitCustomerTiming = null,
  explicitTimingIso = null,
  contextSnapshot = null,
  prismaClient = defaultPrisma
}) {
  const db = prismaClient;

  if (!tenant && tenantId) {
    tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  }
  if (!customer && customerId) {
    customer = await db.customer.findUnique({ where: { id: customerId } });
  }
  if (!chat && chatId) {
    chat = await db.chat.findUnique({ where: { id: chatId } });
  }
  if (!activeOrder && (orderId || currentCommercialState?.orderId)) {
    const ordId = orderId || currentCommercialState.orderId;
    activeOrder = await db.order.findUnique({ where: { id: ordId } });
  }

  const resolvedStage = currentStage || currentCommercialState?.currentStage;
  const resolvedProductId = productId || currentCommercialState?.productId;
  const resolvedProductName = productName || currentCommercialState?.productName;
  const resolvedOrderId = orderId || currentCommercialState?.orderId || activeOrder?.id;

  const normalizedCommercialState = {
    currentStage: resolvedStage,
    productId: resolvedProductId,
    productName: resolvedProductName,
    orderId: resolvedOrderId,
    ...currentCommercialState
  };

  // 1. Evaluación determinista de precondiciones
  const check = shouldCreateOrRefreshFollowUp({
    tenant,
    customer,
    currentCommercialState: normalizedCommercialState,
    chat,
    activeOrder,
    lastInboundMessage
  });

  if (!check.eligible) {
    return { scheduled: false, reason: check.reason };
  }

  // 2. Verificación de Human Handoff Fail-Closed
  const handoffActive = await isHandoffActive({
    tenantId: tenant.id,
    contactId: chat?.contactId,
    chatId: chat?.id,
    phone: customer.phone,
    prismaClient: db
  });
  if (handoffActive) {
    return { scheduled: false, reason: 'HUMAN_HANDOFF_ACTIVE' };
  }

  const anchorAt = new Date(lastInboundMessage.createdAt);

  // 3. Cálculo de fecha de intento 1
  let scheduledNextRunAt = calculateAttemptTimestamp({
    anchorAt,
    attemptNumber: 1,
    timeZone: tenant.timezone
  });

  let resolvedTimingIso = explicitTimingIso || null;
  if (explicitCustomerTiming && typeof explicitCustomerTiming === 'string') {
    const parsedExplicit = parseCustomerExplicitTiming(explicitCustomerTiming, tenant.timezone, anchorAt);
    if (parsedExplicit) {
      resolvedTimingIso = parsedExplicit;
      scheduledNextRunAt = parsedExplicit;
    }
  }

  if (!scheduledNextRunAt) {
    return { scheduled: false, reason: 'FAILED_QUIET_HOURS_CALCULATION' };
  }

  const finalContextSnapshot = contextSnapshot || {
    productId: normalizedCommercialState.productId || null,
    productName: normalizedCommercialState.productName || null,
    variant: normalizedCommercialState.variant || null,
    quantity: normalizedCommercialState.quantity || null,
    shippingCity: normalizedCommercialState.shippingCity || null,
    shippingAddress: normalizedCommercialState.shippingAddress || null,
    lastDoubt: lastInboundMessage.content ? String(lastInboundMessage.content).slice(0, 300) : null,
    explicitTimeNote: explicitCustomerTiming || null
  };

  // 4. Buscar secuencia activa existente para este cliente en el tenant
  const existingSequence = await db.followUpSequence.findFirst({
    where: {
      tenantId: tenant.id,
      customerId: customer.id,
      status: { in: ['SCHEDULED', 'PROCESSING', 'NEUTRALIZED_INBOUND', 'WAITING_NEXT'] }
    }
  });

  if (!existingSequence) {
    // ─── CREAR NUEVA SECUENCIA ───
    try {
      const newSeq = await db.followUpSequence.create({
        data: {
          tenantId: tenant.id,
          customerId: customer.id,
          chatId: chat?.id || null,
          orderId: activeOrder?.id || normalizedCommercialState.orderId || null,
          productId: normalizedCommercialState.productId || null,
          productName: normalizedCommercialState.productName || null,
          stageAtCreation: normalizedCommercialState.currentStage,
          status: 'SCHEDULED',
          currentAttempt: 0,
          maxAttempts: 3,
          anchorAt,
          nextRunAt: scheduledNextRunAt,
          contextSnapshot: finalContextSnapshot,
          explicitTimingIso: resolvedTimingIso
        }
      });
      return { scheduled: true, action: 'CREATED', sequence: newSeq, sequenceId: newSeq.id, isRefresh: false, nextRunAt: scheduledNextRunAt };
    } catch (err) {
      // Si otra transacción concurrente ganó la inserción por el Partial Unique Index:
      if (err.code === 'P2002' || (err.message && err.message.includes('unique_active_followup_per_customer'))) {
        console.log(`ℹ️ [Follow-Up] Conflicto de carrera atrapado limpiamente. Secuencia ya creada concurrentemente.`);
        const concurrentSeq = await db.followUpSequence.findFirst({
          where: {
            tenantId: tenant.id,
            customerId: customer.id,
            status: { in: ['SCHEDULED', 'PROCESSING', 'NEUTRALIZED_INBOUND', 'WAITING_NEXT'] }
          }
        });
        return { scheduled: true, action: 'CONCURRENT_EXISTS', sequence: concurrentSeq, sequenceId: concurrentSeq?.id, isRefresh: true };
      }
      throw err;
    }
  } else {
    // ─── REFRESH DE SECUENCIA EXISTENTE ───
    if (existingSequence.currentAttempt === 0) {
      // El bot todavía no envió ningún seguimiento proactivo; el cliente continúa conversando.
      // REFRESH: actualizamos anchorAt y recalculamos nextRunAt sin crear otra secuencia.
      const updatedSeq = await db.followUpSequence.update({
        where: { id: existingSequence.id },
        data: {
          anchorAt,
          nextRunAt: scheduledNextRunAt,
          status: 'SCHEDULED',
          stageAtCreation: normalizedCommercialState.currentStage,
          productId: normalizedCommercialState.productId || existingSequence.productId,
          productName: normalizedCommercialState.productName || existingSequence.productName,
          contextSnapshot: finalContextSnapshot,
          explicitTimingIso: resolvedTimingIso || existingSequence.explicitTimingIso,
          orderId: activeOrder?.id || normalizedCommercialState.orderId || existingSequence.orderId,
          cancelReason: null
        }
      });
      return { scheduled: true, action: 'REFRESHED', sequence: updatedSeq, sequenceId: updatedSeq.id, isRefresh: true, nextRunAt: scheduledNextRunAt };
    } else {
      // existingSequence.currentAttempt >= 1:
      // El bot ya había enviado un seguimiento proactivo y el cliente ha vuelto a responder.
      // 1. Cerramos la secuencia previa como RECOVERED.
      await db.followUpSequence.update({
        where: { id: existingSequence.id },
        data: {
          status: 'RECOVERED',
          recoveredAt: new Date(),
          recoveredOrderId: activeOrder?.id || currentCommercialState.activeOrderId || null
        }
      });
      // 2. Creamos una NUEVA secuencia limpia para continuar monitoreando el nuevo carrito en progreso.
      const newSeq = await db.followUpSequence.create({
        data: {
          tenantId: tenant.id,
          customerId: customer.id,
          chatId: chat?.id || null,
          orderId: activeOrder?.id || currentCommercialState.activeOrderId || null,
          productId: currentCommercialState.productId || null,
          productName: currentCommercialState.productName || null,
          stageAtCreation: currentCommercialState.currentStage,
          status: 'SCHEDULED',
          currentAttempt: 0,
          maxAttempts: 3,
          anchorAt,
          nextRunAt: scheduledNextRunAt,
          contextSnapshot,
          explicitTimingIso
        }
      });
      return { scheduled: true, action: 'RECOVERED_AND_NEW_CREATED', sequenceId: newSeq.id, nextRunAt: scheduledNextRunAt };
    }
  }
}

/**
 * Neutralización temprana al entrar mensaje de usuario (Inbound Early Neutralization).
 * Se invoca inmediatamente tras persistir Message entrante.
 */
export async function cancelActiveFollowUpOnInboundMessage({ tenantId, customerId, prismaClient = defaultPrisma }) {
  if (!tenantId || !customerId) return 0;
  const db = prismaClient;

  // Actualiza secuencias SCHEDULED o WAITING_NEXT a NEUTRALIZED_INBOUND
  const result = await db.followUpSequence.updateMany({
    where: {
      tenantId,
      customerId,
      status: { in: ['SCHEDULED', 'WAITING_NEXT'] }
    },
    data: {
      status: 'NEUTRALIZED_INBOUND',
      updatedAt: new Date()
    }
  });

  return result.count;
}

/**
 * Cancela secuencias activas cuando se activa Human Handoff.
 */
export async function cancelFollowUpOnHandoff({ tenantId, customerId, phone, prismaClient = defaultPrisma }) {
  if (!tenantId) return 0;
  const db = prismaClient;

  const whereClause = {
    tenantId,
    status: { in: ['SCHEDULED', 'PROCESSING', 'NEUTRALIZED_INBOUND', 'WAITING_NEXT'] }
  };

  if (customerId) {
    whereClause.customerId = customerId;
  } else if (phone) {
    const cleanPhone = String(phone).replace(/\D/g, '');
    const cust = await db.customer.findFirst({
      where: { tenantId, phone: { contains: cleanPhone } },
      select: { id: true }
    });
    if (!cust) return 0;
    whereClause.customerId = cust.id;
  } else {
    return 0;
  }

  const result = await db.followUpSequence.updateMany({
    where: whereClause,
    data: {
      status: 'CANCELLED',
      cancelReason: 'HUMAN_HANDOFF',
      updatedAt: new Date()
    }
  });

  return result.count;
}

/**
 * Cancela secuencias de seguimiento ante eventos autoritativos de Order / Pagos.
 */
export async function cancelFollowUpOnOrderEvent({
  tenantId,
  customerId,
  order,
  orderId,
  reason,
  prismaClient = defaultPrisma
}) {
  if (!tenantId || (!customerId && !order?.customerId)) return 0;
  const db = prismaClient;
  const effectiveCustomerId = customerId || order?.customerId;

  let cancelReason = reason || null;
  let isPaid = false;
  let effectiveOrderId = orderId || order?.id || null;

  if (order) {
    if (order.paymentStatus === 'PAID') {
      cancelReason = 'ORDER_PAID';
      isPaid = true;
    } else if (order.paymentStatus === 'VERIFYING') {
      cancelReason = 'PAYMENT_VERIFYING';
    } else if (order.status === 'COMPLETED') {
      cancelReason = 'ORDER_COMPLETED';
    } else if (order.status === 'CANCELED') {
      cancelReason = 'ORDER_CANCELED';
    }
  } else if (reason) {
    cancelReason = reason;
    if (reason === 'ORDER_PAID') {
      isPaid = true;
    }
  }

  if (!cancelReason) return 0;

  const activeSeqs = await db.followUpSequence.findMany({
    where: {
      tenantId,
      customerId: effectiveCustomerId,
      status: { in: ['SCHEDULED', 'PROCESSING', 'NEUTRALIZED_INBOUND', 'WAITING_NEXT'] }
    },
    include: {
      attempts: {
        where: { status: 'SENT' },
        orderBy: { sentAt: 'desc' }
      }
    }
  });

  let cancelledCount = 0;
  const paymentTime = order?.updatedAt ? new Date(order.updatedAt) : new Date();
  const paymentMs = paymentTime.getTime();
  const ATTRIBUTION_WINDOW_MS = 72 * 3600 * 1000; // 72 horas fijas V1

  for (const seq of activeSeqs) {
    // REGLA AUTORITATIVA DE COINCIDENCIA DE ORDER:
    // Si sequence.orderId != null, cualquier evento de Order que quiera afectar esa secuencia
    // DEBE tener effectiveOrderId != null Y sequence.orderId === effectiveOrderId.
    // Si no coincide -> SKIP (no cancelar, no modificar, no atribuir).
    if (seq.orderId) {
      if (!effectiveOrderId) {
        continue;
      }
      if (seq.orderId !== effectiveOrderId) {
        continue;
      }
    }

    if (isPaid) {
      const lastSent = seq.attempts?.[0];
      const lastSentMs = lastSent?.sentAt ? new Date(lastSent.sentAt).getTime() : 0;
      // Solo atribuir si hubo al menos un attempt SENT y el pago fue verificado dentro de las 72h
      const isAttributable = lastSentMs > 0 && (paymentMs >= lastSentMs) && ((paymentMs - lastSentMs) <= ATTRIBUTION_WINDOW_MS);

      // Si sequence.orderId estaba poblado, recoveredOrderId debe ser exactamente ese mismo orderId
      // Si sequence.orderId era null, se atribuye effectiveOrderId si califica
      const recoveredOrderId = isAttributable ? (seq.orderId || effectiveOrderId) : null;
      const recoveredAt = isAttributable ? paymentTime : null;

      await db.followUpSequence.update({
        where: { id: seq.id },
        data: {
          status: 'CANCELLED',
          cancelReason: 'ORDER_PAID',
          recoveredOrderId,
          recoveredAt,
          updatedAt: new Date()
        }
      });
      cancelledCount++;
    } else {
      await db.followUpSequence.update({
        where: { id: seq.id },
        data: {
          status: 'CANCELLED',
          cancelReason,
          updatedAt: new Date()
        }
      });
      cancelledCount++;
    }
  }

  return cancelledCount;
}

/**
 * Registra opt-out de seguimientos en Customer y cancela secuencias activas.
 */
export async function handleFollowUpOptOut({ tenantId, customerId, reason = 'USER_REQUEST', prismaClient = defaultPrisma }) {
  if (!tenantId || !customerId) return false;
  const db = prismaClient;

  // Validar motivo permitido
  const validReason = (reason === 'MERCHANT_MANUAL') ? 'MERCHANT_MANUAL' : 'USER_REQUEST';

  // 1. Actualizar Customer
  await db.customer.update({
    where: { id: customerId },
    data: {
      followUpSuppressed: true,
      followUpOptOutAt: new Date(),
      followUpSuppressionReason: validReason
    }
  });

  // 2. Cancelar secuencias activas
  await db.followUpSequence.updateMany({
    where: {
      tenantId,
      customerId,
      status: { in: ['SCHEDULED', 'PROCESSING', 'NEUTRALIZED_INBOUND', 'WAITING_NEXT'] }
    },
    data: {
      status: 'CANCELLED',
      cancelReason: 'CUSTOMER_OPT_OUT',
      updatedAt: new Date()
    }
  });

  return true;
}
