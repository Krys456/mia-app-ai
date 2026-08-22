/**
 * #337B — Session-only activeEmail context (not Memory).
 * Mirrors src/lib/calendar-chat/active-context.js.
 */

export const EMAIL_CONTEXT_KEY = 'shinkaido.activeEmail.v1'
export const EMAIL_CONTEXT_TTL_MS = 30 * 60 * 1000

export function createEmailContext(input) {
  if (!input || typeof input !== 'object') return null
  const now = input.createdAt || Date.now()
  const messages = Array.isArray(input.messages)
    ? input.messages.slice(0, 40).map((m) => ({
        id: String(m.id || '').slice(0, 160),
        threadId: m.threadId ? String(m.threadId).slice(0, 160) : null,
        from: m.from ? String(m.from).slice(0, 120) : null,
        fromEmail: m.fromEmail ? String(m.fromEmail).slice(0, 200) : null,
        subject: m.subject ? String(m.subject).slice(0, 200) : null,
        snippet: m.snippet ? String(m.snippet).slice(0, 400) : null,
        receivedAt: m.receivedAt || null,
        unread: Boolean(m.unread),
      }))
    : []
  return {
    queryType: String(input.queryType || 'today'),
    fetchedAt: input.fetchedAt || new Date(now).toISOString(),
    messages,
    focusIndex: typeof input.focusIndex === 'number' ? input.focusIndex : messages.length ? 0 : -1,
    status: String(input.status || 'ok'),
    timezone: String(input.timezone || ''),
    language: input.language === 'en' ? 'en' : 'it',
    createdAt: now,
    expiresAt: input.expiresAt || now + EMAIL_CONTEXT_TTL_MS,
  }
}

export function isEmailContextFresh(ctx, nowMs = Date.now()) {
  if (!ctx || typeof ctx !== 'object') return false
  if (typeof ctx.expiresAt !== 'number') return false
  return ctx.expiresAt > nowMs
}

export function loadEmailContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  nowMs = Date.now(),
) {
  if (!storage) return null
  try {
    const raw = storage.getItem(EMAIL_CONTEXT_KEY)
    if (!raw) return null
    const ctx = JSON.parse(raw)
    if (!isEmailContextFresh(ctx, nowMs)) {
      storage.removeItem(EMAIL_CONTEXT_KEY)
      return null
    }
    return ctx
  } catch {
    return null
  }
}

export function saveEmailContext(
  ctx,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    if (!ctx || !isEmailContextFresh(ctx)) {
      storage.removeItem(EMAIL_CONTEXT_KEY)
      return
    }
    storage.setItem(EMAIL_CONTEXT_KEY, JSON.stringify(ctx))
  } catch {
    /* ignore */
  }
}

export function clearEmailContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    storage.removeItem(EMAIL_CONTEXT_KEY)
  } catch {
    /* ignore */
  }
}
