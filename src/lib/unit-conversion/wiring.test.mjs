/**
 * #319 — Wiring / router-order smoke tests (intent layer).
 */
import assert from 'node:assert/strict'
import { detectUnitConversionIntent } from '../unitConversion.js'
import { detectCalculatorIntent } from '../calculator/intent.js'
import { detectTimerIntent } from '../timer/intent.js'
import { detectWeatherIntent } from '../weather/intent.js'

// Unit before Weather (intent both may fire; Unit must claim conversion)
assert.equal(detectUnitConversionIntent('25 gradi Celsius in Fahrenheit').intent, 'unit-conversion')
assert.equal(detectUnitConversionIntent('Che temperatura fa?').intent, 'none')
assert.equal(detectWeatherIntent('Che temperatura fa?').intent, 'weather')

// Timer vs duration conversion
assert.equal(detectTimerIntent('Timer di 5 minuti').kind, 'start')
assert.equal(detectUnitConversionIntent('Timer di 5 minuti').intent, 'none')
assert.equal(detectUnitConversionIntent('2 ore in minuti').intent, 'unit-conversion')
assert.notEqual(detectTimerIntent('2 ore in minuti').kind, 'start')

// Calculator vs units
assert.equal(detectCalculatorIntent('2 + 2').intent, 'calculator')
assert.equal(detectUnitConversionIntent('2 + 2').intent, 'none')
assert.equal(detectUnitConversionIntent('5000 W in kW').intent, 'unit-conversion')
assert.equal(detectCalculatorIntent('5000 W in kW').intent, 'none')

console.log('wiring.test.mjs: ok')
