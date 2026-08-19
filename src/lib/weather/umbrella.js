/**
 * #317 — Deterministic umbrella recommendation (centralized, testable thresholds).
 *
 * Umbrella recommended if the relevant time window contains one or more of:
 * - precipitation probability >= UMBRELLA_PROB_THRESHOLD (50%)
 * - meaningful precipitation amount (>= RAIN_MEANINGFUL_MM)
 * - rain / shower / thunderstorm WMO code
 */

import { RAIN_LIKELY_PROB_THRESHOLD, RAIN_MEANINGFUL_MM, buildRainEvidence } from './rain.js'
import { isWetWeatherCode } from './wmo.js'

export const UMBRELLA_PROB_THRESHOLD = RAIN_LIKELY_PROB_THRESHOLD
export { RAIN_MEANINGFUL_MM }

/**
 * @param {ReturnType<typeof buildRainEvidence>} rainEvidence
 * @returns {{
 *   recommended: boolean
 *   confidence: 'weak' | 'moderate' | 'strong'
 *   reasons: string[]
 *   maxProbability: number | null
 *   peakHour: string | null
 * }}
 */
export function decideUmbrella(rainEvidence) {
  const reasons = []
  const maxP = rainEvidence?.maxProbability ?? null
  const mm = rainEvidence?.totalPrecipitationMm ?? null
  const wet = Boolean(rainEvidence?.wetCodePresent)
  const peakHour = rainEvidence?.peakHour ?? null

  if (maxP != null && maxP >= UMBRELLA_PROB_THRESHOLD) {
    reasons.push(`precip_prob_${maxP}`)
  }
  if (mm != null && mm >= RAIN_MEANINGFUL_MM) {
    reasons.push(`precip_mm_${mm}`)
  }
  if (wet) reasons.push('wet_wmo_code')

  const recommended = reasons.length > 0
  let confidence = 'weak'
  if (recommended) {
    if ((maxP != null && maxP >= 70) || wet || (mm != null && mm >= 2)) confidence = 'strong'
    else confidence = 'moderate'
  }

  return {
    recommended,
    confidence,
    reasons,
    maxProbability: maxP,
    peakHour,
  }
}

/**
 * @param {object} weather
 * @param {{ operation?: string, timeHint?: string | null, timeZone?: string, now?: Date|number }} opts
 */
export function buildUmbrellaEvidence(weather, opts = {}) {
  const rain = buildRainEvidence(weather, {
    ...opts,
    operation: opts.operation || 'umbrella',
  })
  const decision = decideUmbrella(rain)
  return { ...decision, rain }
}

/**
 * Quick check used by tests / helpers.
 * @param {{ precipitationProbability?: number|null, precipitationMm?: number|null, weatherCode?: number|null }} hour
 */
export function hourNeedsUmbrella(hour) {
  if (typeof hour?.precipitationProbability === 'number' && hour.precipitationProbability >= UMBRELLA_PROB_THRESHOLD) {
    return true
  }
  if (typeof hour?.precipitationMm === 'number' && hour.precipitationMm >= RAIN_MEANINGFUL_MM) {
    return true
  }
  if (isWetWeatherCode(hour?.weatherCode)) return true
  return false
}
