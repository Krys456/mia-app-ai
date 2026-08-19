/**
 * #317 — Weather service orchestration (geocode → forecast → normalize).
 */

import { geocodeLocation } from './geocode.js'
import { fetchOpenMeteoForecast } from './open-meteo.js'
import { WEATHER_ATTRIBUTION } from './config.js'

/**
 * Reverse-ish label for GPS: use timezone name or "La tua posizione".
 * Open-Meteo forecast with timezone=auto returns timezone; we label generically.
 */
function gpsLocationLabel(lang) {
  return lang === 'en' ? 'Your location' : 'La tua posizione'
}

/**
 * @param {{
 *   locationText?: string | null
 *   latitude?: number | null
 *   longitude?: number | null
 *   timezone?: string | null
 *   language?: 'it'|'en'
 *   forecastDays?: number
 *   fetchImpl?: typeof fetch
 * }} input
 */
export async function runWeatherLookup(input) {
  const lang = input.language === 'en' ? 'en' : 'it'
  const fetchImpl = input.fetchImpl

  let location = null
  let geocodeReached = false
  let geocodeCandidates = null
  let locationSource = null

  if (typeof input.latitude === 'number' && typeof input.longitude === 'number') {
    location = {
      name: gpsLocationLabel(lang),
      country: null,
      admin1: null,
      latitude: input.latitude,
      longitude: input.longitude,
      timezone: input.timezone || 'auto',
    }
    locationSource = 'gps'
  } else if (input.locationText) {
    const geo = await geocodeLocation(input.locationText, { fetchImpl, language: lang })
    geocodeReached = Boolean(geo.geocodeReached)
    if (geo.status !== 'ok' || !geo.result) {
      return {
        status: geo.status,
        failureCode: geo.failureCode || geo.status,
        geocodeReached,
        provider: 'open_meteo',
        providerRequestReached: false,
        providerHttpStatus: geo.providerHttpStatus ?? null,
        geocodeCandidates: geo.candidates || [],
        attribution: WEATHER_ATTRIBUTION,
      }
    }
    location = geo.result
    geocodeCandidates = geo.candidates
    locationSource = 'explicit'
  } else {
    return {
      status: 'location_required',
      failureCode: 'location_required',
      geocodeReached: false,
      provider: 'open_meteo',
      providerRequestReached: false,
      attribution: WEATHER_ATTRIBUTION,
    }
  }

  const forecast = await fetchOpenMeteoForecast({
    latitude: location.latitude,
    longitude: location.longitude,
    timezone: location.timezone || 'auto',
    name: location.name,
    country: location.country,
    admin1: location.admin1,
    language: lang,
    forecastDays: input.forecastDays || 7,
    fetchImpl,
  })

  return {
    ...forecast,
    geocodeReached,
    geocodeCandidates,
    locationSource,
  }
}

export { WEATHER_ATTRIBUTION }
export { normalizeOpenMeteoForecast, normalizeGeocodeResult } from './normalize.js'
export { describeWmoCode, WMO_CODE_MAP } from './wmo.js'
export { pickGeocodeResult, geocodeLocation } from './geocode.js'
export { fetchOpenMeteoForecast } from './open-meteo.js'
