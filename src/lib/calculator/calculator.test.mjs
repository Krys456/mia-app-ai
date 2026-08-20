/**
 * #318 — Calculator engine tests.
 * Run: node src/lib/calculator/calculator.test.mjs
 */

import assert from 'node:assert/strict'
import { detectPhoneActionIntent } from '../phone-action/intent.js'
import { detectTimerIntent } from '../timer/intent.js'
import { detectWeatherIntent } from '../weather/intent.js'
import {
  applyCalculatorIntent,
  createCalculationContext,
  detectCalculatorIntent,
  evaluateExpression,
  formatDisplayResult,
  isCalculationContextFresh,
  sanitizeNumber,
  tryPercentageTemplate,
} from '../calculator.js'

function calc(text, ctx = null, lang = 'it') {
  return applyCalculatorIntent({
    text,
    languageHint: lang,
    calcContext: ctx,
    env: { copyTextSync: () => true },
  })
}

// --- Expressions ---
assert.equal(evaluateExpression('2+2').result, 4)
assert.equal(evaluateExpression('2+3*4').result, 14)
assert.equal(evaluateExpression('(2+3)*4').result, 20)
assert.equal(evaluateExpression('-5+3').result, -2)
assert.equal(evaluateExpression('10*-2').result, -20)
assert.equal(evaluateExpression('2^10').result, 1024)
assert.equal(evaluateExpression('2**10').result, 1024)
assert.equal(evaluateExpression('sqrt(144)').result, 12)
assert.equal(evaluateExpression('√144').result, 12)
assert.equal(sanitizeNumber(0.1 + 0.2), 0.3)
assert.equal(evaluateExpression('0.1+0.2').result, 0.3)
assert.equal(evaluateExpression('3.5e8').result, 3.5e8)
assert.equal(evaluateExpression('3.5×10^8').result, 3.5e8)
assert.equal(evaluateExpression('2^3*4').result, 32)
assert.equal(evaluateExpression('(-3)^2').result, 9)

// --- Percentages ---
assert.equal(tryPercentageTemplate('15% di 240').result, 36)
assert.equal(tryPercentageTemplate('15% of 240').result, 36)
assert.equal(tryPercentageTemplate('Aumenta 850 del 22%').result, 1037)
assert.equal(tryPercentageTemplate('Increase 850 by 22%').result, 1037)
{
  const d = tryPercentageTemplate('Togli il 30% da 79,99')
  assert.ok(d)
  assert.equal(Number(d.result.toFixed(2)), 55.99)
}
assert.equal(tryPercentageTemplate('Take 30% off 79.99').result, Number((79.99 * 0.7).toFixed(10)))
assert.equal(tryPercentageTemplate('120 è il 20% di quale numero?').result, 600)
assert.equal(tryPercentageTemplate('120 is 20% of what number?').result, 600)
assert.equal(tryPercentageTemplate('Aggiungi IVA 22% a 100').result, 122)

// Money display
assert.match(formatDisplayResult(55.99, { language: 'it', money: true, currencySymbol: '€' }), /55,99/)

// --- Intent positives ---
for (const p of [
  '2+2',
  'Quanto fa 125 × 17?',
  '987654 / 37',
  '15% di 240',
  'Aumenta 850 del 22%',
  'Togli il 30% da 79,99',
  '120 è il 20% di quale numero?',
  'Quanto fa 2^20?',
  'sqrt(144)',
  '√144',
  '(25 + 17) × 4 / 3',
  '3.5 × 10^8',
  'Calculate 125 * 17',
  '15% of 240',
  'What is 2^20?',
]) {
  assert.equal(detectCalculatorIntent(p).intent, 'calculator', p)
}

// --- Intent negatives ---
for (const p of [
  'Ho 22 anni.',
  'Eravamo in 4.',
  'Parliamo del numero 7.',
  'Scrivi una storia con 3 personaggi.',
  "Cos'è una percentuale?",
  "Spiegami cos'è la radice quadrata",
  "Cos'è il 15%?",
  '100 EUR in USD',
  '10 km in miles',
]) {
  assert.equal(detectCalculatorIntent(p).intent, 'none', p)
}

// --- Routing conflicts ---
assert.equal(detectTimerIntent('Timer di 10 minuti.').kind, 'start')
assert.equal(detectCalculatorIntent('Timer di 10 minuti.').intent, 'none')
assert.equal(detectPhoneActionIntent('Portami a Roma').kind, 'navigate')
assert.equal(detectCalculatorIntent('Portami a Roma').intent, 'none')
assert.equal(detectPhoneActionIntent('Apri YouTube').kind, 'open_app')
assert.equal(detectWeatherIntent('Che tempo fa a Milano?').intent, 'weather')
assert.equal(detectCalculatorIntent('Che tempo fa a Milano?').intent, 'none')
assert.equal(detectCalculatorIntent('Trova un ristorante a Milano').intent, 'none')
assert.equal(detectCalculatorIntent('2+2').intent, 'calculator')
assert.equal(detectCalculatorIntent('Quanto fa il 15% di 240?').intent, 'calculator')

// --- Apply end-to-end ---
{
  const r = calc('125 × 17')
  assert.equal(r.handled, true)
  assert.equal(r.status, 'ok')
  assert.equal(r.result, 2125)
  assert.match(r.reply, /2125|2\.125/)
}
{
  const r = calc('15% di 240')
  assert.equal(r.result, 36)
}
{
  const r = calc('Aumenta 850 del 22%')
  assert.equal(r.result, 1037)
}
{
  const r = calc('0.1 + 0.2')
  assert.equal(r.result, 0.3)
  assert.match(r.reply, /= 0[,.]3\b/)
}
{
  const r = calc('10/0')
  assert.equal(r.status, 'error')
  assert.match(r.reply, /zero/i)
}
{
  const r = calc('sqrt(-1)')
  assert.equal(r.status, 'error')
}

// --- Follow-ups ---
{
  const a = calc('100 + 50')
  assert.equal(a.result, 150)
  const b = calc('Dividilo per 3.', a.calcContext)
  assert.equal(b.result, 50)
  const c = calc('Aggiungi 25.', b.calcContext)
  assert.equal(c.result, 75)
  const d = calc('Moltiplicalo per 2.', c.calcContext)
  assert.equal(d.result, 150)
  const e = calc('Arrotondalo a 2 decimali.', d.calcContext)
  assert.equal(e.result, 150)
}

// TTL expiry
{
  const ctx = createCalculationContext({
    lastExpression: '1+1',
    lastResult: 2,
    displayResult: '2',
    resultType: 'number',
    operation: 'expression',
    language: 'it',
    createdAt: Date.now() - 20 * 60 * 1000,
    expiresAt: Date.now() - 5 * 60 * 1000,
  })
  assert.equal(isCalculationContextFresh(ctx), false)
  const r = calc('Dividilo per 3.', ctx)
  assert.match(r.reply, /precedente|previous|espressione/i)
}

// Copy result
{
  const a = calc('2+2')
  const c = calc('Copia il risultato', a.calcContext)
  assert.equal(c.handled, true)
  assert.match(c.reply, /copiat|copied/i)
}

// --- Security ---
for (const bad of [
  'eval(1)',
  'Function("return 1")()',
  'fetch("x")',
  'alert(1)',
  'constructor',
  '__proto__',
  '2; process.exit()',
  '1=1',
]) {
  const r = calc(bad)
  // either not handled (none) or error — never ok numeric from injection
  if (r.handled) assert.notEqual(r.status, 'ok', bad)
}

// Huge / nesting
assert.equal(evaluateExpression('2^200').status, 'error')
assert.equal(evaluateExpression('('.repeat(40) + '1' + ')'.repeat(40)).status, 'error')
assert.equal(evaluateExpression('x'.repeat(250)).status, 'error')

// (25+17)×4/3
{
  const r = evaluateExpression('(25 + 17) × 4 / 3')
  assert.equal(r.status, 'ok')
  assert.equal(sanitizeNumber(r.result), sanitizeNumber((42 * 4) / 3))
}

console.log('calculator.test.mjs: ok')
