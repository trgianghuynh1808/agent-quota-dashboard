import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { parseIngestPayload } from '../api/_lib/validate.js'

const SCRIPT = fileURLToPath(new URL('../hooks/claude-code/quota-ingest.sh', import.meta.url))

const hasJq = spawnSync('bash', ['-c', 'command -v jq'], { stdio: 'ignore' }).status === 0

const tempDirs: string[] = []

function makeTempDirWithFakeCurl(): { dir: string; argsFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'claude-hook-'))
  tempDirs.push(dir)
  const argsFile = join(dir, 'args.txt')
  const fakeCurl = join(dir, 'curl')
  writeFileSync(fakeCurl, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@" > "$FAKE_CURL_LOG"\n')
  chmodSync(fakeCurl, 0o755)
  return { dir, argsFile }
}

function runHook(input: string, dir: string, argsFile: string, extraEnv: Record<string, string>) {
  return spawnSync('bash', [SCRIPT], {
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      FAKE_CURL_LOG: argsFile,
      ...extraEnv,
    },
  })
}

async function waitForArgsFile(path: string, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf8')
      if (content.includes('-d')) return true
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

function argValueAfter(lines: string[], flag: string): string | undefined {
  const index = lines.indexOf(flag)
  return index >= 0 ? lines[index + 1] : undefined
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe.skipIf(!hasJq)('claude-code quota-ingest hook', () => {
  it('T1: builds a valid claude_code ingest payload from statusline JSON', async () => {
    const { dir, argsFile } = makeTempDirWithFakeCurl()
    const key = `k-${Date.now()}`
    const stdin = JSON.stringify({
      session_id: 's1',
      model: { id: 'claude-sonnet-x' },
      rate_limits: {
        five_hour: { used_percentage: 12.5, resets_at: 1790000000 },
        seven_day: { used_percentage: 40 },
      },
    })

    const result = runHook(stdin, dir, argsFile, {
      APP_URL: 'http://x.test',
      INGEST_API_KEY: key,
    })

    expect(result.status).toBe(0)
    expect(await waitForArgsFile(argsFile)).toBe(true)

    const lines = readFileSync(argsFile, 'utf8').split('\n')
    expect(lines).toContain('http://x.test/api/ingest')
    expect(lines).toContain(`Authorization: Bearer ${key}`)

    const body = argValueAfter(lines, '-d')
    expect(body).toBeTruthy()

    const parsed = parseIngestPayload(JSON.parse(body as string))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.provider).toBe('claude_code')
      if (parsed.value.provider === 'claude_code') {
        expect(parsed.value.window_5h_percent).toBe(12.5)
        expect(parsed.value.window_7d_percent).toBe(40)
        expect(parsed.value.model).toBe('claude-sonnet-x')
      }
    }
  })

  it('T2: stays silent (exit 0, no output, no request) when quota or env is missing', async () => {
    const { dir, argsFile } = makeTempDirWithFakeCurl()

    const noQuota = runHook(JSON.stringify({ session_id: 's1' }), dir, argsFile, {
      APP_URL: 'http://x.test',
      INGEST_API_KEY: `k-${Date.now()}`,
    })
    expect(noQuota.status).toBe(0)
    expect(noQuota.stdout).toBe('')
    expect(noQuota.stderr).toBe('')

    const validStdin = JSON.stringify({
      session_id: 's1',
      rate_limits: {
        five_hour: { used_percentage: 10 },
        seven_day: { used_percentage: 20 },
      },
    })
    const noKey = runHook(validStdin, dir, argsFile, { APP_URL: 'http://x.test' })
    expect(noKey.status).toBe(0)
    expect(noKey.stdout).toBe('')
    expect(noKey.stderr).toBe('')

    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(existsSync(argsFile)).toBe(false)
  })
})
