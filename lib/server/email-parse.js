/**
 * #311 — Normalize Gmail API message payloads into a small internal format.
 * Never returns raw Gmail API objects to the model.
 */

export const EMAIL_BODY_TEXT_MAX_CHARS = 4000
export const EMAIL_SNIPPET_MAX_CHARS = 280

/**
 * @param {string} s
 */
function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ''
    })
}

/**
 * Best-effort HTML → plain text (no DOM). Safe for model pack only.
 * @param {string} html
 */
export function htmlToPlainText(html) {
  let s = String(html || '')
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
  s = s.replace(/<[^>]+>/g, ' ')
  s = decodeHtmlEntities(s)
  s = s.replace(/\u00a0/g, ' ')
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  s = s.replace(/[ \t]{2,}/g, ' ').trim()
  return s
}

/**
 * @param {string} data
 */
export function decodeBase64Url(data) {
  const raw = String(data || '').replace(/-/g, '+').replace(/_/g, '/')
  const pad = raw.length % 4 === 0 ? '' : '='.repeat(4 - (raw.length % 4))
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(raw + pad, 'base64').toString('utf8')
    }
  } catch {
    return ''
  }
  try {
    return decodeURIComponent(
      Array.from(atob(raw + pad))
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    )
  } catch {
    return ''
  }
}

/**
 * @param {unknown} headers
 * @param {string} name
 */
export function headerValue(headers, name) {
  if (!Array.isArray(headers)) return ''
  const want = name.toLowerCase()
  for (const h of headers) {
    if (!h || typeof h !== 'object') continue
    const n = typeof h.name === 'string' ? h.name.toLowerCase() : ''
    if (n === want && typeof h.value === 'string') return h.value.trim()
  }
  return ''
}

/**
 * Walk MIME parts; prefer text/plain, else text/html.
 * @param {unknown} part
 * @returns {{ plain: string, html: string }}
 */
export function extractBodiesFromPart(part) {
  let plain = ''
  let html = ''
  if (!part || typeof part !== 'object') return { plain, html }
  const p = /** @type {Record<string, unknown>} */ (part)
  const mime = typeof p.mimeType === 'string' ? p.mimeType.toLowerCase() : ''
  const body = p.body && typeof p.body === 'object' ? /** @type {Record<string, unknown>} */ (p.body) : null
  const data = body && typeof body.data === 'string' ? body.data : ''

  if (mime === 'text/plain' && data) {
    plain = decodeBase64Url(data)
  } else if (mime === 'text/html' && data) {
    html = decodeBase64Url(data)
  }

  if (Array.isArray(p.parts)) {
    for (const child of p.parts) {
      const nested = extractBodiesFromPart(child)
      if (!plain && nested.plain) plain = nested.plain
      if (!html && nested.html) html = nested.html
      if (plain && html) break
    }
  }
  return { plain, html }
}

/**
 * @param {string} text
 * @param {number} max
 */
function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  return `${s.slice(0, Math.max(0, max - 1))}…`
}

/**
 * Normalize one Gmail messages.get payload.
 * @param {unknown} raw
 */
export function normalizeGmailMessage(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      id: '',
      threadId: '',
      from: '',
      to: '',
      subject: '(senza oggetto)',
      date: '',
      snippet: '',
      bodyText: '',
      labels: [],
      importantReason: null,
    }
  }
  const msg = /** @type {Record<string, unknown>} */ (raw)
  const payload =
    msg.payload && typeof msg.payload === 'object'
      ? /** @type {Record<string, unknown>} */ (msg.payload)
      : {}
  const headers = Array.isArray(payload.headers) ? payload.headers : []
  const from = headerValue(headers, 'From') || ''
  const to = headerValue(headers, 'To') || ''
  const subject = headerValue(headers, 'Subject') || '(senza oggetto)'
  const date = headerValue(headers, 'Date') || ''
  const labels = Array.isArray(msg.labelIds) ? msg.labelIds.map(String) : []
  const snippet = clip(typeof msg.snippet === 'string' ? msg.snippet : '', EMAIL_SNIPPET_MAX_CHARS)

  const bodies = extractBodiesFromPart(payload)
  let bodyText = bodies.plain || ''
  if (!bodyText && bodies.html) bodyText = htmlToPlainText(bodies.html)
  bodyText = clip(bodyText, EMAIL_BODY_TEXT_MAX_CHARS)

  return {
    id: typeof msg.id === 'string' ? msg.id : '',
    threadId: typeof msg.threadId === 'string' ? msg.threadId : '',
    from,
    to,
    subject,
    date,
    snippet,
    bodyText,
    labels,
    importantReason: null,
  }
}

/**
 * Conservative important-email heuristics (Phase 1). Does not mutate Gmail.
 * @param {{ from?: string, subject?: string, snippet?: string, bodyText?: string, labels?: string[] }} msg
 */
export function scoreImportantEmail(msg) {
  const text = `${msg.subject || ''} ${msg.snippet || ''} ${msg.bodyText || ''} ${msg.from || ''}`.toLowerCase()
  const labels = Array.isArray(msg.labels) ? msg.labels : []
  /** @type {string[]} */
  const reasons = []

  if (labels.includes('UNREAD')) reasons.push('unread')
  if (labels.includes('IMPORTANT') || labels.includes('STARRED')) reasons.push('gmail_marked')

  const keywordGroups = [
    ['scadenz', 'deadline', 'urgente', 'urgent', 'asap'],
    ['pagamento', 'payment', 'invoice', 'fattura', 'bonifico', 'receipt'],
    ['colloquio', 'interview', 'offerta', 'offer', 'contratto', 'contract'],
    ['security', 'sicurezza', 'password', 'verifica', 'verify', '2fa', 'otp'],
    ['appuntamento', 'appointment', 'meeting', 'riunione'],
  ]
  for (const group of keywordGroups) {
    if (group.some((k) => text.includes(k))) {
      reasons.push(`keyword:${group[0]}`)
      break
    }
  }

  return {
    important: reasons.length > 0,
    reasons,
    importantReason: reasons.length ? reasons.join(',') : null,
  }
}
