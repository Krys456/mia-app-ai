/* #303C/#334D1 — Minimal ShinkAIdo service worker (push + notificationclick only).
 * No Workbox. No offline cache. No app-shell precache.
 * Supports type: reminder (legacy) and type: morning_briefing.
 */
/* eslint-disable no-restricted-globals */

function validatePayload(raw) {
  if (!raw || typeof raw !== 'object') return null
  const typeRaw = typeof raw.type === 'string' ? raw.type.trim() : ''
  const type =
    typeRaw === 'morning_briefing'
      ? 'morning_briefing'
      : typeRaw === 'reminder' || !typeRaw
        ? 'reminder'
        : null
  if (!type) return null

  function sameOriginUrl(fallback) {
    let url = fallback
    if (typeof raw.url === 'string' && raw.url.trim()) {
      const candidate = raw.url.trim()
      if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('://')) {
        return null
      }
      if (candidate.length > 512) return null
      url = candidate
    }
    return url
  }

  if (type === 'morning_briefing') {
    const title =
      typeof raw.title === 'string'
        ? raw.title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200)
        : 'ShinkAIdo'
    const body =
      typeof raw.body === 'string'
        ? raw.body.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200)
        : 'Il tuo briefing mattutino è pronto.'
    const url = sameOriginUrl('/?briefing=morning')
    if (!url || !url.includes('briefing=morning')) return null
    if (/[?&](user|uid|token|event|reminder|city)=/i.test(url)) return null
    const tag =
      typeof raw.tag === 'string' && raw.tag.trim()
        ? raw.tag.trim().slice(0, 120)
        : 'morning-briefing'
    return {
      type: 'morning_briefing',
      title: title || 'ShinkAIdo',
      body: body || 'Il tuo briefing mattutino è pronto.',
      url: url,
      tag: tag,
    }
  }

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
  const url = sameOriginUrl('/?reminder=' + encodeURIComponent(reminderId))
  if (!url) return null
  const tag =
    typeof raw.tag === 'string' && raw.tag.trim() ? raw.tag.trim().slice(0, 120) : reminderId
  return {
    type: 'reminder',
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
    type: 'reminder',
    reminderId: 'unknown',
    title: 'Promemoria',
    body: '',
    url: '/',
    tag: 'shinkaido-reminder',
  }

  const isMorning = data.type === 'morning_briefing'
  const notificationTitle = 'ShinkAIdo'
  const notificationBody = isMorning
    ? data.body || 'Il tuo briefing mattutino è pronto.'
    : data.title

  event.waitUntil(
    self.registration.showNotification('ShinkAIdo', {
      body: notificationBody,
      tag: data.tag,
      renotify: false,
      data: {
        type: data.type || 'reminder',
        reminderId: data.reminderId || null,
        url: data.url,
      },
    }),
  )
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  const data =
    event.notification && event.notification.data && typeof event.notification.data === 'object'
      ? event.notification.data
      : {}
  const rawUrl = typeof data.url === 'string' ? data.url : '/'
  const path =
    rawUrl.startsWith('/') && !rawUrl.startsWith('//') && rawUrl.indexOf('://') === -1
      ? rawUrl
      : '/'
  const isMorning = data.type === 'morning_briefing'

  function focusClient(target, fallback) {
    const c = target || fallback
    return c && 'focus' in c ? c.focus() : fallback && 'focus' in fallback ? fallback.focus() : undefined
  }

  /** Existing window must receive morning intent even when navigate is missing/fails. */
  function deliverMorningIntent(target) {
    if (!target || !('postMessage' in target)) return
    try {
      target.postMessage({ type: 'shinkaido.morning_briefing', intent: 'morning' })
    } catch (_err) {
      /* ignore */
    }
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (let i = 0; i < clientList.length; i += 1) {
        const client = clientList[i]
        try {
          const clientUrl = new URL(client.url)
          if (clientUrl.origin === self.location.origin && 'focus' in client) {
            // Reminder path: preserve legacy navigate-or-focus exactly.
            if (!isMorning) {
              if ('navigate' in client && path) {
                return client.navigate(path).then(function (c) {
                  return focusClient(c, client)
                })
              }
              return client.focus()
            }

            // Morning briefing: focus + ensure intent reaches this window.
            if ('navigate' in client && path) {
              return client.navigate(path).then(
                function (c) {
                  const target = c || client
                  deliverMorningIntent(target)
                  return focusClient(c, client)
                },
                function () {
                  deliverMorningIntent(client)
                  return client.focus()
                },
              )
            }
            deliverMorningIntent(client)
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
