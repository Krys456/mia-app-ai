/**
 * #355B — Session-only activePlaces context (never Memory / Supabase).
 *
 * Shape: { queryType, fetchedAt, places[], focusIndex, status, language,
 * createdAt, expiresAt }. Per spec, the user's origin latitude/longitude is
 * NEVER stored here — only the resulting places (which already carry a
 * precomputed distanceMeters) are kept.
 */

export const PLACES_CONTEXT_KEY = 'shinkaido.activePlaces.v1'
export const PLACES_CONTEXT_TTL_MS = 30 * 60 * 1000

export const PLACES_PENDING_KEY = 'shinkaido.pendingPlaces.v1'
export const PLACES_PENDING_TTL_MS = 15 * 60 * 1000

const ALLOWED_PLACE_KEYS = [
  'id',
  'name',
  'category',
  'address',
  'latitude',
  'longitude',
  'distanceMeters',
  'provider',
]

function sanitizePlace(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id.slice(0, 160) : ''
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 160) : ''
  const latitude = typeof raw.latitude === 'number' ? raw.latitude : null
  const longitude = typeof raw.longitude === 'number' ? raw.longitude : null
  if (!id || !name || latitude === null || longitude === null) return null
  const out = {}
  for (const key of ALLOWED_PLACE_KEYS) {
    if (key === 'id') out.id = id
    else if (key === 'name') out.name = name
    else if (key === 'latitude') out.latitude = latitude
    else if (key === 'longitude') out.longitude = longitude
    else if (key === 'category') out.category = typeof raw.category === 'string' ? raw.category.slice(0, 60) : null
    else if (key === 'address') out.address = typeof raw.address === 'string' ? raw.address.slice(0, 240) : null
    else if (key === 'distanceMeters')
      out.distanceMeters = typeof raw.distanceMeters === 'number' ? raw.distanceMeters : null
    else if (key === 'provider') out.provider = typeof raw.provider === 'string' ? raw.provider.slice(0, 40) : null
  }
  return out
}

/**
 * @param {{
 *   queryType: string
 *   places: Array<Record<string, unknown>>
 *   focusIndex?: number
 *   status?: string
 *   language?: 'it'|'en'
 *   fetchedAt?: string
 *   createdAt?: number
 *   expiresAt?: number
 * }} input
 */
export function createPlacesContext(input) {
  if (!input || typeof input !== 'object') return null
  const places = Array.isArray(input.places)
    ? input.places.map(sanitizePlace).filter(Boolean).slice(0, 10)
    : []
  const now = input.createdAt || Date.now()
  return {
    queryType: String(input.queryType || 'nearby_category'),
    fetchedAt: input.fetchedAt || new Date(now).toISOString(),
    places,
    focusIndex:
      typeof input.focusIndex === 'number' ? input.focusIndex : places.length ? 0 : -1,
    status: String(input.status || 'ok'),
    language: input.language === 'en' ? 'en' : 'it',
    createdAt: now,
    expiresAt: input.expiresAt || now + PLACES_CONTEXT_TTL_MS,
  }
}

export function isPlacesContextFresh(ctx, nowMs = Date.now()) {
  if (!ctx || typeof ctx !== 'object') return false
  if (typeof ctx.expiresAt !== 'number') return false
  return ctx.expiresAt > nowMs
}

export function loadPlacesContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  nowMs = Date.now(),
) {
  if (!storage) return null
  try {
    const raw = storage.getItem(PLACES_CONTEXT_KEY)
    if (!raw) return null
    const ctx = JSON.parse(raw)
    if (!isPlacesContextFresh(ctx, nowMs)) {
      storage.removeItem(PLACES_CONTEXT_KEY)
      return null
    }
    return ctx
  } catch {
    return null
  }
}

export function savePlacesContext(
  ctx,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    if (!ctx || !isPlacesContextFresh(ctx)) {
      storage.removeItem(PLACES_CONTEXT_KEY)
      return
    }
    storage.setItem(PLACES_CONTEXT_KEY, JSON.stringify(ctx))
  } catch {
    /* ignore */
  }
}

export function clearPlacesContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    storage.removeItem(PLACES_CONTEXT_KEY)
  } catch {
    /* ignore */
  }
}

/** Move (and clamp) the focused place index. Returns a new context object. */
export function focusIndexInContext(ctx, index) {
  if (!isPlacesContextFresh(ctx) || !Array.isArray(ctx.places) || !ctx.places.length) return null
  const clamped = Math.max(0, Math.min(index, ctx.places.length - 1))
  return { ...ctx, focusIndex: clamped }
}

export function getFocusedPlace(ctx) {
  if (!isPlacesContextFresh(ctx) || !Array.isArray(ctx.places) || !ctx.places.length) return null
  const idx = typeof ctx.focusIndex === 'number' && ctx.focusIndex >= 0 ? ctx.focusIndex : 0
  return ctx.places[idx] || null
}

/**
 * Pending intent — bridges "needs GPS" reply → the follow-up turn where the
 * user grants location (chip tap or "usa la mia posizione"). Never holds
 * coordinates; only the structured query the user asked for.
 */
export function savePendingPlacesRequest(
  pending,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    if (!pending) {
      storage.removeItem(PLACES_PENDING_KEY)
      return
    }
    storage.setItem(
      PLACES_PENDING_KEY,
      JSON.stringify({ ...pending, createdAt: pending.createdAt || Date.now() }),
    )
  } catch {
    /* ignore */
  }
}

export function loadPendingPlacesRequest(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  nowMs = Date.now(),
) {
  if (!storage) return null
  try {
    const raw = storage.getItem(PLACES_PENDING_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (!p || typeof p !== 'object') return null
    if (nowMs - (p.createdAt || 0) > PLACES_PENDING_TTL_MS) {
      storage.removeItem(PLACES_PENDING_KEY)
      return null
    }
    return p
  } catch {
    return null
  }
}

export function clearPendingPlacesRequest(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    storage.removeItem(PLACES_PENDING_KEY)
  } catch {
    /* ignore */
  }
}
