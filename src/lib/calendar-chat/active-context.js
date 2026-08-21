/**
 * #336B — Session-only activeCalendar context (not Memory).
 */

export const CALENDAR_CONTEXT_KEY = 'shinkaido.activeCalendar.v1'
export const CALENDAR_CONTEXT_TTL_MS = 30 * 60 * 1000

export function createCalendarContext(input) {
  if (!input || typeof input !== 'object') return null
  const now = input.createdAt || Date.now()
  const events = Array.isArray(input.events)
    ? input.events.slice(0, 40).map((e) => ({
        id: String(e.id || '').slice(0, 120),
        title: String(e.title || '').slice(0, 120),
        start: e.start,
        end: e.end,
        allDay: Boolean(e.allDay),
        status: e.status || 'confirmed',
        timeZone: e.timeZone || input.timezone || null,
      }))
    : []
  return {
    dateRange: input.dateRange || null,
    labelDay: String(input.labelDay || ''),
    timezone: String(input.timezone || ''),
    fetchedAt: input.fetchedAt || new Date(now).toISOString(),
    events,
    focusIndex: typeof input.focusIndex === 'number' ? input.focusIndex : events.length ? 0 : -1,
    queryType: String(input.queryType || 'list'),
    status: String(input.status || 'ok'),
    language: input.language === 'en' ? 'en' : 'it',
    dayYmd: input.dayYmd || null,
    createdAt: now,
    expiresAt: input.expiresAt || now + CALENDAR_CONTEXT_TTL_MS,
  }
}

export function isCalendarContextFresh(ctx, nowMs = Date.now()) {
  if (!ctx || typeof ctx !== 'object') return false
  if (typeof ctx.expiresAt !== 'number') return false
  return ctx.expiresAt > nowMs
}

export function loadCalendarContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  nowMs = Date.now(),
) {
  if (!storage) return null
  try {
    const raw = storage.getItem(CALENDAR_CONTEXT_KEY)
    if (!raw) return null
    const ctx = JSON.parse(raw)
    if (!isCalendarContextFresh(ctx, nowMs)) {
      storage.removeItem(CALENDAR_CONTEXT_KEY)
      return null
    }
    return ctx
  } catch {
    return null
  }
}

export function saveCalendarContext(
  ctx,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    if (!ctx || !isCalendarContextFresh(ctx)) {
      storage.removeItem(CALENDAR_CONTEXT_KEY)
      return
    }
    storage.setItem(CALENDAR_CONTEXT_KEY, JSON.stringify(ctx))
  } catch {
    /* ignore */
  }
}

export function clearCalendarContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    storage.removeItem(CALENDAR_CONTEXT_KEY)
  } catch {
    /* ignore */
  }
}
