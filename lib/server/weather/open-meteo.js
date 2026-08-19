/**
 * #317 — Open-Meteo Forecast API client.
 * No API key. Windspeed in km/h. Timezone = location timezone (auto).
 */

import {
  CURRENT_VARS,
  DAILY_VARS,
  FORECAST_DAYS,
  HOURLY_VARS,
  OPEN_METEO_FORECAST_BASE,
  WEATHER_ATTRIBUTION,
} from './config.js'
import { normalizeOpenMeteoForecast } from './normalize.js'

/**
 * @param {{
 *   latitude: number
 *   longitude: number
 *   timezone?: string
 *   name: string
 *   country?: string | null
 *   admin1?: string | null
 *   language?: 'it'|'en'
 *   forecastDays?: number
 *   fetchImpl?: typeof fetch
 * }} input
 */
export async function fetchOpenMeteoForecast(input) {
  const latitude = Number(input.latitude)
  const longitude = Number(input.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return {
      status: 'invalid_request',
      failureCode: 'invalid_coordinates',
      providerRequestReached: false,
      attribution: WEATHER_ATTRIBUTION,
    }
  }

  const url = new URL(OPEN_METEO_FORECAST_BASE)
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('longitude', String(longitude))
  url.searchParams.set('current', CURRENT_VARS)
  url.searchParams.set('hourly', HOURLY_VARS)
  url.searchParams.set('daily', DAILY_VARS)
  url.searchParams.set('forecast_days', String(input.forecastDays || FORECAST_DAYS))
  url.searchParams.set('timezone', input.timezone || 'auto')
  url.searchParams.set('wind_speed_unit', 'kmh')

  const fetchImpl = input.fetchImpl || fetch
  let res
  try {
    res = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
  } catch {
    return {
      status: 'provider_error',
      failureCode: 'forecast_network',
      providerRequestReached: true,
      provider: 'open_meteo',
      attribution: WEATHER_ATTRIBUTION,
    }
  }

  if (res.status === 429) {
    return {
      status: 'rate_limited',
      failureCode: 'provider_rate_limited',
      providerRequestReached: true,
      providerHttpStatus: 429,
      provider: 'open_meteo',
      attribution: WEATHER_ATTRIBUTION,
    }
  }

  if (!res.ok) {
    return {
      status: 'provider_error',
      failureCode: 'forecast_http',
      providerRequestReached: true,
      providerHttpStatus: res.status,
      provider: 'open_meteo',
      attribution: WEATHER_ATTRIBUTION,
    }
  }

  let json
  try {
    json = await res.json()
  } catch {
    return {
      status: 'provider_error',
      failureCode: 'malformed_response',
      providerRequestReached: true,
      providerHttpStatus: res.status,
      provider: 'open_meteo',
      attribution: WEATHER_ATTRIBUTION,
    }
  }

  const normalized = normalizeOpenMeteoForecast(json, {
    name: input.name,
    country: input.country,
    admin1: input.admin1,
    latitude,
    longitude,
    timezone: input.timezone || json.timezone || 'UTC',
    language: input.language,
  })

  return {
    ...normalized,
    providerRequestReached: true,
    providerHttpStatus: res.status,
    forecastDays: input.forecastDays || FORECAST_DAYS,
    hourlyDataPresent: Array.isArray(normalized.hourly) && normalized.hourly.length > 0,
    dailyDataPresent: Array.isArray(normalized.daily) && normalized.daily.length > 0,
  }
}
