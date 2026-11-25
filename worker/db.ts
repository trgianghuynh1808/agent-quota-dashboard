import type { IngestPayload, Provider, QuotaSnapshot } from './types'

export type OrchestratorControl = {
  id: number
  global_status: 'running' | 'paused'
  auto_pause_threshold: number
  downgrade_model_threshold: number
  updated_at: string | null
}

export type ControlPatch = {
  global_status?: 'running' | 'paused'
  auto_pause_threshold?: number
  downgrade_model_threshold?: number
}

export type PushSubscriptionRow = {
  endpoint: string
  p256dh: string
  auth: string
  created_at: string | null
}

export type TelemetryLogEntry = Pick<
  IngestPayload,
  | 'provider'
  | 'agent_id'
  | 'task_name'
  | 'model'
  | 'input_tokens'
  | 'output_tokens'
  | 'cache_read_tokens'
>

export type OpencodeUsage = {
  cycle_tokens_used: number
  cycle_token_limit: number | null
}

export type ClaudeSnapshotUpdate = {
  provider: Provider
  window_5h_percent: number
  window_7d_percent: number
  reset_at: string | null
  updatedAt: string
}

export async function upsertClaudeSnapshot(
  db: D1Database,
  update: ClaudeSnapshotUpdate,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO quota_snapshots (provider, window_5h_percent, window_7d_percent, reset_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(provider) DO UPDATE SET
         window_5h_percent = excluded.window_5h_percent,
         window_7d_percent = excluded.window_7d_percent,
         reset_at = excluded.reset_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      update.provider,
      update.window_5h_percent,
      update.window_7d_percent,
      update.reset_at,
      update.updatedAt,
    )
    .run()
}

export async function incrementOpencodeSnapshot(
  db: D1Database,
  data: {
    provider: Provider
    delta_tokens: number
    cycle_token_limit: number | null
    updatedAt: string
  },
): Promise<OpencodeUsage> {
  const row = await db
    .prepare(
      `INSERT INTO quota_snapshots (provider, cycle_tokens_used, cycle_token_limit, updated_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(provider) DO UPDATE SET
         cycle_tokens_used = cycle_tokens_used + excluded.cycle_tokens_used,
         cycle_token_limit = COALESCE(excluded.cycle_token_limit, quota_snapshots.cycle_token_limit),
         updated_at = excluded.updated_at
       RETURNING cycle_tokens_used, cycle_token_limit`,
    )
    .bind(data.provider, data.delta_tokens, data.cycle_token_limit, data.updatedAt)
    .first<OpencodeUsage>()
  if (!row) {
    throw new Error('incrementOpencodeSnapshot: upsert returned no row')
  }
  return row
}

export async function insertLog(
  db: D1Database,
  entry: TelemetryLogEntry,
  createdAt: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO agent_telemetry_logs (id, provider, agent_id, task_name, model, input_tokens, output_tokens, cache_read_tokens, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      crypto.randomUUID(),
      entry.provider,
      entry.agent_id,
      entry.task_name,
      entry.model,
      entry.input_tokens,
      entry.output_tokens,
      entry.cache_read_tokens,
      createdAt,
    )
    .run()
}

export async function getControl(db: D1Database): Promise<OrchestratorControl | null> {
  return db
    .prepare(
      `SELECT id, global_status, auto_pause_threshold, downgrade_model_threshold, updated_at
       FROM orchestrator_control
       WHERE id = 1`,
    )
    .first<OrchestratorControl>()
}

export async function updateControl(
  db: D1Database,
  patch: ControlPatch,
  updatedAt: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE orchestrator_control SET
         global_status = COALESCE(?1, global_status),
         auto_pause_threshold = COALESCE(?2, auto_pause_threshold),
         downgrade_model_threshold = COALESCE(?3, downgrade_model_threshold),
         updated_at = ?4
       WHERE id = 1`,
    )
    .bind(
      patch.global_status ?? null,
      patch.auto_pause_threshold ?? null,
      patch.downgrade_model_threshold ?? null,
      updatedAt,
    )
    .run()
}

export async function getSnapshots(db: D1Database): Promise<QuotaSnapshot[]> {
  const { results } = await db
    .prepare(
      `SELECT provider, window_5h_percent, window_7d_percent, cycle_tokens_used, cycle_token_limit, reset_at, updated_at
       FROM quota_snapshots
       ORDER BY provider`,
    )
    .all<QuotaSnapshot>()
  return results
}

export async function saveSubscription(
  db: D1Database,
  sub: {
    endpoint: string
    p256dh: string
    auth: string
    createdAt: string
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth`,
    )
    .bind(sub.endpoint, sub.p256dh, sub.auth, sub.createdAt)
    .run()
}

export async function listSubscriptions(db: D1Database): Promise<PushSubscriptionRow[]> {
  const { results } = await db
    .prepare(`SELECT endpoint, p256dh, auth, created_at FROM push_subscriptions`)
    .all<PushSubscriptionRow>()
  return results
}
