/**
 * #312 — Derive a grounded textual Search query from Vision context + user intent.
 * Never includes image bytes. Generic lookup avoids dumping private OCR text.
 */

import { normalizeVisionSearchText } from './vision-search-context.js'

/**
 * @param {{
 *   kind: import('./vision-search-intent.js').VisionSearchIntentKind
 *   userMessage: unknown
 *   vision: import('./vision-search-context.js').VisionSearchContext
 * }} input
 */
export function buildVisionSearchQuery(input) {
  const kind = input.kind || 'generic_lookup'
  const user = normalizeVisionSearchText(input.userMessage)
  const vision = input.vision
  if (!vision) {
    return {
      ok: false,
      query: '',
      code: 'no_vision_context',
      usedVisibleText: false,
      subject: '',
    }
  }

  const entity =
    (vision.entities && vision.entities[0]) ||
    pickSubjectFromSummary(vision.summary) ||
    ''
  const subject = entity || softSubject(vision.summary)

  if (!subject || subject.length < 2) {
    return {
      ok: false,
      query: '',
      code: 'vision_too_vague',
      usedVisibleText: false,
      subject: '',
    }
  }

  // Generic button / "Cercalo" — do NOT auto-append arbitrary OCR / private text.
  let usedVisibleText = false
  let focus = subject
  if (
    (kind === 'identify' || kind === 'verify' || kind === 'price' || kind === 'buy') &&
    vision.visibleText &&
    vision.visibleText.length >= 2 &&
    vision.visibleText.length <= 48
  ) {
    // Model/brand labels improve product/identity queries when short.
    if (!focus.toLowerCase().includes(vision.visibleText.toLowerCase())) {
      focus = `${focus} ${vision.visibleText}`.trim()
      usedVisibleText = true
    }
  }

  /** @type {string} */
  let query
  if (kind === 'price') {
    query = `${focus} current price`
  } else if (kind === 'buy') {
    query = `${focus} buy`
  } else if (kind === 'identify' || kind === 'verify') {
    query = vision.uncertain ? `${focus} identification` : `${focus}`
  } else if (kind === 'more_info') {
    // Prefer user ask when specific (e.g. care)
    if (/\b(cura|care|coltiv|grow|manten)/i.test(user)) {
      query = `${focus} care`
    } else {
      query = `${focus}`
    }
  } else {
    // generic_lookup
    query = `${focus}`
  }

  query = normalizeVisionSearchText(query).slice(0, 160)
  if (!query) {
    return {
      ok: false,
      query: '',
      code: 'query_empty',
      usedVisibleText,
      subject: focus,
    }
  }

  return {
    ok: true,
    query,
    code: null,
    usedVisibleText,
    subject: focus,
    uncertain: Boolean(vision.uncertain),
  }
}

/**
 * @param {string} summary
 */
function pickSubjectFromSummary(summary) {
  const s = normalizeVisionSearchText(summary)
  if (!s) return ''
  // "Sembrano Sony WH-1000XM5." / "È probabilmente il Colosseo."
  const patterns = [
    /\b(?:sembrano|sembra|appare|looks?\s+like|appears?\s+to\s+be|probably|probabilmente)\s+(?:essere\s+|un[oa]?\s+|il\s+|la\s+|the\s+)?(.+?)(?:[.!?]|$)/i,
    /\b(?:[eè]\s+probabilmente|is\s+probably|is\s+likely)\s+(?:un[oa]?\s+|il\s+|la\s+|the\s+)?(.+?)(?:[.!?]|$)/i,
    /\b(?:che\s+sembra|that\s+looks\s+like)\s+(?:essere\s+|un[oa]?\s+|il\s+|la\s+|the\s+|a\s+)?(.+?)(?:[.!?]|$)/i,
    /\b(?:vedo|vedo\s+una|i\s+see|i\s+see\s+a)\s+(.+?)(?:[.!?]|$)/i,
  ]
  for (const re of patterns) {
    const m = s.match(re)
    if (m && m[1]) {
      let v = m[1].trim()
      v = v.replace(/\b(che\s+sembra|that\s+looks\s+like)\b.*$/i, '').trim()
      v = v.replace(/[,:;].*$/, '').trim()
      // Prefer the specific identity after "una pianta che sembra …" style clauses
      if (/^(un[oa]?\s+)?pianta\b/i.test(v) && /sembra/i.test(s)) {
        continue
      }
      if (v.length >= 2 && v.length <= 80) return v
    }
  }
  // Fallback: first ~8 words
  return softSubject(s)
}

/**
 * @param {string} summary
 */
function softSubject(summary) {
  const words = normalizeVisionSearchText(summary).split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  return words.slice(0, 8).join(' ').replace(/[.!?…]+$/, '').trim().slice(0, 80)
}

/**
 * Instruction appendix for the model — not shown to the user as a system dump in UI.
 * @param {{
 *   query: string
 *   kind: string
 *   uncertain: boolean
 *   visionSummary: string
 * }} input
 */
export function buildVisionSearchAppendix(input) {
  const lines = [
    'VISION × SEARCH (bridge — reuse hosted web_search; do not invent browsing):',
    `- Visual subject (from prior Vision turn): ${String(input.visionSummary || '').slice(0, 240)}`,
    `- Suggested search query (use as the hosted web_search query focus): ${input.query}`,
    `- User visual-search intent kind: ${input.kind}`,
    'Rules:',
    '- You MUST use the hosted web_search tool this turn.',
    '- Prefer the suggested query (or a minimal refinement) — do not ignore the visual subject.',
    '- Distinguish clearly: (1) what Vision observed, (2) what Search verified, (3) what remains uncertain.',
    '- Do not claim Vision certainty that was not present.',
    '- Do not pretend Search ran if the tool was not used.',
    '- Never request or describe raw image upload to Search — text query only.',
    '- Citations: preserve url citations for live web claims.',
  ]
  if (input.uncertain) {
    lines.push(
      '- Vision identification is UNCERTAIN — treat the subject as a candidate; Search may verify or refute; say so clearly.',
    )
  }
  return lines.join('\n')
}
