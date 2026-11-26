import { describe, expect, it } from 'vitest'
import type { QuotaSnapshot } from '../api/_lib/types.js'
import {
  cacheRatio,
  countdown,
  cyclePercent,
  effectiveCycleUsed,
  effectivePercent,
  formatCountdown,
  timeToLimitMs,
  tokensPerMinute,
} from '../src/lib/quota.js'

const NOW = Date.parse('2026-01-01T12:00:00Z')
const RESET_PAST = '2026-01-01T11:59:59Z'
const RESET_FUTURE = '2026-01-01T12:00:01Z'

const MS_MINUTE = 60_000
const MS_HOUR = 3_600_000
const MS_DAY = 86_400_000

function isoAfter(ms: number): string {
  return new Date(NOW + ms).toISOString()
}

function opencodeSnapshot(resetAt: string | null): QuotaSnapshot {
  return {
    provider: 'opencode_go',
    window_5h_percent: null,
    window_7d_percent: null,
    cycle_tokens_used: 5000,
    cycle_token_limit: null,
    reset_at: resetAt,
    updated_at: '2026-01-01T11:00:00Z',
  }
}

describe('T1 auto-reset', () => {
  it('resets percent to 0 past reset_at and keeps it before', () => {
    expect(effectivePercent(73, RESET_PAST, NOW)).toBe(0)
    expect(effectivePercent(73, RESET_FUTURE, NOW)).toBe(73)
    expect(effectivePercent(null, RESET_PAST, NOW)).toBeNull()
    expect(effectivePercent(73, null, NOW)).toBe(73)
  })

  it('resets cycle_tokens_used to 0 when the snapshot is expired', () => {
    expect(effectiveCycleUsed(opencodeSnapshot(RESET_PAST), NOW)).toBe(0)
    expect(effectiveCycleUsed(opencodeSnapshot(RESET_FUTURE), NOW)).toBe(5000)
  })
})

describe('T2 countdown', () => {
  it('splits time parts and formats each window', () => {
    const twoDays = countdown(isoAfter(2 * MS_DAY + 3 * MS_HOUR), NOW)
    expect(twoDays).toEqual({
      totalMs: 2 * MS_DAY + 3 * MS_HOUR,
      days: 2,
      hours: 3,
      minutes: 0,
      seconds: 0,
    })
    expect(formatCountdown(twoDays)).toBe('2d 03h')

    const oneHour = countdown(isoAfter(MS_HOUR + 5 * MS_MINUTE), NOW)
    expect(oneHour).toEqual({
      totalMs: MS_HOUR + 5 * MS_MINUTE,
      days: 0,
      hours: 1,
      minutes: 5,
      seconds: 0,
    })
    expect(formatCountdown(oneHour)).toBe('1h 05m')

    const fourMin = countdown(isoAfter(4 * MS_MINUTE + 9_000), NOW)
    expect(fourMin).toEqual({
      totalMs: 4 * MS_MINUTE + 9_000,
      days: 0,
      hours: 0,
      minutes: 4,
      seconds: 9,
    })
    expect(formatCountdown(fourMin)).toBe('4m 09s')

    const past = countdown(RESET_PAST, NOW)
    expect(past).toEqual({ totalMs: 0, days: 0, hours: 0, minutes: 0, seconds: 0 })
    expect(formatCountdown(past)).toBe('0s')
  })

  it('returns null for missing reset_at', () => {
    expect(countdown(null, NOW)).toBeNull()
    expect(formatCountdown(null)).toBe('--')
  })
})

describe('T3 tpm, time-to-limit and cache ratio', () => {
  it('computes tokens per minute over the 3-minute window', () => {
    const samples = [
      { at: NOW - 10_000, tokens: 600 },
      { at: NOW - 60_000, tokens: 300 },
      { at: NOW - 200_000, tokens: 9999 },
    ]
    expect(tokensPerMinute(samples, NOW)).toBe(300)
  })

  it('computes time to limit, clamping edge inputs', () => {
    expect(timeToLimitMs(3000, 300)).toBe(600_000)
    expect(timeToLimitMs(100, 0)).toBeNull()
    expect(timeToLimitMs(0, 50)).toBe(0)
  })

  it('computes cache ratio and cycle percent', () => {
    expect(cacheRatio(30, 120)).toBe(0.25)
    expect(cacheRatio(5, 0)).toBeNull()
    expect(cyclePercent(50, 200)).toBe(25)
    expect(cyclePercent(1, null)).toBeNull()
  })
})
