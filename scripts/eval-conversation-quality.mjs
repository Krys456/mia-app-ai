#!/usr/bin/env node
/**
 * Conversation Quality Gate — evaluation.
 * Verifies hard rejects, gift requirement, and good drafts pass.
 */
import {
  runConversationQualityEvaluation,
  QUALITY_THRESHOLDS,
} from '../lib/server/conversation-quality-gate.js'

const result = runConversationQualityEvaluation({ verbose: true })
const { summary, examples, misses } = result

console.log('Conversation Quality Gate — evaluation')
console.log('Thresholds:', QUALITY_THRESHOLDS)
console.log('Summary:', summary)
if (examples) console.log('Examples:', JSON.stringify(examples, null, 2))
if (misses?.length) console.log('Misses (sample):', misses.slice(0, 6))

if (!summary.ok) {
  console.error('Evaluation failed quality gate.')
  process.exit(1)
}

console.log(
  `OK — badReject=${summary.badRejectRate}; goodPass=${summary.goodPassRate}; gift=${summary.giftDetectionRate}; expanded=${summary.expandedAccuracy}.`,
)
process.exit(0)
