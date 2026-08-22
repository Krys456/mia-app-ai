/**
 * #355B — places-query (POST only)
 *
 * Body: { action: 'places_query', queryType: 'nearby_category'|'nearest'|'named_place',
 *          category?, textQuery?, latitude, longitude, language?, maxResults?, radiusMeters? }
 *
 * Ownership: verified ShinkAIdo JWT → auth.uid() (no DB table; this route is
 * stateless — JWT is required only to gate usage, never to look up rows).
 * PLACES_ENABLED gate → 404 places_disabled when off.
 * DECISION: openNow is DEFERRED (see _shared/places-google.ts) — never
 * requested and never returned here.
 * Never logs lat/lon/latitude/longitude/address/name/query/destination/coords.
 */

import { corsHeaders, env, extractBearer, isPlacesEnabled, json, logSafe, verifyUserJwt } from '../_shared/places-edge.ts'
import {
  buildNearbyRequest,
  buildTextSearchRequest,
  callGooglePlaces,
  getPlacesApiKeyEnvName,
  mapCategoryToType,
  normalizePlacesList,
  type NormalizedPlace,
} from '../_shared/places-google.ts'

type QueryType = 'nearby_category' | 'nearest' | 'named_place'

type QueryStatus =
  | 'ok'
  | 'empty'
  | 'no_match'
  | 'provider_disabled'
  | 'provider_error'
  | 'timeout'
  | 'error'

type ResponseBody = {
  ok: boolean
  status: QueryStatus
  places: NormalizedPlace[]
  fetchedAt: string
  queryType: QueryType | null
  runId: string
  error?: string
  code?: string
}

function respond(status: number, cors: Record<string, string>, body: ResponseBody) {
  return json(status, body, cors)
}

async function searchByType(opts: {
  includedType: string
  latitude: number
  longitude: number
  radiusMeters?: number
  maxResults?: number
  language: 'it' | 'en'
  apiKey: string
}): Promise<{ ok: true; places: NormalizedPlace[] } | { ok: false; status: 'provider_error' | 'timeout' }> {
  const req = buildNearbyRequest({
    latitude: opts.latitude,
    longitude: opts.longitude,
    includedType: opts.includedType,
    radiusMeters: opts.radiusMeters,
    maxResultCount: opts.maxResults,
    languageCode: opts.language,
  })
  const res = await callGooglePlaces(req.path, req.body, opts.apiKey)
  if (!res.ok) return { ok: false, status: res.status }
  return { ok: true, places: normalizePlacesList(res.rawPlaces, opts.latitude, opts.longitude, opts.maxResults) }
}

async function searchByText(opts: {
  textQuery: string
  latitude: number
  longitude: number
  radiusMeters?: number
  maxResults?: number
  language: 'it' | 'en'
  apiKey: string
}): Promise<{ ok: true; places: NormalizedPlace[] } | { ok: false; status: 'provider_error' | 'timeout' }> {
  const req = buildTextSearchRequest({
    textQuery: opts.textQuery,
    latitude: opts.latitude,
    longitude: opts.longitude,
    radiusMeters: opts.radiusMeters,
    maxResultCount: opts.maxResults,
    languageCode: opts.language,
  })
  const res = await callGooglePlaces(req.path, req.body, opts.apiKey)
  if (!res.ok) return { ok: false, status: res.status }
  return { ok: true, places: normalizePlacesList(res.rawPlaces, opts.latitude, opts.longitude, opts.maxResults) }
}

function sortByDistanceAscending(places: NormalizedPlace[]): NormalizedPlace[] {
  const arr = [...places]
  if (!arr.every((p) => typeof p.distanceMeters === 'number')) return arr
  return arr.sort((a, b) => (a.distanceMeters as number) - (b.distanceMeters as number))
}

Deno.serve(async (req) => {
  const started = Date.now()
  const runId = crypto.randomUUID()
  const cors = corsHeaders(req)
  const fetchedAt = new Date().toISOString()

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed', runId }, cors)
  }

  if (!isPlacesEnabled()) {
    logSafe('places-query', { runId, status: 'provider_disabled', durationMs: Date.now() - started })
    return respond(404, cors, {
      ok: false,
      status: 'provider_disabled',
      places: [],
      fetchedAt,
      queryType: null,
      runId,
      error: 'Places unavailable',
      code: 'places_disabled',
    })
  }

  let body: Record<string, unknown> = {}
  try {
    const text = await req.text()
    if (text) body = JSON.parse(text)
  } catch {
    return json(400, { error: 'invalid_json', runId }, cors)
  }

  if (body.user_id || body.userId) {
    return json(400, { error: 'user_id_not_accepted', code: 'user_id_spoof_rejected', runId }, cors)
  }
  if (body.apiKey || body.api_key || body.tokens || body.token || body.access_token || body.refresh_token) {
    return json(400, { error: 'forbidden_fields', code: 'secret_relay_forbidden', runId }, cors)
  }

  const action = typeof body.action === 'string' ? body.action.trim() : ''
  if (action !== 'places_query') {
    return json(400, { error: 'unknown_action', code: 'unknown_action', runId }, cors)
  }

  const queryTypeRaw = typeof body.queryType === 'string' ? body.queryType.trim() : ''
  if (queryTypeRaw !== 'nearby_category' && queryTypeRaw !== 'nearest' && queryTypeRaw !== 'named_place') {
    return respond(400, cors, {
      ok: false,
      status: 'error',
      places: [],
      fetchedAt,
      queryType: null,
      runId,
      error: 'invalid_query_type',
      code: 'invalid_query_type',
    })
  }
  const queryType = queryTypeRaw as QueryType

  const accessToken = extractBearer(req)
  if (!accessToken) {
    return json(401, { error: 'unauthorized', code: 'missing_bearer', runId }, cors)
  }
  const verified = await verifyUserJwt(accessToken)
  if (!verified.ok) {
    return json(401, { error: 'unauthorized', code: verified.code, runId }, cors)
  }

  const latitude = Number(body.latitude)
  const longitude = Number(body.longitude)
  const validLat = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
  const validLon = Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
  if (!validLat || !validLon) {
    logSafe('places-query', { runId, status: 'error', code: 'invalid_coordinates', queryType, durationMs: Date.now() - started })
    return respond(400, cors, {
      ok: false,
      status: 'error',
      places: [],
      fetchedAt,
      queryType,
      runId,
      error: 'invalid_coordinates',
      code: 'invalid_coordinates',
    })
  }

  const language = body.language === 'en' ? 'en' : 'it'
  const category = typeof body.category === 'string' ? body.category.trim() : ''
  const textQuery = typeof body.textQuery === 'string' ? body.textQuery.trim().slice(0, 200) : ''
  const maxResults = typeof body.maxResults === 'number' ? body.maxResults : undefined
  const radiusMeters = typeof body.radiusMeters === 'number' ? body.radiusMeters : undefined

  const apiKey = env(getPlacesApiKeyEnvName())
  if (!apiKey) {
    logSafe('places-query', { runId, status: 'error', code: 'places_misconfigured', durationMs: Date.now() - started })
    return respond(500, cors, {
      ok: false,
      status: 'error',
      places: [],
      fetchedAt,
      queryType,
      runId,
      error: 'misconfigured',
      code: 'places_misconfigured',
    })
  }

  try {
    let result: { ok: true; places: NormalizedPlace[] } | { ok: false; status: 'provider_error' | 'timeout' } | { ok: true; status: 'no_match'; places: [] }

    if (queryType === 'named_place') {
      if (!textQuery) {
        return respond(400, cors, {
          ok: false,
          status: 'error',
          places: [],
          fetchedAt,
          queryType,
          runId,
          error: 'text_query_required',
          code: 'text_query_required',
        })
      }
      result = await searchByText({ textQuery, latitude, longitude, radiusMeters, maxResults, language, apiKey })
    } else {
      const includedType = mapCategoryToType(category)
      if (includedType) {
        result = await searchByType({ includedType, latitude, longitude, radiusMeters, maxResults, language, apiKey })
      } else if (textQuery) {
        result = await searchByText({ textQuery, latitude, longitude, radiusMeters, maxResults, language, apiKey })
      } else {
        result = { ok: true, status: 'no_match', places: [] }
      }
    }

    if ('status' in result && result.status === 'no_match') {
      logSafe('places-query', { runId, status: 'no_match', queryType, durationMs: Date.now() - started })
      return respond(200, cors, { ok: true, status: 'no_match', places: [], fetchedAt, queryType, runId })
    }

    if (!result.ok) {
      logSafe('places-query', { runId, status: result.status, queryType, durationMs: Date.now() - started })
      return respond(200, cors, { ok: false, status: result.status, places: [], fetchedAt, queryType, runId })
    }

    const places = queryType === 'nearest' ? sortByDistanceAscending(result.places) : result.places
    const status: QueryStatus = places.length > 0 ? 'ok' : 'empty'

    logSafe('places-query', { runId, status, count: places.length, queryType, durationMs: Date.now() - started })
    return respond(200, cors, { ok: true, status, places, fetchedAt, queryType, runId })
  } catch {
    logSafe('places-query', { runId, status: 'error', code: 'places_query_failed', durationMs: Date.now() - started })
    return respond(500, cors, {
      ok: false,
      status: 'error',
      places: [],
      fetchedAt,
      queryType,
      runId,
      error: 'places_query_failed',
      code: 'places_query_failed',
    })
  }
})
