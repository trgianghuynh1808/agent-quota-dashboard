import type { QuotaSnapshot } from '../../api/_lib/types.js'

const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function isExpired(resetAt: string | null, now: number): boolean {
  if (resetAt === null) return false
  const resetMs = Date.parse(resetAt)
  return Number.isNaN(resetMs) ? false : now > resetMs
}

export function effectivePercent(
  percent: number | null,
  resetAt: string | null,
  now: number,
): number | null {
  if (percent === null) return null
  return isExpired(resetAt, now) ? 0 : percent
}

export function effectiveCycleUsed(s: QuotaSnapshot, now: number): number {
  return isExpired(s.reset_at, now) ? 0 : s.cycle_tokens_used
}

export function cyclePercent(used: number, limit: number | null): number | null {
  if (limit === null || limit <= 0) return null
  return clamp((used / limit) * 100, 0, 100)
}

export interface Countdown {
  totalMs: number
  days: number
  hours: number
  minutes: number
  seconds: number
}

export function countdown(resetAt: string | null, now: number): Countdown | null {
  if (resetAt === null) return null
  const resetMs = Date.parse(resetAt)
  if (Number.isNaN(resetMs)) return null
  const totalMs = Math.max(0, resetMs - now)
  return {
    totalMs,
    days: Math.floor(totalMs / MS_PER_DAY),
    hours: Math.floor((totalMs % MS_PER_DAY) / MS_PER_HOUR),
    minutes: Math.floor((totalMs % MS_PER_HOUR) / MS_PER_MINUTE),
    seconds: Math.floor((totalMs % MS_PER_MINUTE) / MS_PER_SECOND),
  }
}

export function formatCountdown(c: ReturnType<typeof countdown>): string {
  if (c === null) return '--'
  const pad = (n: number) => String(n).padStart(2, '0')
  if (c.days > 0) return `${c.days}d ${pad(c.hours)}h`
  if (c.hours > 0) return `${c.hours}h ${pad(c.minutes)}m`
  if (c.minutes > 0) return `${c.minutes}m ${pad(c.seconds)}s`
  return `${c.seconds}s`
}

export interface TokenSample {
  at: number
  tokens: number
}

export function tokensPerMinute(samples: TokenSample[], now: number, windowMs = 180_000): number {
  const windowStart = now - windowMs
  const total = samples.reduce(
    (sum, s) => (s.at > windowStart && s.at <= now ? sum + s.tokens : sum),
    0,
  )
  return total / (windowMs / MS_PER_MINUTE)
}

export function timeToLimitMs(remaining: number, tpm: number): number | null {
  if (tpm <= 0) return null
  if (remaining <= 0) return 0
  return (remaining / tpm) * MS_PER_MINUTE
}

export function cacheRatio(cacheRead: number, totalInput: number): number | null {
  if (totalInput <= 0) return null
  return clamp(cacheRead / totalInput, 0, 1)
}
