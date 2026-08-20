/**
 * #318 — Router isolation wiring tests.
 * Run: node src/lib/calculator/wiring.test.mjs
 */

import assert from 'node:assert/strict'
import { detectPhoneActionIntent } from '../phone-action/intent.js'
import { detectTimerIntent } from '../timer/intent.js'
import { detectWeatherIntent } from '../weather/intent.js'
import { detectCalculatorIntent } from './intent.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function route(text) {
  const timer = detectTimerIntent(text)
  if (timer && timer.kind && timer.kind !== 'none') return 'timer'
  const phone = detectPhoneActionIntent(text)
  if (phone && phone.kind && phone.kind !== 'none') return 'phone'
  // ChatContext: clear Calculator intents win before Weather (percent / arithmetic).
  const calc = detectCalculatorIntent(text)
  const clearCalc =
    calc.intent === 'calculator' &&
    (calc.percentHit ||
      calc.followUp ||
      calc.operation === 'expression' ||
      /[\+\-\*\/×÷^√%]/.test(text) ||
      /\d\s*%/.test(text))
  if (clearCalc) return 'calculator'
  const weather = detectWeatherIntent(text)
  if (weather.intent === 'weather') return 'weather'
  if (calc.intent === 'calculator') return 'calculator'
  return 'core'
}

assert.equal(route('Timer di 10 minuti.'), 'timer')
assert.equal(route('Apri YouTube'), 'phone')
assert.equal(route('Portami a Roma'), 'phone')
assert.equal(route('Che tempo fa a Milano?'), 'weather')
assert.equal(route('Trova un ristorante a Milano'), 'core') // Places not on main path
assert.equal(route('2+2'), 'calculator')
assert.equal(route('Quanto fa il 15% di 240?'), 'calculator')
assert.equal(route("Cos'è il 15%?"), 'core')
assert.equal(route('Ho 22 anni.'), 'core')

// No eval / Function in calculator sources
const __dirname = dirname(fileURLToPath(import.meta.url))
for (const f of ['parser.js', 'controller.js', 'percent.js', 'intent.js']) {
  const src = readFileSync(join(__dirname, f), 'utf8')
  assert.ok(!/\beval\s*\(/.test(src), f)
  assert.ok(!/\bFunction\s*\(/.test(src), f)
}

console.log('wiring.test.mjs: ok')
