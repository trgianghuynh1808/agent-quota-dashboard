import { useState } from 'react'
import {
  DISMISS_KEY,
  getOnboardingState,
  type OnboardingEnv,
  type OnboardingState,
} from '../lib/push-onboarding.js'

function readDismissed(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function readEnv(dismissed: boolean): OnboardingEnv {
  if (typeof window === 'undefined') {
    return {
      userAgent: '',
      platform: '',
      maxTouchPoints: 0,
      standalone: true,
      notificationPermission: 'unsupported',
      dismissed: true,
    }
  }

  const nav = window.navigator as Navigator & { standalone?: boolean }
  const standalone =
    nav.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches

  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    standalone,
    notificationPermission:
      typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    dismissed,
  }
}

const steps = [
  'Nhấn Share',
  'Add to Home Screen',
  'mở app từ Home Screen',
]

export function PushOnboardingBanner() {
  const [dismissed, setDismissed] = useState(readDismissed)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    () => readEnv(readDismissed()).notificationPermission,
  )

  const state: OnboardingState = getOnboardingState(readEnv(dismissed))

  if (state === 'hidden') return null

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // ignore storage failures
    }
    setDismissed(true)
  }

  async function enable() {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setPermission(result)
  }

  return (
    <section
      data-testid="push-onboarding"
      data-state={state}
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:col-span-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-slate-900">
            Bật thông báo đẩy
          </span>
          {state === 'install' ? (
            <p className="text-sm text-slate-600">
              Trên iOS, hãy thêm app vào Home Screen trước khi bật thông báo.
            </p>
          ) : (
            <p className="text-sm text-slate-600">
              Nhận cảnh báo quota và circuit breaker ngay trên thiết bị này.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
        >
          Đóng
        </button>
      </div>

      {state === 'install' ? (
        <ol className="flex flex-col gap-1 text-sm text-slate-700">
          {steps.map((step, index) => (
            <li key={step} className="flex gap-2">
              <span className="font-semibold text-slate-900">{index + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={enable}
            disabled={permission !== 'default'}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
          >
            Bật thông báo
          </button>
        </div>
      )}
    </section>
  )
}
