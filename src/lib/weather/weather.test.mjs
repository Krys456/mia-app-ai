/**
 * #317 — Weather routing, rain/umbrella, time windows, WMO, context tests.
 * Run: node src/lib/weather/weather.test.mjs
 */

import assert from 'node:assert/strict'
import { detectPhoneActionIntent } from '../phone-action/intent.js'
import { detectTimerIntent } from '../timer/intent.js'
import { detectWeatherIntent, detectWeatherFollowUp } from './intent.js'
import { analyzeRainInHourly, buildRainEvidence } from './rain.js'
import { buildUmbrellaEvidence, decideUmbrella, hourNeedsUmbrella, UMBRELLA_PROB_THRESHOLD } from './umbrella.js'
import { describeWmoCode, isWetWeatherCode } from './wmo.js'
import {
  DAYPART_HOURS,
  pickClosestHourly,
  resolveTimeWindow,
  resolveWeekendDates,
} from './time-windows.js'
import { createWeatherContext, isWeatherContextFresh } from './active-context.js'
import { pickGeocodeResult } from '../../../lib/server/weather/geocode.js'
import { normalizeOpenMeteoForecast } from '../../../lib/server/weather/normalize.js'
import { fetchOpenMeteoForecast } from '../../../lib/server/weather/open-meteo.js'
import { runWeatherLookup } from '../../../lib/server/weather/index.js'

// --- Positive IT ---
for (const phrase of [
  'Che tempo fa?',
  'Che tempo fa qui?',
  'Che tempo fa oggi?',
  'Che tempo fa a Milano?',
  'Pioverà?',
  'Pioverà oggi?',
  'Pioverà domani?',
  "Devo portare l'ombrello?",
  'Che temperatura fa?',
  'Che temperatura farà domani?',
  'Che temperatura ci sarà alle 18?',
  'Farà freddo stasera?',
  "Quanto vento c'è?",
  'Che tempo farà nel weekend?',
  'Che tempo farà nei prossimi 3 giorni?',
]) {
  const i = detectWeatherIntent(phrase)
  assert.equal(i.intent, 'weather', `expected weather for: ${phrase}`)
}

// --- Positive EN ---
for (const phrase of [
  "What's the weather?",
  "What's the weather in London?",
  'Will it rain tomorrow?',
  'Do I need an umbrella?',
  'How cold will it be tonight?',
  "What's the weather this weekend?",
]) {
  const i = detectWeatherIntent(phrase, { languageHint: 'en' })
  assert.equal(i.intent, 'weather', `expected weather for: ${phrase}`)
}

assert.equal(detectWeatherIntent('Che tempo fa a Milano?').locationText, 'Milano')
assert.equal(detectWeatherIntent("What's the weather in London?").locationText, 'London')
assert.equal(detectWeatherIntent('Pioverà domani?').operation, 'rain')
assert.equal(detectWeatherIntent('Pioverà domani?').timeHint, 'tomorrow')
assert.equal(detectWeatherIntent("Devo portare l'ombrello?").operation, 'umbrella')
assert.equal(detectWeatherIntent('Che temperatura ci sarà alle 18?').timeHint, 'hour_18')
assert.equal(detectWeatherIntent('Che tempo farà nel weekend?').operation, 'weekend')

// --- Negatives ---
for (const phrase of [
  "Cos'è il meteo?",
  'Come funzionano le previsioni meteorologiche?',
  'Parliamo del clima.',
  'Scrivi una storia sulla pioggia.',
  'Cosa significa precipitazione?',
  'Cerca sul web il meteo di Milano.',
  '"Che tempo fa a Milano?"',
]) {
  const i = detectWeatherIntent(phrase)
  assert.equal(i.intent, 'none', `expected none for: ${phrase}`)
}

// --- Routing conflicts ---
assert.equal(detectPhoneActionIntent('Portami a Milano.').kind, 'navigate')
assert.equal(detectWeatherIntent('Portami a Milano.').intent, 'none')
assert.equal(detectWeatherIntent('Trova un ristorante a Milano.').intent, 'none')
assert.equal(detectWeatherIntent('Cerca sul web il meteo di Milano.').intent, 'none')
assert.equal(detectTimerIntent('Timer di 10 minuti.').kind, 'start')
assert.equal(detectWeatherIntent('Timer di 10 minuti.').intent, 'none')
assert.equal(detectWeatherIntent('Che tempo fa a Milano?').intent, 'weather')

// --- WMO ---
assert.equal(describeWmoCode(0, 'it').description, 'Sereno')
assert.equal(describeWmoCode(0, 'en').description, 'Clear')
assert.equal(describeWmoCode(95, 'it').category, 'thunderstorm')
assert.ok(isWetWeatherCode(61))
assert.ok(!isWetWeatherCode(0))

// --- Rain / umbrella ---
assert.equal(UMBRELLA_PROB_THRESHOLD, 50)
const low = analyzeRainInHourly([
  { time: '2026-08-19T15:00', precipitationProbability: 10, precipitationMm: 0, weatherCode: 1 },
])
assert.equal(low.likely, false)
assert.equal(decideUmbrella(low).recommended, false)

const high = analyzeRainInHourly([
  { time: '2026-08-19T15:00', precipitationProbability: 70, precipitationMm: 1.2, weatherCode: 63 },
])
assert.equal(high.likely, true)
assert.equal(decideUmbrella(high).recommended, true)

const storm = analyzeRainInHourly([
  { time: '2026-08-19T16:00', precipitationProbability: 40, weatherCode: 95 },
])
assert.equal(decideUmbrella(storm).recommended, true)
assert.ok(hourNeedsUmbrella({ weatherCode: 95 }))
assert.ok(!hourNeedsUmbrella({ precipitationProbability: 10, weatherCode: 1 }))

const unknownP = analyzeRainInHourly([{ time: '2026-08-19T12:00', weatherCode: 2 }])
assert.equal(unknownP.maxProbability, null)

// --- Dayparts documented ---
assert.deepEqual(DAYPART_HOURS.morning, { start: 6, end: 12 })
assert.deepEqual(DAYPART_HOURS.afternoon, { start: 12, end: 18 })
assert.deepEqual(DAYPART_HOURS.evening, { start: 18, end: 23 })
assert.deepEqual(DAYPART_HOURS.night, { start: 23, end: 6 })

// --- Timezone: Europe/Rome vs UTC shift ---
const romeNow = new Date('2026-08-19T22:30:00Z') // still 19 Aug evening in Rome (UTC+2)
const winToday = resolveTimeWindow({
  timeHint: 'today',
  operation: 'today',
  timeZone: 'Europe/Rome',
  now: romeNow,
})
assert.equal(winToday.dates[0], '2026-08-20') // 00:30 Aug 20 in Rome

const winHour = resolveTimeWindow({
  timeHint: 'hour_18',
  operation: 'hourly',
  timeZone: 'Europe/Rome',
  now: new Date('2026-08-19T10:00:00Z'),
})
assert.equal(winHour.specificHour, 18)
assert.ok(winHour.startIso.includes('T18:00'))

const weekend = resolveWeekendDates('Europe/Rome', new Date('2026-08-19T12:00:00Z')) // Wed
assert.equal(weekend.saturday, '2026-08-22')
assert.equal(weekend.sunday, '2026-08-23')

const satWeekend = resolveWeekendDates('Europe/Rome', new Date('2026-08-22T12:00:00Z'))
assert.equal(satWeekend.saturday, '2026-08-22')

const hourly = [
  { time: '2026-08-19T17:00', temperatureC: 24 },
  { time: '2026-08-19T18:00', temperatureC: 23 },
  { time: '2026-08-19T19:00', temperatureC: 22 },
]
assert.equal(pickClosestHourly(hourly, '2026-08-19', 18).temperatureC, 23)

// --- Context follow-ups ---
const fu = detectWeatherFollowUp('Domani?', { hasWeatherContext: true })
assert.ok(fu)
assert.equal(fu.operation, 'tomorrow')
const fu2 = detectWeatherFollowUp('E la sera?', { hasWeatherContext: true, stickyTimeHint: 'tomorrow' })
assert.ok(fu2)
assert.equal(fu2.timeHint, 'evening')
assert.equal(detectWeatherFollowUp('Domani?', { hasWeatherContext: false }), false)

const snap = {
  status: 'ok',
  location: { name: 'Milano', timezone: 'Europe/Rome' },
  current: { temperatureC: 22, weatherCode: 2, description: 'Parzialmente nuvoloso' },
  hourly: [],
  daily: [],
}
const ctx = createWeatherContext({
  locationLabel: 'Milano',
  timezone: 'Europe/Rome',
  locationSource: 'explicit',
  forecastSnapshot: snap,
  language: 'it',
})
assert.ok(isWeatherContextFresh(ctx))
assert.ok(isWeatherContextFresh(ctx, Date.now() + 1000))
assert.equal(isWeatherContextFresh(ctx, Date.now() + 40 * 60 * 1000), false)

const rainEv = buildRainEvidence(
  {
    status: 'ok',
    location: { timezone: 'Europe/Rome' },
    hourly: [
      { time: '2026-08-19T15:00', precipitationProbability: 70, weatherCode: 63 },
      { time: '2026-08-19T16:00', precipitationProbability: 40, weatherCode: 3 },
    ],
    daily: [],
  },
  { timeHint: 'today', timeZone: 'Europe/Rome', now: new Date('2026-08-19T08:00:00+02:00') },
)
assert.equal(rainEv.likely, true)
assert.equal(buildUmbrellaEvidence(
  {
    status: 'ok',
    location: { timezone: 'Europe/Rome' },
    hourly: [{ time: '2026-08-19T15:00', precipitationProbability: 10, weatherCode: 1 }],
    daily: [],
  },
  { timeHint: 'today', timeZone: 'Europe/Rome', now: new Date('2026-08-19T08:00:00+02:00') },
).recommended, false)

// --- Geocoding pick ---
assert.equal(pickGeocodeResult([]).status, 'geocode_empty')
assert.equal(
  pickGeocodeResult([{ name: 'Milano', latitude: 45.46, longitude: 9.19, timezone: 'Europe/Rome', population: 1e6 }])
    .status,
  'ok',
)
assert.equal(
  pickGeocodeResult([
    { name: 'Springfield', latitude: 1, longitude: 1, timezone: 'UTC', population: 1000 },
    { name: 'Springfield', latitude: 2, longitude: 2, timezone: 'UTC', population: 900 },
  ]).status,
  'geocode_ambiguous',
)

// --- Normalize: never invent zeros ---
const normalized = normalizeOpenMeteoForecast(
  {
    timezone: 'Europe/Rome',
    current: { temperature_2m: 21.4, weather_code: 2, wind_speed_10m: 12 },
    hourly: { time: ['2026-08-19T12:00'], temperature_2m: [22], weather_code: [2] },
    daily: {
      time: ['2026-08-19'],
      weather_code: [2],
      temperature_2m_max: [26],
      temperature_2m_min: [18],
    },
  },
  { name: 'Milano', latitude: 45.46, longitude: 9.19, timezone: 'Europe/Rome', language: 'it' },
)
assert.equal(normalized.status, 'ok')
assert.equal(normalized.current.temperatureC, 21.4)
assert.equal(normalized.current.humidityPercent, undefined)
assert.equal(normalized.hourly[0].precipitationProbability, undefined)
assert.equal(normalized.daily[0].temperatureMaxC, 26)

const malformed = normalizeOpenMeteoForecast(null, {
  name: 'X',
  latitude: 0,
  longitude: 0,
  timezone: 'UTC',
})
assert.equal(malformed.status, 'provider_error')

// --- Provider mock HTTP failure ---
const failForecast = await fetchOpenMeteoForecast({
  latitude: 45.46,
  longitude: 9.19,
  name: 'Milano',
  timezone: 'Europe/Rome',
  fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
})
assert.equal(failForecast.status, 'provider_error')
assert.equal(failForecast.providerHttpStatus, 500)

const rateForecast = await fetchOpenMeteoForecast({
  latitude: 45.46,
  longitude: 9.19,
  name: 'Milano',
  fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }),
})
assert.equal(rateForecast.status, 'rate_limited')

const okForecast = await fetchOpenMeteoForecast({
  latitude: 45.46,
  longitude: 9.19,
  name: 'Milano',
  timezone: 'Europe/Rome',
  language: 'it',
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      timezone: 'Europe/Rome',
      current: { temperature_2m: 22, weather_code: 0, wind_speed_10m: 8, is_day: 1 },
      hourly: {
        time: ['2026-08-19T12:00'],
        temperature_2m: [22],
        precipitation_probability: [5],
        weather_code: [0],
        wind_speed_10m: [8],
      },
      daily: {
        time: ['2026-08-19'],
        weather_code: [0],
        temperature_2m_max: [27],
        temperature_2m_min: [17],
        precipitation_probability_max: [10],
        precipitation_sum: [0],
        wind_speed_10m_max: [15],
        sunrise: ['2026-08-19T06:20'],
        sunset: ['2026-08-19T20:30'],
      },
    }),
  }),
})
assert.equal(okForecast.status, 'ok')
assert.equal(okForecast.current.temperatureC, 22)
assert.ok(okForecast.hourlyDataPresent)
assert.ok(okForecast.dailyDataPresent)

const geoEmpty = await runWeatherLookup({
  locationText: 'NowherevilleXYZ999',
  language: 'it',
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ results: [] }),
  }),
})
assert.equal(geoEmpty.status, 'geocode_empty')

const milanLookup = await runWeatherLookup({
  locationText: 'Milano',
  language: 'it',
  fetchImpl: async (url) => {
    const u = String(url)
    if (u.includes('geocoding')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              name: 'Milano',
              country: 'Italy',
              admin1: 'Lombardy',
              latitude: 45.4642,
              longitude: 9.19,
              timezone: 'Europe/Rome',
              population: 1352000,
            },
          ],
        }),
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        timezone: 'Europe/Rome',
        current: { temperature_2m: 22, weather_code: 2, wind_speed_10m: 12 },
        hourly: { time: [], temperature_2m: [], weather_code: [] },
        daily: {
          time: ['2026-08-19'],
          weather_code: [2],
          temperature_2m_max: [26],
          temperature_2m_min: [18],
        },
      }),
    }
  },
})
assert.equal(milanLookup.status, 'ok')
assert.equal(milanLookup.location.name, 'Milano')

// GPS path (no geocode)
const gpsLookup = await runWeatherLookup({
  latitude: 45.46,
  longitude: 9.19,
  language: 'it',
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      timezone: 'Europe/Rome',
      current: { temperature_2m: 21, weather_code: 1 },
      hourly: { time: [] },
      daily: { time: [] },
    }),
  }),
})
assert.equal(gpsLookup.status, 'ok')
assert.equal(gpsLookup.locationSource, 'gps')

console.log('weather.test.mjs: ok')
