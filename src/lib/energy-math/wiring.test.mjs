/**
 * #320 — Wiring / router-order smoke tests.
 * #330A — long generic input must fall through local math routers toward Core.
 */
import assert from 'node:assert/strict'
import { detectEnergyMathIntent, applyEnergyMathIntent } from '../energyMath.js'
import { detectUnitConversionIntent, applyUnitConversionIntent } from '../unitConversion.js'
import { detectCalculatorIntent, applyCalculatorIntent } from '../calculator.js'
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

// #330A — simulate ChatContext order: EM → Unit → Calc; long generic → none → Core reachable
{
  const HEALTH = `Sono a 22 ore di digiuno adesso e sto facendo il mio solito digiuno
prolungato. È possibile, secondo te, avere fame dopo le 24 ore di
digiuno? O passa completamente, io mi nutro prevalentemente in una
dieta carnivora e tuorli crudi? Le mie analisi sono perfette. Sono
quindi in chetosi. Ho il diabete di tipo 1. Digiunando ho potuto
guarire molto meglio, grazie anche ovviamente alla dieta che seguo.`

  function routeLocalMath(content) {
    const energyIntent = detectEnergyMathIntent(content, { languageHint: 'it' })
    if (energyIntent.intent === 'energy-math') {
      const em = applyEnergyMathIntent({ text: content, languageHint: 'it' })
      if (em.handled && em.reply) return { route: 'energy-math', reply: em.reply }
    }
    const unitIntent = detectUnitConversionIntent(content, { languageHint: 'it' })
    if (unitIntent.intent === 'unit-conversion') {
      const unit = applyUnitConversionIntent({ text: content, languageHint: 'it' })
      if (unit.handled && unit.reply) return { route: 'unit-conversion', reply: unit.reply }
    }
    const calc = detectCalculatorIntent(content, { languageHint: 'it' })
    if (calc.intent === 'calculator') {
      const c = applyCalculatorIntent({ text: content, languageHint: 'it' })
      if (c.handled && c.reply) return { route: 'calculator', reply: c.reply }
    }
    return { route: 'core', reply: null }
  }

  for (const n of [281, 500, 2000, 5000]) {
    const text = ('Messaggio generico di conversazione. ' + 'parola '.repeat(2000)).slice(0, n)
    const r = routeLocalMath(text)
    assert.equal(r.route, 'core', `len=${n} must reach Core path`)
  }
  assert.equal(routeLocalMath(HEALTH).route, 'core')
  assert.equal(routeLocalMath('2 kW per 3 ore').route, 'energy-math')
  assert.equal(routeLocalMath('10 km in miglia').route, 'unit-conversion')
  assert.equal(routeLocalMath('2+2').route, 'calculator')
  assert.equal(routeLocalMath('Quanto fa 15% di 240?').route, 'calculator')
}

console.log('energy-math wiring.test.mjs: ok')
