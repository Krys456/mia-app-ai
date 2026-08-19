/**
 * #317 — Deterministic rain evidence from HOURLY data (preferred over daily-only).
 */

import { isWetWeatherCode } from './wmo.js'
import { filterHourlyInWindow, resolveTimeWindow } from './time-windows.js'

/** Precipitation probability (%) considered meaningful for "likely rain". */
export const RAIN_LIKELY_PROB_THRESHOLD = 50

/** Precipitation amount (mm) considered meaningful in a window. */
export const RAIN_MEANINGFUL_MM = 0.2

/**
 * @param {Array<Record<string, unknown>>} hourlyRows
 * @returns {{
 *   maxProbability: number | null
 *   totalPrecipitationMm: number | null
 *   hoursAboveThreshold: number
 *   wetCodePresent: boolean
 *   peakHour: string | null
 *   evidenceStrength: 'none' | 'low' | 'moderate' | 'high'
 *   likely: boolean
 * }}
 */
export function analyzeRainInHourly(hourlyRows) {
  const rows = Array.isArray(hourlyRows) ? hourlyRows : []
  if (!rows.length) {
    return {
      maxProbability: null,
      totalPrecipitationMm: null,
      hoursAboveThreshold: 0,
      wetCodePresent: false,
      peakHour: null,
      evidenceStrength: 'none',
      likely: false,
    }
  }

  let maxProbability = null
  let totalMm = null
  let hoursAbove = 0
  let wetCodePresent = false
  let peakHour = null

  for (const row of rows) {
    const p = row.precipitationProbability
    if (typeof p === 'number' && Number.isFinite(p)) {
      if (maxProbability == null || p > maxProbability) {
        maxProbability = p
        peakHour = typeof row.time === 'string' ? row.time : peakHour
      }
      if (p >= RAIN_LIKELY_PROB_THRESHOLD) hoursAbove += 1
    }
    const mm = row.precipitationMm
    if (typeof mm === 'number' && Number.isFinite(mm)) {
      totalMm = (totalMm == null ? 0 : totalMm) + mm
    }
    if (isWetWeatherCode(row.weatherCode)) wetCodePresent = true
  }

  const likely =
    (maxProbability != null && maxProbability >= RAIN_LIKELY_PROB_THRESHOLD) ||
    (totalMm != null && totalMm >= RAIN_MEANINGFUL_MM) ||
    wetCodePresent

  let evidenceStrength = 'none'
  if (likely) {
    if (
      (maxProbability != null && maxProbability >= 70) ||
      (totalMm != null && totalMm >= 2) ||
      wetCodePresent
    ) {
      evidenceStrength = 'high'
    } else if (maxProbability != null && maxProbability >= RAIN_LIKELY_PROB_THRESHOLD) {
      evidenceStrength = 'moderate'
    } else {
      evidenceStrength = 'low'
    }
  } else if (maxProbability != null && maxProbability > 0) {
    evidenceStrength = 'low'
  }

  return {
    maxProbability,
    totalPrecipitationMm: totalMm,
    hoursAboveThreshold: hoursAbove,
    wetCodePresent,
    peakHour,
    evidenceStrength,
    likely,
  }
}

/**
 * Build rain evidence for an operation / timeHint against normalized weather.
 * @param {object} weather normalized payload
 * @param {{ operation?: string, timeHint?: string | null, timeZone?: string, now?: Date|number }} opts
 */
export function buildRainEvidence(weather, opts = {}) {
  const tz =
    opts.timeZone ||
    weather?.location?.timezone ||
    'UTC'
  const window = resolveTimeWindow({
    timeHint: opts.timeHint,
    operation: opts.operation || 'rain',
    timeZone: tz,
    now: opts.now,
  })
  const hourly = filterHourlyInWindow(weather?.hourly || [], window)
  const analysis = analyzeRainInHourly(hourly)

  // Fallback to daily if no hourly in window
  if (!hourly.length && Array.isArray(weather?.daily)) {
    const days = weather.daily.filter((d) => (window.dates || []).includes(d.date))
    let maxP = null
    let sumMm = null
    let wet = false
    for (const d of days) {
      if (typeof d.precipitationProbabilityMax === 'number') {
        maxP = maxP == null ? d.precipitationProbabilityMax : Math.max(maxP, d.precipitationProbabilityMax)
      }
      if (typeof d.precipitationSumMm === 'number') {
        sumMm = (sumMm == null ? 0 : sumMm) + d.precipitationSumMm
      }
      if (isWetWeatherCode(d.weatherCode)) wet = true
    }
    return {
      ...analyzeRainInHourly([]),
      maxProbability: maxP,
      totalPrecipitationMm: sumMm,
      wetCodePresent: wet,
      likely:
        (maxP != null && maxP >= RAIN_LIKELY_PROB_THRESHOLD) ||
        (sumMm != null && sumMm >= RAIN_MEANINGFUL_MM) ||
        wet,
      evidenceStrength:
        maxP != null && maxP >= 70 ? 'high' : maxP != null && maxP >= 50 ? 'moderate' : maxP != null ? 'low' : 'none',
      source: 'daily',
      window,
      hourlyCount: 0,
    }
  }

  return { ...analysis, source: 'hourly', window, hourlyCount: hourly.length }
}
