/**
 * Smoke test for the new LAIfe conversational core (single-prompt /api/chat).
 * Run: node api/chat.core.test.mjs
 */

import assert from 'node:assert/strict'
import { LAIFE_BASE_SYSTEM_PROMPT } from '../lib/server/laife-base-system-prompt.js'

assert.ok(typeof LAIFE_BASE_SYSTEM_PROMPT === 'string')
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('Sei LAIfe'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.startsWith('IDENTITY'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('CONVERSATION'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('ADAPTATION'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('COMPANION'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('BOUNDARIES'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('non un intervistatore'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('Una risposta che finisce senza domanda è normale'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('Prefer specificity over generic helpfulness'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('Contribuire non significa coaching automatico'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('Ack corti'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('auto-status'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('la lunghezza segue la sostanza'))
assert.ok(!LAIFE_BASE_SYSTEM_PROMPT.includes('IMPORTANT DISTINCTION'))
assert.ok(!LAIFE_BASE_SYSTEM_PROMPT.includes('SHARE ≠ REQUEST'))

// Old overlapping policy layers must be fully removed.
for (const banned of [
  'CONVERSATIONAL INITIATIVE',
  "CALIBRAZIONE DELL'INIZIATIVA",
  'DOPO UN RIFIUTO RIPETUTO',
  'CONVERSATIONAL RESTRAINT',
  'DEPTH & CONTRIBUTION',
  'IMPORTANT DISTINCTION',
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

assert.ok(LAIFE_BASE_SYSTEM_PROMPT.length < 4000, 'compact V2 prompt should stay short')

// #262 language contract lives in ephemeral appendix, not the Italian-authored base prompt.
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

console.log('ok: compact V2 companion prompt present (%d chars)', LAIFE_BASE_SYSTEM_PROMPT.length)
console.log('ok: #262 language appendix wired (%d chars)', langAppendix.length)
console.log('ok: #263 continuity appendix wired (%d chars)', continuityAppendix.length)
