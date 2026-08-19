/**
 * #316 — Safe Places diagnostics (?places_diag=1).
 * Never logs exact GPS or API keys.
 */

export const PLACES_DIAG_BUILD = '316-1'

export function isPlacesDiagEnabled(search) {
  try {
    const q =
      search != null
        ? String(search)
        : typeof window !== 'undefined'
          ? window.location.search
          : ''
    if (!q) return false
    const params = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q)
    const v = params.get('places_diag')
    return v === '1' || v === 'true'
  } catch {
    return false
  }
}

export function buildPlacesDiag(partial = {}) {
  let buildId = PLACES_DIAG_BUILD
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BUILD_ID) {
      buildId = import.meta.env.VITE_BUILD_ID
    }
  } catch {
    /* ignore */
  }
  return {
    route: 'places-action',
    buildId,
    requestId: partial.requestId || null,
    placesIntent: partial.placesIntent ?? null,
    operation: partial.operation ?? null,
    explicitLocationProvided: Boolean(partial.explicitLocationProvided),
    locationPermissionRequested: Boolean(partial.locationPermissionRequested),
    locationAcquired: Boolean(partial.locationAcquired),
    provider: partial.provider ?? null,
    providerRequestReached: Boolean(partial.providerRequestReached),
    providerHttpStatus: partial.providerHttpStatus ?? null,
    resultCount: typeof partial.resultCount === 'number' ? partial.resultCount : null,
    distancesCalculated: Boolean(partial.distancesCalculated),
    activePlacesContextCreated: Boolean(partial.activePlacesContextCreated),
    selectedPlaceIndex:
      typeof partial.selectedPlaceIndex === 'number' ? partial.selectedPlaceIndex : null,
    mapsHandoffAttempted: Boolean(partial.mapsHandoffAttempted),
    failureCode: partial.failureCode ?? null,
    status: partial.status ?? null,
  }
}

export function rememberPlacesDiag(payload) {
  if (!payload || payload.route !== 'places-action') return
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('shinkaido.placesDiag.last', JSON.stringify(payload))
    }
  } catch {
    /* ignore */
  }
  try {
    console.info('[places-diag]', payload)
  } catch {
    /* ignore */
  }
}

export function logPlacesSafe(event) {
  try {
    console.info('[places-action]', {
      route: 'places-action',
      status: event.status ?? null,
      operation: event.operation ?? null,
      failureCode: event.failureCode ?? null,
      resultCount: event.resultCount ?? null,
      mapsHandoffAttempted: Boolean(event.mapsHandoffAttempted),
    })
  } catch {
    /* ignore */
  }
}
