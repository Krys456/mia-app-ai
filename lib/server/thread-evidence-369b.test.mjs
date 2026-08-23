/**
 * #369B — Thread decision evidence + confidence calibration.
 * Run: node lib/server/thread-evidence-369b.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONVERSATION_STATE_BUILD,
  buildConversationStateAppendix,
  computeConversationState,
  looksLikeCompletionCue,
  looksLikeMergeDecisionThreadCue,
} from './conversation-state.js'
import {
  THREAD_DECISION_EVIDENCE_BUILD,
  deriveThreadDecisionEvidence,
  extractDecisionEvidenceFromUserText,
} from './thread-decision-evidence.js'
import { NATURAL_RESPONSE_POLICY_BUILD } from './natural-response-policy.js'
import { CONVERSATION_CONTINUITY_BUILD } from './conversation-continuity.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

assert.equal(CONVERSATION_STATE_BUILD, '371b-1')
assert.equal(THREAD_DECISION_EVIDENCE_BUILD, '369b-1')
assert.equal(NATURAL_RESPONSE_POLICY_BUILD, '367b-1')
assert.equal(CONVERSATION_CONTINUITY_BUILD, '367b-1')

function stateFor(userMessage, recentMessages) {
  return computeConversationState({
    userMessage,
    recentMessages: recentMessages || [],
  })
}

// —— 1. same-turn all green → high confidence + completeGo ——
{
  const s = stateFor(
    'CI è verde, Preview Ready, nessun conflitto. Faccio merge?',
  )
  assert.equal(s.conversationMode, 'decision_support')
  assert.equal(s.responsePurpose, 'recommend')
  assert.equal(s.confidence, 'high')
  assert.ok(s.threadEvidence)
  assert.equal(s.threadEvidence.ci, 'green')
  assert.equal(s.threadEvidence.preview, 'ready')
  assert.equal(s.threadEvidence.conflicts, 'none')
  assert.equal(s.threadEvidence.completeGo, true)
  assert.equal(s.threadEvidence.hedged, false)
  const app = buildConversationStateAppendix(s)
  assert.match(app, /THREAD EVIDENCE/)
  assert.match(app, /CI: green/)
  assert.match(app, /complete go evidence/i)
}

// —— 2. prior-turn all green → merge yes ——
{
  const hist = [
    { role: 'user', content: 'CI è verde. Preview Ready. Nessun conflitto.' },
    { role: 'assistant', content: 'Perfetto, tutto in ordine.' },
  ]
  const s = stateFor('Faccio merge?', hist)
  assert.equal(s.conversationMode, 'decision_support')
  assert.equal(s.confidence, 'high')
  assert.equal(s.threadEvidence.completeGo, true)
}

// —— 3. greens several turns ago (still in window) ——
{
  const hist = [
    { role: 'user', content: 'CI è verde, Preview Ready, nessun conflitto.' },
    { role: 'assistant', content: 'Ok.' },
    { role: 'user', content: 'Come va il tempo?' },
    { role: 'assistant', content: 'Sole.' },
    { role: 'user', content: 'Ok grazie' },
    { role: 'assistant', content: '👍' },
  ]
  const s = stateFor('Quindi faccio merge?', hist)
  assert.equal(s.confidence, 'high')
  assert.equal(s.threadEvidence.completeGo, true)
}

// —— 4. green then Preview failed → blocking / no merge ——
{
  const hist = [
    { role: 'user', content: 'CI è verde.' },
    { role: 'assistant', content: 'Bene.' },
    { role: 'user', content: 'Aspetta, Preview fallisce.' },
    { role: 'assistant', content: 'Capito.' },
  ]
  const s = stateFor('Faccio merge?', hist)
  assert.equal(s.threadEvidence.ci, 'green')
  assert.equal(s.threadEvidence.preview, 'failed')
  assert.equal(s.threadEvidence.blocking, true)
  assert.equal(s.threadEvidence.completeGo, false)
  assert.equal(s.confidence, 'high') // high confidence to recommend wait/no
  const app = buildConversationStateAppendix(s)
  assert.match(app, /blocking evidence/i)
}

// —— 5. hedge "credo" → low confidence ——
{
  const s = stateFor('Credo che i test siano verdi. Faccio merge?')
  assert.equal(s.conversationMode, 'decision_support')
  assert.equal(s.threadEvidence.ci, 'green')
  assert.equal(s.threadEvidence.hedged, true)
  assert.equal(s.confidence, 'low')
  assert.equal(s.threadEvidence.completeGo, false)
}

// —— 6. assistant-only green → NOT evidence ——
{
  const hist = [
    { role: 'user', content: 'Come sta la CI?' },
    { role: 'assistant', content: 'CI is green and Preview looks ready.' },
  ]
  const s = stateFor('Quindi faccio merge?', hist)
  assert.ok(s.threadEvidence)
  assert.equal(s.threadEvidence.hasAny, false)
  assert.equal(s.threadEvidence.ci, 'unknown')
  assert.equal(s.threadEvidence.completeGo, false)
  assert.equal(s.confidence, 'medium')
}

// —— 7. partial evidence → name missing gap (medium, not completeGo) ——
{
  const s = stateFor('CI è verde. Faccio merge?')
  assert.equal(s.threadEvidence.ci, 'green')
  assert.equal(s.threadEvidence.preview, 'unknown')
  assert.equal(s.threadEvidence.conflicts, 'unknown')
  assert.equal(s.threadEvidence.completeGo, false)
  assert.equal(s.confidence, 'medium')
  const app = buildConversationStateAppendix(s)
  assert.match(app, /partial evidence/i)
}

// —— 8. "Sei sicuro?" after merge recommendation inherits decision_support ——
{
  const hist = [
    {
      role: 'user',
      content: 'CI è verde, Preview Ready, nessun conflitto. Faccio merge?',
    },
    { role: 'assistant', content: 'Sì, farei merge.' },
  ]
  const s = stateFor('Sei sicuro?', hist)
  assert.equal(s.conversationMode, 'decision_support')
  assert.equal(s.priorModeInherited, true)
  assert.ok(s.threadEvidence)
  assert.equal(s.threadEvidence.completeGo, true)
}

// —— 9. topic pivot clears prior decision mode ——
{
  const hist = [
    {
      role: 'user',
      content: 'CI è verde, Preview Ready, nessun conflitto. Faccio merge?',
    },
    { role: 'assistant', content: 'Sì, farei merge.' },
    { role: 'user', content: "Cos'è OAuth?" },
    { role: 'assistant', content: 'OAuth è…' },
  ]
  const s = stateFor('Sei sicuro?', hist)
  assert.notEqual(s.conversationMode, 'decision_support')
}

// —— 10. "Aaahhh, allora ho capito" → micro STOP ——
{
  assert.equal(looksLikeCompletionCue('Aaahhh, allora ho capito'), true)
  assert.equal(looksLikeCompletionCue('Ah, adesso ho capito'), true)
  assert.equal(looksLikeCompletionCue('Ok, ora è chiaro'), true)
  assert.equal(looksLikeCompletionCue('Ahhh, capito'), true)
  const s = stateFor('Aaahhh, allora ho capito', [
    { role: 'user', content: "Cos'è OAuth?" },
    { role: 'assistant', content: '…' },
  ])
  assert.equal(s.completionCueDetected, true)
  assert.equal(s.desiredDepth, 'short')
  assert.equal(s.structurePreference, 'prose')
  assert.equal(s.initiativeLevel, 'low')
  assert.equal(s.responsePurpose, 'react')
  assert.equal(s.questionNeeded, false)
}

// —— 11. false-positive guards ——
for (const u of [
  'Ho capito, ma perché?',
  'Ok, ora è chiaro, ma il secondo?',
  'Capito, però non funziona.',
  'Ok ma perché?',
]) {
  assert.equal(looksLikeCompletionCue(u), false, `not completion: ${u}`)
  assert.equal(stateFor(u).completionCueDetected, false, `detected: ${u}`)
}

// —— 12. English equivalents ——
{
  const s = stateFor('CI is green, Preview ready, no conflicts. Should I merge?')
  assert.equal(s.confidence, 'high')
  assert.equal(s.threadEvidence.completeGo, true)

  const s2 = stateFor('I think the tests are green. Should I merge?')
  assert.equal(s2.confidence, 'low')
  assert.equal(s2.threadEvidence.hedged, true)

  const s3 = stateFor('Are you sure?', [
    {
      role: 'user',
      content: 'CI is green, Preview ready, no conflicts. Should I merge?',
    },
    { role: 'assistant', content: 'Yes, I would merge.' },
  ])
  assert.equal(s3.conversationMode, 'decision_support')
}

// —— Only PR ready → not completeGo, no invent ——
{
  const s = stateFor('La PR è pronta. Faccio merge?')
  assert.equal(s.conversationMode, 'decision_support')
  assert.equal(s.threadEvidence.completeGo, false)
  assert.equal(s.threadEvidence.ci, 'unknown')
  assert.equal(s.confidence, 'medium')
}

// —— length alone must NOT force high confidence ——
{
  const s = stateFor('Secondo te conviene procedere con il rilascio adesso?')
  assert.equal(s.conversationMode, 'decision_support')
  assert.notEqual(s.confidence, 'high')
}

// —— extract helpers ——
{
  const e = extractDecisionEvidenceFromUserText('Preview fallisce e CI è rossa')
  assert.equal(e.preview, 'failed')
  assert.equal(e.ci, 'red')
  const d = deriveThreadDecisionEvidence({
    userMessage: 'Faccio merge?',
    recentMessages: [
      { role: 'assistant', content: 'CI is green' },
      { role: 'user', content: 'Ok' },
    ],
  })
  assert.equal(d.hasAny, false)
}

assert.equal(looksLikeMergeDecisionThreadCue('CI verde Preview Ready'), true)
assert.equal(looksLikeMergeDecisionThreadCue('Che tempo fa?'), false)

// Continuity / NRP unchanged (no new callback system)
const cont = readFileSync(join(root, 'lib/server/conversation-continuity.js'), 'utf8')
assert.match(cont, /Earned callbacks/)
assert.doesNotMatch(cont, /369[Bb].*callback engine/i)

console.log('thread-evidence-369b.test.mjs: ok')
