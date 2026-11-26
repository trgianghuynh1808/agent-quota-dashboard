import { useEffect, useState } from 'react'
import type { Control, GlobalStatus } from '../../api/_lib/types.js'
import { buildControlPatch, validateThresholds } from '../lib/circuit-breaker.js'
import type { ControlApi } from '../lib/control-api.js'

interface CircuitBreakerControlsProps {
  api: ControlApi
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function CircuitBreakerControls({ api }: CircuitBreakerControlsProps) {
  const [control, setControl] = useState<Control | null>(null)
  const [warnText, setWarnText] = useState('')
  const [pauseText, setPauseText] = useState('')
  const [apiError, setApiError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getControl()
      .then((loaded) => {
        if (cancelled) return
        setControl(loaded)
        setWarnText(String(loaded.downgrade_model_threshold))
        setPauseText(String(loaded.auto_pause_threshold))
      })
      .catch((err: unknown) => {
        if (!cancelled) setApiError(toMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [api])

  const warn = Number(warnText)
  const pause = Number(pauseText)
  const validationError = validateThresholds(warn, pause)
  const hasChanges =
    control !== null &&
    (warn !== control.downgrade_model_threshold || pause !== control.auto_pause_threshold)
  const shownError = validationError ?? apiError
  const paused = control?.global_status === 'paused'

  async function toggleStatus() {
    if (control === null) return
    const next: GlobalStatus = control.global_status === 'running' ? 'paused' : 'running'
    try {
      setControl(await api.updateControl({ global_status: next }))
      setApiError(null)
    } catch (err: unknown) {
      setApiError(toMessage(err))
    }
  }

  async function saveThresholds() {
    if (control === null || validationError !== null) return
    try {
      const updated = await api.updateControl(
        buildControlPatch(control, { global_status: control.global_status, warn, pause }),
      )
      setControl(updated)
      setWarnText(String(updated.downgrade_model_threshold))
      setPauseText(String(updated.auto_pause_threshold))
      setApiError(null)
    } catch (err: unknown) {
      setApiError(toMessage(err))
    }
  }

  return (
    <section
      data-testid="circuit-breaker"
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-600">Circuit Breaker</span>
        <button
          type="button"
          role="switch"
          aria-checked={paused}
          data-testid="cb-toggle"
          disabled={control === null}
          onClick={toggleStatus}
          className={
            paused
              ? 'rounded-full border border-red-200 bg-red-600 px-3 py-1 text-xs font-semibold text-white'
              : 'rounded-full border border-emerald-200 bg-emerald-600 px-3 py-1 text-xs font-semibold text-white'
          }
        >
          {control === null ? 'LOADING' : paused ? 'PAUSED' : 'RUNNING'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="cb-warn-input" className="text-xs font-medium text-slate-500">
          Ngưỡng cảnh báo
        </label>
        <input
          id="cb-warn-input"
          type="number"
          min={1}
          max={100}
          data-testid="cb-warn-input"
          value={warnText}
          onChange={(e) => setWarnText(e.target.value)}
          className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-900"
        />
        <label htmlFor="cb-pause-input" className="text-xs font-medium text-slate-500">
          Ngưỡng auto-pause
        </label>
        <input
          id="cb-pause-input"
          type="number"
          min={1}
          max={100}
          data-testid="cb-pause-input"
          value={pauseText}
          onChange={(e) => setPauseText(e.target.value)}
          className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-900"
        />
        <button
          type="button"
          data-testid="cb-save"
          disabled={validationError !== null || !hasChanges}
          onClick={saveThresholds}
          className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
        >
          Lưu
        </button>
      </div>
      {shownError !== null && (
        <p data-testid="cb-error" className="text-xs font-medium text-red-600">
          {shownError}
        </p>
      )}
    </section>
  )
}
