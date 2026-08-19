/**
 * #312 — Visual Search follow-up intent (IT + EN).
 * Requires recent Vision context — never fires on text-only chat.
 */

import {
  hasRecentVisionContext,
  normalizeVisionSearchText,
} from './vision-search-context.js'

/**
 * @typedef {'generic_lookup'|'price'|'buy'|'identify'|'more_info'|'verify'|'none'} VisionSearchIntentKind
 */

/**
 * @typedef {{
 *   intent: 'vision_search' | 'none'
 *   kind: VisionSearchIntentKind
 *   matched: boolean
 * }} VisionSearchRoute
 */

/**
 * @param {string} lower
 */
function classifyKind(lower) {
  // Accents stripped for \b-safe matching (ù is non-word in JS).
  const ascii = lower.normalize('NFKD').replace(/\p{M}/gu, '')

  if (/\b(quanto\s+costa|prezzo|price|how\s+much|cost[ao]?|costs?)\b/.test(ascii)) {
    return /** @type {VisionSearchIntentKind} */ ('price')
  }
  if (
    /\b(dove\s+(posso\s+)?(comprarlo|comprarla|acquistarlo)|where\s+(can\s+i\s+)?buy|trova\s+(questo\s+)?prodotto|find\s+(this\s+)?product|acquista)\b/.test(
      ascii,
    )
  ) {
    return /** @type {VisionSearchIntentKind} */ ('buy')
  }
  if (
    /\b(che\s+modello\s+[eè]|che\s+modello\s+e|exact\s+model|what\s+exact\s+model|verifica\s+cos['']?[eè]|verifica\s+cos['']?e|verify\s+what|identifica)\b/.test(
      ascii,
    )
  ) {
    return /** @type {VisionSearchIntentKind} */ ('identify')
  }
  if (/\b(verifica|verify|conferma|confirm)\b/.test(ascii)) {
    return /** @type {VisionSearchIntentKind} */ ('verify')
  }
  if (
    /\b(dimmi\s+di\s+piu|piu\s+informazioni|more\s+information|tell\s+me\s+more|find\s+more|cerca\s+piu)\b/.test(
      ascii,
    )
  ) {
    return /** @type {VisionSearchIntentKind} */ ('more_info')
  }
  if (
    /\b(cercalo|cercala|cercalo\s+online|cerca\s+online|search\s+this|look\s+(it|this)\s+up|look\s+it\s+up|cerca\s+informazioni|trova\s+questo|search\s+it)\b/.test(
      ascii,
    ) ||
    /^\s*(cerca|search)\s*[.!]?\s*$/i.test(ascii)
  ) {
    return /** @type {VisionSearchIntentKind} */ ('generic_lookup')
  }
  // "Come si cura?" style care questions about the identified subject
  if (/\b(come\s+si\s+cura|how\s+(do\s+(i|you)\s+)?care|cura\s+della)\b/.test(ascii)) {
    return /** @type {VisionSearchIntentKind} */ ('more_info')
  }
  return /** @type {VisionSearchIntentKind} */ ('none')
}

/**
 * Button / client trigger phrases (exact).
 * @param {string} raw
 */
export function isVisionSearchButtonTrigger(raw) {
  const t = normalizeVisionSearchText(raw)
  return (
    t === 'Cercalo online.' ||
    t === 'Cercalo online' ||
    t === 'Search this online.' ||
    t === 'Search this online' ||
    t === '__VISION_SEARCH_GENERIC__'
  )
}

/**
 * @param {unknown} text
 * @param {{ messages?: unknown, hasVisionContext?: boolean }} [opts]
 * @returns {VisionSearchRoute}
 */
export function routeVisionSearchIntent(text, opts = {}) {
  const raw = typeof text === 'string' ? text : text == null ? '' : String(text)
  const lower = normalizeVisionSearchText(raw).toLowerCase()

  const hasCtx =
    opts.hasVisionContext === true ||
    (opts.hasVisionContext !== false && hasRecentVisionContext(opts.messages))
  if (!hasCtx) {
    return { intent: 'none', kind: 'none', matched: false }
  }

  if (isVisionSearchButtonTrigger(raw)) {
    return { intent: 'vision_search', kind: 'generic_lookup', matched: true }
  }

  if (!lower) {
    return { intent: 'none', kind: 'none', matched: false }
  }

  // Avoid stealing pure web-search commands that don't refer to the image
  // when they already include "sul web" without deictic "questo/it/this".
  // Still allow "cerca online" / "cercalo".

  const kind = classifyKind(lower)
  if (kind === 'none') {
    return { intent: 'none', kind: 'none', matched: false }
  }

  return { intent: 'vision_search', kind, matched: true }
}

/**
 * @param {unknown} text
 * @param {{ messages?: unknown, hasVisionContext?: boolean }} [opts]
 * @returns {VisionSearchRoute}
 */
export function detectVisionSearchIntent(text, opts = {}) {
  return routeVisionSearchIntent(text, opts)
}
