/**
 * #319 — Deterministic Unit Conversion intent (IT/EN).
 * Only explicit USER conversion turns — never prose / definitions / Timer / Weather.
 */

import { parseNumberish } from '../calculator/percent.js'
import { UNIT_ERROR, UNIT_LIMITS } from './limits.js'
import {
  ALIAS_LIST,
  findUnitInText,
  foldAlias,
  isAmbiguousStoragePhrase,
  matchUnitAtStart,
  resolveUnit,
} from './registry.js'

export function detectUnitConversionLanguage(text, fallback = 'it') {
  const t = foldAlias(text)
  const it = (t.match(/\b(converti|trasforma|quanto\s+sono|chilometr|libbr|miglia|gradi|litri|minuti|pollici|piedi)\b/g) || [])
    .length
  const en = (t.match(/\b(convert|how\s+many|miles|pounds|inches|feet|gallons|minutes)\b/g) || [])
    .length
  if (en > it) return 'en'
  if (it > en) return 'it'
  return fallback
}

export function looksQuotedOrInjectedUnit(raw) {
  const t = String(raw || '')
  if (/^["“«].*["”»]\s*$/s.test(t.trim())) return true
  if (/\b(ignore\s+(all\s+)?instructions|ignora\s+le\s+istruzioni)\b/i.test(t)) return true
  return false
}

function isMetaOrNonConversion(t) {
  if (
    /\b(cos[' ]?e\s+(un|una|il|la)\s+|what\s+is\s+a\s+|perche|perché|why\s+(do|does|are)|parliamo|let'?s\s+talk|scrivi\s+una\s+(frase|storia)|write\s+a\s+(sentence|story))\b/.test(
      t,
    )
  ) {
    return true
  }
  // Narrative / activity — not conversion
  if (/\b(ho\s+corso|i\s+ran|i\s+drove|percorre|percorreva|una\s+macchina\s+percorre)\b/.test(t)) {
    return true
  }
  // Timer must stay Timer
  if (/\b(timer|svegliami|imposta\s+un\s+timer|set\s+a\s+timer|avvia\s+timer)\b/.test(t)) {
    return true
  }
  // Navigation / phone maps
  if (/\b(portami|navigate|directions|indicazioni|chiama|call|sms|whatsapp)\b/.test(t)) {
    return true
  }
  // Weather without conversion target
  if (
    /\b(che\s+tempo|what'?s\s+the\s+weather|previsioni|forecast|piover|ombrello|umbrella)\b/.test(t)
  ) {
    return true
  }
  if (
    /\b(che\s+temperatura|what(?:'s|\s+is)\s+the\s+temperature|fa\s+\d+\s*°?\s*[cf]\b|far[aà]\s+(freddo|caldo))\b/.test(
      t,
    ) &&
    !/\b(in|to|a)\b/.test(t)
  ) {
    return true
  }
  return false
}

function hasConversionCue(t) {
  return (
    /\b(converti|convert|trasforma|transform|quanto\s+sono|how\s+many|in|to|into|da)\b/.test(t) ||
    /\b(da)\b.+\b(a)\b/.test(t)
  )
}

/**
 * #320 — Multi-quantity Energy Math compositions must not be claimed as Unit Conversion.
 * Pure convert pairs (same dimension) still proceed.
 */
function looksEnergyMathComposition(t) {
  const hasPower = /\b(\d+(?:[.,]\d+)?)\s*(kw|mw|w|watt|kilowatt|megawatt)\b/.test(t)
  const hasEnergy = /\b(\d+(?:[.,]\d+)?)\s*(kwh|mwh|wh|joule|joules|mj|kj)\b/.test(t)
  const hasTime = /\b(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|ore|ora|min|minuti|minute|minutes|secondi|seconds|giorni|days?)\b/.test(
    t,
  )
  const dims = [hasPower, hasEnergy, hasTime].filter(Boolean).length
  if (dims < 2) return false
  // Composition / average-power / runtime cues
  if (
    /\b(per|for|potenza\s+media|average\s+power|quanto\s+dura|how\s+long|batteria|battery|carico|load|consuma|produce|acceso|accesa)\b/.test(
      t,
    )
  ) {
    return true
  }
  // "12 kWh in 6 ore" — energy + time with "in/over" is average power, not unit conversion
  if (hasEnergy && hasTime && /\b(in|over|su)\b/.test(t)) return true
  if (hasPower && hasTime && /[×*]/.test(t)) return true
  return false
}

/**
 * Extract number + unit from a fragment like "10 km" or "25 °C" or "gradi celsius" after number.
 * @param {string} folded
 * @returns {{ value: number, unit: import('./registry.js').UnitDef, rest: string } | null}
 */
export function parseValueUnit(folded) {
  const t = String(folded || '').trim()
  if (!t) return null

  // Number first
  const numMatch = t.match(/^([+-]?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?)\s*(.*)$/i)
  if (numMatch) {
    const parsed = parseNumberish(numMatch[1])
    if (!parsed) return null
    let rest = numMatch[2].trim()
    // Optional "gradi" before unit name
    rest = rest.replace(/^(gradi|grado|degrees?|degree)\s+/i, '')
    const um = matchUnitAtStart(rest)
    if (!um) return null
    return { value: parsed.value, unit: um.unit, rest: um.rest }
  }
  return null
}

/**
 * Try to pull source/target units and value from full utterance.
 * @returns {null | {
 *   value: number
 *   source: import('./registry.js').UnitDef
 *   target: import('./registry.js').UnitDef
 *   ambiguousStorage?: boolean
 * }}
 */
/**
 * #330A — Apply capability length limit only after a conversion pair is established.
 * Parser rejection alone must never invent unit-conversion intent.
 * @param {{ value: number, source: import('./registry.js').UnitDef, target: import('./registry.js').UnitDef, ambiguousStorage?: boolean }} pair
 * @param {string} original
 */
function finalizeConversionPair(pair, original) {
  if (String(original || '').trim().length > UNIT_LIMITS.maxRawLength) {
    return { errorCode: UNIT_ERROR.too_long }
  }
  return pair
}

export function parseConversionPair(raw) {
  const original = String(raw || '').trim()
  if (!original) return null

  let t = foldAlias(original)
  t = t.replace(/[¿?¡!]+/g, ' ').replace(/\s+/g, ' ').trim()

  // Strip leading convert cues
  t = t
    .replace(/^(converti|convert|trasforma|transform|calcola)\s+(?:da\s+)?/i, '')
    .replace(/^quanto\s+sono\s+/i, '')
    .replace(/^how\s+many\s+/i, '')
    .trim()

  // Ambiguous storage shorthand ("1 giga in mega") without explicit GB/GiB tokens
  // Shape already established → length may still reject.
  if (
    isAmbiguousStoragePhrase(t) &&
    !/\b(gb|gib|mb|mib|kb|kib|tb|tib|gigabyte|gibibyte|megabyte|mebibyte)\b/.test(t)
  ) {
    if (original.length > UNIT_LIMITS.maxRawLength) {
      return { errorCode: UNIT_ERROR.too_long }
    }
    return { errorCode: UNIT_ERROR.ambiguous_storage }
  }

  // Pattern: How many TARGET is VALUE SOURCE / Quanto sono VALUE SOURCE in TARGET
  // Already stripped "how many" → "miles is 10 km"
  let howMany = t.match(/^(.+?)\s+is\s+(.+)$/i)
  if (howMany) {
    const targetHit = matchUnitAtStart(howMany[1].trim())
    const srcHit = parseValueUnit(howMany[2].trim())
    if (targetHit && srcHit) {
      return finalizeConversionPair(
        { value: srcHit.value, source: srcHit.unit, target: targetHit.unit },
        original,
      )
    }
  }

  // Pattern: Da VALUE UNIT a UNIT / From VALUE UNIT to UNIT
  let daA = t.match(/^(?:da|from)\s+(.+?)\s+(?:a|to|in)\s+(.+)$/i)
  if (daA) {
    const srcHit = parseValueUnit(daA[1].trim())
    const tgt = matchUnitAtStart(daA[2].trim())
    if (srcHit && tgt) {
      return finalizeConversionPair(
        { value: srcHit.value, source: srcHit.unit, target: tgt.unit },
        original,
      )
    }
  }

  // Pattern: VALUE UNIT (in|to|into|a) UNIT
  // Also: VALUE gradi Celsius in Fahrenheit
  const sep = t.match(
    /^(.+?)\s+(?:in|to|into|a)\s+(.+)$/i,
  )
  if (sep) {
    const left = sep[1].trim()
    const right = sep[2].trim().replace(/^(gradi|grado|degrees?|degree)\s+/i, '')
    const srcHit = parseValueUnit(left.replace(/^(gradi|grado|degrees?|degree)\s+/i, ''))
    // left may be "25 gradi celsius" — parseValueUnit after removing leading gradi on rest
    let src = srcHit
    if (!src) {
      // Try "25" + "gradi celsius"
      const m = left.match(/^([+-]?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?)\s+(.+)$/i)
      if (m) {
        const n = parseNumberish(m[1])
        let unitPart = m[2].replace(/^(gradi|grado|degrees?|degree)\s+/i, '').trim()
        const um = matchUnitAtStart(unitPart)
        if (n && um) src = { value: n.value, unit: um.unit, rest: um.rest }
      }
    }
    const tgt = matchUnitAtStart(right)
    if (src && tgt) {
      return finalizeConversionPair(
        { value: src.value, source: src.unit, target: tgt.unit },
        original,
      )
    }
  }

  // Pattern: VALUE UNIT UNIT (juxtaposition rare) — skip

  // Pattern: Convert VALUE UNIT to UNIT already stripped convert → same as sep

  // Fallback: find number, then two unit mentions
  const numEverywhere = original.match(/([+-]?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?)/i)
  if (numEverywhere && hasConversionCue(t)) {
    const n = parseNumberish(numEverywhere[1])
    if (n) {
      // Remove number and find two units
      let work = foldAlias(original.replace(numEverywhere[1], ' '))
      work = work
        .replace(/\b(converti|convert|trasforma|quanto\s+sono|how\s+many|in|to|into|da|a|is|gradi|grado|degrees?|degree)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      const u1 = matchUnitAtStart(work)
      if (u1) {
        const u2 = matchUnitAtStart(u1.rest)
        if (u2) {
          return finalizeConversionPair(
            { value: n.value, source: u1.unit, target: u2.unit },
            original,
          )
        }
      }
    }
  }

  return null
}

/**
 * Follow-ups against activeConversionContext.
 * Semantics:
 * - "E 25?" → same source/target units, new input value 25
 * - "Adesso in metri" → take current resultValue/targetUnit as quantity, convert to new unit
 * - "Raddoppialo" → double inputValue, same pair
 * - "Arrotonda a N decimali" → round result display/value
 * - "Copia il risultato" → copy displayResult
 */
export function detectUnitFollowUp(raw, opts = {}) {
  if (!opts.hasConversionContext) return false
  const stripped = String(raw || '')
    .trim()
    .replace(/^(ok|okay|va bene|allora|quindi|perfetto|e|and)[,.]?\s+/i, '')
    .replace(/[.!?]+$/g, '')
    .trim()
  const t = foldAlias(stripped)

  if (looksQuotedOrInjectedUnit(raw) || isMetaOrNonConversion(t)) return false

  if (
    /\b(copia\s+il\s+risultato|copy\s+the\s+result|copia\s+risultato)\b/.test(t) ||
    /^\s*(copia\s+il\s+risultato|copy\s+(the\s+)?result)\s*$/i.test(stripped)
  ) {
    return { kind: 'copy_result', operation: 'copy_result' }
  }

  // E 25? / And 25?
  const andVal = stripped.match(/^(?:e|and)?\s*([+-]?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?)\s*\??\s*$/i)
  if (andVal) {
    const n = parseNumberish(andVal[1])
    if (n) return { kind: 'same_pair', operation: 'same_pair', value: n.value }
  }

  // Adesso in X / Now in X / In X (bare unit when context)
  const nowIn = t.match(/^(?:adesso\s+in|ora\s+in|now\s+in|in)\s+(.+)$/)
  if (nowIn) {
    const um = matchUnitAtStart(nowIn[1].trim())
    if (um) return { kind: 'retarget', operation: 'retarget', targetUnitId: um.unit.id }
  }

  if (/^(?:raddoppialo|raddoppiala|raddoppia|double\s+it|duplicate\s+it)$/.test(t)) {
    return { kind: 'double', operation: 'double' }
  }

  const round = t.match(
    /^(?:arrotondalo|arrotonda(?:lo)?|round\s+it)\s+(?:a|to)\s+(\d+)\s*(?:decimali|decimal\s+places?|decimals?)?$/,
  )
  if (round) {
    return { kind: 'round', operation: 'round', decimals: Number(round[1]) }
  }

  return false
}

/**
 * @returns {{
 *   intent: 'unit-conversion' | 'none'
 *   language: 'it'|'en'
 *   operation?: string
 *   value?: number
 *   sourceUnitId?: string
 *   targetUnitId?: string
 *   followUp?: boolean
 *   followUpKind?: string
 *   decimals?: number
 *   failureCode?: string | null
 * }}
 */
export function detectUnitConversionIntent(raw, opts = {}) {
  const text = String(raw || '').trim()
  if (!text) return { intent: 'none', language: 'it' }

  const language = detectUnitConversionLanguage(text, opts.languageHint === 'en' ? 'en' : 'it')

  if (looksQuotedOrInjectedUnit(text)) {
    return { intent: 'none', language, failureCode: 'quoted_or_injected' }
  }

  const t = foldAlias(text)
  if (isMetaOrNonConversion(t)) {
    return { intent: 'none', language, failureCode: 'meta_or_non_conversion' }
  }

  // #320 — defer Energy Math compositions (power×time, average power, runtime)
  if (looksEnergyMathComposition(t)) {
    return { intent: 'none', language, failureCode: 'deferred_energy_math' }
  }

  // Follow-ups only when context available (caller sets hasConversionContext)
  const follow = detectUnitFollowUp(text, { hasConversionContext: true })
  if (follow) {
    if (opts.hasConversionContext) {
      return {
        intent: 'unit-conversion',
        language,
        operation: follow.operation,
        followUp: true,
        followUpKind: follow.kind,
        value: follow.value,
        targetUnitId: follow.targetUnitId,
        decimals: follow.decimals,
      }
    }
    // Without context, do not steal Calculator's "Copia" / round — except we only
    // claim follow-ups when context exists. Bare "E 25?" without context → none.
    return { intent: 'none', language, failureCode: 'no_context' }
  }

  if (!hasConversionCue(t) && !/\b(gradi|celsius|fahrenheit|°\s*[cf])\b/.test(t)) {
    // Still allow "25 C to F" style via parseConversionPair if sep present
    if (!/\b(in|to|into|a)\b/.test(t)) {
      return { intent: 'none', language }
    }
  }

  // #330A — errorCode (incl. too_long) only after positive conversion pair/shape.
  const pair = parseConversionPair(text)
  if (pair && pair.errorCode) {
    return {
      intent: 'unit-conversion',
      language,
      operation: 'convert',
      failureCode: pair.errorCode,
    }
  }
  if (pair && pair.source && pair.target && typeof pair.value === 'number') {
    return {
      intent: 'unit-conversion',
      language,
      operation: 'convert',
      value: pair.value,
      sourceUnitId: pair.source.id,
      targetUnitId: pair.target.id,
      followUp: false,
    }
  }

  // Clear conversion-shaped utterance that failed to parse → still claim for honest error.
  // #330A — require STRONG conversion evidence. Bare Italian "in"/"a"/"da" + a time unit
  // (e.g. "22 ore … in una dieta") must NOT steal generic chat.
  const strongConvertCue =
    /\b(converti|convert|trasforma|transform|quanto\s+sono|how\s+many)\b/.test(t)
  const tempConvertShape =
    /\b(gradi|celsius|fahrenheit|°\s*[cf])\b/.test(t) && /\b(in|to|into|a)\b/.test(t)
  if (
    (strongConvertCue || tempConvertShape) &&
    /\d/.test(t) &&
    (findUnitInText(t) || /\b(km|mi|kg|lb|celsius|fahrenheit|kwh|kw|mb|gb)\b/.test(t))
  ) {
    return {
      intent: 'unit-conversion',
      language,
      operation: 'convert',
      failureCode: UNIT_ERROR.malformed,
    }
  }

  return { intent: 'none', language }
}

// Re-export helpers used by tests
export { resolveUnit, ALIAS_LIST, foldAlias }
