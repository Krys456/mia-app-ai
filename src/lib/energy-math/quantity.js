/**
 * #320 — Quantity helpers over #319 Unit Conversion registry (no duplicated factors).
 */

import { sanitizeNumber } from '../calculator/format.js'
import { convertUnits } from '../unit-conversion/convert.js'
import { formatQuantity } from '../unit-conversion/format.js'
import { getUnitById, resolveUnit } from '../unit-conversion/registry.js'
import { ENERGY_MATH_ERROR, ENERGY_MATH_LIMITS } from './limits.js'

/** @typedef {{ value: number, unitId: string, dimension: 'power'|'energy'|'time' }} Quantity */

const CANONICAL = Object.freeze({
  power: 'w',
  energy: 'j',
  time: 's',
})

/**
 * @param {number} value
 * @param {string | import('../unit-conversion/registry.js').UnitDef} unit
 * @returns {Quantity | null}
 */
export function makeQuantity(value, unit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (Math.abs(value) > ENERGY_MATH_LIMITS.maxValueAbs) return null
  const u = typeof unit === 'string' ? resolveUnit(unit) || getUnitById(unit) : unit
  if (!u) return null
  if (u.dimension !== 'power' && u.dimension !== 'energy' && u.dimension !== 'time') return null
  return { value: sanitizeNumber(value), unitId: u.id, dimension: u.dimension }
}

/**
 * @param {Quantity} q
 * @returns {{ status: 'ok', quantity: Quantity, canonicalValue: number } | { status: 'error', errorCode: string }}
 */
export function toCanonical(q) {
  if (!q) return { status: 'error', errorCode: ENERGY_MATH_ERROR.missing_quantity }
  const targetId = CANONICAL[q.dimension]
  if (!targetId) return { status: 'error', errorCode: ENERGY_MATH_ERROR.incompatible }
  if (q.unitId === targetId) {
    return { status: 'ok', quantity: q, canonicalValue: q.value }
  }
  const conv = convertUnits({ value: q.value, sourceUnit: q.unitId, targetUnit: targetId })
  if (conv.status !== 'ok') {
    return { status: 'error', errorCode: conv.errorCode || ENERGY_MATH_ERROR.unknown_unit }
  }
  return {
    status: 'ok',
    quantity: q,
    canonicalValue: conv.resultValue,
  }
}

/**
 * Prefer human-friendly display units from a canonical SI value.
 * @param {number} canonicalValue W | J | s
 * @param {'power'|'energy'|'time'} dimension
 * @param {'it'|'en'} language
 */
export function preferDisplayQuantity(canonicalValue, dimension, language = 'it') {
  const abs = Math.abs(canonicalValue)
  let unitId = CANONICAL[dimension]

  if (dimension === 'energy') {
    // Prefer Wh below 1 kWh; kWh for household scale; MWh for large
    if (abs >= 3.6e9) unitId = 'mwh'
    else if (abs >= 3.6e6) unitId = 'kwh'
    else if (abs >= 3600) unitId = 'wh'
    else unitId = 'j'
  } else if (dimension === 'power') {
    if (abs >= 1e6) unitId = 'mw_power'
    else if (abs >= 1000) unitId = 'kw'
    else unitId = 'w'
  } else if (dimension === 'time') {
    if (abs >= 86400) unitId = 'd'
    else if (abs >= 3600) unitId = 'h'
    else if (abs >= 60) unitId = 'min'
    else if (abs >= 1) unitId = 's'
    else unitId = 'ms'
  }

  const conv = convertUnits({
    value: canonicalValue,
    sourceUnit: CANONICAL[dimension],
    targetUnit: unitId,
  })
  if (conv.status !== 'ok') {
    return {
      value: canonicalValue,
      unitId: CANONICAL[dimension],
      display: formatQuantity(canonicalValue, CANONICAL[dimension], language),
    }
  }
  return {
    value: conv.resultValue,
    unitId,
    display: formatQuantity(conv.resultValue, unitId, language),
  }
}

/**
 * Convert any energy result to a requested unit id.
 * @param {number} canonicalJ
 * @param {string} targetUnitId
 * @param {'it'|'en'} language
 */
export function formatCanonicalAs(canonicalValue, dimension, targetUnitId, language = 'it') {
  const conv = convertUnits({
    value: canonicalValue,
    sourceUnit: CANONICAL[dimension],
    targetUnit: targetUnitId,
  })
  if (conv.status !== 'ok') return null
  return {
    value: conv.resultValue,
    unitId: targetUnitId,
    display: formatQuantity(conv.resultValue, targetUnitId, language),
  }
}

export { CANONICAL, formatQuantity }
