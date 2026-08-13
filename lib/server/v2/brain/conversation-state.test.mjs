#!/usr/bin/env node
/**
 * Phase 2 — Conversation State regression tests (A–H).
 * Run: node lib/server/v2/brain/conversation-state.test.mjs
 */

import {
  buildConversationState,
  clearPendingProposal,
  freezeConversationState,
  isConversationState,
  assertConversationStateInvariants,
  CONVERSATION_STATE_VERSION,
} from './conversation-state.js'
import { plan } from './planner.js'
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
    throw new Error(
      `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    )
  }
}

/**
 * @param {Array<{ role: string, content: string }>} messages
 * @param {object} [perceptionOverrides]
 */
function stateFrom(messages, perceptionOverrides = {}) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const perception = perceive({
    userMessage: lastUser?.content || '',
    messages,
  })
  return buildConversationState({
    messages,
    perception: { ...perception, ...perceptionOverrides },
  })
}

/**
 * @param {Array<{ role: string, content: string }>} messages
 * @param {ReturnType<typeof buildConversationState>} conversationState
 */
function planFrom(messages, conversationState) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const perception = perceive({
    userMessage: lastUser?.content || '',
    messages,
  })
  const decision = think({ perception, conversationState })
  return plan({
    perception,
    decision,
    messages,
    conversationState,
  })
}

console.log(`Conversation State tests (${CONVERSATION_STATE_VERSION})\n`)

test('schema: buildConversationState returns required fields', () => {
  const state = stateFrom([{ role: 'user', content: 'Ciao' }])
  assert(isConversationState(state), 'isConversationState')
  assert('activeTopic' in state, 'activeTopic')
  assert('activeGoal' in state, 'activeGoal')
  assert('conversationMode' in state, 'conversationMode')
  assert('conversationPhase' in state, 'conversationPhase')
  assert('engagement' in state, 'engagement')
  assert('previousAssistantMove' in state, 'previousAssistantMove')
  assert('pendingProposal' in state, 'pendingProposal')
  assert(state.shortReply && 'intent' in state.shortReply, 'shortReply')
  assert(state.continuity && typeof state.continuity.shouldResume === 'boolean', 'continuity')
  assert(Array.isArray(state.references.unresolved), 'references')
  assert(!('suggestedResumeSentence' in state.continuity), 'no prose in continuity')
})

// ── A. Topic continuity ─────────────────────────────────────────────────────

test('A. topic continuity: E quello più grande? keeps sharks', () => {
  const messages = [
    { role: 'user', content: 'Parlami degli squali.' },
    {
      role: 'assistant',
      content:
        'Gli squali sono predatori straordinari. Il grande bianco può superare i sei metri e caccia con precisione.',
    },
    { role: 'user', content: 'E quello più grande?' },
  ]
  const state = stateFrom(messages)
  assert(/squali|grande|bianco/i.test(String(state.activeTopic || '')), `topic=${state.activeTopic}`)
  const p = planFrom(messages, state)
  assertEqual(p.writerBrief.activeTopic, state.activeTopic, 'planner consumes state topic')
  assert(/squali|grande|bianco/i.test(String(p.writerBrief.activeTopic || '')), 'planner topic')
})

// ── B. Pending proposal ─────────────────────────────────────────────────────

test('B. pending proposal: ok accepts black-hole curiosity; cleared after execute', () => {
  const messages = [
    {
      role: 'assistant',
      content: 'Posso raccontarti una curiosità sui buchi neri.',
    },
    { role: 'user', content: 'ok' },
  ]
  const state = stateFrom(messages)
  assertEqual(state.shortReply.intent, 'accept_proposal', 'accept_proposal')
  assert(state.pendingProposal, 'pendingProposal present')
  assert(/buchi|neri|black|curiosit/i.test(String(state.pendingProposal.topic || state.activeTopic || '')), 'proposal topic')
  assert(
    state.pendingProposal.type === 'tell_curiosity' ||
      state.pendingProposal.type === 'explain' ||
      state.pendingProposal.type === 'open_offer' ||
      state.pendingProposal.type === 'explore_topic',
    `type=${state.pendingProposal.type}`,
  )

  const p = planFrom(messages, state)
  assertEqual(p.objective, 'execute_pending_proposal', 'planner executes')
  assertEqual(p.writerBrief.conversationalMove, 'execute_pending_proposal', 'move')
  assertEqual(p.shortReplyState.intent, 'accept_proposal', 'short reply on plan')

  // After execution helper clears proposal for the next turn.
  const cleared = clearPendingProposal(state, 'executed')
  assertEqual(cleared.pendingProposal, null, 'cleared after execution')

  // Next turn after assistant delivered the curiosity: no stale proposal.
  const after = buildConversationState({
    messages: [
      ...messages,
      {
        role: 'assistant',
        content:
          'I buchi neri distorcono lo spazio-tempo così tanto che neanche la luce riesce a uscirne. Questa è la spiegazione completa.',
      },
      { role: 'user', content: 'ok' },
    ],
    previousState: cleared,
  })
  assertEqual(after.pendingProposal, null, 'no stale proposal')
  assertEqual(after.shortReply.intent, 'passive_acknowledgement', 'passive after complete')
})

// ── C. Passive acknowledgement ──────────────────────────────────────────────

test('C. passive acknowledgement: ok with no proposal invents nothing', () => {
  const messages = [
    {
      role: 'assistant',
      content:
        'Questa è la procedura completa. Ecco tutto quello che serve per configurare il server.',
    },
    { role: 'user', content: 'ok' },
  ]
  const state = stateFrom(messages)
  assertEqual(state.shortReply.intent, 'passive_acknowledgement', 'passive')
  assertEqual(state.pendingProposal, null, 'no invented proposal')
  const p = planFrom(messages, state)
  assertEqual(p.objective, 'passive_acknowledgement', 'planner passive')
  assertEqual(p.writerBrief.forceMinimalAck, true, 'forceMinimalAck')
})

// ── D. Topic change ─────────────────────────────────────────────────────────

test('D. topic change: sharks → Ancient Rome', () => {
  const messages = [
    { role: 'user', content: 'Parlami degli squali.' },
    {
      role: 'assistant',
      content: 'Gli squali hanno sensi incredibili, soprattutto l\'olfatto in acqua.',
    },
    { role: 'user', content: "Parliamo invece dell'antica Roma." },
  ]
  const state = stateFrom(messages)
  assert(/roma|antica/i.test(String(state.activeTopic || '')), `topic=${state.activeTopic}`)
  assert(!/^squali$/i.test(String(state.activeTopic || '')), 'sharks no longer sole authority')
  const p = planFrom(messages, state)
  assert(/roma|antica/i.test(String(p.writerBrief.activeTopic || '')), 'planner new topic')
})

// ── E. Resume ───────────────────────────────────────────────────────────────

test('E. resume: continuity facts without canned prose in state', () => {
  const messages = [
    { role: 'user', content: 'Voglio rendere il Writer più naturale.' },
    {
      role: 'assistant',
      content: 'Ok, partiamo dalla presenza. Possiamo continuare con la seconda parte dopo.',
    },
    { role: 'user', content: 'Writer voice corpus completato.' },
    {
      role: 'assistant',
      content: 'Perfetto, corpus aggiunto. Vuoi che riprendiamo dal ritmo?',
    },
    { role: 'user', content: 'Continuiamo da dove eravamo rimasti.' },
  ]
  const state = stateFrom(messages)
  assert(state.continuity, 'continuity')
  assert(
    state.continuity.resumeTopic || state.activeTopic,
    'has resumeTopic or activeTopic',
  )
  assert(
    state.continuity.shouldResume === true || Boolean(state.continuity.resumePoint),
    'resume progress preserved',
  )
  assert(!('suggestedResumeSentence' in state), 'no resume sentence on state root')
  assert(!('suggestedResumeSentence' in state.continuity), 'no prose in continuity')
  const p = planFrom(messages, state)
  assert(p.writerBrief.shouldContinue || p.writerBrief.continueTopic, 'planner can resume')
})

// ── F. Boredom ──────────────────────────────────────────────────────────────

test('F. boredom: casual_exploration / exploration mode; state does not choose curiosity', () => {
  const messages = [{ role: 'user', content: 'Mi annoio e non so di cosa parlare.' }]
  const state = stateFrom(messages)
  assertEqual(state.activeGoal, 'casual_exploration', 'activeGoal')
  assert(
    state.conversationMode === 'exploration' || state.conversationMode === 'social',
    `mode=${state.conversationMode}`,
  )
  const decision = think({
    perception: perceive({ userMessage: messages[0].content, messages }),
    conversationState: state,
  })
  assertEqual(decision.strategy, 'explore', 'mind may take initiative')
  // State itself has no curiosity objective / surprise directive.
  assert(!('objective' in state) || state.objective == null, 'state has no planner objective')
})

// ── G. Closing ──────────────────────────────────────────────────────────────

test('G. closing: Grazie basta così → closing phase + stop', () => {
  const messages = [
    { role: 'user', content: 'Spiegami i vulcani.' },
    {
      role: 'assistant',
      content: 'I vulcani nascono quando il magma sale verso la superficie terrestre.',
    },
    { role: 'user', content: 'Grazie, basta così.' },
  ]
  const state = stateFrom(messages)
  assertEqual(state.conversationPhase, 'closing', 'phase closing')
  assertEqual(state.shortReply.intent, 'stop', 'stop intent')
  const p = planFrom(messages, state)
  assertEqual(p.objective, 'stop', 'planner stop')
  assertEqual(p.writerBrief.shouldAskQuestion, false, 'no reopen question')
  assert(
    p.writerBrief.mustNot.some((m) => /Do not continue|new topic|stop/i.test(m)),
    'mustNot reopen',
  )
})

// ── H. State immutability ───────────────────────────────────────────────────

test('H. immutability: Planner/Writer cannot mutate shared Conversation State', () => {
  const messages = [
    { role: 'assistant', content: 'Posso spiegarti come funziona un buco nero.' },
    { role: 'user', content: 'ok' },
  ]
  const state = freezeConversationState(stateFrom(messages))
  assert(Object.isFrozen(state), 'frozen root')
  assert(Object.isFrozen(state.shortReply), 'frozen shortReply')
  assert(Object.isFrozen(state.continuity), 'frozen continuity')

  let threw = false
  try {
    /** @type {any} */ (state).activeTopic = 'hacked'
  } catch {
    threw = true
  }
  assert(threw || state.activeTopic !== 'hacked', 'mutation blocked or ignored')

  const p = planFrom(messages, state)
  try {
    /** @type {any} */ (p.conversationState).activeTopic = 'mutated-by-planner'
  } catch {
    // expected in strict mode
  }
  assertEqual(state.activeTopic, p.conversationState.activeTopic, 'shared state unchanged from original topic')
  assert(state.activeTopic !== 'mutated-by-planner', 'planner did not mutate original')

  const issues = assertConversationStateInvariants(state, { warn: () => {} })
  assert(issues.length === 0 || !issues.includes('Conversation State schema invalid'), 'invariants')
})

test('invariant: only short-reply.js intent appears on state.shortReply', () => {
  const state = stateFrom([
    { role: 'assistant', content: 'Vuoi che ti racconti qualcosa sullo spazio?' },
    { role: 'user', content: 'sì' },
  ])
  assertEqual(state.shortReply.intent, 'accept_proposal', 'from short-reply authority')
  assert(typeof state.shortReply.confidence === 'number', 'confidence')
})

test('invariant: Conversation State never emits user-facing prose fields', () => {
  const state = stateFrom([
    { role: 'user', content: 'Parliamo di scienza.' },
    { role: 'assistant', content: 'Certo, partiamo dai corvi e dalla loro intelligenza.' },
    { role: 'user', content: 'continua' },
  ])
  const json = JSON.stringify(state)
  assert(!/L'ultima volta stavamo/i.test(json), 'no resume sentence prose')
  assert(!/suggestedResumeSentence/i.test(json), 'no suggestedResumeSentence key')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
