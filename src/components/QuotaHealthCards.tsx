import type { QuotaSnapshot } from '../../api/_lib/types.js'
import type { QuotaBar } from '../lib/quota-cards.js'
import { buildQuotaCards } from '../lib/quota-cards.js'

interface QuotaHealthCardsProps {
  snapshots: QuotaSnapshot[]
  now: number
}

const levelColor: Record<QuotaBar['level'], string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  critical: 'bg-red-500',
  unknown: 'bg-slate-400',
}

function formatPercent(percent: number | null): string {
  return percent === null ? '--' : `${Math.round(percent)}%`
}

export function QuotaHealthCards({ snapshots, now }: QuotaHealthCardsProps) {
  const bars = buildQuotaCards(snapshots, now)

  return (
    <>
      {bars.map((bar) => (
        <div
          key={bar.id}
          data-testid={`quota-card-${bar.id}`}
          className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-slate-600">{bar.label}</span>
            <span className="text-2xl font-semibold text-slate-900">
              {formatPercent(bar.percent)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={bar.percent ?? 0}
            aria-label={bar.label}
            className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
          >
            <div
              className={`h-full rounded-full transition-all ${levelColor[bar.level]}`}
              style={{ width: `${bar.percent ?? 0}%` }}
            />
          </div>
          <span className="text-xs text-slate-500">Reset in {bar.resetText}</span>
        </div>
      ))}
    </>
  )
}
