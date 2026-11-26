import { describe, expect, it } from 'vitest'
import type { QuotaSnapshot } from '../api/_lib/types.js'
import { rowToSnapshot, type SnapshotRow } from '../src/lib/live-data.js'
import { buildQuotaCards, groupQuotaBars } from '../src/lib/quota-cards.js'

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
  reset7dAt?: string,
): QuotaSnapshot {
  return {
    provider: 'claude_code',
    window_5h_percent: window5h,
    window_7d_percent: window7d,
    cycle_tokens_used: 0,
    cycle_token_limit: null,
    reset_at: resetAt,
    ...(reset7dAt !== undefined ? { reset_7d_at: reset7dAt } : {}),
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
      'opencode-5h',
      'opencode-7d',
      'opencode-30d',
    ])
    expect(bars.map((bar) => bar.percent)).toEqual([62, 91, null, null, null])
    expect(bars.map((bar) => bar.level)).toEqual([
      'ok',
      'critical',
      'unknown',
      'unknown',
      'unknown',
    ])
    expect(bars[0].resetText).toBe('2h 00m')
    expect(bars[2].resetText).toBe('--')
  })

  it('T2: quá reset_at hiển thị 0% và snapshot thiếu là unknown', () => {
    const claude = claudeSnapshot(95, 85, isoAfter(-1000), isoAfter(-1000))

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

  it('T4: dùng reset_7d_at riêng cho hàng 7d, thiếu thì "--"', () => {
    const claude = claudeSnapshot(30, 45, isoAfter(2 * MS_HOUR), isoAfter(5 * MS_DAY))
    const bars = buildQuotaCards([claude], NOW)
    expect(bars[0].resetText).toBe('2h 00m')
    expect(bars[1].resetText).toBe('5d 00h')

    const without7d = claudeSnapshot(30, 45, isoAfter(2 * MS_HOUR))
    const noResetBars = buildQuotaCards([without7d], NOW)
    expect(noResetBars[1].resetText).toBe('--')
  })

  it('T1: OpenCode Go 3 mốc — percent/level/reset riêng, quá reset về 0%, thiếu mốc thì "--"', () => {
    const claude = claudeSnapshot(62, 91, isoAfter(2 * MS_HOUR))
    const opencode: QuotaSnapshot = {
      ...opencodeSnapshot(isoAfter(5 * MS_DAY)),
      opencode_windows: [
        { id: '5h', percent: 35, reset_at: isoAfter(3 * MS_HOUR) },
        { id: '7d', percent: 85, reset_at: isoAfter(4 * MS_DAY) },
        { id: '30d', percent: 95, reset_at: isoAfter(-1000) },
      ],
    }

    const bars = buildQuotaCards([claude, opencode], NOW)

    expect(bars.map((bar) => bar.id)).toEqual([
      'claude-5h',
      'claude-7d',
      'opencode-5h',
      'opencode-7d',
      'opencode-30d',
    ])
    const opencodeBars = bars.slice(2)
    expect(opencodeBars.map((bar) => bar.percent)).toEqual([35, 85, 0])
    expect(opencodeBars.map((bar) => bar.level)).toEqual(['ok', 'warn', 'ok'])
    expect(opencodeBars[0].resetText).toBe('3h 00m')
    expect(opencodeBars[1].resetText).toBe('4d 00h')

    const noWindowsBars = buildQuotaCards(
      [claude, opencodeSnapshot(isoAfter(5 * MS_DAY))],
      NOW,
    )
    expect(noWindowsBars).toHaveLength(5)
    expect(noWindowsBars.slice(2).map((bar) => bar.id)).toEqual([
      'opencode-5h',
      'opencode-7d',
      'opencode-30d',
    ])
    expect(
      noWindowsBars.slice(2).every((bar) => bar.percent === null && bar.resetText === '--'),
    ).toBe(true)
  })

  it('T2: luôn 3 hàng OpenCode kể cả thiếu mốc, rowToSnapshot lọc phần tử sai', () => {
    const claude = claudeSnapshot(62, 91, isoAfter(2 * MS_HOUR))

    const noWindowsBars = buildQuotaCards([claude, opencodeSnapshot(isoAfter(5 * MS_DAY))], NOW)
    expect(noWindowsBars.map((bar) => bar.id)).not.toContain('opencode-cycle')
    expect(noWindowsBars.slice(2).map((bar) => bar.id)).toEqual([
      'opencode-5h',
      'opencode-7d',
      'opencode-30d',
    ])
    expect(
      noWindowsBars.slice(2).every((bar) => bar.percent === null && bar.resetText === '--'),
    ).toBe(true)

    const withWindows: QuotaSnapshot = {
      ...opencodeSnapshot(isoAfter(5 * MS_DAY)),
      opencode_windows: [
        { id: '5h', percent: 35, reset_at: isoAfter(3 * MS_HOUR) },
        { id: '7d', percent: 58, reset_at: isoAfter(4 * MS_DAY) },
        { id: '30d', percent: 42, reset_at: isoAfter(20 * MS_DAY) },
      ],
    }
    const windowsBars = buildQuotaCards([claude, withWindows], NOW)
    expect(windowsBars.map((bar) => bar.id)).not.toContain('opencode-cycle')
    expect(windowsBars.slice(2).map((bar) => bar.id)).toEqual([
      'opencode-5h',
      'opencode-7d',
      'opencode-30d',
    ])
    expect(windowsBars.slice(2).map((bar) => bar.percent)).toEqual([35, 58, 42])

    const row: SnapshotRow = {
      provider: 'opencode_go',
      window_5h_percent: null,
      window_7d_percent: null,
      cycle_tokens_used: 100,
      cycle_token_limit: null,
      reset_at: null,
      reset_7d_at: null,
      updated_at: new Date(NOW).toISOString(),
      opencode_windows: [
        { id: '7d', percent: 58, reset_at: isoAfter(4 * MS_DAY) },
        { id: '1h', percent: 10, reset_at: isoAfter(MS_HOUR) },
      ],
    }
    expect(rowToSnapshot(row).opencode_windows).toEqual([
      { id: '7d', percent: 58, reset_at: isoAfter(4 * MS_DAY) },
    ])
  })
})

describe('groupQuotaBars', () => {
  it('T1: gom nhóm quota theo provider', () => {
    const claude = claudeSnapshot(62, 91, isoAfter(2 * MS_HOUR))
    const opencode: QuotaSnapshot = {
      ...opencodeSnapshot(isoAfter(5 * MS_DAY)),
      opencode_windows: [
        { id: '5h', percent: 35, reset_at: isoAfter(3 * MS_HOUR) },
        { id: '7d', percent: 85, reset_at: isoAfter(4 * MS_DAY) },
        { id: '30d', percent: 95, reset_at: isoAfter(-1000) },
      ],
    }

    const groups = groupQuotaBars(buildQuotaCards([claude, opencode], NOW))

    expect(groups.map((group) => group.id)).toEqual(['claude', 'opencode'])
    expect(groups[0].title).toBe('Claude Code')
    expect(groups[0].bars.map((bar) => bar.id)).toEqual(['claude-5h', 'claude-7d'])
    expect(groups[0].bars.map((bar) => bar.label)).toEqual(['5h', '7d'])
    expect(groups[1].title).toBe('OpenCode Go')
    expect(groups[1].bars.map((bar) => bar.id)).toEqual([
      'opencode-5h',
      'opencode-7d',
      'opencode-30d',
    ])
    expect(groups[1].bars.map((bar) => bar.label)).toEqual(['5h', '7d', '30d'])

    const claudeOnly = groupQuotaBars(buildQuotaCards([claude], NOW))

    expect(claudeOnly.map((group) => group.id)).toEqual(['claude', 'opencode'])
    expect(claudeOnly[0].bars.map((bar) => bar.id)).toEqual(['claude-5h', 'claude-7d'])
    expect(claudeOnly[1].bars.map((bar) => bar.id)).toEqual([
      'opencode-5h',
      'opencode-7d',
      'opencode-30d',
    ])
    expect(claudeOnly[1].bars[0].percent).toBeNull()
  })
})
