#!/usr/bin/env node
/**
 * Unit tests for LAIfe V2 Planner Fidelity Evaluator (experimental).
 * Pure measurement — no LLM, no pipeline wiring, no rewrites.
 *
 * Run: node lib/server/v2/brain/planner-fidelity.test.mjs
 */

import {
  PLANNER_FIDELITY_VERSION,
  evaluatePlannerFidelity,
  createPlannerFidelityEvaluator,
  normalizePlannerOutput,
  isPlannerFidelityEvaluation,
} from './planner-fidelity.js'

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
    const message = error instanceof Error ? error.message : String(error)
    console.error(`  FAIL — ${name}`)
    console.error(`        ${message}`)
  }
}

/**
 * @param {unknown} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} label
 */
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    )
  }
}

const PLAN_SUPPORT = {
  objective: 'support__need_emotional_care',
  writerBrief: {
    strategy: 'support',
    need: 'emotional_care',
    tone: 'supportive',
    depth: 'light',
    coda: 'none',
    comfort: true,
    teaching: false,
    continueTopic: false,
    must: ['Prioritize emotional recognition before help or information.'],
    mustNot: ['Do not ask a question.', 'Do not use helpdesk openers.'],
  },
  conversationMomentum: { kind: 'emotional_support', confidence: 0.8, signals: [], scores: {} },
  conversationFocus: { status: 'active', topic: 'tristezza', confidence: 0.8, signals: [], avoidClarification: true },
  constraints: [
    'strategy:support',
    'ask_question:no',
    'hard:no_question',
    'comfort:yes',
    'conversation_momentum:emotional_support',
    'conversation_focus:active',
    'focus:avoid_clarification',
  ],
}

const PLAN_LEARN = {
  objective: 'explain__need_learning',
  writerBrief: {
    strategy: 'explain',
    need: 'learning',
    tone: 'calm',
    depth: 'balanced',
    coda: 'none',
    teaching: true,
    comfort: false,
    continueTopic: true,
    must: ['Teach progressively.'],
    mustNot: ['Do not ask a question.'],
  },
  conversationMomentum: { kind: 'learning', confidence: 0.85, signals: [], scores: {} },
  conversationFocus: { status: 'active', topic: 'fotosintesi', confidence: 0.8, signals: [], avoidClarification: true },
  constraints: [
    'strategy:explain',
    'ask_question:no',
    'teach:yes',
    'conversation_momentum:learning',
  ],
}

const PLAN_CONNECT = {
  objective: 'connect__need_connection__one_spark',
  writerBrief: {
    strategy: 'connect',
    need: 'connection',
    tone: 'warm',
    depth: 'light',
    coda: 'spark',
    mustNot: ['Do not ask a question.', 'Do not use helpdesk openers like "How can I help?"'],
  },
  conversationMomentum: { kind: 'social', confidence: 0.7, signals: [], scores: {} },
  constraints: ['strategy:connect', 'ask_question:no', 'hard:no_question', 'conversation_momentum:social'],
}

console.log(`\nPlanner Fidelity tests (${PLANNER_FIDELITY_VERSION})\n`)

test('1. version exported', () => {
  assert(/planner-fidelity/.test(PLANNER_FIDELITY_VERSION), 'version tag')
})

test('2. evaluatePlannerFidelity returns full shape', () => {
  const r = evaluatePlannerFidelity({
    plannerOutput: PLAN_CONNECT,
    response: 'Ciao! Bentornato.',
  })
  assert(isPlannerFidelityEvaluation(r), 'shape')
  assert(r.fidelityScore >= 0 && r.fidelityScore <= 1, 'score band')
  assert(Array.isArray(r.missedSignals), 'missed')
  assert(Array.isArray(r.reasons), 'reasons')
})

test('3. support plan scores higher with presence, lower with helpdesk question', () => {
  const good = evaluatePlannerFidelity({
    plannerOutput: PLAN_SUPPORT,
    response: 'Mi dispiace. Sono qui con te.',
  })
  const bad = evaluatePlannerFidelity({
    plannerOutput: PLAN_SUPPORT,
    response: 'How can I help you today? What is wrong?',
  })
  assert(good.fidelityScore > bad.fidelityScore, 'good > bad')
  assert(good.strategy > bad.strategy, 'strategy better')
  assert(bad.constraints < good.constraints, 'constraints worse on bad')
  assert(bad.missedSignals.length > 0, 'missed on bad')
})

test('4. learning momentum rewards teaching shape', () => {
  const r = evaluatePlannerFidelity({
    plannerOutput: PLAN_LEARN,
    response:
      'La fotosintesi converte luce, acqua e CO₂ in zuccheri. Perché importa: è così che le piante producono energia. Per esempio, una foglia al sole accumula glucosio.',
  })
  assert(r.momentum >= 0.6, 'momentum high')
  assert(r.strategy >= 0.55, 'strategy ok')
  assert(!r.missedSignals.includes('momentum_learning'), 'no learning miss')
})

test('5. ask_question:no penalizes questions', () => {
  const r = evaluatePlannerFidelity({
    plannerOutput: PLAN_CONNECT,
    response: 'Ciao! Come va la tua giornata?',
  })
  assert(r.constraints < 0.7, 'constraint hit')
  assert(r.missedSignals.includes('ask_question:no'), 'missed no-question')
})

test('6. depth band: minimal vs too long', () => {
  const plan = {
    writerBrief: { strategy: 'continue', tone: 'neutral', depth: 'minimal', coda: 'none' },
    constraints: ['ask_question:no'],
    conversationMomentum: { kind: 'social', confidence: 0.5 },
  }
  const short = evaluatePlannerFidelity({
    plannerOutput: plan,
    response: 'Va bene.',
  })
  const long = evaluatePlannerFidelity({
    plannerOutput: plan,
    response:
      'Va bene, e mentre ci penso posso anche aggiungere molte altre riflessioni inutili che allungano troppo la risposta oltre la banda minimal richiesta dal piano.',
  })
  assert(short.depth > long.depth, 'short better for minimal')
})

test('7. normalizePlannerOutput reads momentum and constraints', () => {
  const n = normalizePlannerOutput(PLAN_LEARN)
  assertEqual(n.strategy, 'explain', 'strategy')
  assertEqual(n.momentum, 'learning', 'momentum')
  assertEqual(n.askQuestion, false, 'ask no')
  assertEqual(n.teaching, true, 'teach')
})

test('8. empty response is fail-soft', () => {
  const r = evaluatePlannerFidelity({ plannerOutput: PLAN_CONNECT, response: '' })
  assertEqual(r.fidelityScore, 0, 'zero')
  assert(r.missedSignals.includes('empty_response'), 'empty')
})

test('9. createPlannerFidelityEvaluator.evaluate matches evaluatePlannerFidelity', () => {
  const input = {
    plannerOutput: PLAN_CONNECT,
    response: 'Ciao! Bentornato.',
  }
  const a = evaluatePlannerFidelity(input)
  const b = createPlannerFidelityEvaluator().evaluate(input)
  assertEqual(JSON.stringify(a), JSON.stringify(b), 'equal')
})

test('10. pure function: same input → same output', () => {
  const input = {
    plannerOutput: PLAN_SUPPORT,
    response: 'Mi dispiace. Sono qui.',
  }
  const a = evaluatePlannerFidelity(input)
  const b = evaluatePlannerFidelity(input)
  assertEqual(JSON.stringify(a), JSON.stringify(b), 'pure')
})

test('11. does not mutate planner output', () => {
  const plan = JSON.parse(JSON.stringify(PLAN_SUPPORT))
  const before = JSON.stringify(plan)
  evaluatePlannerFidelity({ plannerOutput: plan, response: 'Mi dispiace.' })
  assertEqual(JSON.stringify(plan), before, 'immutable')
})

test('12. isPlannerFidelityEvaluation rejects partial objects', () => {
  assert(!isPlannerFidelityEvaluation({ fidelityScore: 1 }), 'partial')
  assert(
    isPlannerFidelityEvaluation({
      fidelityScore: 1,
      strategy: 1,
      momentum: 1,
      tone: 1,
      depth: 1,
      constraints: 1,
      missedSignals: [],
      reasons: [],
    }),
    'full',
  )
})

console.log('')
if (failed > 0) {
  console.error(`${failed} failed, ${passed} passed`)
  process.exit(1)
}
console.log(`${passed} passed, 0 failed`)
process.exit(0)
