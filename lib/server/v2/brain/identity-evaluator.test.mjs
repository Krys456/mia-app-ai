#!/usr/bin/env node
/**
 * Unit tests for LAIfe V2 Identity Evaluator (experimental).
 * Pure measurement — no LLM, no pipeline wiring, no rewrites.
 *
 * Run: node lib/server/v2/brain/identity-evaluator.test.mjs
 */

import {
  IDENTITY_EVALUATOR_VERSION,
  evaluateIdentity,
  createIdentityEvaluator,
  isIdentityEvaluation,
  normalizeSummary,
  scoreGenericity,
  scoreSignature,
  scoreMemorability,
  scoreCoherence,
} from './identity-evaluator.js'

let passed = 0
let failed = 0

/**
 * @param {string} name
 * @param {() => void} fn
 */
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  — ${name}`)
  } catch (error) {
    failed += 1
    console.error(`  FAIL — ${name}`)
    console.error(`        ${error instanceof Error ? error.message : error}`)
  }
}

/**
 * @param {unknown} cond
 * @param {string} msg
 */
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} label
 */
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`)
  }
}

/**
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 * @param {string} label
 */
function assertBetween(n, lo, hi, label) {
  if (typeof n !== 'number' || n < lo || n > hi) {
    throw new Error(`${label} (expected ${lo}..${hi}, got ${n})`)
  }
}

const PLAN_CONNECT = {
  objective: 'connect__need_connection__one_spark',
  writerBrief: {
    strategy: 'connect',
    need: 'connection',
    tone: 'warm',
    coda: 'spark',
    mustNot: ['Do not ask a question.'],
  },
  constraints: ['ask_question:no', 'hard:no_question', 'strategy:connect'],
}

const PLAN_SUPPORT = {
  objective: 'support__need_emotional_care',
  writerBrief: {
    strategy: 'support',
    need: 'emotional_care',
    tone: 'supportive',
    coda: 'none',
  },
  constraints: ['ask_question:no', 'strategy:support'],
}

console.log(`\nIdentity Evaluator tests (${IDENTITY_EVALUATOR_VERSION})\n`)

test('1. version exported', () => {
  assert(/identity-evaluator/.test(IDENTITY_EVALUATOR_VERSION), 'version tag')
})

test('2. evaluateIdentity returns full shape', () => {
  const r = evaluateIdentity({
    response: 'Sto bene, grazie. Il profumo del caffè aiuta un po’.',
    plannerSummary: PLAN_CONNECT,
  })
  assert(isIdentityEvaluation(r), 'shape')
  assertBetween(r.identityScore, 0, 1, 'identityScore')
  assertBetween(r.genericity, 0, 1, 'genericity')
  assertBetween(r.signature, 0, 1, 'signature')
  assertBetween(r.memorability, 0, 1, 'memorability')
  assertBetween(r.coherence, 0, 1, 'coherence')
  assert(Array.isArray(r.reasons) && r.reasons.length > 0, 'reasons')
  assert(Array.isArray(r.suggestions), 'suggestions')
})

test('3. generic soft stack scores high genericity / lower identity', () => {
  const generic = evaluateIdentity({
    response:
      'È bello potersi connettere. Le piccole cose della vita possono davvero fare la differenza. È sorprendente come un semplice scambio possa portare luce nella giornata.',
    plannerSummary: PLAN_CONNECT,
  })
  const specific = evaluateIdentity({
    response: 'Sto bene. Stamattina il caffè aveva un odore di tostatura quasi dolce.',
    plannerSummary: PLAN_CONNECT,
  })
  assert(generic.genericity > specific.genericity, 'generic more generic')
  assert(specific.identityScore > generic.identityScore, 'specific more LAIfe')
  assert(specific.signature > generic.signature, 'specific has more signature')
})

test('4. signature rewards concrete sensory detail', () => {
  const s = scoreSignature('Il profumo del caffè e il calore del sole sulla finestra.')
  assert(s.score >= 0.5, `signature score ${s.score}`)
  assert(s.notes.includes('concrete_signal'), 'concrete note')
})

test('5. memorability prefers compact + concrete over soft stack', () => {
  const compact = scoreMemorability('Un ricordo breve: la canzone dal tram sulla pioggia.')
  const stack = scoreMemorability(
    'È bello connettersi. Le piccole cose fanno la differenza. Portare luce nella giornata aiuta sempre. Qui c’è spazio per riflettere insieme.',
  )
  assert(compact.score > stack.score, 'compact more memorable')
})

test('6. coherence penalizes question when planner forbids it', () => {
  const bad = scoreCoherence(
    'Ciao! Come va la tua giornata?',
    normalizeSummary(PLAN_CONNECT),
  )
  const good = scoreCoherence(
    'Ciao. Stamattina c’è un silenzio strano fuori.',
    normalizeSummary(PLAN_CONNECT),
  )
  assert(bad.notes.includes('question_against_plan'), 'flags question')
  assert(good.score > bad.score, 'no-question better')
})

test('7. coherence rewards support presence on support plan', () => {
  const r = scoreCoherence(
    'Mi dispiace. Posso solo immaginare quanto pesi.',
    normalizeSummary(PLAN_SUPPORT),
  )
  assert(r.notes.includes('support_presence') || r.score >= 0.55, 'support signal')
})

test('8. normalizeSummary reads plan objects', () => {
  const n = normalizeSummary(PLAN_CONNECT)
  assertEqual(n.strategy, 'connect', 'strategy')
  assertEqual(n.coda, 'spark', 'coda')
  assert(/hard:no_question/.test(n.text), 'constraints in text')
})

test('9. normalizeSummary accepts plain strings', () => {
  const n = normalizeSummary('strategy=connect coda=spark ask_question:no')
  assert(/strategy=connect/.test(n.text), 'string kept')
})

test('10. optional writerSummary does not throw', () => {
  const r = evaluateIdentity({
    response: 'Va bene.',
    plannerSummary: PLAN_CONNECT,
    writerSummary: { coda: 'spark', strategy: 'connect' },
  })
  assert(isIdentityEvaluation(r), 'ok with writer summary')
})

test('11. empty response is fail-soft', () => {
  const r = evaluateIdentity({ response: '', plannerSummary: PLAN_CONNECT })
  assert(r.genericity >= 0.8, 'empty is generic')
  assert(r.signature === 0, 'no signature')
  assert(r.identityScore < 0.5, 'low identity')
})

test('12. createIdentityEvaluator.evaluate matches evaluateIdentity', () => {
  const input = {
    response: 'Sto bene, grazie.',
    plannerSummary: PLAN_CONNECT,
  }
  const a = evaluateIdentity(input)
  const b = createIdentityEvaluator().evaluate(input)
  assertEqual(a.identityScore, b.identityScore, 'identityScore')
  assertEqual(a.genericity, b.genericity, 'genericity')
})

test('13. isIdentityEvaluation rejects partial objects', () => {
  assertEqual(isIdentityEvaluation(null), false, 'null')
  assertEqual(isIdentityEvaluation({ identityScore: 1 }), false, 'partial')
})

test('14. pure function: same input → same output', () => {
  const input = {
    response: 'Una nota: il silenzio del treno alle sette.',
    plannerSummary: PLAN_CONNECT,
  }
  const a = evaluateIdentity(input)
  const b = evaluateIdentity(input)
  assertEqual(JSON.stringify(a), JSON.stringify(b), 'deterministic')
})

test('15. does not mutate input objects', () => {
  const planner = { ...PLAN_CONNECT, writerBrief: { ...PLAN_CONNECT.writerBrief } }
  const before = JSON.stringify(planner)
  evaluateIdentity({
    response: 'Ciao.',
    plannerSummary: planner,
  })
  assertEqual(JSON.stringify(planner), before, 'planner untouched')
})

test('16. suggestions are unique strings', () => {
  const r = evaluateIdentity({
    response:
      'How can I help? It’s important to remember that little things make a difference.',
    plannerSummary: PLAN_CONNECT,
  })
  assertEqual(new Set(r.suggestions).size, r.suggestions.length, 'unique')
})

test('17. scoreGenericity detects helpdesk', () => {
  const g = scoreGenericity('How can I help you today?')
  assert(g.notes.includes('helpdesk_texture'), 'helpdesk')
  assert(g.score >= 0.4, 'elevated')
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
