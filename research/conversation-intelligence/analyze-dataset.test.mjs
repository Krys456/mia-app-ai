#!/usr/bin/env node
/**
 * Tests for conversation-intelligence analyze-dataset (offline).
 * Run: node research/conversation-intelligence/analyze-dataset.test.mjs
 */

import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ANALYZE_DATASET_VERSION,
  average,
  countDistribution,
  rankDistribution,
  normalizeExample,
  analyzeExamples,
  analyzeDatasetFile,
  buildGlobalReport,
  generateInsights,
  renderMarkdownReport,
  analyzeAllDatasets,
  listDatasetFiles,
  DEFAULT_DATASET_DIR,
} from './analyze-dataset.js'

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

console.log(`Analyze-dataset tests (${ANALYZE_DATASET_VERSION})\n`)

test('version', () => {
  assertEqual(ANALYZE_DATASET_VERSION, '0.1.0-analyze-dataset', 'version')
})

test('average / countDistribution / rankDistribution', () => {
  assertEqual(average([1, 2, 3]), 2, 'avg')
  assertEqual(average([]), null, 'empty')
  const dist = countDistribution(['a', 'b', 'a'])
  assertEqual(dist.a, 2, 'a')
  assertEqual(dist.b, 1, 'b')
  assertEqual(rankDistribution(dist)[0].key, 'a', 'top')
})

test('normalizeExample + analyzeExamples', () => {
  const ex = normalizeExample({
    user: 'Ciao',
    assistant: 'Ciao!',
    behavior: {
      turnType: 'conversation',
      strategy: 'expand',
      move: 'reflection',
      initiative: 'low',
      depth: 'minimal',
      energy: 'low',
      question: false,
      curiosity: 0.2,
      novelty: 0.1,
      practicality: 0.3,
    },
  })
  assert(ex && ex.behavior.strategy === 'expand', 'norm')
  const stats = analyzeExamples([ex, ex])
  assertEqual(stats.examples, 2, 'count')
  assertEqual(stats.strategyDistribution.expand, 2, 'strategy')
  assertEqual(stats.questionPercentage, 0, 'q%')
  assertEqual(stats.averageCuriosity, 0.2, 'curiosity')
})

test('analyzeExamples question percentage', () => {
  const mk = (q) => ({
    user: 'u',
    assistant: 'a',
    behavior: {
      turnType: 'conversation',
      strategy: 'expand',
      move: 'question',
      initiative: 'low',
      depth: 'short',
      energy: 'low',
      question: q,
      curiosity: 0.5,
      novelty: 0.5,
      practicality: 0.5,
    },
  })
  const stats = analyzeExamples([mk(true), mk(false), mk(true), mk(true)])
  assertEqual(stats.questionPercentage, 75, '75%')
})

test('temp dataset file analysis is deterministic', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-analyze-'))
  try {
    const sample = [
      {
        user: 'Ok',
        assistant: 'Fact.',
        behavior: {
          turnType: 'learning',
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
      {
        user: 'Continua',
        assistant: 'More.',
        behavior: {
          turnType: 'learning',
          strategy: 'expand',
          move: 'scientific_explanation',
          initiative: 'medium',
          depth: 'medium',
          energy: 'medium',
          question: false,
          curiosity: 0.5,
          novelty: 0.4,
          practicality: 0.7,
        },
      },
    ]
    const path = join(dir, 'learning.json')
    writeFileSync(path, JSON.stringify(sample))
    const a = analyzeDatasetFile(path)
    const b = analyzeDatasetFile(path)
    assertEqual(JSON.stringify(a.stats), JSON.stringify(b.stats), 'deterministic')
    assertEqual(a.stats.examples, 2, 'examples')
    assertEqual(a.name, 'learning', 'name')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('buildGlobalReport + insights + markdown', () => {
  const fileReports = [
    {
      name: 'exploration',
      stats: analyzeExamples([
        {
          user: 'x',
          assistant: 'y',
          behavior: {
            turnType: 'exploration',
            strategy: 'surprise',
            move: 'unexpected_fact',
            initiative: 'high',
            depth: 'short',
            energy: 'high',
            question: false,
            curiosity: 0.9,
            novelty: 0.9,
            practicality: 0.3,
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
            curiosity: 0.8,
            novelty: 0.85,
            practicality: 0.4,
          },
        },
      ]),
      examples: [
        {
          user: 'x',
          assistant: 'y',
          behavior: {
            turnType: 'exploration',
            strategy: 'surprise',
            move: 'unexpected_fact',
            initiative: 'high',
            depth: 'short',
            energy: 'high',
            question: false,
            curiosity: 0.9,
            novelty: 0.9,
            practicality: 0.3,
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
            curiosity: 0.8,
            novelty: 0.85,
            practicality: 0.4,
          },
        },
      ],
    },
    {
      name: 'planning',
      stats: analyzeExamples([
        {
          user: 'p',
          assistant: 'q',
          behavior: {
            turnType: 'planning',
            strategy: 'simplify',
            move: 'practical_step',
            initiative: 'high',
            depth: 'minimal',
            energy: 'medium',
            question: false,
            curiosity: 0.3,
            novelty: 0.2,
            practicality: 0.95,
          },
        },
      ]),
      examples: [
        {
          user: 'p',
          assistant: 'q',
          behavior: {
            turnType: 'planning',
            strategy: 'simplify',
            move: 'practical_step',
            initiative: 'high',
            depth: 'minimal',
            energy: 'medium',
            question: false,
            curiosity: 0.3,
            novelty: 0.2,
            practicality: 0.95,
          },
        },
      ],
    },
  ]
  const global = buildGlobalReport(fileReports)
  assertEqual(global.totalExamples, 3, 'total')
  assert(global.mostCommonStrategies[0].key === 'surprise', 'common strategy')
  assert(global.highestPracticalityStrategies[0].strategy === 'simplify', 'practical')
  const insights = generateInsights(fileReports, global)
  assert(insights.length >= 3, `insights ${insights.length}`)
  assert(
    insights.some((i) => /Exploration examples rely mostly on surprise/i.test(i)),
    'exploration insight',
  )
  const md = renderMarkdownReport({ datasets: fileReports, global, insights })
  assert(/# Conversation Intelligence Report/.test(md), 'title')
  assert(/## Strategy frequency/.test(md), 'strategy section')
  assert(/## Insights/.test(md), 'insights section')
  assertEqual(
    renderMarkdownReport({ datasets: fileReports, global, insights }),
    md,
    'markdown deterministic',
  )
})

test('listDatasetFiles finds real research JSONs', () => {
  const files = listDatasetFiles(DEFAULT_DATASET_DIR)
  assert(files.length >= 8, `files ${files.length}`)
  assert(
    files.every((f) => f.endsWith('.json')),
    'json only',
  )
})

test('analyzeAllDatasets on real folder (no write)', () => {
  const result = analyzeAllDatasets({
    dir: DEFAULT_DATASET_DIR,
    writeReport: false,
  })
  assert(result.global.totalExamples >= 200, 'total examples')
  assert(result.datasets.length >= 8, 'datasets')
  assert(result.insights.length >= 10, `insights ${result.insights.length}`)
  assert(result.insights.length <= 20, 'insights cap')
  assert(/Conversation Intelligence Report/.test(result.markdown), 'md')
})

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
