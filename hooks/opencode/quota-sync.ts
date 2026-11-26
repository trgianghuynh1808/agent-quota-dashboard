const FETCH_TIMEOUT_MS = 5000

export interface SyncDeps {
  fetch: typeof fetch
  env: Record<string, string | undefined>
}

interface SyncConfig {
  url: string
  apiKey: string
  agentId: string
}

interface OpencodeGoPayload {
  provider: 'opencode_go'
  agent_id: string
  delta_tokens: number
  model?: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
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

function readConfig(env: SyncDeps['env']): SyncConfig | null {
  const appUrl = env.APP_URL?.trim()
  const apiKey = env.INGEST_API_KEY?.trim()
  if (!appUrl || !apiKey) return null

  const baseUrl = appUrl.replace(/\/+$/, '')
  if (!baseUrl) return null

  return {
    url: `${baseUrl}/api/ingest`,
    apiKey,
    agentId: env.AGENT_ID?.trim() || 'opencode-go',
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
  }
}

export function createQuotaSync(deps: SyncDeps): {
  handleEvent: (event: unknown) => Promise<void>
} {
  const handledMessageIds = new Set<string>()

  return {
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

interface OpenCodePluginContext {
  client: unknown
  directory: string
}

export default async function QuotaSyncPlugin(_context: OpenCodePluginContext) {
  const sync = createQuotaSync({
    fetch: globalThis.fetch,
    env: process.env,
  })

  return {
    event: async ({ event }: { event: unknown }): Promise<void> => {
      await sync.handleEvent(event)
    },
  }
}
