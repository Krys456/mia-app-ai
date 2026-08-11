#!/usr/bin/env node
/**
 * LAIfe V2 — Prompt Inspector Conversation Lab
 *
 * For each Conversation Lab case, captures the Writer prompt (analysis only)
 * and prints Prompt Inspector alongside Reviewer / Identity / Planner Fidelity / Rewrite.
 *
 * Goal: see whether high rewrite correlates with long / redundant / complex prompts.
 *
 * Usage:
 *   node lib/server/v2/eval/prompt-inspector-lab.mjs
 *
 * Env:
 *   OPENAI_API_KEY   required
 *   OPENAI_MODEL     optional (default gpt-4o-mini)
 *
 * Does not modify Writer / Planner / Cleaner / Reviewer / Runtime / API / V1.
 */

import { createRequire } from 'module'
import { writeFileSync } from 'fs'

import { createPipeline, DEFAULT_FOUNDATION, PIPELINE_VERSION } from '../brain/pipeline.js'
import { createWriter, WRITER_VERSION } from '../brain/writer.js'
import { createReviewer } from '../brain/reviewer.js'
import { evaluateIdentity } from '../brain/identity-evaluator.js'
import { evaluatePlannerFidelity } from '../brain/planner-fidelity.js'
import { PLANNER_VERSION } from '../brain/planner.js'
import { createOpenAIProvider } from '../providers/openai-provider.js'
import {
  inspectPrompt,
  PROMPT_INSPECTOR_VERSION,
} from './prompt-inspector.js'

const require = createRequire('/workspace/package.json')
const OpenAI = require('openai').default

const apiKey = process.env.OPENAI_API_KEY?.trim()
if (!apiKey) {
  console.error('OPENAI_API_KEY missing — cannot run Prompt Inspector lab')
  process.exit(1)
}

const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
const client = new OpenAI({ apiKey })
const provider = createOpenAIProvider({
  client,
  defaultModel: model,
  timeoutMs: 60000,
})

/** @type {{ instructions: string, text: string }[]} */
const calls = []
const innerComplete = provider.complete.bind(provider)
provider.complete = async (req) => {
  const res = await innerComplete(req)
  calls.push({
    instructions: typeof req?.instructions === 'string' ? req.instructions : '',
    text: res?.text || '',
  })
  return res
}

const writer = createWriter({
  providers: { openai: provider },
  defaultProviderId: 'openai',
})
const reviewer = createReviewer()
const pipeline = createPipeline({
  writer,
  personalityFoundation: DEFAULT_FOUNDATION,
})

/** @type {{ name: string, userMessage: string, messages?: { role: string, content: string }[] }[]} */
const SCENARIOS = [
  { name: 'greeting', userMessage: 'Ciao' },
  { name: 'how-are-you', userMessage: 'Come stai?' },
  { name: 'sad', userMessage: 'Sono triste.' },
  { name: 'minimal-ok', userMessage: 'ok' },
  { name: 'explore', userMessage: 'Di cosa possiamo parlare?' },
  { name: 'explain', userMessage: 'Spiegami' },
  { name: 'bug', userMessage: 'Ho un bug' },
  { name: 'idea', userMessage: "Vorrei un'idea" },
  { name: 'decide', userMessage: 'Non so decidere' },
  { name: 'continue', userMessage: 'Continuiamo.' },
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
 * @param {number|null|undefined} n
 */
function fmt(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '  — '
  return n.toFixed(2).padStart(5, ' ')
}

/**
 * @param {any} out
 * @param {string} text
 */
function scoreTurn(out, text) {
  const identityTrace = out.response?.identity || null
  const rewritten = Boolean(identityTrace?.rewritten)
  const review = reviewer.review({
    writerRequest: {
      decision: out.decision,
      plan: out.plan,
      messages: [],
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
  return {
    text,
    rewritten,
    reviewDecision: review.decision,
    reviewScore: review.score?.overall ?? null,
    identityScore: identity.identityScore,
    genericity: identity.genericity,
    fidelityScore: fidelity.fidelityScore,
  }
}

console.log(
  `Prompt Inspector Lab — inspector ${PROMPT_INSPECTOR_VERSION} | planner ${PLANNER_VERSION} | writer ${WRITER_VERSION} | pipeline ${PIPELINE_VERSION} — model ${model}`,
)
console.log('')

/** @type {any[]} */
const rows = []

for (const scenario of SCENARIOS) {
  const history = Array.isArray(scenario.messages) ? scenario.messages : []
  const beforeCalls = calls.length
  const out = await pipeline.runConversation({
    userMessage: scenario.userMessage,
    messages: history.length ? history : [{ role: 'user', content: scenario.userMessage }],
    model,
    providerId: 'openai',
  })
  const turnCalls = calls.slice(beforeCalls)
  // First provider call = draft Writer prompt (rewrite would be a second call).
  const writerPrompt = turnCalls[0]?.instructions || ''
  const inspection = inspectPrompt({ writerPrompt })
  const finalText = out.response?.text || ''
  const scores = scoreTurn(out, finalText)

  rows.push({
    name: scenario.name,
    userMessage: scenario.userMessage,
    scores,
    inspection: {
      characters: inspection.characters,
      tokensEstimate: inspection.tokensEstimate,
      sectionCount: inspection.sectionCount,
      averageSectionLength: inspection.averageSectionLength,
      instructionCount: inspection.instructionCount,
      instructionDensity: inspection.instructionDensity,
      redundancyScore: inspection.redundancyScore,
      complexityScore: inspection.complexityScore,
      duplicateTop: inspection.duplicates.slice(0, 3),
      clusters: inspection.clusters,
      contradictions: inspection.contradictions,
      summary: inspection.summary,
    },
    reply: finalText,
    providerCalls: turnCalls.length,
  })

  console.log(`=== ${scenario.name} ===`)
  console.log(`user: ${JSON.stringify(scenario.userMessage)}`)
  console.log('PROMPT INSPECTOR:')
  console.log(
    `  chars=${inspection.characters}  tokens≈${inspection.tokensEstimate}  sections=${inspection.sectionCount}  avgSection=${inspection.averageSectionLength}`,
  )
  console.log(
    `  instructions=${inspection.instructionCount}  density=${inspection.instructionDensity}  redundancy=${fmt(inspection.redundancyScore)}  complexity=${fmt(inspection.complexityScore)}`,
  )
  if (inspection.duplicates[0]) {
    console.log(
      `  top duplicate (${inspection.duplicates[0].count}×): ${inspection.duplicates[0].text.slice(0, 90)}`,
    )
  }
  if (inspection.clusters.length) {
    console.log(
      `  clusters: ${inspection.clusters
        .slice(0, 4)
        .map((c) => `${c.cluster}:${c.count}`)
        .join(' | ')}`,
    )
  }
  console.log(`  summary: ${inspection.summary}`)
  console.log('REPLY:')
  console.log(`  ${finalText}`)
  console.log(
    `  reviewer=${fmt(scores.reviewScore)} (${scores.reviewDecision})  identity=${fmt(scores.identityScore)}  fidelity=${fmt(scores.fidelityScore)}  rewrite=${scores.rewritten ? 'yes' : 'no'}  calls=${turnCalls.length}`,
  )
  console.log('')
}

const rewritten = rows.filter((r) => r.scores.rewritten)
const kept = rows.filter((r) => !r.scores.rewritten)

/**
 * @param {any[]} list
 * @param {(r: any) => number|null|undefined} pick
 */
function avg(list, pick) {
  const vals = list.map(pick).filter((n) => typeof n === 'number')
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

const summary = {
  inspectorVersion: PROMPT_INSPECTOR_VERSION,
  plannerVersion: PLANNER_VERSION,
  writerVersion: WRITER_VERSION,
  pipelineVersion: PIPELINE_VERSION,
  model,
  turns: rows.length,
  rewriteRate: rows.length ? rewritten.length / rows.length : 0,
  avgTokensAll: avg(rows, (r) => r.inspection.tokensEstimate),
  avgTokensRewritten: avg(rewritten, (r) => r.inspection.tokensEstimate),
  avgTokensKept: avg(kept, (r) => r.inspection.tokensEstimate),
  avgRedundancyAll: avg(rows, (r) => r.inspection.redundancyScore),
  avgRedundancyRewritten: avg(rewritten, (r) => r.inspection.redundancyScore),
  avgRedundancyKept: avg(kept, (r) => r.inspection.redundancyScore),
  avgComplexityAll: avg(rows, (r) => r.inspection.complexityScore),
  avgComplexityRewritten: avg(rewritten, (r) => r.inspection.complexityScore),
  avgComplexityKept: avg(kept, (r) => r.inspection.complexityScore),
  avgReviewer: avg(rows, (r) => r.scores.reviewScore),
  avgIdentity: avg(rows, (r) => r.scores.identityScore),
  avgFidelity: avg(rows, (r) => r.scores.fidelityScore),
  rows,
}

const outPath = '/tmp/v2-prompt-inspector-lab.json'
writeFileSync(outPath, JSON.stringify(summary, null, 2))

console.log('=== CORRELATION SNAPSHOT (rewrite vs prompt shape) ===')
console.log(
  `rewrite rate:              ${(summary.rewriteRate * 100).toFixed(0)}% (${rewritten.length}/${rows.length})`,
)
console.log(
  `avg tokens:                all=${fmt(summary.avgTokensAll)}  rewritten=${fmt(summary.avgTokensRewritten)}  kept=${fmt(summary.avgTokensKept)}`,
)
console.log(
  `avg redundancy:            all=${fmt(summary.avgRedundancyAll)}  rewritten=${fmt(summary.avgRedundancyRewritten)}  kept=${fmt(summary.avgRedundancyKept)}`,
)
console.log(
  `avg complexity:            all=${fmt(summary.avgComplexityAll)}  rewritten=${fmt(summary.avgComplexityRewritten)}  kept=${fmt(summary.avgComplexityKept)}`,
)
console.log(
  `avg reviewer/identity/fid: ${fmt(summary.avgReviewer)} / ${fmt(summary.avgIdentity)} / ${fmt(summary.avgFidelity)}`,
)
console.log(`saved ${outPath}`)
