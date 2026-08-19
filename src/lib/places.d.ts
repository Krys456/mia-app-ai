export {
  detectPlacesIntent,
  detectPlacesFollowUp,
  detectPlacesLanguage,
  isDeicticDestination,
  PLACES_USE_LOCATION_TRIGGER,
  PLACES_ENTER_AREA_TRIGGER,
} from './places/intent.js'

export { haversineMeters, formatDistanceMeters } from './places/haversine.js'

export {
  createPlacesContext,
  loadPlacesContext,
  savePlacesContext,
  clearPlacesContext,
  loadPendingPlacesRequest,
  savePendingPlacesRequest,
  clearPendingPlacesRequest,
  isPlacesContextFresh,
  selectPlaceInContext,
  selectNearestInContext,
  getSelectedPlace,
  PLACES_CONTEXT_TTL_MS,
} from './places/active-context.js'

export {
  applyPlacesFollowUp,
  buildPlacesSuccessExchange,
  geoFailureCopy,
} from './places/controller.js'

export { placesCopy, formatPlacesResultsReply, buildPlacesGroundingBlock } from './places/copy.js'
export { getBrowserPosition, GEO_OPTIONS } from './places/geolocation.js'

export {
  PLACES_DIAG_BUILD,
  isPlacesDiagEnabled,
  buildPlacesDiag,
  rememberPlacesDiag,
  logPlacesSafe,
} from './places/diag.js'

export function requestPlacesSearch(body: {
  query: string
  operation: 'nearby' | 'text_search'
  latitude?: number
  longitude?: number
  explicitLocationText?: string | null
  openNowRequested?: boolean
  sort?: 'nearest' | 'relevance'
  language?: 'it' | 'en'
}): Promise<{
  status: string
  failureCode?: string | null
  places: Array<Record<string, unknown>>
  provider?: string
  providerRequestReached?: boolean
  providerHttpStatus?: number | null
  distancesCalculated?: boolean
  requestId?: string | null
}>
