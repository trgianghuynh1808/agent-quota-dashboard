import type { VercelRequest, VercelResponse } from '@vercel/node'
import { describe, expect, it, vi } from 'vitest'
import { createIngestHandler } from '../api/ingest.js'
import type { Notify } from '../api/_lib/ingest.js'
import type { QuotaSnapshot } from '../api/_lib/types.js'
import { createControlHandler } from '../api/control.js'
import { createStatusHandler } from '../api/status.js'
import { createSubscribeHandler } from '../api/subscribe.js'
import { FakeDb } from './fake-db.js'

const API_KEY = 'k'
const AUTH = { authorization: `Bearer ${API_KEY}` }

interface CallOptions {
  method?: string
  headers?: Record<string, string>
  body?: unknown
}

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>

interface ControlBody {
  global_status: string
  auto_pause_threshold: number
  downgrade_model_threshold: number
}

function createRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
}

async function call(handler: Handler, options: CallOptions = {}) {
  const req = {
    method: options.method ?? 'POST',
    headers: options.headers ?? {},
    body: options.body,
  } as unknown as VercelRequest
  const res = createRes()
  await handler(req, res as unknown as VercelResponse)
  return res
}

function pausedNow(res: { body: unknown }): boolean {
  return (res.body as { paused_now?: boolean }).paused_now === true
}

function makeIngest(db: FakeDb, notify: Notify) {
  return createIngestHandler({ db, notify, apiKey: API_KEY })
}

function makeStatus(db: FakeDb) {
  return createStatusHandler({ db, apiKey: API_KEY })
}

function makeControl(db: FakeDb) {
  return createControlHandler({ db, apiKey: API_KEY })
}

function makeSubscribe(db: FakeDb) {
  return createSubscribeHandler({ db, apiKey: API_KEY })
}

function findByProvider(snapshots: QuotaSnapshot[], provider: string) {
  return snapshots.find((snapshot) => snapshot.provider === provider)
}

describe('T1: auth and validation', () => {
  it('rejects bad auth, method and payload without logging', async () => {
    const db = new FakeDb()
    const notify = vi.fn<Notify>()
    const ingest = makeIngest(db, notify)
    const status = makeStatus(db)

    const missingAuth = await call(ingest, { body: {} })
    expect(missingAuth.statusCode).toBe(401)

    const wrongAuth = await call(ingest, {
      headers: { authorization: 'Bearer nope' },
      body: {},
    })
    expect(wrongAuth.statusCode).toBe(401)

    const wrongMethod = await call(ingest, { method: 'GET', headers: AUTH })
    expect(wrongMethod.statusCode).toBe(405)

    const missingWindow = await call(ingest, {
      headers: AUTH,
      body: { provider: 'claude_code', agent_id: 'a1', window_5h_percent: 10 },
    })
    expect(missingWindow.statusCode).toBe(400)

    const negativeDelta = await call(ingest, {
      headers: AUTH,
      body: { provider: 'opencode_go', agent_id: 'a1', delta_tokens: -5 },
    })
    expect(negativeDelta.statusCode).toBe(400)

    const statusWrongAuth = await call(status, {
      method: 'GET',
      headers: { authorization: 'Bearer nope' },
    })
    expect(statusWrongAuth.statusCode).toBe(401)

    expect(db.logs.length).toBe(0)
  })
})

describe('T2: ingest updates snapshots', () => {
  it('overwrites claude percentages and accumulates opencode tokens', async () => {
    const db = new FakeDb()
    const notify = vi.fn<Notify>().mockResolvedValue(undefined)
    const ingest = makeIngest(db, notify)
    const status = makeStatus(db)

    const first = await call(ingest, {
      headers: AUTH,
      body: {
        provider: 'claude_code',
        agent_id: 'a1',
        input_tokens: 10,
        output_tokens: 5,
        cache_read_tokens: 3,
        window_5h_percent: 20,
        window_7d_percent: 30,
      },
    })
    expect(first.statusCode).toBe(200)
    expect(pausedNow(first)).toBe(false)

    const second = await call(ingest, {
      headers: AUTH,
      body: {
        provider: 'claude_code',
        agent_id: 'a1',
        window_5h_percent: 25,
        window_7d_percent: 31,
      },
    })
    expect(second.statusCode).toBe(200)
    expect(pausedNow(second)).toBe(false)

    const opencodeFirst = await call(ingest, {
      headers: AUTH,
      body: {
        provider: 'opencode_go',
        agent_id: 'a1',
        delta_tokens: 100,
        cycle_token_limit: 1000,
      },
    })
    expect(opencodeFirst.statusCode).toBe(200)

    const opencodeSecond = await call(ingest, {
      headers: AUTH,
      body: { provider: 'opencode_go', agent_id: 'a1', delta_tokens: 50 },
    })
    expect(opencodeSecond.statusCode).toBe(200)

    const statusRes = await call(status, { method: 'GET', headers: AUTH })
    expect(statusRes.statusCode).toBe(200)

    const body = statusRes.body as {
      global_status: string
      snapshots: QuotaSnapshot[]
    }
    expect(body.global_status).toBe('running')
    expect(body.snapshots.length).toBe(2)

    const claude = findByProvider(body.snapshots, 'claude_code')
    expect(claude?.window_5h_percent).toBe(25)
    expect(claude?.window_7d_percent).toBe(31)

    const opencode = findByProvider(body.snapshots, 'opencode_go')
    expect(opencode?.cycle_tokens_used).toBe(150)
    expect(opencode?.cycle_token_limit).toBe(1000)

    expect(db.logs.length).toBe(4)
    expect(db.logs[0].input_tokens).toBe(10)
    expect(db.logs[0].cache_read_tokens).toBe(3)
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('POST /api/control', () => {
  it('T1: applies partial updates and keeps fields not sent', async () => {
    const db = new FakeDb()
    const control = makeControl(db)
    const status = makeStatus(db)

    const pause = await call(control, { headers: AUTH, body: { global_status: 'paused' } })
    expect(pause.statusCode).toBe(200)
    const pauseBody = pause.body as {
      ok: boolean
      global_status: string
      auto_pause_threshold: number
      downgrade_model_threshold: number
    }
    expect(pauseBody.ok).toBe(true)
    expect(pauseBody.global_status).toBe('paused')
    expect(pauseBody.auto_pause_threshold).toBe(90)
    expect(pauseBody.downgrade_model_threshold).toBe(80)

    const thresholds = await call(control, {
      headers: AUTH,
      body: { auto_pause_threshold: 95, downgrade_model_threshold: 85 },
    })
    expect(thresholds.statusCode).toBe(200)
    const thresholdsBody = thresholds.body as {
      global_status: string
      auto_pause_threshold: number
      downgrade_model_threshold: number
    }
    expect(thresholdsBody.global_status).toBe('paused')
    expect(thresholdsBody.auto_pause_threshold).toBe(95)
    expect(thresholdsBody.downgrade_model_threshold).toBe(85)

    const statusRes = await call(status, { method: 'GET', headers: AUTH })
    expect(statusRes.statusCode).toBe(200)
    const statusBody = statusRes.body as ControlBody
    expect(statusBody.global_status).toBe(db.control.global_status)
    expect(statusBody.auto_pause_threshold).toBe(db.control.auto_pause_threshold)
    expect(statusBody.downgrade_model_threshold).toBe(db.control.downgrade_model_threshold)
  })

  it('T2: rejects bad auth and method without changing the db', async () => {
    const db = new FakeDb()
    const control = makeControl(db)

    const missingAuth = await call(control, { body: { global_status: 'paused' } })
    expect(missingAuth.statusCode).toBe(401)

    const wrongAuth = await call(control, {
      headers: { authorization: 'Bearer wrong' },
      body: { global_status: 'paused' },
    })
    expect(wrongAuth.statusCode).toBe(401)

    const wrongMethod = await call(control, { method: 'GET', headers: AUTH })
    expect(wrongMethod.statusCode).toBe(405)

    expect(db.control.global_status).toBe('running')
  })

  it('T3: rejects invalid bodies without writing', async () => {
    const db = new FakeDb()
    const control = makeControl(db)

    const empty = await call(control, { headers: AUTH, body: {} })
    expect(empty.statusCode).toBe(400)
    expect(typeof (empty.body as { error: unknown }).error).toBe('string')

    const badStatus = await call(control, { headers: AUTH, body: { global_status: 'stopped' } })
    expect(badStatus.statusCode).toBe(400)
    expect(typeof (badStatus.body as { error: unknown }).error).toBe('string')

    const badThreshold = await call(control, {
      headers: AUTH,
      body: { auto_pause_threshold: 150 },
    })
    expect(badThreshold.statusCode).toBe(400)
    expect(typeof (badThreshold.body as { error: unknown }).error).toBe('string')

    const crossed = await call(control, {
      headers: AUTH,
      body: { auto_pause_threshold: 70 },
    })
    expect(crossed.statusCode).toBe(400)
    expect(typeof (crossed.body as { error: unknown }).error).toBe('string')

    expect(db.control.global_status).toBe('running')
    expect(db.control.auto_pause_threshold).toBe(90)
    expect(db.control.downgrade_model_threshold).toBe(80)
  })
})

describe('subscribe', () => {
  it('T1: stores and overwrites a subscription by endpoint', async () => {
    const db = new FakeDb()
    const subscribe = makeSubscribe(db)
    const endpoint = `https://push.example/${Date.now()}`

    const first = await call(subscribe, {
      headers: AUTH,
      body: { endpoint, keys: { p256dh: 'p1', auth: 'a1' } },
    })
    expect(first.statusCode).toBe(200)
    expect((first.body as { ok: boolean }).ok).toBe(true)

    const second = await call(subscribe, {
      headers: AUTH,
      body: { endpoint, keys: { p256dh: 'p2', auth: 'a1' } },
    })
    expect(second.statusCode).toBe(200)
    expect((second.body as { ok: boolean }).ok).toBe(true)

    expect(db.subscriptions.size).toBe(1)
    expect(db.subscriptions.get(endpoint)?.p256dh).toBe('p2')
  })

  it('T2: rejects bad auth, method and body without saving', async () => {
    const db = new FakeDb()
    const subscribe = makeSubscribe(db)
    const endpoint = `https://push.example/${Date.now()}`

    const missingAuth = await call(subscribe, {
      body: { endpoint, keys: { p256dh: 'p1', auth: 'a1' } },
    })
    expect(missingAuth.statusCode).toBe(401)

    const wrongMethod = await call(subscribe, { method: 'GET', headers: AUTH })
    expect(wrongMethod.statusCode).toBe(405)

    const missingKeys = await call(subscribe, { headers: AUTH, body: { endpoint } })
    expect(missingKeys.statusCode).toBe(400)

    const insecureEndpoint = await call(subscribe, {
      headers: AUTH,
      body: { endpoint: 'http://x', keys: { p256dh: 'p1', auth: 'a1' } },
    })
    expect(insecureEndpoint.statusCode).toBe(400)

    expect(db.subscriptions.size).toBe(0)
  })
})

describe('T3: auto-pause and push notification', () => {
  it('pauses once when claude crosses the threshold', async () => {
    const db = new FakeDb({ control: { auto_pause_threshold: 90 } })
    const notify = vi.fn<Notify>().mockResolvedValue(undefined)
    const ingest = makeIngest(db, notify)
    const status = makeStatus(db)

    const below = await call(ingest, {
      headers: AUTH,
      body: {
        provider: 'claude_code',
        agent_id: 'a1',
        window_5h_percent: 89,
        window_7d_percent: 10,
      },
    })
    expect(pausedNow(below)).toBe(false)

    const statusRunning = await call(status, { method: 'GET', headers: AUTH })
    expect((statusRunning.body as { global_status: string }).global_status).toBe('running')

    const crossing = await call(ingest, {
      headers: AUTH,
      body: {
        provider: 'claude_code',
        agent_id: 'a1',
        window_5h_percent: 40,
        window_7d_percent: 91,
      },
    })
    expect(pausedNow(crossing)).toBe(true)
    expect(db.control.global_status).toBe('paused')
    expect(notify).toHaveBeenCalledTimes(1)

    const alreadyPaused = await call(ingest, {
      headers: AUTH,
      body: {
        provider: 'claude_code',
        agent_id: 'a1',
        window_5h_percent: 95,
        window_7d_percent: 95,
      },
    })
    expect(pausedNow(alreadyPaused)).toBe(false)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('pauses opencode when usage equals the threshold', async () => {
    const db = new FakeDb({ control: { auto_pause_threshold: 90 } })
    const notify = vi.fn<Notify>().mockResolvedValue(undefined)
    const ingest = makeIngest(db, notify)

    const result = await call(ingest, {
      headers: AUTH,
      body: {
        provider: 'opencode_go',
        agent_id: 'a1',
        delta_tokens: 90,
        cycle_token_limit: 100,
      },
    })

    expect(pausedNow(result)).toBe(true)
    expect(db.control.global_status).toBe('paused')
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('still pauses when the notification fails', async () => {
    const db = new FakeDb({ control: { auto_pause_threshold: 90 } })
    const notify = vi.fn<Notify>().mockRejectedValue(new Error('push down'))
    const ingest = makeIngest(db, notify)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await call(ingest, {
      headers: AUTH,
      body: {
        provider: 'claude_code',
        agent_id: 'a1',
        window_5h_percent: 99,
        window_7d_percent: 10,
      },
    })

    expect(result.statusCode).toBe(200)
    expect(pausedNow(result)).toBe(true)
    expect(db.control.global_status).toBe('paused')

    errorSpy.mockRestore()
  })
})
