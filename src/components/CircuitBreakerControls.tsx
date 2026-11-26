import { useEffect, useState } from 'react'
import type { Control, GlobalStatus } from '../../api/_lib/types.js'
import type { ControlApi } from '../lib/control-api.js'

interface CircuitBreakerControlsProps {
  api: ControlApi
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function CircuitBreakerControls({ api }: CircuitBreakerControlsProps) {
  const [control, setControl] = useState<Control | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getControl()
      .then((loaded) => {
        if (cancelled) return
        setControl(loaded)
      })
      .catch((err: unknown) => {
        if (!cancelled) setApiError(toMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [api])

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
      {apiError !== null && (
        <p data-testid="cb-error" className="text-xs font-medium text-red-600">
          {apiError}
        </p>
      )}
    </section>
  )
}
