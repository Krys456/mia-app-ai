/**
 * #355B — Client-side Haversine (display-only fallback).
 *
 * The Edge Function already returns distanceMeters for each place, so this
 * is only used to enrich a place that is missing it (e.g. provider omitted
 * the field). Origin coordinates used here are never persisted — the
 * controller discards them right after this calculation.
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
  const phi1 = toRad(a)
  const phi2 = toRad(c)
  const dPhi = toRad(c - a)
  const dLambda = toRad(d - b)
  const sinDPhi = Math.sin(dPhi / 2)
  const sinDLambda = Math.sin(dLambda / 2)
  const h = sinDPhi * sinDPhi + Math.cos(phi1) * Math.cos(phi2) * sinDLambda * sinDLambda
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))))
}
