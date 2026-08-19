/**
 * #317 — Session weather forecast cache (client).
 * current ~10 min, forecast ~20 min. Never permanently persist.
 */

export const WEATHER_CACHE_KEY = 'shinkaido.weatherCache.v1'
export const CURRENT_TTL_MS = 10 * 60 * 1000
export const FORECAST_TTL_MS = 20 * 60 * 1000

function cacheKey(parts) {
  const lat = typeof parts.latitude === 'number' ? parts.latitude.toFixed(2) : ''
  const lon = typeof parts.longitude === 'number' ? parts.longitude.toFixed(2) : ''
  const loc = String(parts.locationText || '').toLowerCase().slice(0, 80)
  return `${loc}|${lat},${lon}`
}

export function loadWeatherCache(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return {}
  try {
    const raw = storage.getItem(WEATHER_CACHE_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

export function saveWeatherCacheEntry(parts, weather, nowMs = Date.now()) {
  const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null
  if (!storage || !weather || weather.status !== 'ok') return
  try {
    const all = loadWeatherCache(storage)
    const key = cacheKey(parts)
    all[key] = {
      weather,
      savedAt: nowMs,
      expiresAt: nowMs + FORECAST_TTL_MS,
    }
    // Bound cache size
    const keys = Object.keys(all)
    if (keys.length > 8) {
      keys
        .sort((a, b) => (all[a].savedAt || 0) - (all[b].savedAt || 0))
        .slice(0, keys.length - 8)
        .forEach((k) => delete all[k])
    }
    storage.setItem(WEATHER_CACHE_KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

/**
 * @returns {{ hit: boolean, weather?: object, ageMs?: number }}
 */
export function getCachedWeather(parts, nowMs = Date.now(), ttlMs = FORECAST_TTL_MS) {
  const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null
  const all = loadWeatherCache(storage)
  const key = cacheKey(parts)
  const entry = all[key]
  if (!entry || !entry.weather || entry.weather.status !== 'ok') return { hit: false }
  const age = nowMs - (entry.savedAt || 0)
  if (age > ttlMs || (entry.expiresAt && entry.expiresAt < nowMs)) return { hit: false }
  return { hit: true, weather: entry.weather, ageMs: age }
}

/** Prefer shorter TTL when only current conditions are needed. */
export function getCachedWeatherForOperation(parts, operation, nowMs = Date.now()) {
  const ttl =
    operation === 'current' || operation === 'temperature' || operation === 'wind'
      ? CURRENT_TTL_MS
      : FORECAST_TTL_MS
  return getCachedWeather(parts, nowMs, ttl)
}
