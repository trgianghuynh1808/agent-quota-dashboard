import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../hooks/claude-code/circuit-breaker.sh', import.meta.url))

const hasJq = spawnSync('bash', ['-c', 'command -v jq'], { stdio: 'ignore' }).status === 0

const tempDirs: string[] = []

function makeTempDirWithFakeCurl(): { dir: string; argsFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'circuit-breaker-'))
  tempDirs.push(dir)
  const argsFile = join(dir, 'args.txt')
  const fakeCurl = join(dir, 'curl')
  writeFileSync(
    fakeCurl,
    [
      '#!/usr/bin/env bash',
      'printf \'%s\\n\' "$@" > "$FAKE_CURL_LOG"',
      'printf \'%s\' "${FAKE_CURL_BODY:-}"',
      'exit "${FAKE_CURL_EXIT:-0}"',
    ].join('\n') + '\n',
  )
  chmodSync(fakeCurl, 0o755)
  return { dir, argsFile }
}

function runBreaker(input: string, dir: string, extraEnv: Record<string, string | undefined>) {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  env.PATH = `${dir}:${process.env.PATH ?? ''}`
  env.FAKE_CURL_LOG = join(dir, 'args.txt')
  return spawnSync('bash', [SCRIPT], { input, encoding: 'utf8', env })
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe.skipIf(!hasJq)('claude-code circuit-breaker hook', () => {
  it('T1: blocks (exit 2, PAUSED on stderr) when the status is paused', () => {
    const { dir, argsFile } = makeTempDirWithFakeCurl()
    const key = `k-${Date.now()}`

    const result = runBreaker('{}', dir, {
      APP_URL: 'https://x.test',
      INGEST_API_KEY: key,
      FAKE_CURL_BODY: '{"global_status":"paused"}',
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('PAUSED')

    const lines = readFileSync(argsFile, 'utf8').split('\n')
    expect(lines).toContain('https://x.test/api/status')
    expect(lines).toContain(`Authorization: Bearer ${key}`)
  })

  it('T2: passes (exit 0, no stderr) when the status is running', () => {
    const { dir } = makeTempDirWithFakeCurl()

    const result = runBreaker('{}', dir, {
      APP_URL: 'https://x.test',
      INGEST_API_KEY: `k-${Date.now()}`,
      FAKE_CURL_BODY: '{"global_status":"running"}',
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })

  it('T3: fails open (exit 0) on network errors or missing env', () => {
    const { dir } = makeTempDirWithFakeCurl()

    const networkError = runBreaker('{}', dir, {
      APP_URL: 'https://x.test',
      INGEST_API_KEY: `k-${Date.now()}`,
      FAKE_CURL_EXIT: '7',
    })
    expect(networkError.status).toBe(0)

    const noAppUrl = runBreaker('{}', dir, {
      APP_URL: undefined,
      INGEST_API_KEY: `k-${Date.now()}`,
    })
    expect(noAppUrl.status).toBe(0)
  })
})
