import type {
  Control,
  GlobalStatus,
  LogEntry,
  OpencodeWindow,
  Provider,
  QuotaSnapshot,
} from '../../api/_lib/types.js'
import type { FeedTurn } from './burn-rate.js'

export interface LiveSourceHandlers {
  onSnapshot(snapshot: QuotaSnapshot): void
  onTurn(turn: FeedTurn): void
  onControl(control: Control): void
}

export interface LiveSource {
  fetchSnapshots(): Promise<QuotaSnapshot[]>
  fetchTurns(): Promise<FeedTurn[]>
  fetchControl(): Promise<Control>
  subscribe(handlers: LiveSourceHandlers): () => void
}

export interface SnapshotRow {
  provider: string | null
  window_5h_percent: number | string | null
  window_7d_percent: number | string | null
  cycle_tokens_used: number | string | null
  cycle_token_limit: number | string | null
  reset_at: string | null
  reset_7d_at?: string | null
  updated_at: string | null
  opencode_windows?: unknown
}

export interface TurnRow {
  id: string
  provider: string | null
  agent_id: string
  task_name: string | null
  model: string | null
  input_tokens: number | string | null
  output_tokens: number | string | null
  cache_read_tokens: number | string | null
  created_at: string | null
}

export interface ControlRow {
  global_status: string | null
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toText(value: string | null | undefined): string {
  return value ?? ''
}

function toTextOrNull(value: string | null | undefined): string | null {
  return value ?? null
}

function toProvider(value: string | null | undefined): Provider {
  return value === 'opencode_go' ? 'opencode_go' : 'claude_code'
}

function toGlobalStatus(value: string | null | undefined): GlobalStatus {
  return value === 'paused' ? 'paused' : 'running'
}

function toOpencodeWindows(value: unknown): OpencodeWindow[] | undefined {
  if (!Array.isArray(value)) return undefined
  const windows: OpencodeWindow[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (record.id !== '5h' && record.id !== '7d' && record.id !== '30d') continue
    if (typeof record.percent !== 'number') continue
    if (typeof record.reset_at !== 'string') continue
    windows.push({ id: record.id, percent: record.percent, reset_at: record.reset_at })
  }
  return windows.length > 0 ? windows : undefined
}

export function rowToSnapshot(row: SnapshotRow): QuotaSnapshot {
  const opencodeWindows = toOpencodeWindows(row.opencode_windows)
  return {
    provider: toProvider(row.provider),
    window_5h_percent: toNumberOrNull(row.window_5h_percent),
    window_7d_percent: toNumberOrNull(row.window_7d_percent),
    cycle_tokens_used: toNumber(row.cycle_tokens_used),
    cycle_token_limit: toNumberOrNull(row.cycle_token_limit),
    reset_at: toTextOrNull(row.reset_at),
    reset_7d_at: toTextOrNull(row.reset_7d_at),
    updated_at: toText(row.updated_at),
    ...(opencodeWindows !== undefined ? { opencode_windows: opencodeWindows } : {}),
  }
}

export function rowToTurn(row: TurnRow): FeedTurn {
  const at = Date.parse(toText(row.created_at))
  const entry: LogEntry = {
    provider: toProvider(row.provider),
    agent_id: row.agent_id,
    task_name: toTextOrNull(row.task_name) ?? undefined,
    model: toTextOrNull(row.model) ?? undefined,
    input_tokens: toNumber(row.input_tokens),
    output_tokens: toNumber(row.output_tokens),
    cache_read_tokens: toNumber(row.cache_read_tokens),
  }
  return { id: row.id, at: Number.isNaN(at) ? 0 : at, entry }
}

export function rowToControl(row: ControlRow): Control {
  return {
    global_status: toGlobalStatus(row.global_status),
  }
}

export function upsertSnapshot(list: QuotaSnapshot[], snapshot: QuotaSnapshot): QuotaSnapshot[] {
  const index = list.findIndex((item) => item.provider === snapshot.provider)
  if (index === -1) return [...list, snapshot]
  return list.map((item, i) => (i === index ? snapshot : item))
}

export function prependTurn(list: FeedTurn[], turn: FeedTurn, max = 200): FeedTurn[] {
  const rest = list.filter((item) => item.id !== turn.id)
  return [turn, ...rest].slice(0, max)
}

export interface LiveState {
  snapshots: QuotaSnapshot[]
  turns: FeedTurn[]
  control: Control
}

export const DEFAULT_CONTROL: Control = {
  global_status: 'running',
}

export function startLive(source: LiveSource, onState: (state: LiveState) => void): () => void {
  let stopped = false
  let snapshots: QuotaSnapshot[] = []
  let turns: FeedTurn[] = []
  let control: Control = { ...DEFAULT_CONTROL }

  const emit = (): void => {
    if (!stopped) onState({ snapshots, turns, control })
  }

  const unsubscribe = source.subscribe({
    onSnapshot: (snapshot) => {
      snapshots = upsertSnapshot(snapshots, snapshot)
      emit()
    },
    onTurn: (turn) => {
      turns = prependTurn(turns, turn)
      emit()
    },
    onControl: (next) => {
      control = next
      emit()
    },
  })

  void Promise.allSettled([
    source.fetchSnapshots(),
    source.fetchTurns(),
    source.fetchControl(),
  ]).then(([snapshotResult, turnResult, controlResult]) => {
    if (stopped) return
    if (snapshotResult.status === 'fulfilled') snapshots = snapshotResult.value
    if (turnResult.status === 'fulfilled') turns = turnResult.value
    if (controlResult.status === 'fulfilled') control = controlResult.value
    emit()
  })

  return () => {
    if (stopped) return
    stopped = true
    unsubscribe()
  }
}
