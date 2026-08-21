/**
 * #321 — Weather composition for briefing (#317 reuse; no silent GPS).
 */

import { buildUmbrellaEvidence } from '../weather/umbrella.js'
import { buildRainEvidence } from '../weather/rain.js'
import { loadWeatherContext, isWeatherContextFresh } from '../weather/active-context.js'
import { requestWeather } from '../weather/weatherApi.js'
import { describeWmoCode } from '../weather/wmo.js'

/**
 * @param {{
 *   language: 'it'|'en'
 *   locationText?: string | null
 *   weatherContext?: object | null
 *   timeZone?: string
 * }} opts
 */
export async function resolveBriefingWeather(opts) {
  const lang = opts.language === 'en' ? 'en' : 'it'
  if (opts.weatherEnabled === false) {
    return {
      status: 'unavailable',
      snapshot: null,
      fetchedAt: new Date().toISOString(),
      hiddenByPref: true,
    }
  }

  const ctx =
    opts.weatherContext && isWeatherContextFresh(opts.weatherContext)
      ? opts.weatherContext
      : loadWeatherContext()

  // 1) Explicit city in briefing request (highest priority)
  const city = typeof opts.locationText === 'string' ? opts.locationText.trim() : ''
  if (city) {
    const weather = await requestWeather({
      operation: 'today',
      timeHint: 'today',
      language: lang,
      locationText: city,
      timezone: opts.timeZone || null,
    })
    if (weather?.status === 'ok') {
      return {
        status: 'ok',
        snapshot: compactWeatherSnapshot(weather, lang),
        fetchedAt: new Date().toISOString(),
        fromContext: false,
        citySource: 'request',
      }
    }
    // fall through to other sources if explicit city fails
  }

  // 2) Fresh activeWeatherContext snapshot
  if (ctx?.forecastSnapshot?.status === 'ok') {
    return {
      status: 'ok',
      snapshot: compactWeatherSnapshot(ctx.forecastSnapshot, lang),
      fetchedAt: new Date().toISOString(),
      fromContext: true,
      citySource: 'active_context',
    }
  }

  // 3) Preferred briefing city (explicit user preference)
  const preferred =
    typeof opts.preferredWeatherCity === 'string' ? opts.preferredWeatherCity.trim() : ''
  if (preferred) {
    const weather = await requestWeather({
      operation: 'today',
      timeHint: 'today',
      language: lang,
      locationText: preferred,
      timezone: opts.timeZone || null,
    })
    if (weather?.status === 'ok') {
      return {
        status: 'ok',
        snapshot: compactWeatherSnapshot(weather, lang),
        fetchedAt: new Date().toISOString(),
        fromContext: false,
        citySource: 'preferred',
      }
    }
    return {
      status: 'error',
      snapshot: null,
      fetchedAt: new Date().toISOString(),
      citySource: 'preferred',
    }
  }

  // If request city failed and nothing else worked
  if (city) {
    return {
      status: 'error',
      snapshot: null,
      fetchedAt: new Date().toISOString(),
      citySource: 'request',
    }
  }

  // 4) No GPS auto-prompt
  return {
    status: 'location_required',
    snapshot: null,
    fetchedAt: new Date().toISOString(),
  }
}

/**
 * @param {object} weather
 * @param {'it'|'en'} language
 */
export function compactWeatherSnapshot(weather, language = 'it') {
  const c = weather?.current || {}
  const today = Array.isArray(weather?.daily) ? weather.daily[0] : null
  const place = weather?.location?.name || ''
  const umbrella = buildUmbrellaEvidence(weather, {
    operation: 'today',
    timeHint: 'today',
    timeZone: weather?.location?.timezone,
  })
  const rain = buildRainEvidence(weather, {
    operation: 'today',
    timeHint: 'today',
    timeZone: weather?.location?.timezone,
  })

  return {
    locationLabel: String(place).slice(0, 80),
    timezone: weather?.location?.timezone || null,
    temperatureC: typeof c.temperatureC === 'number' ? Math.round(c.temperatureC) : null,
    description:
      c.description ||
      (typeof c.weatherCode === 'number' ? describeWmoCode(c.weatherCode, language).description : null),
    temperatureMaxC:
      typeof today?.temperatureMaxC === 'number' ? Math.round(today.temperatureMaxC) : null,
    temperatureMinC:
      typeof today?.temperatureMinC === 'number' ? Math.round(today.temperatureMinC) : null,
    precipProbabilityMax:
      typeof today?.precipitationProbabilityMax === 'number'
        ? today.precipitationProbabilityMax
        : rain?.probabilityMax ?? null,
    umbrellaRecommended: Boolean(umbrella?.recommend),
    rainLikely: Boolean(rain?.likely || (umbrella && umbrella.recommend)),
    windSpeedKmh:
      typeof c.windSpeedKmh === 'number' && c.windSpeedKmh >= 35 ? Math.round(c.windSpeedKmh) : null,
  }
}
