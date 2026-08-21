/**
 * #303C — Pure Web Push delivery protocol helpers (shared by tests + docs).
 * No OpenAI. Never logs secrets or reminder title/body.
 */

/** @typedef {'success' | 'gone' | 'auth' | 'throttle' | 'server' | 'network' | 'malformed' | 'unknown'} PushResultClass */

/**
 * Classify Web Push HTTP / error outcomes for retry vs disable.
 * @param {number | null | undefined} status
 * @param {string} [message]
 * @returns {{ class: PushResultClass, retryable: boolean, disableSubscription: boolean, code: string }}
 */
export function classifyPushSendResult(status, message = '') {
  const s = typeof status === 'number' ? status : null
  const msg = String(message || '').toLowerCase()

  if (s === 404 || s === 410) {
    return {
      class: 'gone',
      retryable: false,
      disableSubscription: true,
      code: s === 410 ? 'push_subscription_gone' : 'push_subscription_not_found',
    }
  }
  if (s === 401 || s === 403) {
    return {
      class: 'auth',
      retryable: false,
      disableSubscription: false,
      code: 'push_vapid_or_auth_failed',
    }
  }
  if (s === 429) {
    return {
      class: 'throttle',
      retryable: true,
      disableSubscription: false,
      code: 'push_throttled',
    }
  }
  if (s != null && s >= 500) {
    return {
      class: 'server',
      retryable: true,
      disableSubscription: false,
      code: 'push_provider_5xx',
    }
  }
  if (s != null && s >= 200 && s < 300) {
    return {
      class: 'success',
      retryable: false,
      disableSubscription: false,
      code: 'push_accepted',
    }
  }
  if (/timeout|network|fetch failed|econnreset|enotfound/.test(msg)) {
    return {
      class: 'network',
      retryable: true,
      disableSubscription: false,
      code: 'push_network_error',
    }
  }
  if (/malformed|invalid subscription|invalid key/.test(msg)) {
    return {
      class: 'malformed',
      retryable: false,
      disableSubscription: true,
      code: 'push_subscription_malformed',
    }
  }
  return {
    class: 'unknown',
    retryable: true,
    disableSubscription: false,
    code: 'push_unknown_error',
  }
}

/**
 * Bounded exponential backoff for next_attempt_at (seconds).
 * @param {number} attemptNumber 1-based
 */
export function pushRetryDelaySeconds(attemptNumber) {
  const n = Math.max(1, Math.min(Number(attemptNumber) || 1, 8))
  // 1m, 2m, 4m, 8m, 16m, 32m (cap)
  return Math.min(60 * 2 ** (n - 1), 32 * 60)
}

export const PUSH_MAX_DELIVERY_ATTEMPTS = 5

/**
 * Build OS notification payload (title is untrusted text — SW must not eval).
 * @param {{ reminderId: string, title: string }} input
 */
export function buildReminderPushPayload(input) {
  const reminderId = String(input.reminderId || '').trim()
  const title = String(input.title || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 200)
  if (!reminderId) throw new Error('reminder_id_required')
  return {
    type: 'reminder',
    reminderId,
    title: title || 'Promemoria',
    body: '',
    url: `/?reminder=${encodeURIComponent(reminderId)}`,
    tag: reminderId,
    timestamp: Date.now(),
  }
}

/**
 * #334D1 — Privacy-safe morning briefing push (no personal facts).
 * @param {{ localDate?: string, language?: 'it'|'en' }} [input]
 */
export function buildMorningBriefingPushPayload(input = {}) {
  const localDate =
    typeof input.localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.localDate.trim())
      ? input.localDate.trim()
      : null
  const language = input.language === 'en' ? 'en' : 'it'
  const body =
    language === 'en'
      ? 'Your morning briefing is ready.'
      : 'Il tuo briefing mattutino è pronto.'
  const tag = localDate ? `morning-briefing:${localDate}` : 'morning-briefing'
  return {
    type: 'morning_briefing',
    title: 'ShinkAIdo',
    body,
    url: '/?briefing=morning',
    tag,
    timestamp: Date.now(),
  }
}

/**
 * Validate SW-bound payload shape (no arbitrary URLs).
 * Supports legacy reminder payloads (no type) and #334D1 morning_briefing.
 * @param {unknown} raw
 * @returns {{ ok: true, data: object } | { ok: false, code: string }}
 */
export function validateServiceWorkerPushPayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'payload_not_object' }
  }
  const o = /** @type {Record<string, unknown>} */ (raw)
  const typeRaw = typeof o.type === 'string' ? o.type.trim() : ''
  const type =
    typeRaw === 'morning_briefing'
      ? 'morning_briefing'
      : typeRaw === 'reminder' || !typeRaw
        ? 'reminder'
        : null
  if (!type) return { ok: false, code: 'payload_type_invalid' }

  const safeSameOriginUrl = (fallback) => {
    let url = fallback
    if (typeof o.url === 'string' && o.url.trim()) {
      const candidate = o.url.trim()
      if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('://')) {
        return { ok: false, code: 'url_not_same_origin' }
      }
      if (candidate.length > 512) return { ok: false, code: 'url_too_long' }
      url = candidate
    }
    return { ok: true, url }
  }

  if (type === 'morning_briefing') {
    const title =
      typeof o.title === 'string'
        ? o.title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200)
        : 'ShinkAIdo'
    const body =
      typeof o.body === 'string'
        ? o.body.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200)
        : 'Il tuo briefing mattutino è pronto.'
    const urlRes = safeSameOriginUrl('/?briefing=morning')
    if (!urlRes.ok) return urlRes
    // Reject personal-looking query params beyond the briefing marker.
    if (/[?&](user|uid|token|event|reminder|city)=/i.test(urlRes.url)) {
      return { ok: false, code: 'url_not_allowed' }
    }
    if (!urlRes.url.includes('briefing=morning')) {
      return { ok: false, code: 'url_not_morning_briefing' }
    }
    const tag =
      typeof o.tag === 'string' && o.tag.trim()
        ? o.tag.trim().slice(0, 120)
        : 'morning-briefing'
    return {
      ok: true,
      data: {
        type: 'morning_briefing',
        title: title || 'ShinkAIdo',
        body: body || 'Il tuo briefing mattutino è pronto.',
        url: urlRes.url,
        tag,
      },
    }
  }

  // reminder (legacy + typed)
  const reminderId = typeof o.reminderId === 'string' ? o.reminderId.trim() : ''
  if (!reminderId || reminderId.length > 80) return { ok: false, code: 'reminder_id_invalid' }

  const title =
    typeof o.title === 'string'
      ? o.title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200)
      : 'Promemoria'
  const body =
    typeof o.body === 'string'
      ? o.body.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200)
      : ''

  const urlRes = safeSameOriginUrl(`/?reminder=${encodeURIComponent(reminderId)}`)
  if (!urlRes.ok) return urlRes

  const tag =
    typeof o.tag === 'string' && o.tag.trim() ? o.tag.trim().slice(0, 120) : reminderId

  return {
    ok: true,
    data: {
      type: 'reminder',
      reminderId,
      title: title || 'Promemoria',
      body,
      url: urlRes.url,
      tag,
    },
  }
}

/**
 * Whether a reminder row is still eligible for push claim given push_sent_at.
 * Mirrors #303C SQL addition (push_sent_at IS NULL).
 * @param {{ pushSentAt?: string | null, push_sent_at?: string | null }} row
 */
export function isEligibleForPushClaimBySentAt(row) {
  const sent = row?.pushSentAt ?? row?.push_sent_at
  return sent == null || sent === ''
}

/**
 * Resolve notification click target URL against a same-origin base.
 * @param {string} origin e.g. https://app.example
 * @param {string} pathOrUrl relative path from payload
 */
export function resolveSameOriginNotificationUrl(origin, pathOrUrl) {
  const base = String(origin || '').replace(/\/+$/, '')
  const path = typeof pathOrUrl === 'string' ? pathOrUrl.trim() : '/'
  if (!base) return path.startsWith('/') ? path : '/'
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
    return `${base}/`
  }
  return `${base}${path}`
}
