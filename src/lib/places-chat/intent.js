/**
 * #355B — Deterministic Places chat intent (Italian-first). Zero model calls.
 * Only the current explicit USER turn may authorize Places / location.
 *
 * openNow is DEFERRED: this module may DETECT an "open now" cue, but the
 * resulting operation is always a plain nearby_category / named search —
 * never a verified open/closed filter. Callers must add a disclaimer.
 */

import { analyzeOuterUserRequest } from '../outer-content-gate.js'
import { foldPlacesText } from './normalize.js'

/** Category word → canonical provider slug + Italian display label. */
const CATEGORY_MAP = [
  { slug: 'pharmacy', label: 'farmacia', re: /\bfarmaci[ae]\b/ },
  { slug: 'supermarket', label: 'supermercato', re: /\bsupermercat[oi]\b/ },
  { slug: 'bar', label: 'bar', re: /\bbar\b/ },
  { slug: 'restaurant', label: 'ristorante', re: /\bristorant[ei]\b/ },
  { slug: 'gas_station', label: 'benzinaio', re: /\b(benzinai[oi]|distributor[ei]\s+di\s+benzina)\b/ },
  { slug: 'gym', label: 'palestra', re: /\bpalestr[ae]\b/ },
  { slug: 'cafe', label: 'caffè', re: /\b(cafe|caffe)\b/ },
]

const NEAR_ME_RE = /\b(vicino\s+a\s+me|piu\s+vicin[oa]|qui\s+vicino|nelle\s+vicinanze|nei\s+dintorni|around\s+me|near\s+me|closest|nearest)\b/
const FIND_VERB_RE = /\b(trova|trovami|cerco|cerca|c['\s]?e\s+un|dove\s+posso|dov'?e\s+(il|la|lo|un|una))\b/
const OPEN_NOW_RE = /\b(apert[ao]\s+(adesso|ora)|open\s+now|currently\s+open)\b/

function detectCategory(t) {
  for (const c of CATEGORY_MAP) {
    if (c.re.test(t)) return c
  }
  return null
}

function isMetaTalk(t) {
  if (/\bcos['\s]?e\s+(una|un|la|il)\b/.test(t)) return true // "Cos'è una farmacia?"
  if (/\b(cosa\s+significa|what\s+is|tell\s+me\s+about|parlami\s+di)\b/.test(t)) return true
  return false
}

function isOtherProductIntent(t) {
  // Weather / calendar / email cues — Places must never steal these.
  if (/\b(che\s+tempo\s+fa|meteo|weather|piove|temperatura)\b/.test(t)) return true
  if (/\b(cosa\s+ho|che\s+impegn[iy]\s+ho|calendario|agenda|appuntament[oi]|briefing)\b/.test(t)) return true
  if (/\b(email|e-mail|mail|posta|gmail)\b/.test(t)) return true
  // "Apri Google Maps" (bare app-open) is a Phone Action, not a Places query.
  if (/^\s*apri\s+(google\s+)?maps\s*\??\s*$/.test(t)) return true
  return false
}

function looksQuotedOrInjected(raw) {
  const t = String(raw || '')
  if (/^["“«].*["”»]\s*$/s.test(t.trim())) return true
  if (/\b(ignore\s+(all\s+)?instructions|ignora\s+le\s+istruzioni)\b/i.test(t)) return true
  return false
}

/** Pronoun / deictic destinations that must not become Maps destinations directly. */
export function isDeicticDestination(dest) {
  const d = foldPlacesText(dest)
  return /^(li|la|lo|li'|qui|qua|there|here|it|that|this|quello|quella|quelli|quelle)$/i.test(d)
}

/**
 * "Dov'è il McDonald's più vicino?" → "McDonald's"
 * Named place search (no generic category word matched).
 */
function extractNamedQuery(raw) {
  const m = String(raw || '').match(
    /dov['’]?\s*[eè]\s+(?:il|la|lo|l['’])?\s*(.+?)\s+pi[uù]\s+vicin[oa]\s*\??\s*$/i,
  )
  if (m && m[1]) {
    const name = m[1].trim()
    if (name.length >= 2 && name.length <= 80) return name
  }
  const m2 = String(raw || '').match(/dov['’]?\s*[eè]\s+(?:il|la|lo|l['’])?\s*(.+?)\s*\?\s*$/i)
  if (m2 && m2[1]) {
    const name = m2[1].trim()
    if (name.length >= 2 && name.length <= 80 && !NEAR_ME_RE.test(foldPlacesText(name))) return name
  }
  return null
}

/**
 * Follow-up against activePlacesContext (only checked when hasPlacesContext).
 * @returns {false | { kind: string, index?: number }}
 */
export function detectPlacesFollowUp(raw, opts = {}) {
  if (!opts.hasPlacesContext) return false
  const stripped = String(raw || '')
    .trim()
    .replace(/^(ok|okay|va bene|allora|quindi|perfetto)[,.]?\s+/i, '')
  const t = foldPlacesText(stripped)
  if (!t) return false

  if (/^\s*(il\s+)?prim[oa]\s*[.!]?\s*$/.test(t) || /^\s*1\s*[.!]?\s*$/.test(t)) {
    return { kind: 'select_index', index: 0 }
  }
  if (/^\s*(il\s+|la\s+)?second[oa]\s*[.!]?\s*$/.test(t) || /^\s*2\s*[.!]?\s*$/.test(t)) {
    return { kind: 'select_index', index: 1 }
  }
  if (/^\s*(il\s+|la\s+)?terz[oa]\s*[.!]?\s*$/.test(t) || /^\s*3\s*[.!]?\s*$/.test(t)) {
    return { kind: 'select_index', index: 2 }
  }
  if (/^\s*(il\s+|la\s+)?(prossim[oa]|successiv[oa])\s*[.!]?\s*$/.test(t)) {
    return { kind: 'select_next' }
  }
  if (/\b(quanto\s+dist[ae]|how\s+far)\b/.test(t)) {
    return { kind: 'distance' }
  }
  if (/^\s*dov['\s]?e\s*\??\s*$/.test(t) || /^\s*where\s+is\s+it\s*\??\s*$/.test(t)) {
    return { kind: 'where' }
  }
  if (
    /\b(aprilo|aprila|apri)\b.{0,20}\b(su\s+)?(maps|mappe|google\s+maps)\b/.test(t) ||
    /\bopen\s+(it\s+)?(on\s+)?(maps|google\s+maps)\b/.test(t)
  ) {
    return { kind: 'open_maps' }
  }
  if (/\bportami\s+(li|la|qui|there)\b/.test(t) || /\btake\s+me\s+(there|here)\b/.test(t)) {
    return { kind: 'navigate' }
  }
  if (
    /^\s*[e']?\s*apert[oa]\s*\??\s*$/.test(t) ||
    /\b[e']\s*apert[oa]\b/.test(t) ||
    /\bis\s+it\s+open\b/.test(t)
  ) {
    return { kind: 'ask_open' }
  }

  return false
}

export const PLACES_USE_LOCATION_TRIGGER = '__places_use_my_location__'

/**
 * @returns {{
 *   intent: 'places' | 'none'
 *   operation?: 'nearby_category' | 'named' | 'follow_up'
 *   category?: string
 *   categoryLabel?: string
 *   textQuery?: string
 *   openNowRequested?: boolean
 *   followUpKind?: string
 *   followUpIndex?: number
 *   language: 'it' | 'en'
 *   failureCode?: string | null
 * }}
 */
export function detectPlacesIntent(raw, opts = {}) {
  const language = opts.languageHint === 'en' ? 'en' : 'it'
  const text = String(raw || '').trim()
  if (!text || text.length > 300) {
    return { intent: 'none', language }
  }

  if (text === PLACES_USE_LOCATION_TRIGGER) {
    return {
      intent: 'places',
      operation: 'nearby_category',
      category: null,
      categoryLabel: null,
      openNowRequested: false,
      language,
      failureCode: 'use_location_trigger',
    }
  }

  const outer = analyzeOuterUserRequest(text)
  if (outer.localRoutersSuppressed) {
    return { intent: 'none', language, failureCode: 'outer_suppressed' }
  }
  if (looksQuotedOrInjected(text)) {
    return { intent: 'none', language, failureCode: 'quoted_or_injected' }
  }

  const t = foldPlacesText(text)
  if (isMetaTalk(t)) {
    return { intent: 'none', language, failureCode: 'meta_talk' }
  }
  if (isOtherProductIntent(t)) {
    return { intent: 'none', language, failureCode: 'other_product' }
  }

  const hasPlacesContext = Boolean(opts.hasPlacesContext)
  if (hasPlacesContext) {
    const follow = detectPlacesFollowUp(text, { hasPlacesContext })
    if (follow) {
      return {
        intent: 'places',
        operation: 'follow_up',
        followUpKind: follow.kind,
        followUpIndex: follow.index,
        language,
      }
    }
  }

  const category = detectCategory(t)
  const nearMe = NEAR_ME_RE.test(t)
  const findVerb = FIND_VERB_RE.test(t)
  const openNowRequested = OPEN_NOW_RE.test(t)

  // Named search: "Dov'è il McDonald's più vicino?" — no generic category matched.
  if (!category && (nearMe || /dov['’]?[eè]/.test(t))) {
    const named = extractNamedQuery(text)
    if (named) {
      return {
        intent: 'places',
        operation: 'named',
        textQuery: named.slice(0, 80),
        category: null,
        categoryLabel: null,
        openNowRequested,
        language,
      }
    }
  }

  // Claim requires a category word + a proximity/find cue (never category alone).
  if (category && (nearMe || findVerb || openNowRequested)) {
    return {
      intent: 'places',
      operation: 'nearby_category',
      category: category.slug,
      categoryLabel: category.label,
      textQuery: null,
      openNowRequested,
      language,
    }
  }

  return { intent: 'none', language, failureCode: category ? 'no_proximity_cue' : 'no_category' }
}
