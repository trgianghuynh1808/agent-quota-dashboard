import type { ClaudeCodeIngest, ControlPatch, IngestPayload, OpencodeGoIngest } from './types.js'

export type ParseResult =
  | { ok: true; value: IngestPayload }
  | { ok: false; error: string }

export type ControlPatchResult =
  | { ok: true; value: ControlPatch }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseControlPatch(body: unknown): ControlPatchResult {
  let data = body
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return { ok: false, error: 'Body must be valid JSON' }
    }
  }
  if (!isRecord(data)) return { ok: false, error: 'Body must be a JSON object' }

  if (data.global_status === undefined) {
    return { ok: false, error: 'global_status is required' }
  }

  if (data.global_status !== 'running' && data.global_status !== 'paused') {
    return { ok: false, error: 'global_status must be running or paused' }
  }

  return { ok: true, value: { global_status: data.global_status } }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
}

function readTokenCount(value: unknown): number | null {
  if (value === undefined) return 0
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

export function parseIngestPayload(body: unknown): ParseResult {
  let data = body
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return { ok: false, error: 'Body must be valid JSON' }
    }
  }
  if (!isRecord(data)) return { ok: false, error: 'Body must be a JSON object' }

  const provider = data.provider
  if (provider !== 'claude_code' && provider !== 'opencode_go') {
    return { ok: false, error: 'provider must be claude_code or opencode_go' }
  }

  if (!isNonEmptyString(data.agent_id)) {
    return { ok: false, error: 'agent_id is required' }
  }

  if (data.task_name !== undefined && typeof data.task_name !== 'string') {
    return { ok: false, error: 'task_name must be a string' }
  }

  if (data.model !== undefined && typeof data.model !== 'string') {
    return { ok: false, error: 'model must be a string' }
  }

  const inputTokens = readTokenCount(data.input_tokens)
  if (inputTokens === null) {
    return { ok: false, error: 'input_tokens must be a non-negative integer' }
  }

  const outputTokens = readTokenCount(data.output_tokens)
  if (outputTokens === null) {
    return { ok: false, error: 'output_tokens must be a non-negative integer' }
  }

  const cacheReadTokens = readTokenCount(data.cache_read_tokens)
  if (cacheReadTokens === null) {
    return { ok: false, error: 'cache_read_tokens must be a non-negative integer' }
  }

  let resetAt: string | undefined
  if (data.reset_at !== undefined) {
    if (typeof data.reset_at !== 'string' || Number.isNaN(Date.parse(data.reset_at))) {
      return { ok: false, error: 'reset_at must be an ISO date string' }
    }
    resetAt = data.reset_at
  }

  const base = {
    agent_id: data.agent_id,
    ...(data.task_name !== undefined ? { task_name: data.task_name as string } : {}),
    ...(data.model !== undefined ? { model: data.model as string } : {}),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
    ...(resetAt !== undefined ? { reset_at: resetAt } : {}),
  }

  if (provider === 'claude_code') {
    const window5h = data.window_5h_percent
    const window7d = data.window_7d_percent
    if (!isPercent(window5h) || !isPercent(window7d)) {
      return { ok: false, error: 'window_5h_percent and window_7d_percent must be numbers between 0 and 100' }
    }

    let reset7dAt: string | undefined
    if (data.reset_7d_at !== undefined) {
      if (typeof data.reset_7d_at !== 'string' || Number.isNaN(Date.parse(data.reset_7d_at))) {
        return { ok: false, error: 'reset_7d_at must be an ISO date string' }
      }
      reset7dAt = data.reset_7d_at
    }

    const value: ClaudeCodeIngest = {
      ...base,
      provider: 'claude_code',
      window_5h_percent: window5h,
      window_7d_percent: window7d,
      ...(reset7dAt !== undefined ? { reset_7d_at: reset7dAt } : {}),
    }
    return { ok: true, value }
  }

  const windowId = data.window_id
  if (windowId !== undefined && windowId !== '5h' && windowId !== '7d' && windowId !== '30d') {
    return { ok: false, error: 'window_id must be 5h, 7d or 30d' }
  }

  if (windowId !== undefined) {
    if (data.window_percent === undefined) {
      return { ok: false, error: 'window_percent is required when window_id is set' }
    }
    if (!isPercent(data.window_percent)) {
      return { ok: false, error: 'window_percent must be a number between 0 and 100' }
    }
    if (resetAt === undefined) {
      return { ok: false, error: 'reset_at is required when window_id is set' }
    }

    const value: OpencodeGoIngest = {
      ...base,
      provider: 'opencode_go',
      delta_tokens: 0,
      window_id: windowId,
      window_percent: data.window_percent,
    }
    return { ok: true, value }
  }

  const deltaTokens = data.delta_tokens
  if (typeof deltaTokens !== 'number' || !Number.isInteger(deltaTokens) || deltaTokens < 0) {
    return { ok: false, error: 'delta_tokens must be a non-negative integer' }
  }

  const value: OpencodeGoIngest = {
    ...base,
    provider: 'opencode_go',
    delta_tokens: deltaTokens,
  }
  return { ok: true, value }
}
