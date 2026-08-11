#!/usr/bin/env node
/**
 * LAIfe V2 — Voice Examples Conversation Lab
 *
 * A/B: Writer without voice examples vs Writer with VOICE STYLE EXAMPLES.
 * Same Lab scenarios. Scores Reviewer / Identity / Planner Fidelity / rewrite rate.
 *
 * Usage:
 *   node lib/server/v2/eval/voice-examples-lab.mjs
 *
 * Env:
 *   OPENAI_API_KEY   required
 *   OPENAI_MODEL     optional (default gpt-4o-mini)
 *
 * Measurement only. Does not modify Perception / Mind / Planner / Reviewer /
 * Identity / Cleaner / Runtime / V1 / API.
 */

import { createRequire } from 'module'
import { writeFileSync } from 'fs'

import { createPipeline, DEFAULT_FOUNDATION, PIPELINE_VERSION } from '../brain/pipeline.js'
import {
  createWriter,
  looksLikeGenericChatbot,
  WRITER_VERSION,
} from '../brain/writer.js'
import { VOICE_EXAMPLES_VERSION, VOICE_EXAMPLES } from '../brain/voice-examples.js'
import { createReviewer } from '../brain/reviewer.js'
import { evaluateIdentity } from '../brain/identity-evaluator.js'
import { evaluatePlannerFidelity } from '../brain/planner-fidelity.js'
import { createOpenAIProvider } from '../providers/openai-provider.js'

const require = createRequire('/workspace/package.json')
const OpenAI = require('openai').default

const apiKey = process.env.OPENAI_API_KEY?.trim()
if (!apiKey) {
  console.error('OPENAI_API_KEY missing — cannot run Voice Examples lab')
  process.exit(1)
}

const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
const client = new OpenAI({ apiKey })

/**
 * @param {string} label
 */
function makeProvider(label) {
  const provider = createOpenAIProvider({
    client,
    defaultModel: model,
    timeoutMs: 60000,
  })
  /** @type {string[]} */
  const rawByCall = []
  const inner = provider.complete.bind(provider)
  provider.complete = async (req) => {
    const res = await inner(req)
    rawByCall.push(res?.text || '')
    return res
  }
  provider.__rawByCall = rawByCall
  provider.__label = label
  return provider
}

const providerOff = makeProvider('voice-off')
const providerOn = makeProvider('voice-on')

const writerOff = createWriter({
  providers: { openai: providerOff },
  defaultProviderId: 'openai',
  useVoiceExamples: false,
})
const writerOn = createWriter({
  providers: { openai: providerOn },
  defaultProviderId: 'openai',
  useVoiceExamples: true,
})

const pipelineOff = createPipeline({
  writer: writerOff,
  personalityFoundation: DEFAULT_FOUNDATION,
})
const pipelineOn = createPipeline({
  writer: writerOn,
  personalityFoundation: DEFAULT_FOUNDATION,
})
const reviewer = createReviewer()

/** Same cases as Conversation Lab. */
/** @type {{ name: string, userMessage: string, messages?: { role: string, content: string }[] }[]} */
const SCENARIOS = [
  { name: 'greeting', userMessage: 'Ciao' },
  { name: 'how-are-you', userMessage: 'Come stai?' },
  { name: 'sad', userMessage: 'Sono triste.' },
  { name: 'minimal-ok', userMessage: 'ok' },
  { name: 'minimal-esatto', userMessage: 'esatto' },
  { name: 'minimal-certo', userMessage: 'certo' },
  { name: 'minimal-perfetto', userMessage: 'perfetto' },
  {
    name: 'resume-continuity',
    userMessage: 'Riprendiamo da dove avevamo lasciato.',
    messages: [
      {
        role: 'user',
        content:
          "Stiamo lavorando sullo sviluppo di LAIfe. L'obiettivo è rendere V2 più naturale.",
      },
      {
        role: 'assistant',
        content: 'Presence Recovery completato. Conversation Momentum aggiunto.',
      },
      {
        role: 'user',
        content:
          'Decisione: non modificare più il Writer. Passare alla continuità della conversazione.',
      },
      {
        role: 'assistant',
        content: 'Ok: Writer freeze e focus su resume / continuity.',
      },
    ],
  },
]

/**
 * @param {any} out
 */
function scoreTurn(out) {
  const text = out.response?.text || ''
  const identityTrace = out.response?.identity || null
  const draftText = identityTrace?.draftText || text
  const rewritten = Boolean(identityTrace?.rewritten)
  const messages = []
  const review = reviewer.review({
    writerRequest: {
      decision: out.decision,
      plan: out.plan,
      messages,
      personalityFoundation: DEFAULT_FOUNDATION,
    },
    writerResponse: out.response,
    plan: out.plan,
  })
  const identity = evaluateIdentity({
    response: text,
    plannerSummary: out.plan,
  })
  const fidelity = evaluatePlannerFidelity({
    plannerOutput: out.plan,
    response: text,
  })
  const generic = looksLikeGenericChatbot(text, {
    decision: out.decision,
    plan: out.plan,
    messages,
  })
  return {
    text,
    draftText,
    rewritten,
    rejectReason: identityTrace?.rejectReason ?? null,
    reviewDecision: review.decision,
    reviewScore: review.score?.overall ?? null,
    identityScore: identity.identityScore,
    genericity: identity.genericity,
    signature: identity.signature,
    fidelityScore: fidelity.fidelityScore,
    identityFlags: generic.reasons,
    resumeUsed: Boolean(out.plan?.conversationResume?.used),
    resumeSentence: out.plan?.writerBrief?.resumeSentence ?? null,
  }
}

/**
 * @param {number|null|undefined} n
 */
function fmt(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '  — '
  return n.toFixed(2).padStart(5, ' ')
}

console.log(
  `Voice Examples Lab — writer ${WRITER_VERSION} | voice ${VOICE_EXAMPLES_VERSION} (${VOICE_EXAMPLES.length} examples) | pipeline ${PIPELINE_VERSION} — model ${model}`,
)
console.log('BEFORE = Writer without voice examples')
console.log('AFTER  = Writer + VOICE STYLE EXAMPLES')
console.log('')

/** @type {any[]} */
const rows = []
let rewritesOff = 0
let rewritesOn = 0

for (const scenario of SCENARIOS) {
  const history = Array.isArray(scenario.messages) ? scenario.messages : []
  const input = {
    userMessage: scenario.userMessage,
    messages: history.length ? history : [{ role: 'user', content: scenario.userMessage }],
    model,
    providerId: 'openai',
  }

  const outOff = await pipelineOff.runConversation(input)
  const outOn = await pipelineOn.runConversation(input)
  const before = scoreTurn(outOff)
  const after = scoreTurn(outOn)
  if (before.rewritten) rewritesOff += 1
  if (after.rewritten) rewritesOn += 1

  rows.push({
    name: scenario.name,
    userMessage: scenario.userMessage,
    before,
    after,
  })

  console.log(`=== ${scenario.name} ===`)
  console.log(`user: ${JSON.stringify(scenario.userMessage)}`)
  console.log('BEFORE (no voice examples):')
  console.log(`  ${before.text}`)
  if (before.rewritten) {
    console.log(`  [identity rewrite from draft] ${before.draftText}`)
  }
  console.log(
    `  reviewer=${fmt(before.reviewScore)} (${before.reviewDecision})  identity=${fmt(before.identityScore)}  genericity=${fmt(before.genericity)}  fidelity=${fmt(before.fidelityScore)}  rewrite=${before.rewritten ? 'yes' : 'no'}`,
  )
  console.log('AFTER  (+ voice examples):')
  console.log(`  ${after.text}`)
  if (after.rewritten) {
    console.log(`  [identity rewrite from draft] ${after.draftText}`)
  }
  console.log(
    `  reviewer=${fmt(after.reviewScore)} (${after.reviewDecision})  identity=${fmt(after.identityScore)}  genericity=${fmt(after.genericity)}  fidelity=${fmt(after.fidelityScore)}  rewrite=${after.rewritten ? 'yes' : 'no'}`,
  )
  console.log('')
}

function avg(key, side) {
  const vals = rows.map((r) => r[side][key]).filter((n) => typeof n === 'number')
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

const summary = {
  model,
  pipelineVersion: PIPELINE_VERSION,
  writerVersion: WRITER_VERSION,
  voiceExamplesVersion: VOICE_EXAMPLES_VERSION,
  voiceExampleCount: VOICE_EXAMPLES.length,
  turns: rows.length,
  rewriteRateBefore: rows.length ? rewritesOff / rows.length : 0,
  rewriteRateAfter: rows.length ? rewritesOn / rows.length : 0,
  identityRewritesBefore: rewritesOff,
  identityRewritesAfter: rewritesOn,
  avgReviewerBefore: avg('reviewScore', 'before'),
  avgReviewerAfter: avg('reviewScore', 'after'),
  avgIdentityBefore: avg('identityScore', 'before'),
  avgIdentityAfter: avg('identityScore', 'after'),
  avgGenericityBefore: avg('genericity', 'before'),
  avgGenericityAfter: avg('genericity', 'after'),
  avgFidelityBefore: avg('fidelityScore', 'before'),
  avgFidelityAfter: avg('fidelityScore', 'after'),
  rows,
}

const outPath = '/tmp/v2-voice-examples-lab.json'
writeFileSync(outPath, JSON.stringify(summary, null, 2))

console.log('=== SUMMARY ===')
console.log(`writer:           ${WRITER_VERSION}`)
console.log(`voice examples:   ${VOICE_EXAMPLES.length} (${VOICE_EXAMPLES_VERSION})`)
console.log(
  `rewrite rate:     ${(summary.rewriteRateBefore * 100).toFixed(0)}% → ${(summary.rewriteRateAfter * 100).toFixed(0)}% (${rewritesOff}/${rows.length} → ${rewritesOn}/${rows.length})`,
)
console.log(
  `avg reviewer:     ${fmt(summary.avgReviewerBefore)} → ${fmt(summary.avgReviewerAfter)}`,
)
console.log(
  `avg identity:     ${fmt(summary.avgIdentityBefore)} → ${fmt(summary.avgIdentityAfter)}`,
)
console.log(
  `avg genericity:   ${fmt(summary.avgGenericityBefore)} → ${fmt(summary.avgGenericityAfter)}`,
)
console.log(
  `avg fidelity:     ${fmt(summary.avgFidelityBefore)} → ${fmt(summary.avgFidelityAfter)}`,
)
console.log(`saved ${outPath}`)
