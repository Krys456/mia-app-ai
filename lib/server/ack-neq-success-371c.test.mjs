/**
 * #371C — Acknowledgement ≠ external/system success (Adaptive + State contract).
 * Run: node lib/server/ack-neq-success-371c.test.mjs
 */
import assert from 'node:assert/strict'
import {
  ADAPTIVE_RESPONSE_REASONING_CONTRACT,
  buildCoreAdaptiveResponseReasoningAppendix,
} from './adaptive-response-reasoning.js'
import {
  CONVERSATION_STATE_BUILD,
  buildConversationStateAppendix,
  computeConversationState,
  looksLikeCompletionCue,
} from './conversation-state.js'
import {
  deriveThreadDecisionEvidence,
  extractDecisionEvidenceFromUserText,
} from './thread-decision-evidence.js'

assert.equal(CONVERSATION_STATE_BUILD, '371c-1')

const adaptive = buildCoreAdaptiveResponseReasoningAppendix()
assert.equal(adaptive, ADAPTIVE_RESPONSE_REASONING_CONTRACT)

// —— Contract: ack ≠ world-state / attempt ≠ success ——
assert.ok(/Acknowledgement ≠ world-state update/i.test(adaptive))
assert.ok(/does not by itself report that an external action or system state changed/i.test(adaptive))
assert.ok(/Do not infer Preview\/CI\/deploy/i.test(adaptive))
assert.ok(/unless the user explicitly reports it or verified execution evidence/i.test(adaptive))
assert.ok(/Stay silent about this rule/i.test(adaptive))
assert.ok(/Attempt ≠ success/i.test(adaptive))
assert.ok(/not that the action succeeded/i.test(adaptive))
assert.ok(/Conversational completion\/understanding is not automatic proof/i.test(adaptive))
// Must not force user-facing disclaimer wording into the contract as a required reply.
assert.ok(!/Your acknowledgement does not confirm/i.test(adaptive))
assert.ok(!/does not confirm success/i.test(adaptive))

function stateFor(userMessage, recentMessages = []) {
  return computeConversationState({ userMessage, recentMessages })
}

function histWith(userPrior, assistantExplain = '(debug explain)') {
  return [
    { role: 'user', content: userPrior },
    { role: 'assistant', content: assistantExplain },
  ]
}

function assertNoSuccessInference(label, priorUser, ack, opts = {}) {
  const hist = histWith(priorUser, opts.assistant || '(debug explain)')
  const s = stateFor(ack, [...hist, { role: 'user', content: ack }])
  const appendix = buildConversationStateAppendix(s)
  const ev = deriveThreadDecisionEvidence({
    recentMessages: [...hist, { role: 'user', content: ack }],
    userMessage: ack,
  })
  const ackTouch = extractDecisionEvidenceFromUserText(ack)

  if (opts.expectCompletion !== false) {
    assert.equal(s.completionCueDetected, true, `${label}: completion`)
    assert.equal(s.responsePurpose, 'react', `${label}: react`)
    assert.match(appendix, /completion_signal: true/, `${label}: signal`)
    assert.match(
      appendix,
      /does not imply external\/system success/i,
      `${label}: state twin`,
    )
  }

  // Ack itself must not encode success evidence.
  assert.equal(ackTouch.touched, false, `${label}: ack not evidence`)
  assert.notEqual(ev.preview, 'ready', `${label}: preview not ready`)
  assert.notEqual(ev.ci, 'green', `${label}: ci not green`)
  assert.equal(ev.completeGo, false, `${label}: not completeGo`)
  assert.ok(!/Preview:\s*ready/i.test(appendix), `${label}: no ready in appendix`)
  assert.ok(!/\bgreen\b/i.test(appendix), `${label}: no green in appendix`)
}

// —— A Preview failed → Ahhh ora sì ——
{
  assert.equal(looksLikeCompletionCue('Ahhh ora sì'), true)
  assertNoSuccessInference('A', 'Preview fallisce', 'Ahhh ora sì', {
    assistant:
      "Che rottura. Preview rossa = apri i log e prendi la prima riga d'errore reale...",
  })
}

// —— B CI red → Capito ——
assertNoSuccessInference('B', 'CI è rossa', 'Capito')

// —— C Deploy failed → Ok ——
assertNoSuccessInference('C', 'Il deploy è fallito', 'Ok')

// —— D OAuth failed → Ah sì ——
assertNoSuccessInference('D', 'OAuth connection failed', 'Ah sì')

// —— E Reminder not created → Perfetto ——
assertNoSuccessInference('E', 'Il reminder non è stato creato', 'Perfetto')

// —— F Payment failed → Ok ora sì (may not be completion cue; still no success evidence) ——
{
  const ack = 'Ok ora sì'
  const hist = histWith('Payment failed')
  const s = stateFor(ack, [...hist, { role: 'user', content: ack }])
  const ev = deriveThreadDecisionEvidence({
    recentMessages: [...hist, { role: 'user', content: ack }],
    userMessage: ack,
  })
  assert.equal(extractDecisionEvidenceFromUserText(ack).touched, false, 'F: ack not evidence')
  assert.notEqual(ev.preview, 'ready', 'F: preview')
  assert.notEqual(ev.ci, 'green', 'F: ci')
  assert.equal(ev.completeGo, false, 'F: completeGo')
  assert.ok(!/Preview:\s*ready|\bci:\s*green/i.test(buildConversationStateAppendix(s)), 'F: appendix')
}

// —— G explicit Preview green allowed ——
{
  const msg = 'Ora la Preview è verde!'
  const hist = histWith('Preview fallisce')
  const touch = extractDecisionEvidenceFromUserText(msg)
  // Prefer explicit preview success phrasing that #369B already understands.
  const alt = 'Preview Ready'
  const altTouch = extractDecisionEvidenceFromUserText(alt)
  assert.equal(altTouch.preview, 'ready', 'G: Preview Ready → ready')
  const ev = deriveThreadDecisionEvidence({
    recentMessages: [...hist, { role: 'user', content: alt }],
    userMessage: alt,
  })
  assert.equal(ev.preview, 'ready', 'G: evidence ready')
  // Natural IT phrasing should not be blocked by Adaptive contract (explicit report OK).
  assert.ok(/explicitly reports it/i.test(adaptive), 'G: adaptive allows explicit')
  void msg
  void touch
}

// —— H explicit CI green ——
{
  const msg = 'Adesso CI è verde'
  assert.equal(extractDecisionEvidenceFromUserText(msg).ci, 'green')
  const hist = histWith('CI è rossa')
  const ev = deriveThreadDecisionEvidence({
    recentMessages: [...hist, { role: 'user', content: msg }],
    userMessage: msg,
  })
  assert.equal(ev.ci, 'green', 'H: ci green')
}

// —— I Fatto. = attempt, not deploy success ——
{
  assert.equal(looksLikeCompletionCue('Fatto.'), true)
  const hist = [
    { role: 'user', content: 'Il deploy è fallito' },
    { role: 'assistant', content: 'Rifai il deploy.' },
  ]
  const s = stateFor('Fatto.', [...hist, { role: 'user', content: 'Fatto.' }])
  const ev = deriveThreadDecisionEvidence({
    recentMessages: [...hist, { role: 'user', content: 'Fatto.' }],
    userMessage: 'Fatto.',
  })
  assert.equal(s.completionCueDetected, true, 'I: completion')
  assert.equal(extractDecisionEvidenceFromUserText('Fatto.').touched, false, 'I: not evidence')
  assert.notEqual(ev.preview, 'ready', 'I: not ready')
  assert.equal(ev.completeGo, false, 'I: not completeGo')
  assert.ok(/Attempt ≠ success/i.test(adaptive), 'I: attempt rule present')
}

// —— J Fatto, ora è verde. = explicit success may be accepted ——
{
  const msg = 'Fatto, ora è verde.'
  // Adaptive must allow explicit success reports; #369B may still need CI/Preview nouns.
  assert.ok(/explicitly reports it/i.test(adaptive), 'J: explicit allowed')
  const withPreview = 'Fatto, ora la Preview è Ready.'
  // Closest existing parser form:
  const ready = extractDecisionEvidenceFromUserText('Preview Ready')
  assert.equal(ready.preview, 'ready', 'J: explicit Preview Ready works')
  void msg
  void withPreview
}

// —— Preserve #371B micro completion ——
{
  const s = stateFor('Ahhh ora sì')
  assert.equal(s.completionCueDetected, true)
  assert.equal(s.responsePurpose, 'react')
  assert.equal(s.desiredDepth, 'short')
  assert.equal(s.initiativeLevel, 'low')
  assert.equal(s.questionNeeded, false)
}

console.log('ack-neq-success-371c.test.mjs: ok')
