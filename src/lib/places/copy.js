/**
 * #316 — Places copy (IT/EN). Grounded; never invents places.
 */

import { formatDistanceMeters } from './haversine.js'

export function placesCopy(key, lang, vars = {}) {
  const it = {
    location_required:
      'Per cercare davvero vicino a te ho bisogno della posizione.',
    location_denied:
      'Non riesco ad accedere alla posizione. Dimmi una città, zona o indirizzo e cerco lì.',
    location_unavailable:
      'Posizione non disponibile. Dimmi una città, zona o indirizzo e cerco lì.',
    location_timeout:
      'La richiesta di posizione è scaduta. Dimmi una città, zona o indirizzo e cerco lì.',
    location_unsupported:
      'Questo browser non supporta la geolocalizzazione. Dimmi una città, zona o indirizzo.',
    enter_area: 'Ok — scrivi una città, zona o indirizzo (es. «Cagliari» o «Piazza Yenne, Cagliari»).',
    disabled:
      'La ricerca luoghi non è ancora configurata su questo ambiente. Non invento risultati vicini.',
    no_results: 'Non ho trovato luoghi corrispondenti. Prova a cambiare zona o tipo di ricerca.',
    provider_error: 'La ricerca luoghi non è riuscita al momento. Riprova tra poco o specifica una zona.',
    invalid_query: 'Non ho capito cosa cercare. Prova ad esempio «Trova una farmacia a Cagliari».',
    open_unknown: 'Non ho uno stato di apertura affidabile per questo luogo.',
    open_yes: 'Sì — risulta aperta adesso (secondo i dati Places).',
    open_no: 'Risulta chiusa adesso (secondo i dati Places).',
    navigate_need_place: 'Dimmi quale luogo (es. «la seconda» o un indirizzo) e ti apro le indicazioni.',
    maps_failed: 'Non sono riuscito ad aprire Maps.',
    results_header: `Ecco ${vars.count || ''} risultati per «${vars.query || ''}»${vars.area ? ` vicino a ${vars.area}` : ''}:`,
    nearest_prefix: 'Il più vicino:',
    selected_prefix: 'Selezionato:',
    straight_line_note: 'Le distanze sono in linea d’aria, non tempi di percorso.',
    use_location_btn: '📍 Usa la mia posizione',
    enter_area_btn: 'Inserisci zona',
    take_me_btn: 'Portami lì',
    maps_btn: 'Maps',
  }
  const en = {
    location_required: 'To search truly near you I need your location.',
    location_denied:
      "I can't access your location. Tell me a city, area, or address and I'll search there.",
    location_unavailable:
      'Location unavailable. Tell me a city, area, or address and I’ll search there.',
    location_timeout:
      'The location request timed out. Tell me a city, area, or address.',
    location_unsupported:
      "This browser doesn't support geolocation. Tell me a city, area, or address.",
    enter_area: 'OK — type a city, area, or address (e.g. “Milan” or “Piazza Yenne, Cagliari”).',
    disabled:
      'Places search isn’t configured in this environment yet. I won’t invent nearby results.',
    no_results: 'No matching places found. Try a different area or query.',
    provider_error: 'Places search failed right now. Try again shortly or specify an area.',
    invalid_query: 'I couldn’t tell what to search for. Try e.g. “Find a pharmacy in Milan”.',
    open_unknown: "I don't have a reliable open/closed status for this place.",
    open_yes: 'Yes — it appears open now (per Places data).',
    open_no: 'It appears closed now (per Places data).',
    navigate_need_place: 'Tell me which place (e.g. “the second”) or an address for directions.',
    maps_failed: "Couldn't open Maps.",
    results_header: `Here are ${vars.count || ''} results for “${vars.query || ''}”${vars.area ? ` near ${vars.area}` : ''}:`,
    nearest_prefix: 'Closest:',
    selected_prefix: 'Selected:',
    straight_line_note: 'Distances are straight-line, not travel time.',
    use_location_btn: '📍 Use my location',
    enter_area_btn: 'Enter area',
    take_me_btn: 'Take me there',
    maps_btn: 'Maps',
  }
  const table = lang === 'en' ? en : it
  return table[key] || table.provider_error
}

/**
 * Format grounded place results for chat (no invented fields).
 * @param {Array} places
 * @param {'it'|'en'} lang
 * @param {{ query?: string, area?: string | null }} meta
 */
export function formatPlacesResultsReply(places, lang, meta = {}) {
  const list = Array.isArray(places) ? places : []
  const lines = [
    placesCopy('results_header', lang, {
      count: list.length,
      query: meta.query || '',
      area: meta.area || '',
    }),
    '',
  ]
  let anyDistance = false
  list.forEach((p, i) => {
    const bits = []
    const dist = formatDistanceMeters(p.distanceMeters, lang)
    if (dist) {
      bits.push(dist)
      anyDistance = true
    }
    if (typeof p.openNow === 'boolean') {
      bits.push(
        p.openNow
          ? lang === 'en'
            ? 'Open'
            : 'Aperta'
          : lang === 'en'
            ? 'Closed'
            : 'Chiusa',
      )
    }
    if (typeof p.rating === 'number') {
      bits.push(`${p.rating}★`)
    }
    lines.push(`${i + 1}. ${p.name}`)
    if (bits.length) lines.push(`   ${bits.join(' · ')}`)
    if (p.address) lines.push(`   ${p.address}`)
    lines.push('')
  })
  if (anyDistance) {
    lines.push(placesCopy('straight_line_note', lang))
  }
  return lines.join('\n').trim()
}

/**
 * Compact Places context block for optional Core grounding (no user coords).
 */
export function buildPlacesGroundingBlock(places, meta = {}) {
  const list = Array.isArray(places) ? places.slice(0, 5) : []
  const lines = [
    'PLACES_CONTEXT',
    `status: ${meta.status || 'ok'}`,
    `query: ${meta.query || ''}`,
    `count: ${list.length}`,
    'Rules: use ONLY these places; never invent places, distances, ratings, or open/closed status.',
    '',
  ]
  list.forEach((p, i) => {
    lines.push(`${i + 1}.`)
    lines.push(`name: ${p.name}`)
    if (p.address) lines.push(`address: ${p.address}`)
    if (typeof p.distanceMeters === 'number') lines.push(`distanceMeters: ${p.distanceMeters}`)
    if (typeof p.openNow === 'boolean') lines.push(`openNow: ${p.openNow}`)
    else lines.push('openNow: unknown')
    if (typeof p.rating === 'number') lines.push(`rating: ${p.rating}`)
    lines.push('')
  })
  return lines.join('\n')
}
