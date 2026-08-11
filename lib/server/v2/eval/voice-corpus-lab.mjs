#!/usr/bin/env node
/**
 * LAIfe V2 — Voice Corpus Conversation Lab
 *
 * A/B: Writer 3.2 (no corpus) vs Writer 3.2 + Voice Corpus.
 * Both keep Voice Examples. Scores Reviewer / Identity / Fidelity / rewrite rate.
 * Prints 20 Before / After reply pairs.
 *
 * Usage:
 *   node lib/server/v2/eval/voice-corpus-lab.mjs
 *
 * Env:
 *   OPENAI_API_KEY   required
 *   OPENAI_MODEL     optional (default gpt-4o-mini)
 *
 * Measurement only. No new rules / cleaners / evaluators.
 */

import { createRequire } from 'module'
import { writeFileSync } from 'fs'

import { createPipeline, DEFAULT_FOUNDATION, PIPELINE_VERSION } from '../brain/pipeline.js'
import {
  createWriter,
  looksLikeGenericChatbot,
  WRITER_VERSION,
} from '../brain/writer.js'
import { VOICE_CORPUS, VOICE_CORPUS_VERSION } from '../brain/voice-corpus.js'
import { createReviewer } from '../brain/reviewer.js'
import { evaluateIdentity } from '../brain/identity-evaluator.js'
import { evaluatePlannerFidelity } from '../brain/planner-fidelity.js'
import { createOpenAIProvider } from '../providers/openai-provider.js'

const require = createRequire('/workspace/package.json')
const OpenAI = require('openai').default

const apiKey = process.env.OPENAI_API_KEY?.trim()
if (!apiKey) {
  console.error('OPENAI_API_KEY missing — cannot run Voice Corpus lab')
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

const providerBefore = makeProvider('writer-3.2')
const providerAfter = makeProvider('writer-3.2-corpus')

// Writer 3.2 baseline: voice examples on, corpus off
const writerBefore = createWriter({
  providers: { openai: providerBefore },
  defaultProviderId: 'openai',
  useVoiceExamples: true,
  useVoiceCorpus: false,
})
// Writer 3.2 + Voice Corpus
const writerAfter = createWriter({
  providers: { openai: providerAfter },
  defaultProviderId: 'openai',
  useVoiceExamples: true,
  useVoiceCorpus: true,
})

const pipelineBefore = createPipeline({
  writer: writerBefore,
  personalityFoundation: DEFAULT_FOUNDATION,
})
const pipelineAfter = createPipeline({
  writer: writerAfter,
  personalityFoundation: DEFAULT_FOUNDATION,
})
const reviewer = createReviewer()

/** 20 Conversation Lab scenarios for Before / After. */
/** @type {{ name: string, userMessage: string, messages?: { role: string, content: string }[] }[]} */
const SCENARIOS = [
  { name: '01-greeting-ciao', userMessage: 'Ciao' },
  { name: '02-greeting-buongiorno', userMessage: 'Buongiorno' },
  { name: '03-greeting-hey', userMessage: 'Hey' },
  { name: '04-how-are-you', userMessage: 'Come stai?' },
  { name: '05-come-va', userMessage: 'Come va?' },
  { name: '06-sad', userMessage: 'Sono triste.' },
  { name: '07-tired', userMessage: 'Sono stanco.' },
  { name: '08-afraid', userMessage: 'Ho paura di sbagliare.' },
  { name: '09-lost', userMessage: 'Mi sento perso.' },
  { name: '10-minimal-ok', userMessage: 'ok' },
  { name: '11-minimal-esatto', userMessage: 'esatto' },
  { name: '12-minimal-perfetto', userMessage: 'perfetto' },
  { name: '13-bug', userMessage: 'Il bug non si risolve.' },
  { name: '14-fotosintesi', userMessage: 'Spiegami la fotosintesi.' },
  { name: '15-prioritize', userMessage: 'Devo prioritizzare.' },
  { name: '16-plan-today', userMessage: 'Cosa facciamo oggi?' },
  { name: '17-natural-ideas', userMessage: 'Idee per rendere LAIfe più naturale?' },
  { name: '18-continue', userMessage: 'Continuiamo.' },
  {
    name: '19-resume-continuity',
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
  {
    name: '20-follow-up-laife',
    userMessage: 'Sto migliorando la V2.',
    messages: [
      { role: 'user', content: 'Sto lavorando su LAIfe.' },
      { role: 'assistant', content: 'A che punto sei arrivato?' },
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
  `Voice Corpus Lab — writer ${WRITER_VERSION} | corpus ${VOICE_CORPUS_VERSION} (${VOICE_CORPUS.length} dialogues) | pipeline ${PIPELINE_VERSION} — model ${model}`,
)
console.log('BEFORE = Writer 3.2 (voice examples, no corpus)')
console.log('AFTER  = Writer 3.2 + Voice Corpus')
console.log('')

/** @type {any[]} */
const rows = []
let rewritesBefore = 0
let rewritesAfter = 0

for (const scenario of SCENARIOS) {
  const history = Array.isArray(scenario.messages) ? scenario.messages : []
  const input = {
    userMessage: scenario.userMessage,
    messages: history.length ? history : [{ role: 'user', content: scenario.userMessage }],
    model,
    providerId: 'openai',
  }

  const outBefore = await pipelineBefore.runConversation(input)
  const outAfter = await pipelineAfter.runConversation(input)
  const before = scoreTurn(outBefore)
  const after = scoreTurn(outAfter)
  if (before.rewritten) rewritesBefore += 1
  if (after.rewritten) rewritesAfter += 1

  rows.push({
    name: scenario.name,
    userMessage: scenario.userMessage,
    before,
    after,
  })

  console.log(`=== ${scenario.name} ===`)
  console.log(`user: ${JSON.stringify(scenario.userMessage)}`)
  console.log('BEFORE (Writer 3.2):')
  console.log(`  ${before.text}`)
  console.log(
    `  reviewer=${fmt(before.reviewScore)} (${before.reviewDecision})  identity=${fmt(before.identityScore)}  genericity=${fmt(before.genericity)}  fidelity=${fmt(before.fidelityScore)}  rewrite=${before.rewritten ? 'yes' : 'no'}`,
  )
  console.log('AFTER  (Writer 3.2 + Voice Corpus):')
  console.log(`  ${after.text}`)
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
  voiceCorpusVersion: VOICE_CORPUS_VERSION,
  voiceCorpusCount: VOICE_CORPUS.length,
  turns: rows.length,
  rewriteRateBefore: rows.length ? rewritesBefore / rows.length : 0,
  rewriteRateAfter: rows.length ? rewritesAfter / rows.length : 0,
  identityRewritesBefore: rewritesBefore,
  identityRewritesAfter: rewritesAfter,
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

const outPath = '/tmp/v2-voice-corpus-lab.json'
writeFileSync(outPath, JSON.stringify(summary, null, 2))

console.log('=== 20 BEFORE / AFTER ===')
for (const row of rows) {
  console.log(`— ${row.name} —`)
  console.log(`  user:    ${row.userMessage}`)
  console.log(`  before:  ${row.before.text}`)
  console.log(`  after:   ${row.after.text}`)
}
console.log('')

console.log('=== SUMMARY ===')
console.log(`writer:           ${WRITER_VERSION}`)
console.log(`voice corpus:     ${VOICE_CORPUS.length} (${VOICE_CORPUS_VERSION})`)
console.log(
  `rewrite rate:     ${(summary.rewriteRateBefore * 100).toFixed(0)}% → ${(summary.rewriteRateAfter * 100).toFixed(0)}% (${rewritesBefore}/${rows.length} → ${rewritesAfter}/${rows.length})`,
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
