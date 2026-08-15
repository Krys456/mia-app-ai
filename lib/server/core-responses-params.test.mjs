/**
 * Core responses.create param builder — GPT-5.4 vs GPT-5.6 Sol A/B compat.
 * Run: node lib/server/core-responses-params.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildCoreResponsesCreateParams,
  isGpt56FamilyModel,
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

function assertNoTemperatureKey(params, label) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(params, 'temperature'),
    false,
    `${label} must omit temperature key entirely`,
  )
  // Serialized wire form must also lack temperature (undefined would still be a smell).
  const wire = JSON.parse(JSON.stringify(params))
  assert.equal('temperature' in wire, false, `${label} JSON must omit temperature`)
}

// Capability detection
assert.equal(isGpt56FamilyModel('gpt-5.4'), false)
assert.equal(isGpt56FamilyModel('gpt-5.4-mini'), false)
assert.equal(isGpt56FamilyModel('gpt-4o'), false)
assert.equal(isGpt56FamilyModel('gpt-5.6'), true)
assert.equal(isGpt56FamilyModel('gpt-5.6-sol'), true)
assert.equal(isGpt56FamilyModel('GPT-5.6-SOL'), true)
assert.equal(isGpt56FamilyModel('gpt-5.6-terra'), true)
assert.equal(isGpt56FamilyModel('gpt-5.6-luna'), true)

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
  const wire = JSON.parse(JSON.stringify(params))
  assert.equal(wire.temperature, 0.85)
  assert.equal('reasoning' in wire, false)
}

// GPT-5.6 Sol — omit temperature, reasoning.effort none
{
  const params = base('gpt-5.6-sol')
  assertNoTemperatureKey(params, 'gpt-5.6-sol')
  assert.deepEqual(params.reasoning, { effort: 'none' })
  assert.equal(params.max_output_tokens, 4096)
  assert.equal(params.stream, false)
  assert.deepEqual(params.input, input)
}

// GPT-5.6 alias — same path
{
  const params = base('gpt-5.6')
  assertNoTemperatureKey(params, 'gpt-5.6')
  assert.deepEqual(params.reasoning, { effort: 'none' })
}

// GPT-5.6 Terra — same path
{
  const params = base('gpt-5.6-terra')
  assertNoTemperatureKey(params, 'gpt-5.6-terra')
  assert.deepEqual(params.reasoning, { effort: 'none' })
}

// api/chat.ts still uses a single responses.create (no second generation)
{
  const chatSrc = readFileSync(new URL('../../api/chat.ts', import.meta.url), 'utf8')
  const createCalls = chatSrc.match(/\.responses\.create\s*\(/g) || []
  assert.equal(createCalls.length, 1, 'Core must keep exactly one responses.create')
  assert.match(chatSrc, /buildCoreResponsesCreateParams/)
  assert.match(chatSrc, /requestProbe/)
  assert.match(chatSrc, /openaiParams/)
  assert.doesNotMatch(chatSrc, /runCognitiveEngine/)
  assert.doesNotMatch(chatSrc, /return normalized \|\| 'gpt-5\.6/)
  assert.match(chatSrc, /return normalized \|\| 'gpt-4o'/)
}

console.log('ok: core-responses-params omit temperature for GPT-5.6 family')
