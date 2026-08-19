/**
 * #316 — Deterministic Places intent (IT/EN).
 * Only the current explicit USER turn may authorize Places / location.
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

export function detectPlacesLanguage(text, fallback = 'it') {
  const t = fold(text)
  const it = (t.match(/\b(trova|trovami|vicino|vicinanze|dintorni|farmacia|supermercato|ristorante|dove|posso|caffè|caffe)\b/g) || []).length
  const en = (t.match(/\b(find|nearby|closest|around|pharmacy|supermarket|restaurant|where|coffee|hotel)\b/g) || []).length
  if (en > it) return 'en'
  if (it > en) return 'it'
  return fallback
}

export function looksQuotedOrInjectedPlaces(raw) {
  const t = String(raw || '')
  if (/^["“«].*["”»]\s*$/s.test(t.trim())) return true
  if (/\b(ignore\s+(all\s+)?instructions|ignora\s+le\s+istruzioni)\b/i.test(t)) return true
  return false
}

function isMetaTalk(t) {
  if (
    /\b(cos[' ]?e|what\s+is|what's|che\s+cos[' ]?e|parlami|tell\s+me\s+about|come\s+funziona|how\s+(does|do)|scrivi\s+un\s+articolo|write\s+(an\s+)?article|significa|mean)\b/.test(
      t,
    )
  ) {
    return true
  }
  if (/\b(parliamo\s+(di|dei|delle|del)|let'?s\s+talk\s+about)\b/.test(t)) return true
  return false
}

/** Pronoun / deictic destinations that must not become Maps destinations. */
export function isDeicticDestination(dest) {
  const d = fold(dest)
  return /^(li|la|lo|li'|là|qui|qua|there|here|it|that|this|quello|quella|quelli|quelle)$/i.test(d)
}

/**
 * Follow-up against activePlacesContext.
 * @returns {false | { kind: string, index?: number, sort?: string }}
 */
export function detectPlacesFollowUp(raw, opts = {}) {
  if (!opts.hasPlacesContext) return false
  const stripped = String(raw || '')
    .trim()
    .replace(/^(ok|okay|va bene|allora|quindi|perfetto)[,.]?\s+/i, '')
  const t = fold(stripped)

  if (/^\s*(la\s+prima|the\s+first|numero\s+1|#?\s*1)\s*[.!]?\s*$/.test(t) || /^\s*1\s*[.!]?\s*$/.test(t)) {
    return { kind: 'select_index', index: 0 }
  }
  if (/^\s*(la\s+seconda|the\s+second|numero\s+2|#?\s*2)\s*[.!]?\s*$/.test(t) || /^\s*2\s*[.!]?\s*$/.test(t)) {
    return { kind: 'select_index', index: 1 }
  }
  if (/^\s*(la\s+terza|the\s+third|numero\s+3|#?\s*3)\s*[.!]?\s*$/.test(t) || /^\s*3\s*[.!]?\s*$/.test(t)) {
    return { kind: 'select_index', index: 2 }
  }
  if (/^\s*(la\s+quarta|the\s+fourth)\s*[.!]?\s*$/.test(t)) {
    return { kind: 'select_index', index: 3 }
  }
  if (/^\s*(la\s+quinta|the\s+fifth)\s*[.!]?\s*$/.test(t)) {
    return { kind: 'select_index', index: 4 }
  }

  if (
    /\b(la\s+piu\s+vicina|il\s+piu\s+vicino|quella\s+piu\s+vicina|quello\s+piu\s+vicino|the\s+closest|the\s+nearest|closest\s+one|nearest\s+one)\b/.test(
      t,
    ) ||
    /^\s*(qual\s+[eè]\s+(la\s+)?piu\s+vicina|what'?s\s+the\s+closest)\s*[.?!]?\s*$/.test(t)
  ) {
    return { kind: 'select_nearest' }
  }

  if (
    /^\s*(quella|quello|quelli|questa|questo|that\s+one|this\s+one|it)\s*[.!]?\s*$/.test(t)
  ) {
    return { kind: 'select_current' }
  }

  if (
    /\b(portami\s+(li|la|là|qui|there)|portami\s+li|navigate\s+(there|here)|take\s+me\s+(there|here))\b/.test(
      t,
    ) ||
    /^\s*(portami\s+(li|là|la)|take\s+me\s+there)\s*[.!]?\s*$/.test(t)
  ) {
    return { kind: 'navigate' }
  }

  if (
    /\b(aprila|aprilo|apri)\b.{0,20}\b(su\s+)?(maps|mappe|google\s+maps)\b/.test(t) ||
    /\b(open\s+(it\s+)?(on\s+)?(maps|google\s+maps))\b/.test(t)
  ) {
    return { kind: 'open_maps' }
  }

  if (
    /^\s*(e\s+aperta|e\s+aperto|[eè]\s+aperta|[eè]\s+aperto|is\s+it\s+open|open\s+now\??)\s*[.?!]?\s*$/.test(
      t,
    ) ||
    /\b(e\s+aperta|is\s+it\s+open)\b/.test(t)
  ) {
    return { kind: 'ask_open' }
  }

  return false
}

/**
 * Extract explicit location text when user names a place/city (no GPS).
 * @param {string} raw
 * @param {string} folded
 */
export function extractExplicitLocationText(raw, folded) {
  const t = folded || fold(raw)
  const patterns = [
    /\b(?:vicino\s+a|near|nearby|around|presso)\s+(.+)$/i,
    /\b(?:a|in|ad)\s+([a-zàèéìòù][\wàèéìòù'’\-\s,]{1,80})$/i,
  ]
  // Prefer "vicino a Piazza Yenne, Cagliari" / "near Piazza Yenne"
  const vicino = String(raw).match(
    /\b(?:vicino\s+a|near(?:\s+to)?|nearby|around)\s+(.+?)(?:\s*[.!?])?$/i,
  )
  if (vicino && vicino[1]) {
    let loc = vicino[1].trim()
    // Drop trailing "a me" / "me" — those are GPS requests
    if (/^(me|a\s+me|qui|here)$/i.test(loc)) return null
    return loc.slice(0, 200)
  }

  // "hotel a Milano" / "farmacie a Cagliari" / "in London" / "in Milan"
  const city = String(raw).match(
    /\b(?:a|ad|in)\s+([A-ZÀÈÉÌÒÙ][\wÀ-ÿ'’\-]*(?:\s+[A-ZÀÈÉÌÒÙ][\wÀ-ÿ'’\-]*){0,3})\s*[.!?]?$/u,
  )
  if (city && city[1]) {
    const loc = city[1].trim()
    if (!/^(me|un|una|il|la|the|a|an)$/i.test(loc)) return loc.slice(0, 200)
  }

  // lowercase city at end: "a milano" / "in london"
  const cityLow = t.match(/\b(?:a|ad|in)\s+([a-z][a-z'’\-]{2,}(?:\s+[a-z][a-z'’\-]{2,}){0,2})\s*$/)
  if (cityLow && cityLow[1]) {
    const loc = cityLow[1].trim()
    if (
      !/^(me|un|una|il|la|lo|gli|le|the|a|an|cafe|caffe|caffè|farmacia|supermercato|ristorante|hotel|pharmacy|restaurant|supermarket)$/i.test(
        loc,
      )
    ) {
      // Capitalize lightly for display
      return loc.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 200)
    }
  }

  return null
}

/**
 * Extract free-text place query (what to find).
 */
export function extractPlacesQuery(raw, folded, explicitLocationText) {
  let s = String(raw || '').trim()
  // Remove location clause
  if (explicitLocationText) {
    s = s.replace(new RegExp(`\\b(?:vicino\\s+a|near(?:\\s+to)?|nearby|around)\\s+${escapeReg(explicitLocationText)}`, 'i'), '')
    s = s.replace(new RegExp(`\\b(?:a|ad|in)\\s+${escapeReg(explicitLocationText)}`, 'i'), '')
  }
  s = s
    .replace(/\b(vicino\s+a\s+me|near\s+me|nearby|qui\s+vicino|nelle\s+vicinanze|nei\s+dintorni|around\s+me|close\s+to\s+me)\b/gi, '')
    .replace(/\b(trova|trovami|find|cerca|search|looking\s+for)\b/gi, '')
    .replace(/\b(un|una|uno|the|a|an|some|dei|delle|degli)\b/gi, ' ')
    .replace(/\b(qual\s+[eè]|what'?s|what\s+is|dove\s+posso|where\s+can\s+i)\b/gi, '')
    .replace(/\b(prendere|mangiare|get|find|have)\b/gi, ' ')
    .replace(/\b(piu\s+vicin[oa]|closest|nearest)\b/gi, '')
    .replace(/\b(ci\s+sono|are\s+there|is\s+there)\b/gi, '')
    .replace(/\b(apert[aeoi]|open\s+now|currently\s+open)\b/gi, '')
    .replace(/[?!.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  // "dove posso prendere un caffè" → caffe
  if (!s || s.length < 2) {
    const t = folded || fold(raw)
    if (/\b(caffe|caffè|coffee)\b/.test(t)) return 'caffè'
    if (/\b(farmacie|farmacia|pharmacy|pharmacies)\b/.test(t)) return 'farmacia'
    if (/\b(supermercat|supermarket|grocery)\b/.test(t)) return 'supermercato'
    if (/\b(distributori|benzina|fuel|gas\s+station|petrol)\b/.test(t)) return 'distributore'
    if (/\b(ristorant|restaurant)\b/.test(t)) return 'ristorante'
    if (/\b(hotel|albergo)\b/.test(t)) return 'hotel'
    return ''
  }
  return s.slice(0, 120)
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wantsOpenNow(t) {
  return /\b(apert[aeoi]|open\s+now|currently\s+open|che\s+sia\s+apert)\b/.test(t)
}

function wantsNearest(t) {
  return /\b(piu\s+vicin[oa]|closest|nearest|la\s+piu\s+vicina|il\s+piu\s+vicino)\b/.test(t)
}

function looksNearMe(t) {
  return /\b(vicino\s+a\s+me|near\s+me|qui\s+vicino|nelle\s+vicinanze|nei\s+dintorni|around\s+me|nearby|close\s+to\s+me)\b/.test(
    t,
  )
}

function looksPlacesFindVerb(t) {
  return (
    /\b(trova|trovami|find|cerca|looking\s+for)\b/.test(t) ||
    /\b(dove\s+posso|where\s+can\s+i|ci\s+sono|are\s+there)\b/.test(t) ||
    /\b(qual\s+[eè]\s+la|what'?s\s+the\s+closest|what\s+is\s+the\s+closest)\b/.test(t)
  )
}

function looksPlaceCategory(t) {
  return /\b(farmacie?|pharmacy|pharmacies|supermercat\w*|supermarket|grocery|ristorant\w*|restaurant|caff[eè]|coffee|cafe|hotel|albergh?\w*|distributor\w*|benzina|fuel|gas\s+station|petrol|ospedale|hospital|atm|bancomat|palestra|gym|parcheggio|parking|negozio|shop|store)\b/.test(
    t,
  )
}

/**
 * Internal triggers from location action chips (not shown as Places find).
 */
export const PLACES_USE_LOCATION_TRIGGER = '__places_use_my_location__'
export const PLACES_ENTER_AREA_TRIGGER = '__places_enter_area__'

/**
 * @returns {{
 *   intent: 'places' | 'none'
 *   operation?: 'nearby' | 'text_search' | 'follow_up'
 *   followUpKind?: string
 *   followUpIndex?: number
 *   query?: string
 *   explicitLocationText?: string | null
 *   requiresCurrentLocation?: boolean
 *   openNowRequested?: boolean
 *   sort?: 'nearest' | 'relevance'
 *   language: 'it' | 'en'
 *   failureCode?: string | null
 * }}
 */
export function detectPlacesIntent(raw, opts = {}) {
  const language = detectPlacesLanguage(raw, opts.languageHint || 'it')
  const text = fold(raw)

  if (!text || text.length < 2) {
    return { intent: 'none', language }
  }

  // Location action chip triggers
  if (text === fold(PLACES_USE_LOCATION_TRIGGER)) {
    return {
      intent: 'places',
      operation: 'nearby',
      query: '',
      requiresCurrentLocation: true,
      openNowRequested: false,
      sort: 'nearest',
      language,
      failureCode: 'use_location_trigger',
    }
  }
  if (text === fold(PLACES_ENTER_AREA_TRIGGER)) {
    return {
      intent: 'places',
      operation: 'follow_up',
      followUpKind: 'prompt_area',
      language,
    }
  }

  if (looksQuotedOrInjectedPlaces(raw)) {
    return { intent: 'none', language, failureCode: 'quoted_or_injected' }
  }
  if (isMetaTalk(text)) {
    return { intent: 'none', language, failureCode: 'meta_talk' }
  }

  const follow = detectPlacesFollowUp(raw, { hasPlacesContext: Boolean(opts.hasPlacesContext) })
  if (follow) {
    return {
      intent: 'places',
      operation: 'follow_up',
      followUpKind: follow.kind,
      followUpIndex: follow.index,
      language,
      requiresCurrentLocation: false,
      openNowRequested: false,
      sort: 'nearest',
    }
  }

  const nearMe = looksNearMe(text)
  const findVerb = looksPlacesFindVerb(text)
  const category = looksPlaceCategory(text)
  const nearest = wantsNearest(text)

  // Need a find-ish cue + (category OR near-me OR nearest)
  if (!findVerb && !nearest) {
    // "farmacie a Cagliari" without trova — still places if category + explicit city
    if (!(category && /\b(a|ad|in|vicino\s+a|near)\b/.test(text))) {
      return { intent: 'none', language }
    }
  }
  if (!category && !nearMe && !nearest && !/\b(dove\s+posso|where\s+can\s+i)\b/.test(text)) {
    return { intent: 'none', language }
  }

  const explicitLocationText = extractExplicitLocationText(raw, text)
  const requiresCurrentLocation = !explicitLocationText && (nearMe || nearest || findVerb)
  // If they said "a Milano" etc., no GPS
  const operation = explicitLocationText ? 'text_search' : 'nearby'
  const query = extractPlacesQuery(raw, text, explicitLocationText)
  if (!query && !category) {
    return { intent: 'none', language, failureCode: 'no_query' }
  }

  return {
    intent: 'places',
    operation,
    query: query || extractPlacesQuery(raw, text, null) || 'luogo',
    explicitLocationText: explicitLocationText || null,
    requiresCurrentLocation: operation === 'nearby' && !explicitLocationText,
    openNowRequested: wantsOpenNow(text),
    sort: nearest || nearMe ? 'nearest' : 'relevance',
    language,
  }
}
