import type { Db, GlobalStatus, IngestPayload } from './types.js'

export interface IngestResult {
  global_status: GlobalStatus
}

export async function processIngest(db: Db, payload: IngestPayload): Promise<IngestResult> {
  if (
    payload.provider === 'opencode_go' &&
    payload.window_id !== undefined &&
    payload.window_percent !== undefined &&
    payload.reset_at !== undefined
  ) {
    await db.setOpencodeWindow({
      id: payload.window_id,
      percent: payload.window_percent,
      reset_at: payload.reset_at,
    })
  } else {
    await db.insertLog({
      provider: payload.provider,
      agent_id: payload.agent_id,
      task_name: payload.task_name,
      model: payload.model,
      input_tokens: payload.input_tokens,
      output_tokens: payload.output_tokens,
      cache_read_tokens: payload.cache_read_tokens,
    })

    if (payload.provider === 'claude_code') {
      await db.upsertClaudeSnapshot(payload)
    } else {
      await db.incrementOpencode(payload.delta_tokens, payload.reset_at)
    }
  }

  const control = await db.getControl()
  return { global_status: control.global_status }
}
