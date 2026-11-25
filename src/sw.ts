import { precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0]
}

interface PushPayload {
  title?: string
  body?: string
}

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', (event: PushEvent) => {
  let payload: PushPayload = {}
  try {
    payload = event.data?.json() ?? {}
  } catch {
    // malformed push payload: fall back to defaults
  }
  const title = payload.title ?? 'Agent Quota Dashboard'
  const body = payload.body ?? ''
  event.waitUntil(self.registration.showNotification(title, { body }))
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client instanceof WindowClient) {
          return client.focus()
        }
      }
      return self.clients.openWindow('/')
    }),
  )
})
