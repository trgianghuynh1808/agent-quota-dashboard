import type { QuotaSnapshot } from '../../api/_lib/types.js'
import { buildBurnRate, type FeedTurn } from '../lib/burn-rate.js'
import { countdown, formatCountdown } from '../lib/quota.js'

interface BurnRateMonitorProps {
  turns: FeedTurn[]
  snapshots: QuotaSnapshot[]
  now: number
}

function formatTimeToLimit(ms: number | null, now: number): string {
  if (ms === null) return '--'
  const until = new Date(now + ms).toISOString()
  return formatCountdown(countdown(until, now))
}

function formatTokens(n: number): string {
  return n.toLocaleString('en-US')
}

export function BurnRateMonitor({ turns, snapshots, now }: BurnRateMonitorProps) {
  const burn = buildBurnRate(turns, snapshots, now)

  return (
    <section
      data-testid="burn-rate-monitor"
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-600">Burn Rate</span>
        <span className="text-2xl font-semibold text-slate-900">
          {formatTokens(Math.round(burn.tpm))}
          <span className="ml-1 text-sm font-normal text-slate-500">tokens/min</span>
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-600">Time to limit</span>
        <span className="text-lg font-semibold text-slate-900">
          {formatTimeToLimit(burn.timeToLimitMs, now)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {burn.alerts.map((alert) => (
          <span
            key={alert.agentId}
            data-testid={`loop-alert-${alert.agentId}`}
            className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"
          >
            Loop: {alert.agentId} · {formatTokens(alert.totalTokens)} tokens · {alert.turns} turns
          </span>
        ))}
      </div>
    </section>
  )
}
