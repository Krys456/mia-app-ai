#!/usr/bin/env node
/**
 * Phase 4 — Adaptive Response Profile tests (A–J).
 * Run: node lib/server/v2/brain/adaptive-response-profile.test.mjs
 */

import {
  buildAdaptiveResponseProfile,
  constrainAdaptiveResponseProfile,
  serializeAdaptiveResponseProfile,
  isAdaptiveResponseProfile,
  ADAPTIVE_RESPONSE_PROFILE_VERSION,
} from './adaptive-response-profile.js'
import { think } from './mind.js'
import { plan } from './planner.js'
import { perceive } from './perception.js'
import { buildConversationState } from './conversation-state.js'
import { formatPlanForWriter } from './writer.js'

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
    throw new Error(
      `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    )
  }
}

/**
 * @param {string} userMessage
 * @param {object} [opts]
 */
function profileFor(userMessage, opts = {}) {
  const messages = opts.messages || [{ role: 'user', content: userMessage }]
  const perception = perceive({ userMessage, messages })
  const conversationState =
    opts.conversationState ||
    buildConversationState({
      messages,
      perception,
      previousState: opts.previousState || null,
    })
  return buildAdaptiveResponseProfile({
    perception,
    conversationState,
    userMessage,
    preferences: opts.preferences || {},
    previousProfile: opts.previousProfile || null,
    strategy: opts.strategy || '',
  })
}

console.log(`Adaptive Response Profile tests (${ADAPTIVE_RESPONSE_PROFILE_VERSION})\n`)

test('schema: isAdaptiveResponseProfile', () => {
  const p = profileFor('Ciao')
  assert(isAdaptiveResponseProfile(p), 'valid')
  assert(p.tone.warmth >= 0 && p.tone.warmth <= 1, 'warmth bound')
  const s = serializeAdaptiveResponseProfile(p)
  assert(s && !('signals' in s), 'serialize drops signals optional ok')
})

// A
test('A. bored casual user → warmth/energy up, formality low', () => {
  const p = profileFor('Mi annoio, dimmi qualcosa.')
  assert(p.tone.warmth >= 0.55, `warmth=${p.tone.warmth}`)
  assert(p.tone.formality <= 0.35, `formality=${p.tone.formality}`)
  assert(p.energy === 'medium' || p.energy === 'high', `energy=${p.energy}`)
  assert(p.depth === 'short' || p.depth === 'normal', `depth=${p.depth}`)
})

// B
test('B. beginner explanation: Cos\'è un inverter?', () => {
  const p = profileFor("Cos'è un inverter?")
  assertEqual(p.depth, 'normal', 'depth normal')
  assert(p.tone.technicality >= 0.3 && p.tone.technicality <= 0.6, `tech=${p.tone.technicality}`)
  assert(p.verbosity === 'short' || p.verbosity === 'medium', `verbosity=${p.verbosity}`)
})

// C
test('C. expert technical request', () => {
  const p = profileFor(
    'Descrivi SPWM, dead-time e switching losses in un inverter trifase.',
  )
  assert(p.tone.technicality >= 0.75, `tech=${p.tone.technicality}`)
  assert(p.depth === 'expert' || p.depth === 'detailed', `depth=${p.depth}`)
  assert(p.tone.humor <= 0.2, `humor=${p.tone.humor}`)
})

// D
test('D. explicit short answer', () => {
  const p = profileFor('Risposta breve: cos\'è un inverter?')
  assert(p.verbosity === 'minimal' || p.verbosity === 'short', `verbosity=${p.verbosity}`)
  assertEqual(p.depth, 'normal', 'depth can stay normal')
})

// E
test('E. explicit detailed answer', () => {
  const p = profileFor('Approfondisci molto.')
  assert(p.depth === 'detailed' || p.depth === 'expert', `depth=${p.depth}`)
  assert(p.verbosity === 'medium' || p.verbosity === 'long', `verbosity=${p.verbosity}`)
})

// F
test('F. casual excitement', () => {
  const p = profileFor('Ahahah è assurdo 😂')
  assert(p.tone.formality <= 0.3, `formality=${p.tone.formality}`)
  assertEqual(p.energy, 'high', 'energy high')
  assert(p.tone.humor >= 0.35, `humor=${p.tone.humor}`)
  assert(p.emojiPolicy === 'occasional' || p.emojiPolicy === 'rare', `emoji=${p.emojiPolicy}`)
})

// G
test('G. professional context', () => {
  const p = profileFor('Scrivimi una spiegazione professionale sul piano di progetto.')
  assert(p.tone.formality >= 0.55, `formality=${p.tone.formality}`)
  assert(p.tone.humor <= 0.15, `humor=${p.tone.humor}`)
})

// H
test('H. tone transition: playful → technical', () => {
  const playful = profileFor('Ahahah assurdo 😂')
  assertEqual(playful.energy, 'high', 't1 high')
  const tech = profileFor('Ok, spiegami tecnicamente perché succede il dead-time nel ponte H.', {
    previousProfile: playful,
  })
  assert(tech.tone.technicality >= 0.7, `tech=${tech.tone.technicality}`)
  assert(tech.tone.humor < playful.tone.humor, 'humor drops')
  assert(tech.signals?.includes('override:hard_cue_no_stabilize') || tech.tone.humor <= 0.2, 'no drag')
})

// I
test('I. static mode influence without overriding explicit short', () => {
  const friendly = profileFor('Parliamo un po\'.', {
    preferences: { personalityBias: 'friendly' },
  })
  assert(friendly.tone.warmth >= 0.5, `friendly warmth=${friendly.tone.warmth}`)

  const professional = profileFor('Spiega il piano.', {
    preferences: { personalityBias: 'professional' },
  })
  assert(professional.tone.formality >= 0.4, `pro formality=${professional.tone.formality}`)

  const shortMode = profileFor('Dimmi qualcosa sullo spazio.', {
    preferences: { replyLength: 'concise' },
  })
  assert(
    shortMode.verbosity === 'minimal' || shortMode.verbosity === 'short' || shortMode.verbosity === 'medium',
    `short mode verbosity=${shortMode.verbosity}`,
  )

  const detailedMode = profileFor('Dimmi qualcosa sullo spazio.', {
    preferences: { replyLength: 'detailed' },
  })
  assert(
    detailedMode.verbosity === 'medium' || detailedMode.verbosity === 'long',
    `detailed verbosity=${detailedMode.verbosity}`,
  )

  const explicitBeatsMode = profileFor('Risposta breve: cos\'è un inverter?', {
    preferences: { replyLength: 'detailed', personalityBias: 'teacher' },
  })
  assertEqual(explicitBeatsMode.verbosity, 'minimal', 'explicit short wins')
})

// J
test('J. Writer fidelity: high social energy does not override shouldAskQuestion=false', () => {
  const messages = [{ role: 'user', content: 'Mi annoio, dimmi qualcosa di assurdo.' }]
  const perception = perceive({ userMessage: messages[0].content, messages })
  const conversationState = buildConversationState({ messages, perception })
  const decision = think({
    perception,
    conversationState,
    userMessage: messages[0].content,
    preferences: { personalityBias: 'friendly' },
  })
  decision.shouldAskQuestion = false
  const p = plan({
    perception,
    decision,
    messages,
    conversationState,
  })
  assertEqual(p.writerBrief.shouldAskQuestion, false, 'ask false')
  assert(p.writerBrief.responseProfile, 'has profile')
  assert(
    p.writerBrief.mustNot.some((m) => /shouldAskQuestion=false|follow-up question/i.test(m)),
    'mustNot ask',
  )
  const formatted = formatPlanForWriter(p)
  assert(/responseProfile:/.test(formatted), 'profile in writer brief format')
  assert(/shouldAskQuestion=false/.test(formatted), 'ask flag in brief')
})

test('Planner constrain debugging raises directness / caps humor', () => {
  const base = profileFor('Il server crasha con TypeError.', { strategy: 'guide' })
  const constrained = constrainAdaptiveResponseProfile(base, {
    strategy: 'guide',
    conversationMode: 'debugging',
    activeGoal: 'debugging',
  })
  assert(constrained.tone.directness >= 0.65, 'directness')
  assert(constrained.tone.humor <= 0.15, 'humor cap')
})

test('Mind attaches responseProfile', () => {
  const messages = [{ role: 'user', content: "Cos'è un inverter?" }]
  const perception = perceive({ userMessage: messages[0].content, messages })
  const conversationState = buildConversationState({ messages, perception })
  const d = think({
    perception,
    conversationState,
    userMessage: messages[0].content,
  })
  assert(isAdaptiveResponseProfile(d.responseProfile), 'mind profile')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
