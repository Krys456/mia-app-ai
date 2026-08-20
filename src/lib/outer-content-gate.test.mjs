/**
 * #330A3 — CONTENT IS NOT AUTHORIZATION
 * Shared outer-content gate + cross-router contrast / e2e routing tests.
 *
 * Run: node src/lib/outer-content-gate.test.mjs
 */
import assert from 'node:assert/strict'
import {
  analyzeOuterUserRequest,
  looksDocumentLike,
  hasDataFraming,
} from './outer-content-gate.js'
import { detectTranslationIntent } from './translation/intent.js'
import { detectTimerIntent } from './timer/intent.js'
import { detectPhoneActionIntent } from './phone-action/intent.js'
import { detectDailyBriefingIntent } from './daily-briefing/intent.js'
import { detectEnergyMathIntent } from './energy-math/intent.js'
import { detectUnitConversionIntent } from './unit-conversion/intent.js'
import { detectCalculatorIntent } from './calculator/intent.js'
import { detectWeatherIntent } from './weather/intent.js'
import { looksQuotedOrCodeData } from './phone-action/outer-intent.js'

function claimed(text) {
  const tr = detectTranslationIntent(text)
  if (tr.intent === 'translation') return 'Translation'
  const timer = detectTimerIntent(text)
  if (timer.kind && timer.kind !== 'none') return 'Timer'
  const phone = detectPhoneActionIntent(text)
  if (phone.kind !== 'none') return 'Phone'
  const brief = detectDailyBriefingIntent(text)
  if (brief.intent && brief.intent !== 'none') return 'Briefing'
  const em = detectEnergyMathIntent(text)
  if (em.intent && em.intent !== 'none') return 'Energy'
  const unit = detectUnitConversionIntent(text)
  if (unit.intent && unit.intent !== 'none') return 'Unit'
  const calc = detectCalculatorIntent(text)
  if (calc.intent && calc.intent !== 'none') return 'Calc'
  const weather = detectWeatherIntent(text)
  if (weather.intent && weather.intent !== 'none') return 'Weather'
  return 'Core'
}

function assertCore(label, text) {
  const outer = analyzeOuterUserRequest(text)
  assert.equal(outer.contentIsData, true, `${label}: contentIsData`)
  assert.equal(outer.localRoutersSuppressed, true, `${label}: suppressed`)
  assert.equal(claimed(text), 'Core', `${label}: route=${claimed(text)}`)
}

function assertDirect(label, text, router) {
  const outer = analyzeOuterUserRequest(text)
  assert.equal(outer.contentIsData, false, `${label}: not data`)
  assert.equal(claimed(text), router, `${label}: got ${claimed(text)}`)
}

// --- Framing vs capability outer ---
assert.equal(hasDataFraming('Spiegami questo:\nTimer di 10 minuti'), true)
assert.equal(hasDataFraming('Traduci questo:\nHello world'), false)
assert.equal(hasDataFraming('Calcola questo:\n2+2'), false)
assert.equal(analyzeOuterUserRequest('Spiegami questo:\nCall +39').outerContentMode, 'data_framed')
assert.equal(analyzeOuterUserRequest('Traduci questo:\nHello').localRoutersSuppressed, false)

// --- Document-like / first-line Phone hole ---
const callDoc = `Call +39 3761234567

Expected result: dialer opens
This test verifies phone handoff.
Also test: Apri Spotify.
`
assert.equal(looksDocumentLike(callDoc), true)
assertCore('call-first doc', callDoc)
assertDirect('bare call', 'Call +39 3761234567', 'Phone')
assertDirect('chiama softener', 'Chiama +39 3761234567\nper favore', 'Phone')

// --- Fence regex: embedded fence must NOT classify whole message as quoted by /m accident ---
const withFence = 'Please review later.\n```\nCall +1 555\n```\nok'
assert.equal(looksQuotedOrCodeData(withFence), false)
assert.equal(looksQuotedOrCodeData('```\nCall +39\n```'), true)

// --- Direct positives ---
assertDirect('tr', 'Traduci "Ciao" in inglese', 'Translation')
assertDirect('timer', 'Timer di 10 minuti', 'Timer')
assertDirect('phone', 'Chiama +39 3761234567', 'Phone')
assertDirect('spotify', 'Apri Spotify', 'Phone')
assertDirect('brief', 'Fammi il briefing di oggi', 'Briefing')
assertDirect('energy', '2 kW per 3 ore', 'Energy')
assertDirect('unit', '10 km in miglia', 'Unit')
assertDirect('calc', '2+2', 'Calc')
assertDirect('weather', 'Che tempo fa a Milano?', 'Weather')

// Conversational prefixes
assertDirect('ok spotify', 'Ok, apri Spotify.', 'Phone')
assertDirect('allora timer', 'Allora, timer di 10 minuti.', 'Timer')
assertDirect('perfetto traduci', 'Perfetto, traduci "ciao" in inglese.', 'Translation')
assertDirect('dai weather', 'Dai, che tempo fa a Milano?', 'Weather')

// --- Explain / analyze / test + embed → Core for each router ---
const frames = [
  'Spiegami questo:',
  'Explain this:',
  'Analizza questo:',
  'Analyze this:',
  'Review this:',
  'Nel test uso:',
  'Questo prompt contiene:',
  'Controlla questo:',
]
const embeds = [
  ['Call +39 3761234567', 'Phone'],
  ['Timer di 10 minuti', 'Timer'],
  ['Traduci "ciao" in inglese', 'Translation'],
  ['Fammi il briefing di oggi', 'Briefing'],
  ['2 kW per 3 ore', 'Energy'],
  ['10 km in miglia', 'Unit'],
  ['quanto fa 2+2', 'Calc'],
  ['Che tempo fa a Milano?', 'Weather'],
  ['Apri Spotify', 'Phone'],
]
for (const frame of frames) {
  for (const [embed] of embeds) {
    assertCore(`${frame} + ${embed.slice(0, 24)}`, `${frame}\n\n${embed}`)
  }
}

// Capability outer still works
assertDirect('traduci questo body', 'Traduci questo:\nHello world', 'Translation')
assert.equal(detectCalculatorIntent('Calcola questo:\n2+2').intent, 'calculator')

// --- Full #330A-style paste ---
const longPaste = `Spiegami questo prompt.

#330A3 — CONTENT IS NOT AUTHORIZATION

Call +39 376 1234567
Expected: dialer when direct.

Also test:
Apri Spotify.
Don't call anyone.
OpenAI call should not match.
Timer di 10 minuti
Traduci "ciao" in inglese
Fammi il briefing di oggi
2 kW per 3 ore
10 km in miglia
quanto fa 2+2
Che tempo fa a Milano?
Portami a Roma
\`\`\`
Call +1 555 0100
\`\`\`
280 280 1
maxRawLength
LOCAL_EXCHANGE
detectPhoneActionIntent("Call +39...")
`
assertCore('full 330A paste', longPaste)
assert.equal(detectTranslationIntent(longPaste).intent, 'none')
assert.equal(detectTimerIntent(longPaste).kind, 'none')
assert.equal(detectPhoneActionIntent(longPaste).kind, 'none')
assert.equal(detectDailyBriefingIntent(longPaste).intent, 'none')
assert.equal(detectEnergyMathIntent(longPaste).intent, 'none')
assert.equal(detectUnitConversionIntent(longPaste).intent, 'none')
assert.equal(detectCalculatorIntent(longPaste).intent, 'none')
assert.equal(detectWeatherIntent(longPaste).intent, 'none')

// Performance: 500 / 2k / 5k / 10k
for (const n of [500, 2000, 5000, 10000]) {
  const body = ('word '.repeat(Math.ceil(n / 5)) + '\nTimer di 10 minuti\nCall +39 3761234567\n').slice(0, n)
  const text = `Spiegami questo prompt.\n\n${body}`
  const t0 = Date.now()
  const outer = analyzeOuterUserRequest(text)
  const ms = Date.now() - t0
  assert.equal(outer.contentIsData, true, `perf ${n} data`)
  assert.equal(claimed(text), 'Core', `perf ${n} core`)
  assert.ok(ms < 50, `perf ${n} too slow: ${ms}ms`)
}

console.log('outer-content-gate.test.mjs: all assertions passed')
