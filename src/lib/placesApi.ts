/**
 * #355B — Client helper for read-only Places search.
 *
 * Calls the Supabase Edge Function `places-query` (see
 * supabase/functions/places-query/index.ts) with the anonymous ShinkAIdo
 * JWT (same pattern as emailApi.ts / calendarApi.ts). The Google Places
 * provider key lives only server-side (see the Edge Function's own env
 * docs) — this module NEVER stores or forwards a provider API key from
 * the client.
 *
 * `category` must be one of the Italian words the Edge Function's
 * CATEGORY_TYPE_MAP understands (e.g. "farmacia", "supermercato") — the
 * server maps it to a Google Places type; this client never guesses a type.
 *
 * openNow is DEFERRED in this version: this client never requests or
 * surfaces an "open now" filter/field from the provider. Callers must not
 * claim verified opening hours.
 */

import { resolveChatAuthForRequest } from './chatAuth.ts'
import { isSupabaseConfigured } from './supabase.ts'

export type PlacesQueryType = 'nearby_category' | 'nearest' | 'named_place'

export type PlacesQueryPayload = {
  queryType: PlacesQueryType
  category?: string | null
  textQuery?: string | null
  latitude: number
  longitude: number
  language?: 'it' | 'en'
  maxResults?: number
  radiusMeters?: number
}

export type PlacePublic = {
  id: string
  name: string
  category?: string | null
  address?: string | null
  latitude: number
  longitude: number
  distanceMeters?: number | null
  provider?: string | null
}

export type PlacesQueryStatus =
  | 'ok'
  | 'empty'
  | 'no_match'
  | 'provider_disabled'
  | 'provider_error'
  | 'timeout'
  | 'error'
  | 'invalid_query'
  | 'auth_required'

export type PlacesQueryResult = {
  ok: boolean
  status: PlacesQueryStatus
  places: PlacePublic[]
  fetchedAt: string
  queryType: PlacesQueryType | null
  code?: string
}

function supabaseFunctionsBase(): string | null {
  const url = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
  const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()
  if (!url || !anon) return null
  return url
}

function anonKey(): string {
  return (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()
}

async function edgeHeaders(): Promise<HeadersInit | null> {
  if (!isSupabaseConfigured()) return null
  const { authorization } = await resolveChatAuthForRequest()
  if (!authorization) return null
  return {
    Authorization: authorization,
    apikey: anonKey(),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

function sanitizePlace(raw: unknown): PlacePublic | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const id = typeof p.id === 'string' ? p.id : null
  const name = typeof p.name === 'string' ? p.name.trim() : ''
  const latitude = typeof p.latitude === 'number' ? p.latitude : null
  const longitude = typeof p.longitude === 'number' ? p.longitude : null
  if (!id || !name || latitude === null || longitude === null) return null
  return {
    id,
    name: name.slice(0, 160),
    category: typeof p.category === 'string' ? p.category.slice(0, 60) : null,
    address: typeof p.address === 'string' ? p.address.slice(0, 240) : null,
    latitude,
    longitude,
    distanceMeters: typeof p.distanceMeters === 'number' ? p.distanceMeters : null,
    provider: typeof p.provider === 'string' ? p.provider.slice(0, 40) : null,
  }
}

/**
 * Map HTTP / body status to a safe client PlacesQueryResult.
 * Never invents places — empty on any non-ok/non-empty status.
 */
export function mapPlacesQueryResponse(
  res: { status: number; ok?: boolean },
  body: Record<string, unknown>,
  payload: PlacesQueryPayload,
): PlacesQueryResult {
  const fetchedAt = new Date().toISOString()
  const queryType = payload.queryType

  // The Edge Function always answers with a `status` body, including its
  // 404 provider_disabled and 400 invalid_coordinates/invalid_query_type
  // responses — prefer that over guessing from the HTTP status alone.
  if (typeof body.status === 'string') {
    const status = body.status as PlacesQueryStatus
    const places = Array.isArray(body.places)
      ? (body.places.map(sanitizePlace).filter(Boolean) as PlacePublic[])
      : []
    return {
      ok: status === 'ok' || status === 'empty',
      status,
      places,
      fetchedAt: typeof body.fetchedAt === 'string' ? body.fetchedAt : fetchedAt,
      queryType: typeof body.queryType === 'string' ? (body.queryType as PlacesQueryType) : queryType,
      code: typeof body.code === 'string' ? body.code : undefined,
    }
  }

  const code = typeof body.code === 'string' ? body.code : ''

  if (res.status === 404 || code === 'places_disabled') {
    return {
      ok: false,
      status: 'provider_disabled',
      places: [],
      fetchedAt,
      queryType,
      code: code || 'places_disabled',
    }
  }
  if (
    res.status === 401 ||
    res.status === 403 ||
    code === 'unauthorized' ||
    code === 'auth_required' ||
    code === 'auth_unavailable'
  ) {
    return {
      ok: false,
      status: 'auth_required',
      places: [],
      fetchedAt,
      queryType,
      code: code || 'auth_required',
    }
  }
  if (res.status === 400) {
    return {
      ok: false,
      status: 'invalid_query',
      places: [],
      fetchedAt,
      queryType,
      code: code || 'invalid_query',
    }
  }

  return {
    ok: false,
    status: 'error',
    places: [],
    fetchedAt,
    queryType,
    code: code || (res.ok ? 'invalid_pack' : 'http_error'),
  }
}

/**
 * Structured, read-only Places query. Coordinates are sent transiently for
 * this single request only — never persisted client-side alongside results.
 */
export async function requestPlacesQuery(payload: PlacesQueryPayload): Promise<PlacesQueryResult> {
  const fetchedAt = new Date().toISOString()
  const base = supabaseFunctionsBase()
  const headers = await edgeHeaders()
  if (!base || !headers) {
    return {
      ok: false,
      status: 'auth_required',
      places: [],
      fetchedAt,
      queryType: payload.queryType,
      code: 'auth_unavailable',
    }
  }

  if (
    typeof payload.latitude !== 'number' ||
    typeof payload.longitude !== 'number' ||
    !Number.isFinite(payload.latitude) ||
    !Number.isFinite(payload.longitude)
  ) {
    return {
      ok: false,
      status: 'invalid_query',
      places: [],
      fetchedAt,
      queryType: payload.queryType,
      code: 'missing_coordinates',
    }
  }

  let res: Response
  try {
    res = await fetch(`${base}/functions/v1/places-query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'places_query',
        queryType: payload.queryType,
        category: payload.category || undefined,
        textQuery: payload.textQuery || undefined,
        latitude: payload.latitude,
        longitude: payload.longitude,
        language: payload.language || 'it',
        maxResults: payload.maxResults || 5,
        radiusMeters: payload.radiusMeters || 3000,
      }),
    })
  } catch {
    return {
      ok: false,
      status: 'error',
      places: [],
      fetchedAt,
      queryType: payload.queryType,
      code: 'network',
    }
  }

  let body: Record<string, unknown> = {}
  try {
    body = await res.json()
  } catch {
    body = {}
  }

  return mapPlacesQueryResponse(res, body, payload)
}
