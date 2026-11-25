import type { Db, GlobalStatus, IngestPayload, QuotaSnapshot } from './types.js'

export interface NotifyMessage {
  title: string
  body: string
}

export type Notify = (message: NotifyMessage) => Promise<void>

export interface IngestResult {
  global_status: GlobalStatus
  paused_now: boolean
}

function usagePercent(payload: IngestPayload, snapshot: QuotaSnapshot): number | null {
  if (payload.provider === 'claude_code') {
    return Math.max(snapshot.window_5h_percent ?? 0, snapshot.window_7d_percent ?? 0)
  }

  const limit = snapshot.cycle_token_limit
  if (limit === null || limit <= 0) return null
  return (snapshot.cycle_tokens_used / limit) * 100
}

export async function processIngest(
  db: Db,
  payload: IngestPayload,
  notify: Notify,
): Promise<IngestResult> {
  await db.insertLog({
    provider: payload.provider,
    agent_id: payload.agent_id,
    task_name: payload.task_name,
    model: payload.model,
    input_tokens: payload.input_tokens,
    output_tokens: payload.output_tokens,
    cache_read_tokens: payload.cache_read_tokens,
  })

  const snapshot =
    payload.provider === 'claude_code'
      ? await db.upsertClaudeSnapshot(payload)
      : await db.incrementOpencode(payload.delta_tokens, payload.cycle_token_limit, payload.reset_at)

  const control = await db.getControl()
  const pct = usagePercent(payload, snapshot)

  if (control.global_status === 'running' && pct !== null && pct >= control.auto_pause_threshold) {
    await db.setPaused()

    try {
      await notify({
        title: 'Quota auto-pause',
        body: `${payload.provider} quota reached ${pct.toFixed(1)}% (threshold ${control.auto_pause_threshold}%)`,
      })
    } catch (error) {
      console.error('Failed to send auto-pause push notification', error)
    }

    return { global_status: 'paused', paused_now: true }
  }

  return { global_status: control.global_status, paused_now: false }
}
