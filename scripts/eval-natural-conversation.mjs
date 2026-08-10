#!/usr/bin/env node
/**
 * Natural Conversation Engine evaluation pipeline.
 * Runs ≥30 openings + ≥30 follow-ups; rejects below quality thresholds.
 */
import {
  runNaturalConversationEvaluation,
  NATURAL_THRESHOLDS,
} from '../lib/server/natural-conversation-engine.js'

const result = runNaturalConversationEvaluation({ verbose: true })
const { summary, rejected } = result

console.log('Natural Conversation Engine — evaluation')
console.log('Thresholds:', NATURAL_THRESHOLDS)
console.log('Summary:', summary)

if (rejected?.length) {
  console.error('Rejected examples:', rejected.map((r) => r.id).join(', '))
  process.exit(1)
}

if (!summary.ok) {
  console.error('Evaluation failed quality gate.')
  process.exit(1)
}

console.log(
  `OK — ${summary.openingCount} openings, ${summary.followupCount} follow-ups, all passed and improved.`,
)
process.exit(0)
