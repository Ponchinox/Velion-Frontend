import { TrendUp, TrendDown, Minus } from '@phosphor-icons/react';

const CHANGE_CFG = {
  up:      { Icon: TrendUp,   cls: 'text-success bg-green-50 border-green-200'  },
  down:    { Icon: TrendDown, cls: 'text-danger  bg-red-50   border-red-200'    },
  neutral: { Icon: Minus,     cls: 'text-lo      bg-app      border-line'       },
};

/**
 * MetricCard — Commercial Light
 * Props: title, value, change, changeType ("up"|"down"|"neutral"), description, icon
 */
export default function MetricCard({ title, value, change, changeType = 'neutral', description, icon: MetricIcon }) {
  const { Icon: ChangeIcon, cls } = CHANGE_CFG[changeType] ?? CHANGE_CFG.neutral;

  return (
    <article
      className="bg-card border border-line rounded-lg shadow-card p-6 flex flex-col gap-4
                 hover:shadow-card-md transition-shadow duration-[200ms]"
      aria-label={`Métrica: ${title}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {MetricIcon && (
            <MetricIcon size={18} weight="regular" className="text-brand" aria-hidden="true" />
          )}
          <p className="text-sm font-semibold text-lo uppercase tracking-wide">{title}</p>
        </div>
      </div>

      {/* Value */}
      <p className="text-3xl font-bold text-hi tracking-tight font-mono">{value}</p>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-line">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cls}`}>
          <ChangeIcon size={12} weight="bold" aria-hidden="true" />
          {change}
        </span>
        {description && (
          <span className="text-xs text-muted">{description}</span>
        )}
      </div>
    </article>
  );
}
