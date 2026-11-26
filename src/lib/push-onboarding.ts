export type OnboardingState = 'install' | 'enable' | 'hidden'

export interface OnboardingEnv {
  userAgent: string
  platform: string
  maxTouchPoints: number
  standalone: boolean
  notificationPermission: 'default' | 'granted' | 'denied' | 'unsupported'
  dismissed: boolean
}

export const DISMISS_KEY = 'push-onboarding-dismissed'

const IOS_UA_RE = /iPad|iPhone|iPod/
const NON_SAFARI_RE = /CriOS|FxiOS|EdgiOS|OPiOS/

function isIos(env: OnboardingEnv): boolean {
  if (IOS_UA_RE.test(env.userAgent)) return true
  return env.platform === 'MacIntel' && env.maxTouchPoints > 1
}

function isSafari(env: OnboardingEnv): boolean {
  return !NON_SAFARI_RE.test(env.userAgent)
}

export function getOnboardingState(env: OnboardingEnv): OnboardingState {
  if (env.dismissed) return 'hidden'
  if (isIos(env) && isSafari(env) && !env.standalone) return 'install'
  if (
    env.notificationPermission === 'unsupported' ||
    env.notificationPermission === 'granted' ||
    env.notificationPermission === 'denied'
  ) {
    return 'hidden'
  }
  return 'enable'
}
