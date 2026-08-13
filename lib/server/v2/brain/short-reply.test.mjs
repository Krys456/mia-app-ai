#!/usr/bin/env node
/**
 * Tests for authoritative short-reply interpretation (Phase 1).
 * Run: node lib/server/v2/brain/short-reply.test.mjs
 */

import {
  interpretShortReply,
  hasUnresolvedConversationalProposal,
  shortReplyIntentToMove,
  observeShortReplySurface,
} from './short-reply.js'

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

console.log('Short-reply interpretation tests\n')

test('1. pending proposal + ok → accept_proposal', () => {
  const state = interpretShortReply({
    messages: [
      { role: 'assistant', content: 'Posso raccontarti una curiosità sullo spazio.' },
      { role: 'user', content: 'ok' },
    ],
  })
  assertEqual(state.intent, 'accept_proposal', 'intent')
  assertEqual(state.conversationalMove, 'execute_pending_proposal', 'move')
  assert(state.hasPendingProposal, 'pending')
})

test('2. completed answer + ok → passive_acknowledgement', () => {
  const state = interpretShortReply({
    messages: [
      { role: 'assistant', content: 'Questa è la procedura completa. Ecco tutto quello che serve.' },
      { role: 'user', content: 'ok' },
    ],
  })
  assertEqual(state.intent, 'passive_acknowledgement', 'passive')
  assertEqual(hasUnresolvedConversationalProposal('Questa è la procedura completa.'), false, 'no proposal')
})

test('3. continue proposal + vai → continue', () => {
  const state = interpretShortReply({
    messages: [
      { role: 'assistant', content: 'Posso continuare con la seconda parte.' },
      { role: 'user', content: 'vai' },
    ],
  })
  assertEqual(state.intent, 'continue', 'continue')
  assertEqual(state.conversationalMove, 'continue_topic', 'move')
})

test('4. Grazie basta così → stop', () => {
  const state = interpretShortReply({ userMessage: 'Grazie, basta così.' })
  assertEqual(state.intent, 'stop', 'stop')
})

test('5. mh → uncertain', () => {
  const state = interpretShortReply({
    messages: [
      { role: 'assistant', content: 'Possiamo parlare di scienza.' },
      { role: 'user', content: 'mh' },
    ],
  })
  assertEqual(state.intent, 'uncertain', 'uncertain')
  assertEqual(state.conversationalMove, 'clarify_uncertain', 'move')
})

test('6. sì after specific subject keeps accept_proposal', () => {
  const state = interpretShortReply({
    messages: [
      { role: 'assistant', content: 'Se vuoi posso raccontarti qualcosa di assurdo sul corpo umano.' },
      { role: 'user', content: 'sì' },
    ],
  })
  assertEqual(state.intent, 'accept_proposal', 'accept')
  assertEqual(state.pendingProposalType, 'tell_curiosity', 'type')
})

test('7. surface observation does not equal authoritative intent', () => {
  const surface = observeShortReplySurface('ok')
  assert(surface.isShortReply && surface.surfaceAgreement, 'surface')
  assertEqual(shortReplyIntentToMove('accept_proposal'), 'execute_pending_proposal', 'map')
})

test('8. not_short_reply for normal messages', () => {
  const state = interpretShortReply({ userMessage: 'Raccontami qualcosa sullo spazio.' })
  assertEqual(state.intent, 'not_short_reply', 'not short')
  assertEqual(state.isShortReply, false, 'flag')
})

test('9. pending proposal + No grazie → decline_proposal', () => {
  const state = interpretShortReply({
    messages: [
      { role: 'assistant', content: 'Posso raccontarti una curiosità sugli squali.' },
      { role: 'user', content: 'No grazie.' },
    ],
  })
  assertEqual(state.intent, 'decline_proposal', 'decline')
  assertEqual(state.conversationalMove, 'decline_proposal', 'move')
})

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
