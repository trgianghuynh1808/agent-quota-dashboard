import { describe, expect, it, vi } from 'vitest'
import { createQuotaSync } from '../hooks/opencode/quota-sync.js'
import type { QuotaSyncState } from '../hooks/opencode/quota-sync.js'
import { parseIngestPayload } from '../api/_lib/validate.js'
import type { IngestPayload } from '../api/_lib/types.js'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

function createOkFetch() {
  return vi.fn<typeof fetch>(async () => new Response('{}'))
}

interface FetchCall {
  url: string
  headers: Record<string, string>
  body: unknown
}

function readCall(call: Parameters<typeof fetch>): FetchCall {
  const [url, init] = call
  return {
    url: String(url),
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: JSON.parse(String(init?.body)),
  }
}

function expectIngest(body: unknown): IngestPayload {
  const parsed = parseIngestPayload(body)
  if (!parsed.ok) throw new Error(`expected valid ingest payload, got: ${parsed.error}`)
  return parsed.value
}

function completedMessage(id: string) {
  return {
    type: 'message.updated',
    properties: {
      info: {
        id,
        role: 'assistant',
        providerID: 'opencode-go',
        modelID: 'glm-5.3',
        tokens: {
          total: 1000,
          input: 900,
          output: 100,
          reasoning: 0,
          cache: { read: 50, write: 0 },
        },
        time: { created: 1, completed: 2 },
      },
    },
  }
}

describe('T1: delta message completed', () => {
  it('sends one valid payload without double counting', async () => {
    const apiKey = `k-${Date.now()}`
    const fetchMock = createOkFetch()
    const sync = createQuotaSync({
      fetch: fetchMock,
      env: { APP_URL: 'http://x.test', INGEST_API_KEY: apiKey },
      now: () => NOW,
      readUsage: vi.fn(async () => 0),
      readState: vi.fn(async () => ({ backfilled: true })),
      writeState: vi.fn(async () => {}),
    })

    const message = completedMessage('msg-A')
    await sync.handleEvent(message)
    await sync.handleEvent(message)
    await sync.handleEvent({
      type: 'message.updated',
      properties: {
        info: { ...message.properties.info, id: 'msg-B', time: { created: 1 } },
      },
    })
    await sync.handleEvent({
      type: 'message.updated',
      properties: {
        info: { ...message.properties.info, id: 'msg-C', providerID: 'anthropic' },
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = readCall(fetchMock.mock.calls[0])
    expect(call.url).toBe('http://x.test/api/ingest')
    expect(call.headers.Authorization).toBe(`Bearer ${apiKey}`)
    const payload = expectIngest(call.body)
    expect(payload).toMatchObject({
      provider: 'opencode_go',
      agent_id: 'opencode-go',
      delta_tokens: 1000,
      model: 'glm-5.3',
      input_tokens: 900,
      output_tokens: 100,
      cache_read_tokens: 50,
    })
  })
})

describe('T2: backfill once', () => {
  it('sends the local baseline once then never again', async () => {
    let state: QuotaSyncState | null = null
    const fetchMock = createOkFetch()
    const readUsage = vi.fn(async () => 123456)
    const deps = {
      fetch: fetchMock,
      env: { APP_URL: 'http://x.test', INGEST_API_KEY: `k-${Date.now()}` },
      now: () => NOW,
      readUsage,
      readState: vi.fn(async () => state),
      writeState: vi.fn(async (next: { backfilled: boolean }) => {
        state = next
      }),
    }

    const sync = createQuotaSync(deps)
    await sync.backfillInitialUsage()
    await sync.backfillInitialUsage()
    const secondSync = createQuotaSync(deps)
    await secondSync.backfillInitialUsage()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = readCall(fetchMock.mock.calls[0])
    const payload = expectIngest(call.body)
    expect(payload).toMatchObject({
      provider: 'opencode_go',
      agent_id: 'opencode-go',
      delta_tokens: 123456,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
    })
    expect(deps.writeState).toHaveBeenCalledTimes(1)
    expect(deps.writeState).toHaveBeenCalledWith({ backfilled: true })
    expect(readUsage).toHaveBeenCalledTimes(1)
    expect(readUsage).toHaveBeenCalledWith(NOW - 30 * DAY_MS)
  })
})

describe('T3: never breaks OpenCode', () => {
  it('stays silent on network errors, missing config and usage failures', async () => {
    const writeStateA = vi.fn(async () => {})
    const syncA = createQuotaSync({
      fetch: vi.fn<typeof fetch>(async () => {
        throw new Error('network')
      }),
      env: { APP_URL: 'http://x.test', INGEST_API_KEY: `k-${Date.now()}` },
      now: () => NOW,
      readUsage: vi.fn(async () => 100),
      readState: vi.fn(async () => null),
      writeState: writeStateA,
    })
    await syncA.handleEvent(completedMessage(`msg-A-${Date.now()}`))
    await syncA.backfillInitialUsage()
    expect(writeStateA).not.toHaveBeenCalled()

    const fetchB = createOkFetch()
    const syncB = createQuotaSync({
      fetch: fetchB,
      env: { APP_URL: 'http://x.test' },
      now: () => NOW,
      readUsage: vi.fn(async () => {
        throw new Error('db')
      }),
      readState: vi.fn(async () => null),
      writeState: vi.fn(async () => {}),
    })
    await syncB.handleEvent(completedMessage(`msg-B-${Date.now()}`))
    await syncB.backfillInitialUsage()
    expect(fetchB).not.toHaveBeenCalled()

    const fetchC = createOkFetch()
    const writeStateC = vi.fn(async () => {})
    const syncC = createQuotaSync({
      fetch: fetchC,
      env: { APP_URL: 'http://x.test', INGEST_API_KEY: `k-${Date.now()}` },
      now: () => NOW,
      readUsage: vi.fn(async () => {
        throw new Error('db')
      }),
      readState: vi.fn(async () => null),
      writeState: writeStateC,
    })
    await syncC.backfillInitialUsage()
    expect(fetchC).not.toHaveBeenCalled()
    expect(writeStateC).not.toHaveBeenCalled()
  })
})
