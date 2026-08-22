/**
 * #364B — Mixed-intent / whole-turn claim gate for local capability routers.
 *
 * A local router may claim the ENTIRE turn only when the turn is predominantly
 * that capability. Embedded side asks must fall through to Core.
 *
 * Deterministic only — no LLM, no network, no persistent state.
 */

export const MIXED_INTENT_GATE_BUILD = '364b-1'

/** @typedef {'translation'|'timer'|'reminder'|'calculator'|'units'|'weather'|'briefing'|'phone'|'calendar'|'email'|'places'|'energy'|'other'} MixedIntentRouterType */

/**
 * @param {string} s
 */
function fold(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} s
 */
function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Conversational / decision residual cues (independent of the capability).
 * Conservative: prefer Core when residual looks like another ask.
 */
const RESIDUAL_ASK_RE =
  /\b(?:secondo\s+te|secondo\s+voi|meglio|oppure|quante?|quanto(?:\s+tempo|\s+intesa)?|quale|quali|perch[eé]|dimmi\s+se|cosa\s+(?:ne\s+pensi|mi\s+consigli|dovrei)|come\s+(?:faccio|organizz|struttur)|dovrei|conviene|scegli(?:erei)?|consigli(?:ami)?|ha\s+senso|il\s+piano|scheda|ripetizioni|serie|allenamento|ipertrofia|forza|cardio|zona\s*2|split|camminat|cors[ae]|should\s+i|would\s+you|what\s+about|how\s+(?:many|much|long)|which|advice|recommend|workout|reps?|sets?)\b/i

const RESIDUAL_CONJ_ASK_RE =
  /\b(?:comunque|inoltre|poi|anche|e\s+poi|e\s+anche|ma\s+(?:prima|poi|comunque)|also|and\s+(?:also|then)|plus|besides)\b/i

/** Router-specific cue phrases to strip when estimating residual. */
const ROUTER_CUE_STRIP = {
  translation:
    /\b(?:traduci(?:lo|la)?|translate(?:\s+this|\s+that)?|come\s+si\s+dice|come\s+si\s+traduce|how\s+do\s+you\s+say|rendilo\s+in|mettilo\s+in|in\s+(?:inglese|italiano|francese|spagnolo|tedesco|english|italian|french|spanish|german)|into\s+(?:english|italian|french|spanish|german))\b/gi,
  timer:
    /\b(?:imposta(?:\s+un)?\s+timer|set(?:\s+a)?\s+timer|avvia(?:\s+un)?\s+timer|start(?:\s+a)?\s+timer|timer\s+(?:di\s+)?\d+|timer\s+for\s+\d+|cancella(?:\s+il)?\s+timer|stop(?:\s+the)?\s+timer|aggiungi\s+\d+\s*minuti?\s+al\s+timer)\b/gi,
  reminder:
    /\b(?:ricordami|ricorda(?:mi)?\s+di|remind\s+me(?:\s+to)?|promemoria|crea(?:\s+un)?\s+promemoria|set(?:\s+a)?\s+reminder)\b/gi,
  calculator:
    /\b(?:quanto\s+fa|calcola(?:lo)?|calculate|compute|what(?:'?s|\s+is)\s+\d|risultato\s+di)\b/gi,
  units:
    /\b(?:converti(?:lo)?|convert(?:\s+this)?|in\s+(?:km|miglia|miles|kg|lbs|celsius|fahrenheit|°?\s*[cf])|da\s+\w+\s+a\s+\w+)\b/gi,
  weather:
    /\b(?:che\s+tempo(?:\s+fa)?|weather|meteo|previsioni|forecast|piove|is\s+it\s+raining|temperature(?:\s+in)?)\b/gi,
  briefing:
    /\b(?:fammi\s+il\s+briefing|briefing(?:\s+giornaliero)?|daily\s+briefing|riepilogo\s+(?:della\s+)?giornata|morning\s+brief)\b/gi,
}

/**
 * Strip detected capability span + cue phrases → residual conversational text.
 *
 * @param {string} fullText
 * @param {{ detectedSpan?: string|null, sourceText?: string|null, routerType?: MixedIntentRouterType }} [opts]
 * @returns {string}
 */
export function residualAfterCapabilityRemoval(fullText, opts = {}) {
  let r = String(fullText || '')
  const span = opts.detectedSpan || opts.sourceText || ''
  if (span && String(span).trim()) {
    const esc = escapeRegExp(String(span).trim())
    r = r.replace(new RegExp(`[«"“']\\s*${esc}\\s*[»"”']`, 'gi'), ' ')
    r = r.replace(new RegExp(esc, 'gi'), ' ')
  }
  const strip = opts.routerType ? ROUTER_CUE_STRIP[opts.routerType] : null
  if (strip) {
    r = r.replace(strip, ' ')
  }
  // Drop lone punctuation / empties left by removals
  r = r
    .replace(/[«»"'“”]/g, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s*[.,;:…?!]+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return r
}

/**
 * @param {string} residual
 * @returns {boolean}
 */
export function residualLooksLikeIndependentAsk(residual) {
  const t = fold(residual)
  if (!t) return false
  const letters = t.replace(/[^\p{L}\p{N}]+/gu, '')
  if (letters.length < 12) return false
  if (RESIDUAL_ASK_RE.test(t)) return true
  if (RESIDUAL_CONJ_ASK_RE.test(t) && letters.length >= 24) return true
  // Multiple interrogative clauses remaining
  if ((t.match(/\?/g) || []).length >= 1 && letters.length >= 20 && RESIDUAL_ASK_RE.test(t + ' ?')) {
    return true
  }
  // Long residual with decision-ish punctuation / alternatives
  if (letters.length >= 48 && /\b(?:o|or|vs\.?|versus)\b/i.test(t)) return true
  if (letters.length >= 80) return true
  return false
}

/**
 * @param {string} fullText
 * @param {string|null|undefined} detectedSpan
 */
function spanDominanceRatio(fullText, detectedSpan) {
  const full = fold(fullText)
  const span = fold(detectedSpan || '')
  if (!full) return 1
  if (!span) return 0
  return Math.min(1, span.length / Math.max(1, full.length))
}

/**
 * Decide whether a local router should claim the whole turn.
 *
 * @param {{
 *   routerType: MixedIntentRouterType
 *   fullText: string
 *   detectedSpan?: string|null
 *   sourceText?: string|null
 *   intentMetadata?: Record<string, unknown>|null
 * }} input
 * @returns {{ claimWholeTurn: boolean, reason: string, residual: string, residualAsk: boolean }}
 */
export function shouldLocalRouterClaimWholeTurn(input) {
  const fullText = String(input?.fullText || '')
  const routerType = input?.routerType || 'other'
  const detectedSpan = input?.detectedSpan || input?.sourceText || null

  if (!fold(fullText)) {
    return { claimWholeTurn: false, reason: 'empty', residual: '', residualAsk: false }
  }

  // Follow-ups / copy / retranslate with prior context: usually whole-turn (short).
  const meta = input?.intentMetadata || {}
  if (meta.followUp === true && fold(fullText).length <= 80) {
    return {
      claimWholeTurn: true,
      reason: 'short_follow_up',
      residual: '',
      residualAsk: false,
    }
  }

  // Residual after removing span + cues. Also evaluate cue-only residual: detectors
  // sometimes fold advice into expressionText/sourceText, which would erase the ask.
  const residual = residualAfterCapabilityRemoval(fullText, {
    detectedSpan,
    sourceText: input?.sourceText,
    routerType,
  })
  const residualCueOnly = residualAfterCapabilityRemoval(fullText, {
    detectedSpan: null,
    sourceText: null,
    routerType,
  })
  const residualAsk =
    residualLooksLikeIndependentAsk(residual) ||
    residualLooksLikeIndependentAsk(residualCueOnly)

  if (residualAsk) {
    return {
      claimWholeTurn: false,
      reason: 'residual_independent_ask',
      residual: residualLooksLikeIndependentAsk(residual) ? residual : residualCueOnly,
      residualAsk: true,
    }
  }

  // Detected operand tiny vs long message → likely aside even without strong residual cues
  const ratio = spanDominanceRatio(fullText, detectedSpan)
  const fullLen = fold(fullText).length
  if (detectedSpan && fullLen >= 120 && ratio < 0.18 && residual.replace(/[^\p{L}\p{N}]+/gu, '').length >= 40) {
    return {
      claimWholeTurn: false,
      reason: 'aside_span_in_long_turn',
      residual,
      residualAsk: false,
    }
  }

  // Multiple questions and capability span doesn't cover most of the turn
  const qMarks = (fullText.match(/\?/g) || []).length
  if (qMarks >= 2 && fullLen >= 60 && ratio < 0.45 && residual.replace(/[^\p{L}\p{N}]+/gu, '').length >= 24) {
    return {
      claimWholeTurn: false,
      reason: 'multiple_questions_mixed',
      residual,
      residualAsk: residualAsk,
    }
  }

  return {
    claimWholeTurn: true,
    reason: 'predominant_capability',
    residual,
    residualAsk: false,
  }
}

/**
 * Convenience: claim iff intent present AND whole-turn gate allows.
 *
 * @param {boolean} intentMatched
 * @param {Parameters<typeof shouldLocalRouterClaimWholeTurn>[0]} gateInput
 */
export function localRouterMayClaim(intentMatched, gateInput) {
  if (!intentMatched) {
    return { claimWholeTurn: false, reason: 'no_intent', residual: '', residualAsk: false }
  }
  return shouldLocalRouterClaimWholeTurn(gateInput)
}
