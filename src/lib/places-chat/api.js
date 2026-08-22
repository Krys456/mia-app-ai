/**
 * #355B — Thin wrapper: places-chat controller calls requestPlacesQuery
 * from placesApi.ts. Lazy import so Node unit tests can load the controller
 * without Vite TS resolution.
 */

/**
 * @param {{
 *   queryType: 'nearby_category'|'text_search'
 *   category?: string|null
 *   textQuery?: string|null
 *   latitude: number
 *   longitude: number
 *   language?: 'it'|'en'
 *   maxResults?: number
 *   radiusMeters?: number
 * }} payload
 */
export async function requestPlacesQuery(payload) {
  const { requestPlacesQuery: request } = await import('../placesApi.ts')
  return request(payload)
}
