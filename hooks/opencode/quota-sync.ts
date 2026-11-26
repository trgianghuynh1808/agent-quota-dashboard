import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const DAY_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 5000
const DEFAULT_CYCLE_DAYS = 30
const OPENCODE_DIR = join(homedir(), '.config', 'opencode')
const STATE_PATH = join(OPENCODE_DIR, 'quota-sync.state.json')
const DB_PATH = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')

export interface QuotaSyncState {
  backfilled?: boolean
}

export interface SyncDeps {
  fetch: typeof fetch
  env: Record<string, string | undefined>
  now: () => number
  readUsage: (sinceMs: number) => Promise<number>
  readState: () => Promise<QuotaSyncState | null>
  writeState: (state: { backfilled: boolean }) => Promise<void>
}

interface SyncConfig {
  url: string
  apiKey: string
  agentId: string
  cycleDays: number
  cycleTokenLimit?: number
}

interface OpencodeGoPayload {
  provider: 'opencode_go'
  agent_id: string
  delta_tokens: number
  model?: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cycle_token_limit?: number
}

interface SqliteDatabase {
  query: (sql: string) => {
    get: (...params: unknown[]) => unknown
  }
  close: () => void
}

interface SqliteModule {
  Database: new (path: string, options: { readonly: boolean }) => SqliteDatabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function readOptionalTokenCount(value: unknown): number | null {
  return value === undefined ? 0 : readTokenCount(value)
}

function readPositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function readConfig(env: SyncDeps['env']): SyncConfig | null {
  const appUrl = env.APP_URL?.trim()
  const apiKey = env.INGEST_API_KEY?.trim()
  if (!appUrl || !apiKey) return null

  const baseUrl = appUrl.replace(/\/+$/, '')
  if (!baseUrl) return null

  const cycleTokenLimit = readPositiveInteger(env.OPENCODE_CYCLE_TOKEN_LIMIT)
  return {
    url: `${baseUrl}/api/ingest`,
    apiKey,
    agentId: env.AGENT_ID?.trim() || 'opencode-go',
    cycleDays: readPositiveInteger(env.OPENCODE_CYCLE_DAYS) ?? DEFAULT_CYCLE_DAYS,
    ...(cycleTokenLimit !== undefined ? { cycleTokenLimit } : {}),
  }
}

async function postDelta(
  deps: SyncDeps,
  config: SyncConfig,
  payload: OpencodeGoPayload,
): Promise<boolean> {
  try {
    const response = await deps.fetch(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    return response.ok
  } catch {
    return false
  }
}

function messagePayload(
  info: Record<string, unknown>,
  config: SyncConfig,
): OpencodeGoPayload | null {
  if (info.role !== 'assistant' || info.providerID !== 'opencode-go') return null
  if (!isRecord(info.time) || typeof info.time.completed !== 'number') return null
  if (!isRecord(info.tokens)) return null

  const deltaTokens = readTokenCount(info.tokens.total)
  const inputTokens = readOptionalTokenCount(info.tokens.input)
  const outputTokens = readOptionalTokenCount(info.tokens.output)
  const cache = isRecord(info.tokens.cache) ? info.tokens.cache : {}
  const cacheReadTokens = readOptionalTokenCount(cache.read)
  if (
    deltaTokens === null ||
    inputTokens === null ||
    outputTokens === null ||
    cacheReadTokens === null
  ) {
    return null
  }

  return {
    provider: 'opencode_go',
    agent_id: config.agentId,
    delta_tokens: deltaTokens,
    ...(typeof info.modelID === 'string' ? { model: info.modelID } : {}),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
    ...(config.cycleTokenLimit !== undefined
      ? { cycle_token_limit: config.cycleTokenLimit }
      : {}),
  }
}

export function createQuotaSync(deps: SyncDeps): {
  backfillInitialUsage: () => Promise<void>
  handleEvent: (event: unknown) => Promise<void>
} {
  const handledMessageIds = new Set<string>()

  return {
    async backfillInitialUsage(): Promise<void> {
      try {
        const config = readConfig(deps.env)
        if (!config) return

        const state = await deps.readState()
        if (state?.backfilled) return

        const sinceMs = deps.now() - config.cycleDays * DAY_MS
        const usage = await deps.readUsage(sinceMs)
        if (readTokenCount(usage) === null) return

        const sent = await postDelta(deps, config, {
          provider: 'opencode_go',
          agent_id: config.agentId,
          delta_tokens: usage,
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          ...(config.cycleTokenLimit !== undefined
            ? { cycle_token_limit: config.cycleTokenLimit }
            : {}),
        })
        if (sent) await deps.writeState({ backfilled: true })
      } catch {
        // A local sync failure must never interrupt OpenCode.
      }
    },

    async handleEvent(event: unknown): Promise<void> {
      try {
        const config = readConfig(deps.env)
        if (!config || !isRecord(event) || event.type !== 'message.updated') return
        if (!isRecord(event.properties) || !isRecord(event.properties.info)) return

        const info = event.properties.info
        if (typeof info.id !== 'string' || !info.id || handledMessageIds.has(info.id)) return

        const payload = messagePayload(info, config)
        if (!payload) return

        handledMessageIds.add(info.id)
        void postDelta(deps, config, payload)
      } catch {
        // A malformed event or local failure must never interrupt OpenCode.
      }
    },
  }
}

async function readUsageFromDb(sinceMs: number): Promise<number> {
  const moduleName = 'bun:sqlite'
  const { Database } = (await import(moduleName)) as SqliteModule
  const db = new Database(DB_PATH, { readonly: true })

  try {
    const row = db
      .query(`
        SELECT COALESCE(SUM(json_extract(data, '$.tokens.total')), 0) AS total
        FROM message
        WHERE json_extract(data, '$.role') = 'assistant'
          AND json_extract(data, '$.providerID') = 'opencode-go'
          AND time_created >= ?
      `)
      .get(sinceMs)
    const total = isRecord(row) ? readTokenCount(row.total) : null
    if (total === null) throw new Error('Invalid OpenCode usage total')
    return total
  } finally {
    db.close()
  }
}

async function readStateFile(): Promise<QuotaSyncState | null> {
  try {
    const state: unknown = JSON.parse(await readFile(STATE_PATH, 'utf8'))
    return isRecord(state) && state.backfilled === true ? { backfilled: true } : null
  } catch {
    return null
  }
}

async function writeStateFile(state: { backfilled: boolean }): Promise<void> {
  await mkdir(dirname(STATE_PATH), { recursive: true })
  await writeFile(STATE_PATH, JSON.stringify(state), 'utf8')
}

interface OpenCodePluginContext {
  client: unknown
  directory: string
}

export default async function QuotaSyncPlugin(_context: OpenCodePluginContext) {
  const sync = createQuotaSync({
    fetch: globalThis.fetch,
    env: process.env,
    now: () => Date.now(),
    readUsage: readUsageFromDb,
    readState: readStateFile,
    writeState: writeStateFile,
  })

  void sync.backfillInitialUsage()

  return {
    event: async ({ event }: { event: unknown }): Promise<void> => {
      await sync.handleEvent(event)
    },
  }
}
