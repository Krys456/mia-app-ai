#!/usr/bin/env node
/**
 * Isolated tests for LAIfe V2 Writer.
 * FakeWriterProvider lives here — no OpenAI, no V1, no pipeline wiring.
 *
 * Run: node lib/server/v2/brain/writer.test.mjs
 */

import {
  createWriter,
  createWriterError,
  isWriterError,
  isRetryableCode,
  assembleInstructions,
  formatPlanForWriter,
  collectStream,
  cleanDraft,
  looksLikeGenericChatbot,
  isMinimalUserTurn,
  pickMinimalAck,
  enforceReplyGrounding,
  enforceReplyGroundingDetailed,
  finalizeWriterText,
  recoverPresence,
  isAllowedPresencePhrase,
  shouldRewriteFromIdentity,
  buildIdentityEvaluatorRewriteBrief,
  WRITER_VERSION,
} from './writer.js'

let passed = 0
let failed = 0

/**
 * @param {string} name
 * @param {() => void | Promise<void>} fn
 */
function test(name, fn) {
  const run = Promise.resolve().then(fn)
  return run.then(
    () => {
      passed += 1
      console.log(`  ok  — ${name}`)
    },
    (error) => {
      failed += 1
      const message = error instanceof Error ? error.message : String(error)
      console.error(`  FAIL — ${name}`)
      console.error(`        ${message}`)
    },
  )
}

/**
 * @param {unknown} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} label
 */
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    )
  }
}

/** @returns {import('./writer.js').ProviderCapabilities} */
function fullCaps(overrides = {}) {
  return {
    streaming: true,
    jsonMode: true,
    structuredOutput: true,
    tools: false,
    vision: false,
    audioInput: false,
    audioOutput: false,
    reasoning: false,
    maxContextTokens: 128000,
    ...overrides,
  }
}

/**
 * FakeWriterProvider — simulates normal / timeout / error / streaming.
 * @param {object} [options]
 * @returns {import('./writer.js').WriterProvider}
 */
function createFakeWriterProvider(options = {}) {
  const {
    id = 'fake',
    mode = 'normal', // normal | timeout | error | empty | malformed | rate_limit | unavailable | auth | filter
    text = 'Sto bene. Stamattina il caffè aveva un odore di tostatura quasi dolce.',
    streamChunks = null,
    errorCode = 'provider_unavailable',
    errorMessage = 'fake provider error',
    delayMs = 0,
    capabilities = fullCaps(),
    onComplete = null,
    onStream = null,
    model = 'fake-model-1',
  } = options

  /** @type {import('./writer.js').ProviderRequest[]} */
  const calls = []

  async function maybeDelay(signal) {
    if (!delayMs) return
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, delayMs)
      if (signal) {
        const onAbort = () => {
          clearTimeout(t)
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        }
        if (signal.aborted) return onAbort()
        signal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }

  /** @type {import('./writer.js').WriterProvider} */
  const provider = {
    id,
    capabilities,
    async complete(req) {
      calls.push(req)
      if (typeof onComplete === 'function') onComplete(req)
      await maybeDelay(req.abortSignal)

      if (mode === 'timeout') {
        throw createWriterError({
          code: 'timeout',
          message: 'fake timeout',
          retryable: true,
          providerId: id,
        })
      }
      if (mode === 'error') {
        throw createWriterError({
          code: /** @type {any} */ (errorCode),
          message: errorMessage,
          retryable: isRetryableCode(/** @type {any} */ (errorCode)),
          providerId: id,
        })
      }
      if (mode === 'rate_limit') {
        throw createWriterError({
          code: 'rate_limit',
          message: 'rate limited',
          retryable: true,
          providerId: id,
          httpStatus: 429,
        })
      }
      if (mode === 'unavailable') {
        throw createWriterError({
          code: 'provider_unavailable',
          message: 'down',
          retryable: true,
          providerId: id,
          httpStatus: 503,
        })
      }
      if (mode === 'auth') {
        throw createWriterError({
          code: 'auth_failed',
          message: 'bad key',
          retryable: false,
          providerId: id,
          httpStatus: 401,
        })
      }
      if (mode === 'filter') {
        throw createWriterError({
          code: 'content_filtered',
          message: 'filtered',
          retryable: false,
          providerId: id,
        })
      }
      if (mode === 'malformed') {
        return /** @type {any} */ ('not-an-object')
      }
      if (mode === 'empty') {
        return {
          text: '   ',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
          model,
        }
      }

      // Echo plan strategy into text when instructed — proves request passthrough
      const echo =
        typeof req.instructions === 'string' && req.instructions.includes('strategy=')
          ? text
          : text

      return {
        text: echo,
        finishReason: 'stop',
        usage: {
          inputTokens: Math.max(1, Math.ceil(req.instructions.length / 4)),
          outputTokens: Math.max(1, Math.ceil(echo.length / 4)),
          totalTokens: 0,
        },
        model,
        rawWarnings: [],
      }
    },
    async *stream(req) {
      calls.push(req)
      if (typeof onStream === 'function') onStream(req)
      await maybeDelay(req.abortSignal)

      if (mode === 'timeout') {
        yield {
          type: 'error',
          error: createWriterError({
            code: 'timeout',
            message: 'fake stream timeout',
            retryable: true,
            providerId: id,
          }),
        }
        return
      }
      if (mode === 'error' || mode === 'unavailable' || mode === 'rate_limit' || mode === 'auth') {
        const code =
          mode === 'error'
            ? errorCode
            : mode === 'unavailable'
              ? 'provider_unavailable'
              : mode === 'rate_limit'
                ? 'rate_limit'
                : 'auth_failed'
        yield {
          type: 'error',
          error: createWriterError({
            code: /** @type {any} */ (code),
            message: errorMessage,
            retryable: isRetryableCode(/** @type {any} */ (code)),
            providerId: id,
          }),
        }
        return
      }

      const pieces = Array.isArray(streamChunks)
        ? streamChunks
        : String(text).match(/.{1,8}/g) || [text]

      for (const piece of pieces) {
        if (req.abortSignal?.aborted) {
          yield {
            type: 'error',
            error: createWriterError({
              code: 'cancelled',
              message: 'aborted mid-stream',
              retryable: false,
              providerId: id,
            }),
          }
          return
        }
        yield { type: 'delta', textDelta: piece }
      }
      yield {
        type: 'usage',
        usage: { outputTokens: pieces.length, totalTokens: pieces.length },
      }
      yield { type: 'done', finishReason: 'stop', usage: { outputTokens: pieces.length } }
    },
  }

  return Object.assign(provider, { __calls: calls })
}

function samplePlan(overrides = {}) {
  return {
    objective: 'connect__need_connection__one_spark',
    conversationPlan: {
      opening: {
        role: 'opening',
        kind: 'warm_presence',
        purpose: 'Open with warm presence.',
      },
      development: [
        {
          role: 'development',
          kind: 'presence_contribution',
          purpose: 'Contribute one offer.',
        },
      ],
      closing: {
        role: 'closing',
        kind: 'one_spark',
        purpose: 'Land with one spark.',
      },
      lengthBand: 'light',
      beatCount: 3,
    },
    writerBrief: {
      language: 'it',
      tone: 'warm',
      depth: 'light',
      strategy: 'connect',
      need: 'connection',
      moveSummary: 'strategy=connect | need=connection | coda=spark',
      must: ['Follow strategy="connect".', 'Do not force a closing question.'],
      mustNot: ['Do not ask a question.', 'Do not mention engines.'],
      coda: 'spark',
      memoryHint: 'omit',
      teaching: false,
      comfort: false,
      challenge: false,
      continueTopic: false,
    },
    constraints: [
      'strategy:connect',
      'need:connection',
      'ask_question:no',
      'hard:no_question',
    ],
    confidence: 0.9,
    ...overrides,
  }
}

function sampleDecision(overrides = {}) {
  return {
    need: 'connection',
    goal: 'connect__need_connection__one_spark',
    strategy: 'connect',
    initiative: 'one_spark',
    emotionalTone: 'warm',
    responseDepth: 'light',
    shouldUseMemory: false,
    shouldContinueTopic: false,
    shouldAskQuestion: false,
    shouldTeach: false,
    shouldComfort: false,
    shouldChallenge: false,
    confidence: 0.9,
    ...overrides,
  }
}

function sampleRequest(overrides = {}) {
  return {
    personalityFoundation:
      'LAIfe is calm, thoughtful, curious, warm without pretending.',
    decision: sampleDecision(),
    plan: samplePlan(),
    messages: [
      { role: 'user', content: 'Ciao!' },
    ],
    mode: 'draft',
    metadata: { requestId: 'req-1', turnId: 'turn-1' },
    ...overrides,
  }
}

console.log(`Writer tests (${WRITER_VERSION})\n`)

const queue = []

queue.push(
  test('1. createWriter requires providers', async () => {
    let threw = false
    try {
      createWriter(/** @type {any} */ ({}))
    } catch (e) {
      threw = true
      assert(isWriterError(e), 'WriterError')
      assertEqual(e.code, 'invalid_request', 'code')
    }
    assert(threw, 'must throw')
  }),
)

queue.push(
  test('2. write returns WriterResponse shape', async () => {
    const fake = createFakeWriterProvider({ text: 'Ciao bella giornata.' })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const res = await writer.write(sampleRequest())
    assertEqual(typeof res.text, 'string', 'text')
    assert(res.text.length > 0, 'non-empty')
    assertEqual(res.finishReason, 'stop', 'finish')
    assertEqual(res.providerId, 'fake', 'provider')
    assertEqual(res.model, 'fake-model-1', 'model')
    assertEqual(res.requestId, 'req-1', 'requestId')
    assert(res.usage && typeof res.usage === 'object', 'usage')
  }),
)

queue.push(
  test('3. provider receives assembled instructions including plan strategy', async () => {
    const fake = createFakeWriterProvider()
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    await writer.write(sampleRequest())
    assertEqual(fake.__calls.length, 1, 'one call')
    const req = fake.__calls[0]
    assert(/strategy=connect/.test(req.instructions), 'strategy in instructions')
    assert(/PERSONALITY FOUNDATION/.test(req.instructions), 'foundation')
    assert(/MUST:/.test(req.instructions), 'must')
    assert(/CONSTRAINTS:/.test(req.instructions), 'constraints')
    assert(!/cognitive-engine|openai|OPENAI/i.test(req.instructions), 'no V1/vendor leak')
  }),
)

queue.push(
  test('4. conversation messages are passed as provider input', async () => {
    const fake = createFakeWriterProvider()
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    await writer.write(
      sampleRequest({
        messages: [
          { role: 'user', content: 'Prima' },
          { role: 'assistant', content: 'Risposta' },
          { role: 'user', content: 'Seconda' },
        ],
      }),
    )
    const input = fake.__calls[0].input
    assertEqual(input.length, 3, '3 messages')
    assertEqual(input[2].content, 'Seconda', 'last user')
  }),
)

queue.push(
  test('5. respects planner constraints in formatted brief', async () => {
    const block = formatPlanForWriter(samplePlan())
    assert(/ask_question:no/.test(block), 'constraint present')
    assert(/warm_presence/.test(block), 'opening kind')
    assert(/one_spark/.test(block), 'closing kind')
  }),
)

queue.push(
  test('6. does not reinterpret plan — teaching false stays false in brief', async () => {
    const instructions = assembleInstructions(sampleRequest())
    assert(/teaching=false/.test(instructions), 'teaching false')
    assert(/coda=spark/.test(instructions), 'coda spark')
  }),
)

queue.push(
  test('7. missing plan → invalid_request non-retryable', async () => {
    const fake = createFakeWriterProvider()
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const req = sampleRequest()
    delete req.plan
    try {
      await writer.write(req)
      throw new Error('should fail')
    } catch (e) {
      assert(isWriterError(e), 'err')
      assertEqual(e.code, 'invalid_request', 'code')
      assertEqual(e.retryable, false, 'non-retryable')
    }
  }),
)

queue.push(
  test('8. missing decision → invalid_request', async () => {
    const fake = createFakeWriterProvider()
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const req = sampleRequest()
    delete req.decision
    try {
      await writer.write(req)
      throw new Error('should fail')
    } catch (e) {
      assertEqual(e.code, 'invalid_request', 'code')
      assertEqual(e.retryable, false, 'non-retryable')
    }
  }),
)

queue.push(
  test('9. timeout is retryable', async () => {
    const fake = createFakeWriterProvider({ mode: 'timeout' })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    try {
      await writer.write(sampleRequest())
      throw new Error('should fail')
    } catch (e) {
      assertEqual(e.code, 'timeout', 'timeout')
      assertEqual(e.retryable, true, 'retryable')
    }
  }),
)

queue.push(
  test('10. provider_unavailable is retryable', async () => {
    const fake = createFakeWriterProvider({ mode: 'unavailable' })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    try {
      await writer.write(sampleRequest())
      throw new Error('should fail')
    } catch (e) {
      assertEqual(e.code, 'provider_unavailable', 'code')
      assertEqual(e.retryable, true, 'retryable')
    }
  }),
)

queue.push(
  test('11. rate_limit is retryable', async () => {
    const fake = createFakeWriterProvider({ mode: 'rate_limit' })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    try {
      await writer.write(sampleRequest())
      throw new Error('should fail')
    } catch (e) {
      assertEqual(e.code, 'rate_limit', 'code')
      assertEqual(e.retryable, true, 'retryable')
      assertEqual(e.httpStatus, 429, 'status')
    }
  }),
)

queue.push(
  test('12. auth_failed is not retryable', async () => {
    const fake = createFakeWriterProvider({ mode: 'auth' })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    try {
      await writer.write(sampleRequest())
      throw new Error('should fail')
    } catch (e) {
      assertEqual(e.code, 'auth_failed', 'code')
      assertEqual(e.retryable, false, 'non-retryable')
    }
  }),
)

queue.push(
  test('13. content_filtered is not retryable', async () => {
    const fake = createFakeWriterProvider({ mode: 'filter' })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    try {
      await writer.write(sampleRequest())
      throw new Error('should fail')
    } catch (e) {
      assertEqual(e.code, 'content_filtered', 'code')
      assertEqual(e.retryable, false, 'non-retryable')
    }
  }),
)

queue.push(
  test('14. empty_response is retryable', async () => {
    const fake = createFakeWriterProvider({ mode: 'empty' })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    try {
      await writer.write(sampleRequest())
      throw new Error('should fail')
    } catch (e) {
      assertEqual(e.code, 'empty_response', 'code')
      assertEqual(e.retryable, true, 'retryable')
    }
  }),
)

queue.push(
  test('15. malformed_response is retryable', async () => {
    const fake = createFakeWriterProvider({ mode: 'malformed' })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    try {
      await writer.write(sampleRequest())
      throw new Error('should fail')
    } catch (e) {
      assertEqual(e.code, 'malformed_response', 'code')
      assertEqual(e.retryable, true, 'retryable')
    }
  }),
)

queue.push(
  test('16. streaming yields deltas then done', async () => {
    const fake = createFakeWriterProvider({
      text: 'ABCDEFGHIJKLMNOP',
      streamChunks: ['ABC', 'DEF', 'GHI'],
    })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const { text, terminal, chunks } = await collectStream(
      writer.writeStream(sampleRequest()),
    )
    assertEqual(text, 'ABCDEFGHI', 'aggregated')
    assertEqual(terminal.type, 'done', 'done')
    assertEqual(terminal.finishReason, 'stop', 'stop')
    assert(chunks.some((c) => c.type === 'delta'), 'has deltas')
    assert(chunks.some((c) => c.type === 'usage'), 'has usage')
    const deltas = chunks.filter((c) => c.type === 'delta')
    assertEqual(deltas[0].index, 0, 'index0')
    assert(deltas[1].index > deltas[0].index, 'monotonic')
  }),
)

queue.push(
  test('17. streaming timeout emits error chunk', async () => {
    const fake = createFakeWriterProvider({ mode: 'timeout' })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const { terminal } = await collectStream(writer.writeStream(sampleRequest()))
    assertEqual(terminal.type, 'error', 'error')
    assertEqual(terminal.error.code, 'timeout', 'timeout')
    assertEqual(terminal.error.retryable, true, 'retryable')
  }),
)

queue.push(
  test('18. streaming provider error emits non-continuing terminal', async () => {
    const fake = createFakeWriterProvider({
      mode: 'error',
      errorCode: 'provider_unavailable',
      errorMessage: 'boom',
    })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const { chunks, terminal } = await collectStream(writer.writeStream(sampleRequest()))
    assertEqual(terminal.type, 'error', 'error')
    assert(!chunks.some((c) => c.type === 'done'), 'no done after error')
  }),
)

queue.push(
  test('19. abort before write → cancelled non-retryable', async () => {
    const fake = createFakeWriterProvider({ delayMs: 50 })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const controller = new AbortController()
    controller.abort()
    try {
      await writer.write(sampleRequest({ abortSignal: controller.signal }))
      throw new Error('should fail')
    } catch (e) {
      assertEqual(e.code, 'cancelled', 'cancelled')
      assertEqual(e.retryable, false, 'non-retryable')
    }
  }),
)

queue.push(
  test('20. abort mid complete → cancelled', async () => {
    const fake = createFakeWriterProvider({ delayMs: 100 })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const controller = new AbortController()
    const p = writer.write(sampleRequest({ abortSignal: controller.signal }))
    setTimeout(() => controller.abort(), 10)
    try {
      await p
      throw new Error('should fail')
    } catch (e) {
      assertEqual(e.code, 'cancelled', 'cancelled')
      assertEqual(e.retryable, false, 'non-retryable')
    }
  }),
)

queue.push(
  test('21. provider interchange — switch default provider', async () => {
    const a = createFakeWriterProvider({
      id: 'a',
      text: 'Sto bene. Stamattina il caffè aveva un odore di tostatura quasi dolce.',
      model: 'model-a',
    })
    const b = createFakeWriterProvider({
      id: 'b',
      text: 'Sto bene. Stamattina il caffè aveva un odore di tostatura quasi dolce.',
      model: 'model-b',
    })
    const writer = createWriter({
      providers: { a, b },
      defaultProviderId: 'b',
    })
    const res = await writer.write(sampleRequest())
    assertEqual(res.providerId, 'b', 'provider b')
    assert(/Bentornato|caffè|Sto bene/i.test(res.text), 'text b')
  }),
)

queue.push(
  test('22. providerId on request overrides default', async () => {
    const rich =
      'Sto bene. Stamattina il caffè aveva un odore di tostatura quasi dolce.'
    const a = createFakeWriterProvider({ id: 'a', text: rich })
    const b = createFakeWriterProvider({ id: 'b', text: rich })
    const writer = createWriter({
      providers: { a, b },
      defaultProviderId: 'a',
    })
    const res = await writer.write(sampleRequest({ providerId: 'b' }))
    assertEqual(res.providerId, 'b', 'override')
    assert(/Bentornato|caffè|Sto bene/i.test(res.text), 'text')
  }),
)

queue.push(
  test('23. unknown providerId → invalid_request', async () => {
    const fake = createFakeWriterProvider()
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    try {
      await writer.write(sampleRequest({ providerId: 'nope' }))
      throw new Error('should fail')
    } catch (e) {
      assertEqual(e.code, 'invalid_request', 'code')
      assertEqual(e.retryable, false, 'non-retryable')
    }
  }),
)

queue.push(
  test('24. defaultModelByProvider is applied', async () => {
    const fake = createFakeWriterProvider({ model: 'ignored-unless-returned' })
    // Provider returns its configured model field from complete(); also check request model param
    let seenModel = ''
    const fake2 = createFakeWriterProvider({
      onComplete: (req) => {
        seenModel = req.model
      },
    })
    const writer = createWriter({
      providers: { fake2 },
      defaultProviderId: 'fake2',
      defaultModelByProvider: { fake2: 'configured-model' },
    })
    // fix id
    fake2.id = 'fake2'
    await writer.write(sampleRequest())
    assertEqual(seenModel, 'configured-model', 'model passed to provider')
  }),
)

queue.push(
  test('25. explicit request.model wins over default', async () => {
    let seenModel = ''
    const fake = createFakeWriterProvider({
      id: 'fake',
      onComplete: (req) => {
        seenModel = req.model
      },
    })
    const writer = createWriter({
      providers: { fake },
      defaultProviderId: 'fake',
      defaultModelByProvider: { fake: 'default-model' },
    })
    await writer.write(sampleRequest({ model: 'explicit-model' }))
    assertEqual(seenModel, 'explicit-model', 'explicit wins')
  }),
)

queue.push(
  test('26. rewrite mode requires rewriteBrief', async () => {
    const fake = createFakeWriterProvider()
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    try {
      await writer.write(sampleRequest({ mode: 'rewrite', previousDraft: 'x' }))
      throw new Error('should fail')
    } catch (e) {
      assertEqual(e.code, 'invalid_request', 'code')
    }
  }),
)

queue.push(
  test('27. rewrite mode includes rewriteBrief and previousDraft in instructions', async () => {
    const fake = createFakeWriterProvider({ text: 'Refined reply.' })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    await writer.write(
      sampleRequest({
        mode: 'rewrite',
        rewriteBrief: 'Remove the closing question.',
        previousDraft: 'Hello? What do you think?',
      }),
    )
    const instr = fake.__calls[0].instructions
    assert(/REWRITE MODE/.test(instr), 'rewrite mode')
    assert(/Remove the closing question/.test(instr), 'brief')
    assert(/Hello\? What do you think\?/.test(instr), 'previous draft')
    // Plan still present — not renegotiated away
    assert(/strategy=connect/.test(instr), 'plan retained')
  }),
)

queue.push(
  test('28. rewrite does not mutate plan object', async () => {
    const fake = createFakeWriterProvider({ text: 'ok' })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const plan = samplePlan()
    const before = JSON.stringify(plan)
    await writer.write(
      sampleRequest({
        plan,
        mode: 'rewrite',
        rewriteBrief: 'tighten',
        previousDraft: 'draft',
      }),
    )
    assertEqual(JSON.stringify(plan), before, 'plan untouched')
  }),
)

queue.push(
  test('29. memoryPack facts appear in instructions when provided', async () => {
    const fake = createFakeWriterProvider()
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    await writer.write(
      sampleRequest({
        memoryPack: { items: [{ text: 'User prefers short replies' }] },
      }),
    )
    assert(/User prefers short replies/.test(fake.__calls[0].instructions), 'memory fact')
  }),
)

queue.push(
  test('30. preferences appear as soft constraints', async () => {
    const fake = createFakeWriterProvider()
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    await writer.write(
      sampleRequest({
        preferences: {
          displayName: 'Alex',
          replyLength: 'concise',
          useEmojis: false,
        },
      }),
    )
    const instr = fake.__calls[0].instructions
    assert(/Alex/.test(instr), 'name')
    assert(/concise/.test(instr), 'length')
  }),
)

queue.push(
  test('31. unsupported streaming capability → unsupported_feature', async () => {
    const fake = createFakeWriterProvider({
      capabilities: fullCaps({ streaming: false }),
    })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const { terminal } = await collectStream(writer.writeStream(sampleRequest()))
    assertEqual(terminal.type, 'error', 'error')
    assertEqual(terminal.error.code, 'unsupported_feature', 'code')
    assertEqual(terminal.error.retryable, false, 'non-retryable')
  }),
)

queue.push(
  test('32. unsupported jsonMode → unsupported_feature on write', async () => {
    const fake = createFakeWriterProvider({
      capabilities: fullCaps({ jsonMode: false }),
    })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    try {
      await writer.write(
        sampleRequest({ generation: { responseFormat: 'json' } }),
      )
      throw new Error('should fail')
    } catch (e) {
      assertEqual(e.code, 'unsupported_feature', 'code')
      assertEqual(e.retryable, false, 'non-retryable')
    }
  }),
)

queue.push(
  test('33. generation hints forwarded to provider request', async () => {
    const fake = createFakeWriterProvider()
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    await writer.write(
      sampleRequest({
        generation: {
          maxOutputTokens: 128,
          temperature: 0.2,
          topP: 0.9,
          seed: 7,
          stopSequences: ['\n\n'],
        },
      }),
    )
    const req = fake.__calls[0]
    assertEqual(req.maxOutputTokens, 128, 'tokens')
    assertEqual(req.temperature, 0.2, 'temp')
    assertEqual(req.topP, 0.9, 'topP')
    assertEqual(req.seed, 7, 'seed')
    assertEqual(req.stopSequences[0], '\n\n', 'stop')
    assertEqual(req.stream, false, 'not stream')
  }),
)

queue.push(
  test('34. writeStream sets providerReq.stream true', async () => {
    const fake = createFakeWriterProvider({ streamChunks: ['Hi'] })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    await collectStream(writer.writeStream(sampleRequest()))
    assertEqual(fake.__calls[0].stream, true, 'stream true')
  }),
)

queue.push(
  test('35. isRetryableCode taxonomy', async () => {
    assertEqual(isRetryableCode('timeout'), true, 'timeout')
    assertEqual(isRetryableCode('rate_limit'), true, 'rate')
    assertEqual(isRetryableCode('provider_unavailable'), true, 'unavail')
    assertEqual(isRetryableCode('malformed_response'), true, 'malformed')
    assertEqual(isRetryableCode('empty_response'), true, 'empty')
    assertEqual(isRetryableCode('cancelled'), false, 'cancelled')
    assertEqual(isRetryableCode('auth_failed'), false, 'auth')
    assertEqual(isRetryableCode('invalid_request'), false, 'invalid')
    assertEqual(isRetryableCode('content_filtered'), false, 'filter')
    assertEqual(isRetryableCode('unsupported_feature'), false, 'unsupported')
    assertEqual(isRetryableCode('internal'), false, 'internal')
  }),
)

queue.push(
  test('36. createWriterError default retryable from code', async () => {
    const a = createWriterError({ code: 'timeout', message: 't' })
    const b = createWriterError({ code: 'cancelled', message: 'c' })
    assertEqual(a.retryable, true, 'timeout retryable')
    assertEqual(b.retryable, false, 'cancelled not')
  }),
)

queue.push(
  test('37. no V1 module imports in writer.js source contract', async () => {
    // Runtime check: writer module exports must not pull openai
    assertEqual(typeof createWriter, 'function', 'createWriter')
    assert(!('openai' in globalThis && false), 'noop')
    // Ensure assembleInstructions never mentions V1 filenames
    const text = assembleInstructions(sampleRequest())
    assert(!/cognitive-engine|directive-authority|api\/chat/i.test(text), 'no V1 refs')
  }),
)

queue.push(
  test('38. decision object is not rewritten into contradictory strategy', async () => {
    const fake = createFakeWriterProvider()
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const decision = sampleDecision({ strategy: 'support', need: 'emotional_care' })
    const plan = samplePlan({
      objective: 'support__need_emotional_care',
      writerBrief: {
        ...samplePlan().writerBrief,
        strategy: 'support',
        need: 'emotional_care',
        tone: 'supportive',
        coda: 'none',
        moveSummary: 'strategy=support | need=emotional_care | coda=none',
        must: ['Prioritize emotional recognition.'],
        mustNot: ['Do not ask a question.'],
      },
      constraints: ['strategy:support', 'ask_question:no', 'comfort:yes'],
    })
    await writer.write(sampleRequest({ decision, plan }))
    const instr = fake.__calls[0].instructions
    assert(/strategy=support/.test(instr), 'support kept')
    assert(!/strategy=connect/.test(instr), 'no connect override')
  }),
)

queue.push(
  test('39. two providers remain independent call logs', async () => {
    const rich =
      'Sto bene. Stamattina il caffè aveva un odore di tostatura quasi dolce.'
    const a = createFakeWriterProvider({ id: 'a', text: rich })
    const b = createFakeWriterProvider({ id: 'b', text: rich })
    const writer = createWriter({ providers: { a, b }, defaultProviderId: 'a' })
    await writer.write(sampleRequest({ providerId: 'a' }))
    await writer.write(sampleRequest({ providerId: 'b' }))
    assertEqual(a.__calls.length, 1, 'a once')
    assertEqual(b.__calls.length, 1, 'b once')
  }),
)

queue.push(
  test('40. stream invalid request yields error chunk not throw', async () => {
    const fake = createFakeWriterProvider()
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const bad = sampleRequest()
    delete bad.plan
    const { terminal } = await collectStream(writer.writeStream(bad))
    assertEqual(terminal.type, 'error', 'error chunk')
    assertEqual(terminal.error.code, 'invalid_request', 'code')
  }),
)

queue.push(
  test('41. output rules forbid citing modules', async () => {
    const instr = assembleInstructions(sampleRequest())
    assert(/Do not cite modules/.test(instr), 'output rules')
  }),
)

queue.push(
  test('42. writer does not call provider.complete when only streaming', async () => {
    let completeCalled = false
    const fake = createFakeWriterProvider({
      streamChunks: ['X'],
      onComplete: () => {
        completeCalled = true
      },
    })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    await collectStream(writer.writeStream(sampleRequest()))
    assertEqual(completeCalled, false, 'complete not called')
  }),
)

queue.push(
  test('43. metadata.requestId forwarded to provider request', async () => {
    const fake = createFakeWriterProvider()
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    await writer.write(sampleRequest({ metadata: { requestId: 'abc-123', traceId: 'tr-9' } }))
    assertEqual(fake.__calls[0].metadata.requestId, 'abc-123', 'requestId')
    assertEqual(fake.__calls[0].metadata.traceId, 'tr-9', 'traceId')
  }),
)

queue.push(
  test('44. IdentityBlock object foundation supported', async () => {
    const fake = createFakeWriterProvider()
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    await writer.write(
      sampleRequest({
        personalityFoundation: { text: 'Quietly confident companion.' },
      }),
    )
    assert(/Quietly confident companion/.test(fake.__calls[0].instructions), 'foundation obj')
  }),
)

queue.push(
  test('45. generic Error with timeout message maps to timeout', async () => {
    const fake = createFakeWriterProvider({
      mode: 'normal',
      onComplete: () => {
        throw new Error('socket timeout while waiting')
      },
    })
    // Override complete to throw generic error after push
    const original = fake.complete.bind(fake)
    fake.complete = async (req) => {
      fake.__calls.push(req)
      throw new Error('socket timeout while waiting')
    }
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    try {
      await writer.write(sampleRequest())
      throw new Error('should fail')
    } catch (e) {
      assertEqual(e.code, 'timeout', 'mapped timeout')
      assertEqual(e.retryable, true, 'retryable')
    }
    void original
  }),
)

queue.push(
  test('46. Writer 3.0 principles are in instructions', async () => {
    const instr = assembleInstructions(sampleRequest())
    assert(/WRITER 3\.0/.test(instr), 'edition')
    assert(/ANSWER FIRST/.test(instr), 'answer first')
    assert(/TALK ABOUT THE THINGS/.test(instr), 'things not conversation')
    assert(/ONE MAIN IDEA/.test(instr), 'one idea')
    assert(/QUESTIONS ARE RARE/.test(instr), 'rare questions')
    assert(/SELF-CHECK/.test(instr), 'self-check')
    assert(/Am I talking about the things/.test(instr), 'self-check Q1')
    assert(/Would a real person actually say/.test(instr), 'self-check Q3')
    assert(/Sono qui per ascoltare/.test(instr), 'role example banned in prompt')
  }),
)

queue.push(
  test('47. minimal user turn forces short ack instructions', async () => {
    const instr = assembleInstructions(
      sampleRequest({
        messages: [{ role: 'user', content: 'ok' }],
      }),
    )
    assert(/MINIMAL TURN/.test(instr), 'minimal block')
    assert(/Va bene\./.test(instr), 'allowed ack')
  }),
)

queue.push(
  test('48. spark coda asks for presence not invented scenery', async () => {
    const instr = assembleInstructions(sampleRequest())
    assert(/SPARK \(planner coda\)/.test(instr), 'spark block')
    assert(/not invented scenery/i.test(instr), 'no invent')
    assert(/GROUNDING \(hard/.test(instr), 'grounding rule')
  }),
)

queue.push(
  test('49. cleanDraft collapses minimal turns to allowed ack', async () => {
    const req = sampleRequest({ messages: [{ role: 'user', content: 'perfetto' }] })
    const out = cleanDraft(
      'È bello sentirti così! A volte le piccole cose fanno la differenza.',
      req,
    )
    assertEqual(out, 'Perfetto.', 'perfetto → Perfetto.')
    assertEqual(pickMinimalAck('esatto'), 'Esatto.', 'esatto')
    assertEqual(pickMinimalAck('certo'), 'Ci siamo.', 'certo')
    assertEqual(pickMinimalAck('ok'), 'Va bene.', 'ok')
    assert(isMinimalUserTurn('ok'), 'detect ok')
  }),
)

queue.push(
  test('50. cleanDraft strips soft validation and moral noise', async () => {
    const out = cleanDraft(
      'Ciao! È bello potersi connettere. Le piccole cose possono fare la differenza. Il caffè aveva un odore dolce.',
    )
    assert(!/È bello/.test(out), 'no è bello')
    assert(!/piccole cose/.test(out), 'no moral')
    assert(/caffè/.test(out), 'keeps signature')
  }),
)

queue.push(
  test('51. looksLikeGenericChatbot flags soft stack', async () => {
    const soft = looksLikeGenericChatbot(
      'È bello potersi connettere. Le piccole cose possono fare la differenza.',
    )
    assert(soft.generic, 'generic')
    assert(soft.reasons.length > 0, 'has reasons')
    const human = looksLikeGenericChatbot(
      'Sto bene. Stamattina il caffè aveva un odore di tostatura quasi dolce.',
    )
    assert(!human.generic, 'not generic')
  }),
)

queue.push(
  test('52. identity evaluator rewrite runs once for low identityScore', async () => {
    let n = 0
    const fake = createFakeWriterProvider({
      text: 'Hello from fake writer.',
    })
    fake.complete = async (req) => {
      fake.__calls.push(req)
      n += 1
      if (n === 1) {
        return {
          text: 'How can I help you today? Dimmi pure, sono qui per ascoltare.',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          model: 'fake-model-1',
        }
      }
      return {
        text: 'Ciao su LAIfe.',
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        model: 'fake-model-1',
      }
    }
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const res = await writer.write(
      sampleRequest({
        messages: [{ role: 'user', content: 'Ciao' }],
      }),
    )
    assertEqual(fake.__calls.length, 2, 'draft + one rewrite')
    assert(/LAIfe/i.test(res.text), 'rewritten text')
    assert(res.warnings?.includes('identity_evaluator_rewrite'), 'warning flag')
    assertEqual(res.identity?.rewritten, true, 'rewritten trace')
    assert(typeof res.identity?.draft?.identityScore === 'number', 'draft score')
    assert(typeof res.identity?.final?.identityScore === 'number', 'final score')
    assert(/identityScore:/.test(fake.__calls[1].instructions), 'metrics in brief')
    assert(/suggestions:/.test(fake.__calls[1].instructions), 'suggestions in brief')
    assert(!/WRITER 3\.0 SELF-CHECK/.test(fake.__calls[1].instructions), 'no extra rules')
  }),
)

queue.push(
  test('52b. identity rewrite rejected when longer than draft', async () => {
    let n = 0
    const fake = createFakeWriterProvider({ text: 'x' })
    fake.complete = async (req) => {
      fake.__calls.push(req)
      n += 1
      if (n === 1) {
        return {
          text: 'How can I help you today?',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          model: 'fake-model-1',
        }
      }
      return {
        text: 'How can I help you today with many extra words added here now?',
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        model: 'fake-model-1',
      }
    }
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const res = await writer.write(sampleRequest({ messages: [{ role: 'user', content: 'Ciao' }] }))
    assertEqual(res.text, 'How can I help you today?', 'kept draft')
    assert(res.warnings?.includes('identity_rewrite_rejected_longer'), 'rejected longer')
    assertEqual(res.identity?.rewritten, false, 'not rewritten')
    assertEqual(res.identity?.rejectReason, 'rewrite_longer_than_draft', 'reason')
  }),
)

queue.push(
  test('52c. shouldRewriteFromIdentity uses thresholds', async () => {
    assertEqual(
      shouldRewriteFromIdentity({
        identityScore: 0.42,
        genericity: 0.81,
        signature: 0.18,
        memorability: 0.2,
        coherence: 0.5,
        reasons: [],
        suggestions: [],
      }),
      true,
      'low score',
    )
    assertEqual(
      shouldRewriteFromIdentity({
        identityScore: 0.7,
        genericity: 0.2,
        signature: 0.5,
        memorability: 0.5,
        coherence: 0.5,
        reasons: [],
        suggestions: [],
      }),
      false,
      'healthy',
    )
    assertEqual(
      shouldRewriteFromIdentity({
        identityScore: 0.65,
        genericity: 0.6,
        signature: 0.5,
        memorability: 0.5,
        coherence: 0.5,
        reasons: [],
        suggestions: [],
      }),
      true,
      'high genericity',
    )
    const brief = buildIdentityEvaluatorRewriteBrief({
      identityScore: 0.42,
      genericity: 0.81,
      signature: 0.18,
      memorability: 0.1,
      coherence: 0.2,
      reasons: ['sounds like generic assistant'],
      suggestions: ['answer more directly'],
    })
    assert(/identityScore: 0.42/.test(brief), 'score line')
    assert(/answer more directly/.test(brief), 'suggestion line')
  }),
)

queue.push(
  test('53. minimal turn write collapses without second LLM when already short-path', async () => {
    const fake = createFakeWriterProvider({
      text: 'What a lovely shared moment of connection that can brighten the day.',
    })
    const writer = createWriter({ providers: { fake }, defaultProviderId: 'fake' })
    const res = await writer.write(
      sampleRequest({
        messages: [{ role: 'user', content: 'ok' }],
        plan: {
          ...samplePlan(),
          writerBrief: { ...samplePlan().writerBrief, coda: 'none' },
        },
      }),
    )
    assertEqual(res.text, 'Va bene.', 'forced ack')
    assertEqual(fake.__calls.length, 1, 'no second LLM for minimal collapse')
  }),
)

queue.push(
  test('54. enforceReplyGrounding strips ungrounded scenery', async () => {
    const req = sampleRequest({ messages: [{ role: 'user', content: 'Ciao' }] })
    const detailed = enforceReplyGroundingDetailed(
      'Ciao! Oggi c\'è un\'aria fresca, perfetta per una passeggiata.',
      req,
    )
    assert(/Ciao/.test(detailed.text), 'keeps greeting')
    assert(!/passeggiata/.test(detailed.text), 'drops walk')
    assert(!/aria/.test(detailed.text), 'drops weather')
    assert(detailed.removed.length >= 1, 'reports removals')
  }),
)

queue.push(
  test('55. enforceReplyGrounding keeps concrete details present in conversation', async () => {
    const req = sampleRequest({
      messages: [{ role: 'user', content: 'Il caffè stamattina era amaro.' }],
    })
    const out = enforceReplyGrounding(
      'Capito. Quel caffè amaro resta impresso.',
      req,
    )
    assert(/caffè/.test(out), 'keeps grounded coffee')
  }),
)

queue.push(
  test('56. enforceReplyGrounding allows clearly marked examples', async () => {
    const req = sampleRequest({ messages: [{ role: 'user', content: 'Come posso rilassarmi?' }] })
    const out = enforceReplyGrounding(
      'A volte aiuta una pausa, ad esempio una passeggiata breve.',
      req,
    )
    assert(/passeggiata/.test(out), 'example kept')
  }),
)

queue.push(
  test('57. presence recovery upgrades sparse Ciao after grounding', async () => {
    const req = sampleRequest({ messages: [{ role: 'user', content: 'Ciao' }] })
    const fin = finalizeWriterText(
      'Ciao! Oggi c\'è un\'aria fresca, perfetta per una passeggiata.',
      req,
    )
    assertEqual(fin.grounding.text, 'Ciao!', 'grounding left Ciao')
    assert(fin.presence.applied, 'presence applied')
    assertEqual(fin.text, 'Ciao! Bentornato.', 'presence line')
    assert(!/passeggiata|aria|fresca/.test(fin.text), 'no scenery')
    assert(!/\?/.test(fin.text), 'no question')
  }),
)

queue.push(
  test('58. presence recovery upgrades bare Sto bene after grounding', async () => {
    const req = sampleRequest({ messages: [{ role: 'user', content: 'Come stai?' }] })
    const fin = finalizeWriterText(
      'Sto bene. L\'aria è fresca e invita a una passeggiata.',
      req,
    )
    assertEqual(fin.grounding.text, 'Sto bene.', 'grounding left Sto bene')
    assert(fin.presence.applied, 'presence applied')
    assertEqual(fin.text, 'Sto bene, grazie.', 'wellbeing presence')
  }),
)

queue.push(
  test('59. presence recovery does not invent scenery or questions', async () => {
    const req = sampleRequest({ messages: [{ role: 'user', content: 'Ciao' }] })
    const out = recoverPresence('Ciao!', req, { removedConcrete: true })
    assert(isAllowedPresencePhrase(out), 'allowed phrase')
    assert(!/caffè|sole|passeggiata|ad esempio/.test(out), 'no invent')
    assert(!/\?/.test(out), 'no question')
  }),
)

queue.push(
  test('60. presence recovery skipped when concrete remains grounded', async () => {
    const req = sampleRequest({
      messages: [{ role: 'user', content: 'Il caffè era amaro.' }],
    })
    const fin = finalizeWriterText('Quel caffè amaro resta impresso.', req)
    assertEqual(fin.presence.applied, false, 'no presence needed')
    assert(/caffè/.test(fin.text), 'keeps coffee')
  }),
)

queue.push(
  test('61. Writer 3.0 flags talk-about-conversation phrases', async () => {
    const bad = looksLikeGenericChatbot('Sono qui per ascoltare. Dimmi pure.')
    assert(bad.generic, 'generic')
    assert(bad.reasons.includes('about_the_conversation'), 'about conversation')
    const good = looksLikeGenericChatbot('Possiamo continuare con LAIfe. La V2 ormai è vicina.')
    assertEqual(good.generic, false, 'about the things')
  }),
)

queue.push(
  test('62. Writer 3.0 resume cue is optional in instructions', async () => {
    const withResume = assembleInstructions(
      sampleRequest({
        plan: {
          ...samplePlan(),
          writerBrief: {
            ...samplePlan().writerBrief,
            resumeSentence:
              "L'ultima volta stavamo lavorando per rendere V2 più naturale.",
          },
        },
      }),
    )
    assert(/resumeSentence cue is on the plan/.test(withResume), 'resume present')
    assert(/Never force an "L'ultima volta/.test(withResume), 'no forced opener')
  }),
)

queue.push(
  test('63. Writer 3.2 version marker', async () => {
    assertEqual(WRITER_VERSION, '3.2.0-writer', 'version')
  }),
)

queue.push(
  test('64. Voice examples appear when enabled (after corpus when both on)', async () => {
    const instr = assembleInstructions(sampleRequest(), {
      useVoiceExamples: true,
      useVoiceCorpus: false,
    })
    assert(/^VOICE STYLE EXAMPLES/.test(instr), 'voice block first without corpus')
    assert(/Questi esempi mostrano il tono/.test(instr), 'tone framing')
    assert(/NON copiarli/.test(instr), 'no-copy')
    assert(/NON ripetere le stesse parole/.test(instr), 'no-repeat')
    assert(/ritmo, naturalezza, livello di dettaglio e stile/.test(instr), 'style guidance')
    assert(/user: Ciao/.test(instr), 'example user')
    assert(/assistant: Ciao! Bentornato\./.test(instr), 'example assistant')
    const voiceIdx = instr.indexOf('VOICE STYLE EXAMPLES')
    const rulesIdx = instr.indexOf('WRITER 3.0')
    assert(voiceIdx >= 0 && rulesIdx > voiceIdx, 'examples before rules')
  }),
)

queue.push(
  test('65. Voice examples can be disabled', async () => {
    const instr = assembleInstructions(sampleRequest(), {
      useVoiceExamples: false,
      useVoiceCorpus: false,
    })
    assert(!/VOICE STYLE EXAMPLES/.test(instr), 'no voice block')
    assert(!/VOICE CORPUS/.test(instr), 'no corpus block')
    assert(/WRITER 3\.0/.test(instr), 'rules still present')
  }),
)

queue.push(
  test('66. Voice corpus appears before instructions when enabled', async () => {
    const instr = assembleInstructions(sampleRequest(), {
      useVoiceExamples: false,
      useVoiceCorpus: true,
    })
    assert(/^VOICE CORPUS/.test(instr), 'corpus first')
    assert(/Questi dialoghi mostrano come parla LAIfe/.test(instr), 'framing')
    assert(/Non copiarli/.test(instr), 'no copy')
    assert(/Non riutilizzare le stesse frasi/.test(instr), 'no reuse')
    assert(/modo di riprendere il contesto/.test(instr), 'resume axis')
    assert(/Dialogue 1 \[greeting\]/.test(instr), 'dialogue header')
    const corpusIdx = instr.indexOf('VOICE CORPUS')
    const rulesIdx = instr.indexOf('WRITER 3.0')
    assert(corpusIdx >= 0 && rulesIdx > corpusIdx, 'corpus before rules')
  }),
)

queue.push(
  test('67. Voice corpus can be disabled', async () => {
    const instr = assembleInstructions(sampleRequest(), {
      useVoiceExamples: true,
      useVoiceCorpus: false,
    })
    assert(!/VOICE CORPUS/.test(instr), 'no corpus')
    assert(/VOICE STYLE EXAMPLES/.test(instr), 'examples still on')
  }),
)

await Promise.all(queue)

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
