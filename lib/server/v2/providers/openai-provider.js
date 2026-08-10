/**
 * LAIfe V2 — OpenAI WriterProvider adapter
 *
 * Maps ProviderRequest ↔ OpenAI Responses API.
 * Does not build prompts, decide, or alter text beyond transport.
 * Not wired to api/chat.ts / V1.
 *
 * @see WRITER_API_SPEC.md
 */

import { createWriterError, isWriterError } from '../brain/writer.js'

export const OPENAI_PROVIDER_ID = 'openai'
export const OPENAI_PROVIDER_VERSION = '2.0.0-openai-provider'

/** @typedef {import('../brain/writer.js').WriterProvider} WriterProvider */
/** @typedef {import('../brain/writer.js').ProviderRequest} ProviderRequest */
/** @typedef {import('../brain/writer.js').ProviderResponse} ProviderResponse */
/** @typedef {import('../brain/writer.js').ProviderStreamEvent} ProviderStreamEvent */
/** @typedef {import('../brain/writer.js').FinishReason} FinishReason */
/** @typedef {import('../brain/writer.js').Usage} Usage */
/** @typedef {import('../brain/writer.js').WriterError} WriterError */

/**
 * Minimal OpenAI client surface used by this adapter (injectable / mockable).
 * @typedef {object} OpenAIResponsesClient
 * @property {{
 *   create: (args: object, opts?: { signal?: AbortSignal }) => Promise<any> | AsyncIterable<any>
 * }} responses
 */

/**
 * @typedef {object} OpenAIProviderOptions
 * @property {OpenAIResponsesClient} client
 * @property {string} [defaultModel]
 * @property {number} [timeoutMs]  hard timeout for complete / stream create (default 60000)
 * @property {Partial<import('../brain/writer.js').ProviderCapabilities>} [capabilities]
 */

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
 * @param {ProviderRequest} request
 * @returns {object[]}
 */
export function toOpenAIInput(request) {
  const input = Array.isArray(request?.input) ? request.input : []
  /** @type {object[]} */
  const out = []
  for (const msg of input) {
    if (!msg || typeof msg !== 'object') continue
    const role = asString(msg.role).toLowerCase()
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue
    const content = asString(msg.content)
    if (!content) continue
    out.push({
      type: 'message',
      role,
      content,
    })
  }
  return out
}

/**
 * @param {ProviderRequest} request
 * @param {string} defaultModel
 * @param {boolean} stream
 * @returns {object}
 */
export function toOpenAICreateArgs(request, defaultModel, stream) {
  const model = asString(request?.model) || defaultModel || 'gpt-4o-mini'
  const args = {
    model,
    instructions: asString(request?.instructions),
    input: toOpenAIInput(request),
    stream: Boolean(stream),
  }

  if (typeof request?.maxOutputTokens === 'number') {
    args.max_output_tokens = request.maxOutputTokens
  }
  if (typeof request?.temperature === 'number') {
    args.temperature = request.temperature
  }
  if (typeof request?.topP === 'number') {
    args.top_p = request.topP
  }
  if (typeof request?.seed === 'number') {
    args.seed = request.seed
  }
  // stopSequences / responseFormat reserved for future mapping — no prompt building

  return args
}

/**
 * @param {any} usage
 * @returns {Usage}
 */
export function mapUsage(usage) {
  if (!usage || typeof usage !== 'object') return {}
  /** @type {Usage} */
  const out = {}
  const input =
    usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens
  const output =
    usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens
  const total = usage.total_tokens ?? usage.totalTokens
  const thinking = usage.output_tokens_details?.reasoning_tokens ?? usage.thinkingTokens
  const cached =
    usage.input_tokens_details?.cached_tokens ?? usage.cachedInputTokens

  if (typeof input === 'number') out.inputTokens = input
  if (typeof output === 'number') out.outputTokens = output
  if (typeof total === 'number') out.totalTokens = total
  if (typeof thinking === 'number') out.thinkingTokens = thinking
  if (typeof cached === 'number') out.cachedInputTokens = cached

  if (
    out.totalTokens == null &&
    typeof out.inputTokens === 'number' &&
    typeof out.outputTokens === 'number'
  ) {
    out.totalTokens = out.inputTokens + out.outputTokens
  }
  return out
}

/**
 * @param {any} response
 * @returns {string}
 */
export function extractOutputText(response) {
  if (!response || typeof response !== 'object') return ''
  if (typeof response.output_text === 'string') return response.output_text

  // Fallback: walk Responses API output items
  if (Array.isArray(response.output)) {
    const parts = []
    for (const item of response.output) {
      if (!item || typeof item !== 'object') continue
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c && typeof c === 'object' && typeof c.text === 'string') {
            parts.push(c.text)
          }
        }
      }
    }
    return parts.join('')
  }
  return ''
}

/**
 * @param {any} response
 * @returns {FinishReason}
 */
export function mapFinishReason(response) {
  const status = asString(response?.status).toLowerCase()
  const reason = asString(
    response?.incomplete_details?.reason || response?.finish_reason || '',
  ).toLowerCase()

  if (status === 'completed' || reason === 'stop' || reason === 'completed') {
    return 'stop'
  }
  if (
    reason.includes('max_output') ||
    reason.includes('length') ||
    (status === 'incomplete' && reason.includes('max'))
  ) {
    return 'length'
  }
  if (reason.includes('content_filter') || reason.includes('safety')) {
    return 'content_filter'
  }
  if (status === 'cancelled' || reason.includes('cancel')) {
    return 'cancelled'
  }
  if (status === 'failed' || reason.includes('error')) {
    return 'error'
  }
  if (status === 'completed' || extractOutputText(response)) {
    return 'stop'
  }
  return 'unknown'
}

/**
 * @param {unknown} err
 * @param {{ providerId?: string, model?: string, requestId?: string }} [ctx]
 * @returns {WriterError}
 */
export function mapOpenAIError(err, ctx = {}) {
  if (isWriterError(err)) {
    return {
      ...err,
      providerId: err.providerId || ctx.providerId || OPENAI_PROVIDER_ID,
      model: err.model || ctx.model,
      requestId: err.requestId || ctx.requestId,
    }
  }

  const message = err instanceof Error ? err.message : String(err || 'unknown error')
  const name = err instanceof Error ? err.name : ''
  const status =
    typeof /** @type {any} */ (err)?.status === 'number'
      ? /** @type {any} */ (err).status
      : typeof /** @type {any} */ (err)?.statusCode === 'number'
        ? /** @type {any} */ (err).statusCode
        : typeof /** @type {any} */ (err)?.httpStatus === 'number'
          ? /** @type {any} */ (err).httpStatus
          : undefined
  const code = asString(/** @type {any} */ (err)?.code).toLowerCase()

  const base = {
    providerId: ctx.providerId || OPENAI_PROVIDER_ID,
    model: ctx.model,
    requestId: ctx.requestId,
    cause: message,
    ...(typeof status === 'number' ? { httpStatus: status } : {}),
  }

  if (
    name === 'AbortError' ||
    /aborted|cancelled/i.test(message) ||
    code === 'err_canceled'
  ) {
    return createWriterError({
      code: 'cancelled',
      message: 'OpenAI request cancelled',
      retryable: false,
      ...base,
    })
  }

  if (
    /timeout|etimedout|esockettimedout/i.test(message) ||
    code === 'etimedout' ||
    name === 'TimeoutError'
  ) {
    return createWriterError({
      code: 'timeout',
      message: 'OpenAI request timed out',
      retryable: true,
      ...base,
    })
  }

  if (status === 429 || /rate[_ ]?limit/i.test(message)) {
    return createWriterError({
      code: 'rate_limit',
      message: 'OpenAI rate limit',
      retryable: true,
      ...base,
      httpStatus: status || 429,
    })
  }

  if (status === 401 || status === 403 || /unauthorized|invalid api key|auth/i.test(message)) {
    return createWriterError({
      code: 'auth_failed',
      message: 'OpenAI authentication failed',
      retryable: false,
      ...base,
      httpStatus: status || 401,
    })
  }

  if (
    status === 400 &&
    /content[_ ]?filter|safety|policy/i.test(message)
  ) {
    return createWriterError({
      code: 'content_filtered',
      message: 'OpenAI content filtered',
      retryable: false,
      ...base,
      httpStatus: 400,
    })
  }

  if (typeof status === 'number' && status >= 500) {
    return createWriterError({
      code: 'provider_unavailable',
      message: 'OpenAI unavailable',
      retryable: true,
      ...base,
      httpStatus: status,
    })
  }

  if (/malformed|unexpected token|json/i.test(message)) {
    return createWriterError({
      code: 'malformed_response',
      message: 'Malformed OpenAI response',
      retryable: true,
      ...base,
    })
  }

  return createWriterError({
    code: 'internal',
    message: 'OpenAI provider error',
    retryable: false,
    ...base,
  })
}

/**
 * @param {any} response
 * @param {string} fallbackModel
 * @returns {ProviderResponse}
 */
export function toProviderResponse(response, fallbackModel) {
  const text = extractOutputText(response)
  return {
    text,
    finishReason: mapFinishReason(response),
    usage: mapUsage(response?.usage),
    model: asString(response?.model) || fallbackModel || 'unknown',
    rawWarnings: [],
  }
}

/**
 * @param {Promise<any>} promise
 * @param {number} timeoutMs
 * @param {AbortSignal} [signal]
 */
function withTimeout(promise, timeoutMs, signal) {
  if (!timeoutMs || timeoutMs <= 0) return promise

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error('OpenAI request timed out')
      err.name = 'TimeoutError'
      reject(err)
    }, timeoutMs)

    const onAbort = () => {
      clearTimeout(timer)
      const err = new Error('aborted')
      err.name = 'AbortError'
      reject(err)
    }

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    promise.then(
      (value) => {
        clearTimeout(timer)
        if (signal) signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        if (signal) signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}

/**
 * Extract text delta from a Responses streaming event.
 * @param {any} event
 * @returns {string}
 */
export function extractStreamDelta(event) {
  if (!event || typeof event !== 'object') return ''
  if (typeof event.delta === 'string' && /output_text\.delta/i.test(asString(event.type))) {
    return event.delta
  }
  if (typeof event.delta === 'string' && event.type === 'response.output_text.delta') {
    return event.delta
  }
  // Some mocks / SDKs may use text
  if (typeof event.text === 'string' && /delta/i.test(asString(event.type))) {
    return event.text
  }
  return ''
}

/**
 * Create an OpenAI WriterProvider adapter.
 * @param {OpenAIProviderOptions} options
 * @returns {WriterProvider}
 */
export function createOpenAIProvider(options) {
  if (!options || typeof options !== 'object' || !options.client) {
    throw createWriterError({
      code: 'invalid_request',
      message: 'createOpenAIProvider requires { client }',
      retryable: false,
      providerId: OPENAI_PROVIDER_ID,
    })
  }

  const client = options.client
  const defaultModel = asString(options.defaultModel) || 'gpt-4o-mini'
  const timeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : 60_000

  /** @type {import('../brain/writer.js').ProviderCapabilities} */
  const capabilities = {
    streaming: true,
    jsonMode: true,
    structuredOutput: true,
    tools: true,
    vision: true,
    audioInput: false,
    audioOutput: false,
    reasoning: true,
    maxContextTokens: 128000,
    ...(options.capabilities || {}),
  }

  /**
   * @param {ProviderRequest} request
   * @returns {Promise<ProviderResponse>}
   */
  async function complete(request) {
    const model = asString(request?.model) || defaultModel
    const requestId = request?.metadata?.requestId
    const ctx = { providerId: OPENAI_PROVIDER_ID, model, requestId }

    if (request?.abortSignal?.aborted) {
      throw createWriterError({
        code: 'cancelled',
        message: 'OpenAI request cancelled',
        retryable: false,
        ...ctx,
      })
    }

    const args = toOpenAICreateArgs(request, defaultModel, false)

    try {
      const createPromise = client.responses.create(args, {
        signal: request?.abortSignal,
      })
      const response = await withTimeout(
        Promise.resolve(createPromise),
        timeoutMs,
        request?.abortSignal,
      )

      if (!response || typeof response !== 'object') {
        throw createWriterError({
          code: 'malformed_response',
          message: 'OpenAI returned non-object response',
          retryable: true,
          ...ctx,
        })
      }

      const mapped = toProviderResponse(response, model)
      // Do not invent text — empty is a typed error for the Writer facade
      return mapped
    } catch (err) {
      throw mapOpenAIError(err, ctx)
    }
  }

  /**
   * @param {ProviderRequest} request
   * @returns {AsyncIterable<ProviderStreamEvent>}
   */
  async function* stream(request) {
    const model = asString(request?.model) || defaultModel
    const requestId = request?.metadata?.requestId
    const ctx = { providerId: OPENAI_PROVIDER_ID, model, requestId }

    if (request?.abortSignal?.aborted) {
      yield {
        type: 'error',
        error: createWriterError({
          code: 'cancelled',
          message: 'OpenAI request cancelled',
          retryable: false,
          ...ctx,
        }),
      }
      return
    }

    const args = toOpenAICreateArgs(request, defaultModel, true)

    let iterator
    try {
      const created = client.responses.create(args, {
        signal: request?.abortSignal,
      })
      const streamObj = await withTimeout(
        Promise.resolve(created),
        timeoutMs,
        request?.abortSignal,
      )
      if (!streamObj || typeof streamObj[Symbol.asyncIterator] !== 'function') {
        yield {
          type: 'error',
          error: createWriterError({
            code: 'malformed_response',
            message: 'OpenAI stream is not async iterable',
            retryable: true,
            ...ctx,
          }),
        }
        return
      }
      iterator = streamObj[Symbol.asyncIterator]()
    } catch (err) {
      yield { type: 'error', error: mapOpenAIError(err, ctx) }
      return
    }

    /** @type {Usage} */
    let lastUsage = {}
    /** @type {FinishReason} */
    let finishReason = 'stop'
    let sawDone = false

    try {
      while (true) {
        if (request?.abortSignal?.aborted) {
          yield {
            type: 'error',
            error: createWriterError({
              code: 'cancelled',
              message: 'OpenAI request cancelled',
              retryable: false,
              ...ctx,
            }),
          }
          return
        }

        const { value: event, done } = await iterator.next()
        if (done) break

        const type = asString(event?.type)

        const delta = extractStreamDelta(event)
        if (delta) {
          yield { type: 'delta', textDelta: delta }
          continue
        }

        if (
          type === 'response.completed' ||
          type === 'response.done' ||
          type === 'done'
        ) {
          if (event?.response) {
            lastUsage = mapUsage(event.response.usage)
            finishReason = mapFinishReason(event.response)
          } else if (event?.usage) {
            lastUsage = mapUsage(event.usage)
          }
          if (event?.finishReason || event?.finish_reason) {
            finishReason = mapFinishReason({
              finish_reason: event.finishReason || event.finish_reason,
              status: 'completed',
            })
          }
          sawDone = true
          yield { type: 'usage', usage: lastUsage }
          yield { type: 'done', finishReason, usage: lastUsage }
          return
        }

        if (type === 'response.failed' || type === 'error') {
          const message =
            asString(event?.error?.message) ||
            asString(event?.message) ||
            'OpenAI stream failed'
          yield {
            type: 'error',
            error: mapOpenAIError(
              Object.assign(new Error(message), {
                status: event?.error?.status || event?.status,
                code: event?.error?.code,
              }),
              ctx,
            ),
          }
          return
        }

        // usage-only events
        if (event?.usage && /usage/i.test(type)) {
          lastUsage = mapUsage(event.usage)
          yield { type: 'usage', usage: lastUsage }
        }
      }

      if (!sawDone) {
        // Stream ended without explicit completed event — still emit done if we got deltas
        yield { type: 'usage', usage: lastUsage }
        yield { type: 'done', finishReason, usage: lastUsage }
      }
    } catch (err) {
      yield { type: 'error', error: mapOpenAIError(err, ctx) }
    }
  }

  return {
    id: OPENAI_PROVIDER_ID,
    capabilities,
    complete,
    stream,
  }
}
