import { createClient } from '@supabase/supabase-js'
import type {
  ClaudeCodeIngest,
  Control,
  Db,
  LogEntry,
  QuotaSnapshot,
} from './types.js'

interface SupabaseEnv {
  url: string
  serviceRoleKey: string
}

function getEnv(): SupabaseEnv {
  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return { url, serviceRoleKey }
}

function toSnapshot(row: Record<string, unknown>): QuotaSnapshot {
  return {
    provider: row.provider as QuotaSnapshot['provider'],
    window_5h_percent: row.window_5h_percent == null ? null : Number(row.window_5h_percent),
    window_7d_percent: row.window_7d_percent == null ? null : Number(row.window_7d_percent),
    cycle_tokens_used: Number(row.cycle_tokens_used ?? 0),
    cycle_token_limit: row.cycle_token_limit == null ? null : Number(row.cycle_token_limit),
    reset_at: row.reset_at == null ? null : String(row.reset_at),
    updated_at: row.updated_at == null ? new Date().toISOString() : String(row.updated_at),
  }
}

export function createSupabaseDb(): Db {
  const { url, serviceRoleKey } = getEnv()
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false } })

  return {
    async insertLog(entry: LogEntry): Promise<void> {
      const { error } = await client.from('agent_telemetry_logs').insert({
        provider: entry.provider,
        agent_id: entry.agent_id,
        task_name: entry.task_name ?? null,
        model: entry.model ?? null,
        input_tokens: entry.input_tokens,
        output_tokens: entry.output_tokens,
        cache_read_tokens: entry.cache_read_tokens,
      })
      if (error) throw new Error(`insertLog failed: ${error.message}`)
    },

    async upsertClaudeSnapshot(payload: ClaudeCodeIngest): Promise<QuotaSnapshot> {
      const { data, error } = await client
        .from('quota_snapshots')
        .upsert({
          provider: 'claude_code',
          window_5h_percent: payload.window_5h_percent,
          window_7d_percent: payload.window_7d_percent,
          reset_at: payload.reset_at ?? null,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single()
      if (error) throw new Error(`upsertClaudeSnapshot failed: ${error.message}`)
      return toSnapshot(data as Record<string, unknown>)
    },

    async incrementOpencode(
      deltaTokens: number,
      cycleTokenLimit?: number | null,
      resetAt?: string | null,
    ): Promise<QuotaSnapshot> {
      const { data, error } = await client.rpc('increment_opencode_usage', {
        delta: deltaTokens,
        p_limit: cycleTokenLimit ?? null,
        p_reset_at: resetAt ?? null,
      })
      if (error) throw new Error(`incrementOpencode failed: ${error.message}`)
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>
      return toSnapshot(row)
    },

    async getControl(): Promise<Control> {
      const { data, error } = await client
        .from('orchestrator_control')
        .select('global_status, auto_pause_threshold, downgrade_model_threshold')
        .eq('id', 1)
        .single()
      if (error) throw new Error(`getControl failed: ${error.message}`)
      const row = data as Record<string, unknown>
      return {
        global_status: row.global_status as Control['global_status'],
        auto_pause_threshold: Number(row.auto_pause_threshold),
        downgrade_model_threshold: Number(row.downgrade_model_threshold),
      }
    },

    async setPaused(): Promise<void> {
      const { error } = await client
        .from('orchestrator_control')
        .update({ global_status: 'paused', updated_at: new Date().toISOString() })
        .eq('id', 1)
      if (error) throw new Error(`setPaused failed: ${error.message}`)
    },

    async listSnapshots(): Promise<QuotaSnapshot[]> {
      const { data, error } = await client
        .from('quota_snapshots')
        .select('*')
        .order('provider', { ascending: true })
      if (error) throw new Error(`listSnapshots failed: ${error.message}`)
      return ((data ?? []) as Record<string, unknown>[]).map(toSnapshot)
    },
  }
}
