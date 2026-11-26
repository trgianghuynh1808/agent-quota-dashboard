import { describe, expect, it } from 'vitest'
import { buildControlPatch, validateThresholds } from '../src/lib/circuit-breaker.js'
import { createMockControlApi } from '../src/lib/control-api.js'

function expectNonEmptyError(warn: number, pause: number): void {
  const error = validateThresholds(warn, pause)
  expect(error).not.toBeNull()
  expect(error?.length ?? 0).toBeGreaterThan(0)
}

describe('T1: validateThresholds matches server rules', () => {
  it('returns null when warn < pause', () => {
    expect(validateThresholds(80, 90)).toBeNull()
  })

  it('returns null when warn == pause', () => {
    expect(validateThresholds(90, 90)).toBeNull()
  })

  it('returns a non-empty error when warn > pause', () => {
    expectNonEmptyError(91, 90)
  })

  it('returns a non-empty error when warn is outside 1..100', () => {
    expectNonEmptyError(0, 90)
  })

  it('returns a non-empty error when pause is outside 1..100', () => {
    expectNonEmptyError(80, 101)
  })

  it('returns a non-empty error when warn is not an integer', () => {
    expectNonEmptyError(80.5, 90)
  })
})

describe('T2: buildControlPatch and createMockControlApi', () => {
  it('buildControlPatch includes only changed fields', async () => {
    const api = createMockControlApi()
    const current = await api.getControl()
    const patch = buildControlPatch(current, { global_status: 'paused', warn: 80, pause: 90 })
    expect(patch).toEqual({ global_status: 'paused' })
  })

  it('updateControl merges the patch and keeps untouched thresholds', async () => {
    const api = createMockControlApi()
    await api.updateControl({ global_status: 'paused' })
    const control = await api.getControl()
    expect(control.global_status).toBe('paused')
    expect(control.auto_pause_threshold).toBe(90)
    expect(control.downgrade_model_threshold).toBe(80)
  })

  it('updateControl rejects warn > pause and keeps previous state', async () => {
    const api = createMockControlApi()
    await expect(api.updateControl({ downgrade_model_threshold: 95 })).rejects.toThrow()
    const control = await api.getControl()
    expect(control.downgrade_model_threshold).toBe(80)
  })
})
