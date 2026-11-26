import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { parseIngestPayload } from '../api/_lib/validate.js'

const SCRIPT = fileURLToPath(new URL('../hooks/opencode/set-quota.sh', import.meta.url))

const hasJq = spawnSync('bash', ['-c', 'command -v jq'], { stdio: 'ignore' }).status === 0

const tempDirs: string[] = []

function makeTempDirWithFakeCurl(): { dir: string; argsFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'opencode-set-quota-'))
  tempDirs.push(dir)
  const argsFile = join(dir, 'args.txt')
  const fakeCurl = join(dir, 'curl')
  writeFileSync(fakeCurl, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@" > "$FAKE_CURL_LOG"\n')
  chmodSync(fakeCurl, 0o755)
  return { dir, argsFile }
}

function runScript(args: string[], dir: string, argsFile: string) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      FAKE_CURL_LOG: argsFile,
      APP_URL: 'https://example.test',
      INGEST_API_KEY: 'k',
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

describe.skipIf(!hasJq)('opencode set-quota.sh', () => {
  it('T3: gửi payload window hợp lệ và từ chối tham số sai', async () => {
    const { dir, argsFile } = makeTempDirWithFakeCurl()
    const resetAt = '2026-12-01T00:00:00Z'

    runScript(['7d', '58', resetAt], dir, argsFile)
    expect(await waitForArgsFile(argsFile)).toBe(true)

    const lines = readFileSync(argsFile, 'utf8').split('\n')
    expect(lines).toContain('https://example.test/api/ingest')
    expect(lines).toContain('Authorization: Bearer k')

    const body = argValueAfter(lines, '-d')
    expect(body).toBeTruthy()

    const parsed = parseIngestPayload(JSON.parse(body as string))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.provider).toBe('opencode_go')
      if (parsed.value.provider === 'opencode_go') {
        expect(parsed.value.window_id).toBe('7d')
        expect(parsed.value.window_percent).toBe(58)
        expect(parsed.value.reset_at).toBe(resetAt)
      }
    }

    const badId = makeTempDirWithFakeCurl()
    const badIdResult = runScript(['1h', '10', resetAt], badId.dir, badId.argsFile)
    expect(badIdResult.status).not.toBe(0)
    expect(existsSync(badId.argsFile)).toBe(false)

    const badPercent = makeTempDirWithFakeCurl()
    const badPercentResult = runScript(['5h', 'abc', resetAt], badPercent.dir, badPercent.argsFile)
    expect(badPercentResult.status).not.toBe(0)
    expect(existsSync(badPercent.argsFile)).toBe(false)
  })
})
