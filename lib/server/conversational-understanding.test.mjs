/**
 * #286 Conversational Understanding contract
 * Run: node lib/server/conversational-understanding.test.mjs
 *
 * Characteristic / contract tests for S1–S7 enablement.
 * Avoid brittle exact-output wording asserts.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONVERSATIONAL_UNDERSTANDING_CONTRACT,
  buildCoreConversationalUnderstandingAppendix,
} from './conversational-understanding.js'
import { buildNaturalResponsePolicyAppendix } from './natural-response-policy.js'
import { buildCoreProactiveIntelligenceAppendix } from './proactive-conversation.js'
import { buildCoreContinuityAppendix } from './conversation-continuity.js'
import { buildCoreLanguageAppendix } from './language-awareness.js'
import { LAIFE_BASE_SYSTEM_PROMPT } from './laife-base-system-prompt.js'
import {
  buildCoreResponsesCreateParams,
  isGpt56FamilyModel,
} from './core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const understanding = buildCoreConversationalUnderstandingAppendix()

// —— Contract presence ——
assert.equal(understanding, CONVERSATIONAL_UNDERSTANDING_CONTRACT)
assert.ok(understanding.startsWith('CONVERSATIONAL UNDERSTANDING'))
assert.ok(
  understanding.length >= 1100 && understanding.length <= 4200,
  `understanding size out of band: ${understanding.length}`,
)

// Separate from #284 / #285 / CONTINUITY names
assert.ok(!understanding.includes('ADAPTIVE EXPRESSION'))
assert.ok(!understanding.includes('PROACTIVE INTELLIGENCE'))
assert.ok(!understanding.startsWith('CONVERSATION CONTINUITY'))
assert.ok(!understanding.includes('CONVERSATIONAL INITIATIVE'))

const nrp = buildNaturalResponsePolicyAppendix()
const proactive = buildCoreProactiveIntelligenceAppendix()
const continuity = buildCoreContinuityAppendix()
assert.ok(nrp.startsWith('NATURAL RESPONSE POLICY'))
assert.ok(proactive.startsWith('PROACTIVE INTELLIGENCE'))
assert.ok(continuity.startsWith('CONVERSATION CONTINUITY'))
assert.ok(!nrp.includes('CONVERSATIONAL UNDERSTANDING'))
assert.ok(!proactive.includes('CONVERSATIONAL UNDERSTANDING'))

// —— S5 multi-part completeness ——
assert.ok(/address every part/i.test(understanding))
assert.ok(/Do not silently drop a part/i.test(understanding))
assert.ok(/due cose|tre cose|a\/b\/c/i.test(understanding))

// —— S4 ambiguity: dual vs recoverable ——
assert.ok(/uniquely recoverable/i.test(understanding))
assert.ok(/two or more materially plausible referents/i.test(understanding))
assert.ok(/ask one concise clarification instead of guessing/i.test(understanding))
assert.ok(/Do not over-clarify harmless ambiguity/i.test(understanding))

// —— S1 distant recoverable ——
assert.ok(/after unrelated digressions/i.test(understanding))
assert.ok(/unique thread recovery/i.test(understanding))

// —— S2 intention / preference reversal ——
assert.ok(/latest explicit reversal wins/i.test(understanding))
assert.ok(/distinct from durable Memory correction/i.test(understanding))

// —— S3 stacked corrections ——
assert.ok(/latest correction wins/i.test(understanding))
assert.ok(/Discard intermediate wrong fixes/i.test(understanding))

// —— S6 self-justification ——
assert.ok(/prior assistant turn/i.test(understanding))
assert.ok(/Do not invent a different rationale/i.test(understanding))

// —— S7 thread vs Memory ——
assert.ok(/outrank conflicting durable Memory/i.test(understanding))
assert.ok(/Memory says X and the immediate conversation strongly implies not-X/i.test(understanding))

// —— No LANGUAGE mutation in this PR ——
assert.ok(/do not change detection or sticky language rules/i.test(understanding))
const langSrc = read('lib/server/language-awareness.js')
const understandingFile = read('lib/server/conversational-understanding.js')
assert.ok(!understandingFile.includes('FR_MARKERS'))
assert.ok(langSrc.includes('FR_MARKERS')) // LANGUAGE file untouched conceptually still present

// —— No deterministic classifier machinery ——
const chatSrc = read('api/chat.ts')
assert.ok(chatSrc.includes('buildCoreConversationalUnderstandingAppendix'))
assert.ok(!/referentClassifier|intentClassifier|understandingScore|resolveReferent\(/i.test(chatSrc))
assert.ok(!/referentClassifier|intentClassifier|understandingScore/i.test(understanding))

// —— Instruction order ——
const nrpCall = chatSrc.indexOf('const naturalResponsePolicyAppendix = buildNaturalResponsePolicyAppendix')
const langCall = chatSrc.indexOf('const languageAppendix = buildCoreLanguageAppendix')
const contCall = chatSrc.indexOf('const continuityAppendix = buildCoreContinuityAppendix')
const undCall = chatSrc.indexOf('const understandingAppendix = buildCoreConversationalUnderstandingAppendix')
const refCall = chatSrc.indexOf('const referenceContextAppendix = buildReferenceContextAppendix')
const wsCall = chatSrc.indexOf('const workingStateAppendix = buildConversationWorkingStateAppendix')
assert.ok(nrpCall > 0 && langCall > nrpCall, 'NRP before LANGUAGE')
assert.ok(contCall > langCall)
assert.ok(undCall > contCall, 'UNDERSTANDING after CONTINUITY')
const arCall = chatSrc.indexOf('const adaptiveReasoningAppendix = buildCoreAdaptiveResponseReasoningAppendix')
assert.ok(arCall > undCall, 'ADAPTIVE REASONING after UNDERSTANDING')
assert.ok(refCall > arCall, 'ADAPTIVE REASONING before Reference')
assert.ok(wsCall > refCall)
assert.ok(!chatSrc.includes('buildCoreProactiveIntelligenceAppendix'))
assert.ok(!chatSrc.includes('buildCoreExpressionAppendix'))

const lang = buildCoreLanguageAppendix({
  userMessage: 'Che faccio per lui?',
  messages: [{ role: 'user', content: 'Che faccio per lui?' }],
  browserLocale: 'it-IT',
})
const stacked = [
  LAIFE_BASE_SYSTEM_PROMPT,
  nrp,
  lang,
  continuity,
  understanding,
  'TEMPORARY REFERENCE CONTEXT',
  'CONVERSATION WORKING STATE',
  proactive,
].join('\n\n')
assert.ok(stacked.indexOf('CONVERSATION CONTINUITY') < stacked.indexOf('CONVERSATIONAL UNDERSTANDING'))
assert.ok(stacked.indexOf('CONVERSATIONAL UNDERSTANDING') < stacked.indexOf('TEMPORARY REFERENCE CONTEXT'))
assert.ok(stacked.indexOf('CONVERSATION WORKING STATE') < stacked.indexOf('PROACTIVE INTELLIGENCE'))

// —— Core invariants ——
const awaitCreates = [...chatSrc.matchAll(/await\s+client\.responses\.create/g)]
assert.ok(awaitCreates.length >= 1 && awaitCreates.length <= 2)
assert.ok(/maxDuration:\s*120/.test(chatSrc))
assert.ok(isGpt56FamilyModel('gpt-5.6-sol'))
const gpt56 = buildCoreResponsesCreateParams({
  model: 'gpt-5.6-sol',
  instructions: 'x',
  maxOutputTokens: 4096,
  input: [],
})
assert.equal(gpt56.stream, false)
assert.deepEqual(gpt56.reasoning, { effort: 'none' })

// Recall limits untouched
const recallSrc = read('lib/server/core-memory-recall.js')
assert.ok(/RECALL_MAX_MEMORIES = 3/.test(recallSrc))
assert.ok(/RECALL_MAX_PACK_CHARS = 600/.test(recallSrc))

// History / WS / Reference modules not rewritten by this PR (presence only)
assert.ok(read('lib/server/core-history-select.js').includes('MAX_HISTORY_MESSAGES = 80'))
assert.ok(read('lib/server/core-working-state.js').includes('WORKING_STATE_VERSION'))
assert.ok(read('lib/server/core-reference-context.js').includes('REFERENCE_CONTEXT_VERSION'))

// language-awareness.js must not be modified in this branch for #286
// (content still has FR_MARKERS; no understanding import)
assert.ok(!langSrc.includes('conversational-understanding'))
assert.ok(!langSrc.includes('CONVERSATIONAL UNDERSTANDING'))

console.log('conversational-understanding.test.mjs: PASS')
