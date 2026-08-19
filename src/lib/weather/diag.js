/**
 * #317 — Safe weather diagnostics (?weather_diag=1).
 * Never log precise GPS coords or raw provider payloads.
 */

export const WEATHER_DIAG_BUILD = '317-1'

export function isWeatherDiagEnabled(search) {
  try {
    const q =
      search != null
        ? String(search)
        : typeof window !== 'undefined'
          ? window.location.search
          : ''
    if (!q) return false
    const params = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q)
    const v = params.get('weather_diag')
    return v === '1' || v === 'true'
  } catch {
    return false
  }
}

export function buildWeatherDiag(partial = {}) {
  let buildId = WEATHER_DIAG_BUILD
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BUILD_ID) {
      buildId = import.meta.env.VITE_BUILD_ID
    }
  } catch {
    /* ignore */
  }
  return {
    route: 'weather-action',
    diagBuild: WEATHER_DIAG_BUILD,
    buildId,
    requestId: partial.requestId || `weather_${Date.now().toString(36)}`,
    weatherIntent: partial.weatherIntent ?? 'weather',
    operation: partial.operation ?? null,
    timeHint: partial.timeHint ?? null,
    locationSource: partial.locationSource ?? null,
    geocodeReached: Boolean(partial.geocodeReached),
    provider: partial.provider || 'open_meteo',
    providerRequestReached: Boolean(partial.providerRequestReached),
    providerHttpStatus:
      typeof partial.providerHttpStatus === 'number' ? partial.providerHttpStatus : null,
    hourlyDataPresent: Boolean(partial.hourlyDataPresent),
    dailyDataPresent: Boolean(partial.dailyDataPresent),
    forecastDays: typeof partial.forecastDays === 'number' ? partial.forecastDays : null,
    cacheHit: Boolean(partial.cacheHit),
    activeWeatherContextCreated: Boolean(partial.activeWeatherContextCreated),
    failureCode: partial.failureCode ?? null,
  }
}

export function rememberWeatherDiag(diag) {
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.setItem('shinkaido.weatherDiag.last', JSON.stringify(diag))
  } catch {
    /* ignore */
  }
}

export function logWeatherSafe(fields = {}) {
  try {
    console.info(
      '[weather-action]',
      JSON.stringify({
        route: 'weather-action',
        operation: fields.operation ?? null,
        locationSource: fields.locationSource ?? null,
        status: fields.status ?? null,
        failureCode: fields.failureCode ?? null,
        cacheHit: Boolean(fields.cacheHit),
      }),
    )
  } catch {
    /* ignore */
  }
}
