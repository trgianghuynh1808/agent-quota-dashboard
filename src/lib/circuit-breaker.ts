import type { Control, ControlPatch, GlobalStatus } from '../../api/_lib/types.js'

export interface ThresholdDraft {
  global_status: GlobalStatus
  warn: number
  pause: number
}

export function validateThresholds(warn: number, pause: number): string | null {
  if (!Number.isInteger(warn) || warn < 1 || warn > 100) {
    return 'downgrade_model_threshold must be an integer between 1 and 100'
  }
  if (!Number.isInteger(pause) || pause < 1 || pause > 100) {
    return 'auto_pause_threshold must be an integer between 1 and 100'
  }
  if (warn > pause) {
    return 'downgrade_model_threshold must be less than or equal to auto_pause_threshold'
  }
  return null
}

export function buildControlPatch(current: Control, draft: ThresholdDraft): ControlPatch {
  const patch: ControlPatch = {}
  if (draft.global_status !== current.global_status) {
    patch.global_status = draft.global_status
  }
  if (draft.warn !== current.downgrade_model_threshold) {
    patch.downgrade_model_threshold = draft.warn
  }
  if (draft.pause !== current.auto_pause_threshold) {
    patch.auto_pause_threshold = draft.pause
  }
  return patch
}
