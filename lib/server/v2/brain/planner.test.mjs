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
  evaluateConversationFocus,
  evaluateConversationMomentum,
  evaluateConversationExperience,
  buildExperienceGuidance,
  decideConversationResumeUsage,
  matchConversationCues,
  CONTINUATION_CUES,
  TOPIC_CHANGE_CUES,
  CONVERSATION_EXPERIENCES,
  EXPLORATION_PRINCIPLES_DIRECTIVES,
  LEARNING_PRINCIPLES_DIRECTIVES,
  PLANNING_PRINCIPLES_DIRECTIVES,
  PLANNER_VERSION,
  RESUME_MIN_CONFIDENCE,
} from './planner.js'
import { RuntimeProfiles } from './runtime-profile.js'
import { resumeConversation } from './conversation-resume.js'

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
  assert(p.conversationFocus && typeof p.conversationFocus === 'object', 'conversationFocus')
  assert(
    ['active', 'changed', 'ambiguous', 'none'].includes(p.conversationFocus.status),
    'focus status',
  )
  assert(p.conversationMomentum && typeof p.conversationMomentum === 'object', 'conversationMomentum')
  assert(typeof p.conversationMomentum.kind === 'string', 'momentum kind')
  assert(p.conversationResume && typeof p.conversationResume === 'object', 'conversationResume')
  assert(typeof p.conversationResume.used === 'boolean', 'resume used')
  assert(p.conversationExperience && typeof p.conversationExperience === 'object', 'conversationExperience')
  assert(typeof p.conversationExperience.experience === 'string', 'experience kind')
  assert(typeof p.conversationExperience.confidence === 'number', 'experience confidence')
  assert(typeof p.conversationExperience.reason === 'string', 'experience reason')
  assert(p.experienceGuidance && typeof p.experienceGuidance === 'object', 'experienceGuidance')
  assert(Array.isArray(p.experienceGuidance.directives), 'experience directives')
  assert(
    p.writerBrief.resumeSentence === null || typeof p.writerBrief.resumeSentence === 'string',
    'resumeSentence opaque',
  )

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

test('36. conversationFocus status none without chat history', () => {
  const p = run({ strategy: 'connect' })
  assertEqual(p.conversationFocus.status, 'none', 'no history → none')
  assertEqual(p.conversationFocus.avoidClarification, false, 'no avoid')
})

test('37. conversationFocus active on minimal ack continuation', () => {
  const p = plan({
    perception: {
      language: 'it',
      intent: 'continuation',
      socialIntent: 'ack',
      emotionalState: 'neutral',
      conversationStage: 'developing',
      knowledgeLevel: 'unknown',
      userNeed: 'connection',
      confidence: 0.8,
    },
    decision: {
      need: 'connection',
      goal: 'continue__need_connection',
      strategy: 'continue',
      initiative: 'none',
      emotionalTone: 'warm',
      responseDepth: 'light',
      shouldUseMemory: false,
      shouldContinueTopic: true,
      shouldAskQuestion: false,
      shouldTeach: false,
      shouldComfort: false,
      shouldChallenge: false,
      confidence: 0.85,
    },
    messages: [
      { role: 'user', content: 'Sto lavorando a un progetto di fotografia analogica.' },
      {
        role: 'assistant',
        content: 'Interessante. La pellicola cambia molto il ritmo rispetto al digitale.',
      },
      { role: 'user', content: 'esatto' },
    ],
  })
  assertEqual(p.conversationFocus.status, 'active', 'active')
  assert(p.conversationFocus.avoidClarification, 'avoid clarification')
  assert(p.conversationFocus.topic, 'has topic')
  assert(
    p.writerBrief.mustNot.some((m) => /re-identify the topic|still active/i.test(m)),
    'mustNot clarification',
  )
})

test('38. conversationFocus changed when user switches topic', () => {
  const focus = evaluateConversationFocus(
    [
      { role: 'user', content: 'Parliamo di fotografia analogica e pellicola.' },
      { role: 'assistant', content: 'Va bene, restiamo sulla pellicola.' },
      { role: 'user', content: 'In realtà vorrei una ricetta per la carbonara.' },
    ],
    { shouldContinueTopic: false, strategy: 'answer' },
    { intent: 'request' },
  )
  assertEqual(focus.status, 'changed', 'changed')
  assertEqual(focus.avoidClarification, false, 'may clarify')
})

test('39. conversationFocus ambiguous on weak unclear turn', () => {
  const focus = evaluateConversationFocus(
    [
      { role: 'user', content: 'Sto preparando un esame di matematica.' },
      { role: 'assistant', content: 'Ok, su quale parte ti bloccavi?' },
      { role: 'user', content: 'Boh.' },
    ],
    { shouldContinueTopic: false, strategy: 'guide' },
    { intent: 'unclear' },
  )
  assertEqual(focus.status, 'ambiguous', 'ambiguous')
})

test('40. active focus suppresses useless clarification coda', () => {
  const p = plan({
    perception: {
      language: 'it',
      intent: 'continuation',
      socialIntent: 'none',
      emotionalState: 'neutral',
      conversationStage: 'developing',
      knowledgeLevel: 'unknown',
      userNeed: 'connection',
      confidence: 0.7,
    },
    decision: {
      need: 'connection',
      goal: 'continue__need_connection',
      strategy: 'continue',
      initiative: 'one_spark',
      emotionalTone: 'warm',
      responseDepth: 'light',
      shouldUseMemory: false,
      shouldContinueTopic: true,
      shouldAskQuestion: true,
      shouldTeach: false,
      shouldComfort: false,
      shouldChallenge: false,
      confidence: 0.7,
    },
    messages: [
      { role: 'user', content: 'Mi piace camminare la sera vicino al fiume.' },
      { role: 'assistant', content: 'Quel ritmo lento aiuta a scaricare la giornata.' },
      { role: 'user', content: 'sì, e poi ascolto musica.' },
    ],
  })
  assertEqual(p.conversationFocus.status, 'active', 'active focus')
  assert(p.conversationFocus.avoidClarification, 'avoid')
  assert(p.writerBrief.coda !== 'question', 'no clarification coda')
  assert(p.constraints.includes('ask_question:no'), 'ask_question no')
  assert(p.constraints.includes('hard:no_useless_clarification'), 'hard flag')
  assert(p.constraints.includes('conversation_focus:active'), 'focus constraint')
})

test('41. formatWriterBrief includes conversationFocus when plan provided', () => {
  const p = plan({
    perception: { language: 'it', confidence: 0.6 },
    decision: {
      strategy: 'continue',
      shouldContinueTopic: true,
      initiative: 'none',
      responseDepth: 'light',
      emotionalTone: 'warm',
      need: 'connection',
      goal: 'continue__need_connection',
      confidence: 0.7,
    },
    messages: [
      { role: 'user', content: 'Sto imparando il piano.' },
      { role: 'assistant', content: 'Bello, che pezzo stai provando?' },
      { role: 'user', content: 'ok' },
    ],
  })
  const text = formatWriterBrief(p)
  assert(/conversationFocus:/.test(text), 'focus line')
  assert(/status=active/.test(text), 'active in brief')
})

test('42. evaluateConversationFocus is pure over the same history', () => {
  const messages = [
    { role: 'user', content: 'Voglio organizzare un viaggio a Lisbona.' },
    { role: 'assistant', content: 'Partiamo dalle date o dal budget?' },
    { role: 'user', content: 'Dal budget.' },
  ]
  const a = evaluateConversationFocus(messages, { shouldContinueTopic: true }, {})
  const b = evaluateConversationFocus(messages, { shouldContinueTopic: true }, {})
  assertEqual(JSON.stringify(a), JSON.stringify(b), 'pure')
})

test('43. conversationFocus does not use permanent memory fields', () => {
  const p = plan({
    perception: { language: 'it', confidence: 0.5 },
    decision: {
      strategy: 'continue',
      shouldContinueTopic: true,
      shouldUseMemory: true,
      initiative: 'none',
      responseDepth: 'light',
      emotionalTone: 'warm',
      need: 'connection',
      goal: 'continue__need_connection',
      confidence: 0.6,
    },
    messages: [
      { role: 'user', content: 'Parliamo del mio gatto.' },
      { role: 'assistant', content: 'Come si chiama?' },
      { role: 'user', content: 'esatto' },
    ],
    // @ts-expect-error intentional — durable memory must be ignored by Planner focus
    memoryPack: { items: [{ text: 'User owns a dog named Rex' }] },
  })
  assert(!/rex|dog/i.test(String(p.conversationFocus.topic || '')), 'no durable memory bleed')
  assertEqual(p.conversationFocus.status, 'active', 'history-only active')
})

const FOCUS_CUE_PRIOR = [
  { role: 'user', content: 'Stiamo lavorando sullo sviluppo di LAIfe e Conversation Momentum.' },
  { role: 'assistant', content: 'Ok, Presence Recovery e Conversation Momentum sono a posto.' },
]

test('43b. CONTINUATION_CUES → continuiamo keeps active prior topic', () => {
  const focus = evaluateConversationFocus(
    [...FOCUS_CUE_PRIOR, { role: 'user', content: 'continuiamo' }],
    {},
    {},
  )
  assertEqual(focus.status, 'active', 'active')
  assert(focus.avoidClarification, 'avoidClarification')
  assert(/laife|momentum|sviluppo/i.test(String(focus.topic || '')), `topic=${focus.topic}`)
  assert(focus.signals.some((s) => /continuation_cue:continuiamo/.test(s)), 'cue signal')
  assert(focus.signals.includes('preserve_momentum'), 'preserve momentum')
})

test('43c. CONTINUATION_CUES → riprendiamo keeps active prior topic', () => {
  const focus = evaluateConversationFocus(
    [...FOCUS_CUE_PRIOR, { role: 'user', content: 'riprendiamo' }],
    {},
    {},
  )
  assertEqual(focus.status, 'active', 'active')
  assert(focus.avoidClarification, 'avoid')
  assert(focus.signals.some((s) => /continuation_cue:riprendiamo/.test(s)), 'cue')
})

test('43d. CONTINUATION_CUES → dove eravamo rimasti keeps active prior topic', () => {
  const focus = evaluateConversationFocus(
    [...FOCUS_CUE_PRIOR, { role: 'user', content: 'dove eravamo rimasti' }],
    {},
    {},
  )
  assertEqual(focus.status, 'active', 'active')
  assert(focus.avoidClarification, 'avoid')
  assert(/laife|momentum|sviluppo/i.test(String(focus.topic || '')), `topic=${focus.topic}`)
  assert(focus.signals.some((s) => /dove eravamo rimasti/.test(s)), 'cue')
})

test('43e. TOPIC_CHANGE_CUES → un\'altra cosa leans changed', () => {
  const focus = evaluateConversationFocus(
    [...FOCUS_CUE_PRIOR, { role: 'user', content: "un'altra cosa" }],
    {},
    {},
  )
  assertEqual(focus.status, 'changed', 'changed')
  assertEqual(focus.avoidClarification, false, 'may clarify')
  assert(focus.signals.some((s) => /topic_change_cue:/.test(s)), 'change cue')
})

test('43f. TOPIC_CHANGE_CUES → cambiando argomento leans changed', () => {
  const focus = evaluateConversationFocus(
    [...FOCUS_CUE_PRIOR, { role: 'user', content: 'cambiando argomento' }],
    {},
    {},
  )
  assertEqual(focus.status, 'changed', 'changed')
  assert(focus.signals.some((s) => /cambiando argomento/.test(s)), 'cue')
})

test('43g. TOPIC_CHANGE_CUES → a proposito leans changed (no longer continuation)', () => {
  const focus = evaluateConversationFocus(
    [...FOCUS_CUE_PRIOR, { role: 'user', content: 'a proposito' }],
    {},
    {},
  )
  assertEqual(focus.status, 'changed', 'changed')
  assertEqual(focus.avoidClarification, false, 'no avoid')
  assert(focus.signals.some((s) => /topic_change_cue:.*a proposito/.test(s)), 'change cue')
  assert(!focus.signals.some((s) => /continuation_cue:/.test(s)), 'not continuation')
})

test('43h. TOPIC_CHANGE_CUES do not force change when same topic remains', () => {
  const focus = evaluateConversationFocus(
    [
      ...FOCUS_CUE_PRIOR,
      {
        role: 'user',
        content: 'a proposito, restiamo su LAIfe e Conversation Momentum senza cambiare.',
      },
    ],
    {},
    {},
  )
  assertEqual(focus.status, 'active', 'same topic wins')
  assert(focus.avoidClarification, 'avoid')
  assert(focus.signals.some((s) => /topic_change_cue_soft:/.test(s)), 'soft cue')
  assert(focus.signals.some((s) => /same_topic_overrides_change_cue/.test(s)), 'override')
})

test('43i. matchConversationCues covers both cue sets', () => {
  assert(
    matchConversationCues('Ok, continuiamo pure', CONTINUATION_CUES).includes('continuiamo'),
    'continuiamo',
  )
  assert(
    matchConversationCues("Ho un'altra cosa da dirti", TOPIC_CHANGE_CUES).includes("un'altra cosa"),
    "un'altra cosa",
  )
  assertEqual(CONTINUATION_CUES.length, 10, 'continuation set size')
  assertEqual(TOPIC_CHANGE_CUES.length, 8, 'topic-change set size')
})

test('44. conversationMomentum kinds cover the initial set', () => {
  const kinds = new Set([
    'social',
    'brainstorming',
    'learning',
    'debugging',
    'planning',
    'decision',
    'storytelling',
    'emotional_support',
  ])
  const p = run({ strategy: 'connect' })
  assert(kinds.has(p.conversationMomentum.kind), 'known kind')
})

test('45. conversationMomentum infers debugging from history', () => {
  const m = evaluateConversationMomentum(
    [
      { role: 'user', content: 'Ho un TypeError undefined in console e il login non funziona.' },
      { role: 'assistant', content: 'Vediamo lo stack e dove crasha.' },
      { role: 'user', content: 'Il bug compare dopo il submit.' },
    ],
    { strategy: 'guide' },
    { intent: 'problem' },
  )
  assertEqual(m.kind, 'debugging', 'debugging')
  assert(m.confidence >= 0.5, 'confident enough')
})

test('46. conversationMomentum infers learning and shapes development', () => {
  const p = plan({
    perception: {
      language: 'it',
      intent: 'question',
      knowledgeLevel: 'beginner',
      confidence: 0.7,
    },
    decision: {
      strategy: 'continue',
      shouldTeach: false,
      shouldContinueTopic: true,
      initiative: 'none',
      responseDepth: 'balanced',
      emotionalTone: 'calm',
      need: 'learning',
      goal: 'continue__need_learning',
      confidence: 0.7,
    },
    messages: [
      { role: 'user', content: 'Spiegami come funziona la fotosintesi, voglio imparare bene.' },
      { role: 'assistant', content: 'Partiamo dall’idea centrale.' },
      { role: 'user', content: 'Ok, continua la lezione con un esempio.' },
    ],
    useConversationExperience: false,
  })
  assertEqual(p.conversationMomentum.kind, 'learning', 'learning momentum')
  assert(
    p.conversationPlan.development.some((b) => b.kind === 'core_idea' || b.kind === 'why_it_matters'),
    'learning development beats',
  )
  assert(p.constraints.includes('conversation_momentum:learning'), 'constraint')
  assert(
    p.writerBrief.must.some((m) => /conversationMomentum="learning"/i.test(m)),
    'must mentions momentum',
  )
})

test('47. conversationMomentum infers emotional_support', () => {
  const m = evaluateConversationMomentum(
    [
      { role: 'user', content: 'Mi sento triste e ansioso oggi.' },
      { role: 'assistant', content: 'Sono qui con te.' },
      { role: 'user', content: 'Non ce la faccio, ho bisogno di supporto.' },
    ],
    { strategy: 'answer' },
    { emotionalState: 'neutral' },
  )
  assertEqual(m.kind, 'emotional_support', 'support')
})

test('48. conversationMomentum planning shapes sequenced development', () => {
  const p = plan({
    perception: { language: 'it', confidence: 0.6 },
    decision: {
      strategy: 'continue',
      shouldContinueTopic: true,
      initiative: 'none',
      responseDepth: 'balanced',
      emotionalTone: 'neutral',
      need: 'guidance',
      goal: 'continue__need_guidance',
      confidence: 0.65,
    },
    messages: [
      { role: 'user', content: 'Aiutami a organizzare un piano e una roadmap per il lancio.' },
      { role: 'assistant', content: 'Ok, definiamo le fasi.' },
      { role: 'user', content: 'Sì, checklist e priorità per questa settimana.' },
    ],
    useConversationExperience: false,
  })
  assertEqual(p.conversationMomentum.kind, 'planning', 'planning')
  assert(
    p.conversationPlan.development.some(
      (b) => b.kind === 'frame_goal' || b.kind === 'sequenced_steps',
    ),
    'planning beats',
  )
})

test('49. conversationMomentum decision shapes tradeoff development', () => {
  const p = plan({
    perception: { language: 'en', confidence: 0.6 },
    decision: {
      strategy: 'continue',
      shouldContinueTopic: true,
      initiative: 'none',
      responseDepth: 'balanced',
      emotionalTone: 'neutral',
      need: 'guidance',
      goal: 'continue__need_guidance',
      confidence: 0.6,
    },
    messages: [
      { role: 'user', content: 'Should I choose option A or option B for the contract?' },
      { role: 'assistant', content: 'Depends on the tradeoff you care about.' },
      { role: 'user', content: 'I need a decision recommendation, versus costs.' },
    ],
    useConversationExperience: false,
  })
  assertEqual(p.conversationMomentum.kind, 'decision', 'decision')
  assert(
    p.conversationPlan.development.some((b) =>
      ['options_frame', 'tradeoff', 'recommend_one'].includes(b.kind),
    ),
    'decision beats',
  )
})

test('50. formatWriterBrief includes conversationMomentum', () => {
  const p = plan({
    perception: { language: 'it', confidence: 0.5 },
    decision: {
      strategy: 'connect',
      initiative: 'one_spark',
      responseDepth: 'light',
      emotionalTone: 'warm',
      need: 'connection',
      goal: 'connect__need_connection',
      confidence: 0.7,
    },
    messages: [{ role: 'user', content: 'Ciao, come stai?' }],
  })
  const text = formatWriterBrief(p)
  assert(/conversationMomentum:/.test(text), 'momentum line')
  assert(/kind=social/.test(text), 'social kind in brief')
})

test('51. evaluateConversationMomentum is pure and history-only', () => {
  const messages = [
    { role: 'user', content: 'Raccontami una storia su un viaggio.' },
    { role: 'assistant', content: 'C’era una volta un treno lento…' },
    { role: 'user', content: 'Continua il racconto.' },
  ]
  const a = evaluateConversationMomentum(messages, {}, {})
  const b = evaluateConversationMomentum(messages, {}, {})
  assertEqual(JSON.stringify(a), JSON.stringify(b), 'pure')
  assertEqual(a.kind, 'storytelling', 'storytelling')
})

const LAIFE_RESUME_HISTORY = [
  {
    role: 'user',
    content: 'Stiamo lavorando sullo sviluppo di LAIfe. L\'obiettivo è rendere V2 più naturale.',
  },
  {
    role: 'assistant',
    content: 'Presence Recovery completato. Conversation Momentum aggiunto.',
  },
  {
    role: 'user',
    content: 'Decisione: non modificare più il Writer. Passare alla continuità della conversazione.',
  },
  {
    role: 'assistant',
    content: 'Ok: Writer freeze e focus su resume / continuity.',
  },
]

test('52. conversationResume eligible → writerBrief.resumeSentence only', () => {
  const messages = [
    ...LAIFE_RESUME_HISTORY,
    { role: 'user', content: 'Riprendiamo da dove avevamo lasciato.' },
  ]
  const conversationResume = resumeConversation({ messages })
  assert(conversationResume.confidence >= RESUME_MIN_CONFIDENCE, 'confidence gate')
  const p = plan({
    perception: { language: 'it', confidence: 0.7, conversationStage: 'opening' },
    decision: {
      strategy: 'continue',
      initiative: 'none',
      responseDepth: 'light',
      emotionalTone: 'calm',
      need: 'continuity',
      goal: 'continue__need_continuity',
      shouldContinueTopic: true,
      shouldUseMemory: false,
      confidence: 0.8,
    },
    messages,
    conversationResume,
  })
  assertEqual(p.conversationResume.used, true, 'used')
  assert(typeof p.writerBrief.resumeSentence === 'string', 'sentence string')
  assert(p.writerBrief.resumeSentence.length > 10, 'sentence present')
  assert(
    p.writerBrief.must.some((m) => m.includes(p.writerBrief.resumeSentence)),
    'must carries resumeSentence',
  )
  assert(
    !JSON.stringify(p.writerBrief).includes('importantDecisions'),
    'writerBrief has no full resume structure',
  )
  assert(p.constraints.includes('conversation_resume:yes'), 'constraint yes')
})

test('53. conversationResume ignored when confidence low', () => {
  const messages = [
    ...LAIFE_RESUME_HISTORY,
    { role: 'user', content: 'Ciao di nuovo.' },
  ]
  const usage = decideConversationResumeUsage({
    conversationResume: {
      suggestedResumeSentence: 'L\'ultima volta stavamo lavorando su LAIfe.',
      confidence: 0.5,
    },
    conversationFocus: { status: 'active', topic: 'LAIfe', confidence: 0.8, signals: [], avoidClarification: true },
    messages,
  })
  assertEqual(usage.used, false, 'not used')
  assertEqual(usage.reason, 'low_confidence', 'reason')
})

test('54. conversationResume ignored when topic changed', () => {
  const messages = [
    ...LAIFE_RESUME_HISTORY,
    { role: 'user', content: 'Parliamo di cucina thailandese adesso.' },
  ]
  const conversationResume = resumeConversation({ messages: LAIFE_RESUME_HISTORY })
  const usage = decideConversationResumeUsage({
    conversationResume: { ...conversationResume, confidence: 0.9 },
    conversationFocus: { status: 'changed', topic: 'cucina', confidence: 0.8, signals: [], avoidClarification: false },
    messages,
  })
  assertEqual(usage.used, false, 'ignored')
  assertEqual(usage.reason, 'topic_changed', 'reason')
})

test('54b. soft riprendiamo cue is not treated as topic change', () => {
  const messages = [
    ...LAIFE_RESUME_HISTORY,
    { role: 'user', content: 'Riprendiamo da dove avevamo lasciato.' },
  ]
  const usage = decideConversationResumeUsage({
    conversationResume: {
      suggestedResumeSentence: 'L\'ultima volta stavamo lavorando per rendere V2 più naturale.',
      confidence: 0.9,
    },
    conversationFocus: {
      status: 'changed',
      topic: 'riprendiamo',
      confidence: 0.8,
      signals: [],
      avoidClarification: false,
    },
    messages,
  })
  assertEqual(usage.used, true, 'eligible despite focus.changed')
  assertEqual(usage.reason, 'eligible', 'reason')
})

test('55. conversationResume ignored after early turns', () => {
  const messages = [
    ...LAIFE_RESUME_HISTORY,
    { role: 'user', content: 'Ok.' },
    { role: 'assistant', content: 'Continuiamo.' },
    { role: 'user', content: 'Ancora un passo.' },
    { role: 'assistant', content: 'Fatto.' },
    { role: 'user', content: 'E adesso?' },
  ]
  const conversationResume = {
    suggestedResumeSentence: 'L\'ultima volta stavamo lavorando su LAIfe.',
    confidence: 0.9,
  }
  const usage = decideConversationResumeUsage({
    conversationResume,
    conversationFocus: { status: 'active', topic: 'LAIfe', confidence: 0.7, signals: [], avoidClarification: true },
    messages,
  })
  assertEqual(usage.used, false, 'not early')
  assertEqual(usage.reason, 'not_early_turn', 'reason')
})

test('56. formatWriterBrief includes resumeSentence when used', () => {
  const messages = [
    ...LAIFE_RESUME_HISTORY,
    { role: 'user', content: 'Riprendiamo.' },
  ]
  const p = plan({
    perception: { language: 'it', confidence: 0.7 },
    decision: {
      strategy: 'continue',
      initiative: 'none',
      responseDepth: 'light',
      emotionalTone: 'calm',
      need: 'continuity',
      goal: 'continue__need_continuity',
      shouldContinueTopic: true,
      confidence: 0.8,
    },
    messages,
    conversationResume: resumeConversation({ messages }),
  })
  const text = formatWriterBrief(p)
  if (p.conversationResume.used) {
    assert(/resumeSentence:/.test(text), 'resume line')
  } else {
    assert(/conversationResume: used=false/.test(text), 'unused line')
  }
})

test('70. conversationExperience maps Ciao → conversation', () => {
  const exp = evaluateConversationExperience([{ role: 'user', content: 'Ciao' }])
  assertEqual(exp.experience, 'conversation', 'conversation')
  assert(exp.confidence >= 0.5, 'confident')
})

test('71. conversationExperience maps exploration / debugging / brainstorming / decision / learning', () => {
  /** @type {[string, string][]} */
  const cases = [
    ['Di cosa possiamo parlare?', 'exploration'],
    ['Parliamo', 'exploration'],
    ['Ho un bug', 'debugging'],
    ['Vorrei migliorare LAIfe', 'brainstorming'],
    ["Vorrei un'idea", 'brainstorming'],
    ['Non so quale scegliere', 'decision'],
    ['Non so decidere', 'decision'],
    ['Spiegami', 'learning'],
  ]
  for (const [text, expected] of cases) {
    const exp = evaluateConversationExperience([{ role: 'user', content: text }])
    assertEqual(exp.experience, expected, text)
  }
})

test('72. experienceGuidance for exploration includes unexpected proposal', () => {
  const g = buildExperienceGuidance('exploration')
  assertEqual(g.experience, 'exploration', 'kind')
  assert(g.directives.some((d) => /proposta inattesa/i.test(d)), 'unexpected')
  assert(g.directives.some((d) => /varie direzioni/i.test(d)), 'directions')
})

test('72b. useExplorationPrinciples replaces exploration guidance only', () => {
  const baseline = buildExperienceGuidance('exploration')
  const withPrinciples = buildExperienceGuidance('exploration', {
    useExplorationPrinciples: true,
  })
  assert(
    withPrinciples.directives.some((d) => /fatto sorprendente/i.test(d)),
    'surprise opening',
  )
  assert(
    withPrinciples.directives.some((d) => /Possiamo parlare di/i.test(d)),
    'avoid possiamo',
  )
  assert(
    withPrinciples.directives.some((d) => /elenchi generici/i.test(d)),
    'avoid topic lists',
  )
  assertEqual(
    withPrinciples.directives.length,
    EXPLORATION_PRINCIPLES_DIRECTIVES.length,
    'principle count',
  )
  assert(
    !withPrinciples.directives.some((d) => /varie direzioni/i.test(d)),
    'baseline directions replaced',
  )
  assert(
    baseline.directives.some((d) => /varie direzioni/i.test(d)),
    'baseline unchanged',
  )

  const learning = buildExperienceGuidance('learning', {
    useExplorationPrinciples: true,
  })
  assert(
    learning.directives.some((d) => /parti dal concetto/i.test(d)),
    'other experiences untouched',
  )
})

test('72c. plan useExplorationPrinciples injects principle musts for exploration', () => {
  const off = plan({
    perception: { language: 'it', intent: 'question', confidence: 0.7 },
    decision: {
      strategy: 'explore',
      initiative: 'one_spark',
      responseDepth: 'balanced',
      emotionalTone: 'curious',
      need: 'exploration',
      goal: 'explore__need_exploration',
      confidence: 0.8,
    },
    messages: [{ role: 'user', content: 'Di cosa possiamo parlare?' }],
    useExplorationPrinciples: false,
  })
  const on = plan({
    perception: { language: 'it', intent: 'question', confidence: 0.7 },
    decision: {
      strategy: 'explore',
      initiative: 'one_spark',
      responseDepth: 'balanced',
      emotionalTone: 'curious',
      need: 'exploration',
      goal: 'explore__need_exploration',
      confidence: 0.8,
    },
    messages: [{ role: 'user', content: 'Di cosa possiamo parlare?' }],
    useExplorationPrinciples: true,
  })
  assertEqual(off.conversationExperience.experience, 'exploration', 'off exp')
  assertEqual(on.conversationExperience.experience, 'exploration', 'on exp')
  assert(
    on.experienceGuidance.directives.some((d) => /fatto sorprendente/i.test(d)),
    'on guidance',
  )
  assert(
    !off.experienceGuidance.directives.some((d) => /fatto sorprendente/i.test(d)),
    'off guidance',
  )
  assert(
    on.writerBrief.must.some((m) => /Possiamo parlare di/i.test(m)),
    'must includes avoid',
  )
})

test('72d. useLearningPrinciples replaces learning guidance only', () => {
  const baseline = buildExperienceGuidance('learning')
  const withPrinciples = buildExperienceGuidance('learning', {
    useLearningPrinciples: true,
  })
  assert(
    withPrinciples.directives.some((d) => /answering the user's question directly/i.test(d)),
    'direct answer',
  )
  assert(
    withPrinciples.directives.some((d) => /why it matters/i.test(d)),
    'why',
  )
  assert(
    withPrinciples.directives.some((d) => /one concrete real-world example/i.test(d)),
    'one example',
  )
  assert(
    withPrinciples.directives.some((d) => /asking questions before answering/i.test(d)),
    'avoid early questions',
  )
  assertEqual(
    withPrinciples.directives.length,
    LEARNING_PRINCIPLES_DIRECTIVES.length,
    'principle count',
  )
  assert(
    baseline.directives.some((d) => /parti dal concetto/i.test(d)),
    'baseline unchanged',
  )
  assert(
    !withPrinciples.directives.some((d) => /parti dal concetto/i.test(d)),
    'baseline learning replaced',
  )

  const exploration = buildExperienceGuidance('exploration', {
    useLearningPrinciples: true,
  })
  assert(
    exploration.directives.some((d) => /varie direzioni/i.test(d)),
    'other experiences untouched',
  )
})

test('72e. plan useLearningPrinciples injects Concept→Why→Example musts', () => {
  const off = plan({
    perception: { language: 'en', intent: 'question', confidence: 0.7 },
    decision: {
      strategy: 'explain',
      shouldTeach: true,
      initiative: 'none',
      responseDepth: 'balanced',
      emotionalTone: 'calm',
      need: 'learning',
      goal: 'explain__need_learning',
      confidence: 0.8,
    },
    messages: [{ role: 'user', content: 'What is entropy?' }],
    useLearningPrinciples: false,
  })
  const on = plan({
    perception: { language: 'en', intent: 'question', confidence: 0.7 },
    decision: {
      strategy: 'explain',
      shouldTeach: true,
      initiative: 'none',
      responseDepth: 'balanced',
      emotionalTone: 'calm',
      need: 'learning',
      goal: 'explain__need_learning',
      confidence: 0.8,
    },
    messages: [{ role: 'user', content: 'What is entropy?' }],
    useLearningPrinciples: true,
  })
  assertEqual(off.conversationExperience.experience, 'learning', 'off exp')
  assertEqual(on.conversationExperience.experience, 'learning', 'on exp')
  assert(
    on.experienceGuidance.directives.some((d) => /real-world example/i.test(d)),
    'on guidance',
  )
  assert(
    !off.experienceGuidance.directives.some((d) => /real-world example/i.test(d)),
    'off guidance',
  )
  assert(
    on.writerBrief.must.some((m) => /answering the user's question directly/i.test(m)),
    'must includes direct answer',
  )
})

test('72f. usePlanningPrinciples replaces planning guidance only', () => {
  const baseline = buildExperienceGuidance('planning')
  const withPrinciples = buildExperienceGuidance('planning', {
    usePlanningPrinciples: true,
  })
  assert(
    withPrinciples.directives.some((d) => /first concrete action/i.test(d)),
    'first action',
  )
  assert(
    withPrinciples.directives.some((d) => /immediately executable/i.test(d)),
    'executable',
  )
  assert(
    withPrinciples.directives.some((d) => /repeating the user's goal/i.test(d)),
    'avoid repeat goal',
  )
  assert(
    withPrinciples.directives.some((d) => /option lists without recommendation/i.test(d)),
    'avoid option lists',
  )
  assertEqual(
    withPrinciples.directives.length,
    PLANNING_PRINCIPLES_DIRECTIVES.length,
    'principle count',
  )
  assert(
    baseline.directives.some((d) => /chiarisci/i.test(d) || /obiettivo/i.test(d)),
    'baseline unchanged',
  )
  assert(
    !withPrinciples.directives.some((d) => /chiarisci l'obiettivo/i.test(d)),
    'baseline planning replaced',
  )

  const learning = buildExperienceGuidance('learning', {
    usePlanningPrinciples: true,
  })
  assert(
    learning.directives.some((d) => /parti dal concetto/i.test(d)),
    'other experiences untouched',
  )
})

test('72g. plan usePlanningPrinciples injects actionable-plan musts', () => {
  const off = plan({
    perception: { language: 'en', intent: 'question', confidence: 0.7 },
    decision: {
      strategy: 'guide',
      initiative: 'one_direction',
      responseDepth: 'balanced',
      emotionalTone: 'calm',
      need: 'planning',
      goal: 'guide__need_planning',
      confidence: 0.8,
    },
    messages: [{ role: 'user', content: 'Help me organize my day.' }],
    usePlanningPrinciples: false,
  })
  const on = plan({
    perception: { language: 'en', intent: 'question', confidence: 0.7 },
    decision: {
      strategy: 'guide',
      initiative: 'one_direction',
      responseDepth: 'balanced',
      emotionalTone: 'calm',
      need: 'planning',
      goal: 'guide__need_planning',
      confidence: 0.8,
    },
    messages: [{ role: 'user', content: 'Help me organize my day.' }],
    usePlanningPrinciples: true,
  })
  assertEqual(off.conversationExperience.experience, 'planning', 'off exp')
  assertEqual(on.conversationExperience.experience, 'planning', 'on exp')
  assert(
    on.experienceGuidance.directives.some((d) => /first concrete action/i.test(d)),
    'on guidance',
  )
  assert(
    !off.experienceGuidance.directives.some((d) => /first concrete action/i.test(d)),
    'off guidance',
  )
  assert(
    on.writerBrief.must.some((m) => /immediately executable/i.test(m)),
    'must includes executable',
  )
})

test('72h. runtimeProfile experimental enables validated principle flags', () => {
  assertEqual(RuntimeProfiles.experimental.useExplorationPrinciples, true, 'profile')
  const exploration = plan({
    perception: { language: 'it', confidence: 0.7 },
    decision: {
      strategy: 'explore',
      initiative: 'one_spark',
      responseDepth: 'balanced',
      emotionalTone: 'curious',
      need: 'exploration',
      confidence: 0.8,
    },
    messages: [{ role: 'user', content: 'Di cosa possiamo parlare?' }],
    runtimeProfile: 'experimental',
  })
  assert(
    exploration.experienceGuidance.directives.some((d) => /fatto sorprendente/i.test(d)),
    'exploration principles via profile',
  )

  const learning = plan({
    perception: { language: 'en', confidence: 0.7 },
    decision: {
      strategy: 'explain',
      shouldTeach: true,
      initiative: 'none',
      responseDepth: 'balanced',
      emotionalTone: 'calm',
      need: 'learning',
      confidence: 0.8,
    },
    messages: [{ role: 'user', content: 'What is entropy?' }],
    runtimeProfile: 'experimental',
  })
  assert(
    learning.experienceGuidance.directives.some((d) => /real-world example/i.test(d)),
    'learning principles via profile',
  )

  const planning = plan({
    perception: { language: 'en', confidence: 0.7 },
    decision: {
      strategy: 'guide',
      initiative: 'one_direction',
      responseDepth: 'balanced',
      emotionalTone: 'calm',
      need: 'planning',
      confidence: 0.8,
    },
    messages: [{ role: 'user', content: 'Help me organize my day.' }],
    runtimeProfile: 'experimental',
  })
  assert(
    planning.experienceGuidance.directives.some((d) => /first concrete action/i.test(d)),
    'planning principles via profile',
  )

  const production = plan({
    perception: { language: 'it', confidence: 0.7 },
    decision: {
      strategy: 'explore',
      initiative: 'one_spark',
      responseDepth: 'balanced',
      emotionalTone: 'curious',
      need: 'exploration',
      confidence: 0.8,
    },
    messages: [{ role: 'user', content: 'Di cosa possiamo parlare?' }],
    runtimeProfile: 'production',
  })
  assert(
    !production.experienceGuidance.directives.some((d) => /fatto sorprendente/i.test(d)),
    'production keeps baseline exploration',
  )
})

test('72i. explicit principle flag overrides runtimeProfile', () => {
  const forcedOff = plan({
    perception: { language: 'it', confidence: 0.7 },
    decision: {
      strategy: 'explore',
      initiative: 'one_spark',
      responseDepth: 'balanced',
      emotionalTone: 'curious',
      need: 'exploration',
      confidence: 0.8,
    },
    messages: [{ role: 'user', content: 'Di cosa possiamo parlare?' }],
    runtimeProfile: 'experimental',
    useExplorationPrinciples: false,
  })
  assert(
    !forcedOff.experienceGuidance.directives.some((d) => /fatto sorprendente/i.test(d)),
    'explicit false wins',
  )
})

test('73. plan emits conversationExperience + experienceGuidance and shapes development', () => {
  const p = plan({
    perception: { language: 'it', intent: 'question', confidence: 0.7 },
    decision: {
      strategy: 'explore',
      initiative: 'one_spark',
      responseDepth: 'balanced',
      emotionalTone: 'curious',
      need: 'exploration',
      goal: 'explore__need_exploration',
      confidence: 0.8,
    },
    messages: [{ role: 'user', content: 'Di cosa possiamo parlare?' }],
  })
  assertShape(p)
  assertEqual(p.conversationExperience.experience, 'exploration', 'experience')
  assert(p.experienceGuidance.directives.length >= 3, 'directives')
  assert(
    p.conversationPlan.development.some(
      (b) => b.kind === 'propose_directions' || b.kind === 'unexpected_proposal',
    ),
    'exploration development',
  )
  assert(p.constraints.includes('conversation_experience:exploration'), 'constraint')
  assert(
    p.writerBrief.must.some((m) => /conversationExperience="exploration"/i.test(m)),
    'must experience',
  )
  const brief = formatWriterBrief(p)
  assert(/conversationExperience:/.test(brief), 'brief experience')
  assert(/experienceGuidance:/.test(brief), 'brief guidance')
})

test('74. learning experience shapes concept → explain → example development', () => {
  const p = plan({
    perception: { language: 'it', confidence: 0.7 },
    decision: {
      strategy: 'explain',
      shouldTeach: true,
      initiative: 'none',
      responseDepth: 'balanced',
      emotionalTone: 'calm',
      need: 'learning',
      goal: 'explain__need_learning',
      confidence: 0.8,
    },
    messages: [{ role: 'user', content: 'Spiegami la fotosintesi.' }],
  })
  assertEqual(p.conversationExperience.experience, 'learning', 'learning')
  assert(
    p.conversationPlan.development.some((b) => b.kind === 'concept_first'),
    'concept first',
  )
  assert(
    p.experienceGuidance.directives.some((d) => /parti dal concetto/i.test(d)),
    'guidance',
  )
})

test('75. debugging experience shapes identify → hypothesis → next test', () => {
  const p = plan({
    perception: { language: 'it', confidence: 0.7 },
    decision: {
      strategy: 'guide',
      initiative: 'none',
      responseDepth: 'balanced',
      emotionalTone: 'calm',
      need: 'problem_solving',
      goal: 'guide__need_problem_solving',
      confidence: 0.8,
    },
    messages: [{ role: 'user', content: 'Ho un bug' }],
  })
  assertEqual(p.conversationExperience.experience, 'debugging', 'debugging')
  assert(
    p.conversationPlan.development.some((b) =>
      ['identify_problem', 'hypothesis', 'next_test'].includes(b.kind),
    ),
    'debug beats',
  )
})

test('76. useConversationExperience false keeps prior development path', () => {
  const withExp = plan({
    perception: { language: 'it', confidence: 0.7 },
    decision: {
      strategy: 'continue',
      shouldContinueTopic: true,
      initiative: 'none',
      responseDepth: 'balanced',
      emotionalTone: 'calm',
      need: 'learning',
      goal: 'continue__need_learning',
      confidence: 0.7,
    },
    messages: [{ role: 'user', content: 'Spiegami come funziona.' }],
    useConversationExperience: true,
  })
  const without = plan({
    perception: { language: 'it', confidence: 0.7 },
    decision: {
      strategy: 'continue',
      shouldContinueTopic: true,
      initiative: 'none',
      responseDepth: 'balanced',
      emotionalTone: 'calm',
      need: 'learning',
      goal: 'continue__need_learning',
      confidence: 0.7,
    },
    messages: [{ role: 'user', content: 'Spiegami come funziona.' }],
    useConversationExperience: false,
  })
  assertEqual(without.conversationExperience.reason, 'experience_disabled', 'disabled')
  assertEqual(without.experienceGuidance.directives.length, 0, 'no directives')
  assert(withExp.conversationExperience.experience === 'learning', 'exp on')
  assert(
    JSON.stringify(withExp.conversationPlan.development) !==
      JSON.stringify(without.conversationPlan.development),
    'development differs',
  )
})

test('77. CONVERSATION_EXPERIENCES covers the supported set', () => {
  for (const kind of [
    'conversation',
    'learning',
    'brainstorming',
    'debugging',
    'planning',
    'decision',
    'exploration',
    'creative',
    'support',
    'celebration',
    'resume',
  ]) {
    assert(CONVERSATION_EXPERIENCES.includes(/** @type {any} */ (kind)), kind)
    assert(buildExperienceGuidance(/** @type {any} */ (kind)).directives.length >= 3, `guidance ${kind}`)
  }
})

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
