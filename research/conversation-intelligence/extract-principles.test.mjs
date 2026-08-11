#!/usr/bin/env node
/**
 * Tests for extract-principles (offline research).
 * Run: node research/conversation-intelligence/extract-principles.test.mjs
 */

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  EXTRACT_PRINCIPLES_VERSION,
  sampleVariance,
  preferredFromDistribution,
  inferPreferredOpening,
  computeConfidence,
  inferRecommendations,
  extractPrincipleFromDataset,
  extractAllPrinciples,
  renderPrinciplesMarkdown,
  extractPrinciplesPackage,
} from './extract-principles.js'
import { analyzeExamples, DEFAULT_DATASET_DIR } from './analyze-dataset.js'

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

console.log(`Extract-principles tests (${EXTRACT_PRINCIPLES_VERSION})\n`)

test('version', () => {
  assertEqual(EXTRACT_PRINCIPLES_VERSION, '0.1.0-extract-principles', 'version')
})

test('sampleVariance / preferredFromDistribution', () => {
  assertEqual(sampleVariance([1, 1, 1]), 0, 'zero var')
  assert(sampleVariance([0, 1]) != null, 'var')
  const pref = preferredFromDistribution({ surprise: 9, expand: 3 })
  assertEqual(pref.key, 'surprise', 'top')
  assertEqual(pref.share, 0.75, 'share')
})

test('inferPreferredOpening', () => {
  assertEqual(
    inferPreferredOpening({
      strategy: 'surprise',
      move: 'unexpected_fact',
      questionRate: 0.1,
    }),
    'surprise',
    'surprise',
  )
  assertEqual(
    inferPreferredOpening({
      strategy: 'surprise',
      move: 'unexpected_fact',
      questionRate: 0.5,
    }),
    'surprise',
    'surprise beats moderate questions',
  )
  assertEqual(
    inferPreferredOpening({ strategy: 'expand', move: 'question', questionRate: 0.5 }),
    'question',
    'question',
  )
})

test('computeConfidence increases with sample and dominance', () => {
  const low = computeConfidence({
    examples: 3,
    strategyShare: 0.2,
    curiosities: [0, 1, 0, 1],
    novelties: [0, 1],
    practicalities: [0, 1],
  })
  const high = computeConfidence({
    examples: 27,
    strategyShare: 0.7,
    curiosities: [0.4, 0.41, 0.39],
    novelties: [0.3, 0.31, 0.29],
    practicalities: [0.9, 0.91, 0.89],
  })
  assert(high > low, `high ${high} > low ${low}`)
  assert(high >= 0 && high <= 1, 'range')
})

test('inferRecommendations deterministic', () => {
  const input = {
    experience: 'exploration',
    preferredOpening: 'surprise',
    preferredStrategy: 'surprise',
    preferredMove: 'unexpected_fact',
    preferredInitiative: 'high',
    preferredDepth: 'medium',
    preferredEnergy: 'high',
    questionRate: 0.33,
    metrics: { curiosity: 0.86, novelty: 0.75, practicality: 0.46 },
  }
  const a = inferRecommendations(input)
  const b = inferRecommendations(input)
  assertEqual(JSON.stringify(a), JSON.stringify(b), 'deterministic')
  assert(
    a.recommendations.some((r) =>
      /surprising fact, question, or unexpected observation/i.test(r),
    ),
    'exploration opening preference',
  )
  assert(a.recommendations.some((r) => /unexpected fact/i.test(r)), 'fact')
  assert(a.avoid.some((x) => /Possiamo parlare di/i.test(x)), 'avoid possiamo')
  assert(a.avoid.some((x) => /generic topic lists/i.test(x)), 'avoid topic lists')
  assert(a.avoid.some((x) => /generic/i.test(x)), 'avoid')
  assert(
    !a.avoid.some((x) => /opening with a question/i.test(x)),
    'exploration allows question openings',
  )
})

test('extractPrincipleFromDataset shape', () => {
  const examples = [
    {
      user: 'x',
      assistant: 'y',
      behavior: {
        turnType: 'exploration',
        strategy: 'surprise',
        move: 'unexpected_fact',
        initiative: 'high',
        depth: 'medium',
        energy: 'high',
        question: false,
        curiosity: 0.9,
        novelty: 0.8,
        practicality: 0.4,
      },
    },
    {
      user: 'x2',
      assistant: 'y2',
      behavior: {
        turnType: 'exploration',
        strategy: 'surprise',
        move: 'thought_experiment',
        initiative: 'high',
        depth: 'medium',
        energy: 'high',
        question: true,
        curiosity: 0.85,
        novelty: 0.7,
        practicality: 0.5,
      },
    },
  ]
  const stats = analyzeExamples(examples)
  const p = extractPrincipleFromDataset({
    name: 'exploration',
    stats,
    examples,
  })
  assertEqual(p.experience, 'exploration', 'exp')
  assertEqual(p.preferredStrategy, 'surprise', 'strategy')
  assertEqual(p.preferredOpening, 'surprise', 'opening')
  assertEqual(p.preferredInitiative, 'high', 'initiative')
  assert(typeof p.confidence === 'number', 'confidence')
  assert(Array.isArray(p.recommendations) && p.recommendations.length > 0, 'recs')
  assert(Array.isArray(p.avoid), 'avoid')
})

test('extractAllPrinciples on real datasets', () => {
  const principles = extractAllPrinciples({ dir: DEFAULT_DATASET_DIR })
  assert(principles.length >= 8, `count ${principles.length}`)
  const exploration = principles.find((p) => p.experience === 'exploration')
  assert(exploration, 'exploration present')
  assertEqual(exploration.preferredStrategy, 'surprise', 'exploration strategy')
  assert(exploration.questionRate > 0.2, 'q rate')
  assert(
    exploration.recommendations.some((r) =>
      /surprising fact, question, or unexpected observation/i.test(r),
    ),
    'exploration prefer opening',
  )
  assert(
    exploration.avoid.includes('Possiamo parlare di...'),
    'exploration avoid possiamo',
  )
  assert(
    exploration.avoid.includes('generic topic lists'),
    'exploration avoid topic lists',
  )
  const md = renderPrinciplesMarkdown(principles)
  assert(/# Conversation Principles/.test(md), 'title')
  assert(/## Exploration/.test(md), 'section')
  assertEqual(renderPrinciplesMarkdown(principles), md, 'md deterministic')
})

test('extractPrinciplesPackage without write', () => {
  const result = extractPrinciplesPackage({
    dir: DEFAULT_DATASET_DIR,
    writeOutputs: false,
  })
  assert(result.principles.length >= 8, 'principles')
  assert(
    Array.isArray(result.payload.experiences) &&
      result.payload.experiences.length === result.principles.length,
    'payload',
  )
  assertEqual(result.jsonPath, null, 'no json')
})

test('temp write outputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-principles-'))
  try {
    writeFileSync(
      join(dir, 'exploration.json'),
      JSON.stringify([
        {
          user: 'a',
          assistant: 'b',
          behavior: {
            turnType: 'exploration',
            strategy: 'surprise',
            move: 'unexpected_fact',
            initiative: 'high',
            depth: 'short',
            energy: 'high',
            question: false,
            curiosity: 0.9,
            novelty: 0.8,
            practicality: 0.4,
          },
        },
      ]),
    )
    const result = extractPrinciplesPackage({ dir, writeOutputs: true })
    assert(result.jsonPath && result.reportPath, 'paths')
    const json = JSON.parse(readFileSync(result.jsonPath, 'utf8'))
    assertEqual(json.experiences[0].experience, 'exploration', 'written')
    assert(/Conversation Principles/.test(readFileSync(result.reportPath, 'utf8')), 'md')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
