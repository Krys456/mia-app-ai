/**
 * #325 Natural Response Policy
 * Run: node lib/server/natural-response-policy.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NATURAL_RESPONSE_POLICY_CONTRACT,
  NATURAL_RESPONSE_POLICY_MAX_CHARS,
  buildNaturalResponsePolicyAppendix,
  buildNaturalResponseDiagPayload,
  isNaturalResponseDiagEnabled,
} from './natural-response-policy.js'
import { buildConversationStateAppendix, computeConversationState } from './conversation-state.js'
import { buildCoreContinuityAppendix } from './conversation-continuity.js'
import { LAIFE_BASE_SYSTEM_PROMPT } from './laife-base-system-prompt.js'
import {
  buildPhoneActionCapabilityAppendix,
  shouldInjectPhoneCapabilityAppendix,
} from './phone-action-capability-appendix.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')

const nrp = buildNaturalResponsePolicyAppendix()
assert.equal(nrp, NATURAL_RESPONSE_POLICY_CONTRACT)
assert.ok(nrp.startsWith('NATURAL RESPONSE POLICY'))
assert.ok(
  nrp.length >= 1200 && nrp.length <= NATURAL_RESPONSE_POLICY_MAX_CHARS,
  `NRP size out of band: ${nrp.length}`,
)
assert.ok(/CONVERSATION MOMENTUM/i.test(nrp))
assert.ok(/ONE useful layer|one useful layer/i.test(nrp))
assert.ok(/Curiosity may be|Curiosity does not require/i.test(nrp))
assert.ok(/drop a direction|drops a direction/i.test(nrp))

// Consumes Conversation State — does not re-classify
assert.ok(/Use CONVERSATION STATE|CONVERSATION STATE as THIS turn/i.test(nrp))
assert.ok(/do not re-classify/i.test(nrp))
assert.ok(/question_needed=false/i.test(nrp))
assert.ok(/Vuoi che|Would you like|Want me to/i.test(nrp))
assert.ok(/acknowledgement=false/i.test(nrp))
assert.ok(/Io sceglierei/i.test(nrp))

// Wiring order in api/chat.ts
assert.ok(chatSrc.includes('buildNaturalResponsePolicyAppendix'))
assert.ok(!chatSrc.includes('buildCoreExpressionAppendix'))
assert.ok(!chatSrc.includes('buildCoreProactiveIntelligenceAppendix'))
assert.ok(!/LENGTH_BIAS/.test(chatSrc), 'LENGTH_BIAS prose removed; settings feed State')

const stateCall = chatSrc.indexOf('const conversationStateAppendix = buildConversationStateAppendix')
const nrpCall = chatSrc.indexOf('const naturalResponsePolicyAppendix = buildNaturalResponsePolicyAppendix')
const langCall = chatSrc.indexOf('const languageAppendix = buildCoreLanguageAppendix')
const contCall = chatSrc.indexOf('const continuityAppendix = buildCoreContinuityAppendix')
assert.ok(stateCall > 0 && nrpCall > stateCall, 'State before NRP')
assert.ok(langCall > nrpCall, 'NRP before Language')
assert.ok(contCall > langCall, 'Language before Continuity')

// Continuity still has referent/repair; slimmed
const continuity = buildCoreContinuityAppendix()
assert.ok(/CURRENT THREAD REFERENT/i.test(continuity))
assert.ok(/Anti-fabrication/i.test(continuity))
assert.ok(continuity.length <= 1700, `continuity too large: ${continuity.length}`)
assert.ok(!/No automatic "Vuoi che/i.test(continuity), 'style question rules moved out of Continuity')

// Base still has identity/honesty/safety (Personality 2.0 / #329)
assert.ok(/ShinkAIdo/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(!/Sei LAIfe/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(/Do not automatically agree or praise|Disagree/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(/Crisis\/self-harm|self-harm|crisis/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(/Never imply external actions/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(!/ADAPTATION\nSegui il tono/i.test(LAIFE_BASE_SYSTEM_PROMPT), 'ADAPTATION block removed')

// Phone gating
assert.equal(shouldInjectPhoneCapabilityAppendix({ userMessage: 'Ciao' }), false)
assert.equal(buildPhoneActionCapabilityAppendix({ userMessage: 'Ciao' }), '')
assert.ok(shouldInjectPhoneCapabilityAppendix({ userMessage: 'Apri Spotify' }))
assert.ok(buildPhoneActionCapabilityAppendix({ userMessage: 'Puoi aprire WhatsApp?' }).length > 500)
assert.ok(buildPhoneActionCapabilityAppendix().length > 500, 'no-arg legacy returns full')

// Settings feed State (emoji false → none)
const s = computeConversationState({
  userMessage: 'Ciao',
  recentMessages: [{ role: 'user', content: 'Ciao' }],
  settings: { useEmojis: false, replyLength: 'concise' },
})
assert.equal(s.emojiLevel, 'none')
assert.equal(s.desiredDepth, 'short')
const stateAppendix = buildConversationStateAppendix(s)
assert.ok(/Follow these fields for current-turn presentation/i.test(stateAppendix))

// Diagnostics
assert.equal(
  isNaturalResponseDiagEnabled(
    { url: '/api/chat?natural_response_diag=1' },
    {},
    { VERCEL_ENV: 'preview' },
  ),
  true,
)
const diag = buildNaturalResponseDiagPayload({
  policyChars: nrp.length,
  expressionInjected: false,
  proactiveInjected: false,
  totalInstructionChars: 12000,
  questionNeeded: false,
  desiredDepth: 'short',
})
assert.equal(diag.route, 'natural-response')
assert.equal(diag.expressionInjected, false)
assert.equal(diag.proactiveInjected, false)
assert.ok(!('userMessage' in diag))

// No Cognitive / second LLM
assert.ok(!/runCognitiveEngine|conversation-runtime\/v1/.test(chatSrc))

console.log('natural-response-policy.test.mjs: ok', { nrp: nrp.length, continuity: continuity.length })
