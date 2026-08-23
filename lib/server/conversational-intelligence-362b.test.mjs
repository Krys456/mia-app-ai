/**
 * #362B — Conversational Intelligence 3.0
 * Deterministic State classifier + prompt contract tests (IT+EN paraphrases).
 * Run: node lib/server/conversational-intelligence-362b.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONVERSATION_STATE_BUILD,
  computeConversationState,
  looksLikeRepairCue,
  looksLikeExamplesRequest,
  looksLikeDecisionAsk,
  looksLikePlayfulChallenge,
  looksLikeExplorationAsk,
  looksLikeSeriousCue,
  looksLikeFrustratedFailure,
  buildConversationStateAppendix,
} from './conversation-state.js'
import {
  NATURAL_RESPONSE_POLICY_BUILD,
  NATURAL_RESPONSE_POLICY_MAX_CHARS,
  buildNaturalResponsePolicyAppendix,
} from './natural-response-policy.js'
import { LAIFE_BASE_SYSTEM_PROMPT, PERSONALITY_2_BUILD } from './laife-base-system-prompt.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

assert.equal(CONVERSATION_STATE_BUILD, '371b-1')
assert.equal(NATURAL_RESPONSE_POLICY_BUILD, '367b-1')
assert.equal(PERSONALITY_2_BUILD, '362c-1')

const settings = { replyLength: 'balanced', useEmojis: true }

function state(text, extra = {}) {
  return computeConversationState({
    userMessage: text,
    recentMessages: [{ role: 'user', content: text }],
    settings,
    ...extra,
  })
}

function assertMode(text, expected, fields = {}) {
  const s = state(text)
  assert.equal(s.conversationMode, expected.mode, `${text} mode`)
  if (expected.purpose) assert.equal(s.responsePurpose, expected.purpose, `${text} purpose`)
  if (expected.tone) assert.equal(s.emotionalTone, expected.tone, `${text} tone`)
  if (expected.emoji) assert.equal(s.emojiLevel, expected.emoji, `${text} emoji`)
  if (expected.depth) assert.equal(s.desiredDepth, expected.depth, `${text} depth`)
  for (const [k, v] of Object.entries(fields)) {
    assert.equal(s[k], v, `${text} ${k}`)
  }
}

// —— Cue detectors (paraphrases; not exact-string only) ——
assert.equal(looksLikeRepairCue('Non ho capito'), true)
assert.equal(looksLikeRepairCue("I don't understand"), true)
assert.equal(looksLikeRepairCue('Spiegamelo meglio'), true)
assert.equal(looksLikeRepairCue('Ciao'), false)

assert.equal(looksLikeExamplesRequest('Fammi degli esempi'), true)
assert.equal(looksLikeExamplesRequest('Give me some examples'), true)
assert.equal(looksLikeExamplesRequest('Tipo?'), true)
assert.equal(looksLikeExamplesRequest('Ciao'), false)

assert.equal(looksLikeDecisionAsk('La PR ha passato tutti i test. Faccio merge?'), true)
assert.equal(looksLikeDecisionAsk('Should I merge?'), true)
assert.equal(looksLikeDecisionAsk('È pronto?'), true)
assert.equal(looksLikeDecisionAsk('Cos\'è un audit?'), false)

assert.equal(looksLikePlayfulChallenge('Secondo te questa idea fa schifo? 😂'), true)
assert.equal(looksLikePlayfulChallenge('Is this dumb? 😂'), true)
assert.equal(looksLikePlayfulChallenge('Dimmi la verità.'), true)
assert.equal(looksLikePlayfulChallenge('Cos\'è OAuth?'), false)

assert.equal(looksLikeExplorationAsk('Dimmi qualcosa di interessante'), true)
assert.equal(looksLikeExplorationAsk("I'm bored"), true)
assert.equal(looksLikeExplorationAsk('Mi annoio'), true)

assert.equal(looksLikeSeriousCue('Sono serio.'), true)
assert.equal(looksLikeSeriousCue("I'm serious"), true)
assert.equal(looksLikeSeriousCue('AHAHAHAHA'), false)

assert.equal(looksLikeFrustratedFailure('Non funziona ancora, che palle'), true)
assert.equal(looksLikeFrustratedFailure("Still doesn't work, damn"), true)
assert.equal(looksLikeFrustratedFailure('Finalmente funziona!!!'), false)

// —— Eval matrix (State expectations) ——
assertMode('Ciao', { mode: 'casual', purpose: 'react', depth: 'short', emoji: 'moderate' })
assertMode('Come stai?', { mode: 'casual', purpose: 'react', depth: 'short' })
assertMode('Mi annoio', { mode: 'brainstorming', purpose: 'brainstorm', emoji: 'moderate' })
assertMode('Finalmente funziona!!!', {
  mode: 'celebration',
  purpose: 'react',
  tone: 'celebratory',
  emoji: 'expressive',
})
assertMode('Non funziona ancora, che palle', {
  mode: 'debugging',
  tone: 'frustrated',
  emoji: 'none',
})
assertMode('Still broken again, damn', { mode: 'debugging', tone: 'frustrated', emoji: 'none' })
assertMode("Cos'è un audit?", { mode: 'informational', purpose: 'explain' })
assertMode('Spiegami OAuth', { mode: 'teaching', purpose: 'explain' })
assertMode('Spiegami bene OAuth', { mode: 'teaching', purpose: 'explain', depth: 'detailed' })
assertMode('Non ho capito', { mode: 'teaching', purpose: 'explain', depth: 'medium' })
assertMode("I don't get it", { mode: 'teaching', purpose: 'explain' })
assertMode('Fammi degli esempi', {
  mode: 'teaching',
  purpose: 'explain',
  depth: 'medium',
})
assertMode('Give me an example', { mode: 'teaching', purpose: 'explain' })
assertMode('La PR ha passato tutti i test. Faccio merge?', {
  mode: 'decision_support',
  purpose: 'recommend',
})
assertMode('Should I merge now?', { mode: 'decision_support', purpose: 'recommend' })
assertMode('Secondo te questa idea fa schifo? 😂', {
  mode: 'casual',
  purpose: 'recommend',
  tone: 'playful',
  emoji: 'moderate',
})
assertMode('Dimmi qualcosa di interessante', {
  mode: 'brainstorming',
  purpose: 'brainstorm',
})
assertMode('Tell me something interesting', { mode: 'brainstorming', purpose: 'brainstorm' })
assertMode('Sono serio.', { mode: 'casual', tone: 'serious', emoji: 'none' })
assertMode("I'm serious.", { mode: 'casual', tone: 'serious', emoji: 'none' })

// useEmojis=false hard none even on celebration
{
  const s = computeConversationState({
    userMessage: 'Finalmente funziona!!!',
    recentMessages: [{ role: 'user', content: 'Finalmente funziona!!!' }],
    settings: { useEmojis: false, replyLength: 'balanced' },
  })
  assert.equal(s.emojiLevel, 'none')
}

// State appendix is compact — no duplicated Vuoi che P0 block
{
  const s = state('Ciao')
  const appendix = buildConversationStateAppendix(s)
  assert.ok(appendix.includes('Obey NRP'))
  assert.doesNotMatch(appendix, /Vuoi che…\?/)
  assert.ok(appendix.length < 1750)
}

// Base + NRP craft contracts
assert.match(LAIFE_BASE_SYSTEM_PROMPT, /Respond to the moment, not a template/)
assert.match(LAIFE_BASE_SYSTEM_PROMPT, /CONVERSATIONAL CRAFT/)
assert.match(LAIFE_BASE_SYSTEM_PROMPT, /Examples beat abstraction/)
assert.match(LAIFE_BASE_SYSTEM_PROMPT, /Precision outranks personality/)
assert.match(LAIFE_BASE_SYSTEM_PROMPT, /Natural warmth does not mean agreement/)

const nrp = buildNaturalResponsePolicyAppendix()
assert.ok(nrp.length >= 1200 && nrp.length <= NATURAL_RESPONSE_POLICY_MAX_CHARS, `NRP size ${nrp.length}`)
assert.match(nrp, /MOMENT \/ ANTI-TEMPLATE|Respond to the moment/)
assert.match(nrp, /EMOJI CRAFT/)
assert.match(nrp, /permission ceiling/)
assert.match(nrp, /REPAIR/)
assert.match(nrp, /EXAMPLES/)
assert.match(nrp, /behavioral authority/)
assert.match(nrp, /question_needed=false/)
assert.match(nrp, /Fammi sapere/)

// Sync + no post-processor style injection in chat path
const chat = read('api/chat.ts')
assert.doesNotMatch(chat, /appendEmoji|injectEmoji|forceQuestion|styleRewrite/)
assert.match(chat, /buildNaturalResponsePolicyAppendix/)
assert.match(chat, /computeConversationState/)

// Capability packs untouched by this change (source still exists; no Core rewrite hooks)
assert.match(read('src/lib/calendar-chat/render.js'), /./)
assert.match(read('src/lib/email-chat/render.js'), /./)
assert.match(read('src/lib/places-chat/render.js'), /./)

console.log('ok: #362B conversational intelligence')
