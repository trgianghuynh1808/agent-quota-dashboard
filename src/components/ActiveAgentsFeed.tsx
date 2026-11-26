import { buildAgentFeed, type FeedTurn } from '../lib/burn-rate.js'

interface ActiveAgentsFeedProps {
  turns: FeedTurn[]
  now: number
  limit?: number
}

function formatTokens(n: number): string {
  return n.toLocaleString('en-US')
}

function formatCache(percent: number | null): string {
  return percent === null ? '--' : `${percent}%`
}

export function ActiveAgentsFeed({ turns, now, limit = 8 }: ActiveAgentsFeedProps) {
  const rows = buildAgentFeed(turns, now, limit)

  return (
    <section
      data-testid="agents-feed"
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-600">Active Agents</span>
        <span className="text-xs text-slate-500">{rows.length} recent turns</span>
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.id}
            data-testid={`feed-row-${row.id}`}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-slate-50 px-3 py-2"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-slate-800">{row.agentId}</span>
              <span className="truncate text-xs text-slate-500">
                {row.model} · {row.task}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-medium text-slate-700">{formatTokens(row.tokens)} tok</span>
              <span className="text-slate-500">cache {formatCache(row.cachePercent)}</span>
              <span className="text-slate-400">{row.ageText}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
