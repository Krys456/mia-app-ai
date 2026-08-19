/**
 * #317 — Bounded activeWeatherContext (session only; never Supabase / Memory).
 * Avoid persisting precise GPS coordinates.
 */

export const WEATHER_CONTEXT_KEY = 'shinkaido.activeWeather.v1'
export const PENDING_WEATHER_KEY = 'shinkaido.pendingWeather.v1'
/** ~25 minutes conversational continuity. */
export const WEATHER_CONTEXT_TTL_MS = 25 * 60 * 1000

/**
 * @typedef {{
 *   locationLabel: string
 *   country?: string | null
 *   timezone: string
 *   latitude?: number | null
 *   longitude?: number | null
 *   locationSource: 'explicit' | 'gps' | 'context'
 *   forecastSnapshot: object
 *   lastOperation?: string | null
 *   lastTimeHint?: string | null
 *   language: 'it' | 'en'
 *   createdAt: number
 *   expiresAt: number
 * }} ActiveWeatherContext
 */

export function createWeatherContext(input) {
  const snap = input.forecastSnapshot
  if (!snap || snap.status !== 'ok') return null
  const now = input.createdAt || Date.now()
  // Strip precise coords from persisted context when source was GPS — keep rounded label only
  const persistCoords = input.locationSource === 'explicit'
  return {
    locationLabel: String(input.locationLabel || snap.location?.name || '').slice(0, 120),
    country: input.country || snap.location?.country || null,
    timezone: String(input.timezone || snap.location?.timezone || 'UTC'),
    latitude: persistCoords && typeof input.latitude === 'number' ? input.latitude : null,
    longitude: persistCoords && typeof input.longitude === 'number' ? input.longitude : null,
    locationSource: input.locationSource || 'explicit',
    forecastSnapshot: snap,
    lastOperation: input.lastOperation || null,
    lastTimeHint: input.lastTimeHint || null,
    language: input.language === 'en' ? 'en' : 'it',
    createdAt: now,
    expiresAt: input.expiresAt || now + WEATHER_CONTEXT_TTL_MS,
  }
}

export function isWeatherContextFresh(ctx, nowMs = Date.now()) {
  if (!ctx || typeof ctx !== 'object') return false
  if (!ctx.forecastSnapshot || ctx.forecastSnapshot.status !== 'ok') return false
  if (typeof ctx.expiresAt !== 'number') return false
  return ctx.expiresAt > nowMs
}

export function loadWeatherContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  nowMs = Date.now(),
) {
  if (!storage) return null
  try {
    const raw = storage.getItem(WEATHER_CONTEXT_KEY)
    if (!raw) return null
    const ctx = JSON.parse(raw)
    if (!isWeatherContextFresh(ctx, nowMs)) {
      storage.removeItem(WEATHER_CONTEXT_KEY)
      return null
    }
    return ctx
  } catch {
    return null
  }
}

export function saveWeatherContext(
  ctx,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    if (!ctx || !isWeatherContextFresh(ctx)) {
      storage.removeItem(WEATHER_CONTEXT_KEY)
      return
    }
    storage.setItem(WEATHER_CONTEXT_KEY, JSON.stringify(ctx))
  } catch {
    /* ignore */
  }
}

export function clearWeatherContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    storage.removeItem(WEATHER_CONTEXT_KEY)
  } catch {
    /* ignore */
  }
}

export function savePendingWeatherRequest(
  pending,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    if (!pending) {
      storage.removeItem(PENDING_WEATHER_KEY)
      return
    }
    storage.setItem(PENDING_WEATHER_KEY, JSON.stringify(pending))
  } catch {
    /* ignore */
  }
}

export function loadPendingWeatherRequest(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return null
  try {
    const raw = storage.getItem(PENDING_WEATHER_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function clearPendingWeatherRequest(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    storage.removeItem(PENDING_WEATHER_KEY)
  } catch {
    /* ignore */
  }
}
