import { describe, expect, it, vi } from 'vitest'
import { createQuotaSync } from '../hooks/opencode/quota-sync.js'
import { parseIngestPayload } from '../api/_lib/validate.js'
import type { IngestPayload } from '../api/_lib/types.js'

function createOkFetch() {
  return vi.fn<typeof fetch>(async () => new Response('{}'))
}

interface FetchCall {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

function readCall(call: Parameters<typeof fetch>): FetchCall {
  const [url, init] = call
  return {
    url: String(url),
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: JSON.parse(String(init?.body)) as Record<string, unknown>,
  }
}

function expectIngest(body: unknown): IngestPayload {
  const parsed = parseIngestPayload(body)
  if (!parsed.ok) throw new Error(`expected valid ingest payload, got: ${parsed.error}`)
  return parsed.value
}

function completedMessage(id: string, totalTokens = 1000) {
  return {
    type: 'message.updated',
    properties: {
      info: {
        id,
        role: 'assistant',
        providerID: 'opencode-go',
        modelID: 'glm-5.3',
        tokens: {
          total: totalTokens,
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

describe('T23-T2: chỉ gửi delta token, không backfill, không cycle_token_limit', () => {
  it('sends only the delta, ignores the cycle limit env, never backfills', async () => {
    const fetchMock = createOkFetch()
    const env = {
      APP_URL: 'https://x.test',
      INGEST_API_KEY: 'k',
      OPENCODE_CYCLE_TOKEN_LIMIT: '500000',
    }
    const sync = createQuotaSync({ fetch: fetchMock, env })

    const message = completedMessage(`msg-${Date.now()}`, 1200)
    await sync.handleEvent(message)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = readCall(fetchMock.mock.calls[0])
    expect(call.url).toBe('https://x.test/api/ingest')
    expect(call.headers.Authorization).toBe('Bearer k')
    const payload = expectIngest(call.body)
    if (payload.provider !== 'opencode_go') throw new Error('expected opencode_go payload')
    expect(payload.delta_tokens).toBe(1200)
    expect('cycle_token_limit' in call.body).toBe(false)

    await sync.handleEvent(message)
    await sync.handleEvent({ type: 'session.idle' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const syncNoKey = createQuotaSync({
      fetch: fetchMock,
      env: { APP_URL: 'https://x.test', OPENCODE_CYCLE_TOKEN_LIMIT: '500000' },
    })
    await syncNoKey.handleEvent(completedMessage(`msg-2-${Date.now()}`, 1200))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    expect('backfillInitialUsage' in sync).toBe(false)
  })
})

describe('T3: never breaks OpenCode', () => {
  it('stays silent on network errors, missing config and unknown events', async () => {
    const syncA = createQuotaSync({
      fetch: vi.fn<typeof fetch>(async () => {
        throw new Error('network')
      }),
      env: { APP_URL: 'http://x.test', INGEST_API_KEY: `k-${Date.now()}` },
    })
    await syncA.handleEvent(completedMessage(`msg-A-${Date.now()}`))

    const fetchB = createOkFetch()
    const syncB = createQuotaSync({
      fetch: fetchB,
      env: { APP_URL: 'http://x.test' },
    })
    await syncB.handleEvent(completedMessage(`msg-B-${Date.now()}`))
    await syncB.handleEvent({ type: 'session.idle' })
    expect(fetchB).not.toHaveBeenCalled()
  })
})
