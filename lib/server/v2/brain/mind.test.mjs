#!/usr/bin/env node
/**
 * Realistic tests for LAIfe V2 Mind (decision module).
 * Isolated: imports only ./mind.js — not wired to the chat pipeline.
 *
 * Run: node lib/server/v2/brain/mind.test.mjs
 */

import { think, isMindDecision, MIND_VERSION } from './mind.js'

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
    throw new Error(
      `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    )
  }
}

/** @param {import('./mind.js').MindDecision} d */
function assertShape(d) {
  assert(isMindDecision(d), 'must be MindDecision')
  assert(d.confidence >= 0 && d.confidence <= 1, 'confidence range')
  assert(typeof d.goal === 'string' && d.goal.length > 0, 'goal non-empty')
  // No prose-response fields
  const forbidden = ['text', 'prompt', 'draft', 'message', 'writerBrief']
  for (const key of forbidden) {
    assert(!Object.hasOwn(d, key), `must not include "${key}"`)
  }
}

/**
 * @param {Partial<import('./mind.js').PerceptionResult>} perception
 * @param {Partial<import('./mind.js').ConversationMemory>} [memory]
 * @param {Partial<import('./mind.js').SessionState>} [session]
 */
function decide(perception, memory = {}, session = {}) {
  return think({
    perception,
    conversationMemory: memory,
    sessionState: session,
  })
}

console.log(`Mind tests (${MIND_VERSION})\n`)

test('1. returns complete decision shape', () => {
  const d = decide({
    intent: 'greeting',
    socialIntent: 'greeting',
    userNeed: 'connection',
    emotionalState: 'calm',
    conversationStage: 'opening',
    knowledgeLevel: 'unknown',
    confidence: 0.9,
  })
  assertShape(d)
})

test('2. Italian greeting → connect, no spark, no interview', () => {
  const d = decide({
    language: 'it',
    intent: 'greeting',
    socialIntent: 'greeting',
    userNeed: 'connection',
    emotionalState: 'calm',
    conversationStage: 'opening',
    confidence: 0.9,
  })
  assertEqual(d.need, 'connection', 'need')
  assertEqual(d.strategy, 'connect', 'strategy')
  assertEqual(d.initiative, 'none', 'no spark on pure greeting')
  assertEqual(d.shouldAskQuestion, false, 'no question')
  assertEqual(d.shouldTeach, false, 'no teach')
  assertEqual(d.shouldComfort, false, 'no comfort')
  assert(
    d.responseDepth === 'light' || d.responseDepth === 'minimal',
    'shallow open',
  )
})

test('3. Emotional support → comfort, no challenge, no question', () => {
  const d = decide({
    intent: 'emotional_support',
    socialIntent: 'none',
    userNeed: 'emotional_care',
    emotionalState: 'anxious',
    conversationStage: 'developing',
    confidence: 0.85,
  })
  assertEqual(d.strategy, 'support', 'support')
  assertEqual(d.need, 'emotional_care', 'care')
  assertEqual(d.shouldComfort, true, 'comfort')
  assertEqual(d.shouldChallenge, false, 'no challenge')
  assertEqual(d.shouldAskQuestion, false, 'no question')
  assertEqual(d.emotionalTone, 'supportive', 'tone')
  assertEqual(d.initiative, 'none', 'no initiative push')
})

test('4. Learning ask → explain + teach', () => {
  const d = decide({
    intent: 'learning',
    socialIntent: 'none',
    userNeed: 'explanation',
    emotionalState: 'curious',
    conversationStage: 'opening',
    knowledgeLevel: 'beginner',
    confidence: 0.8,
  })
  assertEqual(d.strategy, 'explain', 'explain')
  assertEqual(d.shouldTeach, true, 'teach')
  assertEqual(d.need, 'explanation', 'need')
  assertEqual(d.shouldAskQuestion, false, 'no default question')
  assertEqual(d.emotionalTone, 'curious', 'curious tone')
})

test('5. Problem solving with current topic → guide + memory + continue', () => {
  const d = decide(
    {
      intent: 'problem_solving',
      userNeed: 'help_unblocking',
      emotionalState: 'frustrated',
      conversationStage: 'developing',
      knowledgeLevel: 'intermediate',
      confidence: 0.75,
    },
    {
      currentTopic: 'react-hooks-bug',
      topics: ['react-hooks-bug'],
      turnCount: 6,
      lastUserStance: 'engaged',
    },
  )
  assertEqual(d.strategy, 'guide', 'guide')
  assertEqual(d.shouldUseMemory, true, 'use memory')
  assertEqual(d.shouldContinueTopic, true, 'continue topic')
  assertEqual(d.shouldComfort, false, 'frustrated ≠ comfort-mandatory here')
  // frustrated blocks challenge
  assertEqual(d.shouldChallenge, false, 'no challenge while frustrated')
})

test('6. Continuation after assistant turn → continue + insight', () => {
  const d = decide(
    {
      intent: 'continuation',
      userNeed: 'continuation',
      emotionalState: 'curious',
      conversationStage: 'deepening',
      confidence: 0.7,
    },
    {
      currentTopic: 'stars',
      topics: ['stars'],
      turnCount: 8,
      lastUserStance: 'engaged',
    },
  )
  assertEqual(d.strategy, 'continue', 'continue')
  assertEqual(d.shouldContinueTopic, true, 'stay on topic')
  assertEqual(d.shouldAskQuestion, false, 'no question')
  assertEqual(d.initiative, 'one_insight', 'insight')
  assertEqual(d.responseDepth, 'deep', 'deepening depth')
})

test('7. Short ack with topic → continue, no question', () => {
  const d = decide(
    {
      intent: 'continuation',
      socialIntent: 'agreement',
      userNeed: 'continuation',
      emotionalState: 'neutral',
      conversationStage: 'developing',
      confidence: 0.6,
    },
    {
      currentTopic: 'trip-planning',
      lastUserStance: 'short_ack',
      turnCount: 4,
    },
  )
  assertEqual(d.strategy, 'continue', 'continue')
  assertEqual(d.shouldAskQuestion, false, 'no question on ack')
  assertEqual(d.shouldContinueTopic, true, 'continue')
})

test('8. Farewell → close, no question, no initiative', () => {
  const d = decide({
    intent: 'small_talk',
    socialIntent: 'farewell',
    userNeed: 'connection',
    emotionalState: 'calm',
    conversationStage: 'closing',
    confidence: 0.9,
  })
  assertEqual(d.need, 'closure', 'closure need')
  assertEqual(d.strategy, 'close', 'close')
  assertEqual(d.shouldAskQuestion, false, 'no question')
  assertEqual(d.initiative, 'none', 'no initiative')
  assertEqual(d.shouldContinueTopic, false, 'do not continue')
})

test('9. Session closingSignal forces close', () => {
  const d = decide(
    {
      intent: 'unclear',
      userNeed: 'unclear',
      emotionalState: 'neutral',
      conversationStage: 'developing',
      confidence: 0.3,
    },
    {},
    { closingSignal: true },
  )
  assertEqual(d.strategy, 'close', 'close')
  assertEqual(d.need, 'closure', 'closure')
})

test('10. Feedback on assistant → recover, no teach dump', () => {
  const d = decide({
    intent: 'feedback_on_assistant',
    userNeed: 'feedback_ack',
    emotionalState: 'frustrated',
    conversationStage: 'repair',
    confidence: 0.88,
  })
  assertEqual(d.strategy, 'recover', 'recover')
  assertEqual(d.need, 'feedback_ack', 'feedback')
  assertEqual(d.shouldTeach, false, 'no teach')
  assertEqual(d.shouldUseMemory, false, 'no memory force')
  assertEqual(d.shouldAskQuestion, false, 'no question')
  assertEqual(d.shouldChallenge, false, 'no challenge')
  assertEqual(d.emotionalTone, 'calm', 'calm')
})

test('11. Celebration → celebrate, encouraging, light', () => {
  const d = decide({
    intent: 'celebration',
    userNeed: 'celebration_share',
    emotionalState: 'excited',
    conversationStage: 'developing',
    confidence: 0.8,
  })
  assertEqual(d.strategy, 'celebrate', 'celebrate')
  assertEqual(d.emotionalTone, 'encouraging', 'encouraging')
  assertEqual(d.shouldAskQuestion, false, 'no question')
  assertEqual(d.responseDepth, 'light', 'light')
})

test('12. Boredom / choose-for-me → explore + one_direction', () => {
  const d = decide(
    {
      intent: 'boredom',
      userNeed: 'direction',
      emotionalState: 'tired',
      conversationStage: 'early',
      confidence: 0.7,
    },
    { lastUserStance: 'delegating', turnCount: 2 },
    { userAskedToLead: true },
  )
  assertEqual(d.strategy, 'explore', 'explore')
  assertEqual(d.initiative, 'one_direction', 'direction')
  assertEqual(d.shouldAskQuestion, false, 'do not bounce choice back')
  assertEqual(d.shouldContinueTopic, false, 'no topic yet')
})

test('13. Question streak blocks another question', () => {
  const d = decide(
    {
      intent: 'learning',
      userNeed: 'explanation',
      emotionalState: 'confused',
      conversationStage: 'developing',
      knowledgeLevel: 'beginner',
      confidence: 0.55,
    },
    { openQuestions: [], turnCount: 3 },
    { questionStreak: 2 },
  )
  // confused beginner would otherwise allow one clarify question
  assertEqual(d.shouldAskQuestion, false, 'streak blocks question')
  assertEqual(d.shouldTeach, true, 'still teach')
})

test('14. Confused beginner guide may ask one clarifying question', () => {
  const d = decide(
    {
      intent: 'problem_solving',
      userNeed: 'help_unblocking',
      emotionalState: 'confused',
      conversationStage: 'early',
      knowledgeLevel: 'beginner',
      confidence: 0.5,
    },
    { openQuestions: [], turnCount: 2, lastUserStance: 'engaged' },
    { questionStreak: 0 },
  )
  assertEqual(d.strategy, 'guide', 'guide')
  assertEqual(d.shouldAskQuestion, true, 'one clarify allowed')
  assertEqual(d.initiative, 'none', 'question occupies coda')
})

test('15. memoryEnabled false → shouldUseMemory false', () => {
  const d = decide(
    {
      intent: 'project_update',
      userNeed: 'information',
      emotionalState: 'neutral',
      conversationStage: 'developing',
      confidence: 0.7,
    },
    { currentTopic: 'mobile-app', topics: ['mobile-app'] },
    { memoryEnabled: false },
  )
  assertEqual(d.shouldUseMemory, false, 'respect memoryEnabled')
})

test('16. Project update with topic → use memory', () => {
  const d = decide(
    {
      intent: 'project_update',
      userNeed: 'information',
      emotionalState: 'neutral',
      conversationStage: 'developing',
      confidence: 0.7,
    },
    {
      currentTopic: 'mobile-app',
      topics: ['mobile-app'],
      unresolvedGoal: 'ship-beta',
    },
  )
  assertEqual(d.shouldUseMemory, true, 'memory on')
  assertEqual(d.shouldContinueTopic, true, 'continue project thread')
})

test('17. Expert learning → deep explain', () => {
  const d = decide(
    {
      intent: 'learning',
      userNeed: 'explanation',
      emotionalState: 'curious',
      conversationStage: 'developing',
      knowledgeLevel: 'expert',
      confidence: 0.8,
    },
    { lastUserStance: 'engaged' },
    { preferenceBias: 'detailed' },
  )
  assertEqual(d.shouldTeach, true, 'teach')
  assertEqual(d.responseDepth, 'deep', 'deep')
  assertEqual(d.strategy, 'explain', 'explain')
})

test('18. Voice mode keeps depth light', () => {
  const d = decide(
    {
      intent: 'learning',
      userNeed: 'explanation',
      emotionalState: 'neutral',
      conversationStage: 'developing',
      knowledgeLevel: 'advanced',
      confidence: 0.7,
    },
    {},
    { isVoice: true, preferenceBias: 'detailed' },
  )
  assertEqual(d.responseDepth, 'light', 'voice → light')
})

test('19. Thanks social → no question, warm/connect-or-continue', () => {
  const d = decide(
    {
      intent: 'small_talk',
      socialIntent: 'thanks',
      userNeed: 'connection',
      emotionalState: 'happy',
      conversationStage: 'developing',
      confidence: 0.85,
    },
    { currentTopic: 'css-grid', turnCount: 5 },
  )
  assertEqual(d.shouldAskQuestion, false, 'no question after thanks')
})

test('20. Engaged advice exploration may challenge', () => {
  const d = decide(
    {
      intent: 'advice',
      userNeed: 'direction',
      emotionalState: 'calm',
      conversationStage: 'deepening',
      confidence: 0.7,
    },
    { lastUserStance: 'engaged', currentTopic: 'career-change', turnCount: 10 },
  )
  // advice + explore/guide path
  assert(
    d.strategy === 'guide' || d.strategy === 'explore',
    'guide or explore',
  )
  assertEqual(d.shouldComfort, false, 'no comfort')
  // challenge allowed when engaged + not distressed
  if (d.strategy === 'guide') {
    assertEqual(d.shouldChallenge, true, 'challenge ok when guiding engaged user')
  }
})

test('21. Comfort and challenge are mutually exclusive (sad user)', () => {
  const d = decide({
    intent: 'emotional_support',
    userNeed: 'emotional_care',
    emotionalState: 'sad',
    conversationStage: 'developing',
    confidence: 0.9,
  })
  assertEqual(d.shouldComfort, true, 'comfort')
  assertEqual(d.shouldChallenge, false, 'invariant')
})

test('22. Initiative streak suppresses new initiative', () => {
  const d = decide(
    {
      intent: 'continuation',
      userNeed: 'continuation',
      emotionalState: 'curious',
      conversationStage: 'deepening',
      confidence: 0.7,
    },
    { currentTopic: 'history-rome', lastUserStance: 'engaged', turnCount: 9 },
    { initiativeStreak: 2 },
  )
  assertEqual(d.strategy, 'continue', 'continue')
  assertEqual(d.initiative, 'none', 'streak blocks initiative')
})

test('23. Pure function: identical inputs → identical outputs', () => {
  const input = {
    perception: {
      intent: 'news',
      userNeed: 'information',
      emotionalState: 'neutral',
      conversationStage: 'early',
      confidence: 0.66,
    },
    conversationMemory: { topics: ['elections'], turnCount: 3 },
    sessionState: { memoryEnabled: true },
  }
  assertEqual(JSON.stringify(think(input)), JSON.stringify(think(input)), 'deterministic')
})

test('24. Malformed input is fail-soft', () => {
  const d = think(/** @type {any} */ (null))
  assertShape(d)
  assertEqual(d.need, 'unclear', 'unclear need')
})

test('25. Resistant stance blocks challenge on guide', () => {
  const d = decide(
    {
      intent: 'problem_solving',
      userNeed: 'help_unblocking',
      emotionalState: 'neutral',
      conversationStage: 'developing',
      confidence: 0.7,
    },
    {
      currentTopic: 'refactor',
      lastUserStance: 'resistant',
      turnCount: 5,
    },
  )
  assertEqual(d.strategy, 'guide', 'guide')
  assertEqual(d.shouldChallenge, false, 'no challenge if resistant')
})

test('26. Unclear low-confidence may ask one question', () => {
  const d = decide(
    {
      intent: 'unclear',
      userNeed: 'unclear',
      emotionalState: 'confused',
      conversationStage: 'early',
      confidence: 0.3,
    },
    { turnCount: 1 },
    { questionStreak: 0 },
  )
  assertEqual(d.need, 'unclear', 'unclear')
  assertEqual(d.shouldAskQuestion, true, 'clarify once')
})

test('27. Entertainment → entertain + spark', () => {
  const d = decide({
    intent: 'entertainment',
    userNeed: 'connection',
    emotionalState: 'playful',
    conversationStage: 'early',
    confidence: 0.7,
  })
  assertEqual(d.strategy, 'entertain', 'entertain')
  assertEqual(d.initiative, 'one_spark', 'spark')
  assertEqual(d.shouldAskQuestion, false, 'no question')
  assertEqual(d.emotionalTone, 'playful', 'playful')
})

test('28. Meta language still yields information need / answer strategy', () => {
  const d = decide({
    intent: 'meta_language',
    userNeed: 'information',
    emotionalState: 'neutral',
    conversationStage: 'developing',
    confidence: 0.9,
  })
  assertEqual(d.need, 'information', 'information')
  assertEqual(d.strategy, 'answer', 'answer')
  assertEqual(d.shouldTeach, false, 'not teach mode')
})

test('29. Goal is machine-oriented, not user prose', () => {
  const d = decide({
    intent: 'greeting',
    socialIntent: 'greeting',
    userNeed: 'connection',
    conversationStage: 'opening',
    emotionalState: 'calm',
    confidence: 0.9,
  })
  assert(/^[a-z0-9_]+$/.test(d.goal), 'goal slug-like')
  assert(!/\s{2,}/.test(d.goal), 'no prose spacing')
  assert(!/[.!?]/.test(d.goal), 'no sentence punctuation')
})

test('30. does not mutate conversationMemory / sessionState objects', () => {
  const conversationMemory = {
    topics: ['alpha'],
    currentTopic: 'alpha',
    turnCount: 3,
  }
  const sessionState = { questionStreak: 1, memoryEnabled: true }
  const memoryBefore = JSON.stringify(conversationMemory)
  const sessionBefore = JSON.stringify(sessionState)
  think({
    perception: {
      intent: 'continuation',
      userNeed: 'continuation',
      conversationStage: 'developing',
      emotionalState: 'neutral',
      confidence: 0.6,
    },
    conversationMemory,
    sessionState,
  })
  assertEqual(JSON.stringify(conversationMemory), memoryBefore, 'memory untouched')
  assertEqual(JSON.stringify(sessionState), sessionBefore, 'session untouched')
})

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
