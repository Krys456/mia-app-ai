#!/usr/bin/env node
/**
 * Phase 6 — Conversation Signals tests (A–O).
 * Run: node lib/server/v2/brain/conversation-signals.test.mjs
 */

import {
  deriveConversationSignals,
  freezeConversationSignals,
  isConversationSignals,
  serializeConversationSignalsDebug,
  CONVERSATION_SIGNALS_VERSION,
} from './conversation-signals.js'
import { buildAdaptiveResponseProfile } from './adaptive-response-profile.js'
import { evaluateContractFidelity } from './contract-evaluator.js'
import { buildConversationState } from './conversation-state.js'
import { interpretShortReply } from './short-reply.js'
import { think } from './mind.js'

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

function sig(userMessage, extra = {}) {
  return deriveConversationSignals({
    userMessage,
    messages: [{ role: 'user', content: userMessage }],
    perception: extra.perception || {},
    previousConversationState: extra.previousConversationState || null,
    preferences: extra.preferences || null,
    freeze: true,
  })
}

console.log(`Conversation Signals tests (${CONVERSATION_SIGNALS_VERSION})\n`)

test('schema: isConversationSignals + no decision fields', () => {
  const s = sig('Ciao')
  assert(isConversationSignals(s), 'schema')
  assert(!('objective' in s), 'no objective')
  assert(!('strategy' in s), 'no strategy')
  assert(!('conversationalMove' in s), 'no move')
  assertEqual(s.version, CONVERSATION_SIGNALS_VERSION, 'version')
})

test('A. Boredom high — no objective in Signals', () => {
  const s = sig('Mi annoio e non so di cosa parlare.')
  assert(s.affect.boredom >= 0.55, `boredom=${s.affect.boredom}`)
  assert(!('objective' in s), 'no objective')
})

test('B. Playful casual elevates playfulness/excitement', () => {
  const s = sig('Bro ahahah dai')
  assert(s.affect.playfulness >= 0.45 || s.affect.excitement >= 0.45, 'playful/excited')
})

test('C. Explicit brevity → wantsBrief; profile short', () => {
  const s = sig("Risposta breve: cos'è l'entropia?")
  assertEqual(s.style.wantsBrief, true, 'wantsBrief')
  const profile = buildAdaptiveResponseProfile({
    userMessage: "Risposta breve: cos'è l'entropia?",
    conversationSignals: s,
  })
  assert(
    profile.verbosity === 'minimal' || profile.verbosity === 'short',
    `verbosity=${profile.verbosity}`,
  )
})

test('D. Explicit detail → wantsDetailed', () => {
  const s = sig('Approfondisci tantissimo.')
  assertEqual(s.style.wantsDetailed, true, 'wantsDetailed')
})

test('E. Simple explanation → wantsSimple', () => {
  const s = sig('Spiegamelo semplice.')
  assertEqual(s.style.wantsSimple, true, 'wantsSimple')
})

test('F. Technical → wantsTechnical', () => {
  const s = sig('Spiegamelo tecnicamente.')
  assertEqual(s.style.wantsTechnical, true, 'wantsTechnical')
})

test('G. No emoji → allowsEmojis false', () => {
  const s = sig('Niente emoji.')
  assertEqual(s.style.allowsEmojis, false, 'emoji off')
})

test('H. Topic change cue; State updates topic', () => {
  const s = sig("Parliamo invece dell'antica Roma.")
  assertEqual(s.interaction.topicChangeCue, true, 'topicChangeCue')
  const state = buildConversationState({
    messages: [
      { role: 'assistant', content: 'I squali sono magnifici.' },
      { role: 'user', content: "Parliamo invece dell'antica Roma." },
    ],
    previousState: {
      activeTopic: 'squali',
      conversationMode: 'learning',
      conversationPhase: 'deepening',
      shortReply: { intent: null, confidence: null },
      continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
      references: { unresolved: [] },
    },
    conversationSignals: s,
  })
  assert(
    /roma/i.test(String(state.activeTopic || '')),
    `topic=${state.activeTopic}`,
  )
})

test('I. Correction cue — no fake reference resolution', () => {
  const s = sig("No, intendevo l'altro.")
  assertEqual(s.interaction.correctionCue, true, 'correctionCue')
  assert(!s.diagnostics.some((d) => /resolved_ref|referent/.test(d)), 'no resolution')
})

test('J. Active follow-up', () => {
  const s = sig('E perché succede?', {
    previousConversationState: { activeTopic: 'PWM', engagement: 'medium' },
  })
  assertEqual(s.engagement.activeFollowUp, true, 'activeFollowUp')
})

test('K. Short acknowledgement — surface cue; short-reply remains authority', () => {
  const s = sig('ok')
  assertEqual(s.engagement.lowEffortReply, true, 'lowEffort')
  const messages = [
    {
      role: 'assistant',
      content: 'Vuoi che ti racconti una curiosità sui buchi neri?',
    },
    { role: 'user', content: 'ok' },
  ]
  const short = interpretShortReply({ messages })
  assertEqual(short.intent, 'accept_proposal', 'short-reply authority')
  assert(
    short.conversationalMove === 'execute_pending_proposal',
    'move from short-reply',
  )
})

test('L. Seriousness reduces playful adaptation', () => {
  const s = sig('È una situazione grave e seria.')
  assert(s.affect.seriousness >= 0.45, `seriousness=${s.affect.seriousness}`)
  const profile = buildAdaptiveResponseProfile({
    userMessage: 'È una situazione grave e seria.',
    conversationSignals: s,
    perception: { emotionalState: 'sad', intent: 'emotional_support' },
  })
  assert(profile.tone.humor <= 0.15, `humor=${profile.tone.humor}`)
  assert(profile.energy === 'low' || profile.emojiPolicy === 'none', 'restrained')
})

test('M. Profile reuse — Adaptive Profile uses Signals not duplicated style regex ownership', () => {
  const s = sig('Approfondisci tantissimo e niente emoji.')
  assert(s.style.wantsDetailed, 'detailed signal')
  assertEqual(s.style.allowsEmojis, false, 'emoji signal')
  const profile = buildAdaptiveResponseProfile({
    userMessage: 'Approfondisci tantissimo e niente emoji.',
    conversationSignals: s,
  })
  assert(
    profile.depth === 'detailed' || profile.depth === 'expert',
    `depth=${profile.depth}`,
  )
  assertEqual(profile.emojiPolicy, 'none', 'emoji none from signal')
})

test('N. Evaluator reuse — seriousness allows Capisco; emoji-off from Signals', () => {
  const serious = sig('Mi sento triste e ansioso oggi.')
  const openerOk = evaluateContractFidelity({
    responseText: 'Capisco. Possiamo andare per gradi.',
    plan: {
      writerBrief: {
        conversationalMove: 'comfort',
        shouldAskQuestion: false,
        responseProfile: {
          tone: { warmth: 0.8, formality: 0.2, humor: 0, directness: 0.4, technicality: 0.2 },
          depth: 'short',
          verbosity: 'short',
          energy: 'low',
          emojiPolicy: 'none',
        },
      },
    },
    conversationSignals: serious,
    userMessage: 'Mi sento triste e ansioso oggi.',
    conversationState: { conversationMode: 'emotional_support' },
  })
  assert(
    !openerOk.softViolations.some(
      (v) => v.code === 'generic_opener' || v.code === 'repeated_stock_opener',
    ),
    'empathy opener allowed via signals',
  )

  const emojiOff = sig('Niente emoji.')
  const emojiEval = evaluateContractFidelity({
    responseText: 'Ecco 😊',
    plan: {
      writerBrief: {
        conversationalMove: 'answer',
        shouldAskQuestion: false,
        responseProfile: {
          tone: { warmth: 0.5, formality: 0.3, humor: 0.2, directness: 0.5, technicality: 0.3 },
          depth: 'short',
          verbosity: 'short',
          energy: 'medium',
          emojiPolicy: 'rare',
        },
      },
    },
    conversationSignals: emojiOff,
    userMessage: 'Niente emoji.',
  })
  assert(
    emojiEval.softViolations.some((v) => v.code === 'emoji_forbidden'),
    'emoji forbidden via signal',
  )
})

test('O. Immutability — downstream cannot mutate Signals', () => {
  const s = sig('Mi annoio.')
  assert(Object.isFrozen(s), 'frozen root')
  assert(Object.isFrozen(s.affect), 'frozen affect')
  let threw = false
  try {
    /** @type {any} */ (s).affect.boredom = 0
  } catch {
    threw = true
  }
  // In non-strict mode assignment on frozen may silently fail; assert value unchanged.
  assert(s.affect.boredom >= 0.55, 'boredom unchanged')
  assert(threw || s.affect.boredom >= 0.55, 'immutable')

  const again = freezeConversationSignals({ ...s, affect: { ...s.affect } })
  assert(Object.isFrozen(again), 'refreeze')
})

test('debug serialize is compact', () => {
  const s = sig('Risposta breve.')
  const d = serializeConversationSignalsDebug(s)
  assert(d && d.wantsBrief === true, 'debug wantsBrief')
  assert(!('diagnostics' in d), 'no diagnostics dump')
})

test('Mind consumes Signals for boredom explore path', () => {
  const s = sig('Mi annoio, dimmi qualcosa.')
  const d = think({
    perception: { intent: 'small_talk', confidence: 0.7 },
    conversationState: {
      activeGoal: 'casual_exploration',
      conversationMode: 'exploration',
      activeTopic: null,
      shortReply: { intent: null, confidence: null },
    },
    conversationSignals: s,
    userMessage: 'Mi annoio, dimmi qualcosa.',
  })
  assertEqual(d.strategy, 'explore', 'explore')
  assert(d.responseProfile, 'has profile')
  assert(d.responseProfile.tone.warmth >= 0.5, 'warmth')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
