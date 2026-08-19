/**
 * #317 — Deterministic Weather intent (IT/EN).
 * Only the current explicit USER turn may authorize Weather / location.
 * Runs after Timer / Phone Actions; never steals Maps / Search / Places.
 */

function fold(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function detectWeatherLanguage(text, fallback = 'it') {
  const t = fold(text)
  const it = (
    t.match(
      /\b(tempo|meteo|piove|piovera|pioverà|ombrello|temperatura|vento|freddo|caldo|oggi|domani|stasera|stamattina)\b/g,
    ) || []
  ).length
  const en = (
    t.match(
      /\b(weather|rain|raining|umbrella|temperature|wind|cold|hot|today|tomorrow|tonight|forecast)\b/g,
    ) || []
  ).length
  if (en > it) return 'en'
  if (it > en) return 'it'
  return fallback
}

export function looksQuotedOrInjectedWeather(raw) {
  const t = String(raw || '')
  if (/^["“«].*["”»]\s*$/s.test(t.trim())) return true
  if (/\b(ignore\s+(all\s+)?instructions|ignora\s+le\s+istruzioni)\b/i.test(t)) return true
  return false
}

function isMetaOrNonRequest(t) {
  // Definitions / climate chat / stories — NOT live weather
  if (
    /\b(cos[' ]?e\s+(il\s+)?meteo|what\s+is\s+(the\s+)?weather|che\s+cos[' ]?e\s+(il\s+)?meteo)\b/.test(
      t,
    )
  ) {
    return true
  }
  if (
    /\b(come\s+funzionano\s+le\s+previsioni|how\s+(do|does)\s+(weather\s+)?forecasts?\s+work|come\s+funziona\s+(il\s+)?meteo)\b/.test(
      t,
    )
  ) {
    return true
  }
  if (/\b(parliamo\s+(di|del|dei|delle)\s+(clima|meteo)|let'?s\s+talk\s+about\s+(the\s+)?(climate|weather))\b/.test(t)) {
    return true
  }
  if (
    /\b(scrivi\s+(una\s+)?storia|write\s+(a\s+)?story|racconto)\b/.test(t) &&
    /\b(pioggia|rain|meteo|weather)\b/.test(t)
  ) {
    return true
  }
  if (/\b(cosa\s+significa|what\s+does|what\s+is\s+the\s+meaning|significa)\b/.test(t) && /\b(precipitaz|precipitation|meteo|weather)\b/.test(t)) {
    return true
  }
  // Explicit web search → Search router, not Weather
  if (
    /\b(cerca\s+sul\s+web|search\s+(the\s+)?web|google\s+(the\s+)?weather|cerca\s+su\s+internet)\b/.test(
      t,
    )
  ) {
    return true
  }
  return false
}

/** Chip / internal triggers (not shown as user weather phrasing). */
export const WEATHER_USE_LOCATION_TRIGGER = '__weather_use_my_location__'
export const WEATHER_ENTER_AREA_TRIGGER = '__weather_enter_area__'

/**
 * Extract city / area after "a/in/ad/at".
 * @param {string} raw
 * @param {string} folded
 */
export function extractWeatherLocationText(raw, folded) {
  const t = folded || fold(raw)
  // "qui" / "here" → GPS, not city
  if (/\b(qui|qua|here|near\s+me|vicino\s+a\s+me)\b/.test(t) && !/\b(a|in|ad|at)\s+[a-z]{3,}/.test(t.replace(/\b(qui|qua|here)\b/g, ''))) {
    // Still allow "a Milano" elsewhere
  }

  const patterns = [
    /\b(?:a|ad|in|at|near)\s+([A-ZÀÈÉÌÒÙ][\wÀ-ÿ'’\-]*(?:\s+[A-ZÀÈÉÌÒÙ][\wÀ-ÿ'’\-]*){0,3})\s*[.!?]?$/u,
    /\b(?:a|ad|in|at|near)\s+([a-zàèéìòù][\wàèéìòù'’\-]{2,}(?:\s+[a-zàèéìòù][\wàèéìòù'’\-]{2,}){0,2})\s*[.!?]?$/iu,
  ]
  for (const re of patterns) {
    const m = String(raw).match(re) || t.match(re)
    if (m && m[1]) {
      const loc = m[1].trim()
      if (
        /^(me|qui|qua|here|oggi|domani|stasera|stanotte|mattina|pomeriggio|sera|today|tomorrow|tonight|morning|afternoon|evening|weekend|un|una|il|la|the|a|an)$/i.test(
          loc,
        )
      ) {
        continue
      }
      // Title-case lightly
      return loc.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 120)
    }
  }
  return null
}

/**
 * @param {string} t folded
 * @returns {string | null}
 */
export function extractTimeHint(t) {
  if (/\b(dopodomani|day\s+after\s+tomorrow)\b/.test(t)) return 'day_after_tomorrow'
  if (/\b(domani|tomorrow)\b/.test(t)) return 'tomorrow'
  if (/\b(oggi|today)\b/.test(t)) return 'today'
  if (/\b(stamattina|mattina|this\s+morning|morning)\b/.test(t)) return 'morning'
  if (/\b(pomeriggio|afternoon|this\s+afternoon)\b/.test(t)) return 'afternoon'
  if (/\b(stasera|this\s+evening|evening)\b/.test(t)) return 'evening'
  if (/\b(stanotte|tonight|tonight|notte)\b/.test(t)) return 'tonight'
  if (/\b(weekend|fine\s+settimana|this\s+weekend)\b/.test(t)) return 'weekend'
  const nextDays = t.match(/\b(?:prossimi|next)\s+(\d+)\s+giorni|\bnext\s+(\d+)\s+days\b/)
  if (nextDays) {
    const n = Number(nextDays[1] || nextDays[2])
    if (n >= 1 && n <= 7) return `next_${n}_days`
  }
  const hourIt = t.match(/\b(?:alle|all['’])\s*(\d{1,2})(?::(\d{2}))?\b/)
  if (hourIt) return `hour_${Number(hourIt[1])}`
  const hourEn = t.match(/\b(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(?:h|hours?)?\b/)
  if (hourEn) return `hour_${Number(hourEn[1])}`
  const hourEn2 = t.match(/\b(\d{1,2})\s*(?:o'?clock|am|pm)\b/)
  if (hourEn2) return `hour_${Number(hourEn2[1])}`
  return null
}

function looksWeatherRequest(t) {
  if (
    /\b(che\s+tempo\s+fa|che\s+tempo\s+fara|che\s+tempo\s+farà|what'?s\s+the\s+weather|what\s+is\s+the\s+weather|how'?s\s+the\s+weather|weather\s+(like|today|tomorrow|in|for)|previsioni|forecast)\b/.test(
      t,
    )
  ) {
    return true
  }
  if (/\b(piovera|pioverà|piovera'|piove|piovere|will\s+it\s+rain|is\s+it\s+raining|raining)\b/.test(t)) {
    return true
  }
  if (/\b(ombrello|umbrella|devo\s+portare|do\s+i\s+need)\b/.test(t) && /\b(ombrello|umbrella|pioggia|rain)\b/.test(t)) {
    return true
  }
  if (
    /\b(temperatura|temperature|gradi|degrees|quanto\s+fa|how\s+(hot|cold)|how\s+cold|far[aà]\s+freddo|far[aà]\s+caldo)\b/.test(
      t,
    )
  ) {
    return true
  }
  if (/\b(vento|wind|quanto\s+vento|how\s+windy)\b/.test(t)) return true
  if (/\b(vestirmi|dress|giacca|jacket|correre|run)\b/.test(t) && /\b(oggi|domani|stasera|today|tomorrow|alle|at)\b/.test(t)) {
    // clothing advice often weather-complex — still weather intent if paired with time
    return /\b(tempo|meteo|freddo|caldo|pioggia|weather|cold|hot|rain|ombrello|umbrella)\b/.test(t)
  }
  return false
}

function detectOperation(t, timeHint) {
  if (/\b(ombrello|umbrella)\b/.test(t)) return 'umbrella'
  if (/\b(piovera|pioverà|piove|piovere|will\s+it\s+rain|raining|rain)\b/.test(t) && !/\b(ombrello|umbrella)\b/.test(t)) {
    return 'rain'
  }
  if (/\b(vento|wind|windy)\b/.test(t)) return 'wind'
  if (
    /\b(temperatura|temperature|gradi|degrees|quanto\s+fa|how\s+(hot|cold)|far[aà]\s+freddo|far[aà]\s+caldo|how\s+cold)\b/.test(
      t,
    )
  ) {
    return 'temperature'
  }
  if (timeHint === 'weekend' || /\b(weekend|fine\s+settimana)\b/.test(t)) return 'weekend'
  if (timeHint && /^next_\d+_days$/.test(timeHint)) return 'daily'
  if (timeHint && /^hour_/.test(timeHint)) return 'hourly'
  if (timeHint === 'tomorrow') return 'tomorrow'
  if (timeHint === 'today' || timeHint === 'morning' || timeHint === 'afternoon' || timeHint === 'evening' || timeHint === 'tonight') {
    return timeHint === 'today' ? 'today' : 'hourly'
  }
  if (/\b(prossimi\s+\d+\s+giorni|next\s+\d+\s+days)\b/.test(t)) return 'daily'
  return 'current'
}

function wantsCurrentLocation(t, locationText) {
  if (locationText) return false
  if (/\b(qui|qua|here|near\s+me|vicino\s+a\s+me)\b/.test(t)) return true
  // Bare "che tempo fa?" / "what's the weather?" / umbrella without city → GPS or context
  return true
}

/**
 * Follow-ups when activeWeatherContext is fresh.
 * @returns {false | { kind: string, timeHint?: string|null, operation?: string }}
 */
export function detectWeatherFollowUp(raw, opts = {}) {
  if (!opts.hasWeatherContext) return false
  const stripped = String(raw || '')
    .trim()
    .replace(/^(ok|okay|va bene|allora|quindi|perfetto|e|and)[,.]?\s+/i, '')
  const t = fold(stripped)

  if (looksQuotedOrInjectedWeather(raw) || isMetaOrNonRequest(t)) return false

  // Pure relative follow-ups
  if (/^\s*(e\s+)?domani\??\s*$/i.test(stripped) || /^\s*(and\s+)?tomorrow\??\s*$/i.test(stripped)) {
    return { kind: 'follow_up', operation: 'tomorrow', timeHint: 'tomorrow' }
  }
  if (/^\s*(e\s+)?(la\s+)?sera\??\s*$/i.test(stripped) || /^\s*(and\s+)?(in\s+the\s+)?evening\??\s*$/i.test(stripped)) {
    return { kind: 'follow_up', operation: 'hourly', timeHint: 'evening' }
  }
  if (/^\s*(e\s+)?(il\s+)?pomeriggio\??\s*$/i.test(stripped) || /^\s*(and\s+)?(in\s+the\s+)?afternoon\??\s*$/i.test(stripped)) {
    return { kind: 'follow_up', operation: 'hourly', timeHint: 'afternoon' }
  }
  if (/^\s*(piovera|pioverà|piove)\??\s*$/i.test(stripped) || /^\s*(will\s+it\s+)?rain\??\s*$/i.test(stripped)) {
    return { kind: 'follow_up', operation: 'rain', timeHint: opts.stickyTimeHint || 'today' }
  }
  if (/^\s*(e\s+)?(nel\s+)?weekend\??\s*$/i.test(stripped) || /^\s*(and\s+)?(this\s+)?weekend\??\s*$/i.test(stripped)) {
    return { kind: 'follow_up', operation: 'weekend', timeHint: 'weekend' }
  }
  if (/^\s*(quanto\s+vento|vento)\??\s*$/i.test(stripped) || /^\s*(how\s+)?(much\s+)?wind\??\s*$/i.test(stripped)) {
    return { kind: 'follow_up', operation: 'wind', timeHint: opts.stickyTimeHint || null }
  }
  if (/^\s*(e\s+)?oggi\??\s*$/i.test(stripped) || /^\s*(and\s+)?today\??\s*$/i.test(stripped)) {
    return { kind: 'follow_up', operation: 'today', timeHint: 'today' }
  }

  // Short weather ops without new city → reuse context
  if (looksWeatherRequest(t) && !extractWeatherLocationText(raw, t)) {
    const timeHint = extractTimeHint(t) || opts.stickyTimeHint || null
    return {
      kind: 'follow_up',
      operation: detectOperation(t, timeHint),
      timeHint,
    }
  }

  return false
}

/**
 * @returns {{
 *   intent: 'weather' | 'none'
 *   operation?: string
 *   locationText?: string | null
 *   requiresCurrentLocation?: boolean
 *   timeHint?: string | null
 *   language?: 'it' | 'en'
 *   complexAdvice?: boolean
 *   followUp?: boolean
 *   failureCode?: string | null
 * }}
 */
export function detectWeatherIntent(raw, opts = {}) {
  const text = String(raw || '').trim()
  if (!text) return { intent: 'none' }

  if (text === WEATHER_USE_LOCATION_TRIGGER) {
    return {
      intent: 'weather',
      operation: 'current',
      locationText: null,
      requiresCurrentLocation: true,
      timeHint: null,
      language: opts.languageHint === 'en' ? 'en' : 'it',
      followUp: false,
    }
  }
  if (text === WEATHER_ENTER_AREA_TRIGGER) {
    return {
      intent: 'weather',
      operation: 'follow_up',
      followUpKind: 'prompt_area',
      locationText: null,
      requiresCurrentLocation: false,
      timeHint: null,
      language: opts.languageHint === 'en' ? 'en' : 'it',
      followUp: true,
    }
  }

  if (looksQuotedOrInjectedWeather(text)) {
    return { intent: 'none', failureCode: 'quoted_or_injected' }
  }

  const language = detectWeatherLanguage(text, opts.languageHint === 'en' ? 'en' : 'it')
  const t = fold(text)

  if (isMetaOrNonRequest(t)) {
    return { intent: 'none', failureCode: 'meta_or_search' }
  }

  const follow = detectWeatherFollowUp(text, {
    hasWeatherContext: Boolean(opts.hasWeatherContext),
    stickyTimeHint: opts.stickyTimeHint || null,
  })
  if (follow) {
    return {
      intent: 'weather',
      operation: follow.operation || 'current',
      locationText: null,
      requiresCurrentLocation: false,
      timeHint: follow.timeHint ?? null,
      language,
      followUp: true,
      complexAdvice: false,
    }
  }

  if (!looksWeatherRequest(t)) {
    return { intent: 'none' }
  }

  const locationText = extractWeatherLocationText(text, t)
  const timeHint = extractTimeHint(t)
  const operation = detectOperation(t, timeHint)
  const requiresCurrentLocation = wantsCurrentLocation(t, locationText) && !opts.hasWeatherContext
  const complexAdvice =
    /\b(vestirmi|dress|consigli|advice|giacca|jacket|correre|run|portare\s+l['’]?ombrello\s+e)\b/.test(t)

  return {
    intent: 'weather',
    operation,
    locationText,
    requiresCurrentLocation: Boolean(requiresCurrentLocation),
    timeHint,
    language,
    followUp: false,
    complexAdvice,
  }
}
