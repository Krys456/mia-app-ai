/**
 * #317 — Weather copy (IT/EN). Grounded; never invents forecast values.
 */

export function weatherCopy(key, lang, vars = {}) {
  const it = {
    location_required:
      'Per controllare il meteo ho bisogno della tua posizione oppure di una città.',
    location_denied:
      'Non riesco ad accedere alla tua posizione. Scrivimi una città o una zona e controllo il meteo lì.',
    location_unavailable:
      'Posizione non disponibile. Scrivimi una città o una zona e controllo il meteo lì.',
    location_timeout:
      'La richiesta di posizione è scaduta. Scrivimi una città o una zona e controllo il meteo lì.',
    location_unsupported:
      'Questo browser non supporta la geolocalizzazione. Scrivimi una città o una zona.',
    enter_area: 'Ok — scrivi una città o una zona (es. «Milano» o «Cagliari»).',
    geocode_empty: 'Non sono riuscito a trovare quella località.',
    geocode_ambiguous:
      vars.options
        ? `Ho trovato più località. Quale intendi?\n${vars.options}`
        : 'Ho trovato più località con quel nome. Specifica città e regione/paese.',
    provider_error: 'Non riesco a recuperare le previsioni in questo momento.',
    rate_limited: 'Troppe richieste meteo. Riprova tra un momento.',
    offline: 'Sei offline o la rete non risponde. Riprova tra poco.',
    invalid_request: 'Non ho capito la richiesta meteo. Prova «Che tempo fa a Milano?»',
    use_location_btn: '📍 Usa la mia posizione',
    enter_area_btn: 'Inserisci zona',
    attribution: 'Weather data: Open-Meteo',
  }
  const en = {
    location_required: 'To check the weather I need your location or a city name.',
    location_denied:
      "I can't access your location. Tell me a city or area and I'll check the weather there.",
    location_unavailable:
      'Location unavailable. Tell me a city or area and I’ll check the weather there.',
    location_timeout: 'The location request timed out. Tell me a city or area.',
    location_unsupported:
      "This browser doesn't support geolocation. Tell me a city or area.",
    enter_area: 'OK — type a city or area (e.g. “Milan” or “London”).',
    geocode_empty: "I couldn't find that place.",
    geocode_ambiguous:
      vars.options
        ? `I found several places. Which one did you mean?\n${vars.options}`
        : 'I found several places with that name. Please add region/country.',
    provider_error: "I can't fetch the forecast right now.",
    rate_limited: 'Too many weather requests. Try again in a moment.',
    offline: 'You appear offline or the network failed. Try again shortly.',
    invalid_request: 'I couldn’t parse that weather request. Try “What’s the weather in London?”',
    use_location_btn: '📍 Use my location',
    enter_area_btn: 'Enter area',
    attribution: 'Weather data: Open-Meteo',
  }
  const table = lang === 'en' ? en : it
  return table[key] || table.provider_error
}

export function geoFailureCopy(code, lang) {
  if (code === 'denied') return weatherCopy('location_denied', lang)
  if (code === 'timeout') return weatherCopy('location_timeout', lang)
  if (code === 'unsupported') return weatherCopy('location_unsupported', lang)
  return weatherCopy('location_unavailable', lang)
}

/**
 * Format hour label from ISO-like local time "YYYY-MM-DDTHH:MM"
 * @param {string | null} time
 */
export function formatHourLabel(time, lang = 'it') {
  if (!time || typeof time !== 'string') return ''
  const hh = time.slice(11, 16)
  if (!hh) return ''
  return lang === 'en' ? hh : `alle ${hh}`
}
