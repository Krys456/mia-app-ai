/**
 * #329 — Personality 2.0 MVP
 * Run: node lib/server/personality-329.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LAIFE_BASE_SYSTEM_PROMPT,
  PERSONALITY_2_BUILD,
  SHINKAIDO_BASE_SYSTEM_PROMPT,
} from './laife-base-system-prompt.js'
import { buildNaturalResponsePolicyAppendix } from './natural-response-policy.js'
import { computeConversationState } from './conversation-state.js'
import { buildCoreLanguageAppendix } from './language-awareness.js'
import { buildCoreContinuityAppendix } from './conversation-continuity.js'
import { buildCoreConversationalUnderstandingAppendix } from './conversational-understanding.js'
import { buildCoreAdaptiveResponseReasoningAppendix } from './adaptive-response-reasoning.js'
import { buildConversationStateAppendix } from './conversation-state.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

assert.equal(PERSONALITY_2_BUILD, '362b-1')
assert.equal(SHINKAIDO_BASE_SYSTEM_PROMPT, LAIFE_BASE_SYSTEM_PROMPT)

const base = LAIFE_BASE_SYSTEM_PROMPT
assert.ok(base.includes('ShinkAIdo'))
assert.ok(base.includes('The Way to Your True Self'))
assert.ok(!/Sei LAIfe/i.test(base))
assert.ok(!/Your AI, Your Life/i.test(base))
assert.ok(!/\bLAIfe\b/.test(base), 'Base must not identify as LAIfe')

// Structure
for (const section of ['IDENTITY', 'PERSONALITY', 'TRUTH & JUDGMENT', 'COMPANIONSHIP', 'BOUNDARIES']) {
  assert.ok(base.includes(section), `missing section ${section}`)
}

// Stable invariants
for (const needle of [
  'honest',
  'independent-minded',
  'specific',
  'direct',
  'curious',
  'grounded',
  'Do not automatically agree or praise',
  'choose clearly',
  'Disagree',
  'do not re-classify',
  'personalityBias',
  'Never invent biological emotions',
  'Never imply external actions',
  'Precedence:',
  'take initiative',
]) {
  assert.ok(base.includes(needle) || new RegExp(needle, 'i').test(base), `missing invariant: ${needle}`)
}

// No duplicated style taxonomy / State fields as Base policy
for (const banned of [
  'emojiLevel',
  'questionNeeded',
  'initiativeLevel',
  'emotionalTone=',
  'desiredDepth',
  'acknowledgement=',
  'humorLevel',
  'personalityState',
  'friendshipLevel',
  'bondLevel',
  'relationshipDepth',
]) {
  assert.ok(!base.includes(banned), `style/schema leak in Base: ${banned}`)
}

// Size band
assert.ok(base.length >= 1800 && base.length <= 4800, `Base size out of band: ${base.length}`)

// Sync: src ↔ server
const personalityTs = read('src/lib/personality.ts')
assert.ok(personalityTs.includes('PERSONALITY_2_BUILD'))
assert.ok(personalityTs.includes('You are ShinkAIdo'))
assert.ok(!/Sei LAIfe/i.test(personalityTs.split('export function buildSystemPrompt')[0]))

// One-model-call architecture unchanged (primary path + optional Vision×Search soft-fail retry)
const chatSrc = read('api/chat.ts')
assert.ok(/await client\.responses\.create\(/.test(chatSrc))
assert.ok(!/runCognitiveEngine/.test(chatSrc))
assert.ok(!/personality-consistency-engine/.test(chatSrc))
assert.ok(!/natural-conversation-engine/.test(chatSrc))
assert.ok(chatSrc.includes('still ShinkAIdo') || chatSrc.includes('modifier only'))
assert.ok(
  !/second LLM|extra model call|personality engine/i.test(chatSrc.split('buildInstructions')[1]?.slice(0, 2000) || ''),
)

// Prompt ordering: Base first, then State, STYLE_AVOID, NRP — unchanged
const stateCall = chatSrc.indexOf('const conversationStateAppendix = buildConversationStateAppendix')
const styleCall = chatSrc.indexOf('const styleAvoidAppendix = buildStyleAvoidAppendix')
const nrpCall = chatSrc.indexOf('const naturalResponsePolicyAppendix = buildNaturalResponsePolicyAppendix')
const langCall = chatSrc.indexOf('const languageAppendix = buildCoreLanguageAppendix')
const contCall = chatSrc.indexOf('const continuityAppendix = buildCoreContinuityAppendix')
assert.ok(stateCall > 0 && styleCall > stateCall && nrpCall > styleCall)
assert.ok(langCall > nrpCall && contCall > langCall)

// No new Conversation State schema fields
const stateSrc = read('lib/server/conversation-state.js')
for (const banned of ['humorLevel', 'personalityState', 'friendshipLevel', 'bondLevel', 'relationshipDepth']) {
  assert.ok(!stateSrc.includes(banned), `new schema field: ${banned}`)
}

// Capability modules do not import personality / Base prompt code
for (const cap of [
  'lib/server/phone-action-capability-appendix.js',
  'lib/server/translation-engine.js',
  'lib/server/document-chat-intent.js',
  'lib/server/vision-search-intent.js',
  'lib/server/web-search.js',
  'lib/server/weather/index.js',
  'lib/server/daily-briefing/orchestrate.js',
]) {
  const src = read(cap)
  assert.ok(
    !/PERSONALITY_2_BUILD|SHINKAIDO_BASE_SYSTEM_PROMPT|LAIFE_BASE_SYSTEM_PROMPT/.test(src),
    `capability imports personality Base: ${cap}`,
  )
}

// Memory semantics unchanged (no personality state → Memory)
assert.ok(!/store personality state as user Memory|personality.*Memory\.save/i.test(chatSrc))
assert.ok(/Current thread beats Memory/i.test(base))

// NRP: no Personality section; optional boundary stays out of NRP for #329 (boundary in Base)
const nrp = buildNaturalResponsePolicyAppendix()
assert.ok(!/^PERSONALITY\b/m.test(nrp))
assert.ok(!/humorLevel/.test(nrp))

// Always-on budget: near-neutral vs main Baseline (~16006 measured with same stack)
function alwaysOn(basePrompt) {
  const msgs = [{ role: 'user', content: 'Ciao' }]
  const state = computeConversationState({ userMessage: 'Ciao', recentMessages: msgs })
  return [
    basePrompt,
    buildConversationStateAppendix(state),
    nrp,
    buildCoreLanguageAppendix({ userMessage: 'Ciao', messages: msgs, browserLocale: 'it-IT' }),
    buildCoreContinuityAppendix(),
    buildCoreConversationalUnderstandingAppendix(),
    buildCoreAdaptiveResponseReasoningAppendix(),
  ]
    .filter(Boolean)
    .join('\n\n').length
}
const always = alwaysOn(base)
assert.ok(always <= 20000, `always-on stack grew too much: ${always}`)
assert.ok(always >= 15000, `always-on unexpectedly small: ${always}`)

console.log('personality-329.test.mjs: PASS')
console.log(
  JSON.stringify({
    baseChars: base.length,
    baseTokApprox: Math.round(base.length / 4),
    alwaysOnChars: always,
    alwaysOnTokApprox: Math.round(always / 4),
  }),
)
