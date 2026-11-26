/* eslint-env serviceworker */
/* global self */

var DEFAULT_TITLE = 'Agent Quota Dashboard'

self.addEventListener('push', function (event) {
  var title = DEFAULT_TITLE
  var body = ''
  try {
    if (event.data) {
      var payload = event.data.json()
      if (payload && typeof payload.title === 'string' && payload.title) {
        title = payload.title
      }
      if (payload && typeof payload.body === 'string') {
        body = payload.body
      }
    }
  } catch (err) {
    title = DEFAULT_TITLE
    body = ''
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: 'quota-alert',
      data: { url: '/' },
    }),
  )
})

self.addEventListener('notificationclick', function (event) {
  var notification = event.notification
  notification.close()

  var targetUrl = notification.data && notification.data.url ? notification.data.url : '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i += 1) {
        var client = clientList[i]
        if (client && typeof client.focus === 'function') {
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
      return undefined
    }),
  )
})
