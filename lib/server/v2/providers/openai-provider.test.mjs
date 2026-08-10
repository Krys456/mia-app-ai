#!/usr/bin/env node
/**
 * Isolated tests for LAIfe V2 OpenAI WriterProvider adapter.
 * Uses a mocked OpenAI Responses client — no network, no V1, no api/chat.ts.
 *
 * Run: node lib/server/v2/providers/openai-provider.test.mjs
 */

import { isWriterError } from '../brain/writer.js'
import {
  createOpenAIProvider,
  toOpenAICreateArgs,
  toOpenAIInput,
  mapUsage,
  mapFinishReason,
  extractOutputText,
  extractStreamDelta,
  mapOpenAIError,
  toProviderResponse,
  OPENAI_PROVIDER_ID,
  OPENAI_PROVIDER_VERSION,
} from './openai-provider.js'

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

/** @returns {import('../brain/writer.js').ProviderRequest} */
function baseRequest(overrides = {}) {
  return {
    model: 'gpt-4o-mini',
    instructions: 'Be concise.',
    input: [{ role: 'user', content: 'Ciao' }],
    stream: false,
    maxOutputTokens: 128,
    temperature: 0.4,
    metadata: { requestId: 'req-1' },
    ...overrides,
  }
}

/**
 * @param {object[]} events
 * @returns {AsyncIterable<any>}
 */
function asyncIterable(events) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e
    },
  }
}

/**
 * @param {{
 *   completeResult?: any,
 *   completeError?: Error,
 *   streamEvents?: object[],
 *   streamError?: Error,
 *   delayMs?: number,
 *   capture?: { args?: any, opts?: any }[],
 * }} [opts]
 */
function createMockClient(opts = {}) {
  const capture = opts.capture || []
  return {
    responses: {
      async create(args, createOpts) {
        capture.push({ args, opts: createOpts })
        if (opts.delayMs) {
          await new Promise((r) => setTimeout(r, opts.delayMs))
        }
        if (args.stream) {
          if (opts.streamError) throw opts.streamError
          return asyncIterable(opts.streamEvents || [])
        }
        if (opts.completeError) throw opts.completeError
        return (
          opts.completeResult || {
            output_text: 'Ciao!',
            status: 'completed',
            model: 'gpt-4o-mini',
            usage: {
              input_tokens: 10,
              output_tokens: 4,
              total_tokens: 14,
            },
          }
        )
      },
    },
  }
}

async function collectStream(iterable) {
  /** @type {any[]} */
  const events = []
  for await (const e of iterable) events.push(e)
  return events
}

// ---------------------------------------------------------------------------
console.log('\nOpenAI Provider V2 tests\n')

await test('exports version and id constants', () => {
  assertEqual(OPENAI_PROVIDER_ID, 'openai', 'id')
  assert(typeof OPENAI_PROVIDER_VERSION === 'string', 'version string')
})

await test('createOpenAIProvider requires client', () => {
  let threw = false
  try {
    // @ts-expect-error intentional
    createOpenAIProvider({})
  } catch (err) {
    threw = true
    assert(isWriterError(err), 'WriterError')
    assertEqual(/** @type {any} */ (err).code, 'invalid_request', 'code')
  }
  assert(threw, 'should throw')
})

await test('provider implements WriterProvider shape', () => {
  const provider = createOpenAIProvider({ client: createMockClient() })
  assertEqual(provider.id, 'openai', 'id')
  assert(typeof provider.complete === 'function', 'complete')
  assert(typeof provider.stream === 'function', 'stream')
  assert(provider.capabilities.streaming === true, 'streaming cap')
})

await test('toOpenAIInput maps roles and skips empties', () => {
  const input = toOpenAIInput({
    model: 'x',
    instructions: '',
    stream: false,
    input: [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      { role: 'system', content: 'sys' },
      { role: 'tool', content: 'nope' },
      { role: 'user', content: '' },
      null,
    ],
  })
  assertEqual(input.length, 3, 'length')
  assertEqual(input[0].type, 'message', 'type')
  assertEqual(input[0].role, 'user', 'role0')
  assertEqual(input[0].content, 'Hi', 'content0')
})

await test('toOpenAICreateArgs translates ProviderRequest without inventing prompt', () => {
  const args = toOpenAICreateArgs(
    baseRequest({
      instructions: 'EXACT_BRIEF',
      input: [{ role: 'user', content: 'EXACT_USER' }],
      topP: 0.9,
      seed: 7,
    }),
    'fallback-model',
    false,
  )
  assertEqual(args.instructions, 'EXACT_BRIEF', 'instructions passthrough')
  assertEqual(args.input[0].content, 'EXACT_USER', 'input passthrough')
  assertEqual(args.model, 'gpt-4o-mini', 'model')
  assertEqual(args.max_output_tokens, 128, 'max_output_tokens')
  assertEqual(args.temperature, 0.4, 'temperature')
  assertEqual(args.top_p, 0.9, 'top_p')
  assertEqual(args.seed, 7, 'seed')
  assertEqual(args.stream, false, 'stream')
  // Must not append or rewrite instructions
  assert(!String(args.instructions).includes('You are'), 'no prompt construction')
})

await test('extractOutputText prefers output_text then walks output[]', () => {
  assertEqual(
    extractOutputText({ output_text: 'A' }),
    'A',
    'output_text',
  )
  assertEqual(
    extractOutputText({
      output: [
        {
          type: 'message',
          content: [{ text: 'Hello' }, { text: ' ' }, { text: 'world' }],
        },
      ],
    }),
    'Hello world',
    'walk',
  )
})

await test('mapUsage normalizes OpenAI usage fields', () => {
  const u = mapUsage({
    input_tokens: 11,
    output_tokens: 5,
    total_tokens: 16,
    input_tokens_details: { cached_tokens: 2 },
    output_tokens_details: { reasoning_tokens: 1 },
  })
  assertEqual(u.inputTokens, 11, 'in')
  assertEqual(u.outputTokens, 5, 'out')
  assertEqual(u.totalTokens, 16, 'total')
  assertEqual(u.cachedInputTokens, 2, 'cached')
  assertEqual(u.thinkingTokens, 1, 'thinking')
})

await test('mapFinishReason maps stop / length / content_filter / cancelled', () => {
  assertEqual(mapFinishReason({ status: 'completed' }), 'stop', 'stop')
  assertEqual(
    mapFinishReason({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    }),
    'length',
    'length',
  )
  assertEqual(
    mapFinishReason({ finish_reason: 'content_filter' }),
    'content_filter',
    'filter',
  )
  assertEqual(mapFinishReason({ status: 'cancelled' }), 'cancelled', 'cancel')
})

await test('toProviderResponse returns text, usage, finishReason, model', () => {
  const res = toProviderResponse(
    {
      output_text: 'Risposta',
      status: 'completed',
      model: 'gpt-4o-mini',
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    },
    'fallback',
  )
  assertEqual(res.text, 'Risposta', 'text')
  assertEqual(res.finishReason, 'stop', 'finish')
  assertEqual(res.usage.inputTokens, 3, 'usage')
  assertEqual(res.model, 'gpt-4o-mini', 'model')
})

await test('complete maps successful Responses API call', async () => {
  const capture = []
  const provider = createOpenAIProvider({
    client: createMockClient({ capture }),
    defaultModel: 'gpt-4o-mini',
  })
  const result = await provider.complete(baseRequest())
  assertEqual(result.text, 'Ciao!', 'text')
  assertEqual(result.finishReason, 'stop', 'finish')
  assertEqual(result.usage.totalTokens, 14, 'usage')
  assertEqual(result.model, 'gpt-4o-mini', 'model')
  assertEqual(capture.length, 1, 'called once')
  assertEqual(capture[0].args.stream, false, 'non-stream')
  assertEqual(capture[0].args.instructions, 'Be concise.', 'instructions')
  assertEqual(capture[0].args.input[0].content, 'Ciao', 'input')
})

await test('complete does not alter response text', async () => {
  const provider = createOpenAIProvider({
    client: createMockClient({
      completeResult: {
        output_text: '  exact text  ',
        status: 'completed',
        model: 'm',
        usage: {},
      },
    }),
  })
  const result = await provider.complete(baseRequest())
  assertEqual(result.text, '  exact text  ', 'passthrough')
})

await test('complete maps timeout as retryable', async () => {
  const provider = createOpenAIProvider({
    client: createMockClient({ delayMs: 80 }),
    timeoutMs: 20,
  })
  let err
  try {
    await provider.complete(baseRequest())
  } catch (e) {
    err = e
  }
  assert(isWriterError(err), 'WriterError')
  assertEqual(/** @type {any} */ (err).code, 'timeout', 'code')
  assertEqual(/** @type {any} */ (err).retryable, true, 'retryable')
})

await test('complete maps rate_limit as retryable', async () => {
  const errObj = Object.assign(new Error('Rate limit exceeded'), { status: 429 })
  const provider = createOpenAIProvider({
    client: createMockClient({ completeError: errObj }),
  })
  let err
  try {
    await provider.complete(baseRequest())
  } catch (e) {
    err = e
  }
  assert(isWriterError(err), 'WriterError')
  assertEqual(/** @type {any} */ (err).code, 'rate_limit', 'code')
  assertEqual(/** @type {any} */ (err).retryable, true, 'retryable')
  assertEqual(/** @type {any} */ (err).httpStatus, 429, 'http')
})

await test('complete maps auth_failed as non-retryable', async () => {
  const errObj = Object.assign(new Error('Invalid API key'), { status: 401 })
  const provider = createOpenAIProvider({
    client: createMockClient({ completeError: errObj }),
  })
  let err
  try {
    await provider.complete(baseRequest())
  } catch (e) {
    err = e
  }
  assertEqual(/** @type {any} */ (err).code, 'auth_failed', 'code')
  assertEqual(/** @type {any} */ (err).retryable, false, 'retryable')
})

await test('complete maps 5xx as provider_unavailable retryable', async () => {
  const errObj = Object.assign(new Error('boom'), { status: 503 })
  const provider = createOpenAIProvider({
    client: createMockClient({ completeError: errObj }),
  })
  let err
  try {
    await provider.complete(baseRequest())
  } catch (e) {
    err = e
  }
  assertEqual(/** @type {any} */ (err).code, 'provider_unavailable', 'code')
  assertEqual(/** @type {any} */ (err).retryable, true, 'retryable')
})

await test('complete maps content_filtered as non-retryable', async () => {
  const errObj = Object.assign(new Error('content_filter policy'), { status: 400 })
  const provider = createOpenAIProvider({
    client: createMockClient({ completeError: errObj }),
  })
  let err
  try {
    await provider.complete(baseRequest())
  } catch (e) {
    err = e
  }
  assertEqual(/** @type {any} */ (err).code, 'content_filtered', 'code')
  assertEqual(/** @type {any} */ (err).retryable, false, 'retryable')
})

await test('complete maps abort as cancelled non-retryable', async () => {
  const controller = new AbortController()
  controller.abort()
  const provider = createOpenAIProvider({ client: createMockClient() })
  let err
  try {
    await provider.complete(baseRequest({ abortSignal: controller.signal }))
  } catch (e) {
    err = e
  }
  assertEqual(/** @type {any} */ (err).code, 'cancelled', 'code')
  assertEqual(/** @type {any} */ (err).retryable, false, 'retryable')
})

await test('complete maps length finishReason from incomplete max_output', async () => {
  const provider = createOpenAIProvider({
    client: createMockClient({
      completeResult: {
        output_text: 'partial',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        model: 'gpt-4o-mini',
        usage: { input_tokens: 1, output_tokens: 50, total_tokens: 51 },
      },
    }),
  })
  const result = await provider.complete(baseRequest())
  assertEqual(result.finishReason, 'length', 'finish')
  assertEqual(result.text, 'partial', 'text')
})

await test('stream yields deltas then usage and done', async () => {
  const capture = []
  const provider = createOpenAIProvider({
    client: createMockClient({
      capture,
      streamEvents: [
        { type: 'response.output_text.delta', delta: 'Ciao' },
        { type: 'response.output_text.delta', delta: '!' },
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
          },
        },
      ],
    }),
  })
  const events = await collectStream(provider.stream(baseRequest({ stream: true })))
  assertEqual(capture[0].args.stream, true, 'stream flag')
  assertEqual(events[0].type, 'delta', 'd0')
  assertEqual(events[0].textDelta, 'Ciao', 't0')
  assertEqual(events[1].type, 'delta', 'd1')
  assertEqual(events[1].textDelta, '!', 't1')
  assertEqual(events[2].type, 'usage', 'usage')
  assertEqual(events[2].usage.totalTokens, 10, 'usage tokens')
  assertEqual(events[3].type, 'done', 'done')
  assertEqual(events[3].finishReason, 'stop', 'finish')
  assertEqual(events[3].usage.totalTokens, 10, 'done usage')
})

await test('stream does not rewrite delta text', async () => {
  const provider = createOpenAIProvider({
    client: createMockClient({
      streamEvents: [
        { type: 'response.output_text.delta', delta: '  keep  ' },
        { type: 'response.completed', response: { status: 'completed', usage: {} } },
      ],
    }),
  })
  const events = await collectStream(provider.stream(baseRequest({ stream: true })))
  assertEqual(events[0].textDelta, '  keep  ', 'passthrough')
})

await test('stream maps create errors to error events', async () => {
  const errObj = Object.assign(new Error('Rate limit'), { status: 429 })
  const provider = createOpenAIProvider({
    client: createMockClient({ streamError: errObj }),
  })
  const events = await collectStream(provider.stream(baseRequest({ stream: true })))
  assertEqual(events.length, 1, 'one')
  assertEqual(events[0].type, 'error', 'type')
  assertEqual(events[0].error.code, 'rate_limit', 'code')
  assertEqual(events[0].error.retryable, true, 'retryable')
})

await test('stream maps mid-stream failure event', async () => {
  const provider = createOpenAIProvider({
    client: createMockClient({
      streamEvents: [
        { type: 'response.output_text.delta', delta: 'Hi' },
        { type: 'response.failed', error: { message: 'server exploded', status: 500 } },
      ],
    }),
  })
  const events = await collectStream(provider.stream(baseRequest({ stream: true })))
  assertEqual(events[0].type, 'delta', 'delta')
  assertEqual(events[1].type, 'error', 'error')
  assertEqual(events[1].error.code, 'provider_unavailable', 'code')
})

await test('stream emits cancelled when abortSignal already aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  const provider = createOpenAIProvider({ client: createMockClient() })
  const events = await collectStream(
    provider.stream(baseRequest({ stream: true, abortSignal: controller.signal })),
  )
  assertEqual(events[0].type, 'error', 'type')
  assertEqual(events[0].error.code, 'cancelled', 'code')
})

await test('stream create timeout yields retryable timeout error', async () => {
  const provider = createOpenAIProvider({
    client: createMockClient({
      delayMs: 80,
      streamEvents: [{ type: 'response.completed', response: { status: 'completed' } }],
    }),
    timeoutMs: 20,
  })
  const events = await collectStream(provider.stream(baseRequest({ stream: true })))
  assertEqual(events[0].type, 'error', 'type')
  assertEqual(events[0].error.code, 'timeout', 'code')
  assertEqual(events[0].error.retryable, true, 'retryable')
})

await test('stream ends without completed still emits done', async () => {
  const provider = createOpenAIProvider({
    client: createMockClient({
      streamEvents: [{ type: 'response.output_text.delta', delta: 'x' }],
    }),
  })
  const events = await collectStream(provider.stream(baseRequest({ stream: true })))
  assertEqual(events[0].type, 'delta', 'delta')
  assertEqual(events[1].type, 'usage', 'usage')
  assertEqual(events[2].type, 'done', 'done')
  assertEqual(events[2].finishReason, 'stop', 'finish default')
})

await test('extractStreamDelta reads response.output_text.delta', () => {
  assertEqual(
    extractStreamDelta({ type: 'response.output_text.delta', delta: 'ab' }),
    'ab',
    'delta',
  )
  assertEqual(extractStreamDelta({ type: 'other', delta: 'x' }), '', 'ignore')
})

await test('mapOpenAIError preserves WriterError and sets providerId', () => {
  const mapped = mapOpenAIError(
    { code: 'timeout', message: 't', retryable: true },
    { providerId: 'openai', model: 'm', requestId: 'r' },
  )
  assertEqual(mapped.code, 'timeout', 'code')
  assertEqual(mapped.providerId, 'openai', 'provider')
  assertEqual(mapped.model, 'm', 'model')
})

await test('mapOpenAIError AbortError -> cancelled', () => {
  const err = new Error('aborted')
  err.name = 'AbortError'
  const mapped = mapOpenAIError(err)
  assertEqual(mapped.code, 'cancelled', 'code')
  assertEqual(mapped.retryable, false, 'retryable')
})

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
