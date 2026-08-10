#!/usr/bin/env node
/**
 * Cognitive Authority Engine — 500-greeting evaluation.
 * Weak / empty-politeness greetings must be REJECTED.
 */
import {
  runCognitiveAuthorityEvaluation,
  AUTHORITY_THRESHOLDS,
} from '../lib/server/cognitive-authority-engine.js'

const result = runCognitiveAuthorityEvaluation({ verbose: true })
const { summary, leaks } = result

console.log('Cognitive Authority Engine — 500-greeting evaluation')
console.log('Thresholds:', AUTHORITY_THRESHOLDS)
console.log('Summary:', summary)

if (leaks?.length) {
  console.error('Leaks (approved weak/banned):', leaks.slice(0, 20))
}

if (!summary.ok) {
  console.error('Evaluation failed quality gate.')
  process.exit(1)
}

console.log(
  `OK — ${summary.total} greetings; weak rejection rate=${summary.rejectionRate}; banned-bare approved=${summary.approvedBannedBare}.`,
)
process.exit(0)
