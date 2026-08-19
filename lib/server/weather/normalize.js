/**
 * #317 — Normalize Open-Meteo forecast payloads → provider-independent schema.
 * Never invent missing fields as zeros.
 */

import { describeWmoCode } from './wmo.js'
import { WEATHER_ATTRIBUTION } from './config.js'

function numOrUndef(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return undefined
}

function boolOrUndef(v) {
  if (v === 0 || v === 1) return Boolean(v)
  if (typeof v === 'boolean') return v
  return undefined
}

/**
 * @param {object} raw Open-Meteo forecast JSON
 * @param {{
 *   name: string
 *   country?: string | null
 *   admin1?: string | null
 *   latitude: number
 *   longitude: number
 *   timezone: string
 *   language?: 'it'|'en'
 * }} location
 */
export function normalizeOpenMeteoForecast(raw, location) {
  if (!raw || typeof raw !== 'object') {
    return {
      status: 'provider_error',
      failureCode: 'malformed_response',
      attribution: WEATHER_ATTRIBUTION,
    }
  }

  const lang = location.language === 'en' ? 'en' : 'it'
  const tz = typeof raw.timezone === 'string' && raw.timezone ? raw.timezone : location.timezone

  /** @type {Record<string, unknown> | null} */
  let current = null
  if (raw.current && typeof raw.current === 'object') {
    const c = raw.current
    const code = numOrUndef(c.weather_code)
    const desc = describeWmoCode(code, lang)
    current = {
      temperatureC: numOrUndef(c.temperature_2m),
      apparentTemperatureC: numOrUndef(c.apparent_temperature),
      humidityPercent: numOrUndef(c.relative_humidity_2m),
      precipitationMm: numOrUndef(c.precipitation),
      weatherCode: desc.weatherCode,
      description: desc.description,
      windSpeedKmh: numOrUndef(c.wind_speed_10m),
      windDirectionDeg: numOrUndef(c.wind_direction_10m),
      isDay: boolOrUndef(c.is_day),
    }
    // Drop undefined keys
    current = stripUndef(current)
  }

  const hourly = []
  const h = raw.hourly
  if (h && Array.isArray(h.time)) {
    for (let i = 0; i < h.time.length; i += 1) {
      const code = numOrUndef(Array.isArray(h.weather_code) ? h.weather_code[i] : undefined)
      const desc = describeWmoCode(code, lang)
      const row = stripUndef({
        time: h.time[i],
        temperatureC: numOrUndef(Array.isArray(h.temperature_2m) ? h.temperature_2m[i] : undefined),
        precipitationProbability: numOrUndef(
          Array.isArray(h.precipitation_probability) ? h.precipitation_probability[i] : undefined,
        ),
        precipitationMm: numOrUndef(Array.isArray(h.precipitation) ? h.precipitation[i] : undefined),
        rainMm: numOrUndef(Array.isArray(h.rain) ? h.rain[i] : undefined),
        weatherCode: desc.weatherCode,
        description: desc.description,
        windSpeedKmh: numOrUndef(Array.isArray(h.wind_speed_10m) ? h.wind_speed_10m[i] : undefined),
      })
      hourly.push(row)
    }
  }

  const daily = []
  const d = raw.daily
  if (d && Array.isArray(d.time)) {
    for (let i = 0; i < d.time.length; i += 1) {
      const code = numOrUndef(Array.isArray(d.weather_code) ? d.weather_code[i] : undefined)
      const desc = describeWmoCode(code, lang)
      const row = stripUndef({
        date: d.time[i],
        weatherCode: desc.weatherCode,
        description: desc.description,
        temperatureMaxC: numOrUndef(
          Array.isArray(d.temperature_2m_max) ? d.temperature_2m_max[i] : undefined,
        ),
        temperatureMinC: numOrUndef(
          Array.isArray(d.temperature_2m_min) ? d.temperature_2m_min[i] : undefined,
        ),
        precipitationProbabilityMax: numOrUndef(
          Array.isArray(d.precipitation_probability_max)
            ? d.precipitation_probability_max[i]
            : undefined,
        ),
        precipitationSumMm: numOrUndef(
          Array.isArray(d.precipitation_sum) ? d.precipitation_sum[i] : undefined,
        ),
        windSpeedMaxKmh: numOrUndef(
          Array.isArray(d.wind_speed_10m_max) ? d.wind_speed_10m_max[i] : undefined,
        ),
        sunrise: Array.isArray(d.sunrise) ? d.sunrise[i] : undefined,
        sunset: Array.isArray(d.sunset) ? d.sunset[i] : undefined,
      })
      daily.push(row)
    }
  }

  return {
    status: 'ok',
    location: stripUndef({
      name: location.name,
      country: location.country || undefined,
      admin1: location.admin1 || undefined,
      timezone: tz,
    }),
    current,
    hourly,
    daily,
    attribution: WEATHER_ATTRIBUTION,
    provider: 'open_meteo',
  }
}

function stripUndef(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out
}

/**
 * Normalize geocoding result row.
 * @param {object} row
 */
export function normalizeGeocodeResult(row) {
  if (!row || typeof row !== 'object') return null
  const latitude = Number(row.latitude)
  const longitude = Number(row.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  const name = typeof row.name === 'string' ? row.name : null
  if (!name) return null
  return stripUndef({
    name,
    country: typeof row.country === 'string' ? row.country : undefined,
    admin1: typeof row.admin1 === 'string' ? row.admin1 : undefined,
    latitude,
    longitude,
    timezone: typeof row.timezone === 'string' ? row.timezone : 'UTC',
    population: typeof row.population === 'number' ? row.population : undefined,
  })
}
