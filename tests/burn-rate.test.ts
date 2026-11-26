import { describe, expect, it } from 'vitest'
import type { LogEntry, QuotaSnapshot } from '../api/_lib/types.js'
import { buildAgentFeed, buildBurnRate, type FeedTurn } from '../src/lib/burn-rate.js'

const MS = 1_000

function entry(agentId: string, input: number, output = 0, cacheRead = 0): LogEntry {
  return {
    provider: 'opencode_go',
    agent_id: agentId,
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
  }
}

function makeTurn(id: string, at: number, e: LogEntry): FeedTurn {
  return { id, at, entry: e }
}

describe('burn-rate helpers', () => {
  it('T1: computes tpm, a single loop alert and time-to-limit for the opencode cycle', () => {
    const now = 1_000_000_000_000
    const resetAt = new Date(now + 3_600_000).toISOString()
    const opencodeSnapshot: QuotaSnapshot = {
      provider: 'opencode_go',
      window_5h_percent: null,
      window_7d_percent: null,
      cycle_tokens_used: 9_000_000,
      cycle_token_limit: 10_000_000,
      reset_at: resetAt,
      updated_at: new Date(now).toISOString(),
    }
    const claudeSnapshot: QuotaSnapshot = {
      provider: 'claude_code',
      window_5h_percent: 40,
      window_7d_percent: 20,
      cycle_tokens_used: 0,
      cycle_token_limit: null,
      reset_at: resetAt,
      updated_at: new Date(now).toISOString(),
    }
    const turns: FeedTurn[] = [
      makeTurn('a-0', now - 400 * MS, entry('a', 12_000)),
      makeTurn('a-1', now - 150 * MS, entry('a', 12_000)),
      makeTurn('a-2', now - 90 * MS, entry('a', 12_000)),
      makeTurn('a-3', now - 30 * MS, entry('a', 12_000)),
      makeTurn('b-1', now - 20 * MS, entry('b', 1_000)),
    ]

    const burn = buildBurnRate(turns, [opencodeSnapshot], now)

    expect(burn.tpm).toBe(37_000 / 3)
    expect(burn.alerts).toHaveLength(1)
    expect(burn.alerts[0]).toMatchObject({ agentId: 'a', totalTokens: 36_000, turns: 3 })
    expect(burn.timeToLimitMs).toBe((1_000_000 / burn.tpm) * 60_000)

    expect(buildBurnRate(turns, [claudeSnapshot], now).timeToLimitMs).toBeNull()
  })

  it('T2: sorts the feed newest first, computes cache ratio, defaults and applies limits', () => {
    const now = 1_000_000_000_000
    const turns: FeedTurn[] = [
      makeTurn('t1', now - 90 * MS, entry('old-agent', 100, 50)),
      makeTurn('t2', now - 80 * MS, entry('agent-2', 200, 100, 100)),
      makeTurn('t3', now - 70 * MS, entry('agent-3', 300, 400, 100)),
      makeTurn('t4', now - 60 * MS, entry('agent-4', 0, 50)),
      makeTurn('t5', now - 50 * MS, entry('agent-5', 10, 5)),
      makeTurn('t6', now - 40 * MS, entry('agent-6', 20, 10)),
      makeTurn('t7', now - 30 * MS, entry('agent-7', 30, 15)),
      makeTurn('t8', now - 20 * MS, entry('agent-8', 40, 20)),
      makeTurn('t9', now - 12 * MS, entry('agent-9', 60, 30)),
      makeTurn('t10', now - 5 * MS, entry('agent-10', 70, 35)),
    ]

    const rows = buildAgentFeed(turns, now)
    expect(rows).toHaveLength(8)
    expect(rows[0]?.id).toBe('t10')
    expect(rows.find((r) => r.id === 't3')).toMatchObject({
      cachePercent: 25,
      model: '--',
      task: '--',
    })
    expect(rows.find((r) => r.id === 't9')?.ageText).toBe('12s ago')
    expect(rows.find((r) => r.id === 't4')?.cachePercent).toBeNull()

    expect(buildAgentFeed(turns, now, 3)).toHaveLength(3)
  })
})
