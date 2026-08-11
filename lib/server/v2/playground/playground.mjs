#!/usr/bin/env node
/**
 * LAIfe V2 — Playground
 *
 * Terminal harness for Perception → Mind → Planner → Writer → Reviewer
 * (+ one optional Writer rewrite). Does not touch V1 or api/chat.ts.
 *
 * Usage:
 *   node lib/server/v2/playground/playground.mjs
 *   node lib/server/v2/playground/playground.mjs "Ciao, come stai?"
 *
 * Env:
 *   OPENAI_API_KEY   required
 *   OPENAI_MODEL     optional (default gpt-4o-mini)
 *   OPENAI_TIMEOUT_MS optional (default 60000)
 */

import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import { createPipeline, DEFAULT_FOUNDATION } from '../brain/pipeline.js'
import { createWriter } from '../brain/writer.js'
import { createReviewer } from '../brain/reviewer.js'
import { createOpenAIProvider } from '../providers/openai-provider.js'

const DEFAULT_MODEL = 'gpt-4o-mini'

/**
 * @param {unknown} value
 * @param {number} [space]
 */
function pretty(value, space = 2) {
  return JSON.stringify(value, null, space)
}

/**
 * @param {string} title
 * @param {unknown} value
 */
function printSection(title, value) {
  console.log(`\n=== ${title} ===`)
  if (typeof value === 'string') {
    console.log(value)
  } else {
    console.log(pretty(value))
  }
}

/**
 * @param {number} ms
 */
function formatMs(ms) {
  return `${Math.round(ms)}ms`
}

/**
 * @returns {Promise<{
 *   writer: ReturnType<typeof createWriter>,
 *   timedWriter: { version: string, write: Function, writeStream: Function },
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
    console.error('Missing OPENAI_API_KEY. Set it before running the V2 playground.')
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
    /**
     * @param {any} request
     */
    async write(request) {
      const t0 = performance.now()
      try {
        return await writer.write(request)
      } finally {
        writerMs += performance.now() - t0
      }
    },
    writeStream: writer.writeStream.bind(writer),
  }

  const reviewer = createReviewer()
  const personalityFoundation = DEFAULT_FOUNDATION
  const pipeline = createPipeline({
    writer: timedWriter,
    personalityFoundation,
  })

  return {
    writer,
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
 * @param {{
 *   pipeline: ReturnType<typeof createPipeline>,
 *   timedWriter: { write: Function },
 *   reviewer: ReturnType<typeof createReviewer>,
 *   getWriterMs: () => number,
 *   resetWriterMs: () => void,
 *   model: string,
 *   personalityFoundation: string,
 * }} ctx
 * @param {string} userMessage
 * @param {Array<{ role: string, content: string }>} history
 */
async function runTurn(ctx, userMessage, history) {
  const trimmed = String(userMessage || '').trim()
  if (!trimmed) {
    console.log('(empty message — skipped)')
    return history
  }

  ctx.resetWriterMs()
  const totalT0 = performance.now()

  // Pipeline: Perception → Mind → Planner → Writer (draft)
  const result = await ctx.pipeline.runConversation({
    userMessage: trimmed,
    messages: history,
    providerId: 'openai',
    model: ctx.model,
    metadata: { requestId: `playground-${Date.now()}` },
  })

  const messages = [
    ...history,
    { role: 'user', content: trimmed },
  ]

  const writerRequest = {
    personalityFoundation: ctx.personalityFoundation,
    decision: result.decision,
    plan: result.plan,
    messages,
    mode: 'draft',
    providerId: 'openai',
    model: ctx.model,
  }

  const reviewT0 = performance.now()
  const review = ctx.reviewer.review({
    writerRequest,
    writerResponse: result.response,
    plan: result.plan,
  })
  const reviewerMs = performance.now() - reviewT0

  let finalResponse = result.response
  let didRewrite = false

  if (review.decision === 'REWRITE') {
    finalResponse = await ctx.timedWriter.write({
      personalityFoundation: ctx.personalityFoundation,
      decision: result.decision,
      plan: result.plan,
      messages,
      mode: 'rewrite',
      rewriteHints: review.rewriteHints,
      previousDraft: result.response?.text || '',
      providerId: 'openai',
      model: ctx.model,
      metadata: { requestId: `playground-rewrite-${Date.now()}` },
      memoryPack: null,
    })
    didRewrite = true
  }

  const totalMs = performance.now() - totalT0
  const writerMs = ctx.getWriterMs()

  printSection('PERCEPTION', result.perception)
  printSection('DECISION', result.decision)
  printSection('PLAN', result.plan)
  printSection(
    'RESPONSE',
    didRewrite
      ? {
          draft: result.response?.text || '',
          final: finalResponse?.text || '',
          rewritten: true,
          finishReason: finalResponse?.finishReason,
          usage: finalResponse?.usage,
          model: finalResponse?.model,
          providerId: finalResponse?.providerId,
        }
      : {
          text: finalResponse?.text || '',
          rewritten: false,
          finishReason: finalResponse?.finishReason,
          usage: finalResponse?.usage,
          model: finalResponse?.model,
          providerId: finalResponse?.providerId,
        },
  )
  printSection('REVIEW', {
    decision: review.decision,
    summary: review.summary,
    score: review.score,
    problems: review.problems,
    rewriteHints: review.rewriteHints,
  })

  console.log('\n=== TIMING ===')
  console.log(`tempo totale:    ${formatMs(totalMs)}`)
  console.log(`tempo Writer:    ${formatMs(writerMs)}`)
  console.log(`tempo Reviewer:  ${formatMs(reviewerMs)}`)
  console.log(`decision:        ${review.decision}`)
  console.log(`score:           ${review.score?.overall}`)
  console.log(`threshold:       ${review.score?.threshold}`)
  if (didRewrite) console.log('rewrite:         yes (1 call)')

  const nextHistory = [
    ...messages,
    { role: 'assistant', content: String(finalResponse?.text || '') },
  ]
  return nextHistory
}

async function main() {
  const ctx = await bootstrap()
  const argvMessage = process.argv.slice(2).join(' ').trim()

  console.log('LAIfe V2 playground')
  console.log(`model: ${ctx.model}`)
  console.log('Pipeline: Perception → Mind → Planner → Writer → Reviewer (+ optional rewrite)')
  console.log('Commands: empty line or "exit" / "quit" to leave.\n')

  /** @type {Array<{ role: string, content: string }>} */
  let history = []

  if (argvMessage) {
    try {
      await runTurn(ctx, argvMessage, history)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined
      console.error('\n[error]', code ? `${code}: ${message}` : message)
      process.exit(1)
    }
    return
  }

  const rl = readline.createInterface({ input, output })
  try {
    while (true) {
      const line = await rl.question('you> ')
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'exit' || trimmed === 'quit') {
        console.log('bye')
        break
      }
      try {
        history = await runTurn(ctx, trimmed, history)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined
        console.error('\n[error]', code ? `${code}: ${message}` : message)
      }
      console.log('')
    }
  } finally {
    rl.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
