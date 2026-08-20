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

// --- #330A — Long generic chat must NOT be claimed by Energy Math ---
{
  const HEALTH_REPRO = `Sono a 22 ore di digiuno adesso e sto facendo il mio solito digiuno
prolungato. È possibile, secondo te, avere fame dopo le 24 ore di
digiuno? O passa completamente, io mi nutro prevalentemente in una
dieta carnivora e tuorli crudi? Le mie analisi sono perfette. Sono
quindi in chetosi. Ho il diabete di tipo 1. Digiunando ho potuto
guarire molto meglio, grazie anche ovviamente alla dieta che seguo.`

  const APP_DESIGN = `Sto progettando una nuova applicazione e vorrei ragionare
sull'interfaccia, sulle funzioni principali, sulla navigazione,
sull'identità visiva, sulle impostazioni, sulla schermata principale,
sulla gestione delle conversazioni e su come organizzare tutte queste
parti senza rendere l'esperienza troppo complicata. Vorrei inoltre
capire quali elementi conviene inserire nella prima versione e quali
rimandare agli aggiornamenti successivi.`

  const pad = (n, seed = 'Ciao, vorrei parlarti di qualcosa di importante nella mia giornata. ') =>
    (seed + 'parola '.repeat(Math.ceil(n / 7))).replace(/\s+/g, ' ').trim().slice(0, n)

  const CODE_LONG = (
    'Sto debuggando questo errore TypeError in produzione. ' +
    '```js\nfunction broken(x) {\n  return x.foo.bar;\n}\n```\n'.repeat(40) +
    'Come posso trovare la causa radice senza riscrivere tutto?'
  ).slice(0, 2000)

  const UNICODE_LONG = (
    'Café, naïve, 日本語, emoji 🚀💡, perché digiuno e chetosi non c\'entrano. ' +
    'Vorrei una spiegazione lunga su produttività e abitudini. '
  ).repeat(20)

  for (const [label, text] of [
    ['generic280', pad(280)],
    ['generic281', pad(281)],
    ['generic500', pad(500)],
    ['generic2k', pad(2000)],
    ['generic5k', pad(5000)],
    ['generic10k', pad(10000)],
    ['health', HEALTH_REPRO],
    ['app_design', APP_DESIGN],
    ['code', CODE_LONG],
    ['unicode', UNICODE_LONG],
  ]) {
    assert.ok(text.length >= 280 || label.startsWith('generic280') || label === 'health', label)
    const em = detectEnergyMathIntent(text)
    assert.equal(em.intent, 'none', `#330A Energy Math must not claim ${label} (len=${text.length})`)
    assert.notEqual(em.failureCode, 'input_too_long', label)
    const applied = applyEnergyMathIntent({ text, languageHint: 'it' })
    assert.equal(applied.handled, false, `#330A apply must not handle ${label}`)
    assert.notEqual(applied.reply, 'Richiesta troppo lunga.')
  }

  // Exact cliff: pure filler
  assert.equal(detectEnergyMathIntent('x'.repeat(280)).intent, 'none')
  assert.equal(detectEnergyMathIntent('x'.repeat(281)).intent, 'none')
  assert.equal(detectEnergyMathIntent('x'.repeat(1000)).intent, 'none')

  // True Energy Math still works under limit
  {
    const a = applyEnergyMathIntent({ text: '2 kW per 3 ore', languageHint: 'it' })
    assert.equal(a.status, 'ok')
    approx(a.result, 6)
  }

  // True Energy Math ABOVE limit → capability-specific too_long (Option A), not Core fallthrough
  {
    const longTrue = ('2 kW per 3 ore. ' + 'dettaglio '.repeat(40)).slice(0, 320)
    assert.ok(longTrue.length > 280)
    assert.ok(/2\s*kW/i.test(longTrue) && /3\s*ore/i.test(longTrue))
    const intent = detectEnergyMathIntent(longTrue)
    assert.equal(intent.intent, 'energy-math', 'shaped long EM must still claim')
    assert.equal(intent.failureCode, 'input_too_long')
    const a = applyEnergyMathIntent({ text: longTrue, languageHint: 'it' })
    assert.equal(a.handled, true)
    assert.equal(a.status, 'error')
    assert.equal(a.diag?.failureCode, 'input_too_long')
    assert.match(a.reply, /troppo lunga.*calcolo energetico|too long.*energy/i)
    assert.doesNotMatch(a.reply, /^Richiesta troppo lunga\.$/)
  }
}

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
