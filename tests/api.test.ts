import type { VercelRequest, VercelResponse } from '@vercel/node'
import { describe, expect, it } from 'vitest'
import { createIngestHandler } from '../api/ingest.js'
import type { QuotaSnapshot } from '../api/_lib/types.js'
import { createControlHandler } from '../api/control.js'
import { createStatusHandler } from '../api/status.js'
import { FakeDb } from './fake-db.js'

const API_KEY = 'k'
const AUTH = { authorization: `Bearer ${API_KEY}` }

interface CallOptions {
  method?: string
  headers?: Record<string, string>
  body?: unknown
}

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>

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

function makeIngest(db: FakeDb) {
  return createIngestHandler({ db, apiKey: API_KEY })
}

function makeStatus(db: FakeDb) {
  return createStatusHandler({ db, apiKey: API_KEY })
}

function makeControl(db: FakeDb) {
  return createControlHandler({ db, apiKey: API_KEY })
}

function findByProvider(snapshots: QuotaSnapshot[], provider: string) {
  return snapshots.find((snapshot) => snapshot.provider === provider)
}

describe('T1: auth and validation', () => {
  it('rejects bad auth, method and payload without logging', async () => {
    const db = new FakeDb()
    const ingest = makeIngest(db)
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
    const ingest = makeIngest(db)
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
    expect(first.body).toEqual({ ok: true, global_status: 'running' })

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
    expect(opencode?.cycle_token_limit).toBeNull()

    expect(db.logs.length).toBe(4)
    expect(db.logs[0].input_tokens).toBe(10)
    expect(db.logs[0].cache_read_tokens).toBe(3)
  })
})

describe('T4: claude reset_7d_at', () => {
  it('persists reset_7d_at and rejects a non-ISO value', async () => {
    const db = new FakeDb()
    const ingest = makeIngest(db)
    const reset5h = new Date(1790000000 * 1000).toISOString()
    const reset7d = new Date(1790500000 * 1000).toISOString()

    const ok = await call(ingest, {
      headers: AUTH,
      body: {
        provider: 'claude_code',
        agent_id: 'a1',
        window_5h_percent: 12.5,
        window_7d_percent: 40,
        reset_at: reset5h,
        reset_7d_at: reset7d,
      },
    })
    expect(ok.statusCode).toBe(200)

    const claude = findByProvider(await db.listSnapshots(), 'claude_code')
    expect(claude?.reset_at).toBe(reset5h)
    expect(claude?.reset_7d_at).toBe(reset7d)

    const bad = await call(ingest, {
      headers: AUTH,
      body: {
        provider: 'claude_code',
        agent_id: 'a1',
        window_5h_percent: 12.5,
        window_7d_percent: 40,
        reset_7d_at: 'abc',
      },
    })
    expect(bad.statusCode).toBe(400)
    const claudeAfter = findByProvider(await db.listSnapshots(), 'claude_code')
    expect(claudeAfter?.reset_7d_at).toBe(reset7d)
  })
})

describe('T22: opencode quota windows', () => {
  it('T1: window_id được validate, lưu vào snapshot, không ghi log, không đụng token', async () => {
    const db = new FakeDb()
    const ingest = makeIngest(db)
    const reset5h = '2026-12-01T00:00:00.000Z'
    const reset7d = '2026-12-05T00:00:00.000Z'

    const first = await call(ingest, {
      headers: AUTH,
      body: {
        provider: 'opencode_go',
        agent_id: 'a',
        window_id: '5h',
        window_percent: 35,
        reset_at: reset5h,
      },
    })
    expect(first.statusCode).toBe(200)

    const second = await call(ingest, {
      headers: AUTH,
      body: {
        provider: 'opencode_go',
        agent_id: 'a',
        window_id: '7d',
        window_percent: 58,
        reset_at: reset7d,
      },
    })
    expect(second.statusCode).toBe(200)

    const third = await call(ingest, {
      headers: AUTH,
      body: {
        provider: 'opencode_go',
        agent_id: 'a',
        window_id: '5h',
        window_percent: 40,
        reset_at: reset5h,
      },
    })
    expect(third.statusCode).toBe(200)

    const badWindowId = await call(ingest, {
      headers: AUTH,
      body: {
        provider: 'opencode_go',
        agent_id: 'a',
        window_id: '1h',
        window_percent: 10,
        reset_at: reset5h,
      },
    })
    expect(badWindowId.statusCode).toBe(400)

    const missingPercent = await call(ingest, {
      headers: AUTH,
      body: {
        provider: 'opencode_go',
        agent_id: 'a',
        window_id: '5h',
        reset_at: reset5h,
      },
    })
    expect(missingPercent.statusCode).toBe(400)

    expect(db.logs.length).toBe(0)

    const opencode = findByProvider(await db.listSnapshots(), 'opencode_go')
    expect(opencode?.cycle_tokens_used).toBe(0)
    expect(opencode?.opencode_windows).toHaveLength(2)
    const windows = opencode?.opencode_windows ?? []
    const five = windows.find((w) => w.id === '5h')
    expect(five?.percent).toBe(40)
    expect(five?.reset_at).toBe(reset5h)
    const seven = windows.find((w) => w.id === '7d')
    expect(seven?.percent).toBe(58)
    expect(seven?.reset_at).toBe(reset7d)
  })
})

describe('POST /api/control', () => {
  it('T1: toggles global_status between paused and running', async () => {
    const db = new FakeDb()
    const control = makeControl(db)

    const pause = await call(control, { headers: AUTH, body: { global_status: 'paused' } })
    expect(pause.statusCode).toBe(200)
    expect(pause.body).toEqual({ ok: true, global_status: 'paused' })
    expect(db.control.global_status).toBe('paused')

    const resume = await call(control, { headers: AUTH, body: { global_status: 'running' } })
    expect(resume.statusCode).toBe(200)
    expect(resume.body).toEqual({ ok: true, global_status: 'running' })
    expect(db.control.global_status).toBe('running')
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

    expect(db.control.global_status).toBe('running')
  })
})

describe('T23-T1: ingest không tự pause, control chỉ còn pause thủ công', () => {
  it('stays running at 100% quota, only global_status is accepted', async () => {
    const db = new FakeDb()
    const agentId = `agent-${Date.now()}`
    const ingest = makeIngest(db)
    const control = makeControl(db)
    const status = makeStatus(db)

    const claude = await call(ingest, {
      headers: AUTH,
      body: {
        provider: 'claude_code',
        agent_id: agentId,
        window_5h_percent: 100,
        window_7d_percent: 100,
      },
    })
    expect(claude.statusCode).toBe(200)
    expect(claude.body).toEqual({ ok: true, global_status: 'running' })
    expect(db.control.global_status).toBe('running')

    const opencode = await call(ingest, {
      headers: AUTH,
      body: {
        provider: 'opencode_go',
        agent_id: agentId,
        window_id: '30d',
        window_percent: 100,
        reset_at: new Date(Date.now() + 3_600_000).toISOString(),
      },
    })
    expect(opencode.statusCode).toBe(200)
    expect(opencode.body).toEqual({ ok: true, global_status: 'running' })
    expect(db.control.global_status).toBe('running')

    const pause = await call(control, { headers: AUTH, body: { global_status: 'paused' } })
    expect(pause.statusCode).toBe(200)
    expect(pause.body).toEqual({ ok: true, global_status: 'paused' })

    const threshold = await call(control, {
      headers: AUTH,
      body: { auto_pause_threshold: 95 },
    })
    expect(threshold.statusCode).toBe(400)

    const empty = await call(control, { headers: AUTH, body: {} })
    expect(empty.statusCode).toBe(400)
    expect(db.control.global_status).toBe('paused')

    const statusRes = await call(status, { method: 'GET', headers: AUTH })
    expect(statusRes.statusCode).toBe(200)
    const statusBody = statusRes.body as { global_status: string; snapshots: QuotaSnapshot[] }
    expect(statusBody.global_status).toBe('paused')
    expect(Array.isArray(statusBody.snapshots)).toBe(true)
    expect('auto_pause_threshold' in statusBody).toBe(false)
    expect('downgrade_model_threshold' in statusBody).toBe(false)
  })
})
