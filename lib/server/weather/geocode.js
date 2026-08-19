/**
 * #317 — Open-Meteo Geocoding API.
 * No API key. Server constructs URL only.
 */

import { OPEN_METEO_GEOCODE_BASE } from './config.js'
import { normalizeGeocodeResult } from './normalize.js'

/**
 * Choose a single geocode result when confidence is strong; else ambiguous.
 * @param {Array<ReturnType<typeof normalizeGeocodeResult>>} results
 */
export function pickGeocodeResult(results) {
  const list = (results || []).filter(Boolean)
  if (!list.length) return { status: 'geocode_empty', result: null, candidates: [] }
  if (list.length === 1) return { status: 'ok', result: list[0], candidates: list }

  // Strong confidence: top result has much higher population, or same name+country dominates
  const [a, b] = list
  const popA = typeof a.population === 'number' ? a.population : 0
  const popB = typeof b.population === 'number' ? b.population : 0
  if (popA > 0 && popA >= popB * 3) {
    return { status: 'ok', result: a, candidates: list.slice(0, 5) }
  }
  // Exact same primary name and first is clearly primary city (admin1 present, high pop)
  if (popA >= 100000 && popA > popB) {
    return { status: 'ok', result: a, candidates: list.slice(0, 5) }
  }

  return {
    status: 'geocode_ambiguous',
    result: null,
    candidates: list.slice(0, 5),
  }
}

/**
 * @param {string} locationText
 * @param {{ fetchImpl?: typeof fetch, language?: string }} [opts]
 */
export async function geocodeLocation(locationText, opts = {}) {
  const q = String(locationText || '').trim().slice(0, 120)
  if (!q) {
    return {
      status: 'invalid_request',
      failureCode: 'empty_location',
      geocodeReached: false,
      result: null,
      candidates: [],
    }
  }

  const url = new URL(OPEN_METEO_GEOCODE_BASE)
  url.searchParams.set('name', q)
  url.searchParams.set('count', '5')
  url.searchParams.set('language', opts.language === 'en' ? 'en' : 'it')
  url.searchParams.set('format', 'json')

  const fetchImpl = opts.fetchImpl || fetch
  let res
  try {
    res = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
  } catch {
    return {
      status: 'provider_error',
      failureCode: 'geocode_network',
      geocodeReached: true,
      result: null,
      candidates: [],
    }
  }

  if (!res.ok) {
    return {
      status: 'provider_error',
      failureCode: 'geocode_http',
      geocodeReached: true,
      providerHttpStatus: res.status,
      result: null,
      candidates: [],
    }
  }

  let json
  try {
    json = await res.json()
  } catch {
    return {
      status: 'provider_error',
      failureCode: 'geocode_malformed',
      geocodeReached: true,
      providerHttpStatus: res.status,
      result: null,
      candidates: [],
    }
  }

  const results = Array.isArray(json?.results)
    ? json.results.map(normalizeGeocodeResult).filter(Boolean)
    : []
  const picked = pickGeocodeResult(results)
  return {
    status: picked.status,
    failureCode: picked.status === 'ok' ? null : picked.status,
    geocodeReached: true,
    providerHttpStatus: res.status,
    result: picked.result,
    candidates: picked.candidates,
  }
}
