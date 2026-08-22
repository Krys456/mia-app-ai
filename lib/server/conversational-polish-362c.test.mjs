/**
 * #362C — Conversational polish (continuity, decisions, semantic expression)
 * Deterministic State + continuity/NRP contract tests.
 * Run: node lib/server/conversational-polish-362c.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONVERSATION_STATE_BUILD,
  computeConversationState,
  looksLikeChallengeFollowUp,
  looksLikeNamedContrastFollowUp,
  looksLikeDecisionAsk,
  looksLikeFrustratedFailure,
  looksLikeRepairCue,
  looksLikeExamplesRequest,
  looksLikePlayfulChallenge,
  looksLikeExplorationAsk,
} from './conversation-state.js'
import {
  NATURAL_RESPONSE_POLICY_BUILD,
  NATURAL_RESPONSE_POLICY_MAX_CHARS,
  buildNaturalResponsePolicyAppendix,
} from './natural-response-policy.js'
import {
  CONVERSATION_CONTINUITY_BUILD,
  buildCoreContinuityAppendix,
} from './conversation-continuity.js'
import { LAIFE_BASE_SYSTEM_PROMPT, PERSONALITY_2_BUILD } from './laife-base-system-prompt.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

assert.equal(CONVERSATION_STATE_BUILD, '362c-1')
assert.equal(NATURAL_RESPONSE_POLICY_BUILD, '362c-1')
assert.equal(PERSONALITY_2_BUILD, '362c-1')
assert.equal(CONVERSATION_CONTINUITY_BUILD, '362c-1')

const settings = { replyLength: 'balanced', useEmojis: true }

function state(userMessage, recentMessages) {
  const recent = recentMessages || [{ role: 'user', content: userMessage }]
  return computeConversationState({
    userMessage,
    recentMessages: recent,
    settings,
  })
}

// —— Cue detectors ——
assert.equal(looksLikeChallengeFollowUp('Sei sicuro?'), true)
assert.equal(looksLikeChallengeFollowUp('Are you sure?'), true)
assert.equal(looksLikeChallengeFollowUp('No, non mi convince.'), true)
assert.equal(looksLikeChallengeFollowUp("I'm not convinced"), true)
assert.equal(looksLikeChallengeFollowUp('Ciao'), false)

assert.equal(looksLikeNamedContrastFollowUp('Il kefir invece?'), true)
assert.equal(looksLikeNamedContrastFollowUp('What about kefir?'), true)
assert.equal(looksLikeNamedContrastFollowUp('E la mozzarella invece?'), true)
assert.equal(looksLikeNamedContrastFollowUp('Ciao'), false)

// Preserve #362B cues
assert.equal(looksLikeFrustratedFailure('Non funziona ancora, che palle'), true)
assert.equal(looksLikeRepairCue('Non ho capito'), true)
assert.equal(looksLikeExamplesRequest('Fammi un esempio'), true)
assert.equal(looksLikePlayfulChallenge('Secondo te questa idea fa schifo? 😂'), true)
assert.equal(looksLikeExplorationAsk('Mi annoio'), true)
assert.equal(looksLikeDecisionAsk('La PR ha passato tutti i test. Faccio merge?'), true)

// —— Solo regression matrix (State) ——
{
  const s = state('Ciao')
  assert.equal(s.conversationMode, 'casual')
  assert.equal(s.responsePurpose, 'react')
}
{
  const s = state('Mi annoio')
  assert.equal(s.conversationMode, 'brainstorming')
}
{
  const s = state('Finalmente funziona!!!')
  assert.equal(s.conversationMode, 'celebration')
  assert.ok(['moderate', 'expressive'].includes(s.emojiLevel))
}
{
  const s = state('Non funziona ancora, che palle')
  assert.equal(s.conversationMode, 'debugging')
  assert.equal(s.emotionalTone, 'frustrated')
  assert.equal(s.emojiLevel, 'none')
}
{
  const s = state('Non ho capito')
  assert.equal(s.conversationMode, 'teaching')
  assert.equal(s.responsePurpose, 'explain')
}
{
  const s = state('Secondo te questa idea fa schifo? 😂')
  assert.equal(s.conversationMode, 'casual')
  assert.equal(s.responsePurpose, 'recommend')
  assert.equal(s.emotionalTone, 'playful')
}

// —— A) Contextual decision: thread evidence → decisive recommend, no qNeeded ——
{
  const s = state('Faccio merge?', [
    {
      role: 'user',
      content: 'Tests PASS. CI green. Manual QA PASS. SAFE TO MERGE YES.',
    },
    { role: 'assistant', content: 'Sembra pronto.' },
    { role: 'user', content: 'Faccio merge?' },
  ])
  assert.equal(s.conversationMode, 'decision_support')
  assert.equal(s.responsePurpose, 'recommend')
  assert.equal(s.questionNeeded, false)
}
{
  const s = state('La PR ha passato tutti i test. Faccio merge?')
  assert.equal(s.conversationMode, 'decision_support')
  assert.equal(s.responsePurpose, 'recommend')
  assert.equal(s.questionNeeded, false)
}
{
  const s = state('Sei sicuro?', [
    { role: 'user', content: 'La PR ha passato tutti i test. Faccio merge?' },
    { role: 'assistant', content: 'Sì, farei il merge. ✅' },
    { role: 'user', content: 'Sei sicuro?' },
  ])
  assert.equal(s.conversationMode, 'decision_support')
  assert.equal(s.responsePurpose, 'explain')
  assert.equal(s.questionNeeded, false)
}

// —— B) Referent soft pushback: inherit thread, do not restart as fresh casual discard ——
{
  const s = state('No, non mi convince.', [
    { role: 'user', content: 'Secondo te questa idea fa schifo? 😂' },
    {
      role: 'assistant',
      content: 'Fa schifo no 😂 Però così com\'è ha un problema di scope.',
    },
    { role: 'user', content: 'No, non mi convince.' },
  ])
  assert.ok(s.shortFollowUpDetected)
  assert.ok(
    ['casual', 'brainstorming', 'decision_support'].includes(s.conversationMode),
    `unexpected mode ${s.conversationMode}`,
  )
  assert.ok(['continue', 'explain', 'recommend'].includes(s.responsePurpose))
}
{
  const s = state('Non mi convince', [
    { role: 'user', content: "Cos'è OAuth?" },
    { role: 'assistant', content: 'OAuth è un protocollo di autorizzazione…' },
    { role: 'user', content: 'Non mi convince' },
  ])
  assert.equal(s.conversationMode, 'teaching')
  assert.equal(s.responsePurpose, 'explain')
}

// —— C) Dairy contrast inherits topical mode ——
{
  const s = state('Il kefir invece?', [
    { role: 'user', content: 'Quali latticini possono farmi andare in bagno?' },
    { role: 'assistant', content: '🥛 latte, 🥣 yogurt, 🍦 gelato…' },
    { role: 'user', content: 'Il kefir invece?' },
  ])
  assert.ok(s.shortFollowUpDetected)
  assert.ok(
    ['informational', 'teaching', 'quick_answer'].includes(s.conversationMode),
    `kefir mode ${s.conversationMode}`,
  )
  assert.ok(['explain', 'continue', 'answer'].includes(s.responsePurpose))
}

// —— D) Frustrated → Perché? inherits debugging ——
{
  const s = state('Perché?', [
    { role: 'user', content: 'Non funziona ancora, che palle' },
    { role: 'assistant', content: 'Qui c\'è ancora qualcosa che non torna.' },
    { role: 'user', content: 'Perché?' },
  ])
  assert.equal(s.conversationMode, 'debugging')
  assert.ok(['explain', 'continue'].includes(s.responsePurpose))
}

// —— Contracts ——
const nrp = buildNaturalResponsePolicyAppendix()
assert.ok(nrp.length <= NATURAL_RESPONSE_POLICY_MAX_CHARS, `NRP ${nrp.length}`)
assert.match(nrp, /THREAD EVIDENCE > GENERIC CAUTION/)
assert.match(nrp, /REFERENTS/)
assert.match(nrp, /social reciprocal|greeting reciprocal is optional/)
assert.match(nrp, /semantic marks/)
assert.match(nrp, /question_needed=false/)

const continuity = buildCoreContinuityAppendix()
assert.match(continuity, /non mi convince/i)
assert.match(continuity, /il X invece/i)
assert.match(continuity, /sei sicuro/i)
assert.match(continuity, /do not automatically discard/i)

assert.match(LAIFE_BASE_SYSTEM_PROMPT, /Thread evidence beats generic caution/)
assert.match(LAIFE_BASE_SYSTEM_PROMPT, /non mi convince/)
assert.match(LAIFE_BASE_SYSTEM_PROMPT, /🥛|concept marks/)
assert.match(LAIFE_BASE_SYSTEM_PROMPT, /Respond to the moment, not a template/)

// No style injector in chat
const chat = read('api/chat.ts')
assert.doesNotMatch(chat, /appendEmoji|injectEmoji|forceQuestion|styleRewrite/)

console.log('ok: #362C conversational polish')
