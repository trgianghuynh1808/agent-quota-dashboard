export type Provider = 'claude_code' | 'opencode_go'

export type GlobalStatus = 'running' | 'paused'

interface IngestBase {
  agent_id: string
  task_name?: string
  model?: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  reset_at?: string
}

export interface ClaudeCodeIngest extends IngestBase {
  provider: 'claude_code'
  window_5h_percent: number
  window_7d_percent: number
  reset_7d_at?: string
}

export interface OpencodeGoIngest extends IngestBase {
  provider: 'opencode_go'
  delta_tokens: number
  window_id?: OpencodeWindow['id']
  window_percent?: number
}

export type IngestPayload = ClaudeCodeIngest | OpencodeGoIngest

export interface OpencodeWindow {
  id: '5h' | '7d' | '30d'
  percent: number
  reset_at: string
}

export interface QuotaSnapshot {
  provider: Provider
  window_5h_percent: number | null
  window_7d_percent: number | null
  cycle_tokens_used: number
  cycle_token_limit: number | null
  reset_at: string | null
  reset_7d_at?: string | null
  updated_at: string
  opencode_windows?: OpencodeWindow[]
}

export interface Control {
  global_status: GlobalStatus
}

export type ControlPatch = Partial<Control>

export interface LogEntry {
  provider: Provider
  agent_id: string
  task_name?: string
  model?: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
}

export interface Db {
  insertLog(entry: LogEntry): Promise<void>
  upsertClaudeSnapshot(payload: ClaudeCodeIngest): Promise<QuotaSnapshot>
  incrementOpencode(deltaTokens: number, resetAt?: string | null): Promise<QuotaSnapshot>
  setOpencodeWindow(window: OpencodeWindow): Promise<QuotaSnapshot>
  getControl(): Promise<Control>
  updateControl(patch: ControlPatch): Promise<Control>
  listSnapshots(): Promise<QuotaSnapshot[]>
}
