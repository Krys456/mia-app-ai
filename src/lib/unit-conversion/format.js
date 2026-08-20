/**
 * #319 — Display formatting for unit conversions (reuses #318 sanitize/format).
 */

import { formatDisplayResult, roundToDecimals, sanitizeNumber } from '../calculator/format.js'
import { UNIT_LIMITS } from './limits.js'
import { getUnitById } from './registry.js'

/**
 * Sensible display precision without destroying follow-up canonical values.
 * @param {number} n
 * @param {'it'|'en'} language
 * @param {number} [maxDecimals]
 */
export function formatConversionNumber(n, language = 'it', maxDecimals = UNIT_LIMITS.displayMaxDecimals) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n)
  const cleaned = sanitizeNumber(n)
  if (Number.isInteger(cleaned) || Math.abs(cleaned - Math.round(cleaned)) < 1e-12) {
    return formatDisplayResult(Math.round(cleaned), { language })
  }
  const rounded = roundToDecimals(cleaned, maxDecimals)
  return formatDisplayResult(rounded, { language })
}

/**
 * @param {number} value
 * @param {string} unitId
 * @param {'it'|'en'} language
 */
export function formatQuantity(value, unitId, language = 'it') {
  const unit = getUnitById(unitId)
  const num = formatConversionNumber(value, language)
  const sym = unit?.symbol || unitId
  return `${num} ${sym}`
}
