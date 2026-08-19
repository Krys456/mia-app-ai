/**
 * #316 — Server Haversine (same algorithm as client).
 */

const EARTH_RADIUS_M = 6371000

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
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))))
}
