/**
 * #355B — Deterministic Places renderer (Italian-first). Extractive only —
 * never invents places, distances, or opening hours. openNow is DEFERRED:
 * this module never claims a place is open/closed from the API.
 */

const COPY = {
  it: {
    empty: 'Non ho trovato luoghi corrispondenti nelle vicinanze. Prova con un altro tipo di posto.',
    no_match: 'Non ho capito bene cosa cercare vicino a te. Prova ad esempio «Farmacia vicino a me».',
    provider_disabled: 'La ricerca luoghi non è ancora attiva su questo ambiente. Non invento risultati.',
    provider_error: 'La ricerca luoghi non è riuscita al momento. Riprova tra poco.',
    timeout: 'La ricerca luoghi sta impiegando troppo a rispondere. Riprova tra poco.',
    invalid_query: 'Non ho capito cosa cercare. Prova ad esempio «Farmacia vicino a me».',
    auth_required: 'Non riesco ad autenticare la ricerca luoghi in questo momento.',
    error: 'La ricerca luoghi non è riuscita al momento. Riprova tra poco.',
    location_required: 'Per cercare vicino a te ho bisogno della posizione.',
    no_active_places: 'Non ho una ricerca luoghi attiva. Dimmi cosa cerchi, ad esempio «farmacia vicino a me».',
    open_deferred: 'Non verifico ancora gli orari in questa versione.',
    maps_failed: 'Non sono riuscito ad aprire Maps.',
    navigate_need_place: 'Dimmi prima cosa cercare (es. «farmacia vicino a me»), poi ti apro le indicazioni.',
    use_location_btn: '📍 Usa la mia posizione',
    take_me_btn: 'Portami lì',
    maps_btn: 'Maps',
    location_denied: 'Non riesco ad accedere alla posizione. Riprova più tardi consentendo l’accesso dal browser.',
    location_timeout: 'La richiesta di posizione è scaduta. Riprova.',
    location_unsupported: 'Questo browser non supporta la geolocalizzazione.',
    location_unavailable: 'Posizione non disponibile al momento.',
    straight_line_note: 'Le distanze sono in linea d’aria, non tempi di percorso.',
    open_now_note: 'Nota: l’orario di apertura non è verificato in questa versione.',
  },
  en: {
    empty: 'No matching places found nearby. Try a different kind of place.',
    no_match: 'I couldn’t tell what to search for near you. Try e.g. “Pharmacy near me”.',
    provider_disabled: 'Places search isn’t enabled in this environment yet. I won’t invent results.',
    provider_error: 'Places search failed right now. Try again shortly.',
    timeout: 'Places search is taking too long to respond. Try again shortly.',
    invalid_query: 'I couldn’t tell what to search for. Try e.g. “Pharmacy near me”.',
    auth_required: 'I can’t authenticate the places search right now.',
    error: 'Places search failed right now. Try again shortly.',
    location_required: 'To search truly near you I need your location.',
    no_active_places: 'I don’t have an active places search. Tell me what to look for, e.g. “pharmacy near me”.',
    open_deferred: 'I don’t verify opening hours yet in this version.',
    maps_failed: 'Couldn’t open Maps.',
    navigate_need_place: 'Tell me what to search for first (e.g. “pharmacy near me”), then I’ll open directions.',
    use_location_btn: '📍 Use my location',
    take_me_btn: 'Take me there',
    maps_btn: 'Maps',
    location_denied: 'I can’t access your location. Try again after allowing access in the browser.',
    location_timeout: 'The location request timed out. Try again.',
    location_unsupported: 'This browser doesn’t support geolocation.',
    location_unavailable: 'Location unavailable right now.',
    straight_line_note: 'Distances are straight-line, not travel time.',
    open_now_note: 'Note: opening hours are not verified in this version.',
  },
}

export function placesCopy(key, language = 'it') {
  const table = language === 'en' ? COPY.en : COPY.it
  return table[key] || table.error
}

/** @param {string} status @param {'it'|'en'} [language] */
export function failureReply(status, language = 'it') {
  const table = language === 'en' ? COPY.en : COPY.it
  return table[status] || table.error
}

/** Maps a getBrowserPosition() failure code to a grounded, honest reply. */
export function geoFailureCopy(code, language = 'it') {
  if (code === 'denied') return placesCopy('location_denied', language)
  if (code === 'timeout') return placesCopy('location_timeout', language)
  if (code === 'unsupported') return placesCopy('location_unsupported', language)
  return placesCopy('location_unavailable', language)
}

/** "circa 320 m" / "circa 1,2 km" — null when the value isn't a finite distance. */
export function formatDistanceMeters(meters, language = 'it') {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return null
  const prefix = language === 'en' ? 'about' : 'circa'
  if (meters < 1000) {
    return `${prefix} ${Math.round(meters)} m`
  }
  const km = meters / 1000
  const kmStr = km.toFixed(1)
  const display = language === 'en' ? kmStr : kmStr.replace('.', ',')
  return `${prefix} ${display} km`
}

function placeLine(place, index, language) {
  const dist = formatDistanceMeters(place?.distanceMeters, language)
  const bits = [`${index + 1}. ${place?.name || ''}`]
  const line = dist ? `${bits[0]} — ${dist}` : bits[0]
  return place?.address ? `${line}\n   ${place.address}` : line
}

/**
 * @param {Array} places
 * @param {'it'|'en'} language
 * @param {{ category?: string|null, textQuery?: string|null, openNowRequested?: boolean }} [meta]
 */
export function renderPlacesList(places, language = 'it', meta = {}) {
  const list = Array.isArray(places) ? places : []
  const label = meta.textQuery || meta.category || (language === 'en' ? 'places' : 'luoghi')
  if (!list.length) return failureReply('empty', language)

  const header =
    language === 'en'
      ? `Here are ${list.length} results for “${label}”:`
      : `Ecco ${list.length} risultati per «${label}»:`

  const lines = [header, '', ...list.map((p, i) => placeLine(p, i, language)), '']
  const anyDistance = list.some((p) => typeof p.distanceMeters === 'number')
  if (anyDistance) lines.push(placesCopy('straight_line_note', language))
  if (meta.openNowRequested) lines.push(placesCopy('open_now_note', language))
  return lines.join('\n').trim()
}

/** Reply focused on the single nearest place (by distanceMeters). */
export function renderNearest(places, language = 'it') {
  const list = Array.isArray(places) ? places.filter((p) => typeof p.distanceMeters === 'number') : []
  if (!list.length) return failureReply('empty', language)
  const nearest = list.reduce((best, p) => (p.distanceMeters < best.distanceMeters ? p : best), list[0])
  const dist = formatDistanceMeters(nearest.distanceMeters, language)
  const prefix = language === 'en' ? 'Closest:' : 'Il più vicino:'
  const line = dist ? `${prefix} ${nearest.name} (${dist})` : `${prefix} ${nearest.name}`
  return nearest.address ? `${line}\n${nearest.address}` : line
}

/**
 * Follow-up answers against the currently focused place. Never re-fetches —
 * the controller decides when a network call is warranted.
 * @param {'select'|'distance'|'where'|'navigate'|'ask_open'} kind
 * @param {object|null} place
 * @param {'it'|'en'} language
 */
export function renderFollowUp(kind, place, language = 'it') {
  if (!place) return failureReply('empty', language)
  const dist = formatDistanceMeters(place.distanceMeters, language)

  if (kind === 'select') {
    const line = dist ? `${place.name} — ${dist}` : place.name
    return place.address ? `${line}\n${place.address}` : line
  }

  if (kind === 'distance') {
    if (!dist) {
      return language === 'en'
        ? `I don’t have a reliable distance for ${place.name}.`
        : `Non ho una distanza affidabile per ${place.name}.`
    }
    return language === 'en' ? `${place.name} is ${dist} away.` : `${place.name} è a ${dist}.`
  }

  if (kind === 'where') {
    if (!place.address) {
      return language === 'en'
        ? `I don’t have an address for ${place.name}.`
        : `Non ho un indirizzo per ${place.name}.`
    }
    return `${place.name}: ${place.address}`
  }

  if (kind === 'navigate') {
    return language === 'en'
      ? `Opening directions to ${place.name} in Maps.`
      : `Ti apro le indicazioni per ${place.name} in Maps.`
  }

  if (kind === 'ask_open') {
    return placesCopy('open_deferred', language)
  }

  return failureReply('error', language)
}
