/**
 * #316 — Google Places API (New) provider — server only.
 */

import {
  PLACES_DEFAULT_RADIUS_M,
  PLACES_RESULT_LIMIT,
  getGooglePlacesApiKey,
  resolvePlacesConfig,
} from './config.js'
import { haversineMeters } from './haversine.js'
import { normalizeGooglePlacesList, sortPlacesByDistance } from './normalize.js'

const PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.rating',
  'places.userRatingCount',
  'places.currentOpeningHours.openNow',
  'places.nationalPhoneNumber',
  'places.websiteUri',
].join(',')

/**
 * @param {string} path
 * @param {object} body
 * @param {{ apiKey: string, fetchImpl?: typeof fetch }} opts
 */
async function postPlaces(path, body, opts) {
  const fetchImpl = opts.fetchImpl || fetch
  const url = `https://places.googleapis.com/v1/${path}`
  let res
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': opts.apiKey,
        'X-Goog-FieldMask': PLACES_FIELD_MASK,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return {
      ok: false,
      status: 'provider_error',
      failureCode: 'network_error',
      httpStatus: 0,
      places: [],
    }
  }

  const httpStatus = res.status
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }

  if (httpStatus === 429) {
    return {
      ok: false,
      status: 'provider_error',
      failureCode: 'rate_limited',
      httpStatus,
      places: [],
    }
  }
  if (!res.ok) {
    return {
      ok: false,
      status: 'provider_error',
      failureCode: 'http_error',
      httpStatus,
      places: [],
    }
  }

  const rawPlaces = Array.isArray(json?.places) ? json.places : []
  return { ok: true, httpStatus, rawPlaces, json }
}

/**
 * @param {{
 *   query: string
 *   latitude?: number
 *   longitude?: number
 *   explicitLocationText?: string | null
 *   openNowRequested?: boolean
 *   sort?: 'nearest' | 'relevance'
 *   radiusMeters?: number
 *   env?: NodeJS.ProcessEnv
 *   fetchImpl?: typeof fetch
 * }} input
 */
export async function googlePlacesSearch(input) {
  const env = input.env || process.env
  const cfg = resolvePlacesConfig(env)
  if (!cfg.enabled) {
    return {
      status: 'disabled',
      failureCode: 'places_disabled',
      places: [],
      provider: 'google_places',
      providerRequestReached: false,
      providerHttpStatus: null,
      distancesCalculated: false,
    }
  }
  if (!cfg.configured) {
    return {
      status: 'disabled',
      failureCode: 'missing_api_key',
      places: [],
      provider: 'google_places',
      providerRequestReached: false,
      providerHttpStatus: null,
      distancesCalculated: false,
    }
  }

  const apiKey = getGooglePlacesApiKey(env)
  const query = String(input.query || '').trim().slice(0, 200)
  if (!query) {
    return {
      status: 'invalid_query',
      failureCode: 'empty_query',
      places: [],
      provider: 'google_places',
      providerRequestReached: false,
      providerHttpStatus: null,
      distancesCalculated: false,
    }
  }

  const lat = Number(input.latitude)
  const lng = Number(input.longitude)
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)
  const area = String(input.explicitLocationText || '').trim().slice(0, 200)
  const textQuery = area ? `${query} ${area}`.trim() : query
  const radius = Math.min(
    Math.max(Number(input.radiusMeters) || PLACES_DEFAULT_RADIUS_M, 200),
    50000,
  )

  /** @type {Record<string, unknown>} */
  const body = {
    textQuery,
    maxResultCount: PLACES_RESULT_LIMIT,
    languageCode: 'it',
  }

  if (hasCoords) {
    body.locationBias = {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius,
      },
    }
    if (input.sort === 'nearest') {
      body.rankPreference = 'DISTANCE'
    }
  }

  if (input.openNowRequested === true) {
    body.openNow = true
  }

  const raw = await postPlaces('places:searchText', body, {
    apiKey,
    fetchImpl: input.fetchImpl,
  })

  if (!raw.ok) {
    return {
      status: raw.status || 'provider_error',
      failureCode: raw.failureCode || 'provider_error',
      places: [],
      provider: 'google_places',
      providerRequestReached: true,
      providerHttpStatus: raw.httpStatus ?? null,
      distancesCalculated: false,
    }
  }

  let places = normalizeGooglePlacesList(raw.rawPlaces, {
    originLat: hasCoords ? lat : undefined,
    originLng: hasCoords ? lng : undefined,
    haversine: hasCoords ? haversineMeters : null,
    limit: PLACES_RESULT_LIMIT,
  })

  const distancesCalculated = places.some((p) => typeof p.distanceMeters === 'number')
  if (distancesCalculated && (input.sort === 'nearest' || hasCoords)) {
    places = sortPlacesByDistance(places)
  }

  if (!places.length) {
    return {
      status: 'no_results',
      failureCode: 'no_results',
      places: [],
      provider: 'google_places',
      providerRequestReached: true,
      providerHttpStatus: raw.httpStatus ?? null,
      distancesCalculated: false,
    }
  }

  return {
    status: 'ok',
    failureCode: null,
    places,
    provider: 'google_places',
    providerRequestReached: true,
    providerHttpStatus: raw.httpStatus ?? null,
    distancesCalculated,
  }
}

export const googlePlacesProvider = {
  id: 'google_places',
  searchNearby: (input) =>
    googlePlacesSearch({
      ...input,
      sort: input.sort || 'nearest',
    }),
  searchText: (input) =>
    googlePlacesSearch({
      ...input,
      sort: input.sort || 'relevance',
    }),
  async getDetails() {
    return { status: 'disabled', failureCode: 'details_deferred', place: null }
  },
}
