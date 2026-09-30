import React, { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  MapPin,
  Tag,
  CheckCircle,
  Clock,
  WarningCircle,
  ArrowClockwise,
  SpinnerGap,
  Sparkle,
  ShoppingBag,
  ListChecks
} from '@phosphor-icons/react';
import { getCustomerSummary } from '../../services/chatService';

/**
 * Formatea un timestamp ISO relativo ("hace 2 min", "hace 1 h", "recién")
 */
function formatTimeAgo(isoString) {
  if (!isoString) return 'hace un momento';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'recién';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  return `hace ${diffDays} d`;
}

/**
 * Componente de Inteligencia de Cliente y Resumen Compacto
 * FASE D: AI CUSTOMER SUMMARY + HUMAN NOTES INTELLIGENCE
 */
export default function CustomerIntelligenceSummary({
  chatId,
  customerName = '',
  refreshTrigger = 0
}) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSummary = useCallback(async () => {
    if (!chatId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getCustomerSummary(chatId);
      if (res?.success && res.summary) {
        setSummary(res.summary);
      } else {
        setSummary(null);
      }
    } catch (err) {
      console.warn('[CustomerIntelligenceSummary] Error obteniendo resumen:', err);
      setError('No se pudo cargar el resumen');
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary, refreshTrigger]);

  if (loading && !summary) {
    return (
      <div className="p-3.5 rounded-2xl bg-app border border-line animate-pulse space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="h-4 w-28 bg-line rounded-md" />
          <div className="h-3 w-16 bg-line rounded-md" />
        </div>
        <div className="h-4 w-3/4 bg-line rounded-md" />
        <div className="h-3 w-1/2 bg-line rounded-md" />
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between text-xs text-amber-600 dark:text-amber-400">
        <div className="flex items-center gap-1.5">
          <WarningCircle size={14} weight="bold" />
          <span>{error}</span>
        </div>
        <button
          onClick={fetchSummary}
          className="p-1 rounded-lg hover:bg-amber-500/20 transition-colors cursor-pointer"
          title="Reintentar"
        >
          <ArrowClockwise size={13} weight="bold" />
        </button>
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  const {
    customer = {},
    currentIntent = {},
    preferences = [],
    commercialStatus = {},
    lastRelevantMilestone = null,
    pendingActions = [],
    updatedAt
  } = summary;

  const displayName = customer.displayName || customerName || 'Cliente';
  const hasIntent = currentIntent?.label || currentIntent?.productName;
  const hasPreferences = preferences && preferences.length > 0;
  const hasPending = pendingActions && pendingActions.length > 0;

  // Si no hay datos comerciales, ni preferencias, ni pendientes (Empty State FASE D29)
  const isBrandNew = !hasIntent && !hasPreferences && !hasPending && !lastRelevantMilestone;

  return (
    <section
      aria-label="Resumen Inteligente del Cliente"
      className="p-3.5 rounded-2xl bg-app/80 border border-line shadow-sm relative overflow-hidden group hover:border-brand/30 transition-all duration-200"
    >
      {/* ── Encabezado ── */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-line/60">
        <div className="flex items-center gap-1.5 text-brand font-bold text-xs">
          <Brain size={16} weight="fill" />
          <span>Resumen IA</span>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-lo">
          <span>Actualizado {formatTimeAgo(updatedAt)}</span>
          <button
            onClick={fetchSummary}
            className="p-0.5 rounded text-lo hover:text-hi hover:bg-card transition-colors cursor-pointer"
            title="Refrescar resumen"
            aria-label="Refrescar resumen de cliente"
          >
            <ArrowClockwise size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Estado Vacío (Cliente nuevo) ── */}
      {isBrandNew ? (
        <div className="py-3 px-1 text-center space-y-1">
          <p className="text-xs font-semibold text-hi">{displayName}</p>
          <p className="text-xs text-lo italic">Estamos aprendiendo sobre este cliente.</p>
        </div>
      ) : (
        <div className="pt-2.5 space-y-2.5 text-xs">
          {/* Identidad */}
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-bold text-hi text-[13px] leading-tight truncate">
              {displayName}
            </span>
            {customer.city && (
              <span className="inline-flex items-center gap-1 text-[11px] text-lo font-medium flex-shrink-0">
                <MapPin size={12} weight="fill" className="text-rose-500" />
                {customer.city}
              </span>
            )}
          </div>

          {/* Interés Actual (FASE D9) */}
          {hasIntent && (
            <div className="space-y-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-lo">
                Interés
              </span>
              <div className="flex items-center gap-1.5 text-hi font-medium">
                <ShoppingBag size={13} className="text-brand flex-shrink-0" weight="bold" />
                <span className="truncate">{currentIntent.productName || currentIntent.label}</span>
              </div>
            </div>
          )}

          {/* Preferencias (FASE D3 & D7: Max 3) */}
          {hasPreferences && (
            <div className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-lo">
                Preferencias
              </span>
              <div className="flex flex-wrap gap-1">
                {preferences.slice(0, 3).map((pref, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-card border border-line text-hi font-medium"
                  >
                    <span className="text-lo">{pref.label}:</span>
                    <span>{pref.value}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Estado Comercial Humano (FASE D10) */}
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-lo">
              Estado
            </span>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-brand/10 text-brand border border-brand/20">
              {commercialStatus.label || 'En atención'}
            </span>
          </div>

          {/* Último Hito Relevante (FASE D11) */}
          {lastRelevantMilestone && (
            <div className="flex items-start gap-1.5 p-1.5 rounded-lg bg-card/60 border border-line/60 text-[11px] text-hi">
              <Sparkle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" weight="fill" />
              <div className="min-w-0">
                <p className="font-medium truncate">{lastRelevantMilestone.label}</p>
                <p className="text-[10px] text-lo">{formatTimeAgo(lastRelevantMilestone.occurredAt)}</p>
              </div>
            </div>
          )}

          {/* Acciones Pendientes (FASE D12: Max 2) */}
          {hasPending && (
            <div className="space-y-1 pt-1 border-t border-line/60">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-lo flex items-center gap-1">
                <ListChecks size={12} weight="bold" />
                Pendiente
              </span>
              <div className="space-y-1">
                {pendingActions.slice(0, 2).map((task) => (
                  <div
                    key={task.taskId}
                    className="flex items-center justify-between gap-1.5 text-[11px] p-1.5 rounded-lg bg-card border border-line"
                  >
                    <span className="truncate text-hi font-medium">
                      {task.label}
                    </span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                        task.priority === 'HIGH'
                          ? 'bg-rose-500/15 text-rose-600'
                          : 'bg-line text-lo'
                      }`}
                    >
                      {task.priority === 'HIGH' ? 'ALTA' : 'NORMAL'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
