/**
 * Smoke test for the new LAIfe conversational core (single-prompt /api/chat).
 * Run: node --experimental-strip-types api/chat.core.test.mjs
 * (or: node --import tsx … if preferred — here we exercise the prompt export + helpers via dynamic import of built pieces)
 */

import assert from 'node:assert/strict'
import { LAIFE_BASE_SYSTEM_PROMPT } from '../lib/server/laife-base-system-prompt.js'

assert.ok(typeof LAIFE_BASE_SYSTEM_PROMPT === 'string')
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('Sei LAIfe'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes("REGOLA D'ORO") || LAIFE_BASE_SYSTEM_PROMPT.includes('REGOLA D’ORO'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('CONVERSATIONAL INITIATIVE'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('Questions are tools'))
assert.ok(!LAIFE_BASE_SYSTEM_PROMPT.includes('Core Constitution'))
assert.ok(!LAIFE_BASE_SYSTEM_PROMPT.includes('runCognitiveEngine'))
assert.ok(LAIFE_BASE_SYSTEM_PROMPT.length < 8000, 'prompt should stay short')

console.log('ok: unified companion prompt present (%d chars)', LAIFE_BASE_SYSTEM_PROMPT.length)
