/** #316 — Places / Nearby barrel. */
export {
  detectPlacesIntent,
  detectPlacesFollowUp,
  detectPlacesLanguage,
  isDeicticDestination,
  looksQuotedOrInjectedPlaces,
  PLACES_USE_LOCATION_TRIGGER,
  PLACES_ENTER_AREA_TRIGGER,
  extractExplicitLocationText,
  extractPlacesQuery,
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
export { requestPlacesSearch } from './places/placesApi.js'
