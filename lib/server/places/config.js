/**
 * #316 — Places server configuration (never expose keys to client).
 */

export function isPlacesEnabled(env = process.env) {
  return String(env.PLACES_ENABLED || '').trim().toLowerCase() === 'true'
}

export function getGooglePlacesApiKey(env = process.env) {
  const key = typeof env.GOOGLE_PLACES_API_KEY === 'string' ? env.GOOGLE_PLACES_API_KEY.trim() : ''
  return key || null
}

export function resolvePlacesConfig(env = process.env) {
  const enabled = isPlacesEnabled(env)
  const apiKey = getGooglePlacesApiKey(env)
  return {
    enabled,
    configured: Boolean(enabled && apiKey),
    provider: 'google_places',
    missingKey: enabled && !apiKey,
  }
}

/** Max results returned to the client / chat. */
export const PLACES_RESULT_LIMIT = 5

/** Default nearby search radius (meters). */
export const PLACES_DEFAULT_RADIUS_M = 4000
