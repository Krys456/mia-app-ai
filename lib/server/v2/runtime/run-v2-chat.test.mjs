#!/usr/bin/env node
/**
 * Tests for V2 chat runner + V1 fallback helper.
 * Fake WriterProvider only — no OpenAI network, no V1 imports.
 *
 * Run: node lib/server/v2/runtime/run-v2-chat.test.mjs
 */

import { createWriter } from '../brain/writer.js'
import { createReviewer } from '../brain/reviewer.js'
import {
  runV2ChatConversation,
  tryV2ChatConversation,
  logV2,
} from './run-v2-chat.js'
import { resolveLaifeEngine, isLaifeEngineV2 } from './laife-engine.js'

let passed = 0
let failed = 0

/**
 * @param {string} name
 * @param {() => void | Promise<void>} fn
 */
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => {
        passed += 1
        console.log(`  ok  — ${name}`)
      },
      (error) => {
        failed += 1
        console.error(`  FAIL — ${name}`)
        console.error(`        ${error instanceof Error ? error.message : error}`)
      },
    )
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`)
  }
}

/**
 * @param {object} [options]
 */
function createFakeProvider(options = {}) {
  const text =
    options.text ||
    'Ieri il tramonto sul fiume aveva un arancio strano, quasi metallico. Un dettaglio piccolo basta a cambiare l\'umore.'
  const rewriteText =
    options.rewriteText ||
    'Il tramonto sul fiume aveva un arancio metallico — un dettaglio piccolo, vivo, senza domande.'
  /** @type {any[]} */
  const calls = []
  return {
    id: 'fake',
    capabilities: {
      streaming: true,
      jsonMode: true,
      structuredOutput: true,
      tools: false,
      vision: false,
      audioInput: false,
      audioOutput: false,
      reasoning: false,
      maxContextTokens: 128000,
    },
    __calls: calls,
    /**
     * @param {any} req
     */
    async complete(req) {
      calls.push(req)
      if (options.fail) {
        const err = new Error(options.failMessage || 'provider boom')
        /** @type {any} */ (err).code = options.failCode || 'internal'
        throw err
      }
      const isRewrite = /REWRITE CONTRACT|REWRITE MODE/i.test(String(req.instructions || ''))
      return {
        text: isRewrite ? rewriteText : options.empty ? '' : text,
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        model: 'fake-model',
      }
    },
    async *stream() {
      yield { type: 'done', finishReason: 'stop', usage: {} }
    },
  }
}

function sampleMessages(user = 'Ciao') {
  return [{ role: 'user', content: user }]
}

console.log('\nV2 chat runtime tests\n')

await test('flag helpers still default to v1', () => {
  assertEqual(resolveLaifeEngine(''), 'v1', 'default')
  assertEqual(isLaifeEngineV2('v1'), false, 'v1')
})

await test('runV2ChatConversation returns content via fake provider', async () => {
  const provider = createFakeProvider()
  const result = await runV2ChatConversation({
    provider,
    messages: sampleMessages('Ciao'),
    model: 'fake-model',
    requestId: 't1',
  })
  assert(result.content.length > 0, 'content')
  assert(typeof result.score === 'number', 'score')
  assert(result.perception && result.decision && result.plan, 'brain artifacts')
  assert(result.review && result.review.decision, 'review')
  assert(result.timing.totalMs >= 0, 'timing')
  assertEqual(result.providerId, 'fake', 'provider')
})

await test('REWRITE path uses rewriteHints exclusively once', async () => {
  // Force rewrite-friendly low-quality draft then a cleaner rewrite
  const provider = createFakeProvider({
    text: 'How can I help you today?',
    rewriteText:
      'Il caffè del mattino ha un aroma di nocciola quando la luce entra di lato.',
  })
  const result = await runV2ChatConversation({
    provider,
    messages: sampleMessages('Ciao'),
    model: 'fake-model',
    requestId: 't2',
  })
  assert(provider.__calls.length >= 1, 'at least draft call')
  if (result.rewritten) {
    assertEqual(result.reviewDecision, 'REWRITE', 'decision')
    assert(provider.__calls.length >= 2, 'draft + rewrite')
    const rewriteCall = provider.__calls[provider.__calls.length - 1]
    assert(/REWRITE CONTRACT/i.test(rewriteCall.instructions), 'contract in rewrite')
    assert(!/THIS_SHOULD_NOT/.test(rewriteCall.instructions), 'clean')
  }
  assert(result.content.length > 0, 'final content')
})

await test('empty draft throws from runV2ChatConversation', async () => {
  const provider = createFakeProvider({ empty: true })
  let threw = false
  try {
    await runV2ChatConversation({
      provider,
      messages: sampleMessages('Ciao'),
      model: 'fake-model',
    })
  } catch {
    threw = true
  }
  assert(threw, 'must throw')
})

await test('tryV2ChatConversation returns null on provider failure (V1 fallback signal)', async () => {
  const provider = createFakeProvider({ fail: true, failMessage: 'rate limit' })
  const result = await tryV2ChatConversation({
    provider,
    messages: sampleMessages('Ciao'),
    model: 'fake-model',
  })
  assertEqual(result, null, 'null for fallback')
})

await test('tryV2ChatConversation returns null when no user message', async () => {
  const provider = createFakeProvider()
  const result = await tryV2ChatConversation({
    provider,
    messages: [{ role: 'assistant', content: 'Hi' }],
    model: 'fake-model',
  })
  assertEqual(result, null, 'null')
})

await test('injected reviewer is used', async () => {
  const provider = createFakeProvider()
  let reviewed = false
  const reviewer = createReviewer()
  const wrapped = {
    ...reviewer,
    /**
     * @param {any} input
     */
    review(input) {
      reviewed = true
      return reviewer.review(input)
    },
  }
  await runV2ChatConversation({
    provider,
    reviewer: wrapped,
    messages: sampleMessages('Mi sento un po\' giù oggi.'),
    model: 'fake-model',
  })
  assert(reviewed, 'reviewer called')
})

await test('logV2 is callable without throwing', () => {
  logV2('info', 'test-log', { ok: true })
})

await test('createWriter still works with fake provider registry', async () => {
  const provider = createFakeProvider()
  const writer = createWriter({
    providers: { fake: provider },
    defaultProviderId: 'fake',
  })
  assert(typeof writer.write === 'function', 'write')
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
