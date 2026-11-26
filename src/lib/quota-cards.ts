import type { QuotaSnapshot } from '../../api/_lib/types.js'
import {
  countdown,
  cyclePercent,
  effectiveCycleUsed,
  effectivePercent,
  formatCountdown,
} from './quota.js'

export type QuotaLevel = 'ok' | 'warn' | 'critical' | 'unknown'

export type QuotaBar = {
  id: string
  label: string
  percent: number | null
  level: QuotaLevel
  resetText: string
}

function levelFor(percent: number | null): QuotaLevel {
  if (percent === null) return 'unknown'
  if (percent >= 90) return 'critical'
  if (percent >= 80) return 'warn'
  return 'ok'
}

function resetText(resetAt: string | null, now: number): string {
  return formatCountdown(countdown(resetAt, now))
}

export function buildQuotaCards(snapshots: QuotaSnapshot[], now: number): QuotaBar[] {
  const claude = snapshots.find((s) => s.provider === 'claude_code') ?? null
  const opencode = snapshots.find((s) => s.provider === 'opencode_go') ?? null

  const claude5h = effectivePercent(
    claude?.window_5h_percent ?? null,
    claude?.reset_at ?? null,
    now,
  )
  const claude7d = effectivePercent(
    claude?.window_7d_percent ?? null,
    claude?.reset_at ?? null,
    now,
  )

  const opencodePercent =
    opencode === null
      ? null
      : cyclePercent(
          effectiveCycleUsed(opencode, now),
          opencode.cycle_token_limit,
        )

  return [
    {
      id: 'claude-5h',
      label: 'Claude Code · 5h',
      percent: claude5h,
      level: levelFor(claude5h),
      resetText: claude ? resetText(claude.reset_at, now) : '--',
    },
    {
      id: 'claude-7d',
      label: 'Claude Code · 7d',
      percent: claude7d,
      level: levelFor(claude7d),
      resetText: claude ? resetText(claude.reset_at, now) : '--',
    },
    {
      id: 'opencode-cycle',
      label: 'OpenCode Go · Cycle',
      percent: opencodePercent,
      level: levelFor(opencodePercent),
      resetText: opencode ? resetText(opencode.reset_at, now) : '--',
    },
  ]
}
