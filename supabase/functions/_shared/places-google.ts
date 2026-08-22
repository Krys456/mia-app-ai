/**
 * #355B — Google Places API (New) provider — Edge only.
 *
 * DECISION: openNow is DEFERRED. `currentOpeningHours` is intentionally NOT
 * requested in the FieldMask below — Nearby Search / Text Search (New) bills
 * openNow / currentOpeningHours as part of the Pro SKU's optional "Place
 * Details" style fields, and every additional field on the New APIs widens
 * the SKU surface. Staying on the minimal 5-field mask below keeps every
 * call inside the Pro Nearby/Text Search SKU with no extra field cost.
 * Revisit only with an explicit product decision + budget sign-off.
 *
 * FieldMask (Pro Nearby/Text Search SKU — do not add fields casually):
 *   places.id,places.displayName,places.primaryType,places.formattedAddress,places.location
 *
 * Never log names / addresses / coordinates from this module — callers are
 * responsible for redacted logging (see places-edge.ts logSafe).
 */

export const PLACES_FIELD_MASK =
  'places.id,places.displayName,places.primaryType,places.formattedAddress,places.location'

const PLACES_API_BASE = 'https://places.googleapis.com/v1/'
const DEFAULT_TIMEOUT_MS = 9000

export const DEFAULT_RADIUS_M = 2000
export const MAX_RADIUS_M = 5000
export const DEFAULT_MAX_RESULT_COUNT = 5
export const MAX_MAX_RESULT_COUNT = 5

/**
 * Runtime API key env name. SHINKAIDO_PLACES_API_KEY is the ONLY accepted
 * runtime key name for this feature — no legacy fallback is read.
 */
export function getPlacesApiKeyEnvName(): 'SHINKAIDO_PLACES_API_KEY' {
  return 'SHINKAIDO_PLACES_API_KEY'
}

/**
 * Italian category → Google Places (New) Table A type, restricted to types
 * that are safe/unambiguous 1:1 matches. Cuisine-specific phrases (e.g.
 * "ristoranti giapponesi") are NOT in this map on purpose — those must be
 * resolved via Text Search (searchText) with a free-text query, never by
 * guessing a `type`.
 */
export const CATEGORY_TYPE_MAP: Record<string, string> = {
  farmacia: 'pharmacy',
  supermercato: 'supermarket',
  bar: 'bar',
  ristorante: 'restaurant',
  benzinaio: 'gas_station',
  palestra: 'gym',
  caffe: 'cafe',
  caffè: 'cafe',
  banca: 'bank',
  ospedale: 'hospital',
  hotel: 'lodging',
}

export function mapCategoryToType(category: string | null | undefined): string | null {
  const key = String(category || '').trim().toLowerCase()
  if (!key) return null
  return CATEGORY_TYPE_MAP[key] || null
}

const EARTH_RADIUS_M = 6371000

/** Great-circle distance in meters. Returns null for non-finite / out-of-range inputs. */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number | null {
  const a = Number(lat1)
  const b = Number(lon1)
  const c = Number(lat2)
  const d = Number(lon2)
  if (![a, b, c, d].every((n) => Number.isFinite(n))) return null
  if (a < -90 || a > 90 || c < -90 || c > 90) return null
  if (b < -180 || b > 180 || d < -180 || d > 180) return null

  const toRad = (deg: number) => (deg * Math.PI) / 180
  const phi1 = toRad(a)
  const phi2 = toRad(c)
  const deltaPhi = toRad(c - a)
  const deltaLambda = toRad(d - b)
  const sinDeltaPhi = Math.sin(deltaPhi / 2)
  const sinDeltaLambda = Math.sin(deltaLambda / 2)
  const h = sinDeltaPhi * sinDeltaPhi + Math.cos(phi1) * Math.cos(phi2) * sinDeltaLambda * sinDeltaLambda
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))))
}

function clampRadiusMeters(radiusMeters: unknown): number {
  const n = Number(radiusMeters)
  const base = Number.isFinite(n) && n > 0 ? n : DEFAULT_RADIUS_M
  return Math.min(Math.max(base, 1), MAX_RADIUS_M)
}

function clampMaxResultCount(maxResultCount: unknown): number {
  const n = Number(maxResultCount)
  const base = Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_RESULT_COUNT
  return Math.min(Math.max(base, 1), MAX_MAX_RESULT_COUNT)
}

function resolveLanguageCode(languageCode: unknown): 'it' | 'en' {
  return languageCode === 'en' ? 'en' : 'it'
}

export type NearbyRequestInput = {
  latitude: number
  longitude: number
  includedType?: string
  radiusMeters?: number
  maxResultCount?: number
  languageCode?: 'it' | 'en'
}

export type PlacesRequest = { path: string; body: Record<string, unknown> }

/** Build a Nearby Search (New) request body — Pro SKU, no openNow/photos/reviews fields. */
export function buildNearbyRequest(input: NearbyRequestInput): PlacesRequest {
  const radius = clampRadiusMeters(input.radiusMeters)
  const maxResultCount = clampMaxResultCount(input.maxResultCount)
  const body: Record<string, unknown> = {
    maxResultCount,
    languageCode: resolveLanguageCode(input.languageCode),
    locationRestriction: {
      circle: {
        center: { latitude: input.latitude, longitude: input.longitude },
        radius,
      },
    },
  }
  if (input.includedType) {
    body.includedTypes = [input.includedType]
  }
  return { path: 'places:searchNearby', body }
}

export type TextSearchRequestInput = {
  textQuery: string
  latitude?: number
  longitude?: number
  radiusMeters?: number
  maxResultCount?: number
  languageCode?: 'it' | 'en'
}

/** Build a Text Search (New) request body — Pro SKU, no openNow/photos/reviews fields. */
export function buildTextSearchRequest(input: TextSearchRequestInput): PlacesRequest {
  const maxResultCount = clampMaxResultCount(input.maxResultCount)
  const body: Record<string, unknown> = {
    textQuery: String(input.textQuery || '').trim().slice(0, 200),
    maxResultCount,
    languageCode: resolveLanguageCode(input.languageCode),
  }
  const hasCoords = Number.isFinite(Number(input.latitude)) && Number.isFinite(Number(input.longitude))
  if (hasCoords) {
    body.locationBias = {
      circle: {
        center: { latitude: input.latitude, longitude: input.longitude },
        radius: clampRadiusMeters(input.radiusMeters),
      },
    }
  }
  return { path: 'places:searchText', body }
}

export type GooglePlacesCallResult =
  | { ok: true; httpStatus: number; rawPlaces: unknown[] }
  | { ok: false; status: 'provider_error' | 'timeout'; httpStatus: number | null }

/**
 * POST https://places.googleapis.com/v1/{path} with the Pro-safe FieldMask.
 * Never logs the request/response body (may contain names/addresses/coords).
 */
export async function callGooglePlaces(
  path: string,
  body: Record<string, unknown>,
  apiKey: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<GooglePlacesCallResult> {
  const fetchImpl = opts.fetchImpl || fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetchImpl(`${PLACES_API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACES_FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, status: 'timeout', httpStatus: null }
    }
    return { ok: false, status: 'provider_error', httpStatus: null }
  }
  clearTimeout(timer)

  const httpStatus = res.status
  if (!res.ok) {
    return { ok: false, status: 'provider_error', httpStatus }
  }

  let parsed: unknown = null
  try {
    parsed = await res.json()
  } catch {
    parsed = null
  }
  const rawPlaces =
    parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).places)
      ? ((parsed as Record<string, unknown>).places as unknown[])
      : []
  return { ok: true, httpStatus, rawPlaces }
}

export type NormalizedPlace = {
  id: string
  name: string
  category?: string
  address?: string
  latitude: number
  longitude: number
  distanceMeters?: number
  provider: 'google_places'
}

/**
 * Normalize one Google Places API (New) place resource into the internal
 * shape. Deliberately has NO openNow field (deferred — see module header).
 */
export function normalizePlace(
  raw: unknown,
  originLat?: number,
  originLon?: number,
): NormalizedPlace | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const id = String(r.id || '').replace(/^places\//, '').trim()
  const displayName = r.displayName && typeof r.displayName === 'object' ? (r.displayName as Record<string, unknown>) : null
  const name =
    (displayName && typeof displayName.text === 'string' ? displayName.text : '') ||
    (typeof r.displayName === 'string' ? r.displayName : '')

  const location = r.location && typeof r.location === 'object' ? (r.location as Record<string, unknown>) : null
  const latitude = location ? Number(location.latitude) : NaN
  const longitude = location ? Number(location.longitude) : NaN

  if (!id || !name.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  const place: NormalizedPlace = {
    id,
    name: name.trim().slice(0, 200),
    latitude,
    longitude,
    provider: 'google_places',
  }

  const category = typeof r.primaryType === 'string' ? r.primaryType.replace(/_/g, ' ').trim() : ''
  if (category) place.category = category.slice(0, 80)

  const address = typeof r.formattedAddress === 'string' ? r.formattedAddress.trim() : ''
  if (address) place.address = address.slice(0, 300)

  const hasOrigin =
    typeof originLat === 'number' &&
    typeof originLon === 'number' &&
    Number.isFinite(originLat) &&
    Number.isFinite(originLon)
  if (hasOrigin) {
    const d = haversineMeters(originLat as number, originLon as number, latitude, longitude)
    if (typeof d === 'number') place.distanceMeters = d
  }

  return place
}

export function normalizePlacesList(
  rawPlaces: unknown[],
  originLat?: number,
  originLon?: number,
  limit = DEFAULT_MAX_RESULT_COUNT,
): NormalizedPlace[] {
  const out: NormalizedPlace[] = []
  const list = Array.isArray(rawPlaces) ? rawPlaces : []
  for (const raw of list) {
    const p = normalizePlace(raw, originLat, originLon)
    if (!p) continue
    out.push(p)
    if (out.length >= limit) break
  }
  return out
}
