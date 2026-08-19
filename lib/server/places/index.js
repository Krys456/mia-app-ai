/**
 * #316 — Places provider facade (vendor-agnostic entry).
 */

import { googlePlacesProvider } from './google-places-provider.js'
import { resolvePlacesConfig } from './config.js'

/**
 * @param {{
 *   operation: 'nearby' | 'text_search'
 *   query: string
 *   latitude?: number
 *   longitude?: number
 *   explicitLocationText?: string | null
 *   openNowRequested?: boolean
 *   sort?: 'nearest' | 'relevance'
 *   env?: NodeJS.ProcessEnv
 *   fetchImpl?: typeof fetch
 *   provider?: { searchNearby: Function, searchText: Function }
 * }} input
 */
export async function runPlacesSearch(input) {
  const env = input.env || process.env
  const cfg = resolvePlacesConfig(env)
  if (!cfg.enabled || !cfg.configured) {
    return {
      status: 'disabled',
      failureCode: cfg.enabled ? 'missing_api_key' : 'places_disabled',
      places: [],
      provider: 'google_places',
      providerRequestReached: false,
      providerHttpStatus: null,
      distancesCalculated: false,
    }
  }

  const provider = input.provider || googlePlacesProvider
  if (input.operation === 'nearby') {
    return provider.searchNearby(input)
  }
  return provider.searchText(input)
}

export { resolvePlacesConfig, isPlacesEnabled, PLACES_RESULT_LIMIT } from './config.js'
export { normalizeGooglePlace, normalizeGooglePlacesList, sortPlacesByDistance, buildMapsDestination } from './normalize.js'
export { haversineMeters } from './haversine.js'
