/**
 * #315B — Bounded active messaging context for SMS → WhatsApp follow-ups.
 * Session-only; never from documents/web/model. Short TTL.
 */

export const MESSAGING_CONTEXT_KEY = 'shinkaido.activeMessaging.v1'
export const MESSAGING_CONTEXT_TTL_MS = 10 * 60 * 1000

/**
 * @typedef {{
 *   phone: string
 *   body: string
 *   channel: 'sms' | 'whatsapp' | 'message'
 *   createdAt: number
 * }} ActiveMessagingContext
 */

export function createMessagingContext(input) {
  const phone = String(input.phone || '').trim()
  if (!phone) return null
  return {
    phone,
    body: String(input.body || '').slice(0, 600),
    channel: input.channel === 'whatsapp' ? 'whatsapp' : input.channel === 'sms' ? 'sms' : 'message',
    createdAt: input.createdAt || Date.now(),
  }
}

export function isMessagingContextFresh(ctx, nowMs = Date.now()) {
  if (!ctx || typeof ctx !== 'object') return false
  if (typeof ctx.phone !== 'string' || !ctx.phone) return false
  if (typeof ctx.createdAt !== 'number') return false
  return nowMs - ctx.createdAt <= MESSAGING_CONTEXT_TTL_MS
}

export function parseStoredMessagingContext(raw, nowMs = Date.now()) {
  if (!raw || typeof raw !== 'object') return null
  const ctx = createMessagingContext(raw)
  if (!ctx || !isMessagingContextFresh(ctx, nowMs)) return null
  return ctx
}

export function loadMessagingContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  nowMs = Date.now(),
) {
  if (!storage) return null
  try {
    const raw = storage.getItem(MESSAGING_CONTEXT_KEY)
    if (!raw) return null
    return parseStoredMessagingContext(JSON.parse(raw), nowMs)
  } catch {
    return null
  }
}

export function saveMessagingContext(
  ctx,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    if (!ctx || !isMessagingContextFresh(ctx)) {
      storage.removeItem(MESSAGING_CONTEXT_KEY)
      return
    }
    storage.setItem(MESSAGING_CONTEXT_KEY, JSON.stringify(ctx))
  } catch {
    /* ignore */
  }
}

export function clearMessagingContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    storage.removeItem(MESSAGING_CONTEXT_KEY)
  } catch {
    /* ignore */
  }
}

/** Unrelated user turns should drop messaging context. */
export function shouldClearMessagingOnUserText(text) {
  const t = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
  if (!t.trim()) return false
  // Keep when clearly messaging / whatsapp / sms related
  if (/\b(whatsapp|sms|messaggio|message|scrivi|manda|invia|su\s+whatsapp)\b/.test(t)) {
    return false
  }
  // Clear on clearly new topics
  if (
    /\b(tempo|weather|timer|sveglia|spotify|youtube|maps|calendario|email|gmail|fotocamera|vision|bluetooth|wifi)\b/.test(
      t,
    )
  ) {
    return true
  }
  // Long unrelated questions
  if (t.length > 80 && !/\b(whatsapp|sms|\+\d)\b/.test(t)) return true
  return false
}
