#!/usr/bin/env node
/**
 * LAIfe V2 — Writer 2.3.2 vs Writer 3.0 comparison (Conversation Lab cases)
 *
 * Runs the same Lab prompts through:
 *   Perception → Mind → Resume → Planner → Writer(2.x|3.0)
 * then scores with Reviewer, Identity Evaluator, Planner Fidelity.
 *
 * Usage:
 *   node lib/server/v2/eval/writer-3-comparison-harness.mjs
 *
 * Env:
 *   OPENAI_API_KEY   required for live LLM comparison
 *   OPENAI_MODEL     optional (default gpt-4o-mini)
 *
 * Does not modify Runtime / Planner / V1 / API. Measurement only.
 */

import { createRequire } from 'module'
import { writeFileSync } from 'fs'

import { createPipeline, DEFAULT_FOUNDATION } from '../brain/pipeline.js'
import {
  createWriter as createWriter3,
  WRITER_VERSION as WRITER3_VERSION,
  looksLikeGenericChatbot,
} from '../brain/writer.js'
import {
  createWriter as createWriter2,
  WRITER_VERSION as WRITER2_VERSION,
} from '../brain/writer-2.3.2-snapshot.js'
import { createReviewer } from '../brain/reviewer.js'
import { evaluateIdentity } from '../brain/identity-evaluator.js'
import { evaluatePlannerFidelity } from '../brain/planner-fidelity.js'
import { createOpenAIProvider } from '../providers/openai-provider.js'

const require = createRequire('/workspace/package.json')
const OpenAI = require('openai').default

const apiKey = process.env.OPENAI_API_KEY?.trim()
if (!apiKey) {
  console.error('OPENAI_API_KEY missing — cannot run live Writer 2.x vs 3.0 comparison')
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

const provider2 = makeProvider('writer-2.3.2')
const provider3 = makeProvider('writer-3.0')

const writer2 = createWriter2({
  providers: { openai: provider2 },
  defaultProviderId: 'openai',
})
const writer3 = createWriter3({
  providers: { openai: provider3 },
  defaultProviderId: 'openai',
})

const pipeline2 = createPipeline({ writer: writer2, personalityFoundation: DEFAULT_FOUNDATION })
const pipeline3 = createPipeline({ writer: writer3, personalityFoundation: DEFAULT_FOUNDATION })
const reviewer = createReviewer()

/** Same cases as Conversation Lab (+ resume continuity). */
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
          'Stiamo lavorando sullo sviluppo di LAIfe. L\'obiettivo è rendere V2 più naturale.',
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
 * @param {Awaited<ReturnType<typeof pipeline2.runConversation>>} out
 */
function scoreTurn(out) {
  const text = out.response?.text || ''
  const messages = Array.isArray(out.response?.__messages)
    ? out.response.__messages
    : []
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
    writerSummary: { version: out.response?.model },
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
    reviewDecision: review.decision,
    reviewScore: review.score?.overall ?? null,
    identityScore: identity.identityScore,
    genericity: identity.genericity,
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

console.log(`Writer comparison — ${WRITER2_VERSION} vs ${WRITER3_VERSION} — model ${model}`)
console.log('')

/** @type {any[]} */
const rows = []

for (const scenario of SCENARIOS) {
  const history = Array.isArray(scenario.messages) ? scenario.messages : []
  const input = {
    userMessage: scenario.userMessage,
    messages: history.length ? history : [{ role: 'user', content: scenario.userMessage }],
    model,
    providerId: 'openai',
  }

  const out2 = await pipeline2.runConversation(input)
  const out3 = await pipeline3.runConversation(input)
  const s2 = scoreTurn(out2)
  const s3 = scoreTurn(out3)

  rows.push({
    name: scenario.name,
    userMessage: scenario.userMessage,
    before: { version: WRITER2_VERSION, ...s2 },
    after: { version: WRITER3_VERSION, ...s3 },
  })

  console.log(`=== ${scenario.name} ===`)
  console.log(`user: ${JSON.stringify(scenario.userMessage)}`)
  console.log(`BEFORE (${WRITER2_VERSION}):`)
  console.log(`  ${s2.text}`)
  console.log(
    `  reviewer=${fmt(s2.reviewScore)} (${s2.reviewDecision})  identity=${fmt(s2.identityScore)}  fidelity=${fmt(s2.fidelityScore)}`,
  )
  console.log(`AFTER  (${WRITER3_VERSION}):`)
  console.log(`  ${s3.text}`)
  console.log(
    `  reviewer=${fmt(s3.reviewScore)} (${s3.reviewDecision})  identity=${fmt(s3.identityScore)}  fidelity=${fmt(s3.fidelityScore)}`,
  )
  console.log('')
}

function avg(key, side) {
  const vals = rows
    .map((r) => r[side][key])
    .filter((n) => typeof n === 'number')
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

const summary = {
  model,
  writerBefore: WRITER2_VERSION,
  writerAfter: WRITER3_VERSION,
  turns: rows.length,
  avgReviewerBefore: avg('reviewScore', 'before'),
  avgReviewerAfter: avg('reviewScore', 'after'),
  avgIdentityBefore: avg('identityScore', 'before'),
  avgIdentityAfter: avg('identityScore', 'after'),
  avgFidelityBefore: avg('fidelityScore', 'before'),
  avgFidelityAfter: avg('fidelityScore', 'after'),
  rows,
}

const outPath = '/tmp/v2-writer-3-comparison.json'
writeFileSync(outPath, JSON.stringify(summary, null, 2))

console.log('=== SUMMARY ===')
console.log(`before writer:  ${WRITER2_VERSION}`)
console.log(`after writer:   ${WRITER3_VERSION}`)
console.log(
  `avg reviewer:   ${fmt(summary.avgReviewerBefore)} → ${fmt(summary.avgReviewerAfter)}`,
)
console.log(
  `avg identity:   ${fmt(summary.avgIdentityBefore)} → ${fmt(summary.avgIdentityAfter)}`,
)
console.log(
  `avg fidelity:   ${fmt(summary.avgFidelityBefore)} → ${fmt(summary.avgFidelityAfter)}`,
)
console.log(`saved ${outPath}`)
