#!/usr/bin/env node
/**
 * Tests for Voice Style Examples (experimental).
 * Run: node lib/server/v2/brain/voice-examples.test.mjs
 */

import {
  VOICE_EXAMPLES,
  VOICE_EXAMPLES_VERSION,
  formatVoiceExamplesBlock,
} from './voice-examples.js'

let passed = 0
let failed = 0

/**
 * @param {string} name
 * @param {() => void} fn
 */
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`ok  - ${name}`)
  } catch (err) {
    failed += 1
    console.error(`FAIL - ${name}`)
    console.error(err?.message || err)
  }
}

/**
 * @param {boolean} cond
 * @param {string} msg
 */
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

/**
 * @param {any} a
 * @param {any} b
 * @param {string} msg
 */
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'equal'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

console.log(`Voice Examples tests (${VOICE_EXAMPLES_VERSION})\n`)

test('at most 15 examples', () => {
  assert(VOICE_EXAMPLES.length > 0, 'non-empty')
  assert(VOICE_EXAMPLES.length <= 15, `count ${VOICE_EXAMPLES.length} <= 15`)
})

test('each example has user + assistant strings', () => {
  for (const [i, ex] of VOICE_EXAMPLES.entries()) {
    assert(typeof ex.user === 'string' && ex.user.trim(), `user ${i}`)
    assert(typeof ex.assistant === 'string' && ex.assistant.trim(), `assistant ${i}`)
  }
})

test('format block has tone framing and no-copy rules', () => {
  const block = formatVoiceExamplesBlock()
  assert(/^VOICE STYLE EXAMPLES/.test(block), 'header first')
  assert(/Questi esempi mostrano il tono/.test(block), 'tone')
  assert(/NON copiarli/.test(block), 'no copy')
  assert(/NON ripetere le stesse parole/.test(block), 'no repeat')
  assert(/ritmo, naturalezza, livello di dettaglio e stile/.test(block), 'style axes')
  assert(/user: Ciao/.test(block), 'sample user')
  assert(/assistant: Ciao! Bentornato\./.test(block), 'sample assistant')
})

test('format caps at 15', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    user: `u${i}`,
    assistant: `a${i}`,
  }))
  const block = formatVoiceExamplesBlock(many)
  assert(/Example 15/.test(block), 'has 15')
  assert(!/Example 16/.test(block), 'no 16')
})

test('version marker', () => {
  assertEqual(VOICE_EXAMPLES_VERSION, '0.1.0-voice-examples', 'version')
})

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
