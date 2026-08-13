#!/usr/bin/env node
/**
 * Phase 7 — Reference Resolution + Conversation Repair tests (A–O).
 * Run: node lib/server/v2/brain/reference-resolution.test.mjs
 */

import {
  resolveReferences,
  extractOrderedOptions,
  extractRecentAlternatives,
  responseContradictsReferent,
  serializeReferenceResolutionDebug,
  REFERENCE_RESOLUTION_VERSION,
} from './reference-resolution.js'
import { deriveConversationSignals } from './conversation-signals.js'
import { buildConversationState, freezeConversationState } from './conversation-state.js'
import { plan } from './planner.js'
import { evaluateContractFidelity } from './contract-evaluator.js'
import { formatPlanForWriter } from './writer.js'
import { think } from './mind.js'
import { perceive } from './perception.js'

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

function signalsFor(userMessage) {
  return deriveConversationSignals({
    userMessage,
    messages: [{ role: 'user', content: userMessage }],
    freeze: true,
  })
}

function resolve(userMessage, previous = null, messages = null) {
  const msgs =
    messages ||
    (previous
      ? [
          { role: 'assistant', content: previous._assistant || '' },
          { role: 'user', content: userMessage },
        ]
      : [{ role: 'user', content: userMessage }])
  return resolveReferences({
    userMessage,
    messages: msgs,
    conversationSignals: signalsFor(userMessage),
    previousConversationState: previous,
    freeze: true,
  })
}

console.log(`Reference Resolution tests (${REFERENCE_RESOLUTION_VERSION})\n`)

test('A. Pronoun continuity keeps shark topic grounded', () => {
  const previous = {
    activeTopic: 'squali',
    conversationPhase: 'deepening',
    shortReply: { intent: null, confidence: null },
    continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
    references: { unresolved: [] },
    _assistant:
      'Lo squalo balena è il pesce più grande. Lo squalo bianco è invece più aggressivo.',
  }
  const r = resolve('E quello più grande?', previous)
  assertEqual(r.status, 'resolved', 'resolved')
  assert(/squal/i.test(String(r.referent)), `referent=${r.referent}`)

  const state = buildConversationState({
    messages: [
      { role: 'assistant', content: previous._assistant },
      { role: 'user', content: 'E quello più grande?' },
    ],
    previousState: previous,
    conversationSignals: signalsFor('E quello più grande?'),
  })
  assert(/squal/i.test(String(state.activeTopic)), `state topic=${state.activeTopic}`)
})

test('B. Ordered option — Il secondo → trifase', () => {
  const assistant =
    'Le opzioni sono:\n1. Monofase\n2. Trifase\nScegli pure.'
  assertEqual(extractOrderedOptions(assistant)[1].toLowerCase().includes('trifase'), true, 'opts')
  const r = resolve('Il secondo.', {
    activeTopic: 'inverter',
    recentAlternatives: ['Monofase', 'Trifase'],
    _assistant: assistant,
  })
  assertEqual(r.status, 'resolved', 'resolved')
  assert(/trifase/i.test(String(r.referent)), `referent=${r.referent}`)
  assertEqual(r.referentType, 'ordinal', 'ordinal')
})

test('C. Explicit correction updates activeTopic', () => {
  const previous = {
    activeTopic: 'pannello',
    conversationPhase: 'deepening',
    pendingProposal: {
      type: 'explain',
      topic: 'pannello',
      status: 'open',
      source: 'assistant_offer',
      idleTurns: 0,
      openedTurn: 1,
    },
    shortReply: { intent: null, confidence: null },
    continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
    references: { unresolved: [] },
    _assistant: 'Posso spiegarti meglio il pannello?',
  }
  const userMessage = "No, intendevo l'inverter."
  const state = buildConversationState({
    messages: [
      { role: 'assistant', content: previous._assistant },
      { role: 'user', content: userMessage },
    ],
    previousState: previous,
    conversationSignals: signalsFor(userMessage),
  })
  assert(/inverter/i.test(String(state.activeTopic)), `topic=${state.activeTopic}`)
  assert(state.repair?.active, 'repair active')
  assertEqual(state.repair?.type, 'explicit_correction', 'type')
  assert(/pannello/i.test(String(state.repair?.rejectedInterpretation)), 'rejected')
  assertEqual(state.conversationPhase, 'recovering', 'recovering')
})

test('D. Alternate referent with two options', () => {
  const r = resolve("No, l'altro.", {
    activeTopic: 'monofase',
    recentAlternatives: ['monofase', 'trifase'],
    _assistant: 'Puoi usare monofase oppure trifase.',
  })
  assertEqual(r.status, 'resolved', 'resolved')
  assert(/trifase/i.test(String(r.referent)), `referent=${r.referent}`)
  assertEqual(r.referentType, 'alternate', 'alternate')
})

test('E. Ambiguous alternate with three options — no silent guess', () => {
  const r = resolve("L'altro.", {
    activeTopic: 'alpha',
    recentAlternatives: ['alpha', 'beta', 'gamma'],
    _assistant: 'Le vie sono alpha, beta e gamma.',
  })
  assertEqual(r.status, 'ambiguous', 'ambiguous')
  assertEqual(r.referent, null, 'no guess')
  assert(r.repair.requiresClarification, 'needs clarify')
})

test('F. Quello di prima — one clear vs multiple', () => {
  const one = resolve('Riprendiamo quello di prima.', {
    activeTopic: 'PWM',
    previousAssistantMove: { type: 'answer', topic: 'PWM' },
    _assistant: 'Il PWM limita la corrente media.',
  })
  assertEqual(one.status, 'resolved', 'one resolved')
  assert(/pwm/i.test(String(one.referent)), 'pwm')

  const many = resolve('Quello di prima.', {
    activeTopic: null,
    previousAssistantMove: { type: 'answer', topic: 'batterie' },
    pendingProposal: { type: 'explain', topic: 'inverter', status: 'open' },
    recentAlternatives: ['pannello'],
    _assistant: 'Parlavamo di tante cose.',
  })
  assertEqual(many.status, 'ambiguous', 'many ambiguous')
})

test('G. Topic correction clears panel proposal', () => {
  const previous = {
    activeTopic: 'pannello',
    conversationPhase: 'exploring',
    pendingProposal: {
      type: 'explain',
      topic: 'pannello',
      status: 'open',
      source: 'assistant_offer',
      idleTurns: 0,
      openedTurn: 1,
    },
    shortReply: { intent: null, confidence: null },
    continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
    references: { unresolved: [] },
  }
  const state = buildConversationState({
    messages: [
      { role: 'assistant', content: 'Posso spiegarti meglio il pannello?' },
      { role: 'user', content: "No, parlavo dell'inverter." },
    ],
    previousState: previous,
    conversationSignals: signalsFor("No, parlavo dell'inverter."),
  })
  assertEqual(state.pendingProposal, null, 'proposal cleared')
  assert(/inverter/i.test(String(state.activeTopic)), 'topic inverter')
})

test('H. No clarification when resolved', () => {
  const situation = buildConversationState({
    messages: [
      {
        role: 'assistant',
        content: 'Le opzioni sono:\n1. Monofase\n2. Trifase',
      },
      { role: 'user', content: 'Il secondo.' },
    ],
    previousState: {
      activeTopic: 'inverter',
      conversationMode: 'learning',
      conversationPhase: 'deepening',
      recentAlternatives: ['Monofase', 'Trifase'],
      shortReply: { intent: null, confidence: null },
      continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
      references: { unresolved: [] },
    },
    conversationSignals: signalsFor('Il secondo.'),
  })
  assertEqual(situation.referenceResolution?.status, 'resolved', 'resolved')
  const decision = think({
    perception: perceive({ userMessage: 'Il secondo.' }),
    conversationState: situation,
    conversationSignals: signalsFor('Il secondo.'),
    userMessage: 'Il secondo.',
  })
  const p = plan({
    perception: perceive({ userMessage: 'Il secondo.' }),
    decision,
    messages: [
      {
        role: 'assistant',
        content: 'Le opzioni sono:\n1. Monofase\n2. Trifase',
      },
      { role: 'user', content: 'Il secondo.' },
    ],
    conversationState: situation,
  })
  assertEqual(p.writerBrief.shouldAskQuestion, false, 'no ask')
  assert(
    p.writerBrief.must.some((m) => /Resolved referent|trifase/i.test(m)),
    'must mentions referent',
  )
})

test('I. Clarification when materially ambiguous', () => {
  const situation = buildConversationState({
    messages: [
      { role: 'assistant', content: 'Tra inverter e pannello, dove parti?' },
      { role: 'user', content: "L'altro." },
    ],
    previousState: {
      activeTopic: 'inverter',
      conversationMode: 'learning',
      conversationPhase: 'deepening',
      recentAlternatives: ['inverter', 'pannello', 'batteria'],
      shortReply: { intent: null, confidence: null },
      continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
      references: { unresolved: [] },
    },
    conversationSignals: signalsFor("L'altro."),
  })
  assertEqual(situation.referenceResolution?.status, 'ambiguous', 'ambiguous')
  assert(situation.repair?.requiresClarification, 'needs clarify')
  const decision = {
    need: 'unclear',
    goal: 'answer__need_unclear',
    strategy: 'answer',
    initiative: 'none',
    emotionalTone: 'calm',
    responseDepth: 'balanced',
    shouldUseMemory: false,
    shouldContinueTopic: true,
    shouldAskQuestion: true,
    shouldTeach: false,
    shouldComfort: false,
    shouldChallenge: false,
    confidence: 0.4,
  }
  const p = plan({
    perception: { intent: 'unclear', confidence: 0.4, language: 'it' },
    decision,
    messages: [
      { role: 'assistant', content: 'Tra inverter e pannello, dove parti?' },
      { role: 'user', content: "L'altro." },
    ],
    conversationState: situation,
  })
  assertEqual(p.writerBrief.shouldAskQuestion, true, 'ask allowed')
  assert(
    p.writerBrief.must.some((m) => /ambiguous|chiariment/i.test(m)),
    'clarify must',
  )
})

test('J. Natural repair — Writer brief forbids internal terms', () => {
  const situation = buildConversationState({
    messages: [
      { role: 'assistant', content: 'Parliamo del pannello solare.' },
      { role: 'user', content: "No, intendevo l'inverter." },
    ],
    previousState: {
      activeTopic: 'pannello',
      conversationPhase: 'deepening',
      shortReply: { intent: null, confidence: null },
      continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
      references: { unresolved: [] },
    },
    conversationSignals: signalsFor("No, intendevo l'inverter."),
  })
  const decision = think({
    perception: perceive({ userMessage: "No, intendevo l'inverter." }),
    conversationState: situation,
    conversationSignals: signalsFor("No, intendevo l'inverter."),
    userMessage: "No, intendevo l'inverter.",
  })
  const p = plan({
    perception: perceive({ userMessage: "No, intendevo l'inverter." }),
    decision,
    messages: [
      { role: 'assistant', content: 'Parliamo del pannello solare.' },
      { role: 'user', content: "No, intendevo l'inverter." },
    ],
    conversationState: situation,
  })
  const formatted = formatPlanForWriter(p)
  assert(/Do not expose internal terms/i.test(formatted) || p.writerBrief.mustNot.some((m) => /reference resolved|correction detected/i.test(m)), 'no internal terms')
  assert(p.writerBrief.mustNot.some((m) => /over-apologize|Mi scuso/i.test(m)), 'no forced apology')
})

test('K. Rejected interpretation — do not snap back', () => {
  const previous = {
    activeTopic: 'inverter',
    conversationPhase: 'deepening',
    repair: {
      active: false,
      type: null,
      rejectedInterpretation: 'pannello',
      correctedReferent: null,
      confidence: null,
      requiresClarification: false,
    },
    shortReply: { intent: null, confidence: null },
    continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
    references: { unresolved: [] },
    recentAlternatives: ['pannello', 'inverter'],
  }
  const r = resolve('E quello?', previous, [
    { role: 'assistant', content: "Per l'inverter, la corrente media..." },
    { role: 'user', content: 'E quello?' },
  ])
  assertEqual(r.status, 'resolved', 'resolved')
  assert(!/pannello/i.test(String(r.referent)), 'not rejected')
  assert(/inverter/i.test(String(r.referent)), 'stays inverter')
})

test('L. Evaluator grounding — trifase vs monofase contradiction', () => {
  const bad = evaluateContractFidelity({
    responseText: 'Il monofase è più semplice da installare in casa.',
    plan: {
      writerBrief: {
        conversationalMove: 'answer',
        shouldAskQuestion: false,
        activeTopic: 'trifase',
        responseProfile: {
          tone: { warmth: 0.4, formality: 0.5, humor: 0.1, directness: 0.7, technicality: 0.7 },
          depth: 'normal',
          verbosity: 'medium',
          energy: 'medium',
          emojiPolicy: 'none',
        },
      },
    },
    conversationState: {
      activeTopic: 'trifase',
      conversationPhase: 'deepening',
      referenceResolution: {
        status: 'resolved',
        referentType: 'ordinal',
        referent: 'trifase',
        confidence: 0.9,
        confidenceBand: 'high',
      },
      repair: {
        active: false,
        type: null,
        rejectedInterpretation: 'monofase',
        correctedReferent: 'trifase',
        confidence: null,
        requiresClarification: false,
      },
    },
  })
  assert(
    bad.hardViolations.some((v) => v.code === 'referent_contradiction'),
    'hard contradiction',
  )
  assert(bad.needsRewrite, 'rewrite')

  assert(
    responseContradictsReferent('Il monofase è meglio.', {
      referent: 'trifase',
      rejectedInterpretation: 'monofase',
      status: 'resolved',
    }),
    'helper detects',
  )
})

test('M. Closing then new explicit topic — old refs do not leak', () => {
  const state = buildConversationState({
    messages: [
      { role: 'assistant', content: 'Ok, chiudiamo sui squali.' },
      { role: 'user', content: "Parliamo invece dell'antica Roma." },
    ],
    previousState: {
      activeTopic: 'squali',
      conversationPhase: 'closing',
      recentAlternatives: ['squalo bianco', 'squalo balena'],
      shortReply: { intent: null, confidence: null },
      continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
      references: { unresolved: [] },
    },
    conversationSignals: signalsFor("Parliamo invece dell'antica Roma."),
  })
  assert(/roma/i.test(String(state.activeTopic)), `topic=${state.activeTopic}`)
  assertEqual((state.recentAlternatives || []).length, 0, 'alts expired')
})

test('N. Expiry of alternatives after unrelated topic change', () => {
  const state = buildConversationState({
    messages: [
      { role: 'assistant', content: 'Monofase oppure trifase.' },
      { role: 'user', content: 'Cambiando argomento, parlami di Roma.' },
    ],
    previousState: {
      activeTopic: 'inverter',
      conversationPhase: 'deepening',
      recentAlternatives: ['monofase', 'trifase'],
      shortReply: { intent: null, confidence: null },
      continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
      references: { unresolved: [] },
    },
    conversationSignals: signalsFor('Cambiando argomento, parlami di Roma.'),
  })
  assertEqual((state.recentAlternatives || []).length, 0, 'cleared')
})

test('O. Immutability — Planner/Writer cannot mutate repair State', () => {
  const state = buildConversationState({
    messages: [
      { role: 'assistant', content: 'Parliamo del pannello.' },
      { role: 'user', content: "No, intendevo l'inverter." },
    ],
    previousState: {
      activeTopic: 'pannello',
      conversationPhase: 'deepening',
      shortReply: { intent: null, confidence: null },
      continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
      references: { unresolved: [] },
    },
    conversationSignals: signalsFor("No, intendevo l'inverter."),
  })
  assert(Object.isFrozen(state), 'frozen')
  assert(Object.isFrozen(state.repair), 'repair frozen')
  const before = state.repair.correctedReferent
  try {
    /** @type {any} */ (state).repair.correctedReferent = 'hacked'
  } catch {
    // expected in strict-ish environments
  }
  assertEqual(state.repair.correctedReferent, before, 'unchanged')
  const again = freezeConversationState(state)
  assert(Object.isFrozen(again), 'refreeze')
})

test('debug serialize is compact', () => {
  const r = resolve('Il secondo.', {
    recentAlternatives: ['Monofase', 'Trifase'],
    _assistant: '1. Monofase\n2. Trifase',
  })
  const d = serializeReferenceResolutionDebug(r)
  assertEqual(d.status, 'resolved', 'status')
  assertEqual(d.type, 'ordinal', 'type')
  assert(!('candidates' in d), 'no candidates')
})

test('extractRecentAlternatives finds pairs', () => {
  const alts = extractRecentAlternatives('Puoi usare monofase oppure trifase.')
  assert(alts.length >= 2, 'pair')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
