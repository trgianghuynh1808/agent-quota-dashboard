import type { QuotaSnapshot } from '../../api/_lib/types.js'

const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000

export function mockSnapshots(now: number): QuotaSnapshot[] {
  const claude: QuotaSnapshot = {
    provider: 'claude_code',
    window_5h_percent: 62,
    window_7d_percent: 91,
    cycle_tokens_used: 0,
    cycle_token_limit: null,
    reset_at: new Date(now + 2 * MS_PER_HOUR).toISOString(),
    reset_7d_at: new Date(now + 3 * MS_PER_DAY).toISOString(),
    updated_at: new Date(now).toISOString(),
  }

  const opencode: QuotaSnapshot = {
    provider: 'opencode_go',
    window_5h_percent: null,
    window_7d_percent: null,
    cycle_tokens_used: 4_200_000,
    cycle_token_limit: 10_000_000,
    reset_at: new Date(now + 5 * MS_PER_DAY).toISOString(),
    updated_at: new Date(now).toISOString(),
    opencode_windows: [
      {
        id: '5h',
        percent: 35,
        reset_at: new Date(now + 3 * MS_PER_HOUR).toISOString(),
      },
      {
        id: '7d',
        percent: 58,
        reset_at: new Date(now + 4 * MS_PER_DAY).toISOString(),
      },
      {
        id: '30d',
        percent: 82,
        reset_at: new Date(now + 19 * MS_PER_DAY).toISOString(),
      },
    ],
  }

  return [claude, opencode]
}
