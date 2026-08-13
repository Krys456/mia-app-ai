#!/usr/bin/env node
/**
 * Bug fix — Phantom topic contamination + small-talk state corruption.
 * Cases A–J from the production reproduction.
 *
 * Run: node lib/server/v2/brain/phantom-topic-contamination.test.mjs
 */

import {
  isValidActiveTopic,
  isValidPendingProposal,
  sanitizeEchoedConversationState,
  hasUnresolvedCentralReferent,
  stripUnsupportedReferentialContinuation,
  isSocialSmallTalkTurn,
} from './topic-validation.js'
import {
  hasUnresolvedConversationalProposal,
  inferPendingProposalType,
} from './short-reply.js'
import { buildConversationState, freezeConversationState } from './conversation-state.js'
import { deriveConversationSignals } from './conversation-signals.js'
import { perceive } from './perception.js'
import { think } from './mind.js'
import { plan, directConversation, chooseDirectorObjective } from './planner.js'
import { evaluateContractFidelity } from './contract-evaluator.js'
import { enforceReplyGroundingDetailed } from './writer.js'

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

function signalsFor(userMessage, messages) {
  return deriveConversationSignals({
    userMessage,
    messages: messages || [{ role: 'user', content: userMessage }],
    freeze: true,
  })
}

console.log('Phantom topic contamination regression tests\n')

test('validator rejects phantom bag-of-words topic', () => {
  assertEqual(
    isValidActiveTopic('ottima occasione pensare insieme possiamo proteggerla', {
      source: 'assistant',
    }),
    false,
    'phantom invalid',
  )
  assertEqual(isValidActiveTopic('black holes', { source: 'user' }), true, 'black holes')
  assertEqual(isValidActiveTopic('inverter trifase', { source: 'user' }), true, 'inverter')
  assertEqual(isValidActiveTopic('quello', {}), false, 'quello')
  assertEqual(isValidActiveTopic('vediamo insieme', {}), false, 'vediamo')
})

test('A. Greeting with no topic', () => {
  const msgs = [{ role: 'user', content: 'Ciao' }]
  const perception = perceive({ userMessage: 'Ciao' })
  const signals = signalsFor('Ciao', msgs)
  const state = buildConversationState({
    messages: msgs,
    perception,
    conversationSignals: signals,
  })
  assertEqual(state.activeTopic, null, 'topic null')
  assertEqual(state.pendingProposal, null, 'proposal null')
  assert(state.activeGoal === 'social_connection' || state.conversationMode === 'social', 'social')

  const grounded = enforceReplyGroundingDetailed(
    "Ciao! È un'ottima occasione per pensare insieme a come possiamo proteggerla.",
    {
      messages: msgs,
      conversationState: state,
      plan: { writerBrief: { strategy: 'connect', activeTopic: null } },
    },
  )
  assert(
    !/proteggerla/i.test(grounded.text),
    `writer stripped proteggerla → ${grounded.text}`,
  )
})

test('B. How are you after greeting — no teach / no phantom lock', () => {
  const asst =
    "Ciao! È un'ottima occasione per pensare insieme a come possiamo proteggerla."
  const msgs = [
    { role: 'user', content: 'Ciao' },
    { role: 'assistant', content: asst },
    { role: 'user', content: 'Come stai?' },
  ]
  const perception = perceive({ userMessage: 'Come stai?' })
  const signals = signalsFor('Come stai?', msgs)
  const previous = {
    activeTopic: 'ottima occasione pensare insieme possiamo proteggerla',
    pendingProposal: {
      type: 'explore_topic',
      topic: 'ottima occasione pensare insieme possiamo proteggerla',
      status: 'open',
      source: 'assistant_offer',
      idleTurns: 0,
      openedTurn: 1,
    },
    conversationPhase: 'opening',
    conversationMode: 'social',
    shortReply: { intent: null, confidence: null },
    continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
    references: { unresolved: [] },
  }
  const state = buildConversationState({
    messages: msgs,
    previousState: previous,
    perception,
    conversationSignals: signals,
  })
  assertEqual(state.activeTopic, null, 'topic cleared')
  assertEqual(state.pendingProposal, null, 'proposal cleared')
  assert(
    perception.intent === 'small_talk' ||
      perception.socialIntent === 'how_are_you' ||
      perception.userNeed === 'connection' ||
      isSocialSmallTalkTurn({ userMessage: 'Come stai?', perception }),
    `intent social-ish intent=${perception.intent} social=${perception.socialIntent}`,
  )

  const decision = think({
    perception,
    conversationState: state,
    conversationSignals: signals,
    userMessage: 'Come stai?',
  })
  assertEqual(decision.shouldTeach, false, 'shouldTeach')
  assertEqual(decision.shouldContinueTopic, false, 'shouldContinueTopic')

  const dir = directConversation({
    messages: msgs,
    decision,
    perception,
    conversationState: state,
  })
  assert(dir.objective !== 'teach', `director objective=${dir.objective}`)
  assertEqual(dir.activeTopic, null, 'director topic')
  assertEqual(dir.shouldExplain, false, 'shouldExplain')

  const p = plan({
    perception,
    decision,
    messages: msgs,
    conversationState: state,
  })
  assertEqual(p.writerBrief.teaching, false, 'teaching')
  assertEqual(p.writerBrief.continueTopic, false, 'continueTopic')
  assertEqual(p.writerBrief.activeTopic, null, 'brief topic')
  assert(
    !/Create curiosity before explaining/i.test(String(p.objective)),
    `objective=${p.objective}`,
  )
  assert(
    !p.writerBrief.must.some((m) => /ottima occasione|proteggerla/i.test(m)),
    'must must not lock phantom',
  )
})

test('C. No phantom proposal from vague social sentence', () => {
  const asst =
    "Ciao! È un'ottima occasione per pensare insieme a come possiamo proteggerla."
  assertEqual(hasUnresolvedConversationalProposal(asst), false, 'not a proposal')
  assertEqual(inferPendingProposalType(asst), null, 'no type')
  assertEqual(
    isValidPendingProposal(
      { type: 'explore_topic', topic: 'ottima occasione pensare insieme possiamo proteggerla', assistantText: asst },
      {},
    ),
    false,
    'invalid proposal',
  )
})

test('D. Valid proposal still works', () => {
  const asst = 'Posso raccontarti una curiosità sui buchi neri.'
  assert(hasUnresolvedConversationalProposal(asst), 'is proposal')
  assertEqual(inferPendingProposalType(asst), 'tell_curiosity', 'type')

  const msgs = [
    { role: 'assistant', content: asst },
    { role: 'user', content: 'ok' },
  ]
  const perception = perceive({ userMessage: 'ok' })
  const signals = signalsFor('ok', msgs)
  const state = buildConversationState({
    messages: msgs,
    previousState: {
      activeTopic: 'buchi neri',
      conversationPhase: 'exploring',
      pendingProposal: {
        type: 'tell_curiosity',
        topic: 'buchi neri',
        status: 'open',
        source: 'assistant_offer',
        idleTurns: 0,
        openedTurn: 1,
      },
      shortReply: { intent: null, confidence: null },
      continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
      references: { unresolved: [] },
    },
    perception,
    conversationSignals: signals,
  })
  assert(state.pendingProposal, 'proposal present')
  assert(/buchi|black|neri/i.test(String(state.pendingProposal.topic)), `topic=${state.pendingProposal.topic}`)
  assert(
    state.shortReply?.intent === 'accept_proposal' ||
      state.pendingProposal.status === 'accepted' ||
      state.pendingProposal.status === 'open',
    `status=${state.pendingProposal.status} intent=${state.shortReply?.intent}`,
  )
})

test('E. Invalid prior echoed State sanitation', () => {
  const cleaned = sanitizeEchoedConversationState(
    {
      activeTopic: 'ottima occasione pensare insieme possiamo proteggerla',
      pendingProposal: {
        type: 'explore_topic',
        topic: 'ottima occasione pensare insieme possiamo proteggerla',
        status: 'open',
      },
    },
    {
      userMessage: 'Come stai?',
      perception: { intent: 'small_talk', socialIntent: 'how_are_you', userNeed: 'connection' },
    },
  )
  assertEqual(cleaned.activeTopic, null, 'topic cleared')
  assertEqual(cleaned.pendingProposal, null, 'proposal cleared')
  assertEqual(cleaned.conversationMode, 'social', 'mode social')
})

test('F. Director precedence — small talk must not choose teach', () => {
  const objective = chooseDirectorObjective(
    {
      shouldComfort: false,
      shouldChallenge: false,
      shouldTeach: false,
      shouldContinueTopic: false,
      strategy: 'connect',
      initiative: 'none',
    },
    { status: 'none', topic: null },
    { kind: 'social' },
    'opening',
    'engaged',
  )
  assert(objective !== 'teach', `objective=${objective}`)
})

test('G. Boredom initiative — Capisco. fails delivery QA', () => {
  const userMessage = 'Mi annoio, non so di cosa parlare'
  const msgs = [{ role: 'user', content: userMessage }]
  const perception = perceive({ userMessage })
  const signals = signalsFor(userMessage, msgs)
  assert(signals.affect.boredom >= 0.55, `boredom=${signals.affect.boredom}`)

  const state = buildConversationState({
    messages: msgs,
    perception,
    conversationSignals: signals,
  })
  assertEqual(state.activeGoal, 'casual_exploration', 'goal')
  assert(
    state.conversationMode === 'exploration' || state.conversationMode === 'social',
    `mode=${state.conversationMode}`,
  )

  const decision = think({
    perception,
    conversationState: state,
    conversationSignals: signals,
    userMessage,
  })
  assert(decision.initiative !== 'none' || decision.strategy === 'explore', 'initiative/explore')
  assertEqual(decision.strategy, 'explore', 'explore')

  const p = plan({
    perception,
    decision,
    messages: msgs,
    conversationState: state,
  })
  assert(
    p.writerBrief.must.some((m) => /initiative|concrete/i.test(m)) ||
      p.writerBrief.mustNot.some((m) => /Capisco/i.test(m)),
    'initiative directives',
  )

  const ev = evaluateContractFidelity({
    responseText: 'Capisco.',
    plan: p,
    conversationState: state,
    conversationSignals: signals,
    userMessage,
  })
  assert(!ev.ok, 'Capisco must fail')
  assert(
    ev.violations.some((v) => v.code === 'collapsed_initiative'),
    `codes=${ev.violations.map((v) => v.code).join(',')}`,
  )
})

test('H. Boredom + OK executes concrete proposal', () => {
  const asst = 'Posso raccontarti una curiosità sui buchi neri.'
  const msgs = [
    { role: 'user', content: 'Mi annoio, non so di cosa parlare' },
    { role: 'assistant', content: asst },
    { role: 'user', content: 'ok' },
  ]
  const perception = perceive({ userMessage: 'ok' })
  const signals = signalsFor('ok', msgs)
  const state = buildConversationState({
    messages: msgs,
    previousState: {
      activeTopic: 'buchi neri',
      activeGoal: 'casual_exploration',
      conversationMode: 'exploration',
      conversationPhase: 'exploring',
      pendingProposal: {
        type: 'tell_curiosity',
        topic: 'buchi neri',
        status: 'open',
        source: 'assistant_offer',
        idleTurns: 0,
        openedTurn: 1,
      },
      shortReply: { intent: null, confidence: null },
      continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
      references: { unresolved: [] },
    },
    perception,
    conversationSignals: signals,
  })
  assert(
    state.shortReply?.intent === 'accept_proposal' ||
      state.shortReply?.conversationalMove === 'execute_pending_proposal' ||
      state.pendingProposal?.status === 'accepted',
    `short-reply path intent=${state.shortReply?.intent} move=${state.shortReply?.conversationalMove}`,
  )
  assert(/buchi|neri/i.test(String(state.activeTopic || state.pendingProposal?.topic)), 'keeps topic')
})

test('I. No unsupported pronoun without antecedent', () => {
  assert(hasUnresolvedCentralReferent('Possiamo proteggerla.', {}), 'unresolved')
  const ev = evaluateContractFidelity({
    responseText: 'Possiamo proteggerla.',
    plan: {
      objective: 'Respond naturally to the social check-in.',
      writerBrief: {
        conversationalMove: 'default',
        shouldAskQuestion: false,
        activeTopic: null,
        strategy: 'connect',
        responseProfile: {
          tone: { warmth: 0.6, formality: 0.3, humor: 0.2, directness: 0.5, technicality: 0.2 },
          depth: 'light',
          verbosity: 'short',
          energy: 'medium',
          emojiPolicy: 'occasional',
        },
      },
    },
    conversationState: {
      activeTopic: null,
      conversationPhase: 'opening',
      activeGoal: 'social_connection',
    },
    userMessage: 'Ciao',
    messages: [{ role: 'user', content: 'Ciao' }],
  })
  assert(!ev.ok, 'must fail')
  assert(
    ev.violations.some((v) => v.code === 'unsupported_referential_continuation'),
    `codes=${ev.violations.map((v) => v.code).join(',')}`,
  )
})

test('J. Valid pronoun remains valid with antecedent', () => {
  const msgs = [
    { role: 'user', content: 'Parliamo della barriera corallina.' },
    { role: 'assistant', content: 'La barriera corallina è un ecosistema fragile.' },
    { role: 'user', content: 'Come possiamo proteggerla?' },
  ]
  assertEqual(
    hasUnresolvedCentralReferent('Come possiamo proteggerla?', {
      activeTopic: 'barriera corallina',
      messages: msgs,
    }),
    false,
    'grounded clitic ok',
  )
  const strip = stripUnsupportedReferentialContinuation('Come possiamo proteggerla?', {
    activeTopic: 'barriera corallina',
    messages: msgs,
    isOpeningSocial: false,
  })
  assert(/proteggerla/i.test(strip.text), 'kept')
  assertEqual(strip.flagged, false, 'not flagged')
})

test('immutability — sanitize does not mutate input', () => {
  const prev = {
    activeTopic: 'ottima occasione pensare insieme possiamo proteggerla',
    pendingProposal: { type: 'explore_topic', topic: 'x', status: 'open' },
  }
  const before = JSON.stringify(prev)
  sanitizeEchoedConversationState(prev, {
    userMessage: 'Come stai?',
    perception: { intent: 'small_talk' },
  })
  assertEqual(JSON.stringify(prev), before, 'unchanged')
  const state = buildConversationState({
    messages: [{ role: 'user', content: 'Ciao' }],
    perception: perceive({ userMessage: 'Ciao' }),
  })
  assert(Object.isFrozen(freezeConversationState(state)) || Object.isFrozen(state), 'frozen-ish')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
