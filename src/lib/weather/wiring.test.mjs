/**
 * #317 — Chat wiring isolation: Weather after Phone/Timer; no Places dependency.
 * Run: node src/lib/weather/wiring.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBrowserPosition } from '../geolocation.js'
import { detectPhoneActionIntent } from '../phone-action/intent.js'
import { detectTimerIntent } from '../timer/intent.js'
import { detectWeatherIntent } from './intent.js'

function route(text) {
  const timer = detectTimerIntent(text)
  if (timer && timer.kind && timer.kind !== 'none') return 'timer'

  const phone = detectPhoneActionIntent(text)
  if (phone && phone.kind && phone.kind !== 'none') return 'phone'

  const weather = detectWeatherIntent(text)
  if (weather.intent === 'weather') return 'weather'
  return 'core'
}

assert.equal(route('Timer di 10 minuti.'), 'timer')
assert.equal(route('Portami a Milano.'), 'phone')
assert.equal(route('Che tempo fa a Milano?'), 'weather')
assert.equal(route('Cerca sul web il meteo di Milano.'), 'core')
assert.equal(route("Cos'è il meteo?"), 'core')
assert.equal(route('Trova un ristorante a Milano.'), 'core')

const unsupported = await getBrowserPosition({ geolocation: null })
assert.equal(unsupported.ok, false)
assert.equal(unsupported.code, 'unsupported')

const denied = await getBrowserPosition({
  geolocation: {
    getCurrentPosition: (_ok, err) => err({ code: 1 }),
  },
})
assert.equal(denied.ok, false)
assert.equal(denied.code, 'denied')

const granted = await getBrowserPosition({
  geolocation: {
    getCurrentPosition: (ok) => ok({ coords: { latitude: 45.46, longitude: 9.19, accuracy: 20 } }),
  },
})
assert.equal(granted.ok, true)
assert.equal(granted.latitude, 45.46)

const timeout = await getBrowserPosition({
  geolocation: {
    getCurrentPosition: (_ok, err) => err({ code: 3 }),
  },
})
assert.equal(timeout.code, 'timeout')

const unavailable = await getBrowserPosition({
  geolocation: {
    getCurrentPosition: (_ok, err) => err({ code: 2 }),
  },
})
assert.equal(unavailable.code, 'unavailable')

const __dirname = dirname(fileURLToPath(import.meta.url))
const weatherJs = readFileSync(join(__dirname, '../weather.js'), 'utf8')
assert.ok(!/GOOGLE_PLACES|PLACES_ENABLED/i.test(weatherJs))

console.log('wiring.test.mjs: ok')
