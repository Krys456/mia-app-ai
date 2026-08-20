/**
 * #320 — Energy Math deterministic tests.
 */
import assert from 'node:assert/strict'
import {
  applyEnergyMathIntent,
  computeEnergyFromPowerTime,
  computePowerFromEnergyTime,
  computeTimeFromEnergyPower,
  detectEnergyMathIntent,
  loadEnergyMathContext,
  saveEnergyMathContext,
  clearEnergyMathContext,
  makeQuantity,
} from '../energyMath.js'
import { detectUnitConversionIntent } from '../unitConversion.js'
import { detectCalculatorIntent } from '../calculator/intent.js'
import { detectTimerIntent } from '../timer/intent.js'
import { detectWeatherIntent } from '../weather/intent.js'
import { detectPhoneActionIntent } from '../phone-action/intent.js'

function approx(a, b, eps = 1e-6) {
  assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`)
}

// --- Engine ---
{
  const r = computeEnergyFromPowerTime({
    power: makeQuantity(2, 'kw'),
    time: makeQuantity(3, 'h'),
  })
  assert.equal(r.status, 'ok')
  approx(r.resultCanonical, 2e3 * 3 * 3600) // J
}
{
  const r = computePowerFromEnergyTime({
    energy: makeQuantity(12, 'kwh'),
    time: makeQuantity(6, 'h'),
  })
  assert.equal(r.status, 'ok')
  approx(r.resultCanonical, 2000)
}
{
  const r = computeTimeFromEnergyPower({
    energy: makeQuantity(2, 'kwh'),
    power: makeQuantity(500, 'w'),
  })
  assert.equal(r.status, 'ok')
  approx(r.resultCanonical, 14400)
}

// Rejects
assert.equal(
  computePowerFromEnergyTime({
    energy: makeQuantity(5, 'kwh'),
    time: makeQuantity(0, 'h'),
  }).errorCode,
  'zero_time',
)
assert.equal(
  computeTimeFromEnergyPower({
    energy: makeQuantity(2, 'kwh'),
    power: makeQuantity(0, 'w'),
  }).errorCode,
  'zero_power',
)
assert.equal(
  computeEnergyFromPowerTime({
    power: makeQuantity(2, 'kw'),
    time: makeQuantity(-1, 'h'),
  }).errorCode,
  'negative_value',
)

// --- Product phrases ---
const mustOk = [
  ['2 kW per 3 ore', 6, 'kwh'],
  ['Una stufa da 2 kW accesa per 3 ore quanti kWh consuma?', 6, 'kwh'],
  ['Un pannello da 450 W per 5 ore quanta energia produce?', 2.25, 'kwh'],
  ['500 W per 30 minuti quanti Wh sono?', 250, 'wh'],
  ['Quanto consuma un dispositivo da 100 W acceso 24 ore?', 2.4, 'kwh'],
  ['12 kWh in 6 ore: qual è la potenza media?', 2, 'kw'],
  ['2 kWh con un carico da 500 W quanto dura?', 4, 'h'],
  ['Una batteria da 10 kWh con un carico da 2 kW quanto dura?', 5, 'h'],
  ['2 kW for 3 hours', 6, 'kwh'],
  ['How much energy does a 2 kW heater use in 3 hours?', 6, 'kwh'],
  ['500 W for 30 minutes', 250, 'wh'],
  ['12 kWh over 6 hours: average power?', 2, 'kw'],
  ['How long will 2 kWh last at 500 W?', 4, 'h'],
  ['2 kW × 3 h', 6, 'kwh'],
]
for (const [q, expected, unitHint] of mustOk) {
  const intent = detectEnergyMathIntent(q)
  assert.equal(intent.intent, 'energy-math', q)
  const a = applyEnergyMathIntent({ text: q, languageHint: 'it' })
  assert.equal(a.status, 'ok', `${q} → ${a.diag?.failureCode} ${a.reply}`)
  approx(a.result, expected, 1e-4)
  assert.match(String(a.displayResult).toLowerCase(), new RegExp(unitHint.replace('kw', 'kw')), q)
}

// PV safety wording
{
  const a = applyEnergyMathIntent({
    text: 'Un pannello da 450 W per 5 ore quanta energia produce?',
    languageHint: 'it',
  })
  assert.equal(a.status, 'ok')
  approx(a.result, 2.25)
  assert.match(a.reply, /teoric|costant|fotovoltaic|non è una stima reale|ideal|theoretical/i)
  assert.doesNotMatch(a.reply, /produce realmente|actual daily yield|irraggiamento misurato/i)
}

// Battery ideal wording
{
  const a = applyEnergyMathIntent({
    text: 'Una batteria da 10 kWh con un carico da 2 kW quanto dura?',
    languageHint: 'it',
  })
  assert.equal(a.status, 'ok')
  approx(a.result, 5)
  assert.match(a.reply, /matematicamente|assumendo|utilizzabil|ideal/i)
}

// Negatives → not energy math
for (const q of [
  "Cos'è un kWh?",
  'Qual è la differenza tra kW e kWh?',
  'Come funziona una batteria?',
  'Parlami del fotovoltaico.',
  'Scrivi un articolo sull\'energia.',
  '"2 kW per 3 ore"',
]) {
  assert.equal(detectEnergyMathIntent(q).intent, 'none', q)
}

// --- Unit Conversion false-claim fix ---
assert.equal(detectUnitConversionIntent('2 kWh in 4 ore: potenza media').intent, 'none')
assert.equal(detectEnergyMathIntent('2 kWh in 4 ore: potenza media').intent, 'energy-math')
assert.equal(detectUnitConversionIntent('2 kW in W').intent, 'unit-conversion')
assert.equal(detectUnitConversionIntent('2 kWh in J').intent, 'unit-conversion')
assert.equal(detectEnergyMathIntent('2 kW in W').intent, 'none')

// --- Routing ---
assert.equal(detectTimerIntent('Timer di 3 ore').kind, 'start')
assert.equal(detectEnergyMathIntent('Timer di 3 ore').intent, 'none')
assert.equal(detectUnitConversionIntent('3 ore in minuti').intent, 'unit-conversion')
assert.equal(detectEnergyMathIntent('3 ore in minuti').intent, 'none')
assert.equal(detectCalculatorIntent('2 + 3').intent, 'calculator')
assert.equal(detectEnergyMathIntent('2 + 3').intent, 'none')
assert.equal(detectEnergyMathIntent('2 kW per 3 ore').intent, 'energy-math')
assert.equal(detectWeatherIntent('Che tempo farà tra 3 ore?').intent, 'weather')
assert.equal(detectEnergyMathIntent('Che tempo farà tra 3 ore?').intent, 'none')
assert.equal(detectPhoneActionIntent('Portami a Milano').kind, 'navigate')
assert.equal(detectEnergyMathIntent('Portami a Milano').intent, 'none')
assert.equal(detectEnergyMathIntent("Cos'è un kWh?").intent, 'none')

// --- Follow-ups ---
{
  const mem = new Map()
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  }
  clearEnergyMathContext(storage)
  const first = applyEnergyMathIntent({ text: '2 kW per 3 ore', languageHint: 'it' })
  assert.equal(first.status, 'ok')
  saveEnergyMathContext(first.energyContext, storage)
  const ctx = loadEnergyMathContext(storage)

  const e8 = applyEnergyMathIntent({
    text: 'E per 8 ore?',
    languageHint: 'it',
    energyContext: ctx,
  })
  assert.equal(e8.status, 'ok')
  approx(e8.result, 16)

  saveEnergyMathContext(e8.energyContext, storage)
  const wh = applyEnergyMathIntent({
    text: 'Adesso in Wh',
    languageHint: 'it',
    energyContext: loadEnergyMathContext(storage),
  })
  assert.equal(wh.status, 'ok')
  approx(wh.result, 16000)

  let copied = ''
  const copy = applyEnergyMathIntent({
    text: 'Copia il risultato',
    languageHint: 'it',
    energyContext: loadEnergyMathContext(storage),
    env: {
      copyTextSync: (t) => {
        copied = t
        return true
      },
    },
  })
  assert.equal(copy.status, 'ok')
  assert.ok(copied.length > 0)

  const stale = applyEnergyMathIntent({
    text: 'E per 1 ora?',
    languageHint: 'it',
    energyContext: { ...first.energyContext, expiresAt: Date.now() - 1000 },
  })
  assert.equal(stale.handled, false)
}

console.log('energy-math.test.mjs: ok')
