#!/usr/bin/env node
/**
 * Realistic tests for LAIfe V2 Planner.
 * Isolated: imports only ./planner.js — not wired to the chat pipeline.
 *
 * Run: node lib/server/v2/brain/planner.test.mjs
 */

import {
  plan,
  isPlannerPlan,
  formatWriterBrief,
  PLANNER_VERSION,
} from './planner.js'

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

/** @param {import('./planner.js').PlannerPlan} p */
function assertShape(p) {
  assert(isPlannerPlan(p), 'isPlannerPlan')
  assert(typeof p.objective === 'string' && p.objective.length > 0, 'objective')
  assert(p.conversationPlan.opening.role === 'opening', 'opening role')
  assert(Array.isArray(p.conversationPlan.development), 'development array')
  assert(p.conversationPlan.development.length >= 1, 'at least one development beat')
  assert(p.conversationPlan.closing.role === 'closing', 'closing role')
  assert(typeof p.writerBrief.moveSummary === 'string', 'moveSummary')
  assert(Array.isArray(p.writerBrief.must) && p.writerBrief.must.length > 0, 'must')
  assert(Array.isArray(p.writerBrief.mustNot) && p.writerBrief.mustNot.length > 0, 'mustNot')
  assert(Array.isArray(p.constraints) && p.constraints.length > 0, 'constraints')
  assert(p.confidence >= 0 && p.confidence <= 1, 'confidence')

  // Structural purposes must not look like final user replies
  const purposes = [
    p.conversationPlan.opening.purpose,
    ...p.conversationPlan.development.map((b) => b.purpose),
    p.conversationPlan.closing.purpose,
  ]
  for (const purpose of purposes) {
    assert(typeof purpose === 'string' && purpose.length > 10, 'purpose descriptive')
    assert(!/^ciao[!.,\s]*$/i.test(purpose), 'purpose is not user-facing chit-chat')
  }

  const forbidden = ['draft', 'responseText', 'finalAnswer', 'prompt']
  for (const key of forbidden) {
    assert(!Object.hasOwn(p, key), `no field ${key}`)
  }
}

/**
 * @param {Partial<import('./planner.js').MindDecision>} decision
 * @param {Partial<import('./planner.js').PerceptionResult>} [perception]
 */
function run(decision, perception = {}) {
  return plan({
    perception: {
      language: 'it',
      intent: 'unclear',
      socialIntent: 'none',
      emotionalState: 'neutral',
      conversationStage: 'developing',
      knowledgeLevel: 'unknown',
      userNeed: 'unclear',
      confidence: 0.6,
      ...perception,
    },
    decision: {
      need: 'information',
      goal: 'answer__need_information',
      strategy: 'answer',
      initiative: 'none',
      emotionalTone: 'calm',
      responseDepth: 'balanced',
      shouldUseMemory: false,
      shouldContinueTopic: false,
      shouldAskQuestion: false,
      shouldTeach: false,
      shouldComfort: false,
      shouldChallenge: false,
      confidence: 0.7,
      ...decision,
    },
  })
}

console.log(`Planner tests (${PLANNER_VERSION})\n`)

test('1. returns complete plan shape', () => {
  assertShape(run({}))
})

test('2. greeting/connect → warm_presence opening + spark coda', () => {
  const p = run(
    {
      need: 'connection',
      goal: 'connect__need_connection__one_spark',
      strategy: 'connect',
      initiative: 'one_spark',
      emotionalTone: 'warm',
      responseDepth: 'light',
      confidence: 0.9,
    },
    {
      language: 'it',
      intent: 'greeting',
      socialIntent: 'greeting',
      conversationStage: 'opening',
      userNeed: 'connection',
      confidence: 0.9,
    },
  )
  assertShape(p)
  assertEqual(p.conversationPlan.opening.kind, 'warm_presence', 'opening')
  assertEqual(p.writerBrief.coda, 'spark', 'coda spark')
  assertEqual(p.conversationPlan.closing.kind, 'one_spark', 'closing spark')
  assert(p.writerBrief.mustNot.some((x) => /question/i.test(x)), 'no question')
  assertEqual(p.conversationPlan.lengthBand, 'light', 'length')
})

test('3. support/comfort → emotion_first, no question, challenge forced false in brief', () => {
  const p = run(
    {
      need: 'emotional_care',
      strategy: 'support',
      initiative: 'none',
      emotionalTone: 'supportive',
      responseDepth: 'light',
      shouldComfort: true,
      shouldChallenge: true, // illegal combo from bad input — planner must not honor challenge
      shouldAskQuestion: false,
      confidence: 0.88,
    },
    { intent: 'emotional_support', emotionalState: 'anxious', userNeed: 'emotional_care' },
  )
  assertEqual(p.conversationPlan.opening.kind, 'emotion_first', 'emotion first')
  assertEqual(p.writerBrief.comfort, true, 'comfort')
  assertEqual(p.writerBrief.challenge, false, 'challenge suppressed')
  assertEqual(p.writerBrief.coda, 'none', 'no coda push')
  assert(p.constraints.includes('hard:no_challenge_with_comfort'), 'comfort constraint')
  assert(p.writerBrief.mustNot.some((x) => /challenge/i.test(x)), 'mustNot challenge')
})

test('4. explain + teach → teach_hook and progressive beats', () => {
  const p = run(
    {
      need: 'explanation',
      strategy: 'explain',
      shouldTeach: true,
      responseDepth: 'balanced',
      emotionalTone: 'curious',
      initiative: 'none',
    },
    { intent: 'learning', knowledgeLevel: 'beginner', language: 'en' },
  )
  assertEqual(p.conversationPlan.opening.kind, 'teach_hook', 'teach hook')
  assertEqual(p.writerBrief.teaching, true, 'teaching')
  assert(
    p.conversationPlan.development.some((b) =>
      /core_idea|progressive_teach|why_it_matters|example/.test(b.kind),
    ),
    'teach beats',
  )
  assertEqual(p.writerBrief.language, 'en', 'language passthrough')
})

test('5. deep explain adds more development beats than light', () => {
  const light = run({
    strategy: 'explain',
    shouldTeach: true,
    responseDepth: 'light',
  })
  const deep = run({
    strategy: 'explain',
    shouldTeach: true,
    responseDepth: 'deep',
  })
  assert(
    deep.conversationPlan.development.length > light.conversationPlan.development.length,
    'deep > light beats',
  )
  assertEqual(deep.conversationPlan.lengthBand, 'deep', 'deep band')
})

test('6. continue + insight → continue_thread + one_insight closing', () => {
  const p = run({
    need: 'continuation',
    strategy: 'continue',
    shouldContinueTopic: true,
    initiative: 'one_insight',
    responseDepth: 'balanced',
    emotionalTone: 'warm',
  })
  assertEqual(p.conversationPlan.opening.kind, 'continue_thread', 'continue opening')
  assertEqual(p.writerBrief.coda, 'insight', 'insight coda')
  assertEqual(p.conversationPlan.closing.kind, 'one_insight', 'closing')
  assertEqual(p.writerBrief.continueTopic, true, 'continueTopic')
  assert(p.writerBrief.mustNot.some((x) => /Do not ask a question/i.test(x)), 'no question')
})

test('7. shouldAskQuestion wins coda over initiative', () => {
  const p = run({
    strategy: 'guide',
    shouldAskQuestion: true,
    initiative: 'one_insight',
    responseDepth: 'balanced',
    need: 'help_unblocking',
  })
  assertEqual(p.writerBrief.coda, 'question', 'question wins')
  assertEqual(p.conversationPlan.closing.kind, 'one_question', 'one question')
  assert(p.constraints.includes('ask_question:yes'), 'constraint yes')
})

test('8. ask_question:no is honored even if perception looks confused', () => {
  const p = run(
    {
      strategy: 'explain',
      shouldTeach: true,
      shouldAskQuestion: false,
      initiative: 'none',
    },
    { emotionalState: 'confused', intent: 'learning', confidence: 0.2 },
  )
  assertEqual(p.writerBrief.coda, 'none', 'still no question')
  assert(p.constraints.includes('ask_question:no'), 'no question constraint')
  assert(p.constraints.includes('hard:no_question'), 'hard no question')
})

test('9. close strategy → farewell opening, none coda, hard:no_reopen', () => {
  const p = run({
    need: 'closure',
    strategy: 'close',
    initiative: 'one_spark', // malformed vs Mind invariants — planner packs close as none
    shouldAskQuestion: false,
    responseDepth: 'minimal',
    emotionalTone: 'warm',
  })
  assertEqual(p.conversationPlan.opening.kind, 'warm_farewell', 'farewell')
  assertEqual(p.writerBrief.coda, 'none', 'no coda on close')
  assertEqual(p.conversationPlan.closing.kind, 'none_stop', 'stop')
  assert(p.constraints.includes('hard:no_reopen'), 'no reopen')
})

test('10. recover → ack_feedback opening', () => {
  const p = run({
    need: 'feedback_ack',
    strategy: 'recover',
    emotionalTone: 'calm',
    responseDepth: 'light',
    initiative: 'none',
  })
  assertEqual(p.conversationPlan.opening.kind, 'ack_feedback', 'ack')
  assert(
    p.conversationPlan.development.some((b) => b.kind === 'adjust_behavior'),
    'adjust beat',
  )
  assertEqual(p.writerBrief.memoryHint, 'omit', 'no memory on recover default')
})

test('11. celebrate → share_joy, no interview', () => {
  const p = run({
    need: 'celebration_share',
    strategy: 'celebrate',
    emotionalTone: 'encouraging',
    responseDepth: 'light',
    initiative: 'none',
  })
  assertEqual(p.conversationPlan.opening.kind, 'share_joy', 'joy')
  assert(p.writerBrief.mustNot.some((x) => /interview/i.test(x)), 'no interview')
})

test('12. explore + one_direction → commit_direction + direction coda', () => {
  const p = run({
    need: 'direction',
    strategy: 'explore',
    initiative: 'one_direction',
    responseDepth: 'balanced',
    emotionalTone: 'curious',
  })
  assertEqual(p.conversationPlan.opening.kind, 'commit_direction', 'commit')
  assertEqual(p.writerBrief.coda, 'direction', 'direction coda')
  assertEqual(p.conversationPlan.closing.kind, 'one_direction', 'closing')
})

test('13. guide with challenge adds respectful_reframe when deep', () => {
  const p = run({
    need: 'help_unblocking',
    strategy: 'guide',
    shouldChallenge: true,
    shouldComfort: false,
    responseDepth: 'deep',
    emotionalTone: 'serious',
    initiative: 'none',
  })
  assert(
    p.conversationPlan.development.some((b) => b.kind === 'respectful_reframe'),
    'reframe beat',
  )
  assertEqual(p.writerBrief.challenge, true, 'challenge')
})

test('14. memory allowed when shouldUseMemory', () => {
  const p = run({
    strategy: 'continue',
    shouldUseMemory: true,
    shouldContinueTopic: true,
    initiative: 'one_insight',
  })
  assertEqual(p.writerBrief.memoryHint, 'weave_soft', 'weave soft')
  assert(p.constraints.includes('use_memory:yes'), 'memory yes')
  assert(p.writerBrief.must.some((x) => /memory/i.test(x)), 'must weave')
})

test('15. memory omit when shouldUseMemory false', () => {
  const p = run({
    strategy: 'answer',
    shouldUseMemory: false,
  })
  assertEqual(p.writerBrief.memoryHint, 'omit', 'omit')
  assert(p.constraints.includes('use_memory:no'), 'memory no')
  assert(p.writerBrief.mustNot.some((x) => /memory/i.test(x)), 'mustNot memory')
})

test('16. objective mirrors decision.goal', () => {
  const p = run({
    goal: 'continue__need_continuation__one_insight',
    strategy: 'continue',
    need: 'continuation',
    initiative: 'one_insight',
    shouldContinueTopic: true,
  })
  assertEqual(p.objective, 'continue__need_continuation__one_insight', 'objective')
})

test('17. writerBrief tone/depth/strategy copied from decision', () => {
  const p = run({
    strategy: 'guide',
    emotionalTone: 'serious',
    responseDepth: 'deep',
    need: 'help_unblocking',
  })
  assertEqual(p.writerBrief.tone, 'serious', 'tone')
  assertEqual(p.writerBrief.depth, 'deep', 'depth')
  assertEqual(p.writerBrief.strategy, 'guide', 'strategy')
  assertEqual(p.writerBrief.need, 'help_unblocking', 'need')
})

test('18. perception language flows to writerBrief only (no re-decision)', () => {
  const p = run(
    { strategy: 'answer', need: 'information' },
    { language: 'en', intent: 'news' },
  )
  assertEqual(p.writerBrief.language, 'en', 'en')
  // Strategy stays answer even if intent is news — already decided
  assertEqual(p.writerBrief.strategy, 'answer', 'no reinterpret')
})

test('19. decision overrides conflicting perception need/strategy signals', () => {
  const p = run(
    {
      strategy: 'support',
      need: 'emotional_care',
      shouldComfort: true,
      emotionalTone: 'supportive',
    },
    {
      intent: 'learning',
      userNeed: 'explanation',
      emotionalState: 'curious',
    },
  )
  assertEqual(p.writerBrief.strategy, 'support', 'decision wins')
  assertEqual(p.writerBrief.need, 'emotional_care', 'need from decision')
  assertEqual(p.conversationPlan.opening.kind, 'emotion_first', 'comfort opening')
})

test('20. entertain → playful_hook', () => {
  const p = run({
    strategy: 'entertain',
    need: 'connection',
    emotionalTone: 'playful',
    initiative: 'one_spark',
    responseDepth: 'light',
  })
  assertEqual(p.conversationPlan.opening.kind, 'playful_hook', 'hook')
  assertEqual(p.writerBrief.coda, 'spark', 'spark')
})

test('21. minimal depth → single development beat', () => {
  const p = run({
    strategy: 'answer',
    responseDepth: 'minimal',
  })
  assertEqual(p.conversationPlan.development.length, 1, 'one beat')
  assertEqual(p.conversationPlan.lengthBand, 'minimal', 'band')
})

test('22. formatWriterBrief produces executable instructions string', () => {
  const p = run({
    strategy: 'explain',
    shouldTeach: true,
    emotionalTone: 'calm',
  })
  const text = formatWriterBrief(p)
  assert(/WRITER BRIEF/i.test(text), 'header')
  assert(/MUST:/i.test(text), 'must section')
  assert(/MUST NOT:/i.test(text), 'mustNot section')
  assert(/strategy=explain/.test(text), 'strategy inline')
  assert(!/OpenAI|gpt-/i.test(text), 'no model talk')
})

test('23. pure function: same input → same output', () => {
  const input = {
    perception: {
      language: 'it',
      intent: 'continuation',
      confidence: 0.7,
      conversationStage: 'deepening',
      knowledgeLevel: 'intermediate',
      emotionalState: 'curious',
      socialIntent: 'none',
      userNeed: 'continuation',
    },
    decision: {
      need: 'continuation',
      goal: 'continue__need_continuation__one_insight',
      strategy: 'continue',
      initiative: 'one_insight',
      emotionalTone: 'warm',
      responseDepth: 'deep',
      shouldUseMemory: true,
      shouldContinueTopic: true,
      shouldAskQuestion: false,
      shouldTeach: false,
      shouldComfort: false,
      shouldChallenge: false,
      confidence: 0.8,
    },
  }
  assertEqual(JSON.stringify(plan(input)), JSON.stringify(plan(input)), 'deterministic')
})

test('24. does not mutate input objects', () => {
  const perception = {
    language: 'it',
    intent: 'greeting',
    socialIntent: 'greeting',
    emotionalState: 'calm',
    conversationStage: 'opening',
    knowledgeLevel: 'unknown',
    userNeed: 'connection',
    confidence: 0.9,
  }
  const decision = {
    need: 'connection',
    goal: 'connect__need_connection__one_spark',
    strategy: 'connect',
    initiative: 'one_spark',
    emotionalTone: 'warm',
    responseDepth: 'light',
    shouldUseMemory: false,
    shouldContinueTopic: false,
    shouldAskQuestion: false,
    shouldTeach: false,
    shouldComfort: false,
    shouldChallenge: false,
    confidence: 0.9,
  }
  const pBefore = JSON.stringify(perception)
  const dBefore = JSON.stringify(decision)
  plan({ perception, decision })
  assertEqual(JSON.stringify(perception), pBefore, 'perception untouched')
  assertEqual(JSON.stringify(decision), dBefore, 'decision untouched')
})

test('25. malformed input is fail-soft', () => {
  const p = plan(/** @type {any} */ (null))
  assertShape(p)
  assertEqual(p.writerBrief.strategy, 'answer', 'default strategy')
})

test('26. constraints always include strategy and need', () => {
  const p = run({ strategy: 'guide', need: 'help_unblocking' })
  assert(p.constraints.includes('strategy:guide'), 'strategy constraint')
  assert(p.constraints.includes('need:help_unblocking'), 'need constraint')
})

test('27. knowledgeLevel appears in must when not unknown', () => {
  const p = run(
    { strategy: 'explain', shouldTeach: true },
    { knowledgeLevel: 'expert', language: 'en' },
  )
  assert(
    p.writerBrief.must.some((m) => /knowledgeLevel="expert"/.test(m)),
    'knowledge calibration',
  )
})

test('28. beginner teach may include simple_language beat when room', () => {
  const p = run(
    {
      strategy: 'explain',
      shouldTeach: true,
      responseDepth: 'deep',
    },
    { knowledgeLevel: 'beginner' },
  )
  assert(
    p.conversationPlan.development.some(
      (b) => b.kind === 'simple_language' || b.kind === 'example',
    ),
    'beginner-friendly beat present',
  )
})

test('29. no user-message analysis fields required or emitted', () => {
  const p = run({ strategy: 'answer' })
  assert(!Object.hasOwn(p, 'userMessage'), 'no userMessage out')
  assert(!Object.hasOwn(p.writerBrief, 'userMessage'), 'no userMessage in brief')
  assert(!Object.hasOwn(p, 'tokens'), 'no tokens')
})

test('30. beatCount matches opening+development+closing', () => {
  const p = run({ strategy: 'explain', shouldTeach: true, responseDepth: 'deep' })
  assertEqual(
    p.conversationPlan.beatCount,
    1 + p.conversationPlan.development.length + 1,
    'beatCount',
  )
})

test('31. guide opening is problem_frame', () => {
  const p = run({
    strategy: 'guide',
    need: 'help_unblocking',
    responseDepth: 'balanced',
  })
  assertEqual(p.conversationPlan.opening.kind, 'problem_frame', 'problem frame')
  assert(
    p.conversationPlan.development.some((b) => b.kind === 'next_step'),
    'next step',
  )
})

test('32. answer strategy opening is direct_answer', () => {
  const p = run({ strategy: 'answer', need: 'information' })
  assertEqual(p.conversationPlan.opening.kind, 'direct_answer', 'direct')
})

test('33. writerBrief.mustNot forbids mentioning internal modules', () => {
  const p = run({})
  assert(
    p.writerBrief.mustNot.some((x) => /engines|plans|scores|internal/i.test(x)),
    'no internals',
  )
})

test('34. confidence is finite and lowered on comfort+challenge conflict input', () => {
  const clean = run({
    strategy: 'support',
    shouldComfort: true,
    shouldChallenge: false,
    confidence: 0.9,
  })
  const conflict = run({
    strategy: 'support',
    shouldComfort: true,
    shouldChallenge: true,
    confidence: 0.9,
  })
  assert(conflict.confidence < clean.confidence, 'conflict lowers confidence')
})

test('35. does not import or reference V1 decision fields like writerDirective', () => {
  const p = run({ strategy: 'continue', shouldContinueTopic: true })
  const json = JSON.stringify(p)
  assert(!/writerDirective|cognitiveBlock|FALLBACK_SYSTEM/.test(json), 'no V1 leakage')
})

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
