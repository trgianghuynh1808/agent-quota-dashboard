import type { LogEntry } from '../../api/_lib/types.js'
import type { LoopAlert } from './anomaly.js'
import { detectLoops, toAgentSample } from './anomaly.js'
import { cacheRatio, tokensPerMinute } from './quota.js'

const MS_PER_SECOND = 1_000

export interface FeedTurn {
  id: string
  at: number
  entry: LogEntry
}

export interface BurnRate {
  tpm: number
  alerts: LoopAlert[]
}

export interface FeedRow {
  id: string
  agentId: string
  model: string
  task: string
  tokens: number
  cachePercent: number | null
  ageText: string
}

export function buildBurnRate(turns: FeedTurn[], now: number): BurnRate {
  const samples = turns.map((t) => toAgentSample(t.entry, t.at))
  const tpm = tokensPerMinute(samples, now)
  return { tpm, alerts: detectLoops(samples, now) }
}

function ageText(at: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / MS_PER_SECOND))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

export function buildAgentFeed(turns: FeedTurn[], now: number, limit = 8): FeedRow[] {
  return [...turns]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((t) => {
      const ratio = cacheRatio(
        t.entry.cache_read_tokens,
        t.entry.input_tokens + t.entry.cache_read_tokens,
      )
      return {
        id: t.id,
        agentId: t.entry.agent_id,
        model: t.entry.model ?? '--',
        task: t.entry.task_name ?? '--',
        tokens: t.entry.input_tokens + t.entry.output_tokens,
        cachePercent: ratio === null ? null : Math.round(ratio * 100),
        ageText: ageText(t.at, now),
      }
    })
}
