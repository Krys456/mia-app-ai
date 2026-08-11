#!/usr/bin/env node
/**
 * LAIfe V2 — Conversation Lab
 *
 * Automatic conversational quality evaluation harness.
 * Uses the existing V2 pipeline + Reviewer (+ one optional rewrite).
 * Does not modify runtime modules, V1, or api/chat.ts.
 * Does not invent prompts — Writer/Reviewer contracts only.
 *
 * Usage:
 *   node --env-file=.env lib/server/v2/lab/conversation-lab.mjs
 *   node --env-file=.env lib/server/v2/lab/conversation-lab.mjs --messages path/to/messages.json
 *   node --env-file=.env lib/server/v2/lab/conversation-lab.mjs --limit 5 --out ./lab-out
 *
 * Env:
 *   OPENAI_API_KEY     required
 *   OPENAI_MODEL       optional (default gpt-4o-mini)
 *   OPENAI_TIMEOUT_MS  optional (default 60000)
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPipeline, DEFAULT_FOUNDATION } from '../brain/pipeline.js'
import { createWriter } from '../brain/writer.js'
import { createReviewer } from '../brain/reviewer.js'
import { createOpenAIProvider } from '../providers/openai-provider.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_MESSAGES_PATH = path.join(__dirname, 'fixtures', 'default-messages.json')
const DEFAULT_OUT_DIR = path.join(__dirname, 'results')
const DEFAULT_MODEL = 'gpt-4o-mini'

/** Report headline metrics (avg of per-turn score.metrics). */
const REPORT_METRIC_LABELS = [
  { key: 'conversationDelight', label: 'Conversation Delight' },
  { key: 'identityConsistency', label: 'Identity' },
  { key: 'respectOfPlanner', label: 'Planner Compliance' },
  { key: 'naturalness', label: 'Naturalness' },
  { key: 'specificity', label: 'Specificity' },
]

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ messagesPath: string, outDir: string, limit: number | null, isolated: boolean }} */
  const opts = {
    messagesPath: DEFAULT_MESSAGES_PATH,
    outDir: DEFAULT_OUT_DIR,
    limit: null,
    isolated: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--messages' && argv[i + 1]) {
      opts.messagesPath = path.resolve(argv[++i])
    } else if (a === '--out' && argv[i + 1]) {
      opts.outDir = path.resolve(argv[++i])
    } else if (a === '--limit' && argv[i + 1]) {
      opts.limit = Math.max(1, Number(argv[++i]) || 1)
    } else if (a === '--isolated') {
      // Each message is an independent turn (default). Kept for clarity.
      opts.isolated = true
    } else if (a === '--help' || a === '-h') {
      printHelp()
      process.exit(0)
    }
  }
  return opts
}

function printHelp() {
  console.log(`LAIfe V2 Conversation Lab

Usage:
  node --env-file=.env lib/server/v2/lab/conversation-lab.mjs [options]

Options:
  --messages <path>   JSON array of user messages (default: fixtures/default-messages.json)
  --out <dir>         Output directory for report JSON (default: lib/server/v2/lab/results)
  --limit <n>         Run only the first n messages
  --help              Show help
`)
}

/**
 * @param {string} filePath
 * @returns {Promise<string[]>}
 */
async function loadMessages(filePath) {
  const raw = await readFile(filePath, 'utf8')
  const data = JSON.parse(raw)
  if (!Array.isArray(data)) {
    throw new Error(`Messages file must be a JSON array: ${filePath}`)
  }
  return data
    .map((m) => (typeof m === 'string' ? m.trim() : ''))
    .filter(Boolean)
}

/**
 * @returns {Promise<{
 *   timedWriter: { write: Function },
 *   reviewer: ReturnType<typeof createReviewer>,
 *   pipeline: ReturnType<typeof createPipeline>,
 *   getWriterMs: () => number,
 *   resetWriterMs: () => void,
 *   model: string,
 *   personalityFoundation: string,
 * }>}
 */
async function bootstrap() {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    console.error('Missing OPENAI_API_KEY. Set it before running the Conversation Lab.')
    process.exit(1)
  }

  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS) || 60_000

  const OpenAI = (await import('openai')).default
  const client = new OpenAI({ apiKey })
  const openaiProvider = createOpenAIProvider({
    client,
    defaultModel: model,
    timeoutMs,
  })

  const writer = createWriter({
    providers: { [openaiProvider.id]: openaiProvider },
    defaultProviderId: openaiProvider.id,
    defaultModelByProvider: { [openaiProvider.id]: model },
  })

  let writerMs = 0
  const timedWriter = {
    version: writer.version,
    /** @param {any} request */
    async write(request) {
      const t0 = performance.now()
      try {
        return await writer.write(request)
      } finally {
        writerMs += performance.now() - t0
      }
    },
  }

  const reviewer = createReviewer()
  const personalityFoundation = DEFAULT_FOUNDATION
  const pipeline = createPipeline({
    writer: timedWriter,
    personalityFoundation,
  })

  return {
    timedWriter,
    reviewer,
    pipeline,
    getWriterMs: () => writerMs,
    resetWriterMs: () => {
      writerMs = 0
    },
    model,
    personalityFoundation,
  }
}

/**
 * @param {object} ctx
 * @param {string} userMessage
 * @param {number} index
 */
async function runCase(ctx, userMessage, index) {
  ctx.resetWriterMs()
  const totalT0 = performance.now()

  const pipelineResult = await ctx.pipeline.runConversation({
    userMessage,
    messages: [],
    providerId: 'openai',
    model: ctx.model,
    metadata: { requestId: `lab-${index}-${Date.now()}` },
  })

  const messages = [{ role: 'user', content: userMessage }]
  const writerRequest = {
    personalityFoundation: ctx.personalityFoundation,
    decision: pipelineResult.decision,
    plan: pipelineResult.plan,
    messages,
    mode: 'draft',
    providerId: 'openai',
    model: ctx.model,
  }

  const reviewT0 = performance.now()
  const review = ctx.reviewer.review({
    writerRequest,
    writerResponse: pipelineResult.response,
    plan: pipelineResult.plan,
  })
  const reviewerMs = performance.now() - reviewT0

  let finalResponse = pipelineResult.response
  let didRewrite = false
  let rewriteResponse = null

  if (review.decision === 'REWRITE') {
    rewriteResponse = await ctx.timedWriter.write({
      personalityFoundation: ctx.personalityFoundation,
      decision: pipelineResult.decision,
      plan: pipelineResult.plan,
      messages,
      mode: 'rewrite',
      rewriteHints: review.rewriteHints,
      previousDraft: pipelineResult.response?.text || '',
      providerId: 'openai',
      model: ctx.model,
      metadata: { requestId: `lab-rewrite-${index}-${Date.now()}` },
      memoryPack: null,
    })
    finalResponse = rewriteResponse
    didRewrite = true
  }

  const totalMs = performance.now() - totalT0
  const writerMs = ctx.getWriterMs()
  const draftText = String(pipelineResult.response?.text || '')
  const finalText = String(finalResponse?.text || '')

  return {
    index,
    userMessage,
    perception: pipelineResult.perception,
    decision: pipelineResult.decision,
    plan: pipelineResult.plan,
    response: {
      draft: draftText,
      final: finalText,
      text: finalText,
      rewritten: didRewrite,
      finishReason: finalResponse?.finishReason,
      usage: finalResponse?.usage,
      model: finalResponse?.model,
      providerId: finalResponse?.providerId,
    },
    review: {
      decision: review.decision,
      summary: review.summary,
      score: review.score,
      problems: review.problems,
      rewriteHints: review.rewriteHints,
    },
    rewrite: didRewrite,
    timing: {
      totalMs,
      writerMs,
      reviewerMs,
      totalSeconds: Number((totalMs / 1000).toFixed(3)),
    },
    metrics: { ...(review.score?.metrics || {}) },
    score: review.score?.overall ?? 0,
    reviewDecision: review.decision,
  }
}

/**
 * @param {number[]} values
 */
function average(values) {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * @param {number} ratio 0..1
 */
function pct(ratio) {
  return `${Math.round(ratio * 100)}%`
}

/**
 * @param {any[]} cases
 */
function buildReport(cases) {
  const scores = cases.map((c) => Number(c.score) || 0)
  const rewriteCount = cases.filter((c) => c.rewrite).length
  const times = cases.map((c) => Number(c.timing?.totalMs) || 0)

  /** @type {Record<string, number>} */
  const metricAverages = {}
  for (const { key } of REPORT_METRIC_LABELS) {
    metricAverages[key] = average(
      cases.map((c) => Number(c.metrics?.[key])).filter((n) => Number.isFinite(n)),
    )
  }

  // All metric keys present across runs
  const allMetricKeys = new Set()
  for (const c of cases) {
    for (const k of Object.keys(c.metrics || {})) allMetricKeys.add(k)
  }
  /** @type {Record<string, number>} */
  const allMetricAverages = {}
  for (const key of [...allMetricKeys].sort()) {
    allMetricAverages[key] = average(
      cases.map((c) => Number(c.metrics?.[key])).filter((n) => Number.isFinite(n)),
    )
  }

  const rankedBest = [...cases].sort((a, b) => b.score - a.score)
  const rankedWorst = [...cases].sort((a, b) => a.score - b.score)
  const rewritten = cases
    .filter((c) => c.rewrite)
    .sort((a, b) => a.score - b.score)
  const mostGeneric = [...cases].sort((a, b) => {
    const ga =
      (Number(a.metrics?.specificity) || 0) + (Number(a.metrics?.conversationDelight) || 0)
    const gb =
      (Number(b.metrics?.specificity) || 0) + (Number(b.metrics?.conversationDelight) || 0)
    return ga - gb
  })
  const mostDelightful = [...cases].sort(
    (a, b) =>
      (Number(b.metrics?.conversationDelight) || 0) -
      (Number(a.metrics?.conversationDelight) || 0),
  )

  /**
   * @param {any[]} list
   * @param {number} [n]
   */
  function topN(list, n = 10) {
    return list.slice(0, n).map((c) => ({
      index: c.index,
      userMessage: c.userMessage,
      score: c.score,
      reviewDecision: c.reviewDecision,
      rewrite: c.rewrite,
      conversationDelight: c.metrics?.conversationDelight,
      specificity: c.metrics?.specificity,
      identityConsistency: c.metrics?.identityConsistency,
      response: c.response?.text,
    }))
  }

  return {
    generatedAt: new Date().toISOString(),
    sampleSize: cases.length,
    headline: {
      conversationDelight: metricAverages.conversationDelight,
      identity: metricAverages.identityConsistency,
      plannerCompliance: metricAverages.respectOfPlanner,
      naturalness: metricAverages.naturalness,
      specificity: metricAverages.specificity,
      averageScore: average(scores),
      rewriteRate: cases.length ? rewriteCount / cases.length : 0,
      averageResponseTimeSeconds: average(times) / 1000,
    },
    metricAverages: allMetricAverages,
    top10: {
      bestResponses: topN(rankedBest),
      worstResponses: topN(rankedWorst),
      mostRewritten: topN(rewritten),
      mostGeneric: topN(mostGeneric),
      mostDelightful: topN(mostDelightful),
    },
  }
}

/**
 * @param {ReturnType<typeof buildReport>} report
 */
function printReport(report) {
  const h = report.headline
  console.log('\n========== CONVERSATION LAB REPORT ==========')
  console.log(`Sample size: ${report.sampleSize}`)
  console.log('')
  console.log(`Conversation Delight     ${pct(h.conversationDelight)}`)
  console.log(`Identity                 ${pct(h.identity)}`)
  console.log(`Planner Compliance       ${pct(h.plannerCompliance)}`)
  console.log(`Naturalness              ${pct(h.naturalness)}`)
  console.log(`Specificity              ${pct(h.specificity)}`)
  console.log('')
  console.log(`Average Score            ${h.averageScore.toFixed(2)}`)
  console.log(`Rewrite Rate             ${pct(h.rewriteRate)}`)
  console.log(`Average Response Time    ${h.averageResponseTimeSeconds.toFixed(1)} s`)
  console.log('')

  /**
   * @param {string} title
   * @param {any[]} rows
   */
  function printTop(title, rows) {
    console.log(`--- TOP: ${title} ---`)
    if (!rows.length) {
      console.log('(none)')
      console.log('')
      return
    }
    rows.forEach((row, i) => {
      const preview = String(row.response || '').replace(/\s+/g, ' ').slice(0, 96)
      console.log(
        `${i + 1}. [#${row.index}] score=${Number(row.score).toFixed(2)} rewrite=${row.rewrite ? 'yes' : 'no'} | "${row.userMessage}"`,
      )
      console.log(`   → ${preview}${preview.length >= 96 ? '…' : ''}`)
    })
    console.log('')
  }

  printTop('Best responses', report.top10.bestResponses)
  printTop('Worst responses', report.top10.worstResponses)
  printTop('Most rewritten', report.top10.mostRewritten)
  printTop('Most generic', report.top10.mostGeneric)
  printTop('Most delightful', report.top10.mostDelightful)
  console.log('=============================================')
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  let messages = await loadMessages(opts.messagesPath)
  if (opts.limit != null) messages = messages.slice(0, opts.limit)

  if (!messages.length) {
    console.error('No messages to evaluate.')
    process.exit(1)
  }

  console.log('LAIfe V2 Conversation Lab')
  console.log(`messages: ${messages.length} from ${opts.messagesPath}`)
  console.log('Pipeline: Perception → Mind → Planner → Writer → Reviewer (+ optional rewrite)')
  console.log('')

  const ctx = await bootstrap()
  console.log(`model: ${ctx.model}`)

  /** @type {any[]} */
  const cases = []
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]
    process.stdout.write(`[${i + 1}/${messages.length}] ${JSON.stringify(msg)} ... `)
    try {
      const result = await runCase(ctx, msg, i)
      cases.push(result)
      console.log(
        `${result.reviewDecision} score=${result.score.toFixed(2)} rewrite=${result.rewrite ? 'yes' : 'no'} ${result.timing.totalSeconds}s`,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined
      console.log('ERROR')
      console.error(`  ${code ? `${code}: ` : ''}${message}`)
      cases.push({
        index: i,
        userMessage: msg,
        error: { code, message },
        response: { text: '', draft: '', final: '', rewritten: false },
        review: null,
        rewrite: false,
        timing: { totalMs: 0, writerMs: 0, reviewerMs: 0, totalSeconds: 0 },
        metrics: {},
        score: 0,
        reviewDecision: 'ERROR',
      })
    }
  }

  const successful = cases.filter((c) => c.reviewDecision !== 'ERROR')
  const artifact = {
    version: '2.0.0-conversation-lab',
    options: {
      messagesPath: opts.messagesPath,
      outDir: opts.outDir,
      model: ctx.model,
    },
    cases,
    report: buildReport(successful),
  }

  const printable =
    artifact.report.sampleSize > 0
      ? artifact.report
      : {
          ...buildReport([]),
          sampleSize: 0,
          headline: {
            conversationDelight: 0,
            identity: 0,
            plannerCompliance: 0,
            naturalness: 0,
            specificity: 0,
            averageScore: 0,
            rewriteRate: 0,
            averageResponseTimeSeconds: 0,
          },
        }

  printReport(printable)

  await mkdir(opts.outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const latestPath = path.join(opts.outDir, 'latest.json')
  const stampedPath = path.join(opts.outDir, `lab-${stamp}.json`)
  const json = JSON.stringify(artifact, null, 2)
  await writeFile(latestPath, json, 'utf8')
  await writeFile(stampedPath, json, 'utf8')

  console.log(`\nSaved: ${latestPath}`)
  console.log(`Saved: ${stampedPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
