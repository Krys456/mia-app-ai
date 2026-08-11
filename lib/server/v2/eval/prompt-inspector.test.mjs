#!/usr/bin/env node
/**
 * Tests for Prompt Inspector (experimental).
 * Run: node lib/server/v2/eval/prompt-inspector.test.mjs
 */

import {
  inspectPrompt,
  estimateTokens,
  splitPromptSections,
  extractInstructionLines,
  findDuplicates,
  findConceptClusters,
  PROMPT_INSPECTOR_VERSION,
} from './prompt-inspector.js'

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

const SAMPLE = `
VOICE STYLE EXAMPLES
These examples show tone only.
Do NOT copy them.

PERSONALITY FOUNDATION
LAIfe is warm, friendly, natural, and human.

WRITER BRIEF (execute; do not renegotiate)
strategy=connect; need=connection; coda=spark
MUST:
- Do not ask clarifying questions.
- Do not ask a question in this turn.
- Keep development light and relational.
- Do not ask clarifying questions.
- Stay warm and natural.
MUST NOT:
- Do not interview the user.
CONSTRAINTS:
- ask_question:no
- hard:no_question
`.trim()

console.log(`Prompt Inspector tests (${PROMPT_INSPECTOR_VERSION})\n`)

test('version marker', () => {
  assertEqual(PROMPT_INSPECTOR_VERSION, '0.1.0-prompt-inspector', 'version')
})

test('empty prompt returns zeros', () => {
  const r = inspectPrompt({ writerPrompt: '' })
  assertEqual(r.characters, 0, 'chars')
  assertEqual(r.tokensEstimate, 0, 'tokens')
  assertEqual(r.sectionCount, 0, 'sections')
  assertEqual(r.instructionCount, 0, 'instructions')
  assertEqual(r.redundancyScore, 0, 'redundancy')
})

test('counts characters and estimates tokens', () => {
  const r = inspectPrompt({ writerPrompt: SAMPLE })
  assert(r.characters === SAMPLE.length, 'characters')
  assert(r.tokensEstimate > 20, 'tokens')
  assert(estimateTokens(SAMPLE) === r.tokensEstimate, 'estimate helper')
})

test('splits sections', () => {
  const sections = splitPromptSections(SAMPLE)
  assert(sections.length >= 3, `section count ${sections.length}`)
  assert(
    sections.some((s) => /VOICE STYLE EXAMPLES/i.test(s.title)),
    'voice section',
  )
  assert(
    sections.some((s) => /PERSONALITY FOUNDATION/i.test(s.title)),
    'foundation',
  )
})

test('finds duplicate instructions', () => {
  const lines = extractInstructionLines(SAMPLE)
  const dupes = findDuplicates(lines)
  assert(dupes.length >= 1, 'has duplicates')
  const ask = dupes.find((d) => /do not ask clarifying questions/i.test(d.text))
  assert(ask && ask.count >= 2, `ask dupe count ${ask?.count}`)
})

test('finds tone concept cluster', () => {
  const clusters = findConceptClusters(SAMPLE)
  const tone = clusters.find((c) => c.cluster === 'tone')
  assert(tone, 'tone cluster')
  assert(tone.count >= 4, `tone count ${tone.count}`)
  assert(tone.terms.includes('warm'), 'warm')
  assert(tone.terms.includes('friendly') || tone.terms.includes('natural'), 'friendly/natural')
})

test('inspectPrompt full shape + scores', () => {
  const r = inspectPrompt({ writerPrompt: SAMPLE })
  assert(typeof r.characters === 'number', 'characters')
  assert(typeof r.tokensEstimate === 'number', 'tokens')
  assert(Array.isArray(r.sections), 'sections')
  assert(Array.isArray(r.duplicates), 'duplicates')
  assert(Array.isArray(r.clusters), 'clusters')
  assert(Array.isArray(r.contradictions), 'contradictions')
  assert(typeof r.instructionDensity === 'number', 'density')
  assert(r.redundancyScore >= 0 && r.redundancyScore <= 1, 'redundancy range')
  assert(r.complexityScore >= 0 && r.complexityScore <= 1, 'complexity range')
  assert(typeof r.summary === 'string' && r.summary.length > 10, 'summary')
  assert(r.instructionDensity === Number((r.instructionCount / r.tokensEstimate).toFixed(4)), 'density formula')
})

test('summary mentions tone / questions / redundancy when present', () => {
  const r = inspectPrompt({ writerPrompt: SAMPLE })
  assert(/tono|domande|Ridondanza|Prompt/i.test(r.summary), 'summary content')
})

test('accepts prompt alias key', () => {
  const a = inspectPrompt({ writerPrompt: 'Do not ask questions. Do not ask questions.' })
  const b = inspectPrompt({ prompt: 'Do not ask questions. Do not ask questions.' })
  assertEqual(a.characters, b.characters, 'alias')
})

test('highly redundant prompt scores higher than compact', () => {
  const compact = inspectPrompt({
    writerPrompt: 'WRITER BRIEF\nAnswer directly.\nBe short.',
  })
  const noisy = inspectPrompt({
    writerPrompt: [
      'WRITER BRIEF',
      'MUST:',
      '- Do not ask questions.',
      '- Do not ask questions.',
      '- Do not ask questions.',
      '- Do not ask questions.',
      '- Stay warm and friendly and natural and human.',
      '- Stay warm and friendly and natural and human.',
      '- Keep it warm.',
      '- Be friendly.',
      '- Sound natural.',
      '- Be human.',
      'CONSTRAINTS:',
      '- ask_question:no',
      '- hard:no_question',
    ].join('\n'),
  })
  assert(noisy.redundancyScore > compact.redundancyScore, 'redundancy higher')
  assert(noisy.duplicates.some((d) => d.count >= 3), 'multi dupe')
})

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
