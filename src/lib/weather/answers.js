/**
 * #317 — Deterministic grounded weather answers (prefer over Core for simple ops).
 */

import { buildRainEvidence } from './rain.js'
import { buildUmbrellaEvidence } from './umbrella.js'
import {
  filterHourlyInWindow,
  pickClosestHourly,
  resolveTimeWindow,
} from './time-windows.js'
import { describeWmoCode } from './wmo.js'
import { formatHourLabel } from './copy.js'

function locLabel(weather) {
  return weather?.location?.name || (weather?.location?.country ? String(weather.location.country) : '')
}

/**
 * @param {object} weather
 * @param {{ operation: string, timeHint?: string|null, language?: 'it'|'en', now?: Date|number }} opts
 */
export function buildDeterministicWeatherReply(weather, opts = {}) {
  const lang = opts.language === 'en' ? 'en' : 'it'
  const op = opts.operation || 'current'
  const tz = weather?.location?.timezone || 'UTC'
  const place = locLabel(weather)

  if (op === 'umbrella') {
    return formatUmbrellaReply(weather, { ...opts, language: lang, timeZone: tz, place })
  }
  if (op === 'rain') {
    return formatRainReply(weather, { ...opts, language: lang, timeZone: tz, place })
  }
  if (op === 'wind') {
    return formatWindReply(weather, { ...opts, language: lang, timeZone: tz, place })
  }
  if (op === 'temperature' || (opts.timeHint && /^hour_/.test(opts.timeHint))) {
    return formatTemperatureReply(weather, { ...opts, language: lang, timeZone: tz, place })
  }
  if (op === 'weekend') {
    return formatWeekendReply(weather, { language: lang, timeZone: tz, place, now: opts.now })
  }
  if (op === 'tomorrow' || op === 'today' || op === 'daily') {
    return formatDailyReply(weather, { ...opts, language: lang, timeZone: tz, place })
  }
  return formatCurrentReply(weather, { language: lang, place })
}

function formatCurrentReply(weather, { language, place }) {
  const c = weather?.current
  if (!c || typeof c.temperatureC !== 'number') {
    return language === 'en'
      ? 'I received weather data but no current temperature.'
      : 'Ho ricevuto i dati meteo ma manca la temperatura attuale.'
  }
  const desc = c.description || describeWmoCode(c.weatherCode, language).description
  const wind =
    typeof c.windSpeedKmh === 'number'
      ? language === 'en'
        ? ` and wind around ${Math.round(c.windSpeedKmh)} km/h`
        : ` e vento intorno ai ${Math.round(c.windSpeedKmh)} km/h`
      : ''
  if (language === 'en') {
    return `${place ? `In ${place} ` : ''}it's ${Math.round(c.temperatureC)} °C, ${desc.toLowerCase()}${wind}.`
  }
  return `${place ? `A ${place} ` : ''}ci sono ${Math.round(c.temperatureC)} °C, cielo ${desc.toLowerCase()}${wind}.`
}

function formatTemperatureReply(weather, opts) {
  const lang = opts.language
  const tz = opts.timeZone
  const place = opts.place
  const hint = opts.timeHint
  if (hint && /^hour_(\d+)$/.test(hint)) {
    const hour = Number(RegExp.$1)
    const window = resolveTimeWindow({ timeHint: hint, operation: 'hourly', timeZone: tz, now: opts.now })
    const date = window.dates[0]
    const row = pickClosestHourly(weather.hourly || [], date, hour)
    if (row && typeof row.temperatureC === 'number') {
      const when = formatHourLabel(row.time, lang)
      if (lang === 'en') {
        return `${place ? `In ${place}, ` : ''}${when || `at ${hour}:00`} about ${Math.round(row.temperatureC)} °C.`
      }
      return `${place ? `A ${place}, ` : ''}${when || `alle ${hour}`} circa ${Math.round(row.temperatureC)} °C.`
    }
  }
  if (opts.operation === 'tomorrow' || hint === 'tomorrow') {
    const window = resolveTimeWindow({ timeHint: 'tomorrow', operation: 'tomorrow', timeZone: tz, now: opts.now })
    const day = (weather.daily || []).find((d) => d.date === window.dates[0])
    if (day && typeof day.temperatureMaxC === 'number') {
      if (lang === 'en') {
        return `${place ? `In ${place} ` : ''}tomorrow: max ${Math.round(day.temperatureMaxC)} °C${
          typeof day.temperatureMinC === 'number' ? `, min ${Math.round(day.temperatureMinC)} °C` : ''
        }.`
      }
      return `${place ? `A ${place} ` : ''}domani: max ${Math.round(day.temperatureMaxC)} °C${
        typeof day.temperatureMinC === 'number' ? `, min ${Math.round(day.temperatureMinC)} °C` : ''
      }.`
    }
  }
  return formatCurrentReply(weather, { language: lang, place })
}

function formatRainReply(weather, opts) {
  const lang = opts.language
  const evidence = buildRainEvidence(weather, {
    operation: 'rain',
    timeHint: opts.timeHint || 'today',
    timeZone: opts.timeZone,
    now: opts.now,
  })
  const peak = formatHourLabel(evidence.peakHour, lang)
  if (evidence.likely) {
    if (evidence.maxProbability != null) {
      if (lang === 'en') {
        return `It's likely: rain probability reaches ${Math.round(evidence.maxProbability)}%${peak ? ` (${peak})` : ''}.`
      }
      return `È probabile: la probabilità di pioggia arriva al ${Math.round(evidence.maxProbability)}%${peak ? ` (${peak})` : ''}.`
    }
    if (lang === 'en') return 'Rain or showers look likely in that window (per forecast codes).'
    return 'Sì, nel periodo indicato risultano pioggia o rovesci (dai codici previsionali).'
  }
  if (evidence.maxProbability != null) {
    if (lang === 'en') {
      return `Probably not: peak rain chance stays around ${Math.round(evidence.maxProbability)}%.`
    }
    return `Probabilmente no: la probabilità di pioggia resta intorno al ${Math.round(evidence.maxProbability)}%.`
  }
  if (lang === 'en') return 'I don’t see a clear rain signal in that window.'
  return 'Non vedo un segnale chiaro di pioggia in quel periodo.'
}

function formatUmbrellaReply(weather, opts) {
  const lang = opts.language
  const u = buildUmbrellaEvidence(weather, {
    operation: 'umbrella',
    timeHint: opts.timeHint || 'today',
    timeZone: opts.timeZone,
    now: opts.now,
  })
  const peak = formatHourLabel(u.peakHour, lang)
  if (u.recommended) {
    if (u.maxProbability != null) {
      if (lang === 'en') {
        return `I'd take an umbrella: rain probability reaches ${Math.round(u.maxProbability)}%${peak ? ` (${peak})` : ''}.`
      }
      return `Porterei l'ombrello: la probabilità di pioggia arriva al ${Math.round(u.maxProbability)}%${peak ? ` (${peak})` : ''}.`
    }
    if (lang === 'en') return "I'd take an umbrella — wet weather codes show up in the forecast."
    return "Porterei l'ombrello: nelle previsioni compaiono pioggia o temporali."
  }
  if (lang === 'en') return 'You probably don’t need one: rain risk stays low.'
  return 'Probabilmente non serve: il rischio di pioggia resta basso.'
}

function formatWindReply(weather, opts) {
  const lang = opts.language
  const place = opts.place
  const tz = opts.timeZone
  const window = resolveTimeWindow({
    timeHint: opts.timeHint,
    operation: opts.operation || 'wind',
    timeZone: tz,
    now: opts.now,
  })
  const hours = filterHourlyInWindow(weather.hourly || [], window)
  let maxWind = null
  for (const h of hours) {
    if (typeof h.windSpeedKmh === 'number') {
      maxWind = maxWind == null ? h.windSpeedKmh : Math.max(maxWind, h.windSpeedKmh)
    }
  }
  if (maxWind == null && weather.current && typeof weather.current.windSpeedKmh === 'number') {
    maxWind = weather.current.windSpeedKmh
  }
  if (maxWind == null) {
    return lang === 'en' ? 'No wind data in that window.' : 'Nessun dato sul vento in quel periodo.'
  }
  if (lang === 'en') {
    return `${place ? `In ${place}, ` : ''}wind around ${Math.round(maxWind)} km/h.`
  }
  return `${place ? `A ${place} ` : ''}vento intorno ai ${Math.round(maxWind)} km/h.`
}

function formatDailyReply(weather, opts) {
  const lang = opts.language
  const place = opts.place
  const tz = opts.timeZone
  const window = resolveTimeWindow({
    timeHint: opts.timeHint || (opts.operation === 'tomorrow' ? 'tomorrow' : 'today'),
    operation: opts.operation,
    timeZone: tz,
    now: opts.now,
  })
  const day = (weather.daily || []).find((d) => d.date === window.dates[0])
  if (!day) return formatCurrentReply(weather, { language: lang, place })
  const desc = day.description || describeWmoCode(day.weatherCode, lang).description
  const label =
    opts.operation === 'tomorrow' || opts.timeHint === 'tomorrow'
      ? lang === 'en'
        ? 'Tomorrow'
        : 'Domani'
      : lang === 'en'
        ? 'Today'
        : 'Oggi'
  if (lang === 'en') {
    return `${place ? `${place}: ` : ''}${label} — ${desc.toLowerCase()}, max ${Math.round(day.temperatureMaxC)} °C / min ${Math.round(day.temperatureMinC)} °C${
      typeof day.precipitationProbabilityMax === 'number'
        ? `, rain chance up to ${Math.round(day.precipitationProbabilityMax)}%`
        : ''
    }.`
  }
  return `${place ? `${place}: ` : ''}${label} — ${desc.toLowerCase()}, max ${Math.round(day.temperatureMaxC)} °C / min ${Math.round(day.temperatureMinC)} °C${
    typeof day.precipitationProbabilityMax === 'number'
      ? `, probabilità di pioggia fino al ${Math.round(day.precipitationProbabilityMax)}%`
      : ''
  }.`
}

function formatWeekendReply(weather, opts) {
  const lang = opts.language
  const place = opts.place
  const window = resolveTimeWindow({
    timeHint: 'weekend',
    operation: 'weekend',
    timeZone: opts.timeZone,
    now: opts.now,
  })
  const lines = []
  for (const date of window.dates || []) {
    const day = (weather.daily || []).find((d) => d.date === date)
    if (!day) continue
    const desc = day.description || describeWmoCode(day.weatherCode, lang).description
    const wd = date.slice(5) // MM-DD
    lines.push(
      lang === 'en'
        ? `${wd}: ${desc}, ${Math.round(day.temperatureMaxC)}° / ${Math.round(day.temperatureMinC)}°`
        : `${wd}: ${desc}, ${Math.round(day.temperatureMaxC)}° / ${Math.round(day.temperatureMinC)}°`,
    )
  }
  if (!lines.length) {
    return lang === 'en' ? 'Weekend forecast not available yet.' : 'Previsione del weekend non ancora disponibile.'
  }
  const header = lang === 'en' ? `${place ? place + ' — ' : ''}Weekend:` : `${place ? place + ' — ' : ''}Weekend:`
  return `${header}\n${lines.join('\n')}`
}

/**
 * Compact card model for UI (no invented fields).
 * @param {object} weather
 */
export function buildWeatherCardModel(weather) {
  const c = weather?.current
  const today = Array.isArray(weather?.daily) ? weather.daily[0] : null
  if (!c && !today) return null
  const code = c?.weatherCode ?? today?.weatherCode
  const meta = describeWmoCode(code, 'it')
  return {
    locationLabel: locLabel(weather) || '—',
    emoji: meta.emoji,
    temperatureC: typeof c?.temperatureC === 'number' ? Math.round(c.temperatureC) : null,
    apparentTemperatureC:
      typeof c?.apparentTemperatureC === 'number' ? Math.round(c.apparentTemperatureC) : null,
    description: c?.description || today?.description || meta.description,
    temperatureMaxC: typeof today?.temperatureMaxC === 'number' ? Math.round(today.temperatureMaxC) : null,
    temperatureMinC: typeof today?.temperatureMinC === 'number' ? Math.round(today.temperatureMinC) : null,
    precipitationProbabilityMax:
      typeof today?.precipitationProbabilityMax === 'number'
        ? Math.round(today.precipitationProbabilityMax)
        : null,
    windSpeedKmh: typeof c?.windSpeedKmh === 'number' ? Math.round(c.windSpeedKmh) : null,
    attribution: 'Weather data: Open-Meteo',
  }
}

/**
 * Compact WEATHER_CONTEXT block for optional Core synthesis (complex advice only).
 * Never includes precise GPS.
 */
export function buildWeatherContextBlock(weather, opts = {}) {
  const c = weather?.current
  const today = weather?.daily?.[0]
  const rain = buildRainEvidence(weather, {
    operation: 'rain',
    timeHint: opts.timeHint || 'today',
    timeZone: weather?.location?.timezone,
  })
  const umbrella = buildUmbrellaEvidence(weather, {
    operation: 'umbrella',
    timeHint: opts.timeHint || 'today',
    timeZone: weather?.location?.timezone,
  })
  const lines = [
    'WEATHER_CONTEXT (provider-grounded; do not invent values)',
    `location: ${locLabel(weather) || 'unknown'}`,
    `timezone: ${weather?.location?.timezone || 'unknown'}`,
    `timeframe: ${opts.timeHint || opts.operation || 'current'}`,
  ]
  if (typeof c?.temperatureC === 'number') lines.push(`current_temp_c: ${c.temperatureC}`)
  if (typeof today?.temperatureMaxC === 'number') lines.push(`max_temp_c: ${today.temperatureMaxC}`)
  if (typeof today?.temperatureMinC === 'number') lines.push(`min_temp_c: ${today.temperatureMinC}`)
  if (rain.maxProbability != null) lines.push(`rain_probability_max: ${rain.maxProbability}`)
  if (typeof c?.windSpeedKmh === 'number') lines.push(`wind_kmh: ${c.windSpeedKmh}`)
  lines.push(`umbrella_recommended: ${umbrella.recommended}`)
  lines.push('Guidance: answer using this data only; distinguish recommendation from forecast.')
  return lines.join('\n')
}
