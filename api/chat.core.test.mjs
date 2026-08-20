/**
 * Smoke test for the ShinkAIdo conversational core (single-prompt /api/chat).
 * Personality 2.0 (#329) — Base identity + invariants.
 * Run: node api/chat.core.test.mjs
 */

import assert from 'node:assert/strict'
import { LAIFE_BASE_SYSTEM_PROMPT, PERSONALITY_2_BUILD } from '../lib/server/laife-base-system-prompt.js'

assert.ok(typeof LAIFE_BASE_SYSTEM_PROMPT === 'string')
assert.equal(PERSONALITY_2_BUILD, '329-1')
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('ShinkAIdo'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('The Way to Your True Self'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.startsWith('IDENTITY'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('PERSONALITY'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('TRUTH & JUDGMENT'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('COMPANIONSHIP'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('BOUNDARIES'))

assert.ok(!/Sei LAIfe/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(!/Your AI, Your Life/i.test(LAIFE_BASE_SYSTEM_PROMPT))

assert.ok(/honest|independent-minded|specific|direct|curious|grounded/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(/Do not automatically agree or praise/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(/choose clearly/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(/do not re-classify/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(/Never imply external actions/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(/personalityBias/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(/Precedence:/i.test(LAIFE_BASE_SYSTEM_PROMPT))

// No duplicated turn-level style taxonomy in Base
for (const banned of [
  'emojiLevel',
  'questionNeeded',
  'initiativeLevel',
  'desiredDepth',
  'acknowledgement=',
  'STYLE_AVOID taxonomy',
  'answerLength',
  'ADAPTATION',
  'IMPORTANT DISTINCTION',
  'SHARE ≠ REQUEST',
]) {
  assert.ok(!LAIFE_BASE_SYSTEM_PROMPT.includes(banned), `style/legacy still present: ${banned}`)
}

for (const banned of [
  'CONVERSATIONAL INITIATIVE',
  "CALIBRAZIONE DELL'INIZIATIVA",
  'DOPO UN RIFIUTO RIPETUTO',
  'CONVERSATIONAL RESTRAINT',
  'DEPTH & CONTRIBUTION',
  'Questions are tools',
  'one central intelligence',
  'Zeigarnik',
  'Core Constitution',
  'runCognitiveEngine',
  "REGOLA D'ORO",
  'CHI SEI',
  'COME PARLI',
]) {
  assert.ok(!LAIFE_BASE_SYSTEM_PROMPT.includes(banned), `old section still present: ${banned}`)
}

assert.ok(LAIFE_BASE_SYSTEM_PROMPT.length <= 2400, `Base too large: ${LAIFE_BASE_SYSTEM_PROMPT.length}`)
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.length >= 1800, `Base too small: ${LAIFE_BASE_SYSTEM_PROMPT.length}`)

// #262 language contract lives in ephemeral appendix, not the base prompt.
import {
  LANGUAGE_CONTRACT,
  buildCoreLanguageAppendix,
} from '../lib/server/language-awareness.js'
assert.ok(LANGUAGE_CONTRACT.includes("Respond in the language of the user's latest"))
assert.ok(!LAIFE_BASE_SYSTEM_PROMPT.includes('response language:'))
const langAppendix = buildCoreLanguageAppendix({
  userMessage: 'How are you?',
  messages: [{ role: 'user', content: 'How are you?' }],
})
assert.ok(langAppendix.includes('response language: en'))
assert.ok(langAppendix.includes('overrides base-prompt language inertia'))

// #263 continuity appendix — after language, separate from base.
import {
  CONVERSATION_CONTINUITY_CONTRACT,
  buildCoreContinuityAppendix,
} from '../lib/server/conversation-continuity.js'
const continuityAppendix = buildCoreContinuityAppendix()
assert.equal(continuityAppendix, CONVERSATION_CONTINUITY_CONTRACT)
assert.ok(continuityAppendix.includes('CURRENT THREAD REFERENT > DURABLE MEMORY BACKGROUND'))
assert.ok(!LAIFE_BASE_SYSTEM_PROMPT.includes('CURRENT THREAD REFERENT > DURABLE MEMORY'))

console.log('ok: Personality 2.0 Base present (%d chars)', LAIFE_BASE_SYSTEM_PROMPT.length)
console.log('ok: #262 language appendix wired (%d chars)', langAppendix.length)
console.log('ok: #263 continuity appendix wired (%d chars)', continuityAppendix.length)
