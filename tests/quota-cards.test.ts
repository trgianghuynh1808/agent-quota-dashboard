import { describe, expect, it } from 'vitest'
import type { QuotaSnapshot } from '../api/_lib/types.js'
import { buildQuotaCards } from '../src/lib/quota-cards.js'

const NOW = Date.parse('2026-01-01T00:00:00Z')
const MS_HOUR = 3_600_000
const MS_DAY = 86_400_000

function isoAfter(ms: number): string {
  return new Date(NOW + ms).toISOString()
}

function claudeSnapshot(
  window5h: number,
  window7d: number,
  resetAt: string,
): QuotaSnapshot {
  return {
    provider: 'claude_code',
    window_5h_percent: window5h,
    window_7d_percent: window7d,
    cycle_tokens_used: 0,
    cycle_token_limit: null,
    reset_at: resetAt,
    updated_at: new Date(NOW).toISOString(),
  }
}

function opencodeSnapshot(resetAt: string): QuotaSnapshot {
  return {
    provider: 'opencode_go',
    window_5h_percent: null,
    window_7d_percent: null,
    cycle_tokens_used: 4_200_000,
    cycle_token_limit: 10_000_000,
    reset_at: resetAt,
    updated_at: new Date(NOW).toISOString(),
  }
}

describe('buildQuotaCards', () => {
  it('T1: trả 3 bar đúng thứ tự, percent, level và resetText', () => {
    const claude = claudeSnapshot(62, 91, isoAfter(2 * MS_HOUR))
    const opencode = opencodeSnapshot(isoAfter(5 * MS_DAY))

    const bars = buildQuotaCards([claude, opencode], NOW)

    expect(bars.map((bar) => bar.id)).toEqual([
      'claude-5h',
      'claude-7d',
      'opencode-cycle',
    ])
    expect(bars.map((bar) => bar.percent)).toEqual([62, 91, 42])
    expect(bars.map((bar) => bar.level)).toEqual(['ok', 'critical', 'ok'])
    expect(bars[0].resetText).toBe('2h 00m')
    expect(bars[2].resetText).toBe('5d 00h')
  })

  it('T2: quá reset_at hiển thị 0% và snapshot thiếu là unknown', () => {
    const claude = claudeSnapshot(95, 85, isoAfter(-1000))

    const bars = buildQuotaCards([claude], NOW)

    expect(bars[0].percent).toBe(0)
    expect(bars[0].level).toBe('ok')
    expect(bars[1].percent).toBe(0)
    expect(bars[1].level).toBe('ok')
    expect(bars[2].percent).toBeNull()
    expect(bars[2].level).toBe('unknown')
    expect(bars[2].resetText).toBe('--')

    const notExpired = claudeSnapshot(62, 85, isoAfter(MS_HOUR))
    const futureBars = buildQuotaCards([notExpired], NOW)
    expect(futureBars[1].level).toBe('warn')
  })
})
