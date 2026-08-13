#!/usr/bin/env node
/**
 * Greeting / pure social opening invariants (1–10).
 * Run: node lib/server/v2/brain/greeting-social-invariants.test.mjs
 */

import { perceive } from './perception.js'
import { think } from './mind.js'
import { plan, directConversation } from './planner.js'
import { buildConversationState } from './conversation-state.js'
import { deriveConversationSignals } from './conversation-signals.js'
import { enforceReplyGroundingDetailed } from './writer.js'
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

function runSocial(userMessage, history = null) {
  const msgs = history || [{ role: 'user', content: userMessage }]
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
  const dir = directConversation({
    messages: msgs,
    decision,
    perception,
    conversationState: state,
  })
  const p = plan({
    perception,
    decision,
    messages: msgs,
    conversationState: state,
    userMessage,
  })
  return { perception, state, decision, dir, p, msgs }
}

console.log('Greeting / pure social opening invariants\n')

test('1. greeting does not require conversational initiative', () => {
  const { decision } = runSocial('Ciao')
  assertEqual(decision.initiative, 'none', 'initiative')
})

test('2. greeting does not trigger one_spark by default', () => {
  for (const msg of ['Ciao', 'Hi', 'Hello', 'Buongiorno', 'Hey']) {
    const { decision } = runSocial(msg)
    assertEqual(decision.initiative, 'none', `${msg} initiative`)
  }
})

test('3. greeting does not trigger surprise', () => {
  const { dir, p } = runSocial('Ciao')
  assertEqual(dir.shouldSurprise, false, 'shouldSurprise')
  assert(dir.objective !== 'surprise', `objective=${dir.objective}`)
  assert(!/unexpected fact|scientific fact/i.test(String(p.objective)), `planObj=${p.objective}`)
})

test('4. how_are_you does not trigger teach/explain', () => {
  const { decision, dir, p } = runSocial('Come stai?', [
    { role: 'user', content: 'Ciao' },
    { role: 'assistant', content: 'Ciao!' },
    { role: 'user', content: 'Come stai?' },
  ])
  assertEqual(decision.shouldTeach, false, 'mind teach')
  assertEqual(dir.shouldExplain, false, 'director explain')
  assertEqual(p.writerBrief.teaching, false, 'brief teaching')
  assert(dir.objective !== 'teach', `dirObj=${dir.objective}`)
  assert(!/Create curiosity before explaining|teach/i.test(String(p.objective)), `obj=${p.objective}`)
})

test('5. activeTopic=null => topicLock=false', () => {
  const { state, dir, p } = runSocial('Ciao')
  assertEqual(state.activeTopic, null, 'state topic')
  assertEqual(dir.activeTopic, null, 'dir topic')
  assertEqual(p.writerBrief.activeTopic, null, 'brief topic')
  assert(
    p.constraints.includes('director_lock_topic:no'),
    `constraints=${p.constraints.filter((c) => /lock_topic/.test(c)).join(',')}`,
  )
  assert(!p.constraints.includes('director_lock_topic:yes'), 'no yes lock')
})

test('6. Mind shouldTeach=false cannot become Planner teaching=true on pure social', () => {
  const { decision, p } = runSocial('Ciao')
  assertEqual(decision.shouldTeach, false, 'mind')
  assertEqual(p.writerBrief.teaching, false, 'planner')
  const how = runSocial('Come stai?', [
    { role: 'user', content: 'Ciao' },
    { role: 'assistant', content: 'Ciao!' },
    { role: 'user', content: 'Come stai?' },
  ])
  assertEqual(how.decision.shouldTeach, false, 'how mind')
  assertEqual(how.p.writerBrief.teaching, false, 'how planner')
})

test('7. shouldContinueTopic=false + activeTopic=null cannot become continueTopic=true', () => {
  const { decision, state, p } = runSocial('Ciao')
  assertEqual(decision.shouldContinueTopic, false, 'mind continue')
  assertEqual(state.activeTopic, null, 'topic null')
  assertEqual(p.writerBrief.continueTopic, false, 'brief continue')
  assertEqual(p.writerBrief.shouldContinue, false, 'shouldContinue')
})

test('8. Planner objective for pure social turns must remain social', () => {
  for (const msg of ['Ciao', 'Hi', 'Come stai?']) {
    const history =
      msg === 'Come stai?'
        ? [
            { role: 'user', content: 'Ciao' },
            { role: 'assistant', content: 'Ciao!' },
            { role: 'user', content: 'Come stai?' },
          ]
        : null
    const { p, dir } = runSocial(msg, history)
    assert(
      /social check-in|social|comfort|Connect|presence|warm/i.test(String(p.objective)) ||
        dir.objective === 'comfort',
      `${msg} obj=${p.objective} dir=${dir.objective}`,
    )
    assert(!/Create curiosity before explaining|unexpected scientific fact/i.test(String(p.objective)), msg)
    assert(p.constraints.includes('pure_social_opening:yes'), `${msg} constraint`)
  }
})

test('9. Writer must not invent referential continuation to satisfy initiative', () => {
  const { state, p, msgs } = runSocial('Ciao')
  assert(
    p.writerBrief.mustNot.some((m) => /referential continuation|antecedent/i.test(m)),
    'mustNot present',
  )
  const grounded = enforceReplyGroundingDetailed(
    "Ciao! È un'ottima occasione per pensare insieme a come possiamo proteggerla.",
    {
      messages: msgs,
      conversationState: state,
      plan: { writerBrief: { ...p.writerBrief, strategy: 'connect', activeTopic: null } },
    },
  )
  assert(!/proteggerla/i.test(grounded.text), `grounded=${grounded.text}`)
})

test('10. Evaluator rejects pronouns with no grounded antecedent', () => {
  const { state, p } = runSocial('Ciao')
  const ev = evaluateContractFidelity({
    responseText: 'Possiamo proteggerla.',
    plan: p,
    conversationState: state,
    userMessage: 'Ciao',
    messages: [{ role: 'user', content: 'Ciao' }],
  })
  assert(!ev.ok, 'must fail')
  assert(
    ev.violations.some((v) => v.code === 'unsupported_referential_continuation'),
    `codes=${ev.violations.map((v) => v.code).join(',')}`,
  )
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
