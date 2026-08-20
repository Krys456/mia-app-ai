/**
 * #288 Adaptive Reasoning / Response Quality contract
 * Run: node lib/server/adaptive-response-reasoning.test.mjs
 *
 * Characteristic contract + wiring tests (not brittle live wording).
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ADAPTIVE_RESPONSE_REASONING_CONTRACT,
  buildCoreAdaptiveResponseReasoningAppendix,
} from './adaptive-response-reasoning.js'
import { buildNaturalResponsePolicyAppendix } from './natural-response-policy.js'
import { buildCoreProactiveIntelligenceAppendix } from './proactive-conversation.js'
import { buildCoreConversationalUnderstandingAppendix } from './conversational-understanding.js'
import { buildCoreContinuityAppendix } from './conversation-continuity.js'
import { buildCoreLanguageAppendix } from './language-awareness.js'
import { LAIFE_BASE_SYSTEM_PROMPT } from './laife-base-system-prompt.js'
import {
  buildCoreResponsesCreateParams,
  isGpt56FamilyModel,
} from './core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const adaptive = buildCoreAdaptiveResponseReasoningAppendix()

// —— Contract identity ——
assert.equal(adaptive, ADAPTIVE_RESPONSE_REASONING_CONTRACT)
assert.ok(adaptive.startsWith('ADAPTIVE REASONING / RESPONSE QUALITY'))
assert.ok(
  adaptive.length >= 1400 && adaptive.length <= 5200,
  `adaptive size out of band: ${adaptive.length}`,
)

// —— Separation from sibling contracts ——
const nrp = buildNaturalResponsePolicyAppendix()
const proactive = buildCoreProactiveIntelligenceAppendix()
const understanding = buildCoreConversationalUnderstandingAppendix()
const continuity = buildCoreContinuityAppendix()
assert.ok(nrp.startsWith('NATURAL RESPONSE POLICY'))
assert.ok(!adaptive.includes('PROACTIVE INTELLIGENCE'))
assert.ok(!adaptive.includes('CONVERSATIONAL UNDERSTANDING'))
assert.ok(!nrp.includes('ADAPTIVE REASONING'))
assert.ok(!proactive.includes('ADAPTIVE REASONING'))
assert.ok(!understanding.includes('ADAPTIVE REASONING / RESPONSE QUALITY'))

// —— A/B Failed attempts ——
assert.ok(/Do not repeat the same failed approach unchanged/i.test(adaptive))
assert.ok(/do not casually re-suggest them/i.test(adaptive))
assert.ok(/NEW evidence makes it relevant again/i.test(adaptive))

// —— C/P Partial success ——
assert.ok(/preserve what was solved and focus on what remains unresolved/i.test(adaptive))
assert.ok(/Do not treat the whole problem as fully solved or fully failed/i.test(adaptive))

// —— D Evidence updates ——
assert.ok(/New evidence may change an earlier hypothesis/i.test(adaptive))
assert.ok(/Changing conclusions when evidence changes is correct/i.test(adaptive))
assert.ok(/ground the change in the evidence or assumption that changed/i.test(adaptive))

// —— E/F Epistemic calibration ——
assert.ok(/known from the conversation/i.test(adaptive))
assert.ok(/reasonable inference/i.test(adaptive))
assert.ok(/still unknown/i.test(adaptive))
assert.ok(/Do not present guesses as established facts/i.test(adaptive))
assert.ok(/neither fake certainty nor excessive hedging/i.test(adaptive))
// No forced visible labels
assert.ok(!/^KNOWN:/m.test(adaptive))
assert.ok(!/print.*KNOWN:|label.*KNOWN \/ INFERRED/i.test(adaptive))

// —— G/H Explanation repair ——
assert.ok(/Non ho capito/i.test(adaptive))
assert.ok(/change the explanatory representation/i.test(adaptive))
assert.ok(/do not merely paraphrase/i.test(adaptive))
assert.ok(/technical → analogy/i.test(adaptive))
assert.ok(/Continuo a non capire/i.test(adaptive))
assert.ok(/do not just make the first analogy longer/i.test(adaptive))

// —— I/J/K Response-quality ——
assert.ok(/this didn't help/i.test(adaptive))
assert.ok(/you're answering something else/i.test(adaptive))
assert.ok(/you're repeating yourself/i.test(adaptive))
assert.ok(/Avoid apology theater/i.test(adaptive))
assert.ok(/tell me what you want/i.test(adaptive))

// —— L/M Decision + rationale ——
assert.ok(/decision and its reason are both present/i.test(adaptive))
assert.ok(/keep them connected/i.test(adaptive))
assert.ok(/invalidates that reason, reassess the decision/i.test(adaptive))
assert.ok(/do not invent a replacement rationale/i.test(adaptive))

// —— N Corrections ——
assert.ok(/Latest explicit user correction or evidence outranks earlier assistant-generated claims/i.test(adaptive))
assert.ok(/Do not invent a rationale that was never present/i.test(adaptive))

// —— O Priority ——
assert.ok(/prioritize the user's unresolved blocker or explicit question/i.test(adaptive))
assert.ok(/still addressing every explicit requested part/i.test(adaptive))

// —— Q/R Completion ——
assert.ok(/recognize completion and stop diagnosing/i.test(adaptive))
assert.ok(/do not keep the old debug alive/i.test(adaptive))

// —— S Thread > Memory (authority / coexistence) ——
assert.ok(/#286 understanding of what the turn means/i.test(adaptive))

// —— T No CoT exposure ——
assert.ok(/without exposing hidden chain-of-thought/i.test(adaptive))
assert.ok(/not an internal monologue/i.test(adaptive))
assert.ok(!/print your chain of thought|show your scratchpad|step 1:.*step 2:/i.test(adaptive))

// —— U No deterministic engine ——
const chatSrc = read('api/chat.ts')
const adaptiveSrc = read('lib/server/adaptive-response-reasoning.js')
assert.ok(chatSrc.includes('buildCoreAdaptiveResponseReasoningAppendix'))
assert.ok(!/failedAttemptTracker|hypothesisEngine|attemptScore|emotionClassifier/i.test(chatSrc))
assert.ok(!/failedAttemptTracker|hypothesisEngine|attemptScore/i.test(adaptiveSrc))
assert.ok(!chatSrc.includes("from '../lib/server/adaptive-reasoning.js'"))
assert.ok(!chatSrc.includes('satisfaction-estimator'))
assert.ok(!chatSrc.includes('progressive-reasoning'))
assert.ok(!chatSrc.includes('cognitive-engine'))

// —— CONTINUITY clarification for Non ho capito ——
assert.ok(/change.*representation|change representation/i.test(continuity))
assert.ok(/Non ho capito/i.test(continuity))
assert.ok(/do not merely rephrase/i.test(continuity))

// —— Instruction order ——
const nrpCall = chatSrc.indexOf('const naturalResponsePolicyAppendix = buildNaturalResponsePolicyAppendix')
const langCall = chatSrc.indexOf('const languageAppendix = buildCoreLanguageAppendix')
const contCall = chatSrc.indexOf('const continuityAppendix = buildCoreContinuityAppendix')
const undCall = chatSrc.indexOf('const understandingAppendix = buildCoreConversationalUnderstandingAppendix')
const arCall = chatSrc.indexOf('const adaptiveReasoningAppendix = buildCoreAdaptiveResponseReasoningAppendix')
const refCall = chatSrc.indexOf('const referenceContextAppendix = buildReferenceContextAppendix')
const wsCall = chatSrc.indexOf('const workingStateAppendix = buildConversationWorkingStateAppendix')
const proCall = chatSrc.indexOf('const proactiveAppendix = buildCoreProactiveIntelligenceAppendix')
assert.ok(nrpCall > 0 && langCall > nrpCall, 'NRP before LANGUAGE')
assert.ok(contCall > langCall, 'LANGUAGE before CONTINUITY')
assert.ok(undCall > contCall, 'UNDERSTANDING after CONTINUITY')
assert.ok(arCall > undCall, 'ADAPTIVE REASONING after UNDERSTANDING')
assert.ok(refCall > arCall, 'ADAPTIVE REASONING before Reference')
assert.ok(wsCall > refCall, 'Reference before Working State')
assert.ok(!chatSrc.includes('buildCoreProactiveIntelligenceAppendix'))
assert.ok(!chatSrc.includes('buildCoreExpressionAppendix'))

const lang = buildCoreLanguageAppendix({
  userMessage: 'Il deploy fallisce ancora.',
  messages: [{ role: 'user', content: 'Il deploy fallisce ancora.' }],
  browserLocale: 'it-IT',
})
const stacked = [
  LAIFE_BASE_SYSTEM_PROMPT,
  nrp,
  lang,
  continuity,
  understanding,
  adaptive,
  'TEMPORARY REFERENCE CONTEXT\nexample',
  'CONVERSATION WORKING STATE\nCurrent task: example',
  proactive,
].join('\n\n')
assert.ok(stacked.indexOf('NATURAL RESPONSE POLICY') < stacked.indexOf('LANGUAGE'))
assert.ok(stacked.indexOf('CONVERSATION CONTINUITY') < stacked.indexOf('CONVERSATIONAL UNDERSTANDING'))
assert.ok(
  stacked.indexOf('CONVERSATIONAL UNDERSTANDING') <
    stacked.indexOf('ADAPTIVE REASONING / RESPONSE QUALITY'),
)
assert.ok(
  stacked.indexOf('ADAPTIVE REASONING / RESPONSE QUALITY') <
    stacked.indexOf('TEMPORARY REFERENCE CONTEXT'),
)
// Proactive no longer in live stack; reference module may still appear in offline stacked fixture
assert.ok(stacked.includes('PROACTIVE INTELLIGENCE'))

// —— Core invariants ——
const awaitCreates = [...chatSrc.matchAll(/await\s+client\.responses\.create/g)]
assert.ok(awaitCreates.length >= 1 && awaitCreates.length <= 2)
assert.ok(/maxDuration:\s*120/.test(chatSrc))
const paramsSrc = read('lib/server/core-responses-params.js')
assert.ok(/stream:\s*false/.test(paramsSrc))
assert.ok(isGpt56FamilyModel('gpt-5.6-sol'))
const gpt56 = buildCoreResponsesCreateParams({
  model: 'gpt-5.6-sol',
  instructions: 'x',
  maxOutputTokens: 4096,
  input: [],
})
assert.equal(gpt56.stream, false)
assert.deepEqual(gpt56.reasoning, { effort: 'none' })

// —— #284–#287 modules still present ——
assert.ok(read('lib/server/natural-response-policy.js').includes('NATURAL RESPONSE POLICY'))
assert.ok(read('lib/server/proactive-conversation.js').includes('PROACTIVE INTELLIGENCE'))
assert.ok(read('lib/server/conversational-understanding.js').includes('CONVERSATIONAL UNDERSTANDING'))
assert.ok(read('lib/server/language-awareness.js').includes('LANGUAGE'))
assert.ok(chatSrc.includes('buildNaturalResponsePolicyAppendix'))
assert.ok(!chatSrc.includes('buildCoreExpressionAppendix'))
assert.ok(!chatSrc.includes('buildCoreProactiveIntelligenceAppendix'))
assert.ok(chatSrc.includes('buildCoreConversationalUnderstandingAppendix'))
assert.ok(chatSrc.includes('buildCoreLanguageAppendix'))

// —— No dependency / migration noise ——
const pkg = read('package.json')
assert.doesNotMatch(pkg, /"franc"|language-detector|hypothesis-engine/)

console.log('adaptive-response-reasoning.test.mjs: PASS')
