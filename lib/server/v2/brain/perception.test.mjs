#!/usr/bin/env node
/**
 * Example tests for LAIfe V2 Perception.
 * Isolated: imports only ./perception.js — not wired to the chat pipeline.
 *
 * Run: node lib/server/v2/brain/perception.test.mjs
 */

import {
  perceive,
  detectLanguage,
  isPerceptionSnapshot,
  PERCEPTION_VERSION,
} from './perception.js'

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
 * @param {string} message
 */
function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`)
  }
}

/** @param {import('./perception.js').PerceptionSnapshot} snapshot */
function assertNoDecisionFields(snapshot) {
  const forbidden = [
    'askQuestion',
    'leadConversation',
    'tools',
    'openingPolicy',
    'responseLength',
    'writerBrief',
    'prompt',
    'decision',
  ]
  const keys = Object.keys(snapshot)
  for (const key of forbidden) {
    assert(!keys.includes(key), `snapshot must not include decision field "${key}"`)
  }
}

console.log(`Perception tests (${PERCEPTION_VERSION})\n`)

test('returns a complete snapshot shape', () => {
  const snap = perceive({ userMessage: 'Ciao!' })
  assert(isPerceptionSnapshot(snap), 'must pass isPerceptionSnapshot')
  assertEqual(typeof snap.language, 'string', 'language')
  assertEqual(typeof snap.intent, 'string', 'intent')
  assertEqual(typeof snap.socialIntent, 'string', 'socialIntent')
  assertEqual(typeof snap.emotionalState, 'string', 'emotionalState')
  assertEqual(typeof snap.conversationStage, 'string', 'conversationStage')
  assertEqual(typeof snap.knowledgeLevel, 'string', 'knowledgeLevel')
  assertEqual(typeof snap.userNeed, 'string', 'userNeed')
  assert(snap.confidence >= 0 && snap.confidence <= 1, 'confidence in range')
  assert(Array.isArray(snap.reasoning.signals), 'signals array')
  assert(Array.isArray(snap.reasoning.alternatives), 'alternatives array')
  assert(Array.isArray(snap.reasoning.notes), 'notes array')
  assertNoDecisionFields(snap)
})

test('observes Italian greeting', () => {
  const snap = perceive({ userMessage: 'Ciao!' })
  assertEqual(snap.language, 'it', 'language it')
  assertEqual(snap.intent, 'greeting', 'intent greeting')
  assertEqual(snap.socialIntent, 'greeting', 'social greeting')
  assertEqual(snap.conversationStage, 'opening', 'opening stage')
  assertEqual(snap.userNeed, 'connection', 'need connection')
  assert(snap.confidence >= 0.7, 'high confidence greeting')
})

test('observes English learning ask', () => {
  const snap = perceive({
    userMessage: 'Can you explain how photosynthesis works?',
  })
  assertEqual(snap.language, 'en', 'language en')
  assertEqual(snap.intent, 'learning', 'intent learning')
  assertEqual(snap.userNeed, 'explanation', 'need explanation')
  assertEqual(snap.socialIntent, 'none', 'not social')
})

test('observes emotional support need', () => {
  const snap = perceive({
    userMessage: 'Mi sento molto ansioso oggi e non so cosa fare.',
  })
  assertEqual(snap.intent, 'emotional_support', 'support intent')
  assert(
    snap.emotionalState === 'anxious' || snap.emotionalState === 'sad',
    'distressed emotion',
  )
  assertEqual(snap.userNeed, 'emotional_care', 'care need')
})

test('observes continuation after history', () => {
  const snap = perceive({
    userMessage: 'Continua.',
    messages: [
      { role: 'user', content: 'Parlami delle stelle.' },
      {
        role: 'assistant',
        content: 'Le stelle sono forni nucleari lontani…',
      },
    ],
  })
  assertEqual(snap.intent, 'continuation', 'continuation intent')
  assertEqual(snap.userNeed, 'continuation', 'continuation need')
  assert(
    snap.conversationStage === 'early' ||
      snap.conversationStage === 'developing' ||
      snap.conversationStage === 'deepening',
    'not opening-only',
  )
})

test('observes problem solving', () => {
  const snap = perceive({
    userMessage: 'Aiutami a sistemare questo bug: la funzione non ritorna mai.',
  })
  assertEqual(snap.intent, 'problem_solving', 'problem_solving')
  assertEqual(snap.userNeed, 'help_unblocking', 'unblock need')
})

test('observes feedback on assistant', () => {
  const snap = perceive({
    userMessage: "Sei troppo robotico. Più naturale per favore.",
  })
  assertEqual(snap.intent, 'feedback_on_assistant', 'feedback intent')
  assertEqual(snap.userNeed, 'feedback_ack', 'feedback need')
  assertEqual(snap.conversationStage, 'repair', 'repair stage')
})

test('observes meta language switch request', () => {
  const snap = perceive({
    userMessage: 'Please speak in English from now on.',
  })
  assertEqual(snap.intent, 'meta_language', 'meta_language')
  assertEqual(snap.userNeed, 'information', 'info need for meta')
})

test('empty message is fail-soft silence/unclear', () => {
  const snap = perceive({ userMessage: '' })
  assert(
    snap.intent === 'silence' || snap.intent === 'unclear',
    'empty → silence/unclear',
  )
  assert(snap.confidence <= 0.5, 'low confidence')
  assert(isPerceptionSnapshot(snap), 'still valid snapshot')
})

test('optional memory does not decide — only observes', () => {
  const snap = perceive({
    userMessage: 'Ok.',
    messages: [
      { role: 'user', content: 'Sto lavorando al mio progetto di app.' },
      { role: 'assistant', content: 'Che parte stai curando adesso?' },
    ],
    memory: [{ text: 'User is building a mobile app', type: 'project' }],
  })
  assert(isPerceptionSnapshot(snap), 'valid with memory')
  assert(
    snap.reasoning.notes.some((n) => n === 'memory_context_present'),
    'notes memory presence',
  )
  assert(
    snap.reasoning.signals.some((s) => s.startsWith('context:memory_items:')),
    'signal memory count',
  )
  assertNoDecisionFields(snap)
})

test('detectLanguage helpers', () => {
  assertEqual(detectLanguage('Ciao, come stai?'), 'it', 'it')
  assertEqual(detectLanguage('Hello there, how are you?'), 'en', 'en')
  assertEqual(detectLanguage(''), 'unknown', 'empty')
  assertEqual(detectLanguage('Mi annoio'), 'it', 'mi annoio')
  assertEqual(detectLanguage('Va bene'), 'it', 'va bene')
  assertEqual(detectLanguage('Dai'), 'it', 'dai')
  assertEqual(detectLanguage('Che noia'), 'it', 'che noia')
  assertEqual(detectLanguage('I am bored'), 'en', 'i am bored')
})

test('language stickiness keeps Italian on short follow-ups', () => {
  const snap = perceive({
    userMessage: 'Dai',
    messages: [
      { role: 'user', content: 'Ciao, come stai?' },
      { role: 'assistant', content: 'Bene, grazie. Di cosa parliamo?' },
      { role: 'user', content: 'Dai' },
    ],
  })
  assertEqual(snap.language, 'it', 'sticky dai')
})

test('pure function: same input → same output', () => {
  const input = {
    userMessage: 'Spiegami cos\'è un API gateway',
    messages: [{ role: 'user', content: 'Ciao' }, { role: 'assistant', content: 'Ciao!' }],
  }
  const a = JSON.stringify(perceive(input))
  const b = JSON.stringify(perceive(input))
  assertEqual(a, b, 'deterministic')
})

test('malformed input does not throw', () => {
  const snap = perceive(/** @type {any} */ ({
    userMessage: null,
    messages: 'nope',
    memory: { bad: true },
  }))
  assert(isPerceptionSnapshot(snap), 'safe snapshot')
})

test('boredom: Mi annoio / non so di cosa parlare', () => {
  const a = perceive({ userMessage: 'Mi annoio.' })
  assertEqual(a.intent, 'boredom', 'annoio')
  assertEqual(a.userNeed, 'direction', 'direction need')
  const b = perceive({
    userMessage: 'Come va? Mi annoio e non so di cosa parlare',
  })
  assertEqual(b.intent, 'boredom', 'compound boredom')
  const c = perceive({ userMessage: "Non so di cosa parlare." })
  assertEqual(c.intent, 'boredom', 'non so di cosa parlare')
})

test('short ok after assistant stays continuation (not a fixed meaning)', () => {
  const snap = perceive({
    userMessage: 'ok',
    messages: [
      { role: 'user', content: 'Mi annoio.' },
      {
        role: 'assistant',
        content: 'Possiamo esplorare curiosità scientifiche.',
      },
    ],
  })
  assertEqual(snap.intent, 'continuation', 'continuation')
})

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
