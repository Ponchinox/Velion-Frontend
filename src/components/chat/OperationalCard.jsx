import React from 'react';
import {
  CheckCircle,
  Clock,
  XCircle,
  Archive,
  Play,
  CalendarBlank,
  User,
  Robot,
  FileText,
  CheckSquareOffset,
  SpinnerGap,
} from '@phosphor-icons/react';
import {
  formatStatus,
  formatPriority,
  formatCategory,
  formatCreatedByType,
  formatDueDate,
  formatDateTime,
} from '../../utils/operationalFormatters';

/**
 * Tarjeta individual para Tarea o Nota operacional
 * Velion Business Agent — Fase 2D-B
 */
export default function OperationalCard({
  item,
  isProcessing = false,
  isAnyProcessing = false,
  onStart,
  onComplete,
  onCancel,
  onArchive,
}) {
  const isTask = item.type === 'TASK';
  const isNote = item.type === 'NOTE';
  const isDisabled = isProcessing || isAnyProcessing;

  // Badges visuales de estado
  const renderStatusBadge = () => {
    switch (item.status) {
      case 'IN_PROGRESS':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-brand border border-blue-200">
            <Clock size={12} weight="bold" />
            {formatStatus(item.status)}
          </span>
        );
      case 'PENDING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock size={12} weight="bold" />
            {formatStatus(item.status)}
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle size={12} weight="bold" />
            {formatStatus(item.status)}
          </span>
        );
      case 'CANCELED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
            <XCircle size={12} weight="bold" />
            {formatStatus(item.status)}
          </span>
        );
      case 'ACTIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle size={12} weight="bold" />
            {formatStatus(item.status)}
          </span>
        );
      case 'ARCHIVED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-500 border border-gray-200">
            <Archive size={12} weight="bold" />
            {formatStatus(item.status)}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-700">
            {formatStatus(item.status)}
          </span>
        );
    }
  };

  // Badges de prioridad
  const renderPriorityBadge = () => {
    if (!item.priority) return null;
    let colorCls = 'bg-gray-100 text-gray-700 border-gray-200';
    if (item.priority === 'HIGH') {
      colorCls = 'bg-rose-50 text-rose-700 border-rose-200';
    } else if (item.priority === 'NORMAL') {
      colorCls = 'bg-sky-50 text-sky-700 border-sky-200';
    }

    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${colorCls}`}>
        {formatPriority(item.priority)}
      </span>
    );
  };

  // Fecha de vencimiento formateada
  const formattedDueDate = formatDueDate(item.dueDateLocal, item.dueTimeLocal);

  return (
    <div
      className={`
        relative rounded-xl border p-4 transition-all duration-fast
        ${item.status === 'COMPLETED' || item.status === 'CANCELED' || item.status === 'ARCHIVED'
          ? 'bg-app/40 border-line text-mid opacity-80'
          : 'bg-card border-line shadow-card hover:border-line-strong'
        }
      `}
    >
      {/* ── Header de la tarjeta: Tipo, Categoría, Estado ── */}
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`
              inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider
              ${isTask ? 'bg-brand/10 text-brand' : 'bg-purple-100 text-purple-700'}
            `}
          >
            {isTask ? <CheckSquareOffset size={12} weight="bold" /> : <FileText size={12} weight="bold" />}
            {isTask ? 'Tarea' : 'Nota'}
          </span>

          <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-app text-mid border border-line">
            {formatCategory(item.category, item.type)}
          </span>

          {isTask && renderPriorityBadge()}
        </div>

        <div className="flex items-center gap-1.5">
          {renderStatusBadge()}
        </div>
      </div>

      {/* ── Contenido principal: Título y Resumen ── */}
      <div className="mb-3 space-y-1">
        {item.title && item.title !== item.summary && (
          <h4 className="text-sm font-semibold text-hi leading-snug">{item.title}</h4>
        )}
        <p className="text-sm text-hi leading-relaxed whitespace-pre-wrap break-words">{item.summary}</p>
      </div>

      {/* ── Metadatos del Negocio: Sujeto, Fecha de vencimiento, Origen ── */}
      <div className="space-y-1.5 text-xs text-lo border-t border-line/60 pt-2.5">
        {item.subjectName && (
          <div className="flex items-center gap-1.5 text-mid font-medium">
            <User size={13} className="text-muted flex-shrink-0" />
            <span className="truncate">{item.subjectName}</span>
          </div>
        )}

        {isTask && formattedDueDate && (
          <div className="flex items-center gap-1.5 text-mid font-medium">
            <CalendarBlank size={13} className="text-brand flex-shrink-0" />
            <span>Vence: <strong className="text-hi">{formattedDueDate}</strong></span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 text-[11px] text-muted pt-1">
          <div className="flex items-center gap-1 truncate">
            {item.createdByType === 'AI' ? (
              <Robot size={12} className="text-brand flex-shrink-0" weight="bold" />
            ) : (
              <User size={12} className="text-muted flex-shrink-0" />
            )}
            <span>{formatCreatedByType(item.createdByType)}</span>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {item.completedAt && (
              <span title={`Completada: ${formatDateTime(item.completedAt)}`}>
                ✓ {formatDateTime(item.completedAt)}
              </span>
            )}
            <span>{formatDateTime(item.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* ── Botones de Ciclo de Vida ── */}
      <div className="mt-3.5 pt-2.5 border-t border-line flex items-center justify-end gap-2">
        {/* Tarea PENDING */}
        {isTask && item.status === 'PENDING' && (
          <>
            <button
              onClick={() => onStart(item)}
              disabled={isDisabled}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Iniciar tarea (pasa a En Progreso)"
              aria-label="Iniciar tarea"
            >
              {isProcessing ? <SpinnerGap size={12} className="animate-spin" /> : <Play size={12} weight="fill" />}
              Iniciar
            </button>
            <button
              onClick={() => onComplete(item)}
              disabled={isDisabled}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Completar tarea"
              aria-label="Completar tarea"
            >
              {isProcessing ? <SpinnerGap size={12} className="animate-spin" /> : <CheckCircle size={12} weight="bold" />}
              Completar
            </button>
            <button
              onClick={() => onCancel(item)}
              disabled={isDisabled}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-app hover:bg-line text-lo hover:text-danger border border-line transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Cancelar tarea"
              aria-label="Cancelar tarea"
            >
              {isProcessing ? <SpinnerGap size={12} className="animate-spin" /> : <XCircle size={12} />}
              Cancelar
            </button>
          </>
        )}

        {/* Tarea IN_PROGRESS */}
        {isTask && item.status === 'IN_PROGRESS' && (
          <>
            <button
              onClick={() => onComplete(item)}
              disabled={isDisabled}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Completar tarea"
              aria-label="Completar tarea"
            >
              {isProcessing ? <SpinnerGap size={13} className="animate-spin" /> : <CheckCircle size={13} weight="bold" />}
              Completar
            </button>
            <button
              onClick={() => onCancel(item)}
              disabled={isDisabled}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-app hover:bg-line text-lo hover:text-danger border border-line transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Cancelar tarea"
              aria-label="Cancelar tarea"
            >
              {isProcessing ? <SpinnerGap size={13} className="animate-spin" /> : <XCircle size={13} />}
              Cancelar
            </button>
          </>
        )}

        {/* Nota ACTIVE */}
        {isNote && item.status === 'ACTIVE' && (
          <button
            onClick={() => onArchive(item)}
            disabled={isDisabled}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-app hover:bg-line text-lo hover:text-hi border border-line transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            title="Archivar nota"
            aria-label="Archivar nota"
          >
            {isProcessing ? <SpinnerGap size={12} className="animate-spin" /> : <Archive size={12} />}
            Archivar
          </button>
        )}

        {/* Estados terminales / read-only */}
        {((isTask && (item.status === 'COMPLETED' || item.status === 'CANCELED')) ||
          (isNote && item.status === 'ARCHIVED')) && (
          <span className="text-xs text-muted italic">
            Solo lectura
          </span>
        )}
      </div>
    </div>
  );
}
