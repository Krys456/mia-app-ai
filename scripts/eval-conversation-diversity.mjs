#!/usr/bin/env node
/**
 * Conversation Diversity Engine — 200 greeting conversations.
 * No two consecutive conversations may share the same structure.
 */
import {
  runConversationDiversityEvaluation,
  DIVERSITY_THRESHOLDS,
} from '../lib/server/conversation-diversity-engine.js'

const result = runConversationDiversityEvaluation({ verbose: true })
const { summary, beforeAfter } = result

console.log('Conversation Diversity Engine — evaluation')
console.log('Thresholds:', DIVERSITY_THRESHOLDS)
console.log('Summary:', summary)
if (beforeAfter) {
  console.log('Before template:', beforeAfter.before)
  console.log('After samples:', beforeAfter.afterExamples)
}

if (!summary.ok) {
  console.error('Evaluation failed: consecutiveSame=', summary.consecutiveSameStructure)
  process.exit(1)
}

console.log(
  `OK — ${summary.total} greetings; consecutive same structure=${summary.consecutiveSameStructure}; forms=${summary.uniqueForms}; structures=${summary.uniqueStructures}.`,
)
process.exit(0)
