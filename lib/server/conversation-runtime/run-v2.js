/**
 * V2 chat adapter — thin bridge from /api/chat contract → V2 pipeline.
 *
 * Does not duplicate V2 business logic. Maps PipelineResult → Chat API JSON.
 */

import { createRequire } from 'module'
import { applyCors, sendJson } from '../http.js'
import { createPipeline, DEFAULT_FOUNDATION } from '../v2/brain/pipeline.js'
import { createWriter, isWriterError } from '../v2/brain/writer.js'
import { createOpenAIProvider } from '../v2/providers/openai-provider.js'
import { plan } from '../v2/brain/planner.js'

const require = createRequire(import.meta.url)

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

/**
 * @param {unknown} raw
 * @returns {{ role: string, content: string }[]}
 */
export function sanitizeChatMessages(raw) {
  if (!Array.isArray(raw)) return []
  /** @type {{ role: string, content: string }[]} */
  const out = []
  for (const item of raw.slice(-40)) {
    if (!item || typeof item !== 'object') continue
    const role = asString(/** @type {any} */ (item).role).toLowerCase()
    const content = asString(/** @type {any} */ (item).content).trim()
    if (!content) continue
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue
    out.push({ role, content })
  }
  return out
}

/**
 * @param {unknown} body
 * @returns {object}
 */
export function parseChatBody(body) {
  if (body == null) return {}
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 })
    }
  }
  if (typeof body === 'object') return /** @type {object} */ (body)
  return {}
}

/**
 * Map V2 pipeline result (+ request echoes) to V1 Chat API success payload.
 * @param {{
 *   pipelineResult: {
 *     response?: { text?: string, model?: string, providerId?: string },
 *     perception?: unknown,
 *     decision?: unknown,
 *     plan?: unknown,
 *     conversationState?: unknown,
 *     nextConversationState?: unknown,
 *     contractEvaluation?: unknown,
 *   },
 *   requestBody?: Record<string, unknown>,
 *   runtime?: 'v1'|'v2',
 *   includeDebug?: boolean,
 * }} args
 */
export function mapV2ResultToChatResponse(args) {
  const pipelineResult = args.pipelineResult || {}
  const requestBody =
    args.requestBody && typeof args.requestBody === 'object' ? args.requestBody : {}
  const text = asString(pipelineResult.response?.text).trim()
  if (!text) {
    throw Object.assign(new Error('Empty response from OpenAI'), {
      statusCode: 502,
      code: 'empty_response',
    })
  }

  /** @type {Record<string, unknown>} */
  const payload = {
    content: text,
    runtime: args.runtime === 'v1' ? 'v1' : 'v2',
    memoryEvent: null,
    learningSignals:
      requestBody.learningSignals && typeof requestBody.learningSignals === 'object'
        ? requestBody.learningSignals
        : null,
  }

  if (requestBody.voiceSession && typeof requestBody.voiceSession === 'object') {
    payload.voiceSession = requestBody.voiceSession
  }
  if (requestBody.welcomeSession && typeof requestBody.welcomeSession === 'object') {
    payload.welcomeSession = requestBody.welcomeSession
  }
  if (
    requestBody.conversationMemoryMap &&
    typeof requestBody.conversationMemoryMap === 'object'
  ) {
    payload.conversationMemoryMap = requestBody.conversationMemoryMap
  }
  if (
    requestBody.conversationPreferenceProfile &&
    typeof requestBody.conversationPreferenceProfile === 'object'
  ) {
    payload.conversationPreferenceProfile = requestBody.conversationPreferenceProfile
  }
  if (requestBody.pendingAutomation !== undefined) {
    payload.pendingAutomation = requestBody.pendingAutomation
  }

  // Phase 3: persist Conversation State as session working memory (client echo).
  // Not durable Memory V2 / Supabase.
  if (
    pipelineResult.nextConversationState &&
    typeof pipelineResult.nextConversationState === 'object'
  ) {
    payload.conversationState = pipelineResult.nextConversationState
  }

  if (args.includeDebug !== false) {
    const v2Debug = buildV2DebugInfo(pipelineResult)
    if (v2Debug) payload.v2Debug = v2Debug
  }

  return payload
}

/**
 * Build optional developer debug snapshot from a PipelineResult (no private reasoning).
 * @param {{
 *   response?: { text?: string, model?: string, providerId?: string },
 *   perception?: unknown,
 *   decision?: unknown,
 *   plan?: unknown,
 *   conversationState?: unknown,
 *   nextConversationState?: unknown,
 *   contractEvaluation?: unknown,
 * }} [pipelineResult]
 */
export function buildV2DebugInfo(pipelineResult) {
  if (!pipelineResult || typeof pipelineResult !== 'object') return null
  const text = asString(pipelineResult.response?.text).trim()
  /** @type {Record<string, unknown>} */
  const debug = {
    servedBy: 'v2',
  }
  if (pipelineResult.perception && typeof pipelineResult.perception === 'object') {
    debug.perception = pipelineResult.perception
  }
  if (pipelineResult.decision && typeof pipelineResult.decision === 'object') {
    debug.decision = pipelineResult.decision
  }
  if (pipelineResult.plan && typeof pipelineResult.plan === 'object') {
    debug.plan = pipelineResult.plan
  }
  // Sanitized structured Conversation State only (no diagnostics / chain-of-thought).
  if (
    pipelineResult.nextConversationState &&
    typeof pipelineResult.nextConversationState === 'object'
  ) {
    debug.conversationState = pipelineResult.nextConversationState
  } else if (
    pipelineResult.conversationState &&
    typeof pipelineResult.conversationState === 'object'
  ) {
    const cs = /** @type {any} */ (pipelineResult.conversationState)
    debug.conversationState = {
      activeTopic: cs.activeTopic ?? null,
      activeGoal: cs.activeGoal ?? null,
      conversationMode: cs.conversationMode ?? null,
      conversationPhase: cs.conversationPhase ?? null,
      engagement: cs.engagement ?? null,
      pendingProposal: cs.pendingProposal ?? null,
      shortReply: cs.shortReply
        ? { intent: cs.shortReply.intent, confidence: cs.shortReply.confidence }
        : null,
      continuity: cs.continuity ?? null,
    }
  }
  if (
    pipelineResult.contractEvaluation &&
    typeof pipelineResult.contractEvaluation === 'object'
  ) {
    const ce = /** @type {any} */ (pipelineResult.contractEvaluation)
    debug.contractEvaluation = {
      ok: Boolean(ce.ok),
      needsRewrite: Boolean(ce.needsRewrite),
      rewritten: Boolean(ce.rewritten),
      violations: Array.isArray(ce.violations)
        ? ce.violations.map((v) => ({ code: v.code, severity: v.severity }))
        : [],
    }
  }
  // Sanitized adaptive response profile (no inference signals required in debug).
  const planObj =
    pipelineResult.plan && typeof pipelineResult.plan === 'object'
      ? /** @type {any} */ (pipelineResult.plan)
      : null
  const rp =
    planObj?.responseProfile ||
    planObj?.writerBrief?.responseProfile ||
    (pipelineResult.nextConversationState &&
    typeof pipelineResult.nextConversationState === 'object'
      ? /** @type {any} */ (pipelineResult.nextConversationState).responseProfile
      : null)
  if (rp && typeof rp === 'object' && rp.tone) {
    debug.responseProfile = {
      tone: rp.tone,
      depth: rp.depth,
      verbosity: rp.verbosity,
      energy: rp.energy,
      emojiPolicy: rp.emojiPolicy,
    }
  }
  if (pipelineResult.response && typeof pipelineResult.response === 'object') {
    debug.writer = {
      final: text || undefined,
      model: asString(pipelineResult.response.model) || undefined,
      providerId: asString(pipelineResult.response.providerId) || undefined,
    }
  }
  return debug
}

/**
 * Map thrown errors to V1-compatible { status, payload }.
 * @param {unknown} error
 */
export function mapV2ErrorToChatResponse(error) {
  if (isWriterError(error)) {
    const code = asString(/** @type {any} */ (error).code)
    const message =
      asString(/** @type {any} */ (error).message) || 'Writer error'
    let status = 500
    if (code === 'timeout') status = 504
    else if (code === 'cancelled') status = 499
    else if (code === 'empty_response' || code === 'malformed_response') status = 502
    else if (code === 'invalid_request' || code === 'unsupported_feature') status = 400
    else if (code === 'rate_limited') status = 429
    else if (code === 'auth') status = 401
    return {
      status,
      payload: {
        error: message,
        code: code || undefined,
        type: 'writer_error',
      },
    }
  }

  const statusCode =
    error && typeof error === 'object' && typeof /** @type {any} */ (error).statusCode === 'number'
      ? /** @type {any} */ (error).statusCode
      : error && typeof error === 'object' && typeof /** @type {any} */ (error).status === 'number'
        ? /** @type {any} */ (error).status
        : 500

  const message =
    error instanceof Error ? error.message : asString(error) || 'Internal error'

  /** @type {Record<string, unknown>} */
  const payload = { error: message }
  if (error && typeof error === 'object') {
    if (/** @type {any} */ (error).code != null) payload.code = /** @type {any} */ (error).code
    if (/** @type {any} */ (error).type != null) payload.type = /** @type {any} */ (error).type
  }

  const status =
    statusCode >= 400 && statusCode < 600 ? statusCode : 500

  return { status, payload }
}

/**
 * Build pipeline messages + userMessage from sanitized chat history.
 * @param {{ role: string, content: string }[]} messages
 */
export function buildV2TurnInput(messages) {
  const history = Array.isArray(messages) ? messages : []
  const lastUser = [...history].reverse().find((m) => m.role === 'user')
  const userMessage = asString(lastUser?.content).trim()
  return {
    userMessage,
    messages: history,
  }
}

/**
 * Run one V2 chat turn and write Chat API JSON to `res`.
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 * @param {{ runtime?: 'v1'|'v2' }} [options]
 */
export async function runV2Chat(req, res, options = {}) {
  applyCors(res)
  const runtime = options.runtime === 'v1' ? 'v1' : 'v2'

  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    return sendJson(res, 500, {
      error: 'Server misconfigured: OPENAI_API_KEY is not set',
      runtime,
    })
  }

  let body
  try {
    body = parseChatBody(req.body)
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body', runtime })
  }

  const messages = sanitizeChatMessages(body.messages).filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  )
  if (messages.length === 0) {
    return sendJson(res, 400, { error: 'messages must be a non-empty array', runtime })
  }

  const { userMessage, messages: history } = buildV2TurnInput(messages)
  if (!userMessage) {
    return sendJson(res, 400, { error: 'messages must be a non-empty array', runtime })
  }

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
  const foundation =
    typeof body.systemPrompt === 'string' && body.systemPrompt.trim()
      ? body.systemPrompt.trim()
      : DEFAULT_FOUNDATION

  const useExperimentalProfile =
    String(process.env.LAIFE_V2_RUNTIME_PROFILE || '')
      .trim()
      .toLowerCase() === 'experimental'

  try {
    const OpenAI = require('openai').default
    const client = new OpenAI({ apiKey })
    const openaiProvider = createOpenAIProvider({
      client,
      defaultModel: model,
      timeoutMs: 60_000,
    })
    const writer = createWriter({
      providers: { [openaiProvider.id]: openaiProvider },
      defaultProviderId: openaiProvider.id,
      defaultModelByProvider: { [openaiProvider.id]: model },
    })
    const pipeline = createPipeline({
      writer,
      personalityFoundation: foundation,
      planFn: (input) =>
        plan({
          ...input,
          ...(useExperimentalProfile ? { runtimeProfile: 'experimental' } : {}),
        }),
    })

    const pipelineResult = await pipeline.runConversation({
      userMessage,
      messages: history,
      providerId: openaiProvider.id,
      model,
      previousConversationState:
        body.conversationState && typeof body.conversationState === 'object'
          ? body.conversationState
          : body.v2ConversationState && typeof body.v2ConversationState === 'object'
            ? body.v2ConversationState
            : null,
      preferences: {
        ...(typeof body.personalityBias === 'string'
          ? { personalityBias: body.personalityBias }
          : {}),
        ...(body.preferences && typeof body.preferences === 'object' ? body.preferences : {}),
        ...(typeof body.replyLength === 'string' ? { replyLength: body.replyLength } : {}),
        ...(typeof body.useEmojis === 'boolean' ? { useEmojis: body.useEmojis } : {}),
        ...(typeof body.displayName === 'string' ? { displayName: body.displayName } : {}),
        ...(typeof body.customInstructions === 'string'
          ? { customInstructions: body.customInstructions }
          : {}),
      },
    })

    const payload = mapV2ResultToChatResponse({
      pipelineResult,
      requestBody: body,
      runtime,
      includeDebug: true,
    })
    return sendJson(res, 200, payload)
  } catch (error) {
    console.error('[conversation-runtime:v2]', error)
    const mapped = mapV2ErrorToChatResponse(error)
    return sendJson(res, mapped.status, { ...mapped.payload, runtime })
  }
}
