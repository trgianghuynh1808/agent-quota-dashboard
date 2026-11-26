import { describe, expect, it } from 'vitest'
import {
  getOnboardingState,
  type OnboardingEnv,
} from '../src/lib/push-onboarding.js'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const IPAD_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1'
const CHROME_IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1'
const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function env(overrides: Partial<OnboardingEnv>): OnboardingEnv {
  return {
    userAgent: DESKTOP_CHROME_UA,
    platform: 'MacIntel',
    maxTouchPoints: 0,
    standalone: false,
    notificationPermission: 'default',
    dismissed: false,
    ...overrides,
  }
}

describe('getOnboardingState', () => {
  it('T1: iOS Safari chưa cài PWA → install', () => {
    const iphone = env({
      userAgent: IPHONE_UA,
      platform: 'iPhone',
      standalone: false,
      notificationPermission: 'unsupported',
    })
    const ipad = env({
      userAgent: IPAD_UA,
      platform: 'MacIntel',
      maxTouchPoints: 5,
      standalone: false,
      notificationPermission: 'unsupported',
    })
    const chromeIos = env({
      userAgent: CHROME_IOS_UA,
      platform: 'iPhone',
      standalone: false,
      notificationPermission: 'unsupported',
    })

    expect(getOnboardingState(iphone)).toBe('install')
    expect(getOnboardingState(ipad)).toBe('install')
    expect(getOnboardingState(chromeIos)).not.toBe('install')
    expect(getOnboardingState(chromeIos)).toBe('hidden')
  })

  it('T2: standalone/desktop chỉ enable khi permission default, dismissed luôn ẩn', () => {
    const iphoneStandalone = env({
      userAgent: IPHONE_UA,
      platform: 'iPhone',
      standalone: true,
    })
    const desktop = env({ userAgent: DESKTOP_CHROME_UA })

    expect(
      getOnboardingState({ ...iphoneStandalone, notificationPermission: 'default' }),
    ).toBe('enable')
    expect(
      getOnboardingState({ ...iphoneStandalone, notificationPermission: 'granted' }),
    ).toBe('hidden')
    expect(
      getOnboardingState({ ...iphoneStandalone, notificationPermission: 'denied' }),
    ).toBe('hidden')
    expect(getOnboardingState(desktop)).toBe('enable')
    expect(getOnboardingState({ ...desktop, dismissed: true })).toBe('hidden')
  })
})
