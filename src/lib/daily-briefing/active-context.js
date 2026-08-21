/**
 * #321/#334B — Session-only activeDailyBriefingContext.
 */

export const BRIEFING_CONTEXT_KEY = 'shinkaido.activeDailyBriefing.v1'
export const BRIEFING_CONTEXT_TTL_MS = 30 * 60 * 1000

export function createBriefingContext(input) {
  if (!input || typeof input !== 'object') return null
  const now = input.createdAt || Date.now()
  const presentationItems = Array.isArray(input.presentationItems)
    ? input.presentationItems.slice(0, 40)
    : []
  const priorities = Array.isArray(input.priorities) ? input.priorities.slice(0, 40) : []
  return {
    targetDate: String(input.targetDate || ''),
    timezone: String(input.timezone || ''),
    sourceStatuses: input.sourceStatuses || {},
    unavailableSources: Array.isArray(input.unavailableSources)
      ? input.unavailableSources.slice(0, 8)
      : [],
    calendarItems: Array.isArray(input.calendarItems) ? input.calendarItems.slice(0, 20) : [],
    reminderItems: Array.isArray(input.reminderItems) ? input.reminderItems.slice(0, 30) : [],
    weatherSnapshot: input.weatherSnapshot || null,
    presentationItems,
    priorities,
    focusIndex: typeof input.focusIndex === 'number' ? input.focusIndex : -1,
    displayText: String(input.displayText || '').slice(0, 4000),
    language: input.language === 'en' ? 'en' : 'it',
    generatedAt: input.generatedAt || new Date(now).toISOString(),
    createdAt: now,
    expiresAt: input.expiresAt || now + BRIEFING_CONTEXT_TTL_MS,
  }
}

export function isBriefingContextFresh(ctx, nowMs = Date.now()) {
  if (!ctx || typeof ctx !== 'object') return false
  if (typeof ctx.expiresAt !== 'number') return false
  return ctx.expiresAt > nowMs
}

export function loadBriefingContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  nowMs = Date.now(),
) {
  if (!storage) return null
  try {
    const raw = storage.getItem(BRIEFING_CONTEXT_KEY)
    if (!raw) return null
    const ctx = JSON.parse(raw)
    if (!isBriefingContextFresh(ctx, nowMs)) {
      storage.removeItem(BRIEFING_CONTEXT_KEY)
      return null
    }
    return ctx
  } catch {
    return null
  }
}

export function saveBriefingContext(
  ctx,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    if (!ctx || !isBriefingContextFresh(ctx)) {
      storage.removeItem(BRIEFING_CONTEXT_KEY)
      return
    }
    storage.setItem(BRIEFING_CONTEXT_KEY, JSON.stringify(ctx))
  } catch {
    /* ignore */
  }
}

export function clearBriefingContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    storage.removeItem(BRIEFING_CONTEXT_KEY)
  } catch {
    /* ignore */
  }
}
