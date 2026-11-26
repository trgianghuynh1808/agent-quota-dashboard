import { describe, expect, it, vi } from 'vitest'
import type { Control, LogEntry, QuotaSnapshot } from '../api/_lib/types.js'
import type { FeedTurn } from '../src/lib/burn-rate.js'
import {
  prependTurn,
  rowToControl,
  rowToSnapshot,
  rowToTurn,
  startLive,
  upsertSnapshot,
} from '../src/lib/live-data.js'
import type { LiveSource, LiveSourceHandlers, LiveState } from '../src/lib/live-data.js'

function makeTurn(id: string, agentId = 'agent-x'): FeedTurn {
  const entry: LogEntry = {
    provider: 'opencode_go',
    agent_id: agentId,
    input_tokens: 1_000,
    output_tokens: 200,
    cache_read_tokens: 300,
  }
  return { id, at: 1_000, entry }
}

function makeSnapshot(
  provider: 'claude_code' | 'opencode_go',
  percent: number | null,
): QuotaSnapshot {
  return {
    provider,
    window_5h_percent: provider === 'claude_code' ? percent : null,
    window_7d_percent: provider === 'claude_code' ? percent : null,
    cycle_tokens_used: 0,
    cycle_token_limit: null,
    reset_at: '2026-11-26T12:00:00.000Z',
    updated_at: '2026-11-26T10:00:00.000Z',
  }
}

describe('live-data', () => {
  it('T1: maps DB rows (string numbers, null windows) to dashboard models', () => {
    const snap = rowToSnapshot({
      provider: 'claude_code',
      window_5h_percent: null,
      window_7d_percent: '91',
      cycle_tokens_used: '4200000',
      cycle_token_limit: null,
      reset_at: '2026-11-26T12:00:00.000Z',
      updated_at: '2026-11-26T10:00:00.000Z',
    })
    expect(snap.provider).toBe('claude_code')
    expect(snap.cycle_tokens_used).toBe(4_200_000)
    expect(snap.window_5h_percent).toBeNull()
    expect(snap.window_7d_percent).toBe(91)

    const turn = rowToTurn({
      id: 'turn-1',
      provider: 'claude_code',
      agent_id: 'claude-main',
      task_name: 'write-release-spec',
      model: 'claude-sonnet-4.5',
      input_tokens: '2500',
      output_tokens: 900,
      cache_read_tokens: 0,
      created_at: '2026-11-26T10:00:00.000Z',
    })
    expect(turn.at).toBe(Date.parse('2026-11-26T10:00:00.000Z'))
    expect(turn.entry.agent_id).toBe('claude-main')
    expect(turn.entry.input_tokens).toBe(2_500)

    const control = rowToControl({
      global_status: 'paused',
      auto_pause_threshold: '95',
      downgrade_model_threshold: 85,
    })
    expect(control.global_status).toBe('paused')
    expect(control.auto_pause_threshold).toBe(95)
    expect(control.downgrade_model_threshold).toBe(85)
  })

  it('T2: upserts snapshots by provider and prepends turns without duplicates', () => {
    const claude = makeSnapshot('claude_code', 40)
    const opencode = makeSnapshot('opencode_go', null)
    const claudeNew = { ...claude, window_5h_percent: 70 }

    const upserted = upsertSnapshot([claude, opencode], claudeNew)
    expect(upserted).toHaveLength(2)
    expect(upserted.find((s) => s.provider === 'claude_code')?.window_5h_percent).toBe(70)
    expect(upserted.find((s) => s.provider === 'opencode_go')).toBe(opencode)

    const a = makeTurn('a')
    const b = makeTurn('b')
    const c = makeTurn('c')

    const once = prependTurn([a, b], c)
    expect(once.map((t) => t.id)).toEqual(['c', 'a', 'b'])

    const twice = prependTurn(once, c)
    expect(twice.map((t) => t.id)).toEqual(['c', 'a', 'b'])

    const capped = prependTurn(twice, c, 2)
    expect(capped).toHaveLength(2)
    expect(capped.map((t) => t.id)).toEqual(['c', 'a'])
  })

  it('T3: startLive emits fetched state, applies control events and unsubscribes once', async () => {
    const unsubscribe = vi.fn()
    let handlers: LiveSourceHandlers | undefined
    const fetchedSnapshots: QuotaSnapshot[] = [makeSnapshot('claude_code', 55)]
    const fetchedTurns: FeedTurn[] = [makeTurn('t1', 'go-helper'), makeTurn('t2', 'claude-main')]
    const runningControl: Control = {
      global_status: 'running',
      auto_pause_threshold: 90,
      downgrade_model_threshold: 80,
    }
    const source: LiveSource = {
      async fetchSnapshots() {
        return fetchedSnapshots
      },
      async fetchTurns() {
        return fetchedTurns
      },
      async fetchControl() {
        return runningControl
      },
      subscribe(h) {
        handlers = h
        return unsubscribe
      },
    }

    const states: LiveState[] = []
    const stop = startLive(source, (state) => states.push(state))

    await vi.waitFor(() => {
      expect(states.length).toBeGreaterThan(0)
    })
    expect(states[0].snapshots).toEqual(fetchedSnapshots)
    expect(states[0].turns).toEqual(fetchedTurns)
    expect(states[0].control.global_status).toBe('running')

    expect(handlers).toBeDefined()
    handlers!.onControl({
      global_status: 'paused',
      auto_pause_threshold: 90,
      downgrade_model_threshold: 80,
    })
    expect(states[states.length - 1].control.global_status).toBe('paused')

    stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
