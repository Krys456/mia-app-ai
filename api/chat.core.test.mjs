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

console.log('ok: compact V2 companion prompt present (%d chars)', LAIFE_BASE_SYSTEM_PROMPT.length)
