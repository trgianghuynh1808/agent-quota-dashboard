import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const SW_SOURCE = readFileSync(fileURLToPath(new URL('../public/push-sw.js', import.meta.url)), 'utf8')

type Listener = (event: any) => void

function loadServiceWorker() {
  const listeners = new Map<string, Listener>()
  const showNotification = vi.fn(() => Promise.resolve())
  const openWindow = vi.fn(() => Promise.resolve())
  let matchAllResult: unknown[] = []

  const self = {
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, listener)
    },
    registration: { showNotification },
    clients: {
      matchAll: () => Promise.resolve(matchAllResult),
      openWindow,
    },
  }

  vm.runInNewContext(SW_SOURCE, { self })

  function dispatch(type: string, event: unknown) {
    const listener = listeners.get(type)
    if (!listener) throw new Error(`no listener registered for ${type}`)
    listener(event)
  }

  return {
    showNotification,
    openWindow,
    dispatch,
    setMatchAllResult(result: unknown[]) {
      matchAllResult = result
    },
  }
}

function pushEvent(data?: { json: () => unknown }) {
  const waits: Promise<unknown>[] = []
  return {
    event: {
      data,
      waitUntil: (promise: Promise<unknown>) => {
        waits.push(promise)
      },
    },
    waits,
  }
}

function notificationClickEvent(notification: { close: () => void; data?: { url?: string } }) {
  const waits: Promise<unknown>[] = []
  return {
    event: {
      notification,
      waitUntil: (promise: Promise<unknown>) => {
        waits.push(promise)
      },
    },
    waits,
  }
}

describe('push-sw service worker', () => {
  it('T1: shows a notification from the push payload with safe fallbacks', async () => {
    const sw = loadServiceWorker()

    const valid = pushEvent({
      json: () => ({ title: 'Quota auto-pause', body: 'claude_code quota reached 96.0%' }),
    })
    sw.dispatch('push', valid.event)
    expect(valid.waits).toHaveLength(1)
    await valid.waits[0]
    expect(sw.showNotification).toHaveBeenLastCalledWith(
      'Quota auto-pause',
      expect.objectContaining({ body: 'claude_code quota reached 96.0%', data: { url: '/' } }),
    )

    const broken = pushEvent({
      json: () => {
        throw new Error('invalid payload')
      },
    })
    sw.dispatch('push', broken.event)
    expect(broken.waits).toHaveLength(1)
    await broken.waits[0]
    expect(sw.showNotification).toHaveBeenLastCalledWith(
      'Agent Quota Dashboard',
      expect.objectContaining({ body: '' }),
    )

    const noData = pushEvent(undefined)
    sw.dispatch('push', noData.event)
    expect(noData.waits).toHaveLength(1)
    await noData.waits[0]
    expect(sw.showNotification).toHaveBeenLastCalledWith(
      'Agent Quota Dashboard',
      expect.objectContaining({ body: '' }),
    )
  })

  it('T2: closes the notification and focuses or opens a window on click', async () => {
    const sw = loadServiceWorker()

    const focus = vi.fn(() => Promise.resolve())
    sw.setMatchAllResult([{ focus }])
    const existingClose = vi.fn()
    const existingClick = notificationClickEvent({ close: existingClose, data: { url: '/' } })
    sw.dispatch('notificationclick', existingClick.event)
    expect(existingClick.waits).toHaveLength(1)
    await existingClick.waits[0]
    expect(existingClose).toHaveBeenCalled()
    expect(focus).toHaveBeenCalled()
    expect(sw.openWindow).not.toHaveBeenCalled()

    sw.setMatchAllResult([])
    const newClose = vi.fn()
    const newClick = notificationClickEvent({ close: newClose, data: { url: '/' } })
    sw.dispatch('notificationclick', newClick.event)
    expect(newClick.waits).toHaveLength(1)
    await newClick.waits[0]
    expect(newClose).toHaveBeenCalled()
    expect(sw.openWindow).toHaveBeenCalledWith('/')
  })
})
