#!/usr/bin/env node
/**
 * Conversation Intelligence — analyze-dataset demo
 *
 * Analyzes every JSON dataset in this folder and writes report.md.
 * Offline. No LLM. No runtime wiring.
 *
 * Usage:
 *   node research/conversation-intelligence/analyze-dataset-demo.mjs
 */

import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import {
  analyzeAllDatasets,
  ANALYZE_DATASET_VERSION,
} from './analyze-dataset.js'

const dir = dirname(fileURLToPath(import.meta.url))

const result = analyzeAllDatasets({
  dir,
  writeReport: true,
  reportPath: join(dir, 'report.md'),
})

console.log(`Conversation Intelligence Analyzer (${ANALYZE_DATASET_VERSION})`)
console.log(`dir: ${result.dir}`)
console.log(`datasets: ${result.global.datasets}`)
console.log(`examples: ${result.global.totalExamples}`)
console.log('')
console.log('Per dataset:')
for (const d of result.datasets) {
  console.log(
    `  - ${d.name}: n=${d.stats.examples} q%=${d.stats.questionPercentage} cur=${d.stats.averageCuriosity} nov=${d.stats.averageNovelty} pra=${d.stats.averagePracticality}`,
  )
}
console.log('')
console.log('Most common strategies:')
for (const s of result.global.mostCommonStrategies) {
  console.log(`  ${s.key}: ${s.count}`)
}
console.log('')
console.log('Insights:')
for (const tip of result.insights) {
  console.log(`  - ${tip}`)
}
console.log('')
console.log(`report: ${result.reportPath}`)
