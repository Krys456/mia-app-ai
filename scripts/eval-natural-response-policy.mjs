/**
 * #325 — Natural Response Policy qualitative eval fixtures (offline classification + policy checks).
 * Run: node scripts/eval-natural-response-policy.mjs
 *
 * Optional live smoke: OPENAI_SMOKE=1 node scripts/eval-natural-response-policy.mjs
 */

import assert from 'node:assert/strict'
import { computeConversationState, buildConversationStateAppendix } from '../lib/server/conversation-state.js'
import { buildNaturalResponsePolicyAppendix } from '../lib/server/natural-response-policy.js'
import { LAIFE_BASE_SYSTEM_PROMPT } from '../lib/server/laife-base-system-prompt.js'
import { buildCoreContinuityAppendix } from '../lib/server/conversation-continuity.js'
import { buildCoreLanguageAppendix } from '../lib/server/language-awareness.js'
import { buildCoreConversationalUnderstandingAppendix } from '../lib/server/conversational-understanding.js'
import { buildCoreAdaptiveResponseReasoningAppendix } from '../lib/server/adaptive-response-reasoning.js'
import { buildCoreResponsesCreateParams } from '../lib/server/core-responses-params.js'

const nrp = buildNaturalResponsePolicyAppendix()

/** @type {Array<{ id: string, userMessage: string, recentMessages?: any[], expect: Record<string, unknown> }>} */
const FIXTURES = [
  { id: 'ciao', userMessage: 'Ciao', expect: { conversationMode: 'casual', questionNeeded: false, desiredDepth: 'short' } },
  { id: 'come-va', userMessage: 'Come va?', expect: { conversationMode: 'casual', questionNeeded: false } },
  { id: 'entropy', userMessage: "Cos'è l'entropia?", expect: { conversationMode: 'informational', questionNeeded: false, acknowledgementNeeded: false } },
  { id: 'ponte', userMessage: 'Spiegami cos\'è un ponte termico.', expect: { questionNeeded: false } },
  { id: 'finalmente', userMessage: 'Finalmente funziona!!!', expect: { conversationMode: 'celebration', questionNeeded: false, acknowledgementNeeded: true } },
  {
    id: 'frustration',
    userMessage: 'Non funziona ancora.',
    recentMessages: [
      { role: 'user', content: 'API 401' },
      { role: 'assistant', content: 'Check token.' },
      { role: 'user', content: 'Non funziona ancora.' },
    ],
    expect: { conversationMode: 'debugging', questionNeeded: false },
  },
  { id: 'brainstorm', userMessage: 'Vorrei creare una nuova app.', expect: { conversationMode: 'brainstorming', initiativeLevel: 'high', questionNeeded: false } },
  { id: 'decision', userMessage: 'Aurora o Nova? Quale sceglieresti?', expect: { conversationMode: 'decision_support', responsePurpose: 'recommend', questionNeeded: false } },
  {
    id: 'correction',
    userMessage: 'No, intendevo Nova.',
    recentMessages: [
      { role: 'assistant', content: 'Io sceglierei Aurora.' },
      { role: 'user', content: 'No, intendevo Nova.' },
    ],
    expect: { responsePurpose: 'continue', acknowledgementNeeded: true, questionNeeded: false },
  },
]

function buildCoreInstructions(userMessage, recentMessages) {
  const state = computeConversationState({
    userMessage,
    recentMessages: recentMessages || [{ role: 'user', content: userMessage }],
    settings: { useEmojis: true, replyLength: 'balanced' },
  })
  const parts = [
    LAIFE_BASE_SYSTEM_PROMPT,
    buildConversationStateAppendix(state),
    nrp,
    buildCoreLanguageAppendix({
      userMessage,
      messages: recentMessages || [{ role: 'user', content: userMessage }],
      browserLocale: 'it-IT',
    }),
    buildCoreContinuityAppendix(),
    buildCoreConversationalUnderstandingAppendix(),
    buildCoreAdaptiveResponseReasoningAppendix(),
  ]
  return { state, instructions: parts.filter(Boolean).join('\n\n') }
}

let passed = 0
for (const fix of FIXTURES) {
  const { state, instructions } = buildCoreInstructions(fix.userMessage, fix.recentMessages)
  for (const [k, v] of Object.entries(fix.expect)) {
    assert.equal(state[k], v, `${fix.id}: ${k}`)
  }
  assert.ok(instructions.includes('NATURAL RESPONSE POLICY'))
  assert.ok(!instructions.includes('ADAPTIVE EXPRESSION'))
  assert.ok(!instructions.includes('PROACTIVE INTELLIGENCE'))
  console.log('✓', fix.id, {
    mode: state.conversationMode,
    q: state.questionNeeded,
    chars: instructions.length,
  })
  passed += 1
}

console.log(`eval-natural-response-policy fixtures: ${passed}/${FIXTURES.length}`)

// Prompt budget check for casual
const casual = buildCoreInstructions('Ciao')
console.log('casual_instruction_chars', casual.instructions.length, 'tok~', Math.ceil(casual.instructions.length / 4))
assert.ok(
  casual.instructions.length <= 16000,
  `casual instructions too large: ${casual.instructions.length}`,
)

if (process.env.OPENAI_SMOKE === '1' && process.env.OPENAI_API_KEY) {
  const OpenAI = (await import('openai')).default
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = process.env.OPENAI_MODEL || 'gpt-4o'
  const smokeCases = [
    'Ciao',
    "Cos'è l'entropia?",
    'Finalmente funziona!!!',
    'Non funziona ancora, che palle.',
    'Vorrei creare una nuova app. Dammi idee.',
    'Aurora o Nova? Quale sceglieresti?',
    'No, intendevo Nova.',
  ]
  const metrics = {
    trailingQ: 0,
    serviceOffer: 0,
    fillerOpen: 0,
    heading: 0,
    n: 0,
    byMode: {},
  }
  for (const msg of smokeCases) {
    const recent =
      msg.includes('Non funziona')
        ? [
            { role: 'user', content: 'API restituisce 401' },
            { role: 'assistant', content: 'Controlla Authorization.' },
            { role: 'user', content: msg },
          ]
        : msg.includes('intendevo')
          ? [
              { role: 'assistant', content: 'Io sceglierei Aurora.' },
              { role: 'user', content: msg },
            ]
          : [{ role: 'user', content: msg }]
    const { state, instructions } = buildCoreInstructions(msg, recent)
    const response = await client.responses.create(
      buildCoreResponsesCreateParams({
        model,
        instructions,
        maxOutputTokens: 350,
        input: recent.map((m) => ({ role: m.role, content: m.content })),
      }),
    )
    const content = response.output_text || ''
    const trailingQ = /\?\s*$/.test(content.trim())
    const serviceOffer = /Vuoi che|Se vuoi posso|Posso anche|Would you like|Want me to/i.test(content)
    const fillerOpen = /^(Certo|Assolutamente|Ottima domanda|Perfetto!)[!.,\s]/i.test(content.trim())
    const heading = /^#{1,3}\s/m.test(content)
    metrics.n += 1
    if (trailingQ) metrics.trailingQ += 1
    if (serviceOffer) metrics.serviceOffer += 1
    if (fillerOpen) metrics.fillerOpen += 1
    if (heading) metrics.heading += 1
    metrics.byMode[state.conversationMode] = metrics.byMode[state.conversationMode] || []
    metrics.byMode[state.conversationMode].push(content.length)
    console.log('SMOKE', msg, {
      mode: state.conversationMode,
      len: content.length,
      trailingQ,
      serviceOffer,
      fillerOpen,
      heading,
      preview: content.slice(0, 160).replace(/\n/g, ' / '),
    })
  }
  console.log('SMOKE_METRICS', {
    trailingQuestionRate: metrics.trailingQ / metrics.n,
    serviceOfferRate: metrics.serviceOffer / metrics.n,
    fillerOpeningRate: metrics.fillerOpen / metrics.n,
    unnecessaryHeadingRate: metrics.heading / metrics.n,
    meanLenByMode: Object.fromEntries(
      Object.entries(metrics.byMode).map(([k, arr]) => [
        k,
        Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
      ]),
    ),
  })
}

console.log('eval-natural-response-policy.mjs: ok')
