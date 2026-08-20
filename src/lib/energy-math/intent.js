/**
 * #320 — Deterministic Energy Math intent (IT/EN).
 * Power × time → energy; energy/time → power; energy/power → time.
 */

import { parseNumberish } from '../calculator/percent.js'
import { foldAlias, matchUnitAtStart, resolveUnit } from '../unit-conversion/registry.js'
import { ENERGY_MATH_ERROR, ENERGY_MATH_LIMITS } from './limits.js'
import { makeQuantity } from './quantity.js'
import { analyzeOuterUserRequest } from '../outer-content-gate.js'

export function detectEnergyMathLanguage(text, fallback = 'it') {
  const t = foldAlias(text)
  const it = (
    t.match(/\b(consuma|produce|batteria|carico|potenza|energia|acceso|accesa|stufa|dispositivo|quanti|quanta|dura|ore|minuti)\b/g) ||
    []
  ).length
  const en = (
    t.match(/\b(consume|consumes|produce|produces|battery|load|average|energy|heater|device|hours?|minutes?|how\s+long|how\s+much)\b/g) ||
    []
  ).length
  if (en > it) return 'en'
  if (it > en) return 'it'
  return fallback
}

export function looksQuotedOrInjectedEnergy(raw) {
  const t = String(raw || '')
  if (/^["“«].*["”»]\s*$/s.test(t.trim())) return true
  if (/\b(ignore\s+(all\s+)?instructions|ignora\s+le\s+istruzioni)\b/i.test(t)) return true
  return false
}

function isMetaEnergyTalk(t) {
  if (
    /\b(cos[' ]?e\s+(un|una|il|la)\s+|what\s+is\s+(a|an)\s+|differenza\s+tra|difference\s+between|come\s+funziona|how\s+does|parlami|tell\s+me\s+about|scrivi\s+un\s+articolo|write\s+(an\s+)?article)\b/.test(
      t,
    )
  ) {
    return true
  }
  if (/\b(timer|svegliami|portami|navigate|che\s+tempo|forecast|previsioni)\b/.test(t)) {
    return true
  }
  return false
}

/**
 * Find all value+unit quantities of power|energy|time in text.
 * @param {string} raw
 * @returns {import('./quantity.js').Quantity[]}
 */
export function extractEnergyQuantities(raw) {
  const text = String(raw || '')
  /** @type {import('./quantity.js').Quantity[]} */
  const found = []
  const re = /([+-]?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?)\s*/gi
  let m
  while ((m = re.exec(text))) {
    const num = parseNumberish(m[1])
    if (!num) continue
    const after = foldAlias(text.slice(m.index + m[0].length))
    // skip filler words then unit
    const cleaned = after
      .replace(/^(da|di|of|a|an|the|il|la|un|una|per|for|over|in|con|with|al|alla)\s+/i, '')
      .trim()
    const um = matchUnitAtStart(cleaned)
    if (!um) continue
    if (um.unit.dimension !== 'power' && um.unit.dimension !== 'energy' && um.unit.dimension !== 'time') {
      continue
    }
    const q = makeQuantity(num.value, um.unit)
    if (q) found.push(q)
    // advance regex past unit to reduce double hits
    re.lastIndex = Math.max(re.lastIndex, m.index + m[0].length)
  }
  return found
}

function pickByDim(list, dim) {
  return list.filter((q) => q.dimension === dim)
}

/**
 * Classify Energy Math operation from quantities + cues (no length gate).
 * #330A — shape evidence must come BEFORE capability-specific validation.
 * @returns {null | {
 *   operation: 'power_times_time'|'energy_over_time'|'energy_over_power'
 *   power?: import('./quantity.js').Quantity
 *   energy?: import('./quantity.js').Quantity
 *   time?: import('./quantity.js').Quantity
 *   assumptionMode?: string
 * }}
 */
export function classifyEnergyMathComposition(raw) {
  const original = String(raw || '').trim()
  if (!original) return null

  const t = foldAlias(original)
  const qs = extractEnergyQuantities(original)
  const powers = pickByDim(qs, 'power')
  const energies = pickByDim(qs, 'energy')
  const times = pickByDim(qs, 'time')

  const wantsRuntime =
    /\b(quanto\s+dura|how\s+long|dura|last|runtime|autonomia|funzionare)\b/.test(t) ||
    (/\b(batteria|battery)\b/.test(t) && /\b(carico|load)\b/.test(t))

  const wantsAvgPower =
    /\b(potenza\s+media|average\s+power|potenza\s+media\s+assorbita|kW\s+medi|kw\s+medi)\b/.test(t) ||
    (energies.length >= 1 &&
      times.length >= 1 &&
      powers.length === 0 &&
      /\b(in|over|su|durante|in\s+)\b/.test(t) &&
      !wantsRuntime)

  const hasMultiplyCue =
    /[×*]/.test(original) ||
    /\b(per|for|acceso|accesa|acceso\s+per|accesa\s+per|over)\b/.test(t) ||
    /\b(consuma|produce|energia|energy|kwh|wh)\b/.test(t)

  // Explicit: N power (per|for|×) N time
  if (powers.length >= 1 && times.length >= 1 && energies.length === 0 && !wantsRuntime) {
    if (hasMultiplyCue || /[×*]/.test(original) || /\b(per|for)\b/.test(t)) {
      return {
        operation: 'power_times_time',
        power: powers[0],
        time: times[0],
        assumptionMode: detectAssumptionMode(t),
      }
    }
  }

  // Power + time + optional energy ask (stufa … kWh)
  if (powers.length >= 1 && times.length >= 1 && !wantsRuntime && !wantsAvgPower) {
    if (
      hasMultiplyCue ||
      /\b(consuma|produce|quanti|quanta|how\s+much|wh|kwh)\b/.test(t)
    ) {
      return {
        operation: 'power_times_time',
        power: powers[0],
        time: times[0],
        assumptionMode: detectAssumptionMode(t),
      }
    }
  }

  // Average power: energy + time
  if (energies.length >= 1 && times.length >= 1 && (wantsAvgPower || (powers.length === 0 && /\b(in|over)\b/.test(t)))) {
    // Avoid stealing pure unit conversion "2 kWh in J" (energy + energy/other non-time)
    if (times.length >= 1) {
      return {
        operation: 'energy_over_time',
        energy: energies[0],
        time: times[0],
        assumptionMode: 'average_power',
      }
    }
  }

  // Runtime: energy + power
  if (energies.length >= 1 && powers.length >= 1 && (wantsRuntime || times.length === 0)) {
    if (wantsRuntime || /\b(batteria|battery|carico|load|last|dura)\b/.test(t) || times.length === 0) {
      // If also has time and no runtime cue, prefer energy over time when "in/over"
      if (!wantsRuntime && times.length >= 1 && /\b(in|over)\b/.test(t) && !/\b(batteria|battery|carico|load)\b/.test(t)) {
        return {
          operation: 'energy_over_time',
          energy: energies[0],
          time: times[0],
          assumptionMode: 'average_power',
        }
      }
      return {
        operation: 'energy_over_power',
        energy: energies[0],
        power: powers[0],
        assumptionMode: 'ideal_runtime',
      }
    }
  }

  // Compact: "2 kW × 3 h" / "2 kW per 3 ore" already covered
  // "1.5 kW per 8 ore" — powers+times+per
  if (powers.length === 1 && times.length === 1 && /\b(per|for)\b/.test(t)) {
    return {
      operation: 'power_times_time',
      power: powers[0],
      time: times[0],
      assumptionMode: detectAssumptionMode(t),
    }
  }

  return null
}

/**
 * True when utterance has credible Energy Math shape (quantities + cues).
 * Does not enforce length — used so long generic chat never becomes energy-math.
 */
export function looksEnergyMathShaped(raw) {
  return Boolean(classifyEnergyMathComposition(raw)?.operation)
}

/**
 * Classify operation from quantities + cues.
 * #330A: length / parser limits apply ONLY after positive Energy Math shape.
 * @returns {null | {
 *   operation: 'power_times_time'|'energy_over_time'|'energy_over_power'
 *   power?: import('./quantity.js').Quantity
 *   energy?: import('./quantity.js').Quantity
 *   time?: import('./quantity.js').Quantity
 *   assumptionMode?: string
 *   errorCode?: string
 * }}
 */
export function parseEnergyMathComposition(raw) {
  const original = String(raw || '').trim()
  if (!original) return null

  const shaped = classifyEnergyMathComposition(original)
  if (!shaped || !shaped.operation) return null

  // Option A: clearly Energy Math but over deterministic parser budget → capability error
  if (original.length > ENERGY_MATH_LIMITS.maxRawLength) {
    return { errorCode: ENERGY_MATH_ERROR.too_long }
  }

  return shaped
}

function detectAssumptionMode(t) {
  if (/\b(pannello|fotovolta|panel|pv|solar)\b/.test(t)) return 'ideal_constant_power_pv_math'
  if (/\b(batteria|battery)\b/.test(t)) return 'ideal_runtime'
  if (/\b(stufa|dispositivo|heater|device|appliance|acceso|accesa)\b/.test(t)) {
    return 'constant_load'
  }
  return 'constant_power'
}

/**
 * Follow-ups against activeEnergyMathContext.
 */
export function detectEnergyMathFollowUp(raw, opts = {}) {
  if (!opts.hasEnergyContext) return false
  const stripped = String(raw || '')
    .trim()
    .replace(/^(ok|okay|va bene|allora|quindi|perfetto|e|and)[,.]?\s+/i, '')
    .replace(/[.!?]+$/g, '')
    .trim()
  const t = foldAlias(stripped)

  if (looksQuotedOrInjectedEnergy(raw) || isMetaEnergyTalk(t)) return false

  if (
    /\b(copia\s+(il\s+)?risultato(?:\s+energetico)?|copy\s+(the\s+)?(?:energy\s+)?result)\b/.test(t) ||
    /^\s*(copia\s+il\s+risultato|copy\s+(the\s+)?result)\s*$/i.test(stripped)
  ) {
    return { kind: 'copy_result', operation: 'copy_result' }
  }

  if (
    /^\s*(spiegami(?:\s+il\s+calcolo)?|mostrami\s+il\s+calcolo|show\s+(?:me\s+)?(?:the\s+)?(?:calculation|steps)|explain(?:\s+the\s+calculation)?)\s*$/i.test(
      stripped,
    ) ||
    /\b(spiegami\s+il\s+calcolo|show\s+calculation|explain\s+the\s+calculation)\b/.test(t)
  ) {
    return { kind: 'explain', operation: 'explain' }
  }

  // E per 8 ore? / And for 8 hours?
  const forTime = t.match(/^(?:e\s+)?(?:per|for)\s+(.+)$/)
  if (forTime) {
    const um = extractEnergyQuantities(forTime[1])
    const timeQ = um.find((q) => q.dimension === 'time')
    if (timeQ) return { kind: 'retarget_time', operation: 'retarget_time', time: timeQ }
  }

  // E con 500 W?
  const withPower = t.match(/^(?:e\s+)?(?:con|with|at)\s+(.+)$/)
  if (withPower) {
    const um = extractEnergyQuantities(withPower[1])
    const powerQ = um.find((q) => q.dimension === 'power')
    if (powerQ) return { kind: 'retarget_power', operation: 'retarget_power', power: powerQ }
  }

  // Adesso in Wh / Now in kWh
  const nowIn = t.match(/^(?:adesso\s+in|ora\s+in|now\s+in|in)\s+(.+)$/)
  if (nowIn) {
    const unit = resolveUnit(nowIn[1].trim()) || matchUnitAtStart(foldAlias(nowIn[1].trim()))?.unit
    if (unit && (unit.dimension === 'energy' || unit.dimension === 'power' || unit.dimension === 'time')) {
      return { kind: 'retarget_unit', operation: 'retarget_unit', targetUnitId: unit.id, targetDimension: unit.dimension }
    }
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
 *   intent: 'energy-math' | 'none'
 *   language: 'it'|'en'
 *   operation?: string
 *   power?: import('./quantity.js').Quantity
 *   energy?: import('./quantity.js').Quantity
 *   time?: import('./quantity.js').Quantity
 *   assumptionMode?: string
 *   followUp?: boolean
 *   followUpKind?: string
 *   targetUnitId?: string
 *   targetDimension?: string
 *   decimals?: number
 *   failureCode?: string | null
 * }}
 */
export function detectEnergyMathIntent(raw, opts = {}) {
  const text = String(raw || '').trim()
  if (!text) return { intent: 'none', language: 'it' }

  const language = detectEnergyMathLanguage(text, opts.languageHint === 'en' ? 'en' : 'it')

  // #330A3 — CONTENT IS NOT AUTHORIZATION
  const outer = analyzeOuterUserRequest(text)
  if (outer.contentIsData) {
    return { intent: 'none', language, failureCode: 'content_is_data' }
  }

  if (looksQuotedOrInjectedEnergy(text)) {
    return { intent: 'none', language, failureCode: 'quoted_or_injected' }
  }

  const t = foldAlias(text)
  if (isMetaEnergyTalk(t)) {
    return { intent: 'none', language, failureCode: 'meta_or_non_energy' }
  }

  const follow = detectEnergyMathFollowUp(text, { hasEnergyContext: true })
  if (follow) {
    if (opts.hasEnergyContext) {
      return {
        intent: 'energy-math',
        language,
        operation: follow.operation,
        followUp: true,
        followUpKind: follow.kind,
        time: follow.time,
        power: follow.power,
        targetUnitId: follow.targetUnitId,
        targetDimension: follow.targetDimension,
        decimals: follow.decimals,
      }
    }
    return { intent: 'none', language, failureCode: 'no_context' }
  }

  // #330A — never claim energy-math merely because a length/parser check failed.
  // Intent evidence (shape) must precede capability-specific validation.
  const parsed = parseEnergyMathComposition(text)
  if (parsed && parsed.errorCode) {
    // errorCode is only returned after positive shape match
    return {
      intent: 'energy-math',
      language,
      operation: 'compose',
      failureCode: parsed.errorCode,
    }
  }
  if (parsed && parsed.operation) {
    return {
      intent: 'energy-math',
      language,
      operation: parsed.operation,
      power: parsed.power,
      energy: parsed.energy,
      time: parsed.time,
      assumptionMode: parsed.assumptionMode || 'constant_power',
      followUp: false,
    }
  }

  return { intent: 'none', language }
}
