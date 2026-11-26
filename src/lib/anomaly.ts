import type { LogEntry } from '../../api/_lib/types.js'
import { tokensPerMinute } from './quota.js'

export const LOOP_WINDOW_MS = 180_000
export const LOOP_MIN_TOKENS = 30_000
const DEFAULT_BUCKETS = 3

export interface AgentTokenSample {
  agentId: string
  at: number
  tokens: number
}

export interface LoopOptions {
  windowMs?: number
  minTokens?: number
  buckets?: number
}

export interface LoopAlert {
  agentId: string
  totalTokens: number
  turns: number
  tpm: number
}

export function toAgentSample(
  e: Pick<LogEntry, 'agent_id' | 'input_tokens' | 'output_tokens'>,
  at: number,
): AgentTokenSample {
  return { agentId: e.agent_id, at, tokens: e.input_tokens + e.output_tokens }
}

export function detectLoops(
  samples: AgentTokenSample[],
  now: number,
  opts: LoopOptions = {},
): LoopAlert[] {
  const windowMs = opts.windowMs ?? LOOP_WINDOW_MS
  const minTokens = opts.minTokens ?? LOOP_MIN_TOKENS
  const buckets = Math.max(1, opts.buckets ?? DEFAULT_BUCKETS)
  const windowStart = now - windowMs
  const bucketSize = windowMs / buckets

  const groups = new Map<string, AgentTokenSample[]>()
  for (const sample of samples) {
    if (sample.at <= windowStart || sample.at > now) continue
    if (sample.tokens <= 0) continue
    const list = groups.get(sample.agentId)
    if (list === undefined) groups.set(sample.agentId, [sample])
    else list.push(sample)
  }

  const alerts: LoopAlert[] = []
  for (const [agentId, group] of groups) {
    const occupied = new Set<number>()
    let totalTokens = 0
    for (const sample of group) {
      totalTokens += sample.tokens
      const index = Math.ceil((sample.at - windowStart) / bucketSize) - 1
      occupied.add(Math.min(buckets - 1, Math.max(0, index)))
    }
    if (occupied.size < buckets) continue
    if (totalTokens < minTokens) continue
    alerts.push({
      agentId,
      totalTokens,
      turns: group.length,
      tpm: tokensPerMinute(group, now, windowMs),
    })
  }

  return alerts.sort((a, b) => b.totalTokens - a.totalTokens)
}
