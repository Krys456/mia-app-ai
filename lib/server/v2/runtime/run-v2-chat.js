/**
 * LAIfe V2 chat runner — Perception → Mind → Planner → Writer → Reviewer → Response
 * (+ at most one Writer rewrite via Rewrite Contract).
 *
 * Used by api/chat.ts when LAIFE_ENGINE=v2.
 * On failure the caller must fall back to V1.
 * No V1 imports. Does not mutate Planner/Mind/Perception modules.
 */

import { createPipeline, DEFAULT_FOUNDATION } from '../brain/pipeline.js'
import { createWriter } from '../brain/writer.js'
import { createReviewer } from '../brain/reviewer.js'
import { createOpenAIProvider } from '../providers/openai-provider.js'

const LOG_PREFIX = '[laife-v2]'

/**
 * @param {'info'|'warn'|'error'} level
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 */
export function logV2(level, message, extra) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : ''
  const line = `${LOG_PREFIX} ${message}${payload}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/**
 * @typedef {object} V2ChatMessage
 * @property {string} role
 * @property {string} content
 */

/**
 * @typedef {object} V2ChatInput
 * @property {any} client  OpenAI SDK client (injected; mockable)
 * @property {V2ChatMessage[]} messages
 * @property {string} [model]
 * @property {string} [displayName]
 * @property {AbortSignal} [abortSignal]
 * @property {string} [requestId]
 * @property {number} [timeoutMs]
 * @property {import('../brain/writer.js').WriterProvider} [provider]  test injection
 * @property {ReturnType<typeof createWriter>} [writer]  test injection
 * @property {ReturnType<typeof createReviewer>} [reviewer]  test injection
 * @property {string|object} [personalityFoundation]
 */

/**
 * @typedef {object} V2ChatResult
 * @property {string} content
 * @property {string} draftText
 * @property {'PASS'|'REWRITE'} reviewDecision
 * @property {boolean} rewritten
 * @property {number} score
 * @property {Record<string, number>} metrics
 * @property {object} perception
 * @property {object} decision
 * @property {object} plan
 * @property {object} review
 * @property {{ totalMs: number, writerMs: number, reviewerMs: number }} timing
 * @property {string} model
 * @property {string} providerId
 */

/**
 * @param {V2ChatMessage[]} messages
 */
function lastUserContent(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (m && m.role === 'user' && String(m.content || '').trim()) {
      return String(m.content).trim()
    }
  }
  return ''
}

/**
 * Run the full V2 conversation slice for one HTTP turn.
 * Throws on hard failures (caller falls back to V1).
 *
 * @param {V2ChatInput} input
 * @returns {Promise<V2ChatResult>}
 */
export async function runV2ChatConversation(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('runV2ChatConversation requires an input object')
  }

  const messages = Array.isArray(input.messages) ? input.messages : []
  const userMessage = lastUserContent(messages)
  if (!userMessage) {
    throw new Error('runV2ChatConversation requires a user message')
  }

  const model = String(input.model || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim()
  const timeoutMs =
    typeof input.timeoutMs === 'number' && input.timeoutMs > 0
      ? input.timeoutMs
      : Number(process.env.OPENAI_TIMEOUT_MS) || 60_000
  const requestId = input.requestId || `v2-${Date.now()}`
  const personalityFoundation = input.personalityFoundation ?? DEFAULT_FOUNDATION

  const totalT0 = performance.now()
  let writerMs = 0

  /** @type {import('../brain/writer.js').WriterProvider} */
  let provider = input.provider
  if (!provider) {
    if (!input.client) {
      throw new Error('runV2ChatConversation requires client or provider')
    }
    provider = createOpenAIProvider({
      client: input.client,
      defaultModel: model,
      timeoutMs,
    })
  }

  const writer =
    input.writer ||
    createWriter({
      providers: { [provider.id]: provider },
      defaultProviderId: provider.id,
      defaultModelByProvider: { [provider.id]: model },
    })

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
    writeStream: writer.writeStream?.bind(writer),
  }

  const reviewer = input.reviewer || createReviewer()
  const pipeline = createPipeline({
    writer: timedWriter,
    personalityFoundation,
  })

  logV2('info', 'run start', { requestId, model, userLen: userMessage.length })

  const pipelineResult = await pipeline.runConversation({
    userMessage,
    messages,
    providerId: provider.id,
    model,
    abortSignal: input.abortSignal,
    metadata: { requestId },
    ...(input.displayName
      ? { preferences: { displayName: String(input.displayName).slice(0, 40) } }
      : {}),
  })

  const draftText = String(pipelineResult.response?.text || '')
  if (!draftText.trim()) {
    throw new Error('V2 Writer returned empty draft')
  }

  const writerRequest = {
    personalityFoundation,
    decision: pipelineResult.decision,
    plan: pipelineResult.plan,
    messages: messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'system'))
      .map((m) => ({ role: m.role, content: String(m.content || '') })),
    mode: 'draft',
    providerId: provider.id,
    model,
  }

  const reviewT0 = performance.now()
  const review = reviewer.review({
    writerRequest,
    writerResponse: pipelineResult.response,
    plan: pipelineResult.plan,
  })
  const reviewerMs = performance.now() - reviewT0

  let finalResponse = pipelineResult.response
  let rewritten = false

  if (review.decision === 'REWRITE') {
    logV2('info', 'rewrite requested', {
      requestId,
      score: review.score?.overall,
      mustFix: review.rewriteHints?.mustFix?.length || 0,
    })
    finalResponse = await timedWriter.write({
      personalityFoundation,
      decision: pipelineResult.decision,
      plan: pipelineResult.plan,
      messages: writerRequest.messages,
      mode: 'rewrite',
      rewriteHints: review.rewriteHints,
      previousDraft: draftText,
      providerId: provider.id,
      model,
      abortSignal: input.abortSignal,
      metadata: { requestId: `${requestId}-rewrite` },
      memoryPack: null,
    })
    rewritten = true
  }

  const content = String(finalResponse?.text || '').trim()
  if (!content) {
    throw new Error('V2 produced empty content after review/rewrite')
  }

  const totalMs = performance.now() - totalT0
  logV2('info', 'run success', {
    requestId,
    reviewDecision: review.decision,
    rewritten,
    score: review.score?.overall,
    totalMs: Math.round(totalMs),
    contentLen: content.length,
  })

  return {
    content,
    draftText,
    reviewDecision: review.decision,
    rewritten,
    score: Number(review.score?.overall) || 0,
    metrics: { ...(review.score?.metrics || {}) },
    perception: pipelineResult.perception,
    decision: pipelineResult.decision,
    plan: pipelineResult.plan,
    review,
    timing: {
      totalMs,
      writerMs,
      reviewerMs,
    },
    model: String(finalResponse?.model || model),
    providerId: String(finalResponse?.providerId || provider.id),
  }
}

/**
 * Attempt V2; return null on any failure (caller falls back to V1).
 * Never throws.
 *
 * @param {V2ChatInput} input
 * @returns {Promise<V2ChatResult | null>}
 */
export async function tryV2ChatConversation(input) {
  try {
    return await runV2ChatConversation(input)
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : err && typeof err === 'object' && typeof /** @type {any} */ (err).message === 'string'
          ? /** @type {any} */ (err).message
          : String(err)
    const code =
      err && typeof err === 'object' && typeof /** @type {any} */ (err).code === 'string'
        ? /** @type {any} */ (err).code
        : undefined
    logV2('error', 'failed — caller should fall back to V1', {
      code: code || null,
      message,
    })
    return null
  }
}
