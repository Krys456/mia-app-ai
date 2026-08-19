/**
 * #316 — Normalize provider payloads → internal Place model.
 * Never invent openNow / rating / distance.
 */

/**
 * @typedef {{
 *   id: string
 *   name: string
 *   category?: string
 *   address?: string
 *   latitude: number
 *   longitude: number
 *   distanceMeters?: number
 *   rating?: number
 *   ratingCount?: number
 *   openNow?: boolean
 *   phone?: string
 *   website?: string
 *   mapsDestination: string
 * }} Place
 */

/**
 * Build a safe Maps destination string from structured place fields.
 * @param {{ name?: string, address?: string, latitude?: number, longitude?: number }} p
 */
export function buildMapsDestination(p) {
  const name = String(p.name || '').trim()
  const address = String(p.address || '').trim()
  if (name && address) return `${name}, ${address}`.slice(0, 300)
  if (address) return address.slice(0, 300)
  if (name) return name.slice(0, 300)
  const lat = Number(p.latitude)
  const lng = Number(p.longitude)
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${lat},${lng}`
  }
  return ''
}

/**
 * Normalize one Google Places API (New) place resource.
 * @param {any} raw
 * @returns {Place | null}
 */
export function normalizeGooglePlace(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.id || raw.name || '').replace(/^places\//, '').trim()
  const name =
    (raw.displayName && typeof raw.displayName.text === 'string'
      ? raw.displayName.text
      : typeof raw.displayName === 'string'
        ? raw.displayName
        : '') || ''
  const lat = Number(raw.location?.latitude ?? raw.location?.lat)
  const lng = Number(raw.location?.longitude ?? raw.location?.lng)
  if (!id || !name.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) return null

  /** @type {Place} */
  const place = {
    id,
    name: name.trim().slice(0, 200),
    latitude: lat,
    longitude: lng,
    mapsDestination: '',
  }

  const address = typeof raw.formattedAddress === 'string' ? raw.formattedAddress.trim() : ''
  if (address) place.address = address.slice(0, 300)

  const category =
    (typeof raw.primaryTypeDisplayName?.text === 'string' && raw.primaryTypeDisplayName.text) ||
    (typeof raw.primaryType === 'string' && raw.primaryType.replace(/_/g, ' ')) ||
    (Array.isArray(raw.types) && typeof raw.types[0] === 'string' ? raw.types[0].replace(/_/g, ' ') : '')
  if (category) place.category = String(category).slice(0, 80)

  if (typeof raw.rating === 'number' && Number.isFinite(raw.rating)) {
    place.rating = Math.round(raw.rating * 10) / 10
  }
  const count = raw.userRatingCount ?? raw.user_ratings_total
  if (typeof count === 'number' && Number.isFinite(count) && count >= 0) {
    place.ratingCount = Math.round(count)
  }

  // openNow: only set when explicitly boolean — never coerce missing → false
  const openNow =
    raw.currentOpeningHours?.openNow ??
    raw.current_opening_hours?.open_now ??
    raw.openingHours?.openNow
  if (typeof openNow === 'boolean') {
    place.openNow = openNow
  }

  const phone =
    (typeof raw.nationalPhoneNumber === 'string' && raw.nationalPhoneNumber) ||
    (typeof raw.internationalPhoneNumber === 'string' && raw.internationalPhoneNumber) ||
    ''
  if (phone) place.phone = phone.trim().slice(0, 40)

  const website = typeof raw.websiteUri === 'string' ? raw.websiteUri.trim() : ''
  if (website && /^https?:\/\//i.test(website)) {
    place.website = website.slice(0, 500)
  }

  place.mapsDestination = buildMapsDestination(place)
  if (!place.mapsDestination) return null
  return place
}

/**
 * @param {any[]} rawPlaces
 * @param {{ originLat?: number, originLng?: number, haversine?: Function, limit?: number }} [opts]
 * @returns {Place[]}
 */
export function normalizeGooglePlacesList(rawPlaces, opts = {}) {
  const list = Array.isArray(rawPlaces) ? rawPlaces : []
  const limit = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : 5
  const haversine = typeof opts.haversine === 'function' ? opts.haversine : null
  const originLat = opts.originLat
  const originLng = opts.originLng
  const hasOrigin =
    Number.isFinite(Number(originLat)) && Number.isFinite(Number(originLng))

  /** @type {Place[]} */
  const out = []
  for (const raw of list) {
    const p = normalizeGooglePlace(raw)
    if (!p) continue
    if (hasOrigin && haversine) {
      const d = haversine(Number(originLat), Number(originLng), p.latitude, p.longitude)
      if (typeof d === 'number') p.distanceMeters = d
    }
    out.push(p)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Sort by distance when all have distanceMeters; otherwise keep order.
 * @param {Place[]} places
 */
export function sortPlacesByDistance(places) {
  const arr = Array.isArray(places) ? [...places] : []
  if (!arr.every((p) => typeof p.distanceMeters === 'number')) return arr
  return arr.sort((a, b) => a.distanceMeters - b.distanceMeters)
}
