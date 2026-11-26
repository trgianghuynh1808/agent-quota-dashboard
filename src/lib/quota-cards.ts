import type { OpencodeWindow, QuotaSnapshot } from '../../api/_lib/types.js'
import { countdown, effectivePercent, formatCountdown } from './quota.js'

export type QuotaLevel = 'ok' | 'warn' | 'critical' | 'unknown'

export type QuotaBar = {
  id: string
  label: string
  percent: number | null
  level: QuotaLevel
  resetText: string
}

export type QuotaGroup = {
  id: 'claude' | 'opencode'
  title: string
  bars: QuotaBar[]
}

export function groupQuotaBars(bars: QuotaBar[]): QuotaGroup[] {
  const groups: QuotaGroup[] = [
    { id: 'claude', title: 'Claude Code', bars: [] },
    { id: 'opencode', title: 'OpenCode Go', bars: [] },
  ]

  for (const bar of bars) {
    const group = bar.id.startsWith('claude-')
      ? groups[0]
      : bar.id.startsWith('opencode-')
        ? groups[1]
        : null
    if (group === null) continue
    const shortLabel = bar.label.includes(' · ')
      ? bar.label.slice(bar.label.indexOf(' · ') + 3)
      : bar.label
    group.bars.push({ ...bar, label: shortLabel })
  }

  return groups.filter((group) => group.bars.length > 0)
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

const OPENCODE_WINDOWS: { id: OpencodeWindow['id']; label: string }[] = [
  { id: '5h', label: 'OpenCode Go · 5h' },
  { id: '7d', label: 'OpenCode Go · 7d' },
  { id: '30d', label: 'OpenCode Go · 30d' },
]

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
    claude?.reset_7d_at ?? null,
    now,
  )

  const claudeBars: QuotaBar[] = [
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
      resetText: claude ? resetText(claude.reset_7d_at ?? null, now) : '--',
    },
  ]

  const windows = opencode?.opencode_windows ?? []
  const opencodeBars = OPENCODE_WINDOWS.map(({ id, label }): QuotaBar => {
    const window = windows.find((w) => w.id === id)
    const percent = window
      ? effectivePercent(window.percent, window.reset_at, now)
      : null
    return {
      id: `opencode-${id}`,
      label,
      percent,
      level: levelFor(percent),
      resetText: window ? resetText(window.reset_at, now) : '--',
    }
  })

  return [...claudeBars, ...opencodeBars]
}
