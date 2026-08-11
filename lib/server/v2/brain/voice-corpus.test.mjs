#!/usr/bin/env node
/**
 * Tests for Voice Corpus (experimental).
 * Run: node lib/server/v2/brain/voice-corpus.test.mjs
 */

import {
  VOICE_CORPUS,
  VOICE_CORPUS_VERSION,
  formatVoiceCorpusBlock,
} from './voice-corpus.js'

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
  if (a !== b) {
    throw new Error(
      `${msg || 'equal'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`,
    )
  }
}

console.log(`Voice Corpus tests (${VOICE_CORPUS_VERSION})\n`)

test('about 30 dialogues (25–35)', () => {
  assert(VOICE_CORPUS.length >= 25, `count ${VOICE_CORPUS.length} >= 25`)
  assert(VOICE_CORPUS.length <= 35, `count ${VOICE_CORPUS.length} <= 35`)
})

test('six categories with ~5 each', () => {
  /** @type {Record<string, number>} */
  const counts = {}
  for (const entry of VOICE_CORPUS) {
    counts[entry.category] = (counts[entry.category] || 0) + 1
  }
  for (const cat of [
    'greeting',
    'support',
    'technical',
    'planning',
    'brainstorming',
    'resume',
  ]) {
    assert(counts[cat] === 5, `${cat} has 5 (got ${counts[cat]})`)
  }
})

test('each dialogue is short (2–4 turns) with roles', () => {
  for (const [i, entry] of VOICE_CORPUS.entries()) {
    const turns = entry.conversation
    assert(turns.length >= 2 && turns.length <= 4, `dialogue ${i} length`)
    for (const turn of turns) {
      assert(turn.role === 'user' || turn.role === 'assistant', `role ${i}`)
      assert(typeof turn.text === 'string' && turn.text.trim(), `text ${i}`)
    }
  }
})

test('format block has Italian framing', () => {
  const block = formatVoiceCorpusBlock()
  assert(/^VOICE CORPUS/.test(block), 'header')
  assert(/Questi dialoghi mostrano come parla LAIfe/.test(block), 'show')
  assert(/Non copiarli/.test(block), 'no copy')
  assert(/Non riutilizzare le stesse frasi/.test(block), 'no reuse')
  assert(/- ritmo/.test(block), 'ritmo')
  assert(/- continuità/.test(block), 'continuità')
  assert(/- naturalezza/.test(block), 'naturalezza')
  assert(/- modo di riprendere il contesto/.test(block), 'resume')
  assert(/- livello di dettaglio/.test(block), 'detail')
  assert(/Dialogue 1 \[greeting\]/.test(block), 'first dialogue')
  assert(/user: Ciao/.test(block), 'sample user')
  assert(/assistant: Ciao! Bentornato\./.test(block), 'sample assistant')
})

test('version marker', () => {
  assertEqual(VOICE_CORPUS_VERSION, '0.1.0-voice-corpus', 'version')
})

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
