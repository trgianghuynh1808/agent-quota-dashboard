import { createClient } from '@supabase/supabase-js'
import type { Control, QuotaSnapshot } from '../../api/_lib/types.js'
import type { FeedTurn } from './burn-rate.js'
import { rowToControl, rowToSnapshot, rowToTurn } from './live-data.js'
import type {
  ControlRow,
  LiveSource,
  LiveSourceHandlers,
  SnapshotRow,
  TurnRow,
} from './live-data.js'

const DEFAULT_CONTROL: Control = {
  global_status: 'running',
}

const TURNS_LIMIT = 200

export function createSupabaseSource(url: string, anonKey: string): LiveSource {
  const client = createClient(url, anonKey)

  async function fetchSnapshots(): Promise<QuotaSnapshot[]> {
    const { data, error } = await client.from('quota_snapshots').select()
    if (error !== null) throw new Error(error.message)
    return (data ?? []).map((row) => rowToSnapshot(row as SnapshotRow))
  }

  async function fetchTurns(): Promise<FeedTurn[]> {
    const { data, error } = await client
      .from('agent_telemetry_logs')
      .select()
      .order('created_at', { ascending: false })
      .limit(TURNS_LIMIT)
    if (error !== null) throw new Error(error.message)
    return (data ?? []).map((row) => rowToTurn(row as TurnRow))
  }

  async function fetchControl(): Promise<Control> {
    const { data, error } = await client
      .from('orchestrator_control')
      .select()
      .eq('id', 1)
      .limit(1)
    if (error !== null) throw new Error(error.message)
    const row = (data ?? [])[0] as ControlRow | undefined
    return row === undefined ? { ...DEFAULT_CONTROL } : rowToControl(row)
  }

  function subscribe(handlers: LiveSourceHandlers): () => void {
    const channel = client
      .channel('dashboard-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quota_snapshots' },
        (payload) => {
          // DELETE events carry no new row; skip them.
          const row = payload.new as SnapshotRow | null
          if (row === null || row === undefined) return
          handlers.onSnapshot(rowToSnapshot(row))
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_telemetry_logs' },
        (payload) => {
          const row = payload.new as TurnRow | null
          if (row === null || row === undefined) return
          handlers.onTurn(rowToTurn(row))
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orchestrator_control' },
        (payload) => {
          const row = payload.new as ControlRow | null
          if (row === null || row === undefined) return
          handlers.onControl(rowToControl(row))
        },
      )
      .subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }

  return { fetchSnapshots, fetchTurns, fetchControl, subscribe }
}
