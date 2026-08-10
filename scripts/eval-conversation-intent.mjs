#!/usr/bin/env node
/**
 * Conversation Intent Engine — 200 ambiguous prompts.
 * Measures correct intent selection and engagement potential.
 */
import {
  runConversationIntentEvaluation,
  INTENT_THRESHOLDS,
} from '../lib/server/conversation-intent.js'

const result = runConversationIntentEvaluation({ verbose: true })
const { summary, examples, misses } = result

console.log('Conversation Intent Engine — evaluation')
console.log('Thresholds:', INTENT_THRESHOLDS)
console.log('Summary:', summary)
if (examples) console.log('Routing examples:', JSON.stringify(examples, null, 2))
if (misses?.length) console.log('Misses (sample):', misses.slice(0, 8))

if (!summary.ok) {
  console.error('Evaluation failed quality gate.')
  process.exit(1)
}

console.log(
  `OK — ${summary.total} prompts; accuracy=${summary.accuracy}; engagement=${summary.engagement}.`,
)
process.exit(0)
