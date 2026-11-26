import type {
  ClaudeCodeIngest,
  Control,
  ControlPatch,
  Db,
  LogEntry,
  OpencodeWindow,
  Provider,
  QuotaSnapshot,
} from '../api/_lib/types.js'

export interface FakeDbOptions {
  control?: Partial<Control>
}

export class FakeDb implements Db {
  readonly logs: LogEntry[] = []
  readonly control: Control
  private readonly snapshots = new Map<Provider, QuotaSnapshot>()

  constructor(options: FakeDbOptions = {}) {
    this.control = {
      global_status: 'running',
      ...options.control,
    }
  }

  async insertLog(entry: LogEntry): Promise<void> {
    this.logs.push({ ...entry })
  }

  async upsertClaudeSnapshot(payload: ClaudeCodeIngest): Promise<QuotaSnapshot> {
    const previous = this.snapshots.get('claude_code')
    const snapshot: QuotaSnapshot = {
      provider: 'claude_code',
      window_5h_percent: payload.window_5h_percent,
      window_7d_percent: payload.window_7d_percent,
      cycle_tokens_used: previous?.cycle_tokens_used ?? 0,
      cycle_token_limit: previous?.cycle_token_limit ?? null,
      reset_at: payload.reset_at ?? null,
      reset_7d_at: payload.reset_7d_at ?? null,
      updated_at: new Date().toISOString(),
    }
    this.snapshots.set('claude_code', snapshot)
    return snapshot
  }

  async incrementOpencode(deltaTokens: number, resetAt?: string | null): Promise<QuotaSnapshot> {
    const previous = this.snapshots.get('opencode_go')
    const snapshot: QuotaSnapshot = {
      provider: 'opencode_go',
      window_5h_percent: previous?.window_5h_percent ?? null,
      window_7d_percent: previous?.window_7d_percent ?? null,
      cycle_tokens_used: (previous?.cycle_tokens_used ?? 0) + deltaTokens,
      cycle_token_limit: previous?.cycle_token_limit ?? null,
      reset_at: resetAt ?? previous?.reset_at ?? null,
      updated_at: new Date().toISOString(),
    }
    this.snapshots.set('opencode_go', snapshot)
    return snapshot
  }

  async setOpencodeWindow(window: OpencodeWindow): Promise<QuotaSnapshot> {
    const previous = this.snapshots.get('opencode_go')
    const previousWindows = previous?.opencode_windows ?? []
    const windows = [...previousWindows.filter((w) => w.id !== window.id), window]
    const snapshot: QuotaSnapshot = {
      provider: 'opencode_go',
      window_5h_percent: previous?.window_5h_percent ?? null,
      window_7d_percent: previous?.window_7d_percent ?? null,
      cycle_tokens_used: previous?.cycle_tokens_used ?? 0,
      cycle_token_limit: previous?.cycle_token_limit ?? null,
      reset_at: previous?.reset_at ?? null,
      reset_7d_at: previous?.reset_7d_at ?? null,
      updated_at: new Date().toISOString(),
      opencode_windows: windows,
    }
    this.snapshots.set('opencode_go', snapshot)
    return snapshot
  }

  async getControl(): Promise<Control> {
    return { ...this.control }
  }

  async updateControl(patch: ControlPatch): Promise<Control> {
    Object.assign(this.control, patch)
    return { ...this.control }
  }

  async listSnapshots(): Promise<QuotaSnapshot[]> {
    return Array.from(this.snapshots.values())
  }
}
