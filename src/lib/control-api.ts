import type { Control, ControlPatch } from '../../api/_lib/types.js'
import { validateThresholds } from './circuit-breaker.js'

export interface ControlApi {
  getControl(): Promise<Control>
  updateControl(patch: ControlPatch): Promise<Control>
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createMockControlApi(
  initial: Control = {
    global_status: 'running',
    auto_pause_threshold: 90,
    downgrade_model_threshold: 80,
  },
  delayMs = 0,
): ControlApi {
  let state: Control = { ...initial }
  return {
    async getControl(): Promise<Control> {
      await wait(delayMs)
      return { ...state }
    },
    async updateControl(patch: ControlPatch): Promise<Control> {
      await wait(delayMs)
      const merged: Control = { ...state, ...patch }
      const error = validateThresholds(merged.downgrade_model_threshold, merged.auto_pause_threshold)
      if (error !== null) throw new Error(error)
      state = merged
      return { ...state }
    },
  }
}

export function createReadOnlyControlApi(getControl: () => Promise<Control>): ControlApi {
  return {
    getControl,
    async updateControl(): Promise<Control> {
      throw new Error('Chưa nối /api/control')
    },
  }
}
