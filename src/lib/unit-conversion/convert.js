/**
 * #319 — Deterministic conversion through canonical bases + temperature affine formulas.
 */

import { sanitizeNumber } from '../calculator/format.js'
import { UNIT_ERROR, UNIT_LIMITS } from './limits.js'
import { getUnitById, resolveUnit } from './registry.js'

const ABS_ZERO = Object.freeze({
  kelvin: 0,
  celsius: -273.15,
  fahrenheit: -459.67,
})

/**
 * @param {number} value
 * @param {import('./registry.js').UnitDef} unit
 */
export function isBelowAbsoluteZero(value, unit) {
  if (!unit || unit.dimension !== 'temperature') return false
  if (unit.id === 'kelvin') return value < ABS_ZERO.kelvin
  if (unit.id === 'celsius') return value < ABS_ZERO.celsius
  if (unit.id === 'fahrenheit') return value < ABS_ZERO.fahrenheit
  return false
}

/**
 * Convert temperature via Kelvin as intermediate (affine, not multiplicative).
 * @param {number} value
 * @param {string} fromId
 * @param {string} toId
 */
export function convertTemperature(value, fromId, toId) {
  if (fromId === toId) {
    return { status: 'ok', result: sanitizeNumber(value), canonicalKelvin: toKelvin(value, fromId) }
  }
  if (isBelowAbsoluteZero(value, getUnitById(fromId))) {
    return { status: 'error', errorCode: UNIT_ERROR.absolute_zero }
  }
  const k = toKelvin(value, fromId)
  if (k == null || !Number.isFinite(k) || k < 0) {
    return { status: 'error', errorCode: UNIT_ERROR.absolute_zero }
  }
  const out = fromKelvin(k, toId)
  if (out == null || !Number.isFinite(out)) {
    return { status: 'error', errorCode: UNIT_ERROR.malformed }
  }
  return { status: 'ok', result: sanitizeNumber(out), canonicalKelvin: k }
}

function toKelvin(value, id) {
  if (id === 'kelvin') return value
  if (id === 'celsius') return value + 273.15
  if (id === 'fahrenheit') return ((value + 459.67) * 5) / 9
  return null
}

function fromKelvin(k, id) {
  if (id === 'kelvin') return k
  if (id === 'celsius') return k - 273.15
  if (id === 'fahrenheit') return (k * 9) / 5 - 459.67
  return null
}

/**
 * Linear dimension: value * toBase_source / toBase_target
 * @param {number} value
 * @param {import('./registry.js').UnitDef} source
 * @param {import('./registry.js').UnitDef} target
 */
export function convertLinear(value, source, target) {
  if (source.dimension !== target.dimension) {
    return { status: 'error', errorCode: UNIT_ERROR.incompatible }
  }
  if (source.temperature || target.temperature || source.toBase == null || target.toBase == null) {
    return { status: 'error', errorCode: UNIT_ERROR.malformed }
  }
  const canonical = value * source.toBase
  const result = canonical / target.toBase
  if (!Number.isFinite(canonical) || !Number.isFinite(result)) {
    return { status: 'error', errorCode: UNIT_ERROR.overflow }
  }
  return {
    status: 'ok',
    canonicalValue: sanitizeNumber(canonical),
    resultValue: sanitizeNumber(result),
  }
}

/**
 * @param {{
 *   value: number
 *   sourceUnit: string | import('./registry.js').UnitDef
 *   targetUnit: string | import('./registry.js').UnitDef
 * }} input
 */
export function convertUnits(input) {
  const value = Number(input.value)
  if (!Number.isFinite(value)) {
    return { status: 'error', errorCode: UNIT_ERROR.invalid_number }
  }
  if (Math.abs(value) > UNIT_LIMITS.maxValueAbs) {
    return { status: 'error', errorCode: UNIT_ERROR.overflow }
  }

  const source =
    typeof input.sourceUnit === 'string'
      ? resolveUnit(input.sourceUnit) || getUnitById(input.sourceUnit)
      : input.sourceUnit
  const target =
    typeof input.targetUnit === 'string'
      ? resolveUnit(input.targetUnit) || getUnitById(input.targetUnit)
      : input.targetUnit

  if (!source || !target) {
    return { status: 'error', errorCode: UNIT_ERROR.unknown_unit }
  }

  if (source.dimension !== target.dimension) {
    const powerEnergy =
      (source.dimension === 'power' && target.dimension === 'energy') ||
      (source.dimension === 'energy' && target.dimension === 'power')
    return {
      status: 'error',
      errorCode: powerEnergy ? UNIT_ERROR.power_energy : UNIT_ERROR.incompatible,
      dimension: null,
      sourceUnit: source.id,
      targetUnit: target.id,
    }
  }

  if (source.dimension === 'temperature') {
    const temp = convertTemperature(value, source.id, target.id)
    if (temp.status !== 'ok') {
      return {
        status: 'error',
        errorCode: temp.errorCode || UNIT_ERROR.malformed,
        dimension: 'temperature',
        sourceUnit: source.id,
        targetUnit: target.id,
      }
    }
    if (Math.abs(temp.result) > UNIT_LIMITS.maxResultAbs) {
      return { status: 'error', errorCode: UNIT_ERROR.overflow }
    }
    return {
      status: 'ok',
      dimension: 'temperature',
      inputValue: value,
      sourceUnit: source.id,
      targetUnit: target.id,
      sourceSymbol: source.symbol,
      targetSymbol: target.symbol,
      canonicalValue: temp.canonicalKelvin,
      resultValue: temp.result,
    }
  }

  const linear = convertLinear(value, source, target)
  if (linear.status !== 'ok') {
    return {
      status: 'error',
      errorCode: linear.errorCode,
      dimension: source.dimension,
      sourceUnit: source.id,
      targetUnit: target.id,
    }
  }
  if (Math.abs(linear.resultValue) > UNIT_LIMITS.maxResultAbs) {
    return { status: 'error', errorCode: UNIT_ERROR.overflow }
  }

  return {
    status: 'ok',
    dimension: source.dimension,
    inputValue: value,
    sourceUnit: source.id,
    targetUnit: target.id,
    sourceSymbol: source.symbol,
    targetSymbol: target.symbol,
    canonicalValue: linear.canonicalValue,
    resultValue: linear.resultValue,
  }
}
