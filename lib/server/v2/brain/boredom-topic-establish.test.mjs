#!/usr/bin/env node
/**
 * Boredom / one_direction topic-establishment regression (A–H).
 * Run: node lib/server/v2/brain/boredom-topic-establish.test.mjs
 */

import {
  hasUnsupportedInMediasResOpening,
  responseEstablishesConcreteSubject,
} from './topic-validation.js'
import { perceive } from './perception.js'
import { think } from './mind.js'
import { plan } from './planner.js'
import { buildConversationState } from './conversation-state.js'
import { deriveConversationSignals } from './conversation-signals.js'
import { evaluateContractFidelity } from './contract-evaluator.js'

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

function runTurn(userMessage) {
  const msgs = [{ role: 'user', content: userMessage }]
  const perception = perceive({ userMessage })
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
  return { perception, state, decision, p, msgs }
}

function boredomPlan(userMessage = 'Non so di cosa parlare') {
  return runTurn(userMessage)
}

console.log('Boredom topic-establishment tests\n')

test('A. Fresh "Non so di cosa parlare" — Planner requires topic establishment', () => {
  const { perception, state, decision, p } = boredomPlan('Non so di cosa parlare')
  assert(
    perception.intent === 'boredom' || perception.userNeed === 'direction' || decision.strategy === 'explore',
    `intent=${perception.intent} need=${perception.userNeed} strategy=${decision.strategy}`,
  )
  assertEqual(state.activeTopic, null, 'topic null')
  assert(
    decision.initiative === 'one_direction' || decision.strategy === 'explore',
    `initiative=${decision.initiative}`,
  )
  assertEqual(p.writerBrief.shouldAskQuestion, false, 'no ask')
  assert(
    p.writerBrief.must.some((m) => /Topic-establishing initiative|explicitly name/i.test(m)),
    'must establish subject',
  )
  assert(
    p.writerBrief.must.some((m) => /Self-contained opening|in medias res/i.test(m)),
    'must self-contained',
  )
  assert(
    /Introduce one concrete|initiative|concrete interesting subject/i.test(String(p.objective)) ||
      p.writerBrief.must.some((m) => /ONE concrete/i.test(m)),
    `objective=${p.objective}`,
  )
})

test('B. Fresh "Mi annoio" — unsupported in-medias-res opening rejected', () => {
  const { p, state, msgs } = boredomPlan('Mi annoio')
  const bad =
    'È un fenomeno affascinante, che dimostra come le piante possano sostenersi a vicenda.'
  assert(hasUnsupportedInMediasResOpening(bad, { activeTopic: null }), 'heuristic')
  const ev = evaluateContractFidelity({
    responseText: bad,
    plan: p,
    conversationState: state,
    conversationSignals: deriveConversationSignals({
      userMessage: 'Mi annoio',
      messages: msgs,
    }),
    userMessage: 'Mi annoio',
    messages: msgs,
  })
  assert(!ev.ok, 'must fail')
  assert(
    ev.violations.some((v) => v.code === 'unsupported_referential_continuation'),
    `codes=${ev.violations.map((v) => v.code).join(',')}`,
  )
})

test('C. "È un fenomeno affascinante..." with activeTopic=null → violation', () => {
  assert(
    hasUnsupportedInMediasResOpening(
      'È un fenomeno affascinante, che dimostra come le piante possano sostenersi a vicenda.',
      { activeTopic: null },
    ),
    'fenomeno',
  )
  assert(
    hasUnsupportedInMediasResOpening('Questa cosa è sorprendente.', { activeTopic: null }),
    'questa cosa',
  )
  assert(
    hasUnsupportedInMediasResOpening('Questo dimostra che le stelle collassano.', {
      activeTopic: null,
    }),
    'questo dimostra',
  )
  assert(
    hasUnsupportedInMediasResOpening('La cosa interessante è che il tempo dilata.', {
      activeTopic: null,
    }),
    'la cosa interessante',
  )
})

test('D. Same phrase WITH established activeTopic must not false-reject', () => {
  assertEqual(
    hasUnsupportedInMediasResOpening(
      'È un fenomeno affascinante: le reti micorriziche collegano gli alberi.',
      { activeTopic: 'reti micorriziche' },
    ),
    false,
    'with topic',
  )
  const ev = evaluateContractFidelity({
    responseText:
      'È un fenomeno affascinante: le reti micorriziche collegano gli alberi sotto terra.',
    plan: {
      objective: 'Deepen the previous explanation.',
      writerBrief: {
        conversationalMove: 'continue_topic',
        shouldAskQuestion: false,
        activeTopic: 'reti micorriziche',
        strategy: 'continue',
        responseProfile: {
          tone: { warmth: 0.5, formality: 0.4, humor: 0.1, directness: 0.6, technicality: 0.5 },
          depth: 'normal',
          verbosity: 'medium',
          energy: 'medium',
          emojiPolicy: 'none',
        },
      },
    },
    conversationState: {
      activeTopic: 'reti micorriziche',
      conversationPhase: 'deepening',
    },
    userMessage: 'ok',
    messages: [
      { role: 'assistant', content: 'Parliamo delle reti micorriziche.' },
      { role: 'user', content: 'ok' },
    ],
  })
  assert(
    !ev.violations.some((v) => v.code === 'unsupported_referential_continuation'),
    `codes=${ev.violations.map((v) => v.code).join(',')}`,
  )
})

test('E. Planner one_direction contract survives Evaluator rewrite brief', () => {
  const { p, state, msgs } = boredomPlan('Non so di cosa parlare')
  const ev = evaluateContractFidelity({
    responseText: 'Questa cosa è sorprendente.',
    plan: p,
    conversationState: state,
    userMessage: 'Non so di cosa parlare',
    messages: msgs,
  })
  assert(ev.needsRewrite || !ev.ok, 'rewrite needed')
  assert(ev.rewriteBrief, 'has rewrite brief')
  assert(/Introduce ONE concrete subject|explicitly NAME|activeTopic is null/i.test(ev.rewriteBrief), 'preserves WHAT')
  assert(/no topic menu|no follow-up question|no invented prior context/i.test(ev.rewriteBrief), 'constraints')
  assert(!/\binvent a new strategy\b/i.test(ev.rewriteBrief.replace(/Do not invent a new strategy/gi, '')), 'HOW only')
})

test('F. No generic topic menu in boredom plan', () => {
  const { p } = boredomPlan('Non so di cosa parlare')
  assert(
    p.writerBrief.mustNot.some((m) => /topic menu|scienza, storia/i.test(m)),
    'bans menu',
  )
})

test('G. No forced follow-up question', () => {
  const { p } = boredomPlan('Non so di cosa parlare')
  assertEqual(p.writerBrief.shouldAskQuestion, false, 'shouldAsk')
  assert(
    p.writerBrief.mustNot.some((m) => /Do not ask a question/i.test(m)) ||
      p.constraints.includes('hard:no_question'),
    'no question constraint',
  )
})

test('H. English "I don\'t know what to talk about" — self-contained initiative plan', () => {
  const { perception, state, decision, p } = boredomPlan("I don't know what to talk about")
  assertEqual(state.activeTopic, null, 'topic null')
  assert(
    decision.strategy === 'explore' ||
      perception.intent === 'boredom' ||
      decision.initiative === 'one_direction',
    `strategy=${decision.strategy}`,
  )
  assert(
    p.writerBrief.must.some((m) => /Topic-establishing initiative|explicitly name/i.test(m)),
    'establish',
  )
  assert(
    hasUnsupportedInMediasResOpening('This shows that plants share nutrients.', {
      activeTopic: null,
    }),
    'en heuristic',
  )
  assert(
    responseEstablishesConcreteSubject(
      "Here's one concrete subject: octopuses can taste with their suckers, which lets them identify prey by touch alone.",
    ),
    'en establishes',
  )
})

test('structural: good Italian opening establishes subject', () => {
  assert(
    responseEstablishesConcreteSubject(
      'Ti lancio una curiosità: gli alberi di una foresta possono scambiarsi risorse attraverso reti sotterranee associate ai funghi.',
    ),
    'good',
  )
  assertEqual(
    responseEstablishesConcreteSubject(
      'È un fenomeno affascinante, che dimostra come le piante possano sostenersi a vicenda.',
    ),
    false,
    'bad',
  )
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
