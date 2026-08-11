#!/usr/bin/env node
/**
 * Isolated tests for Continuation Planner (experimental).
 * Run: node lib/server/v2/brain/continuation-planner.test.mjs
 */

import {
  planContinuation,
  isContinuationPlan,
  CONTINUATION_PLANNER_VERSION,
  CONTINUATION_STRATEGIES,
  CONTINUATION_MOVES,
} from './continuation-planner.js'

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
    console.log(`  ok  — ${name}`)
  } catch (error) {
    failed += 1
    const message = error instanceof Error ? error.message : String(error)
    console.error(`  FAIL — ${name}`)
    console.error(`        ${message}`)
  }
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
 * @param {string} message
 */
function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    )
  }
}

console.log(`Continuation Planner tests (${CONTINUATION_PLANNER_VERSION})\n`)

test('1. version marker', () => {
  assertEqual(CONTINUATION_PLANNER_VERSION, '0.1.0-continuation-planner', 'version')
})

test('2. Ok + Neuroscience → surprise / unexpected_fact', () => {
  const p = planContinuation({
    lastUserMessage: 'Ok',
    topic: 'Neuroscience',
  })
  assert(isContinuationPlan(p), 'shape')
  assertEqual(p.continueConversation, true, 'continue')
  assertEqual(p.strategy, 'surprise', 'strategy')
  assertEqual(p.move, 'unexpected_fact', 'move')
  assert(p.confidence >= 0.9, `confidence ${p.confidence}`)
})

test('3. Interessante + Space → example / real_world_example', () => {
  const p = planContinuation({
    lastUserMessage: 'Interessante',
    topic: 'Space',
  })
  assertEqual(p.strategy, 'example', 'strategy')
  assertEqual(p.move, 'real_world_example', 'move')
})

test('4. Continua → expand / scientific_explanation (default expand move)', () => {
  const p = planContinuation({
    lastUserMessage: 'Continua',
  })
  assertEqual(p.strategy, 'expand', 'strategy')
  assertEqual(p.move, 'scientific_explanation', 'move')
})

test('5. Continua + science topic still expand with scientific move', () => {
  const p = planContinuation({
    lastUserMessage: 'Continua',
    topic: 'physics',
  })
  assertEqual(p.strategy, 'expand', 'strategy')
  assertEqual(p.move, 'scientific_explanation', 'move')
})

test('6. always continueConversation true', () => {
  const p = planContinuation({ lastUserMessage: 'riassumi', topic: 'history' })
  assertEqual(p.continueConversation, true, 'continue')
})

test('7. summarize cue', () => {
  const p = planContinuation({ lastUserMessage: 'Riassumi per favore', topic: 'planning' })
  assertEqual(p.strategy, 'summarize', 'strategy')
})

test('8. analogy cue', () => {
  const p = planContinuation({ lastUserMessage: 'Fammi un\'analogia', topic: 'philosophy' })
  assertEqual(p.strategy, 'analogy', 'strategy')
  assertEqual(p.move, 'thought_experiment', 'move')
})

test('9. contrast cue', () => {
  const p = planContinuation({ lastUserMessage: 'Qual è la differenza versus X?', topic: 'history' })
  assertEqual(p.strategy, 'contrast', 'strategy')
  assertEqual(p.move, 'historical_story', 'move')
})

test('10. experience prior when message is empty', () => {
  const p = planContinuation({
    lastUserMessage: '',
    topic: 'debugging',
    experience: 'debugging',
  })
  assertEqual(p.strategy, 'example', 'from experience')
  assert(isContinuationPlan(p), 'shape')
})

test('11. momentum prior when no message cue', () => {
  const p = planContinuation({
    lastUserMessage: 'Bene così',
    momentum: 'learning',
    topic: 'biology',
  })
  // No strong cue → experience/momentum or expand; learning → expand
  assert(['expand', 'surprise', 'example'].includes(p.strategy), 'known strategy')
  assert(CONTINUATION_MOVES.includes(p.move), 'known move')
})

test('12. deterministic', () => {
  const input = { lastUserMessage: 'Ok', topic: 'Neuroscience', experience: 'learning' }
  assertEqual(JSON.stringify(planContinuation(input)), JSON.stringify(planContinuation(input)), 'same')
})

test('13. strategy / move catalogs cover required enums', () => {
  for (const s of [
    'expand',
    'surprise',
    'example',
    'analogy',
    'contrast',
    'question',
    'summarize',
  ]) {
    assert(CONTINUATION_STRATEGIES.includes(/** @type {any} */ (s)), s)
  }
  for (const m of [
    'unexpected_fact',
    'real_world_example',
    'thought_experiment',
    'historical_story',
    'scientific_explanation',
    'practical_application',
    'next_step',
  ]) {
    assert(CONTINUATION_MOVES.includes(/** @type {any} */ (m)), m)
  }
})

test('14. no text generation fields', () => {
  const p = planContinuation({ lastUserMessage: 'Ok', topic: 'Space' })
  assert(!('text' in p), 'no text')
  assert(!('reply' in p), 'no reply')
  assert(!('prompt' in p), 'no prompt')
})

test('15. nullish input safe', () => {
  const p = planContinuation(/** @type {any} */ (null))
  assert(isContinuationPlan(p), 'shape')
  assertEqual(p.continueConversation, true, 'continue')
})

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
