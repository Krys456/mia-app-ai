#!/usr/bin/env node
/**
 * Phase 3 — Conversation State persistence & lifecycle tests (A–L).
 * Run: node lib/server/v2/brain/conversation-state-phase3.test.mjs
 */

import {
  buildConversationState,
  hydrateConversationState,
  serializePersistedConversationState,
  transitionConversationState,
  freezeConversationState,
  PENDING_PROPOSAL_MAX_IDLE_TURNS,
  CONVERSATION_STATE_VERSION,
} from './conversation-state.js'
import { evaluateContractFidelity } from './contract-evaluator.js'
import { plan } from './planner.js'
import { think } from './mind.js'
import { perceive } from './perception.js'
import { interpretShortReply } from './short-reply.js'
import { createPipeline } from './pipeline.js'
import { createWriter, createWriterError } from './writer.js'

let passed = 0
let failed = 0

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => {
        passed += 1
        console.log(`  ok  — ${name}`)
      },
      (error) => {
        failed += 1
        const message = error instanceof Error ? error.message : String(error)
        console.error(`  FAIL — ${name}`)
        console.error(`        ${message}`)
      },
    )
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

function stateFrom(messages, previousState = null) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const perception = perceive({
    userMessage: lastUser?.content || '',
    messages,
  })
  return buildConversationState({
    messages,
    perception,
    previousState: previousState ? hydrateConversationState(previousState) || previousState : null,
  })
}

function planFrom(messages, conversationState) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const perception = perceive({
    userMessage: lastUser?.content || '',
    messages,
  })
  const decision = think({ perception, conversationState })
  return plan({ perception, decision, messages, conversationState })
}

function fullCaps(overrides = {}) {
  return {
    streaming: true,
    jsonMode: true,
    structuredOutput: false,
    tools: false,
    vision: false,
    audioInput: false,
    audioOutput: false,
    reasoning: false,
    ...overrides,
  }
}

function createFakeWriterProvider(options = {}) {
  const {
    id = 'fake',
    mode = 'normal',
    text = 'I buchi neri distorcono lo spazio-tempo in modo estremo.',
    onComplete = null,
  } = options
  /** @type {any[]} */
  const calls = []
  return Object.assign(
    {
      id,
      capabilities: fullCaps(),
      async complete(req) {
        calls.push(req)
        if (typeof onComplete === 'function') onComplete(req)
        if (mode === 'error') {
          throw createWriterError({
            code: 'provider_unavailable',
            message: 'fake fail',
            retryable: true,
            providerId: id,
          })
        }
        if (mode === 'empty') {
          return { text: '  ', finishReason: 'stop', usage: {}, model: 'fake' }
        }
        let out = text
        if (req.mode === 'rewrite' && /collapsed_execute|CONTRACT REWRITE/i.test(String(req.instructions || req.system || ''))) {
          out = 'Ecco la curiosità sui buchi neri: la luce stessa non può uscire dal loro orizzonte.'
        }
        // Fake providers receive instructions in the complete payload differently —
        // pipeline rewrite passes rewriteBrief via writer assemble; just return contentful text.
        if (mode === 'ack') out = 'Va bene.'
        return {
          text: out,
          finishReason: 'stop',
          usage: { inputTokens: 5, outputTokens: 20, totalTokens: 25 },
          model: 'fake',
        }
      },
      async *stream() {
        yield { type: 'error', error: { code: 'unsupported_feature', message: 'no stream' } }
      },
    },
    { __calls: calls },
  )
}

console.log(`Conversation State Phase 3 tests (${CONVERSATION_STATE_VERSION})\n`)

const queue = []

queue.push(
  test('A. cross-turn topic persistence: black holes → Perché?', () => {
    const turn1 = [
      { role: 'user', content: 'Parlami dei buchi neri.' },
    ]
    const s1 = stateFrom(turn1)
    assert(/buchi|neri|black/i.test(String(s1.activeTopic || '')), `t1 topic=${s1.activeTopic}`)
    const persisted = serializePersistedConversationState(s1)
    const turn2 = [
      { role: 'user', content: 'Parlami dei buchi neri.' },
      {
        role: 'assistant',
        content: 'I buchi neri sono regioni di spazio-tempo con gravità estrema.',
      },
      { role: 'user', content: 'Perché sono così strani?' },
    ]
    const s2 = stateFrom(turn2, persisted)
    assert(/buchi|neri|black|strani/i.test(String(s2.activeTopic || '')), `t2 topic=${s2.activeTopic}`)
    assert(
      s2.conversationPhase === 'deepening' || s2.conversationPhase === 'exploring',
      `phase=${s2.conversationPhase}`,
    )
  }),
)

queue.push(
  test('B. topic replacement: sharks → Rome', () => {
    const afterSharks = serializePersistedConversationState(
      stateFrom([
        { role: 'user', content: 'Parlami degli squali.' },
        {
          role: 'assistant',
          content: 'Gli squali sono predatori straordinari con sensi raffinati.',
        },
      ]),
    )
    const s2 = stateFrom(
      [
        { role: 'user', content: 'Parlami degli squali.' },
        {
          role: 'assistant',
          content: 'Gli squali sono predatori straordinari con sensi raffinati.',
        },
        { role: 'user', content: 'Parliamo invece di Roma.' },
      ],
      afterSharks,
    )
    assert(/roma/i.test(String(s2.activeTopic || '')), `topic=${s2.activeTopic}`)
    assert(!/^squali$/i.test(String(s2.activeTopic || '')), 'sharks replaced')
  }),
)

queue.push(
  test('C. proposal lifecycle: open → accepted → cleared after success', () => {
    const offer = stateFrom([
      {
        role: 'assistant',
        content: 'Posso raccontarti una curiosità sui buchi neri.',
      },
      { role: 'user', content: 'ciao' },
    ])
    // Rebuild with only assistant offer as last substantive before user ok
    const openMessages = [
      {
        role: 'assistant',
        content: 'Posso raccontarti una curiosità sui buchi neri.',
      },
    ]
    // Simulate prior turn leaving an open proposal via transition
    const afterOffer = transitionConversationState({
      preState: buildConversationState({
        messages: [{ role: 'user', content: 'Mi annoio.' }],
        perception: { intent: 'boredom' },
      }),
      plan: {
        writerBrief: {
          conversationalMove: 'default',
          activeTopic: null,
        },
      },
      responseText: 'Posso raccontarti una curiosità sui buchi neri.',
      writerSucceeded: true,
    })
    assert(afterOffer.pendingProposal, 'open after offer')
    assertEqual(afterOffer.pendingProposal.status, 'open', 'status open')

    const acceptMessages = [
      {
        role: 'assistant',
        content: 'Posso raccontarti una curiosità sui buchi neri.',
      },
      { role: 'user', content: 'ok' },
    ]
    const accepted = stateFrom(acceptMessages, serializePersistedConversationState(afterOffer))
    assertEqual(accepted.shortReply.intent, 'accept_proposal', 'accept')
    assert(accepted.pendingProposal, 'pending present')
    assertEqual(accepted.pendingProposal.status, 'accepted', 'accepted')

    const p = planFrom(acceptMessages, accepted)
    assertEqual(p.objective, 'execute_pending_proposal', 'execute')

    const completed = transitionConversationState({
      preState: accepted,
      plan: p,
      responseText: 'I buchi neri assorbono anche la luce.',
      writerSucceeded: true,
    })
    assertEqual(completed.pendingProposal, null, 'cleared after success')
    assert(
      completed.previousAssistantMove &&
        typeof completed.previousAssistantMove === 'object' &&
        completed.previousAssistantMove.conversationalMove === 'execute_pending_proposal',
      'previousAssistantMove from plan',
    )
    void offer
    void openMessages
  }),
)

queue.push(
  test('D. declined proposal: No grazie clears and does not execute', () => {
    const messages = [
      {
        role: 'assistant',
        content: 'Posso raccontarti qualcosa sugli squali.',
      },
      { role: 'user', content: 'No grazie.' },
    ]
    const sr = interpretShortReply({ messages })
    assert(
      sr.intent === 'decline_proposal' || sr.intent === 'stop',
      `intent=${sr.intent}`,
    )
    const state = stateFrom(messages)
    assertEqual(state.pendingProposal, null, 'cleared')
    const p = planFrom(messages, state)
    assert(
      p.objective === 'decline_proposal' || p.objective === 'stop',
      `objective=${p.objective}`,
    )
    assert(p.writerBrief.conversationalMove !== 'execute_pending_proposal', 'not execute')
  }),
)

queue.push(
  test('E. superseded proposal: shark offer → talk about space', () => {
    const afterOffer = transitionConversationState({
      preState: stateFrom([{ role: 'user', content: 'Ciao' }]),
      plan: { writerBrief: { conversationalMove: 'default' } },
      responseText: 'Posso raccontarti una curiosità sugli squali.',
      writerSucceeded: true,
    })
    assert(afterOffer.pendingProposal, 'had proposal')
    const messages = [
      {
        role: 'assistant',
        content: 'Posso raccontarti una curiosità sugli squali.',
      },
      { role: 'user', content: 'Parliamo invece dello spazio.' },
    ]
    const state = stateFrom(messages, serializePersistedConversationState(afterOffer))
    assertEqual(state.pendingProposal, null, 'superseded')
    assert(/spazio|space/i.test(String(state.activeTopic || '')), `topic=${state.activeTopic}`)
  }),
)

queue.push(
  test('F. stale proposal expiry: ok must not revive expired proposal', () => {
    let prior = {
      version: CONVERSATION_STATE_VERSION,
      turnCount: 3,
      activeTopic: 'squali',
      activeGoal: null,
      conversationMode: 'learning',
      conversationPhase: 'exploring',
      engagement: 'medium',
      previousAssistantMove: { type: 'answer', topic: 'squali' },
      pendingProposal: {
        type: 'tell_curiosity',
        topic: 'squali',
        status: 'open',
        idleTurns: PENDING_PROPOSAL_MAX_IDLE_TURNS,
        openedTurn: 1,
      },
      shortReply: { intent: null, confidence: null },
      continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
      references: { unresolved: [] },
    }
    // Unrelated completed answer as last assistant — no live proposal surface.
    const messages = [
      {
        role: 'assistant',
        content: 'Questa è la procedura completa. Ecco tutto quello che serve.',
      },
      { role: 'user', content: 'ok' },
    ]
    const state = stateFrom(messages, prior)
    assertEqual(state.pendingProposal, null, 'expired')
    assertEqual(state.shortReply.intent, 'passive_acknowledgement', 'passive not accept')
    const p = planFrom(messages, state)
    assertEqual(p.objective, 'passive_acknowledgement', 'no execute stale')
  }),
)

queue.push(
  test('G. closing persistence: later ok does not reopen', () => {
    const closed = transitionConversationState({
      preState: stateFrom([
        { role: 'user', content: 'Parlami dei vulcani.' },
        {
          role: 'assistant',
          content: 'I vulcani nascono dal magma che sale in superficie.',
        },
        { role: 'user', content: 'Grazie, basta così.' },
      ]),
      plan: {
        writerBrief: {
          conversationalMove: 'stop',
          activeTopic: 'vulcani',
        },
      },
      responseText: 'Quando vuoi riprendere, sono qui.',
      writerSucceeded: true,
    })
    assertEqual(closed.conversationPhase, 'closing', 'closing')
    assertEqual(closed.continuity.shouldResume, false, 'no resume')

    const later = stateFrom(
      [
        { role: 'user', content: 'Parlami dei vulcani.' },
        {
          role: 'assistant',
          content: 'I vulcani nascono dal magma che sale in superficie.',
        },
        { role: 'user', content: 'Grazie, basta così.' },
        { role: 'assistant', content: 'Quando vuoi riprendere, sono qui.' },
        { role: 'user', content: 'ok' },
      ],
      serializePersistedConversationState(closed),
    )
    assertEqual(later.conversationPhase, 'closing', 'stays closing')
    const p = planFrom(
      [
        { role: 'assistant', content: 'Quando vuoi riprendere, sono qui.' },
        { role: 'user', content: 'ok' },
      ],
      later,
    )
    assert(
      p.objective === 'passive_acknowledgement' || p.objective === 'stop',
      `objective=${p.objective}`,
    )
    assert(p.writerBrief.conversationalMove !== 'continue_topic', 'no reopen continue')
  }),
)

queue.push(
  test('H. new-task reset: history → JS sort function', () => {
    const hist = serializePersistedConversationState(
      stateFrom([
        { role: 'user', content: "Parliamo dell'antica Roma." },
        {
          role: 'assistant',
          content: 'Roma antica ha lasciato un segno enorme sull’ingegneria e sul diritto.',
        },
      ]),
    )
    const messages = [
      { role: 'user', content: "Parliamo dell'antica Roma." },
      {
        role: 'assistant',
        content: 'Roma antica ha lasciato un segno enorme sull’ingegneria e sul diritto.',
      },
      {
        role: 'user',
        content: 'Scrivimi una funzione JavaScript che ordina un array.',
      },
    ]
    const state = stateFrom(messages, hist)
    assertEqual(state.activeGoal, 'task_execution', 'task goal')
    assert(state.pendingProposal == null, 'no dragged proposal')
  }),
)

queue.push(
  test('I. Planner immutability: cannot mutate input Conversation State', () => {
    const messages = [
      {
        role: 'assistant',
        content: 'Posso spiegarti come funziona un buco nero.',
      },
      { role: 'user', content: 'ok' },
    ]
    const state = freezeConversationState(stateFrom(messages))
    const before = state.activeTopic
    planFrom(messages, state)
    assertEqual(state.activeTopic, before, 'topic unchanged')
    let mutated = false
    try {
      /** @type {any} */ (state).activeTopic = 'hack'
      mutated = state.activeTopic === 'hack'
    } catch {
      mutated = false
    }
    assert(!mutated, 'frozen')
  }),
)

queue.push(
  test('J. Writer immutability: pipeline passes frozen state', async () => {
    const fake = createFakeWriterProvider({
      text: 'Ecco una curiosità: i buchi neri piegano la luce.',
    })
    const writer = createWriter({
      providers: { fake },
      defaultProviderId: 'fake',
    })
    const pipeline = createPipeline({ writer, enableContractEvaluator: false })
    const result = await pipeline.runConversation({
      userMessage: 'ok',
      messages: [
        {
          role: 'assistant',
          content: 'Posso raccontarti una curiosità sui buchi neri.',
        },
        { role: 'user', content: 'ok' },
      ],
    })
    assert(result.conversationState, 'pre state')
    assert(Object.isFrozen(result.conversationState), 'frozen pre')
    assert(result.nextConversationState, 'next persisted')
    assert(!('diagnostics' in /** @type {any} */ (result.nextConversationState)), 'no diagnostics in persist')
  }),
)

queue.push(
  test('K. failed Writer does not complete accepted proposal', async () => {
    const fake = createFakeWriterProvider({ mode: 'error' })
    const writer = createWriter({
      providers: { fake },
      defaultProviderId: 'fake',
    })
    const pipeline = createPipeline({ writer, enableContractEvaluator: false })
    let caught = null
    try {
      await pipeline.runConversation({
        userMessage: 'ok',
        messages: [
          {
            role: 'assistant',
            content: 'Posso raccontarti una curiosità sui buchi neri.',
          },
          { role: 'user', content: 'ok' },
        ],
      })
    } catch (err) {
      caught = err
    }
    assert(caught, 'writer error thrown')
    // Pre-state would have been accepted; failure must not publish completed null via success path.
    // Pipeline throws before returning nextConversationState on success; error may carry recovery state.
    const recovery = /** @type {any} */ (caught).nextConversationState
    if (recovery) {
      assert(
        recovery.pendingProposal == null ||
          recovery.pendingProposal.status === 'open' ||
          recovery.pendingProposal.status === 'accepted',
        `recovery status=${recovery.pendingProposal?.status}`,
      )
      assert(recovery.pendingProposal?.status !== 'completed', 'not completed')
    }
  }),
)

queue.push(
  test('L. Evaluator fidelity: collapsed execute is hard violation; rewrite brief preserves contract', () => {
    const planLike = {
      objective: 'execute_pending_proposal',
      writerBrief: {
        conversationalMove: 'execute_pending_proposal',
        shouldAskQuestion: false,
        shouldContinue: true,
        forceMinimalAck: false,
        activeTopic: 'buchi neri',
        pendingProposalAction: 'tell_curiosity',
      },
    }
    const bad = evaluateContractFidelity({
      responseText: 'Va bene.',
      plan: planLike,
      conversationState: { conversationPhase: 'executing', activeTopic: 'buchi neri' },
    })
    assertEqual(bad.ok, false, 'not ok')
    assert(bad.needsRewrite, 'needs rewrite')
    assert(/execute_pending_proposal/.test(String(bad.rewriteBrief)), 'move in brief')
    assert(/buchi neri/.test(String(bad.rewriteBrief)), 'topic in brief')
    assert(/shouldAskQuestion=false/.test(String(bad.rewriteBrief)), 'ask flag')

    const good = evaluateContractFidelity({
      responseText: 'I buchi neri assorbono anche la luce oltre l’orizzonte.',
      plan: planLike,
      conversationState: { conversationPhase: 'executing', activeTopic: 'buchi neri' },
    })
    assertEqual(good.ok, true, 'ok contentful')
  }),
)

queue.push(
  test('serialize/hydrate round-trip drops diagnostics', () => {
    const state = stateFrom([{ role: 'user', content: 'Parlami di scienza.' }])
    const raw = serializePersistedConversationState(state)
    assert(raw && !('diagnostics' in raw), 'no diagnostics')
    const hydrated = hydrateConversationState(raw)
    assert(hydrated, 'hydrated')
    assertEqual(hydrated.activeTopic, raw.activeTopic, 'topic')
  }),
)

await queue.reduce((p, t) => p.then(() => t), Promise.resolve())

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
