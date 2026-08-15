/**
 * Core responses.create param builder — GPT-5.4 vs GPT-5.6 Sol A/B compat.
 * Run: node lib/server/core-responses-params.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildCoreResponsesCreateParams,
  modelNeedsReasoningNoneForTemperature,
} from './core-responses-params.js'

const input = [
  { type: 'message', role: 'user', content: 'Ciao' },
  { type: 'message', role: 'assistant', content: 'Ciao!' },
  { type: 'message', role: 'user', content: 'Come va?' },
]

function base(model) {
  return buildCoreResponsesCreateParams({
    model,
    instructions: 'companion prompt',
    maxOutputTokens: 4096,
    input,
  })
}

// Capability detection
assert.equal(modelNeedsReasoningNoneForTemperature('gpt-5.4'), false)
assert.equal(modelNeedsReasoningNoneForTemperature('gpt-5.4-mini'), false)
assert.equal(modelNeedsReasoningNoneForTemperature('gpt-4o'), false)
assert.equal(modelNeedsReasoningNoneForTemperature('gpt-5.6'), true)
assert.equal(modelNeedsReasoningNoneForTemperature('gpt-5.6-sol'), true)
assert.equal(modelNeedsReasoningNoneForTemperature('GPT-5.6-SOL'), true)
assert.equal(modelNeedsReasoningNoneForTemperature('gpt-5.6-terra'), true)
assert.equal(modelNeedsReasoningNoneForTemperature('gpt-5.6-luna'), true)

// GPT-5.4 — preserve current request (temperature 0.85, no reasoning)
{
  const params = base('gpt-5.4')
  assert.equal(params.model, 'gpt-5.4')
  assert.equal(params.temperature, 0.85)
  assert.equal(params.max_output_tokens, 4096)
  assert.equal(params.stream, false)
  assert.equal(params.instructions, 'companion prompt')
  assert.deepEqual(params.input, input)
  assert.equal('reasoning' in params, false)
}

// GPT-5.6 Sol — keep temperature 0.85 + reasoning.effort none
{
  const params = base('gpt-5.6-sol')
  assert.equal(params.temperature, 0.85)
  assert.deepEqual(params.reasoning, { effort: 'none' })
  assert.equal(params.max_output_tokens, 4096)
  assert.equal(params.stream, false)
  assert.deepEqual(params.input, input)
}

// GPT-5.6 alias — same compatibility path
{
  const params = base('gpt-5.6')
  assert.deepEqual(params.reasoning, { effort: 'none' })
  assert.equal(params.temperature, 0.85)
}

// GPT-5.6 Terra — same path for later cost A/B
{
  const params = base('gpt-5.6-terra')
  assert.deepEqual(params.reasoning, { effort: 'none' })
  assert.equal(params.temperature, 0.85)
}

// api/chat.ts still uses a single responses.create (no second generation)
{
  const chatSrc = readFileSync(new URL('../../api/chat.ts', import.meta.url), 'utf8')
  const createCalls = chatSrc.match(/\.responses\.create\s*\(/g) || []
  assert.equal(createCalls.length, 1, 'Core must keep exactly one responses.create')
  assert.match(chatSrc, /buildCoreResponsesCreateParams/)
  assert.doesNotMatch(chatSrc, /runCognitiveEngine/)
  // Default production model must not be hard-coded to gpt-5.6*
  assert.doesNotMatch(chatSrc, /return normalized \|\| 'gpt-5\.6/)
  assert.match(chatSrc, /return normalized \|\| 'gpt-4o'/)
}

console.log('ok: core-responses-params GPT-5.4 / GPT-5.6 Sol A/B compat')
