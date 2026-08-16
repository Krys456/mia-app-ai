/**
 * #285 Proactive Intelligence contract
 * Run: node lib/server/proactive-conversation.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PROACTIVE_INTELLIGENCE_CONTRACT,
  buildCoreProactiveIntelligenceAppendix,
} from './proactive-conversation.js'
import { buildCoreExpressionAppendix } from './conversation-expression.js'
import { buildCoreContinuityAppendix } from './conversation-continuity.js'
import { buildCoreLanguageAppendix } from './language-awareness.js'
import { LAIFE_BASE_SYSTEM_PROMPT } from './laife-base-system-prompt.js'
import {
  buildCoreResponsesCreateParams,
  isGpt56FamilyModel,
} from './core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const proactive = buildCoreProactiveIntelligenceAppendix()

// —— Contract presence ——
assert.equal(proactive, PROACTIVE_INTELLIGENCE_CONTRACT)
assert.ok(proactive.startsWith('PROACTIVE INTELLIGENCE'))
assert.ok(
  proactive.length >= 1200 && proactive.length <= 4500,
  `proactive size out of band: ${proactive.length}`,
)

// Must not reuse banned legacy initiative mesh names
assert.ok(!proactive.includes('CONVERSATIONAL INITIATIVE'))
assert.ok(!proactive.includes('CALIBRAZIONE DELL'))
assert.ok(!proactive.includes('Zeigarnik'))

// —— R: no generic follow-up requirement ——
assert.ok(/Do not routinely end responses/i.test(proactive))
assert.ok(/Vuoi che|Would you like me to/i.test(proactive))
assert.ok(!/\balways\s+ask\b/i.test(proactive))
assert.ok(!/\bend every (?:response|answer) with a question/i.test(proactive))

// —— S: no autonomous-action implication ——
assert.ok(/does NOT authorize external actions/i.test(proactive))
assert.ok(/Never imply that LAIfe has changed files/i.test(proactive))

// —— T: #284 expression remains separate ——
const expression = buildCoreExpressionAppendix()
assert.ok(expression.startsWith('ADAPTIVE EXPRESSION'))
assert.ok(!expression.includes('PROACTIVE INTELLIGENCE'))
assert.ok(!proactive.includes('ADAPTIVE EXPRESSION'))
assert.ok(!/paragraph spacing|ALL CAPS|emoji combinations/i.test(proactive))

// —— A/B task continuation vs no invented workflow ——
assert.ok(/obvious next step when an active task is clearly underway/i.test(proactive))
assert.ok(/Do not revive unrelated old topics/i.test(proactive))

// —— C completion ——
assert.ok(/When a task is clearly complete/i.test(proactive))
assert.ok(/do not manufacture a new project/i.test(proactive))

// —— D simple factual ——
assert.ok(/Do not turn simple factual questions into workflows/i.test(proactive))

// —— E risk ——
assert.ok(/important safety\/security risk/i.test(proactive))

// —— F contradiction ——
assert.ok(/meaningful contradiction with an explicit active constraint/i.test(proactive))
assert.ok(/surface the contradiction clearly and calmly/i.test(proactive))

// —— G/Q Memory relevance ——
assert.ok(/Use Memory only when the remembered information is materially relevant/i.test(proactive))
assert.ok(/merely to demonstrate memory/i.test(proactive))

// —— H emotional / completion ——
assert.ok(/Human significance comes first/i.test(proactive))
assert.ok(/completion may be the whole point/i.test(proactive))

// —— I initiative when no topic ——
assert.ok(/explicitly has no topic or wants the conversation to continue/i.test(proactive))

// —— J/K Ok behavior ——
assert.ok(/Short acknowledgments/i.test(proactive))
assert.ok(/NOT authorization to begin a new step/i.test(proactive))
assert.ok(/do not auto-launch/i.test(proactive))
assert.ok(/Say ok and I'll continue/i.test(proactive))

// —— L Continua ——
assert.ok(/Continua\.|continue an active task/i.test(proactive))

// —— P topic switch ——
assert.ok(/newer explicit topic change outranks stale Working State/i.test(proactive))

// —— Working State as evidence ——
assert.ok(/Working State is evidence, not an instruction to hijack/i.test(proactive))

// —— Answer first ——
assert.ok(/Answer the user's actual message first/i.test(proactive))

// —— Authority stack ——
assert.ok(/proactivity never overrides/i.test(proactive))
assert.ok(/LANGUAGE \(reply language only\)/i.test(proactive))

// —— Instruction order in api/chat.ts ——
const chatSrc = read('api/chat.ts')
assert.ok(chatSrc.includes('buildCoreProactiveIntelligenceAppendix'))
const exprCall = chatSrc.indexOf('const expressionAppendix = buildCoreExpressionAppendix')
const langCall = chatSrc.indexOf('const languageAppendix = buildCoreLanguageAppendix')
const contCall = chatSrc.indexOf('const continuityAppendix = buildCoreContinuityAppendix')
const refCall = chatSrc.indexOf('const referenceContextAppendix = buildReferenceContextAppendix')
const wsCall = chatSrc.indexOf('const workingStateAppendix = buildConversationWorkingStateAppendix')
const proCall = chatSrc.indexOf('const proactiveAppendix = buildCoreProactiveIntelligenceAppendix')
assert.ok(exprCall > 0 && langCall > exprCall, 'EXPRESSION before LANGUAGE')
assert.ok(contCall > langCall, 'LANGUAGE before CONTINUITY')
assert.ok(refCall > contCall, 'CONTINUITY before Reference')
assert.ok(wsCall > refCall, 'Reference before Working State')
assert.ok(proCall > wsCall, 'Working State before PROACTIVE')

const lang = buildCoreLanguageAppendix({
  userMessage: 'I test sono passati.',
  messages: [{ role: 'user', content: 'I test sono passati.' }],
  browserLocale: 'it-IT',
})
const continuity = buildCoreContinuityAppendix()
const stacked = [
  LAIFE_BASE_SYSTEM_PROMPT,
  expression,
  lang,
  continuity,
  'CONVERSATION WORKING STATE\nCurrent task: example',
  proactive,
].join('\n\n')
assert.ok(stacked.indexOf('ADAPTIVE EXPRESSION') < stacked.indexOf('LANGUAGE'))
assert.ok(stacked.indexOf('LANGUAGE') < stacked.indexOf('CONVERSATION CONTINUITY'))
assert.ok(stacked.indexOf('CONVERSATION WORKING STATE') < stacked.indexOf('PROACTIVE INTELLIGENCE'))

// —— No deterministic initiative machinery ——
assert.ok(!chatSrc.includes('genuine-curiosity'))
assert.ok(!chatSrc.includes('curiosity-engine'))
assert.ok(!chatSrc.includes('conversation-spark'))
assert.ok(!chatSrc.includes('satisfaction-estimator'))
assert.ok(!chatSrc.includes('question-economy'))
assert.ok(!/initiativeScore|proactive\s*=\s*true|nextStepEngine|emotionClassifier/i.test(chatSrc))
assert.ok(!/initiativeScore|proactive\s*=\s*true|nextStepEngine/i.test(proactive))

// —— Core invariants ——
assert.equal((chatSrc.match(/client\.responses\.create/g) || []).length, 1)
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

// Expression module unchanged in purpose
const exprSrc = read('lib/server/conversation-expression.js')
assert.ok(exprSrc.includes('ADAPTIVE EXPRESSION'))
assert.ok(!exprSrc.includes('PROACTIVE INTELLIGENCE'))
assert.ok(!exprSrc.includes('auto-launch'))

// BASE still has companion initiative permission (compatibility)
assert.ok(/prendere l'iniziativa|prendi l'iniziativa/i.test(LAIFE_BASE_SYSTEM_PROMPT) || /prendere l'iniziativa/i.test(LAIFE_BASE_SYSTEM_PROMPT))

console.log('proactive-conversation.test.mjs: PASS')
