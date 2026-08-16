/**
 * #263 Conversation Continuity contract
 * Run: node lib/server/conversation-continuity.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONVERSATION_CONTINUITY_CONTRACT,
  buildCoreContinuityAppendix,
} from './conversation-continuity.js'
import { buildCoreLanguageAppendix } from './language-awareness.js'
import { LAIFE_BASE_SYSTEM_PROMPT } from './laife-base-system-prompt.js'
import {
  buildCoreResponsesCreateParams,
  isGpt56FamilyModel,
} from './core-responses-params.js'
import { durableMemoryProvenanceRules } from './core-memory-recall.js'

const continuity = buildCoreContinuityAppendix()

assert.equal(continuity, CONVERSATION_CONTINUITY_CONTRACT)
assert.ok(continuity.startsWith('CONVERSATION CONTINUITY'))

// Size budget — compact high-authority contract, not a cognitive mesh.
// Target ~1.2–1.8k; hard cap 2.2k to keep invariants without a cognitive mesh.
assert.ok(
  continuity.length >= 900 && continuity.length <= 2200,
  `continuity size out of band: ${continuity.length}`,
)

// —— Required invariants ——
assert.ok(continuity.includes('CURRENT THREAD REFERENT > DURABLE MEMORY BACKGROUND'))
assert.ok(continuity.includes('Short replies'))
assert.ok(continuity.includes('il primo/il secondo') || continuity.includes('il secondo'))
assert.ok(continuity.includes('Repair'))
assert.ok(continuity.includes('overrides static style/length preferences'))
assert.ok(continuity.includes('Anti-fabrication'))
assert.ok(continuity.includes('do not fake continuity'))
assert.ok(continuity.includes('language switch does not reset conversational context'))
assert.ok(continuity.includes('Vuoi che'))
assert.ok(continuity.includes('Initiative must not override'))

// —— TEST A: thread referent priority wording ——
assert.ok(continuity.includes('CURRENT THREAD'))
assert.ok(/renderla|Referents|thread referent/i.test(continuity))

// —— TEST B: ordinal / short-reply support ——
assert.ok(/il secondo|the second one/i.test(continuity))
assert.ok(/continua|ok,/i.test(continuity))

// —— TEST C: depth/style NL override ——
assert.ok(continuity.includes('Breve.'))
assert.ok(continuity.includes('Approfondisci.'))
assert.ok(continuity.includes('THIS response only'))

// —— TEST D: memory vs thread (Naruto/Dragon Ball example) ——
assert.ok(continuity.includes('Dragon Ball'))
assert.ok(continuity.includes('Naruto'))
assert.ok(continuity.includes('Why do I like it?'))

// —— TEST E: anti-fabrication ——
assert.ok(continuity.includes('come dicevi prima') || continuity.includes('continua'))
assert.ok(continuity.includes('do not have enough thread context'))

// —— TEST F: LANGUAGE + CONTINUITY coexist ——
const lang = buildCoreLanguageAppendix({
  userMessage: 'How could I improve it?',
  messages: [
    { role: 'user', content: 'Sto creando LAIfe.' },
    { role: 'assistant', content: 'Interessante.' },
    { role: 'user', content: 'How could I improve it?' },
  ],
})
assert.ok(lang.includes('response language: en'))
assert.ok(continuity.includes('language switch does not reset conversational context'))
const stacked = [LAIFE_BASE_SYSTEM_PROMPT, lang, continuity].join('\n\n')
assert.ok(stacked.indexOf('LANGUAGE') < stacked.indexOf('CONVERSATION CONTINUITY'))
assert.ok(stacked.includes('response language: en'))
assert.ok(stacked.includes('CURRENT THREAD REFERENT'))

// —— TEST G: no mandatory follow-up ——
assert.ok(continuity.includes('answer directly'))
assert.ok(continuity.includes('Se vuoi posso'))

// Must not pull in banned legacy mesh
for (const banned of [
  'runCognitiveEngine',
  'reference-resolution',
  'cognitive-coordinator',
  'Zeigarnik',
  'CONVERSATIONAL INITIATIVE',
]) {
  assert.ok(!continuity.includes(banned), `banned: ${banned}`)
}

// Continuity is separate from base + memory provenance
assert.ok(!LAIFE_BASE_SYSTEM_PROMPT.includes('CURRENT THREAD REFERENT > DURABLE MEMORY'))
assert.ok(!durableMemoryProvenanceRules().includes('CURRENT THREAD REFERENT > DURABLE MEMORY'))

// Core architecture unchanged
assert.ok(isGpt56FamilyModel('gpt-5.6-sol'))
const params = buildCoreResponsesCreateParams({
  model: 'gpt-5.6-sol',
  instructions: stacked,
  maxOutputTokens: 4096,
  input: [{ type: 'message', role: 'user', content: 'hi' }],
})
assert.equal(params.reasoning?.effort, 'none')
assert.ok(!('temperature' in params))
assert.equal(params.stream, false)

// api/chat wiring: continuity after language; no resolver / cognitive imports
const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
assert.ok(chatSrc.includes('buildCoreContinuityAppendix'))
assert.ok(chatSrc.includes('buildCoreLanguageAppendix'))
assert.ok(!/runCognitiveEngine|reference-resolution|cognitive-coordinator|conversation-runtime/.test(chatSrc))
assert.ok(chatSrc.includes('selectCoreConversationHistory') || chatSrc.includes('sanitizeMultimodalMessages'), 'history via sanitize + selector')
assert.ok(!chatSrc.includes('slice(-40)'), 'legacy hard 40-message window removed from Core path')
const histSrc = readFileSync(join(root, 'lib/server/chat-image-input.js'), 'utf8')
assert.ok(histSrc.includes('selectCoreConversationHistory'))
assert.ok(!histSrc.includes('slice(-40)'))
const selectSrc = readFileSync(join(root, 'lib/server/core-history-select.js'), 'utf8')
assert.ok(selectSrc.includes('MAX_HISTORY_MESSAGES = 80'))
assert.ok(selectSrc.includes('MAX_HISTORY_TEXT_CHARS = 120_000'))
assert.ok(selectSrc.includes('No summarization'))
assert.ok(!selectSrc.includes('responses.create'))
assert.ok(!/generateRollingSummary|conversationMemoryMap/.test(selectSrc))

// Ordering in buildInstructions: language appendix then continuity appendix
const langCallIdx = chatSrc.indexOf('const languageAppendix = buildCoreLanguageAppendix')
const contCallIdx = chatSrc.indexOf('const continuityAppendix = buildCoreContinuityAppendix')
assert.ok(langCallIdx > 0 && contCallIdx > langCallIdx)

console.log('ok: #263 conversation continuity contract (%d chars)', continuity.length)
console.log('ok: stacked base+lang+continuity (%d chars)', stacked.length)
