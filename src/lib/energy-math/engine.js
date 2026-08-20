/**
 * #320 — Authoritative Energy Math formulas (canonical SI via #319).
 * E = P × t ; P = E / t ; t = E / P
 */

import { roundToDecimals, sanitizeNumber } from '../calculator/format.js'
import { ENERGY_MATH_ERROR, ENERGY_MATH_LIMITS } from './limits.js'
import { makeQuantity, preferDisplayQuantity, toCanonical } from './quantity.js'

/**
 * @param {{ power: import('./quantity.js').Quantity, time: import('./quantity.js').Quantity }} input
 */
export function computeEnergyFromPowerTime(input) {
  const p = toCanonical(input.power)
  const t = toCanonical(input.time)
  if (p.status !== 'ok' || t.status !== 'ok') {
    return { status: 'error', errorCode: ENERGY_MATH_ERROR.missing_quantity }
  }
  if (t.canonicalValue < 0 || p.canonicalValue < 0) {
    return { status: 'error', errorCode: ENERGY_MATH_ERROR.negative }
  }
  const joules = sanitizeNumber(p.canonicalValue * t.canonicalValue)
  if (!Number.isFinite(joules) || Math.abs(joules) > ENERGY_MATH_LIMITS.maxResultAbs) {
    return { status: 'error', errorCode: ENERGY_MATH_ERROR.overflow }
  }
  return {
    status: 'ok',
    operation: 'power_times_time',
    formula: 'E = P × t',
    canonicalInputs: { powerW: p.canonicalValue, timeS: t.canonicalValue },
    resultCanonical: joules,
    resultDimension: 'energy',
  }
}

/**
 * @param {{ energy: import('./quantity.js').Quantity, time: import('./quantity.js').Quantity }} input
 */
export function computePowerFromEnergyTime(input) {
  const e = toCanonical(input.energy)
  const t = toCanonical(input.time)
  if (e.status !== 'ok' || t.status !== 'ok') {
    return { status: 'error', errorCode: ENERGY_MATH_ERROR.missing_quantity }
  }
  if (e.canonicalValue < 0 || t.canonicalValue < 0) {
    return { status: 'error', errorCode: ENERGY_MATH_ERROR.negative }
  }
  if (t.canonicalValue === 0) {
    return { status: 'error', errorCode: ENERGY_MATH_ERROR.zero_time }
  }
  const watts = sanitizeNumber(e.canonicalValue / t.canonicalValue)
  if (!Number.isFinite(watts) || Math.abs(watts) > ENERGY_MATH_LIMITS.maxResultAbs) {
    return { status: 'error', errorCode: ENERGY_MATH_ERROR.overflow }
  }
  return {
    status: 'ok',
    operation: 'energy_over_time',
    formula: 'P = E / t',
    canonicalInputs: { energyJ: e.canonicalValue, timeS: t.canonicalValue },
    resultCanonical: watts,
    resultDimension: 'power',
  }
}

/**
 * @param {{ energy: import('./quantity.js').Quantity, power: import('./quantity.js').Quantity }} input
 */
export function computeTimeFromEnergyPower(input) {
  const e = toCanonical(input.energy)
  const p = toCanonical(input.power)
  if (e.status !== 'ok' || p.status !== 'ok') {
    return { status: 'error', errorCode: ENERGY_MATH_ERROR.missing_quantity }
  }
  if (e.canonicalValue < 0 || p.canonicalValue < 0) {
    return { status: 'error', errorCode: ENERGY_MATH_ERROR.negative }
  }
  if (p.canonicalValue === 0) {
    return { status: 'error', errorCode: ENERGY_MATH_ERROR.zero_power }
  }
  const seconds = sanitizeNumber(e.canonicalValue / p.canonicalValue)
  if (!Number.isFinite(seconds) || Math.abs(seconds) > ENERGY_MATH_LIMITS.maxResultAbs) {
    return { status: 'error', errorCode: ENERGY_MATH_ERROR.overflow }
  }
  return {
    status: 'ok',
    operation: 'energy_over_power',
    formula: 't = E / P',
    canonicalInputs: { energyJ: e.canonicalValue, powerW: p.canonicalValue },
    resultCanonical: seconds,
    resultDimension: 'time',
  }
}

/**
 * Round a prior result in its dimension (canonical) for follow-up.
 */
export function roundCanonicalResult(canonicalValue, decimals) {
  return roundToDecimals(canonicalValue, decimals)
}

export { makeQuantity, preferDisplayQuantity }
