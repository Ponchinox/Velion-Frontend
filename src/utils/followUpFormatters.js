/**
 * Formateadores y diccionarios de presentación para Follow-ups V1
 * Dashboard /seguimientos — Velion Real Data UI & Product UX Pass
 */

export const COMMON_TIMEZONES = [
  { value: 'America/Lima', label: 'Perú · America/Lima (UTC-5)' },
  { value: 'America/Bogota', label: 'Colombia · America/Bogota (UTC-5)' },
  { value: 'America/Guayaquil', label: 'Ecuador · America/Guayaquil (UTC-5)' },
  { value: 'America/Santiago', label: 'Chile · America/Santiago (UTC-4/UTC-3)' },
  { value: 'America/Buenos_Aires', label: 'Argentina · America/Buenos_Aires (UTC-3)' },
  { value: 'America/Montevideo', label: 'Uruguay · America/Montevideo (UTC-3)' },
  { value: 'America/Asuncion', label: 'Paraguay · America/Asuncion (UTC-4/UTC-3)' },
  { value: 'America/La_Paz', label: 'Bolivia · America/La_Paz (UTC-4)' },
  { value: 'America/Caracas', label: 'Venezuela · America/Caracas (UTC-4)' },
  { value: 'America/Mexico_City', label: 'México · America/Mexico_City (UTC-6)' },
  { value: 'America/Panama', label: 'Panamá · America/Panama (UTC-5)' },
  { value: 'America/Costa_Rica', label: 'Costa Rica · America/Costa_Rica (UTC-6)' },
  { value: 'America/Guatemala', label: 'Guatemala · America/Guatemala (UTC-6)' },
  { value: 'America/Santo_Domingo', label: 'Rep. Dominicana · America/Santo_Domingo (UTC-4)' },
  { value: 'America/New_York', label: 'EE.UU. Este · America/New_York (UTC-5/UTC-4)' },
  { value: 'America/Chicago', label: 'EE.UU. Centro · America/Chicago (UTC-6/UTC-5)' },
  { value: 'America/Los_Angeles', label: 'EE.UU. Pacífico · America/Los_Angeles (UTC-8/UTC-7)' },
  { value: 'Europe/Madrid', label: 'España · Europe/Madrid (UTC+1/UTC+2)' }
];

export const CANCEL_REASON_LABELS = {
  MANUAL_CANCEL: 'Cancelado manualmente',
  MERCHANT_MANUAL: 'Cancelado manualmente',
  HUMAN_HANDOFF: 'Atención humana transferida',
  USER_REQUEST: 'Solicitud del cliente',
  CUSTOMER_OPT_OUT: 'Solicitud del cliente (Baja)',
  OPT_OUT: 'Baja solicitada por el cliente',
  CUSTOMER_NOT_INTERESTED: 'Cliente no interesado',
  ORDER_PAID: 'Pedido pagado',
  ORDER_COMPLETED: 'Pedido completado',
  ORDER_CANCELED: 'Pedido cancelado',
  PAYMENT_VERIFYING: 'Comprobante en verificación',
  MAX_ATTEMPTS_REACHED: 'No respondió después de 3 intentos',
  PRODUCT_UNAVAILABLE: 'Producto no disponible',
  OUT_OF_STOCK: 'Producto sin stock',
  META_WINDOW_CLOSED: 'Ventana de WhatsApp cerrada',
  AI_GENERATION_FAILED: 'Fallo al redactar mensaje',
  PROVIDER_PERMANENT_ERROR: 'Error permanente del proveedor',
  TENANT_FOLLOW_UP_DISABLED: 'Seguimientos desactivados',
  FAILED_CLOSED_CONFIG: 'Configuración de horario no disponible',
  SEMANTIC_NOT_ELIGIBLE: 'No elegible (semántico)',
  INBOUND_INTERACTION: 'Interacción del cliente recibida',
  OTHER: 'Otro motivo'
};

/**
 * Mapea cancelReason a etiqueta humana en español.
 * Fallback seguro: capitaliza palabras y reemplaza guiones bajos, nunca snake_case crudo.
 */
export function formatCancelReason(reason) {
  if (!reason) return '—';
  if (CANCEL_REASON_LABELS[reason]) {
    return CANCEL_REASON_LABELS[reason];
  }
  return String(reason)
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Normaliza la visualización del cliente para DISPLAY ONLY.
 * NUNCA modifica ni muta el JID o teléfono almacenado en el objeto original.
 * Prioridad:
 * 1. Customer name válido
 * 2. Teléfono limpio normalizado (sin @s.whatsapp.net, @c.us, @lid)
 * 3. Fallback seguro 'Cliente'
 */
export function formatCustomerDisplay(customer) {
  if (!customer) {
    return { displayName: 'Cliente no identificado', displayPhone: '—', initials: 'CL' };
  }

  const rawPhone = (customer.phone || '').trim();
  // Strip JID domain suffixes for presentation without modifying stored customer
  const cleanPhone = rawPhone
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/@c\.us$/i, '')
    .replace(/@lid$/i, '')
    .trim();

  const rawName = (customer.name || '').trim();
  const hasValidName = rawName && rawName !== 'Sin nombre' && rawName !== 'Desconocido' && !rawName.includes('@');

  let formattedPhone = cleanPhone;
  if (cleanPhone.startsWith('51') && cleanPhone.length === 11) {
    formattedPhone = `+51 ${cleanPhone.slice(2, 5)} ${cleanPhone.slice(5, 8)} ${cleanPhone.slice(8)}`;
  } else if (cleanPhone) {
    formattedPhone = `+${cleanPhone}`;
  }

  const displayName = hasValidName ? rawName : (formattedPhone || 'Cliente');

  // Iniciales amigables para avatar
  let initials = 'CL';
  if (hasValidName) {
    const parts = rawName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      initials = `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    } else if (parts.length === 1 && parts[0].length >= 2) {
      initials = parts[0].slice(0, 2).toUpperCase();
    }
  }

  return {
    displayName,
    displayPhone: formattedPhone || '—',
    initials,
    isRawJid: rawPhone.includes('@')
  };
}

/**
 * Formatea fechas/horas respetando la zona horaria del tenant.
 * Fallback seguro: 'America/Lima'.
 */
export function formatFollowUpDate(dateStr, timeZone = 'America/Lima') {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-PE', {
      timeZone: timeZone || 'America/Lima',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  } catch {
    return '—';
  }
}

/**
 * Formato de fecha corta legible con contexto de día (ej: "Hoy, 4:35 p. m.", "Mañana, 9:00 a. m.")
 */
export function formatShortDateTime(dateStr, timeZone = 'America/Lima') {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';

    const now = new Date();
    const formatterDateOnly = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'America/Lima',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    const targetDayStr = formatterDateOnly.format(d);
    const todayStr = formatterDateOnly.format(now);

    const yesterday = new Date(now.getTime() - 86400000);
    const yesterdayStr = formatterDateOnly.format(yesterday);

    const tomorrow = new Date(now.getTime() + 86400000);
    const tomorrowStr = formatterDateOnly.format(tomorrow);

    const timeFormatter = new Intl.DateTimeFormat('es-PE', {
      timeZone: timeZone || 'America/Lima',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    const timeStr = timeFormatter.format(d);

    if (targetDayStr === todayStr) {
      return `Hoy, ${timeStr}`;
    }
    if (targetDayStr === tomorrowStr) {
      return `Mañana, ${timeStr}`;
    }
    if (targetDayStr === yesterdayStr) {
      return `Ayer, ${timeStr}`;
    }

    const monthDayFormatter = new Intl.DateTimeFormat('es-PE', {
      timeZone: timeZone || 'America/Lima',
      day: 'numeric',
      month: 'short'
    });
    return `${monthDayFormatter.format(d)}, ${timeStr}`;
  } catch {
    return formatFollowUpDate(dateStr, timeZone);
  }
}

/**
 * Formato de tiempo relativo para display humano (ej. "En 2 h 14 min", "En 45 min", "Hace 10 min")
 */
export function formatRelativeTime(dateStr, baseDate = new Date()) {
  if (!dateStr) return '—';
  try {
    const target = new Date(dateStr);
    if (isNaN(target.getTime())) return '—';

    const now = baseDate instanceof Date ? baseDate : new Date(baseDate);
    const diffMs = target.getTime() - now.getTime();
    const isFuture = diffMs > 0;
    const absDiff = Math.abs(diffMs);

    if (absDiff < 60000) {
      return isFuture ? 'En menos de 1 min' : 'Hace un momento';
    }

    const diffMinutes = Math.floor(absDiff / 60000);
    if (diffMinutes < 60) {
      return isFuture ? `En ${diffMinutes} min` : `Hace ${diffMinutes} min`;
    }

    const diffHours = Math.floor(absDiff / 3600000);
    const remMinutes = diffMinutes % 60;

    if (diffHours < 24) {
      if (remMinutes > 0) {
        return isFuture ? `En ${diffHours} h ${remMinutes} min` : `Hace ${diffHours} h ${remMinutes} min`;
      }
      return isFuture ? `En ${diffHours} h` : `Hace ${diffHours} h`;
    }

    const diffDays = Math.floor(absDiff / 86400000);
    return isFuture
      ? `En ${diffDays} ${diffDays === 1 ? 'día' : 'días'}`
      : `Hace ${diffDays} ${diffDays === 1 ? 'día' : 'días'}`;
  } catch {
    return '—';
  }
}

/**
 * Mapeo de estados orientado a producto para dueños de tienda (HubSpot / Intercom simplicity)
 */
export const STATUS_BADGES = {
  SCHEDULED: {
    label: 'Programado',
    shortLabel: 'Programado',
    color: 'bg-indigo-50 text-indigo-700 border-indigo-200'
  },
  PROCESSING: {
    label: 'Preparando seguimiento',
    shortLabel: 'Preparando',
    color: 'bg-amber-50 text-amber-700 border-amber-200'
  },
  WAITING_NEXT: {
    label: 'Esperando respuesta',
    shortLabel: 'Esperando',
    color: 'bg-sky-50 text-sky-700 border-sky-200'
  },
  RECOVERED: {
    label: 'Recuperado',
    shortLabel: 'Recuperado',
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200'
  },
  EXHAUSTED: {
    label: 'Sin respuesta tras 3 intentos',
    shortLabel: 'Completado',
    color: 'bg-slate-100 text-slate-700 border-slate-200'
  },
  CANCELLED: {
    label: 'Cancelado',
    shortLabel: 'Cancelado',
    color: 'bg-rose-50 text-rose-700 border-rose-200'
  },
  NEUTRALIZED_INBOUND: {
    label: 'Cliente respondió',
    shortLabel: 'Respondió',
    color: 'bg-purple-50 text-purple-700 border-purple-200'
  },
  SEMANTIC_NOT_ELIGIBLE: {
    label: 'No elegible',
    shortLabel: 'No elegible',
    color: 'bg-slate-100 text-slate-700 border-slate-200'
  }
};

export const STAGE_LABELS = {
  PRODUCT_SELECTED: 'Producto seleccionado',
  DETAILS_PROVIDED: 'Detalles brindados',
  SHIPPING_COORDINATED: 'Envío coordinado',
  PAYMENT_PENDING: 'Pago pendiente'
};

/**
 * Construye una línea de tiempo limpia y cronológica exclusivamente con datos reales
 * de la secuencia y sus intentos, sin fabricar ningún evento inexistente.
 */
export function buildFollowUpTimeline(sequence, timeZone = 'America/Lima') {
  if (!sequence) return [];

  const events = [];

  // 1. Interacción inicial del cliente (anchorAt)
  const initialTime = sequence.anchorAt || sequence.createdAt;
  if (initialTime) {
    const productInfo = sequence.productName ? ` con interés en "${sequence.productName}"` : '';
    const stageInfo = STAGE_LABELS[sequence.stageAtCreation] ? ` en etapa ${STAGE_LABELS[sequence.stageAtCreation]}` : '';
    events.push({
      id: 'evt_anchor',
      time: new Date(initialTime),
      title: 'Cliente mostró intención',
      description: `Última interacción registrada${productInfo}${stageInfo}.`,
      iconType: 'user_inbound',
      badge: 'Interacción inicial'
    });
  }

  // 2. Creación / Programación del seguimiento
  if (sequence.createdAt) {
    events.push({
      id: 'evt_created',
      time: new Date(sequence.createdAt),
      title: 'Seguimiento programado',
      description: 'Velion activó la secuencia automática para recuperar la oportunidad.',
      iconType: 'scheduled',
      badge: 'Automático'
    });
  }

  // 3. Intentos de seguimiento registrados
  const attempts = Array.isArray(sequence.attempts)
    ? [...sequence.attempts].sort((a, b) => (a.attemptNumber || 0) - (b.attemptNumber || 0))
    : [];

  attempts.forEach((att) => {
    // Si fue enviado
    if (att.status === 'SENT' || att.sentAt) {
      events.push({
        id: `evt_att_sent_${att.id || att.attemptNumber}`,
        time: new Date(att.sentAt || att.scheduledAt),
        title: `Seguimiento #${att.attemptNumber} enviado`,
        description: att.sentMessage || 'Mensaje de seguimiento enviado por WhatsApp.',
        iconType: 'sent',
        badge: `Intento ${att.attemptNumber}`
      });

      // Confirmación de entrega
      if (att.deliveredAt) {
        events.push({
          id: `evt_att_delivered_${att.id || att.attemptNumber}`,
          time: new Date(att.deliveredAt),
          title: `Intento #${att.attemptNumber} entregado`,
          description: 'El mensaje llegó correctamente al dispositivo del cliente.',
          iconType: 'delivered',
          badge: '✓✓ Entregado'
        });
      }

      // Confirmación de lectura
      if (att.readAt) {
        events.push({
          id: `evt_att_read_${att.id || att.attemptNumber}`,
          time: new Date(att.readAt),
          title: `Intento #${att.attemptNumber} leído`,
          description: 'El cliente abrió y leyó el mensaje.',
          iconType: 'read',
          badge: '✓✓ Leído'
        });
      }
    } else if (att.status === 'PROCESSING') {
      events.push({
        id: `evt_att_proc_${att.id || att.attemptNumber}`,
        time: new Date(att.scheduledAt || Date.now()),
        title: `Preparando intento #${att.attemptNumber}`,
        description: 'Verificando horario y redactando mensaje...',
        iconType: 'processing',
        badge: 'En curso'
      });
    } else if (att.status === 'FAILED' || att.status === 'SKIPPED_POLICY') {
      events.push({
        id: `evt_att_failed_${att.id || att.attemptNumber}`,
        time: new Date(att.scheduledAt || Date.now()),
        title: `Intento #${att.attemptNumber} no enviado`,
        description: att.errorMessage || 'No se pudo enviar por restricciones de horario o política.',
        iconType: 'failed',
        badge: 'Omitido'
      });
    }
  });

  // 4. Hito de Recuperación
  if (sequence.status === 'RECOVERED' && sequence.recoveredAt) {
    const isAttributedSale = sequence.orderId || false;
    events.push({
      id: 'evt_recovered',
      time: new Date(sequence.recoveredAt),
      title: isAttributedSale ? '¡Venta recuperada!' : 'Cliente respondió · ¡Recuperado!',
      description: isAttributedSale
        ? 'El cliente retomó la conversación y concretó la compra.'
        : 'El cliente contestó al seguimiento y reactivó el proceso comercial.',
      iconType: 'recovered',
      badge: 'Éxito',
      isSuccess: true
    });
  }

  // 5. Cancelación si aplica
  if (sequence.status === 'CANCELLED') {
    const cancelTime = sequence.updatedAt || new Date();
    events.push({
      id: 'evt_cancelled',
      time: new Date(cancelTime),
      title: 'Seguimiento detenido',
      description: formatCancelReason(sequence.cancelReason),
      iconType: 'cancelled',
      badge: 'Detenido'
    });
  }

  // 6. Agotado tras 3 intentos
  if (sequence.status === 'EXHAUSTED') {
    const exhaustTime = sequence.updatedAt || new Date();
    events.push({
      id: 'evt_exhausted',
      time: new Date(exhaustTime),
      title: 'Secuencia finalizada',
      description: 'Se completaron los 3 intentos programados sin respuesta del cliente.',
      iconType: 'exhausted',
      badge: 'Finalizado'
    });
  }

  // Ordenar cronológicamente ascendente
  events.sort((a, b) => a.time.getTime() - b.time.getTime());

  // Formatear display de tiempo
  return events.map(e => ({
    ...e,
    timeFormatted: formatShortDateTime(e.time, timeZone)
  }));
}
