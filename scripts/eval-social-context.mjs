#!/usr/bin/env node
/**
 * Social Context Engine — ≥200 conversational examples.
 * Measures social interpretation accuracy, naturalness,
 * encyclopedia detection, and recovery quality.
 */
import {
  runSocialContextEvaluation,
  SOCIAL_CONTEXT_THRESHOLDS,
} from '../lib/server/social-context-engine.js'

const result = runSocialContextEvaluation({ verbose: true })
const { summary, examples, misses } = result

console.log('Social Context Engine — evaluation')
console.log('Thresholds:', SOCIAL_CONTEXT_THRESHOLDS)
console.log('Summary:', summary)
if (examples) console.log('Examples:', JSON.stringify(examples, null, 2))
if (misses?.length) console.log('Misses (sample):', misses.slice(0, 8))

if (!summary.ok) {
  console.error('Evaluation failed quality gate.')
  process.exit(1)
}

console.log(
  `OK — ${summary.total} prompts; accuracy=${summary.accuracy}; naturalness=${summary.naturalness}; encyclopediaDetection=${summary.encyclopediaDetection}; recovery=${summary.recovery}.`,
)
process.exit(0)
