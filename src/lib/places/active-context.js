/**
 * #316 — Bounded activePlacesContext (session only; never Supabase / Memory).
 */

export const PLACES_CONTEXT_KEY = 'shinkaido.activePlaces.v1'
export const PENDING_PLACES_KEY = 'shinkaido.pendingPlaces.v1'
export const PLACES_CONTEXT_TTL_MS = 15 * 60 * 1000

/**
 * @typedef {{
 *   query: string
 *   results: Array<Record<string, unknown>>
 *   selectedPlaceId?: string | null
 *   selectedIndex?: number | null
 *   originProvided: boolean
 *   explicitLocationText?: string | null
 *   language: 'it' | 'en'
 *   createdAt: number
 *   expiresAt: number
 * }} ActivePlacesContext
 */

export function createPlacesContext(input) {
  const results = Array.isArray(input.results) ? input.results.slice(0, 5) : []
  if (!results.length) return null
  const now = input.createdAt || Date.now()
  return {
    query: String(input.query || '').slice(0, 120),
    results,
    selectedPlaceId: input.selectedPlaceId || results[0]?.id || null,
    selectedIndex: typeof input.selectedIndex === 'number' ? input.selectedIndex : 0,
    originProvided: Boolean(input.originProvided),
    explicitLocationText: input.explicitLocationText || null,
    language: input.language === 'en' ? 'en' : 'it',
    createdAt: now,
    expiresAt: input.expiresAt || now + PLACES_CONTEXT_TTL_MS,
  }
}

export function isPlacesContextFresh(ctx, nowMs = Date.now()) {
  if (!ctx || typeof ctx !== 'object') return false
  if (!Array.isArray(ctx.results) || !ctx.results.length) return false
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

export function savePendingPlacesRequest(
  pending,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    if (!pending) {
      storage.removeItem(PENDING_PLACES_KEY)
      return
    }
    storage.setItem(
      PENDING_PLACES_KEY,
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
    const raw = storage.getItem(PENDING_PLACES_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (!p || typeof p.query !== 'string') return null
    if (nowMs - (p.createdAt || 0) > PLACES_CONTEXT_TTL_MS) {
      storage.removeItem(PENDING_PLACES_KEY)
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
    storage.removeItem(PENDING_PLACES_KEY)
  } catch {
    /* ignore */
  }
}

export function selectPlaceInContext(ctx, index) {
  if (!isPlacesContextFresh(ctx)) return null
  const i = Math.max(0, Math.min(index, ctx.results.length - 1))
  const place = ctx.results[i]
  return {
    ...ctx,
    selectedIndex: i,
    selectedPlaceId: place?.id || null,
  }
}

export function selectNearestInContext(ctx) {
  if (!isPlacesContextFresh(ctx)) return null
  const withDist = ctx.results.filter((p) => typeof p.distanceMeters === 'number')
  if (!withDist.length) {
    return selectPlaceInContext(ctx, ctx.selectedIndex || 0)
  }
  let best = 0
  let bestD = Infinity
  ctx.results.forEach((p, i) => {
    if (typeof p.distanceMeters === 'number' && p.distanceMeters < bestD) {
      bestD = p.distanceMeters
      best = i
    }
  })
  return selectPlaceInContext(ctx, best)
}

export function getSelectedPlace(ctx) {
  if (!isPlacesContextFresh(ctx)) return null
  const i =
    typeof ctx.selectedIndex === 'number'
      ? ctx.selectedIndex
      : ctx.results.findIndex((p) => p.id === ctx.selectedPlaceId)
  const idx = i >= 0 ? i : 0
  return ctx.results[idx] || null
}
