/**
 * #284 Adaptive Expression contract — retained as reference module.
 * #325: Expression is NO LONGER injected into Core (merged into Natural Response Policy).
 * Run: node lib/server/conversation-expression.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ADAPTIVE_EXPRESSION_CONTRACT,
  buildCoreExpressionAppendix,
} from './conversation-expression.js'
import { buildNaturalResponsePolicyAppendix } from './natural-response-policy.js'
import {
  buildCoreResponsesCreateParams,
  isGpt56FamilyModel,
} from './core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const chatSrc = read('api/chat.ts')

const expression = buildCoreExpressionAppendix()

// Contract file still exists for reference / migration history
assert.equal(expression, ADAPTIVE_EXPRESSION_CONTRACT)
assert.ok(expression.startsWith('ADAPTIVE EXPRESSION'))

// #325 — not injected into live Core
assert.ok(!chatSrc.includes('buildCoreExpressionAppendix'))
assert.ok(chatSrc.includes('buildNaturalResponsePolicyAppendix'))
const nrp = buildNaturalResponsePolicyAppendix()
assert.ok(nrp.startsWith('NATURAL RESPONSE POLICY'))
assert.ok(/question_needed=false/i.test(nrp))
assert.ok(/emoji/i.test(nrp))

const stateCall = chatSrc.indexOf('const conversationStateAppendix = buildConversationStateAppendix')
const nrpCall = chatSrc.indexOf('const naturalResponsePolicyAppendix = buildNaturalResponsePolicyAppendix')
const langCall = chatSrc.indexOf('const languageAppendix = buildCoreLanguageAppendix')
assert.ok(stateCall > 0 && nrpCall > stateCall, 'State before NRP')
assert.ok(langCall > nrpCall, 'NRP before LANGUAGE')

assert.ok((chatSrc.match(/responses\.create/g) || []).length >= 1)
const awaitCreateCalls = [...chatSrc.matchAll(/await\s+client\.responses\.create/g)]
assert.ok(awaitCreateCalls.length >= 1 && awaitCreateCalls.length <= 2)
assert.ok(!/runCognitiveEngine/.test(chatSrc))
assert.ok(chatSrc.includes('computeConversationState'))
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
assert.equal(gpt56.reasoning?.effort, 'none')

console.log('conversation-expression.test.mjs: PASS (reference retained; not injected)')
