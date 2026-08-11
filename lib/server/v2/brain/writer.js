/**
 * LAIfe V2 — Writer
 *
 * Sole V2 module allowed to talk to an LLM (via WriterProvider).
 * Executes Planner plans; does not decide, review, or touch memory.
 * Not wired into the chat pipeline yet. No V1 imports. No vendor SDKs.
 *
 * @see WRITER_API_SPEC.md
 */

export const WRITER_VERSION = '2.1.0-writer'

/** @typedef {'stop'|'length'|'cancelled'|'content_filter'|'error'|'unknown'} FinishReason */

/**
 * @typedef {'timeout'|'rate_limit'|'provider_unavailable'|'auth_failed'|'malformed_response'|'empty_response'|'cancelled'|'invalid_request'|'content_filtered'|'unsupported_feature'|'internal'} WriterErrorCode
 */

/**
 * @typedef {object} Usage
 * @property {number} [inputTokens]
 * @property {number} [outputTokens]
 * @property {number} [totalTokens]
 * @property {number} [thinkingTokens]
 * @property {number} [cachedInputTokens]
 */

/**
 * @typedef {object} WriterError
 * @property {WriterErrorCode} code
 * @property {string} message
 * @property {boolean} retryable
 * @property {string} [providerId]
 * @property {string} [model]
 * @property {string} [requestId]
 * @property {string} [cause]
 * @property {number} [httpStatus]
 */

/**
 * @typedef {object} ProviderCapabilities
 * @property {boolean} streaming
 * @property {boolean} jsonMode
 * @property {boolean} structuredOutput
 * @property {boolean} tools
 * @property {boolean} vision
 * @property {boolean} audioInput
 * @property {boolean} audioOutput
 * @property {boolean} reasoning
 * @property {number} [maxContextTokens]
 */

/**
 * @typedef {object} ProviderMessage
 * @property {'user'|'assistant'|'system'} role
 * @property {string} content
 */

/**
 * @typedef {object} ProviderRequest
 * @property {string} model
 * @property {string} instructions
 * @property {ProviderMessage[]} input
 * @property {boolean} stream
 * @property {number} [maxOutputTokens]
 * @property {number} [temperature]
 * @property {number} [topP]
 * @property {number} [seed]
 * @property {string[]} [stopSequences]
 * @property {'text'|'json'|'structured'} [responseFormat]
 * @property {object} [structuredSchema]
 * @property {AbortSignal} [abortSignal]
 * @property {{ requestId?: string, traceId?: string }} [metadata]
 */

/**
 * @typedef {object} ProviderResponse
 * @property {string} text
 * @property {FinishReason} finishReason
 * @property {Usage} usage
 * @property {string} model
 * @property {string[]} [rawWarnings]
 */

/**
 * @typedef {object} ProviderStreamEvent
 * @property {'delta'|'usage'|'error'|'done'} type
 * @property {string} [textDelta]
 * @property {Usage} [usage]
 * @property {FinishReason} [finishReason]
 * @property {WriterError} [error]
 */

/**
 * @typedef {object} WriterProvider
 * @property {string} id
 * @property {ProviderCapabilities} capabilities
 * @property {(req: ProviderRequest) => Promise<ProviderResponse>} complete
 * @property {(req: ProviderRequest) => AsyncIterable<ProviderStreamEvent>} stream
 */

/**
 * @typedef {object} StreamingChunk
 * @property {'delta'|'usage'|'error'|'done'} type
 * @property {string} [textDelta]
 * @property {Usage} [usage]
 * @property {FinishReason} [finishReason]
 * @property {WriterError} [error]
 * @property {number} [index]
 */

/**
 * @typedef {object} WriterResponse
 * @property {string} text
 * @property {FinishReason} finishReason
 * @property {Usage} usage
 * @property {string} model
 * @property {string} providerId
 * @property {string} [requestId]
 * @property {string[]} [warnings]
 */

/**
 * @typedef {object} WriterConfig
 * @property {Record<string, WriterProvider>} providers
 * @property {string} [defaultProviderId]
 * @property {Record<string, string>} [defaultModelByProvider]
 */

const RETRYABLE_CODES = new Set([
  'timeout',
  'rate_limit',
  'provider_unavailable',
  'malformed_response',
  'empty_response',
])

const NON_RETRYABLE_CODES = new Set([
  'auth_failed',
  'cancelled',
  'invalid_request',
  'content_filtered',
  'unsupported_feature',
  'internal',
])

/**
 * @param {Partial<WriterError> & { code: WriterErrorCode, message: string }} input
 * @returns {WriterError}
 */
export function createWriterError(input) {
  const code = input.code
  const retryable =
    typeof input.retryable === 'boolean'
      ? input.retryable
      : RETRYABLE_CODES.has(code)
  return {
    code,
    message: String(input.message || code),
    retryable,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.cause ? { cause: String(input.cause) } : {}),
    ...(typeof input.httpStatus === 'number' ? { httpStatus: input.httpStatus } : {}),
  }
}

/**
 * @param {unknown} value
 * @returns {value is WriterError}
 */
export function isWriterError(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof /** @type {any} */ (value).code === 'string' &&
      typeof /** @type {any} */ (value).message === 'string' &&
      typeof /** @type {any} */ (value).retryable === 'boolean',
  )
}

/**
 * @param {WriterErrorCode} code
 * @returns {boolean}
 */
export function isRetryableCode(code) {
  if (NON_RETRYABLE_CODES.has(code)) return false
  return RETRYABLE_CODES.has(code)
}

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
 * Serialize planner writerBrief without reinterpreting decisions.
 * @param {any} plan
 * @returns {string}
 */
export function formatPlanForWriter(plan) {
  if (!plan || typeof plan !== 'object') return ''
  const brief = plan.writerBrief && typeof plan.writerBrief === 'object' ? plan.writerBrief : null
  const constraints = Array.isArray(plan.constraints) ? plan.constraints : []
  const cp = plan.conversationPlan && typeof plan.conversationPlan === 'object' ? plan.conversationPlan : null

  const lines = []
  lines.push('WRITER BRIEF (execute; do not renegotiate)')
  if (typeof plan.objective === 'string' && plan.objective) {
    lines.push(`objective=${plan.objective}`)
  }
  if (brief) {
    lines.push(
      `language=${asString(brief.language)}; tone=${asString(brief.tone)}; depth=${asString(brief.depth)}`,
    )
    lines.push(
      `strategy=${asString(brief.strategy)}; need=${asString(brief.need)}; coda=${asString(brief.coda)}`,
    )
    if (brief.moveSummary) lines.push(`move: ${asString(brief.moveSummary)}`)
    lines.push(
      `memoryHint=${asString(brief.memoryHint)}; teaching=${Boolean(brief.teaching)}; comfort=${Boolean(brief.comfort)}; challenge=${Boolean(brief.challenge)}; continueTopic=${Boolean(brief.continueTopic)}`,
    )
    if (Array.isArray(brief.must) && brief.must.length) {
      lines.push('MUST:')
      for (const m of brief.must) lines.push(`- ${asString(m)}`)
    }
    if (Array.isArray(brief.mustNot) && brief.mustNot.length) {
      lines.push('MUST NOT:')
      for (const m of brief.mustNot) lines.push(`- ${asString(m)}`)
    }
  }
  if (cp) {
    lines.push('CONVERSATION PLAN (structure only):')
    if (cp.opening) {
      lines.push(
        `- opening[${asString(cp.opening.kind)}]: ${asString(cp.opening.purpose)}`,
      )
    }
    if (Array.isArray(cp.development)) {
      for (const beat of cp.development) {
        lines.push(`- development[${asString(beat.kind)}]: ${asString(beat.purpose)}`)
      }
    }
    if (cp.closing) {
      lines.push(
        `- closing[${asString(cp.closing.kind)}]: ${asString(cp.closing.purpose)}`,
      )
    }
    if (cp.lengthBand) lines.push(`lengthBand=${asString(cp.lengthBand)}`)
  }
  if (constraints.length) {
    lines.push('CONSTRAINTS:')
    for (const c of constraints) lines.push(`- ${asString(c)}`)
  }
  return lines.join('\n')
}

/**
 * @param {any} preferences
 * @returns {string}
 */
function formatPreferences(preferences) {
  if (!preferences || typeof preferences !== 'object') return ''
  const lines = ['USER PREFERENCES (soft; do not override hard constraints):']
  if (preferences.displayName) lines.push(`- displayName: ${asString(preferences.displayName)}`)
  if (preferences.replyLength) lines.push(`- replyLength: ${asString(preferences.replyLength)}`)
  if (typeof preferences.useEmojis === 'boolean') {
    lines.push(`- useEmojis: ${preferences.useEmojis}`)
  }
  if (preferences.customInstructions) {
    lines.push(`- customInstructions: ${asString(preferences.customInstructions)}`)
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

/**
 * @param {any} memoryPack
 * @returns {string}
 */
function formatMemoryPack(memoryPack) {
  if (!memoryPack || typeof memoryPack !== 'object') return ''
  const items = Array.isArray(memoryPack.items) ? memoryPack.items : []
  if (!items.length) return ''
  const lines = ['MEMORY PACK (facts only; do not invent beyond these):']
  for (const item of items.slice(0, 8)) {
    const text = asString(item?.text || item?.content || '')
    if (text) lines.push(`- ${text}`)
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

/**
 * Format Reviewer rewriteHints into provider instructions.
 * Used only when mode === "rewrite". Does not invent new decisions.
 * @param {any} hints
 * @returns {string}
 */
export function formatRewriteHints(hints) {
  if (!hints || typeof hints !== 'object') return ''
  const mustFix = Array.isArray(hints.mustFix)
    ? hints.mustFix.map(asString).map((s) => s.trim()).filter(Boolean)
    : []
  const improve = Array.isArray(hints.improve)
    ? hints.improve.map(asString).map((s) => s.trim()).filter(Boolean)
    : []
  const keep = Array.isArray(hints.keep)
    ? hints.keep.map(asString).map((s) => s.trim()).filter(Boolean)
    : []
  const target =
    typeof hints.targetScore === 'number' && Number.isFinite(hints.targetScore)
      ? hints.targetScore
      : null

  const lines = [
    'REWRITE CONTRACT (apply once; do not renegotiate the plan or decision)',
    'Use only these rewriteHints. Do not invent new goals.',
  ]
  if (mustFix.length) {
    lines.push('mustFix:')
    for (const item of mustFix) lines.push(`- ${item}`)
  } else {
    lines.push('mustFix: (none)')
  }
  if (improve.length) {
    lines.push('improve:')
    for (const item of improve) lines.push(`- ${item}`)
  } else {
    lines.push('improve: (none)')
  }
  if (keep.length) {
    lines.push('keep:')
    for (const item of keep) lines.push(`- ${item}`)
  } else {
    lines.push('keep: (none)')
  }
  if (target != null) lines.push(`targetScore=${target}`)
  return lines.join('\n')
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRewriteHints(value) {
  if (!value || typeof value !== 'object') return false
  const v = /** @type {any} */ (value)
  return Boolean(
    Array.isArray(v.mustFix) &&
      Array.isArray(v.improve) &&
      Array.isArray(v.keep) &&
      typeof v.targetScore === 'number' &&
      Number.isFinite(v.targetScore),
  )
}

/**
 * Assemble provider instructions from WriterRequest. Does not reinterpret plan flags.
 * @param {any} request
 * @returns {string}
 */
export function assembleInstructions(request) {
  const req = request && typeof request === 'object' ? request : {}
  const foundation =
    typeof req.personalityFoundation === 'string'
      ? req.personalityFoundation
      : req.personalityFoundation && typeof req.personalityFoundation === 'object'
        ? asString(req.personalityFoundation.text || req.personalityFoundation.content || '')
        : ''

  const parts = []
  if (foundation.trim()) {
    parts.push(`PERSONALITY FOUNDATION\n${foundation.trim()}`)
  }
  const prefs = formatPreferences(req.preferences)
  if (prefs) parts.push(prefs)

  const planBlock = formatPlanForWriter(req.plan)
  if (planBlock) parts.push(planBlock)

  const mem = formatMemoryPack(req.memoryPack)
  if (mem) parts.push(mem)

  if (req.mode === 'rewrite') {
    const hintsBlock = formatRewriteHints(req.rewriteHints)
    parts.push(
      [
        'REWRITE MODE',
        'Apply the Rewrite Contract once. Do not change facts. Do not renegotiate the plan.',
        hintsBlock || 'rewriteHints: (missing)',
        req.previousDraft
          ? `previousDraft:\n---\n${asString(req.previousDraft)}\n---`
          : 'previousDraft: (not provided)',
      ].join('\n'),
    )
  }

  parts.push(
    'OUTPUT RULES\nWrite only the final assistant reply. Do not cite modules, plans, scores, or engines.',
  )

  return parts.filter(Boolean).join('\n\n')
}

/**
 * @param {any} request
 * @returns {ProviderMessage[]}
 */
function toProviderInput(request) {
  const messages = Array.isArray(request?.messages) ? request.messages : []
  /** @type {ProviderMessage[]} */
  const input = []
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue
    const role = asString(m.role).toLowerCase()
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue
    const content = asString(m.content)
    if (!content) continue
    input.push({ role: /** @type {ProviderMessage['role']} */ (role), content })
  }
  if (request?.mode === 'rewrite' && request.previousDraft) {
    input.push({
      role: 'user',
      content: `Refine this draft once:\n---\n${asString(request.previousDraft)}\n---`,
    })
  }
  return input
}

/**
 * @param {any} request
 * @param {WriterConfig} config
 * @returns {WriterProvider}
 */
function resolveProvider(request, config) {
  const providers = config.providers || {}
  const ids = Object.keys(providers)
  if (!ids.length) {
    throw createWriterError({
      code: 'invalid_request',
      message: 'No WriterProvider registered',
      retryable: false,
    })
  }
  const wanted = asString(request?.providerId) || config.defaultProviderId || ids[0]
  const provider = providers[wanted]
  if (!provider) {
    throw createWriterError({
      code: 'invalid_request',
      message: `Unknown providerId "${wanted}"`,
      retryable: false,
      providerId: wanted,
    })
  }
  return provider
}

/**
 * @param {any} request
 * @param {WriterProvider} provider
 * @param {WriterConfig} config
 * @returns {string}
 */
function resolveModel(request, provider, config) {
  if (request?.model) return asString(request.model)
  const map = config.defaultModelByProvider || {}
  if (map[provider.id]) return map[provider.id]
  return 'default'
}

/**
 * @param {any} request
 * @param {WriterProvider} provider
 */
function assertCapabilities(request, provider) {
  const caps = provider.capabilities || {
    streaming: false,
    jsonMode: false,
    structuredOutput: false,
    tools: false,
    vision: false,
    audioInput: false,
    audioOutput: false,
    reasoning: false,
  }
  const gen = request?.generation || {}
  const format = gen.responseFormat || 'text'

  if (request?.stream && !caps.streaming) {
    throw createWriterError({
      code: 'unsupported_feature',
      message: `Provider "${provider.id}" does not support streaming`,
      retryable: false,
      providerId: provider.id,
    })
  }
  if (format === 'json' && !caps.jsonMode) {
    throw createWriterError({
      code: 'unsupported_feature',
      message: `Provider "${provider.id}" does not support jsonMode`,
      retryable: false,
      providerId: provider.id,
    })
  }
  if (format === 'structured' && !caps.structuredOutput) {
    throw createWriterError({
      code: 'unsupported_feature',
      message: `Provider "${provider.id}" does not support structuredOutput`,
      retryable: false,
      providerId: provider.id,
    })
  }
}

/**
 * @param {any} request
 */
function validateRequest(request) {
  if (!request || typeof request !== 'object') {
    throw createWriterError({
      code: 'invalid_request',
      message: 'WriterRequest must be an object',
      retryable: false,
    })
  }
  if (!request.plan || typeof request.plan !== 'object') {
    throw createWriterError({
      code: 'invalid_request',
      message: 'WriterRequest.plan is required',
      retryable: false,
      requestId: request.metadata?.requestId,
    })
  }
  if (!request.decision || typeof request.decision !== 'object') {
    throw createWriterError({
      code: 'invalid_request',
      message: 'WriterRequest.decision is required',
      retryable: false,
      requestId: request.metadata?.requestId,
    })
  }
  const mode = request.mode || 'draft'
  if (mode !== 'draft' && mode !== 'rewrite') {
    throw createWriterError({
      code: 'invalid_request',
      message: `Invalid mode "${mode}"`,
      retryable: false,
      requestId: request.metadata?.requestId,
    })
  }
  if (mode === 'rewrite' && !isRewriteHints(request.rewriteHints)) {
    throw createWriterError({
      code: 'invalid_request',
      message: 'rewriteHints is required when mode is "rewrite"',
      retryable: false,
      requestId: request.metadata?.requestId,
    })
  }
}

/**
 * @param {any} request
 * @param {string} instructions
 * @param {WriterProvider} provider
 * @param {WriterConfig} config
 * @param {boolean} stream
 * @returns {ProviderRequest}
 */
function toProviderRequest(request, instructions, provider, config, stream) {
  const gen = request.generation && typeof request.generation === 'object' ? request.generation : {}
  return {
    model: resolveModel(request, provider, config),
    instructions,
    input: toProviderInput(request),
    stream,
    ...(typeof gen.maxOutputTokens === 'number' ? { maxOutputTokens: gen.maxOutputTokens } : {}),
    ...(typeof gen.temperature === 'number' ? { temperature: gen.temperature } : {}),
    ...(typeof gen.topP === 'number' ? { topP: gen.topP } : {}),
    ...(typeof gen.seed === 'number' ? { seed: gen.seed } : {}),
    ...(Array.isArray(gen.stopSequences) ? { stopSequences: gen.stopSequences } : {}),
    ...(gen.responseFormat ? { responseFormat: gen.responseFormat } : {}),
    ...(gen.structuredSchema ? { structuredSchema: gen.structuredSchema } : {}),
    ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
    metadata: {
      ...(request.metadata?.requestId ? { requestId: request.metadata.requestId } : {}),
      ...(request.metadata?.traceId ? { traceId: request.metadata.traceId } : {}),
    },
  }
}

/**
 * @param {ProviderResponse} raw
 * @param {WriterProvider} provider
 * @param {any} request
 * @returns {WriterResponse}
 */
function toWriterResponse(raw, provider, request) {
  const text = asString(raw?.text)
  if (!text.trim()) {
    throw createWriterError({
      code: 'empty_response',
      message: 'Provider returned empty text',
      retryable: true,
      providerId: provider.id,
      model: asString(raw?.model),
      requestId: request?.metadata?.requestId,
    })
  }
  return {
    text,
    finishReason: /** @type {FinishReason} */ (raw.finishReason || 'unknown'),
    usage: raw.usage && typeof raw.usage === 'object' ? raw.usage : {},
    model: asString(raw.model) || 'default',
    providerId: provider.id,
    ...(request?.metadata?.requestId ? { requestId: request.metadata.requestId } : {}),
    ...(Array.isArray(raw.rawWarnings) && raw.rawWarnings.length
      ? { warnings: raw.rawWarnings.map(asString) }
      : {}),
  }
}

/**
 * @param {unknown} err
 * @param {WriterProvider} [provider]
 * @param {any} [request]
 * @returns {WriterError}
 */
function normalizeThrown(err, provider, request) {
  if (isWriterError(err)) {
    return {
      ...err,
      providerId: err.providerId || provider?.id,
      requestId: err.requestId || request?.metadata?.requestId,
    }
  }
  const message = err instanceof Error ? err.message : String(err || 'unknown error')
  const name = err instanceof Error ? err.name : ''
  if (name === 'AbortError' || /aborted|cancelled/i.test(message)) {
    return createWriterError({
      code: 'cancelled',
      message: 'Request cancelled',
      retryable: false,
      providerId: provider?.id,
      requestId: request?.metadata?.requestId,
      cause: message,
    })
  }
  if (/timeout/i.test(message)) {
    return createWriterError({
      code: 'timeout',
      message: 'Provider timeout',
      retryable: true,
      providerId: provider?.id,
      requestId: request?.metadata?.requestId,
      cause: message,
    })
  }
  return createWriterError({
    code: 'internal',
    message: 'Provider call failed',
    retryable: false,
    providerId: provider?.id,
    requestId: request?.metadata?.requestId,
    cause: message,
  })
}

/**
 * Create a Writer facade bound to a provider registry.
 * @param {WriterConfig} config
 */
export function createWriter(config) {
  if (!config || typeof config !== 'object' || !config.providers) {
    throw createWriterError({
      code: 'invalid_request',
      message: 'createWriter requires { providers }',
      retryable: false,
    })
  }

  /** @type {WriterConfig} */
  const cfg = {
    providers: config.providers,
    defaultProviderId: config.defaultProviderId,
    defaultModelByProvider: config.defaultModelByProvider || {},
  }

  /**
   * @param {any} request
   * @returns {Promise<WriterResponse>}
   */
  async function write(request) {
    validateRequest(request)
    const provider = resolveProvider(request, cfg)
    assertCapabilities({ ...request, stream: false }, provider)
    const instructions = assembleInstructions(request)
    const providerReq = toProviderRequest(request, instructions, provider, cfg, false)

    // Cooperative cancel before call
    if (request.abortSignal?.aborted) {
      throw createWriterError({
        code: 'cancelled',
        message: 'Request cancelled',
        retryable: false,
        providerId: provider.id,
        requestId: request.metadata?.requestId,
      })
    }

    let raw
    try {
      raw = await provider.complete(providerReq)
    } catch (err) {
      throw normalizeThrown(err, provider, request)
    }

    if (!raw || typeof raw !== 'object') {
      throw createWriterError({
        code: 'malformed_response',
        message: 'Provider returned non-object response',
        retryable: true,
        providerId: provider.id,
        requestId: request.metadata?.requestId,
      })
    }

    return toWriterResponse(raw, provider, request)
  }

  /**
   * @param {any} request
   * @returns {AsyncIterable<StreamingChunk>}
   */
  async function* writeStream(request) {
    const streamRequest = { ...request, stream: true }
    try {
      validateRequest(streamRequest)
    } catch (err) {
      const error = normalizeThrown(err)
      yield { type: 'error', error, index: 0 }
      return
    }

    let provider
    try {
      provider = resolveProvider(streamRequest, cfg)
      assertCapabilities(streamRequest, provider)
    } catch (err) {
      const error = normalizeThrown(err)
      yield { type: 'error', error, index: 0 }
      return
    }

    const instructions = assembleInstructions(streamRequest)
    const providerReq = toProviderRequest(streamRequest, instructions, provider, cfg, true)

    if (streamRequest.abortSignal?.aborted) {
      yield {
        type: 'error',
        error: createWriterError({
          code: 'cancelled',
          message: 'Request cancelled',
          retryable: false,
          providerId: provider.id,
          requestId: streamRequest.metadata?.requestId,
        }),
        index: 0,
      }
      return
    }

    let index = 0
    try {
      for await (const event of provider.stream(providerReq)) {
        if (!event || typeof event !== 'object') {
          yield {
            type: 'error',
            error: createWriterError({
              code: 'malformed_response',
              message: 'Malformed stream event',
              retryable: true,
              providerId: provider.id,
              requestId: streamRequest.metadata?.requestId,
            }),
            index: index++,
          }
          return
        }
        if (event.type === 'delta') {
          yield {
            type: 'delta',
            textDelta: asString(event.textDelta),
            index: index++,
          }
          continue
        }
        if (event.type === 'usage') {
          yield {
            type: 'usage',
            usage: event.usage || {},
            index: index++,
          }
          continue
        }
        if (event.type === 'error') {
          const error = isWriterError(event.error)
            ? event.error
            : createWriterError({
                code: 'internal',
                message: 'Stream error',
                retryable: false,
                providerId: provider.id,
              })
          yield { type: 'error', error, index: index++ }
          return
        }
        if (event.type === 'done') {
          yield {
            type: 'done',
            finishReason: event.finishReason || 'stop',
            usage: event.usage || {},
            index: index++,
          }
          return
        }
      }
      // Stream ended without done/error
      yield {
        type: 'error',
        error: createWriterError({
          code: 'malformed_response',
          message: 'Stream ended without done event',
          retryable: true,
          providerId: provider.id,
          requestId: streamRequest.metadata?.requestId,
        }),
        index: index++,
      }
    } catch (err) {
      yield {
        type: 'error',
        error: normalizeThrown(err, provider, streamRequest),
        index: index++,
      }
    }
  }

  return {
    version: WRITER_VERSION,
    write,
    writeStream,
    /** @deprecated internal test helper */
    _assembleInstructions: assembleInstructions,
    _formatPlanForWriter: formatPlanForWriter,
  }
}

/**
 * Collect a writeStream into final text + terminal chunk.
 * @param {AsyncIterable<StreamingChunk>} stream
 * @returns {Promise<{ text: string, terminal: StreamingChunk, chunks: StreamingChunk[] }>}
 */
export async function collectStream(stream) {
  /** @type {StreamingChunk[]} */
  const chunks = []
  let text = ''
  /** @type {StreamingChunk | null} */
  let terminal = null
  for await (const chunk of stream) {
    chunks.push(chunk)
    if (chunk.type === 'delta' && chunk.textDelta) text += chunk.textDelta
    if (chunk.type === 'done' || chunk.type === 'error') terminal = chunk
  }
  if (!terminal) {
    terminal = {
      type: 'error',
      error: createWriterError({
        code: 'malformed_response',
        message: 'No terminal stream event',
        retryable: true,
      }),
    }
  }
  return { text, terminal, chunks }
}
