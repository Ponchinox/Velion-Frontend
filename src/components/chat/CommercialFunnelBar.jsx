import React from 'react';
import { 
  Check, 
  CaretRight, 
  Circle, 
  ShieldCheck, 
  WarningCircle, 
  Clock 
} from '@phosphor-icons/react';

// Etapas del embudo de conversión canónico en orden cronológico
export const FUNNEL_STAGES = [
  { id: 'EXPLORING', label: 'Explorando' },
  { id: 'PRODUCT_SELECTED', label: 'Producto' },
  { id: 'DETAILS_PROVIDED', label: 'Datos' },
  { id: 'SHIPPING_COORDINATED', label: 'Envío' },
  { id: 'PAYMENT_PENDING', label: 'Pago' },
  { id: 'VERIFYING', label: 'Verificación' },
  { id: 'COMPLETED', label: 'Completado' }
];

export const AUXILIARY_STAGES = {
  HUMAN_HANDOFF: { label: 'Atención Humana Solicitada', color: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20' },
  SUPPORT: { label: 'En Soporte Postventa', color: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20' },
  ABANDONED: { label: 'Conversación Inactiva', color: 'bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20' }
};

export default function CommercialFunnelBar({ chat }) {
  if (!chat) return null;

  const currentStage = chat.commercialStage || 'EXPLORING';
  const stageLabel = chat.commercialStageLabel || 'Explorando productos';
  const commercialState = chat.commercialState || {};

  const activeIndex = FUNNEL_STAGES.findIndex(s => s.id === currentStage);
  const isAuxiliary = activeIndex === -1 && AUXILIARY_STAGES[currentStage];

  return (
    <div 
      className="bg-app/80 dark:bg-card/90 border-b border-line px-3 py-1.5 flex items-center justify-between gap-3 text-xs flex-shrink-0 select-none overflow-x-auto no-scrollbar"
      role="region"
      aria-label="Embudo comercial"
    >
      {/* Etiqueta compacta de estado actual */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[11px] font-semibold text-lo uppercase tracking-wider flex items-center gap-1">
          <Clock size={12} className="text-mid" />
          <span>Embudo:</span>
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-brand/10 text-brand border border-brand/20 whitespace-nowrap">
          {stageLabel}
        </span>
        {commercialState.productName && (
          <span className="hidden lg:inline text-[11px] text-lo font-medium max-w-[180px] truncate" title={commercialState.productName}>
            ({commercialState.productName})
          </span>
        )}
      </div>

      {/* Visualización de etapas (Stepper continuo / responsive) */}
      {isAuxiliary ? (
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${AUXILIARY_STAGES[currentStage]?.color}`}>
            <WarningCircle size={12} />
            <span>{AUXILIARY_STAGES[currentStage]?.label}</span>
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0 overflow-x-auto py-0.5">
          {FUNNEL_STAGES.map((step, idx) => {
            const isCompleted = activeIndex > idx;
            const isCurrent = activeIndex === idx;
            const isUpcoming = activeIndex < idx;

            return (
              <React.Fragment key={step.id}>
                {idx > 0 && (
                  <CaretRight 
                    size={10} 
                    className={`flex-shrink-0 ${isCompleted ? 'text-emerald-500' : 'text-line'}`} 
                  />
                )}
                <div
                  className={`
                    inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all whitespace-nowrap
                    ${isCurrent
                      ? 'bg-brand text-white font-bold shadow-xs'
                      : isCompleted
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 font-semibold'
                        : 'text-lo opacity-50'
                    }
                  `}
                  title={`Etapa ${idx + 1}: ${step.label}${isCurrent ? ' (Actual)' : isCompleted ? ' (Completada)' : ''}`}
                >
                  {isCompleted ? (
                    <Check size={10} weight="bold" className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                  ) : isCurrent ? (
                    <Circle size={6} weight="fill" className="text-white animate-pulse flex-shrink-0" />
                  ) : null}
                  <span>{step.label}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
