/* #303C — Minimal ShinkAIdo service worker (push + notificationclick only).
 * No Workbox. No offline cache. No app-shell precache.
 */
/* eslint-disable no-restricted-globals */

function validatePayload(raw) {
  if (!raw || typeof raw !== 'object') return null
  const reminderId = typeof raw.reminderId === 'string' ? raw.reminderId.trim() : ''
  if (!reminderId || reminderId.length > 80) return null
  const title =
    typeof raw.title === 'string'
      ? raw.title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200)
      : 'Promemoria'
  const body =
    typeof raw.body === 'string'
      ? raw.body.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200)
      : ''
  let url = '/?reminder=' + encodeURIComponent(reminderId)
  if (typeof raw.url === 'string' && raw.url.trim()) {
    const candidate = raw.url.trim()
    if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('://')) {
      return null
    }
    if (candidate.length > 512) return null
    url = candidate
  }
  const tag =
    typeof raw.tag === 'string' && raw.tag.trim() ? raw.tag.trim().slice(0, 120) : reminderId
  return {
    reminderId: reminderId,
    title: title || 'Promemoria',
    body: body,
    url: url,
    tag: tag,
  }
}

self.addEventListener('push', function (event) {
  let parsed = null
  try {
    if (event.data) {
      parsed = validatePayload(event.data.json())
    }
  } catch (_err) {
    parsed = null
  }

  const data = parsed || {
    reminderId: 'unknown',
    title: 'Promemoria',
    body: '',
    url: '/',
    tag: 'shinkaido-reminder',
  }

  event.waitUntil(
    self.registration.showNotification('ShinkAIdo', {
      body: data.title,
      tag: data.tag,
      renotify: false,
      data: {
        reminderId: data.reminderId,
        url: data.url,
      },
    }),
  )
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  const rawUrl =
    event.notification &&
    event.notification.data &&
    typeof event.notification.data.url === 'string'
      ? event.notification.data.url
      : '/'
  const path =
    rawUrl.startsWith('/') && !rawUrl.startsWith('//') && rawUrl.indexOf('://') === -1
      ? rawUrl
      : '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (let i = 0; i < clientList.length; i += 1) {
        const client = clientList[i]
        try {
          const clientUrl = new URL(client.url)
          if (clientUrl.origin === self.location.origin && 'focus' in client) {
            if ('navigate' in client && path) {
              return client.navigate(path).then(function (c) {
                return c && c.focus ? c.focus() : client.focus()
              })
            }
            return client.focus()
          }
        } catch (_e) {
          /* continue */
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(path)
      }
      return undefined
    }),
  )
})
