import type { Control, ControlPatch } from '../../api/_lib/types.js'

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
      state = { ...state, ...patch }
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
