#!/usr/bin/env node
/**
 * Unit tests for LAIfe V2 Conversation Resume Engine (experimental).
 * Pure history summarizer — no LLM, no memory, no pipeline wiring.
 *
 * Run: node lib/server/v2/brain/conversation-resume.test.mjs
 */

import {
  CONVERSATION_RESUME_VERSION,
  resumeConversation,
  createConversationResumeEngine,
  normalizeMessages,
  inferCurrentGoal,
  inferProgress,
  inferUnresolvedQuestions,
  inferImportantDecisions,
  inferEmotionalContext,
  buildSuggestedResumeSentence,
  isConversationResume,
} from './conversation-resume.js'

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

/**
 * @param {string[]} haystack
 * @param {string|RegExp} needle
 * @param {string} label
 */
function assertIncludesMatch(haystack, needle, label) {
  const ok = haystack.some((item) =>
    typeof needle === 'string' ? item.includes(needle) : needle.test(item),
  )
  if (!ok) {
    throw new Error(`${label} (haystack=${JSON.stringify(haystack)})`)
  }
}

console.log(`Conversation Resume Engine tests (${CONVERSATION_RESUME_VERSION})`)

test('normalizeMessages filters empty and unknown roles', () => {
  const out = normalizeMessages([
    { role: 'user', content: 'ciao' },
    { role: 'tool', content: 'nope' },
    { role: 'assistant', content: '  ' },
    null,
    { role: 'assistant', content: 'ok' },
  ])
  assertEqual(out.length, 2, 'length')
  assertEqual(out[0].content, 'ciao', 'first')
  assertEqual(out[1].content, 'ok', 'second')
})

test('empty conversation returns safe empty resume', () => {
  const r = resumeConversation({ messages: [] })
  assert(isConversationResume(r), 'shape')
  assertEqual(r.currentTopic, null, 'topic')
  assertEqual(r.currentGoal, null, 'goal')
  assertEqual(r.progress.length, 0, 'progress')
  assertEqual(r.unresolvedQuestions.length, 0, 'questions')
  assertEqual(r.importantDecisions.length, 0, 'decisions')
  assertEqual(r.emotionalContext, null, 'emotion')
  assertEqual(r.confidence, 0, 'confidence')
  assert(r.suggestedResumeSentence.includes('Non c\'è ancora'), 'sentence')
})

test('accepts messages array as top-level input', () => {
  const r = resumeConversation([{ role: 'user', content: 'Parliamo di LAIfe' }])
  assert(isConversationResume(r), 'shape')
  assert(r.currentTopic, 'topic present')
})

test('infers current goal from rendere / obiettivo cues', () => {
  const goal = inferCurrentGoal([
    { role: 'user', content: 'Ciao' },
    {
      role: 'user',
      content: 'L\'obiettivo è rendere V2 più naturale.',
    },
  ])
  assert(goal && /rendere V2 più naturale/i.test(goal), `goal=${goal}`)
})

test('infers progress items from completed/added cues', () => {
  const progress = inferProgress([
    { role: 'assistant', content: 'Presence Recovery completato.' },
    { role: 'user', content: 'Conversation Momentum aggiunto.' },
  ])
  assertIncludesMatch(progress, /Presence Recovery/i, 'presence')
  assertIncludesMatch(progress, /Conversation Momentum/i, 'momentum')
})

test('unresolved questions stay open without assistant reply', () => {
  const qs = inferUnresolvedQuestions([
    { role: 'user', content: 'Come funziona Conversation Resume?' },
    { role: 'assistant', content: 'È un riassunto operativo della chat corrente.' },
    { role: 'user', content: 'Quando lo colleghiamo al runtime?' },
  ])
  assertEqual(qs.length, 1, 'one open')
  assertIncludesMatch(qs, /runtime/i, 'runtime question')
})

test('important decisions from non-modificare / passare a', () => {
  const decisions = inferImportantDecisions([
    {
      role: 'user',
      content: 'Decisione: non modificare più il Writer. Passare alla continuità della conversazione.',
    },
  ])
  assertIncludesMatch(decisions, /non modificare/i, 'writer freeze')
  assertIncludesMatch(decisions, /passare alla continuità/i, 'continuity')
})

test('emotional context from recent user cues', () => {
  const emotion = inferEmotionalContext([
    { role: 'user', content: 'Sono un po\' frustrato da questi refactor.' },
    { role: 'assistant', content: 'Capisco.' },
  ])
  assertEqual(emotion, 'frustrazione', 'emotion')
})

test('suggested resume sentence prefers goal+progress style', () => {
  const sentence = buildSuggestedResumeSentence({
    currentTopic: 'sviluppo di LAIfe',
    currentGoal: 'rendere V2 più naturale',
    progress: ['Presence Recovery completato', 'Conversation Momentum aggiunto'],
    unresolvedQuestions: [],
    importantDecisions: [],
    emotionalContext: null,
    suggestedResumeSentence: '',
  })
  assert(/lavorando per rendere V2 più naturale/i.test(sentence), `sentence=${sentence}`)
  assert(/Conversation Momentum aggiunto/i.test(sentence), 'mentions last progress')
})

test('LAIfe continuity example produces operational resume', () => {
  const r = resumeConversation({
    messages: [
      {
        role: 'user',
        content: 'Stiamo lavorando sullo sviluppo di LAIfe. Voglio rendere V2 più naturale.',
      },
      {
        role: 'assistant',
        content: 'Ok. Presence Recovery completato. Conversation Momentum aggiunto.',
      },
      {
        role: 'user',
        content:
          'Decisione: non modificare più il Writer. Passare alla continuità della conversazione.',
      },
      {
        role: 'assistant',
        content: 'Perfetto, restiamo su continuità e resume.',
      },
    ],
  })

  assert(r.currentTopic && /sviluppo di LAIfe/i.test(r.currentTopic), `topic=${r.currentTopic}`)
  assert(r.currentGoal && /naturale/i.test(r.currentGoal), `goal=${r.currentGoal}`)
  assertIncludesMatch(r.progress, /Presence Recovery/i, 'progress presence')
  assertIncludesMatch(r.progress, /Conversation Momentum/i, 'progress momentum')
  assertIncludesMatch(r.importantDecisions, /non modificare/i, 'decision writer')
  assertIncludesMatch(r.importantDecisions, /passare alla continuità/i, 'decision continuity')
  assert(/lavorando per rendere V2 più naturale/i.test(r.suggestedResumeSentence), 'resume sentence')
  assert(typeof r.confidence === 'number' && r.confidence >= 0.75, `confidence=${r.confidence}`)
  assert(
    (r.suggestedResumeSentence.match(/[.!?]/g) || []).length <= 2,
    'max 2 sentences',
  )
})

test('createConversationResumeEngine exposes versioned resume()', () => {
  const engine = createConversationResumeEngine()
  assertEqual(engine.version, CONVERSATION_RESUME_VERSION, 'version')
  const r = engine.resume([{ role: 'user', content: 'Obiettivo: migliorare la continuità.' }])
  assert(isConversationResume(r), 'shape')
})

test('pure: no mutation of input messages', () => {
  const messages = [
    { role: 'user', content: 'Voglio creare un resume engine.' },
    { role: 'assistant', content: 'Modulo aggiunto.' },
  ]
  const snapshot = JSON.stringify(messages)
  resumeConversation({ messages })
  assertEqual(JSON.stringify(messages), snapshot, 'immutable input')
})

console.log('')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
process.exit(failed ? 1 : 0)
