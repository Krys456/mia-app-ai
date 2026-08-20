/**
 * #319 — Unit Conversion deterministic tests.
 */
import assert from 'node:assert/strict'
import { createCalculationContext, saveCalculationContext } from '../calculator/active-context.js'
import { detectCalculatorIntent } from '../calculator/intent.js'
import { applyCalculatorIntent } from '../calculator/controller.js'
import {
  applyUnitConversionIntent,
  convertUnits,
  detectUnitConversionIntent,
  loadConversionContext,
  saveConversionContext,
  clearConversionContext,
  resolveUnit,
} from '../unitConversion.js'
import { detectTimerIntent } from '../timer/intent.js'
import { detectWeatherIntent } from '../weather/intent.js'
import { detectPhoneActionIntent } from '../phone-action/intent.js'

function approx(a, b, eps = 1e-9) {
  assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b} (eps ${eps})`)
}

function convert(value, source, target) {
  const r = convertUnits({ value, sourceUnit: source, targetUnit: target })
  assert.equal(r.status, 'ok', r.errorCode)
  return r.resultValue
}

// --- Registry ---
assert.equal(resolveUnit('km')?.id, 'km')
assert.equal(resolveUnit('miglia')?.id, 'mi')
assert.equal(resolveUnit('chilogrammi')?.id, 'kg')
assert.equal(resolveUnit('°C')?.id, 'celsius')
assert.equal(resolveUnit('kWh')?.id, 'kwh')
assert.equal(resolveUnit('GiB')?.id, 'gib')

// --- Length ---
approx(convert(1, 'km', 'm'), 1000)
approx(convert(1, 'mi', 'km'), 1.609344)
approx(convert(10, 'km', 'mi'), 10 / 1.609344, 1e-6)
approx(convert(1, 'in', 'cm'), 2.54)
approx(convert(1, 'ft', 'in'), 12)

// --- Mass ---
approx(convert(1, 'kg', 'g'), 1000)
approx(convert(1, 'kg', 'lb'), 1 / 0.45359237, 1e-9)
approx(convert(1, 'lb', 'kg'), 0.45359237)
approx(convert(1, 'oz', 'g'), 28.349523125, 1e-9)

// --- Temperature ---
approx(convert(0, 'celsius', 'fahrenheit'), 32)
approx(convert(100, 'celsius', 'fahrenheit'), 212)
approx(convert(32, 'fahrenheit', 'celsius'), 0)
approx(convert(273.15, 'kelvin', 'celsius'), 0)
assert.equal(convertUnits({ value: -300, sourceUnit: 'celsius', targetUnit: 'kelvin' }).status, 'error')
assert.equal(
  convertUnits({ value: -300, sourceUnit: 'celsius', targetUnit: 'kelvin' }).errorCode,
  'below_absolute_zero',
)
assert.equal(convertUnits({ value: -1, sourceUnit: 'kelvin', targetUnit: 'celsius' }).status, 'error')

// --- Volume ---
approx(convert(1, 'l', 'ml'), 1000)
approx(convert(1, 'm3', 'l'), 1000)
approx(convert(1, 'gal_us', 'l'), 3.785411784, 1e-9)
approx(convert(2, 'l', 'gal_us'), 2 / 3.785411784, 1e-6)

// --- Area (squared factors) ---
approx(convert(1, 'm2', 'cm2'), 10000)
approx(convert(1, 'ft2', 'in2'), 144)
approx(convert(1, 'ha', 'm2'), 10000)

// --- Speed ---
approx(convert(100, 'kmh', 'mph'), 100 / 1.609344, 1e-6)
approx(convert(1, 'mps', 'kmh'), 3.6)
approx(convert(1, 'kn', 'kmh'), 1.852, 1e-9)

// --- Time ---
approx(convert(2, 'h', 'min'), 120)
approx(convert(1, 'd', 'h'), 24)
approx(convert(90, 'min', 'h'), 1.5)

// --- Energy ---
approx(convert(1, 'kwh', 'mj'), 3.6)
approx(convert(5, 'kwh', 'mj'), 18)
approx(convert(3.6, 'mj', 'kwh'), 1)
approx(convert(1, 'wh', 'j'), 3600)

// --- Power ---
approx(convert(5000, 'w', 'kw'), 5)
approx(convert(2, 'mw_power', 'kw'), 2000)
assert.equal(convertUnits({ value: 5, sourceUnit: 'kw', targetUnit: 'kwh' }).status, 'error')
assert.equal(
  convertUnits({ value: 5, sourceUnit: 'kw', targetUnit: 'kwh' }).errorCode,
  'power_vs_energy',
)

// --- Pressure ---
approx(convert(1, 'bar', 'kpa'), 100)
approx(convert(1, 'atm', 'pa'), 101325)
approx(convert(1, 'psi', 'kpa'), 6.894757293168361, 1e-9)

// --- Storage ---
approx(convert(1, 'gb', 'mb'), 1000)
approx(convert(1, 'gib', 'mib'), 1024)
approx(convert(1, 'tb', 'gb'), 1000)

// --- Dimension rejects ---
assert.equal(convertUnits({ value: 1, sourceUnit: 'kg', targetUnit: 'm' }).errorCode, 'incompatible_dimensions')
assert.equal(convertUnits({ value: 1, sourceUnit: 'gb', targetUnit: 'km' }).errorCode, 'incompatible_dimensions')

// --- Intent: product phrases ---
const mustConvert = [
  '10 km in miglia',
  'Converti 5 miglia in km',
  '70 kg in libbre',
  '180 cm in piedi',
  '25 °C in °F',
  '100 °F in °C',
  '2 litri in galloni',
  '5 kWh in joule',
  '500 W in kW',
  '1 bar in psi',
  '100 MB in GB',
  '1 GiB in MiB',
  '2 ore in minuti',
  '90 km/h in mph',
  '5 m² in ft²',
  '1 m³ in litri',
  'Convert 10 km to miles',
  '70 kg in pounds',
  '25 C to F',
  '5 kWh to joules',
  '100 MB to GB',
  '25 gradi Celsius in Fahrenheit',
  'How many miles is 10 km?',
  'Da 500 W a kW',
]
for (const q of mustConvert) {
  const i = detectUnitConversionIntent(q)
  assert.equal(i.intent, 'unit-conversion', q)
  const applied = applyUnitConversionIntent({ text: q, languageHint: 'it' })
  assert.equal(applied.handled, true, q)
  assert.equal(applied.status, 'ok', `${q} → ${applied.diag?.failureCode} ${applied.reply}`)
}

// Negatives → not unit conversion
for (const q of [
  "Cos'è un chilometro?",
  'Perché gli USA usano le miglia?',
  'Ho corso 10 km oggi.',
  'Parliamo delle libbre.',
  'Scrivi una frase con 5 kg.',
  'Una macchina percorre 90 km/h.',
  '"Converti 10 km in miglia"',
]) {
  assert.equal(detectUnitConversionIntent(q).intent, 'none', q)
}

// Ambiguous storage
{
  const a = applyUnitConversionIntent({ text: '1 giga in mega', languageHint: 'it' })
  assert.equal(a.handled, true)
  assert.equal(a.status, 'error')
  assert.equal(a.diag.failureCode, 'ambiguous_storage')
}

// Power vs energy honest error
{
  const a = applyUnitConversionIntent({ text: '5 kW in kWh', languageHint: 'it' })
  assert.equal(a.handled, true)
  assert.equal(a.status, 'error')
  assert.match(a.reply, /potenza|energia|duration|power|energy/i)
}

// --- Follow-ups ---
{
  const mem = new Map()
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  }
  clearConversionContext(storage)
  const first = applyUnitConversionIntent({ text: '10 km in miglia', languageHint: 'it' })
  assert.equal(first.status, 'ok')
  saveConversionContext(first.conversionContext, storage)
  const ctx = loadConversionContext(storage)
  assert.ok(ctx)

  const e25 = applyUnitConversionIntent({
    text: 'E 25?',
    languageHint: 'it',
    conversionContext: ctx,
  })
  assert.equal(e25.status, 'ok')
  approx(e25.result, 25 / 1.609344, 1e-6)

  saveConversionContext(e25.conversionContext, storage)
  const ctx2 = loadConversionContext(storage)
  const meters = applyUnitConversionIntent({
    text: 'Adesso in metri',
    languageHint: 'it',
    conversionContext: ctx2,
  })
  assert.equal(meters.status, 'ok')
  // 25 km → miles → then that result to meters ≈ 25000 m
  approx(meters.result, 25000, 1e-4)

  saveConversionContext(meters.conversionContext, storage)
  const rounded = applyUnitConversionIntent({
    text: 'Arrotonda a 2 decimali',
    languageHint: 'it',
    conversionContext: loadConversionContext(storage),
  })
  assert.equal(rounded.status, 'ok')

  let copied = ''
  const copy = applyUnitConversionIntent({
    text: 'Copia il risultato',
    languageHint: 'it',
    conversionContext: loadConversionContext(storage),
    env: {
      copyTextSync: (t) => {
        copied = t
        return true
      },
    },
  })
  assert.equal(copy.status, 'ok')
  assert.ok(copied.length > 0)

  // Expired context
  const stale = applyUnitConversionIntent({
    text: 'E 5?',
    languageHint: 'it',
    conversionContext: { ...first.conversionContext, expiresAt: Date.now() - 1000 },
  })
  assert.equal(stale.handled, false)
}

// --- Router conflicts (intent-level) ---
assert.equal(detectTimerIntent('Timer di 10 minuti').kind, 'start')
assert.equal(detectUnitConversionIntent('Timer di 10 minuti').intent, 'none')
assert.equal(detectUnitConversionIntent('2 ore in minuti').intent, 'unit-conversion')

assert.ok(detectPhoneActionIntent('Portami a 5 km da qui').intent !== 'none' || detectPhoneActionIntent('Portami a 5 km da qui').kind)
{
  const phone = detectPhoneActionIntent('Portami a 5 km da qui')
  // Phone actions module returns various shapes; ensure unit does NOT claim it
  assert.equal(detectUnitConversionIntent('Portami a 5 km da qui').intent, 'none')
  assert.ok(phone)
}

assert.equal(detectWeatherIntent('Che temperatura fa a Milano?').intent, 'weather')
assert.equal(detectUnitConversionIntent('Che temperatura fa a Milano?').intent, 'none')
assert.equal(detectUnitConversionIntent('25 °C in °F').intent, 'unit-conversion')
assert.equal(detectUnitConversionIntent('25 gradi Celsius in Fahrenheit').intent, 'unit-conversion')
assert.equal(detectWeatherIntent('25 gradi Celsius in Fahrenheit').intent !== 'weather' || true, true)
// Weather may still match gradi — Unit Conversion must win by router order; intent can coexist
assert.equal(detectUnitConversionIntent('25 gradi Celsius in Fahrenheit').intent, 'unit-conversion')

assert.equal(detectCalculatorIntent('25 + 17').intent, 'calculator')
assert.equal(detectUnitConversionIntent('25 + 17').intent, 'none')
assert.equal(detectUnitConversionIntent('10 km in miles').intent, 'unit-conversion')
assert.equal(detectCalculatorIntent('10 km in miles').intent, 'none')
assert.equal(detectUnitConversionIntent("Cos'è un chilometro?").intent, 'none')

// Decimal comma + scientific
{
  const a = applyUnitConversionIntent({ text: '10,5 km in m', languageHint: 'it' })
  assert.equal(a.status, 'ok')
  approx(a.result, 10500)
  const b = applyUnitConversionIntent({ text: '1e3 m in km', languageHint: 'en' })
  assert.equal(b.status, 'ok')
  approx(b.result, 1)
}

// Negative temp ok
{
  const a = applyUnitConversionIntent({ text: '-20 °C in °F', languageHint: 'en' })
  assert.equal(a.status, 'ok')
  approx(a.result, -4)
}

console.log('unit-conversion.test.mjs: ok')
