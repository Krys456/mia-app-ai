/**
 * #320 — Wiring / router-order smoke tests.
 */
import assert from 'node:assert/strict'
import { detectEnergyMathIntent } from '../energyMath.js'
import { detectUnitConversionIntent } from '../unitConversion.js'
import { detectCalculatorIntent } from '../calculator/intent.js'
import { detectTimerIntent } from '../timer/intent.js'

assert.equal(detectEnergyMathIntent('2 kW per 3 ore').intent, 'energy-math')
assert.equal(detectUnitConversionIntent('2 kW per 3 ore').intent, 'none')
assert.equal(detectUnitConversionIntent('12 kWh in 6 ore: potenza media').intent, 'none')
assert.equal(detectEnergyMathIntent('12 kWh in 6 ore: potenza media').intent, 'energy-math')
assert.equal(detectUnitConversionIntent('2 kW in W').intent, 'unit-conversion')
assert.equal(detectTimerIntent('Timer di 3 ore').kind, 'start')
assert.equal(detectEnergyMathIntent('Timer di 3 ore').intent, 'none')
assert.equal(detectCalculatorIntent('2 + 3').intent, 'calculator')
assert.equal(detectEnergyMathIntent('2 + 3').intent, 'none')

console.log('energy-math wiring.test.mjs: ok')
