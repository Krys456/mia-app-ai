/**
 * #355B — Places chat public exports (read-only, Italian-first, 0 model calls).
 */

export {
  detectPlacesIntent,
  detectPlacesFollowUp,
  isDeicticDestination,
  PLACES_USE_LOCATION_TRIGGER,
} from './intent.js'
export { foldPlacesText } from './normalize.js'
export { haversineMeters } from './haversine.js'
export {
  PLACES_CONTEXT_KEY,
  PLACES_CONTEXT_TTL_MS,
  PLACES_PENDING_KEY,
  createPlacesContext,
  isPlacesContextFresh,
  loadPlacesContext,
  savePlacesContext,
  clearPlacesContext,
  focusIndexInContext,
  getFocusedPlace,
  savePendingPlacesRequest,
  loadPendingPlacesRequest,
  clearPendingPlacesRequest,
} from './active-context.js'
export { applyPlacesIntent } from './controller.js'
export { requestPlacesQuery } from './api.js'
export {
  failureReply,
  placesCopy,
  geoFailureCopy,
  formatDistanceMeters,
  renderPlacesList,
  renderNearest,
  renderFollowUp,
} from './render.js'
