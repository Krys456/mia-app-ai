/**
 * #284 Adaptive Expression contract
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
import { buildCoreContinuityAppendix } from './conversation-continuity.js'
import { buildCoreLanguageAppendix } from './language-awareness.js'
import { LAIFE_BASE_SYSTEM_PROMPT } from './laife-base-system-prompt.js'
import {
  buildCoreResponsesCreateParams,
  isGpt56FamilyModel,
} from './core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const expression = buildCoreExpressionAppendix()

// —— A: contract present ——
assert.equal(expression, ADAPTIVE_EXPRESSION_CONTRACT)
assert.ok(expression.startsWith('ADAPTIVE EXPRESSION'))
assert.ok(
  expression.length >= 900 && expression.length <= 3200,
  `expression size out of band: ${expression.length}`,
)

// —— B: does NOT say always use emojis ——
assert.ok(!/\balways\s+use\s+emoji/i.test(expression))
assert.ok(!/\buse\s+emoji\s+in\s+every/i.test(expression))
assert.ok(/not requirements|not obligations/i.test(expression))

// —— C: does NOT say always use CAPS ——
assert.ok(!/\balways\s+(?:use\s+)?(?:ALL\s+)?CAPS/i.test(expression))
assert.ok(/occasional ALL CAPS|genuinely justified/i.test(expression))

// —— D: no reaction template requirement ——
assert.ok(/Do not start every response with a reaction/i.test(expression))
assert.ok(!/must start with a reaction/i.test(expression))
assert.ok(!/always react with/i.test(expression))

// —— E: serious-context restraint ——
assert.ok(/vulnerable|high-stakes|restraint/i.test(expression))
assert.ok(/no jokes or fake positivity/i.test(expression))

// —— F: technical precision priority ——
assert.ok(/Technical precision always wins/i.test(expression))
assert.ok(/diagnosis first/i.test(expression))

// —— G: user style override priority ——
assert.ok(/Latest explicit user style/i.test(expression))
assert.ok(/seriamente e senza emoji|vai dritto al punto/i.test(expression))

// —— H: scoped Memory style authority ——
assert.ok(/Memory Pack contains a scoped communication\/reply-style preference/i.test(expression))
assert.ok(/clearly matches the current context/i.test(expression))
assert.ok(/Do not apply a scoped preference outside/i.test(expression))

// —— Celebration gradient (prompt, not code rules) ——
assert.ok(/Small wins/i.test(expression))
assert.ok(/Major breakthroughs/i.test(expression))
assert.ok(/do not escalate every success/i.test(expression))

// —— Warning / anti-noise ——
assert.ok(/Warnings|scams|real danger/i.test(expression))
assert.ok(/catchphrases|emoji combinations/i.test(expression))

// —— BASE identity + adaptation polish ——
assert.ok(/espressivo quando il momento lo merita/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(/cheerleading/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(/piccolo successo|breakthrough/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(/Mai.*sempre emoji|always use emoji/i.test(LAIFE_BASE_SYSTEM_PROMPT) === false)

// —— I: emoji=false remains authoritative in Core settings injection ——
const chatSrc = read('api/chat.ts')
assert.ok(chatSrc.includes('buildCoreExpressionAppendix'))
assert.ok(
  /non introdurre emoji solo per stile/i.test(chatSrc),
  'emoji=false wording should remain authoritative',
)
assert.ok(
  /benvenute quando migliorano naturalmente tono o leggibilità/i.test(chatSrc),
  'emoji=true should welcome selective use',
)
assert.ok(!/consentite solo se calzano davvero/i.test(chatSrc))

// —— Instruction order: BASE settings → EXPRESSION → LANGUAGE → CONTINUITY … ——
const exprCall = chatSrc.indexOf('const expressionAppendix = buildCoreExpressionAppendix')
const langCall = chatSrc.indexOf('const languageAppendix = buildCoreLanguageAppendix')
const contCall = chatSrc.indexOf('const continuityAppendix = buildCoreContinuityAppendix')
const refCall = chatSrc.indexOf('const referenceContextAppendix = buildReferenceContextAppendix')
const wsCall = chatSrc.indexOf('const workingStateAppendix = buildConversationWorkingStateAppendix')
assert.ok(exprCall > 0 && langCall > exprCall, 'EXPRESSION before LANGUAGE')
assert.ok(contCall > langCall, 'LANGUAGE before CONTINUITY')
assert.ok(refCall > contCall, 'CONTINUITY before Reference')
assert.ok(wsCall > refCall, 'Reference before Working State')

const lang = buildCoreLanguageAppendix({
  userMessage: 'HA FUNZIONATO FINALMENTE',
  messages: [{ role: 'user', content: 'HA FUNZIONATO FINALMENTE' }],
  browserLocale: 'it-IT',
})
const continuity = buildCoreContinuityAppendix()
const stacked = [LAIFE_BASE_SYSTEM_PROMPT, expression, lang, continuity].join('\n\n')
assert.ok(stacked.indexOf('ADAPTIVE EXPRESSION') < stacked.indexOf('LANGUAGE'))
assert.ok(stacked.indexOf('LANGUAGE') < stacked.indexOf('CONVERSATION CONTINUITY'))

// Expression must not claim to override LANGUAGE
assert.ok(/do not let expression change language/i.test(expression))

// —— J / K / L / M: Core invariants unchanged ——
assert.ok((chatSrc.match(/responses\.create/g) || []).length >= 1)
assert.ok(!/client\.responses\.create[\s\S]*client\.responses\.create/.test(chatSrc.replace(
  /\/\/.*$/gm,
  '',
)))
// Count actual await client.responses.create — only one in happy path (overview may reuse? check)
const createCalls = [...chatSrc.matchAll(/client\.responses\.create/g)]
assert.equal(createCalls.length, 1, 'exactly one responses.create in api/chat.ts')

assert.ok(/maxDuration:\s*120/.test(chatSrc))

const paramsSrc = read('lib/server/core-responses-params.js')
assert.ok(/stream:\s*false/.test(paramsSrc))
assert.ok(/reasoning:\s*\{\s*effort:\s*["']none["']\s*\}/.test(paramsSrc))
assert.ok(isGpt56FamilyModel('gpt-5.6-sol'))
const gpt56 = buildCoreResponsesCreateParams({
  model: 'gpt-5.6-sol',
  instructions: 'x',
  maxOutputTokens: 4096,
  input: [],
})
assert.equal(gpt56.stream, false)
assert.deepEqual(gpt56.reasoning, { effort: 'none' })
assert.equal('temperature' in gpt56, false)

// No deterministic emotion / emoji engines wired into Core
assert.ok(!chatSrc.includes('emotional-resonance'))
assert.ok(!chatSrc.includes('emotional-momentum'))
assert.ok(!chatSrc.includes('personality-consistency'))
assert.ok(!/insertEmoji|randomEmoji|emotionClassifier|sentimentClassifier/i.test(chatSrc))
assert.ok(!/insertEmoji|randomEmoji|emotionClassifier/i.test(expression))

// Server BASE stays in sync with src personality export marker
const serverBase = read('lib/server/laife-base-system-prompt.js')
assert.ok(serverBase.includes('espressivo quando il momento lo merita'))
assert.ok(serverBase.includes('LAIFE_BASE_SYSTEM_PROMPT'))

// Client offline path emoji wording aligned
const personalitySrc = read('src/lib/personality.ts')
assert.ok(/benvenute quando migliorano naturalmente/i.test(personalitySrc))

// —— Characteristic scenario enablement (N–Y): contracts present, not brittle strings ——
// N/O celebration gradient
assert.ok(/Small wins|Major breakthroughs/i.test(expression))
// P technical
assert.ok(/diagnosis first|minimal unnecessary hype/i.test(expression))
// Q warning urgency
assert.ok(/strong visual emphasis is allowed when it helps safety/i.test(expression))
// R casual
assert.ok(/Casual banter/i.test(expression))
// S serious
assert.ok(/warmth without performance/i.test(expression))
// T simple factual
assert.ok(/simple question can receive a simple answer/i.test(expression))
// U/V explicit override
assert.ok(/Latest explicit user style/i.test(expression))
// W scoped Memory
assert.ok(/scoped communication\/reply-style preference/i.test(expression))
// X/Y personality modes differ
assert.ok(/professional stays more restrained/i.test(expression))
assert.ok(/friendly\/automatic may be freer/i.test(expression))

console.log('conversation-expression.test.mjs: PASS')
