#!/usr/bin/env node
/**
 * Concrete initiative delivery + language detection regressions (A–J).
 * Run: node lib/server/v2/brain/concrete-initiative-delivery.test.mjs
 */

import {
  hasGenericInitiativePlaceholder,
  responseEstablishesConcreteSubject,
  hasSubstantiveSubjectDevelopment,
} from './topic-validation.js'
import { detectLanguage, perceive, inferStickyLanguage } from './perception.js'
import { think } from './mind.js'
import { plan } from './planner.js'
import { buildConversationState } from './conversation-state.js'
import { deriveConversationSignals } from './conversation-signals.js'
import {
  evaluateContractFidelity,
  requiresConcreteInitiativeDelivery,
} from './contract-evaluator.js'
import { assembleInstructions } from './writer.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  — ${name}`)
  } catch (error) {
    failed += 1
    const message = error instanceof Error ? error.message : String(error)
    console.error(`  FAIL — ${name}`)
    console.error(`        ${message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function runTurn(userMessage, messages) {
  const msgs = messages || [{ role: 'user', content: userMessage }]
  const perception = perceive({ userMessage, messages: msgs })
  const signals = deriveConversationSignals({ userMessage, messages: msgs })
  const state = buildConversationState({
    messages: msgs,
    perception,
    conversationSignals: signals,
  })
  const decision = think({
    perception,
    conversationState: state,
    conversationSignals: signals,
    userMessage,
  })
  const p = plan({
    perception,
    decision,
    messages: msgs,
    conversationState: state,
    conversationSignals: signals,
    userMessage,
  })
  return { perception, state, decision, p, msgs, signals }
}

const GOOD_IT =
  'Ti lancio una curiosità: i polpi hanno tre cuori, e due di questi smettono temporaneamente di battere quando nuotano.'
const PLACEHOLDER_IT = 'Sembra un buon momento per esplorare qualcosa di interessante!'
const PLACEHOLDER_ACK =
  'Capisco, a volte è difficile trovare un argomento. È una cosa sorprendente!'
const NAME_ONLY = 'Parliamo dei polpi!'

console.log('Concrete initiative delivery + language tests\n')

test('A. "Non so di cosa parlare" — plan requires delivery; good answer passes QA', () => {
  const { perception, state, decision, p, msgs, signals } = runTurn('Non so di cosa parlare')
  assert(
    perception.intent === 'boredom' || decision.strategy === 'explore',
    `intent=${perception.intent} strategy=${decision.strategy}`,
  )
  assertEqual(state.activeTopic, null, 'topic null')
  assert(
    requiresConcreteInitiativeDelivery(p.writerBrief, p, state),
    'requires concrete initiative delivery',
  )
  assertEqual(p.writerBrief.shouldAskQuestion, false, 'no ask')
  const good = evaluateContractFidelity({
    responseText: GOOD_IT,
    plan: p,
    conversationState: state,
    conversationSignals: signals,
    userMessage: 'Non so di cosa parlare',
    messages: msgs,
  })
  assert(good.ok, `good must pass: ${good.violations.map((v) => v.code).join(',')}`)
  assert(responseEstablishesConcreteSubject(GOOD_IT), 'subject')
  assert(hasSubstantiveSubjectDevelopment(GOOD_IT), 'development')
})

test('B. "Mi annoio" — same concrete subject + detail requirement', () => {
  const { state, p, msgs, signals } = runTurn('Mi annoio')
  assert(requiresConcreteInitiativeDelivery(p.writerBrief, p, state), 'requires delivery')
  const bad = evaluateContractFidelity({
    responseText: PLACEHOLDER_IT,
    plan: p,
    conversationState: state,
    conversationSignals: signals,
    userMessage: 'Mi annoio',
    messages: msgs,
  })
  assert(!bad.ok, 'placeholder must fail')
  const good = evaluateContractFidelity({
    responseText: GOOD_IT,
    plan: p,
    conversationState: state,
    conversationSignals: signals,
    userMessage: 'Mi annoio',
    messages: msgs,
  })
  assert(good.ok, `good must pass: ${good.violations.map((v) => v.code).join(',')}`)
})

test('C. Placeholder exploration language → missing_concrete_initiative_delivery', () => {
  const { state, p, msgs } = runTurn('Mi annoio')
  assert(hasGenericInitiativePlaceholder(PLACEHOLDER_IT), 'detect placeholder')
  assertEqual(responseEstablishesConcreteSubject(PLACEHOLDER_IT), false, 'no subject')
  const ev = evaluateContractFidelity({
    responseText: PLACEHOLDER_IT,
    plan: p,
    conversationState: state,
    userMessage: 'Mi annoio',
    messages: msgs,
  })
  assert(
    ev.violations.some((v) => v.code === 'missing_concrete_initiative_delivery'),
    `codes=${ev.violations.map((v) => v.code).join(',')}`,
  )
  assert(ev.needsRewrite, 'rewrite')
  assert(
    /Do not describe the intention to introduce a topic/i.test(String(ev.rewriteBrief)),
    'rewrite brief',
  )

  const ev2 = evaluateContractFidelity({
    responseText: PLACEHOLDER_ACK,
    plan: p,
    conversationState: state,
    userMessage: 'Non so di cosa parlare',
    messages: msgs,
  })
  assert(
    ev2.violations.some((v) => v.code === 'missing_concrete_initiative_delivery'),
    `ack placeholder codes=${ev2.violations.map((v) => v.code).join(',')}`,
  )
})

test('D. Concrete subject + substantive fact → passes', () => {
  assert(responseEstablishesConcreteSubject(GOOD_IT), 'establishes')
  assert(hasSubstantiveSubjectDevelopment(GOOD_IT), 'develops')
  const { state, p, msgs } = runTurn('Non so di cosa parlare')
  const ev = evaluateContractFidelity({
    responseText: GOOD_IT,
    plan: p,
    conversationState: state,
    userMessage: 'Non so di cosa parlare',
    messages: msgs,
  })
  assert(ev.ok, `codes=${ev.violations.map((v) => v.code).join(',')}`)
  assertEqual(
    ev.violations.some((v) =>
      /missing_concrete_initiative_delivery|missing_subject_development/.test(v.code),
    ),
    false,
    'no delivery violations',
  )
})

test('E. Subject named without development → missing_subject_development', () => {
  assert(responseEstablishesConcreteSubject(NAME_ONLY), 'names subject')
  assertEqual(hasSubstantiveSubjectDevelopment(NAME_ONLY), false, 'no development')
  const { state, p, msgs } = runTurn('Mi annoio')
  const ev = evaluateContractFidelity({
    responseText: NAME_ONLY,
    plan: p,
    conversationState: state,
    userMessage: 'Mi annoio',
    messages: msgs,
  })
  assert(
    ev.violations.some((v) => v.code === 'missing_subject_development'),
    `codes=${ev.violations.map((v) => v.code).join(',')}`,
  )
})

test('F. No topic menu in boredom / one_direction plan', () => {
  const { p } = runTurn('Non so di cosa parlare')
  assert(
    p.writerBrief.mustNot.some((m) => /topic menu|scienza, storia/i.test(m)),
    'bans menu',
  )
  const instr = assembleInstructions({
    plan: p,
    messages: [{ role: 'user', content: 'Non so di cosa parlare' }],
  })
  assert(/PRIMARY DELIVERY CONTRACT/i.test(instr), 'salience block present')
  assert(!/Experience guidance: proponi varie direzioni/i.test(instr), 'multi-direction guidance suppressed')
})

test('G. No follow-up question required', () => {
  const { p } = runTurn('Mi annoio')
  assertEqual(p.writerBrief.shouldAskQuestion, false, 'shouldAsk')
  const ev = evaluateContractFidelity({
    responseText: `${GOOD_IT} Vuoi saperne di più?`,
    plan: p,
    conversationState: { activeTopic: null },
    userMessage: 'Mi annoio',
    messages: [{ role: 'user', content: 'Mi annoio' }],
  })
  assert(
    ev.violations.some((v) =>
      /illegal_followup_question|unexpected_question/.test(v.code),
    ) || !ev.ok,
    'question still policed',
  )
})

test('H. Italian "Mi annoio" → language = it', () => {
  assertEqual(detectLanguage('Mi annoio'), 'it', 'detect')
  assertEqual(perceive({ userMessage: 'Mi annoio' }).language, 'it', 'perceive')
  for (const phrase of ['Non so', 'Come stai', 'Va bene', 'Continua', 'Dai', 'Che noia']) {
    assertEqual(detectLanguage(phrase), 'it', phrase)
  }
})

test('I. Existing Italian conversation + short Italian utterance stays it', () => {
  const messages = [
    { role: 'user', content: 'Ciao, come stai?' },
    { role: 'assistant', content: 'Bene grazie. Di cosa ti va di parlare oggi?' },
    { role: 'user', content: 'Dai' },
  ]
  assertEqual(inferStickyLanguage(messages), 'it', 'sticky')
  const snap = perceive({ userMessage: 'Dai', messages })
  assertEqual(snap.language, 'it', 'perceive sticky')
  const snap2 = perceive({
    userMessage: 'Va bene',
    messages: [
      { role: 'user', content: 'Non so di cosa parlare' },
      { role: 'assistant', content: GOOD_IT },
      { role: 'user', content: 'Va bene' },
    ],
  })
  assertEqual(snap2.language, 'it', 'va bene sticky')
})

test('J. Real English utterance → language = en', () => {
  assertEqual(detectLanguage("I don't know what to talk about"), 'en', 'bored en phrase')
  assertEqual(detectLanguage('Hello there, how are you?'), 'en', 'hello')
  assertEqual(perceive({ userMessage: 'I am bored and need something to do' }).language, 'en', 'perceive')
})

test('prompt audit: initiative turn surfaces objective before voice corpus', () => {
  const { p } = runTurn('Non so di cosa parlare')
  const instr = assembleInstructions({
    plan: p,
    messages: [{ role: 'user', content: 'Non so di cosa parlare' }],
  })
  const primaryAt = instr.indexOf('PRIMARY DELIVERY CONTRACT')
  const objectiveAt = instr.indexOf('Introduce one concrete interesting subject')
  const voiceAt = instr.search(/VOICE|voice corpus|VOICE EXAMPLES/i)
  assert(primaryAt >= 0 && primaryAt < 200, 'primary near top')
  assert(objectiveAt >= 0, 'objective present')
  if (voiceAt >= 0) {
    assert(primaryAt < voiceAt, 'primary before voice material')
  }
})

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
