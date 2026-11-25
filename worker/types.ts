export interface Env {
  DB: D1Database
  INGEST_API_KEY: string
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
}

export type Provider = 'claude_code' | 'opencode_go'

export interface QuotaSnapshot {
  provider: Provider
  window_5h_percent: number | null
  window_7d_percent: number | null
  cycle_tokens_used: number
  cycle_token_limit: number | null
  reset_at: string | null
  updated_at: string | null
}

export interface IngestPayload {
  provider: Provider
  agent_id: string
  task_name: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  window_5h_percent?: number
  window_7d_percent?: number
  reset_at?: string
  delta_tokens?: number
  cycle_token_limit?: number
}
