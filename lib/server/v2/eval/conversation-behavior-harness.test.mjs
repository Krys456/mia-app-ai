#!/usr/bin/env node
/**
 * Tests for Conversation Behavior Harness (experimental).
 * Run: node lib/server/v2/eval/conversation-behavior-harness.test.mjs
 */

import {
  createConversationBehaviorHarness,
  compareBehaviorLabels,
  CONVERSATION_BEHAVIOR_HARNESS_VERSION,
  STRATEGIES,
  TURN_TYPES,
  WINNERS,
} from './conversation-behavior-harness.js'

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
    console.log(`ok  - ${name}`)
  } catch (err) {
    failed += 1
    console.error(`FAIL - ${name}`)
    console.error(err?.message || err)
  }
}

/**
 * @param {boolean} cond
 * @param {string} msg
 */
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

/**
 * @param {any} a
 * @param {any} b
 * @param {string} msg
 */
function assertEqual(a, b, msg) {
  if (a !== b) {
    throw new Error(
      `${msg || 'equal'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`,
    )
  }
}

console.log(`Conversation Behavior Harness tests (${CONVERSATION_BEHAVIOR_HARNESS_VERSION})\n`)

test('version', () => {
  assertEqual(
    CONVERSATION_BEHAVIOR_HARNESS_VERSION,
    '0.1.0-conversation-behavior-harness',
    'version',
  )
})

test('addCase returns id and stores responses', () => {
  const h = createConversationBehaviorHarness()
  const id = h.addCase({
    input: 'Ciao',
    laifeResponse: 'Ciao!',
    chatgptResponse: 'Hello! How can I help you today?',
  })
  assert(typeof id === 'string' && id.length > 0, 'id')
  const c = h.getCase(id)
  assert(c && c.input === 'Ciao', 'input')
  assertEqual(c?.rated, false, 'unrated')
})

test('rate stores LAIfe labels + optional ChatGPT for match', () => {
  const h = createConversationBehaviorHarness()
  const id = h.addCase({
    input: 'Ok',
    laifeResponse: 'Un fatto curioso sul cervello…',
    chatgptResponse: 'Certo, continuo con una spiegazione dettagliata…',
  })
  h.rate(id, {
    turnType: 'learning',
    strategy: 'surprise',
    move: 'unexpected_fact',
    initiative: 'high',
    question: false,
    opening: 'direct',
    closing: 'statement',
    depth: 'short',
    energy: 'high',
    winner: 'LAIfe',
    chatgpt: {
      turnType: 'learning',
      strategy: 'expand',
      move: 'scientific_explanation',
      initiative: 'medium',
      question: false,
      opening: 'friendly',
      closing: 'statement',
      depth: 'deep',
      energy: 'medium',
    },
  })
  const c = h.getCase(id)
  assertEqual(c?.rated, true, 'rated')
  assertEqual(c?.laife?.strategy, 'surprise', 'laife strategy')
  assertEqual(c?.chatgpt?.strategy, 'expand', 'chatgpt strategy')
  assertEqual(c?.winner, 'LAIfe', 'winner')
  assert(typeof c?.similarity === 'number', 'similarity')
})

test('compareBehaviorLabels similarity', () => {
  const { matches, similarity } = compareBehaviorLabels(
    {
      turnType: 'conversation',
      strategy: 'expand',
      move: 'next_step',
      initiative: 'low',
      question: false,
      opening: 'warm',
      closing: 'none',
      depth: 'short',
      energy: 'low',
    },
    {
      turnType: 'conversation',
      strategy: 'expand',
      move: 'question',
      initiative: 'low',
      question: true,
      opening: 'warm',
      closing: 'question',
      depth: 'short',
      energy: 'medium',
    },
  )
  assertEqual(matches.strategy, true, 'strategy')
  assertEqual(matches.move, false, 'move')
  assert(similarity != null && similarity > 0 && similarity < 1, 'mid similarity')
})

test('summary wins and match rates', () => {
  const h = createConversationBehaviorHarness()
  const a = h.addCase({
    input: 'A',
    laifeResponse: 'la',
    chatgptResponse: 'cg',
  })
  const b = h.addCase({
    input: 'B',
    laifeResponse: 'la',
    chatgptResponse: 'cg',
  })
  const labelsSame = {
    turnType: /** @type {const} */ ('conversation'),
    strategy: /** @type {const} */ ('expand'),
    move: /** @type {const} */ ('definition'),
    initiative: /** @type {const} */ ('low'),
    question: false,
    opening: /** @type {const} */ ('direct'),
    closing: /** @type {const} */ ('statement'),
    depth: /** @type {const} */ ('short'),
    energy: /** @type {const} */ ('medium'),
  }
  h.rate(a, {
    ...labelsSame,
    winner: 'LAIfe',
    chatgpt: { ...labelsSame },
  })
  h.rate(b, {
    ...labelsSame,
    strategy: 'surprise',
    depth: 'deep',
    initiative: 'high',
    winner: 'ChatGPT',
    chatgpt: { ...labelsSame },
  })
  const s = h.summary()
  assertEqual(s.cases, 2, 'cases')
  assertEqual(s.wins.LAIfe, 1, 'laife wins')
  assertEqual(s.wins.ChatGPT, 1, 'chatgpt wins')
  assertEqual(s.strategyMatch, 0.5, 'strategy match 1/2')
  assertEqual(s.depthMatch, 0.5, 'depth match 1/2')
  assert(s.overallSimilarity != null, 'overall')
  assert(s.averageScores.strategyMatch === s.strategyMatch, 'averageScores mirror')
})

test('printTable contains headers', () => {
  const h = createConversationBehaviorHarness()
  const id = h.addCase({
    id: 'demo-1',
    input: 'Ciao',
    laifeResponse: 'Ciao!',
    chatgptResponse: 'Hi!',
  })
  h.rate(id, {
    turnType: 'conversation',
    strategy: 'expand',
    move: 'reflection',
    initiative: 'low',
    question: false,
    opening: 'warm',
    closing: 'none',
    depth: 'minimal',
    energy: 'low',
    winner: 'Tie',
    chatgpt: {
      turnType: 'conversation',
      strategy: 'expand',
      move: 'question',
      initiative: 'medium',
      question: true,
      opening: 'friendly',
      closing: 'question',
      depth: 'short',
      energy: 'medium',
    },
  })
  const table = h.printTable()
  assert(/Case/.test(table), 'Case')
  assert(/Winner/.test(table), 'Winner')
  assert(/Strategy Match/.test(table), 'Strategy Match')
  assert(/Depth Match/.test(table), 'Depth Match')
  assert(/Initiative Match/.test(table), 'Initiative Match')
  assert(/Overall/.test(table), 'Overall')
  assert(/demo-1/.test(table), 'row')
})

test('toJSON / exportJSON', () => {
  const h = createConversationBehaviorHarness()
  h.addCase({ input: 'x', laifeResponse: 'y', chatgptResponse: 'z' })
  const json = h.toJSON()
  const parsed = JSON.parse(json)
  assertEqual(parsed.version, CONVERSATION_BEHAVIOR_HARNESS_VERSION, 'version')
  assertEqual(parsed.cases.length, 1, 'cases')
})

test('rejects invalid winner / strategy', () => {
  const h = createConversationBehaviorHarness()
  const id = h.addCase({ input: 'x', laifeResponse: 'y', chatgptResponse: 'z' })
  let threw = false
  try {
    h.rate(id, /** @type {any} */ ({ winner: 'Nobody', strategy: 'expand' }))
  } catch {
    threw = true
  }
  assert(threw, 'invalid winner')
  assert(WINNERS.includes('LAIfe'), 'winners')
  assert(STRATEGIES.includes('surprise'), 'strategies')
  assert(TURN_TYPES.includes('exploration'), 'turn types')
})

test('duplicate id rejected', () => {
  const h = createConversationBehaviorHarness()
  h.addCase({ id: 'same', input: 'a', laifeResponse: 'b', chatgptResponse: 'c' })
  let threw = false
  try {
    h.addCase({ id: 'same', input: 'a', laifeResponse: 'b', chatgptResponse: 'c' })
  } catch {
    threw = true
  }
  assert(threw, 'duplicate')
})

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
