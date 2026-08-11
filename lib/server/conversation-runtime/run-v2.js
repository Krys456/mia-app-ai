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
 *   pipelineResult: { response?: { text?: string } },
 *   requestBody?: Record<string, unknown>,
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

  return payload
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
 */
export async function runV2Chat(req, res) {
  applyCors(res)

  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    return sendJson(res, 500, {
      error: 'Server misconfigured: OPENAI_API_KEY is not set',
    })
  }

  let body
  try {
    body = parseChatBody(req.body)
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body' })
  }

  const messages = sanitizeChatMessages(body.messages).filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  )
  if (messages.length === 0) {
    return sendJson(res, 400, { error: 'messages must be a non-empty array' })
  }

  const { userMessage, messages: history } = buildV2TurnInput(messages)
  if (!userMessage) {
    return sendJson(res, 400, { error: 'messages must be a non-empty array' })
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
    })

    const payload = mapV2ResultToChatResponse({
      pipelineResult,
      requestBody: body,
    })
    return sendJson(res, 200, payload)
  } catch (error) {
    console.error('[conversation-runtime:v2]', error)
    const mapped = mapV2ErrorToChatResponse(error)
    return sendJson(res, mapped.status, mapped.payload)
  }
}
