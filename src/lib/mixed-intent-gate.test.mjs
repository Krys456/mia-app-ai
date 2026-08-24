/**
 * #364B — Mixed-intent whole-turn gate + router claim matrix.
 * Run: node src/lib/mixed-intent-gate.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MIXED_INTENT_GATE_BUILD,
  localRouterMayClaim,
  residualAfterCapabilityRemoval,
  residualLooksLikeIndependentAsk,
  shouldLocalRouterClaimWholeTurn,
} from './mixed-intent-gate.js'
import { detectTranslationIntent } from './translation/intent.js'
import { detectCalculatorIntent } from './calculator/intent.js'
import { detectWeatherIntent } from './weather/intent.js'
import { detectUnitConversionIntent } from './unitConversion.js'
import { detectReminderIntent } from './reminder-chat/intent.js'
import { detectDailyBriefingIntent } from './daily-briefing/intent.js'
import { detectTimerIntent } from './timer/intent.js'
import { detectEmailIntent } from './email-chat/intent.js'
import { CONVERSATIONAL_UNDERSTANDING_CONTRACT } from '../../lib/server/conversational-understanding.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const chatCtx = readFileSync(join(root, 'src/context/ChatContext.tsx'), 'utf8')

assert.equal(MIXED_INTENT_GATE_BUILD, '364b-1')

/** @param {boolean} expectClaim */
function assertClaim(label, expectClaim, input) {
  const g = shouldLocalRouterClaimWholeTurn(input)
  assert.equal(
    g.claimWholeTurn,
    expectClaim,
    `${label}: expected claim=${expectClaim} got ${g.claimWholeTurn} (${g.reason}) residual=${JSON.stringify(g.residual)}`,
  )
  return g
}

// —— Residual helpers ——
{
  const r = residualAfterCapabilityRemoval(
    "Come si dice 'sweet spot'? Comunque meglio 6 o 8 ripetizioni?",
    { routerType: 'translation', detectedSpan: 'sweet spot' },
  )
  assert.ok(residualLooksLikeIndependentAsk(r), 'mixed residual should look like an ask')
  const pure = residualAfterCapabilityRemoval("Come si dice 'sweet spot' in italiano?", {
    routerType: 'translation',
    detectedSpan: 'sweet spot',
  })
  assert.equal(residualLooksLikeIndependentAsk(pure), false)
}

// —— A. Reported fitness failure (#364A) ——
{
  const full =
    "Allora sto rifacendo la scheda: meglio 6 o 8 ripetizioni per l'ipertrofia? Poi camminata in salita Zone 2, e 'the right spot' come si dice in inglese?"
  const ti = detectTranslationIntent(full, { languageHint: 'it', hasTranslationContext: false })
  assert.equal(ti.intent, 'translation')
  // Extraction may grab a bad apostrophe span (l'ipertrofia…); gate must still refuse.
  const g = assertClaim('A fitness mixed', false, {
    routerType: 'translation',
    fullText: full,
    detectedSpan: ti.sourceText,
  })
  assert.ok(g.residualAsk || /ripetizioni|scheda|ipertrofia|camminat|right spot/i.test(g.residual))
  const may = localRouterMayClaim(ti.intent === 'translation', {
    routerType: 'translation',
    fullText: full,
    detectedSpan: ti.sourceText,
  })
  assert.equal(may.claimWholeTurn, false)
}

// —— B. Pure translation ——
for (const q of [
  "Traduci 'the right spot'.",
  "Come si dice 'sweet spot' in italiano?",
  'Translate this sentence into English.',
  "Come si dice X?",
  'Traduci questo.',
]) {
  const ti = detectTranslationIntent(q, { languageHint: 'it', hasTranslationContext: false })
  // "Traduci questo." may be translate-with-context / previous ref — still predominantly translation
  if (ti.intent === 'translation') {
    assertClaim(`B pure translation: ${q}`, true, {
      routerType: 'translation',
      fullText: q,
      detectedSpan: ti.sourceText || null,
      intentMetadata: { followUp: Boolean(ti.followUp) },
    })
  }
}

// —— C. Mixed translation + advice ——
for (const q of [
  "Poi devo scegliere 6 o 8 reps, e 'the right spot' come si dice in inglese?",
  "How do you say 'sweet spot'? Also, should I do 6 or 8 reps?",
  "Come si dice 'sweet spot'? Comunque meglio 6 o 8 ripetizioni?",
  "Traduci questa frase, ma prima dimmi se il mio piano ha senso.",
]) {
  const ti = detectTranslationIntent(q, { languageHint: 'it', hasTranslationContext: false })
  if (ti.intent === 'translation') {
    assertClaim(`C mixed translation: ${q.slice(0, 48)}`, false, {
      routerType: 'translation',
      fullText: q,
      detectedSpan: ti.sourceText || null,
    })
  } else {
    // Detector already refuses → Core path (safe)
    assert.equal(ti.intent, 'none', `C expected none or gated: ${q}`)
  }
}

// —— D. Calculator + advice ——
{
  const pure = 'Quanto fa 12×8?'
  const mixed = 'Quanto fa 12×8 e secondo te 8 reps sono troppe?'
  const pi = detectCalculatorIntent(pure, { languageHint: 'it', hasCalcContext: false })
  const mi = detectCalculatorIntent(mixed, { languageHint: 'it', hasCalcContext: false })
  assert.equal(pi.intent, 'calculator')
  assertClaim('D calc pure', true, {
    routerType: 'calculator',
    fullText: pure,
    detectedSpan: pi.expressionText || '12×8',
  })
  assertClaim('D calc mixed', false, {
    routerType: 'calculator',
    fullText: mixed,
    detectedSpan: mi.expressionText || '12×8',
  })
}

// —— E. Timer + advice ——
{
  const pure = 'Timer 20 minuti.'
  const mixed = 'Imposta un timer di 20 minuti e dimmi se 8 reps sono troppe.'
  const pi = detectTimerIntent(pure, { languageHint: 'it' })
  const mi = detectTimerIntent(mixed, { languageHint: 'it' })
  assert.ok(pi.kind && pi.kind !== 'none', `timer pure kind=${pi.kind}`)
  assert.ok(mi.kind && mi.kind !== 'none', `timer mixed kind=${mi.kind}`)
  assertClaim('E timer pure', true, { routerType: 'timer', fullText: pure, detectedSpan: null })
  assertClaim('E timer mixed', false, { routerType: 'timer', fullText: mixed, detectedSpan: null })
}

// —— F. Reminder + advice ——
{
  const pure = 'Ricordami alle 18 di chiamare mamma.'
  const mixed = 'Ricordami alle 18 di chiamare mamma, e secondo te meglio 6 o 8 reps?'
  const pi = detectReminderIntent(pure, { languageHint: 'it' })
  const mi = detectReminderIntent(mixed, { languageHint: 'it' })
  assert.equal(pi.intent, 'reminder')
  assert.equal(mi.intent, 'reminder')
  assertClaim('F rem pure', true, {
    routerType: 'reminder',
    fullText: pure,
    detectedSpan: pi.title || null,
  })
  assertClaim('F rem mixed', false, {
    routerType: 'reminder',
    fullText: mixed,
    detectedSpan: mi.title || null,
  })
}

// —— G. Weather + advice ——
{
  const pure = 'Che tempo fa a Roma?'
  const mixed = 'Che tempo fa a Roma e secondo te corro o cammino per la Zone 2?'
  const pi = detectWeatherIntent(pure, { languageHint: 'it' })
  const mi = detectWeatherIntent(mixed, { languageHint: 'it' })
  assert.equal(pi.intent, 'weather')
  assert.equal(mi.intent, 'weather')
  assertClaim('G wx pure', true, {
    routerType: 'weather',
    fullText: pure,
    detectedSpan: pi.locationText || 'Roma',
  })
  assertClaim('G wx mixed', false, {
    routerType: 'weather',
    fullText: mixed,
    detectedSpan: mi.locationText || 'Roma',
  })
}

// —— H. Units + advice ——
{
  const pure = 'Converti 5 km in miglia.'
  const mixed = 'Converti 5 km in miglia e dimmi se 8 km di corsa sono troppi.'
  const pi = detectUnitConversionIntent(pure, { languageHint: 'it', hasConversionContext: false })
  const mi = detectUnitConversionIntent(mixed, { languageHint: 'it', hasConversionContext: false })
  assert.equal(pi.intent, 'unit-conversion')
  assert.equal(mi.intent, 'unit-conversion')
  assertClaim('H units pure', true, {
    routerType: 'units',
    fullText: pure,
    detectedSpan: '5 km',
  })
  assertClaim('H units mixed', false, {
    routerType: 'units',
    fullText: mixed,
    detectedSpan: '5 km',
  })
}

// —— I. Briefing + unrelated ——
{
  const pure = 'Fammi il briefing di oggi.'
  const mixed = 'Fammi il briefing di oggi e secondo te corro o cammino?'
  const pi = detectDailyBriefingIntent(pure, { languageHint: 'it', hasBriefingContext: false })
  const mi = detectDailyBriefingIntent(mixed, { languageHint: 'it', hasBriefingContext: false })
  assert.equal(pi.intent, 'daily-briefing')
  assert.equal(mi.intent, 'daily-briefing')
  assertClaim('I brief pure', true, { routerType: 'briefing', fullText: pure, detectedSpan: null })
  assertClaim('I brief mixed', false, {
    routerType: 'briefing',
    fullText: mixed,
    detectedSpan: null,
  })
}

// —— J. Long voice-like mixed turn ——
{
  const full =
    'Allora pensavo di fare tre serie però non so se sei o otto ripetizioni, poi camminata in salita, e come si dice punto ideale in inglese, e quanto cardio dovrei fare?'
  const ti = detectTranslationIntent(full, { languageHint: 'it', hasTranslationContext: false })
  assert.equal(ti.intent, 'translation')
  assertClaim('J voice-like', false, {
    routerType: 'translation',
    fullText: full,
    detectedSpan: ti.sourceText || 'punto ideale',
  })
}

// —— Pure-intent regressions (gate claims) ——
for (const [routerType, text, span] of [
  ['translation', "Come si dice 'buongiorno' in giapponese?", 'buongiorno'],
  ['timer', 'Timer 20 minuti.', null],
  ['reminder', 'Ricordami alle 18 di fare la spesa.', null],
  ['calculator', 'Quanto fa 12×8?', '12×8'],
  ['units', 'Converti 5 km in miglia.', '5 km'],
  ['weather', 'Che tempo fa a Milano?', 'Milano'],
]) {
  assertClaim(`pure regression ${routerType}`, true, {
    routerType,
    fullText: text,
    detectedSpan: span,
  })
}

// —— Wiring: ChatContext uses the gate; no double-answer composition ——
assert.ok(chatCtx.includes('shouldLocalRouterClaimWholeTurn'))
assert.ok(chatCtx.includes("routerType: 'translation'"))
assert.ok(chatCtx.includes("routerType: 'timer'"))
assert.ok(chatCtx.includes("routerType: 'reminder'"))
assert.ok(chatCtx.includes("routerType: 'calculator'"))
assert.ok(chatCtx.includes("routerType: 'units'"))
assert.ok(chatCtx.includes("routerType: 'weather'"))
assert.ok(chatCtx.includes("routerType: 'briefing'"))
// #383B — Email now uses the whole-turn gate; Calendar / Places / Phone stay audit-only.
assert.ok(chatCtx.includes("routerType: 'email'"))
assert.equal((chatCtx.match(/routerType: 'calendar'/g) || []).length, 0)
assert.equal((chatCtx.match(/routerType: 'places'/g) || []).length, 0)
assert.equal((chatCtx.match(/routerType: 'phone'/g) || []).length, 0)

// —— #383B Email + reminder mixed turn must not claim whole turn ——
{
  const full = 'Ho email da Marco e ricordami alle 9 di rispondere'
  const ei = detectEmailIntent(full, { languageHint: 'it' })
  assert.equal(ei.intent, 'email')
  assertClaim('383B email+reminder mixed', false, {
    routerType: 'email',
    fullText: full,
    detectedSpan: ei.sender || null,
  })
  assertClaim('383B pure important email', true, {
    routerType: 'email',
    fullText: 'Quali email importanti ho?',
    detectedSpan: null,
  })
  assertClaim('383B pure write refusal still claims', true, {
    routerType: 'email',
    fullText: 'Invia una mail a Marco',
    detectedSpan: null,
  })
  assertClaim('383C English emails+reminder mixed', false, {
    routerType: 'email',
    fullText: 'Any emails from Marco and remind me at 9 to reply',
    detectedSpan: 'Marco',
  })
}

// —— Core coverage principle present ——
assert.ok(/materially distinct requests/i.test(CONVERSATIONAL_UNDERSTANDING_CONTRACT))
assert.ok(/side asks/i.test(CONVERSATIONAL_UNDERSTANDING_CONTRACT))
assert.ok(/one small clause while ignoring the main ask/i.test(CONVERSATIONAL_UNDERSTANDING_CONTRACT))

console.log('mixed-intent-gate.test.mjs: ok')
