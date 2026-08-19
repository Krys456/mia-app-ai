/**
 * #316 — Deterministic Haversine distance (straight-line meters).
 * LLM must never estimate distance.
 */

const EARTH_RADIUS_M = 6371000

/**
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number | null}
 */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const a = Number(lat1)
  const b = Number(lon1)
  const c = Number(lat2)
  const d = Number(lon2)
  if (![a, b, c, d].every((n) => Number.isFinite(n))) return null
  if (a < -90 || a > 90 || c < -90 || c > 90) return null
  if (b < -180 || b > 180 || d < -180 || d > 180) return null

  const toRad = (deg) => (deg * Math.PI) / 180
  const φ1 = toRad(a)
  const φ2 = toRad(c)
  const Δφ = toRad(c - a)
  const Δλ = toRad(d - b)
  const sinΔφ = Math.sin(Δφ / 2)
  const sinΔλ = Math.sin(Δλ / 2)
  const h = sinΔφ * sinΔφ + Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ
  const meters = 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
  return Math.round(meters)
}

/**
 * @param {number | null | undefined} meters
 * @param {'it' | 'en'} [lang]
 */
export function formatDistanceMeters(meters, lang = 'it') {
  if (meters == null || !Number.isFinite(meters) || meters < 0) return null
  if (meters < 1000) {
    return lang === 'en' ? `${Math.round(meters)} m` : `${Math.round(meters)} m`
  }
  const km = meters / 1000
  const rounded = km >= 10 ? Math.round(km) : Math.round(km * 10) / 10
  return `${rounded} km`
}
