import React from 'react';
import {
  User,
  Robot,
  Receipt,
  CheckCircle,
  WarningCircle,
  Package,
  ArrowBendUpLeft,
  CheckSquareOffset,
  Info
} from '@phosphor-icons/react';

/**
 * Mapeo de iconos temáticos por tipo de evento
 */
function getEventIcon(eventType, severity) {
  switch (eventType) {
    case 'HUMAN_HANDOFF_REQUESTED':
    case 'HUMAN_AGENT_JOINED':
      return <User size={13} weight="bold" className="shrink-0" />;
    case 'BOT_RESUMED':
      return <Robot size={13} weight="bold" className="shrink-0" />;
    case 'PAYMENT_EVIDENCE_RECEIVED':
      return <Receipt size={13} weight="bold" className="shrink-0" />;
    case 'PAYMENT_VERIFIED':
    case 'SALE_COMPLETED':
      return <CheckCircle size={13} weight="bold" className="shrink-0 text-emerald-600 dark:text-emerald-400" />;
    case 'PAYMENT_REJECTED':
      return <WarningCircle size={13} weight="bold" className="shrink-0 text-amber-600 dark:text-amber-400" />;
    case 'ORDER_CREATED':
      return <Package size={13} weight="bold" className="shrink-0" />;
    case 'COMPLAINT_DETECTED':
      return <WarningCircle size={13} weight="bold" className="shrink-0 text-rose-600 dark:text-rose-400" />;
    case 'FOLLOWUP_SENT':
      return <ArrowBendUpLeft size={13} weight="bold" className="shrink-0" />;
    case 'OPERATIONAL_TASK_COMPLETED':
      return <CheckSquareOffset size={13} weight="bold" className="shrink-0" />;
    default:
      return <Info size={13} weight="bold" className="shrink-0" />;
  }
}

/**
 * Estilos discretos según severidad (FASE C13)
 */
function getSeverityStyles(severity) {
  switch (severity) {
    case 'SUCCESS':
      return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300';
    case 'WARNING':
      return 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300';
    case 'HIGH':
      return 'border-rose-500/25 bg-rose-500/10 text-rose-800 dark:text-rose-300';
    case 'NORMAL':
    default:
      return 'border-line/70 bg-card/90 text-hi/80 dark:text-mid shadow-xs';
  }
}

/**
 * SystemTimelineItem — Componente de hito visual del chat (FASE C12, C13, C26, C34, C35).
 * 
 * Requisitos:
 * - Diseño compacto tipo hito / pill centrado con líneas laterales.
 * - Sanitizado estricto contra XSS (texto plano puro).
 * - Accesible con role="status" y aria-label.
 * - Altamente responsivo en desktop, tablet y mobile.
 */
export default function SystemTimelineItem({ item }) {
  if (!item) return null;

  const severityStyle = getSeverityStyles(item.severity);
  const icon = getEventIcon(item.eventType, item.severity);

  // Formato de hora seguro
  const displayTime = item.time || (item.occurredAt
    ? new Date(item.occurredAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : '');

  return (
    <div
      className="my-3 flex items-center justify-center w-full px-2"
      role="status"
      aria-label={`${item.title}${item.description ? ` - ${item.description}` : ''}`}
    >
      <div className="flex-1 h-px bg-line/50 max-w-[40px] sm:max-w-[80px]" />
      
      <div
        className={`
          inline-flex flex-col items-center justify-center
          mx-2 px-3 py-1.5 rounded-full border
          text-[11px] sm:text-xs font-medium tracking-tight
          transition-colors duration-150
          max-w-[92%] sm:max-w-md
          ${severityStyle}
        `}
      >
        <div className="flex items-center gap-1.5 flex-wrap justify-center text-center">
          {icon}
          <span className="font-semibold text-hi dark:text-white select-text">
            {String(item.title || 'Evento del sistema')}
          </span>
          {displayTime && (
            <span className="text-[10px] text-lo dark:text-lo/80 font-mono ml-1 select-none">
              · {displayTime}
            </span>
          )}
        </div>

        {item.description && (
          <p className="text-[10px] sm:text-[11px] text-lo dark:text-mid mt-0.5 text-center leading-tight line-clamp-2 select-text">
            {String(item.description)}
          </p>
        )}
      </div>

      <div className="flex-1 h-px bg-line/50 max-w-[40px] sm:max-w-[80px]" />
    </div>
  );
}
