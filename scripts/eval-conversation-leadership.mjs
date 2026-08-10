#!/usr/bin/env node
/**
 * Conversation Leadership Engine — 200 short-reply conversations.
 * User only says: Yes / No / Maybe / Interesting / I don't know (and IT equivalents).
 * Measures continuation, question frequency, ownership, engagement.
 */
import {
  runConversationLeadershipEvaluation,
  LEADERSHIP_THRESHOLDS,
} from '../lib/server/conversation-leadership.js'

const result = runConversationLeadershipEvaluation({ verbose: true })
const { summary, examples, misses } = result

console.log('Conversation Leadership Engine — evaluation')
console.log('Thresholds:', LEADERSHIP_THRESHOLDS)
console.log('Summary:', summary)
if (examples) console.log('Examples:', JSON.stringify(examples, null, 2))
if (misses?.length) console.log('Misses (sample):', misses.slice(0, 8))

if (!summary.ok) {
  console.error('Evaluation failed quality gate.')
  process.exit(1)
}

console.log(
  `OK — ${summary.total} prompts; leadAccuracy=${summary.leadAccuracy}; continuation=${summary.continuation}; questionFrequency=${summary.questionFrequency}; ownership=${summary.ownership}; engagement=${summary.engagement}.`,
)
process.exit(0)
