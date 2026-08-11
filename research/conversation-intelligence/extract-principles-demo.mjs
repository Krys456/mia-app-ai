#!/usr/bin/env node
/**
 * Extract Principles demo — offline research
 *
 * Reads every dataset JSON in this folder and writes:
 *   conversation-principles.json
 *   conversation-principles-report.md
 *
 * Usage:
 *   node research/conversation-intelligence/extract-principles-demo.mjs
 */

import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  extractPrinciplesPackage,
  EXTRACT_PRINCIPLES_VERSION,
} from './extract-principles.js'

const dir = dirname(fileURLToPath(import.meta.url))

const result = extractPrinciplesPackage({
  dir,
  writeOutputs: true,
  jsonPath: join(dir, 'conversation-principles.json'),
  reportPath: join(dir, 'conversation-principles-report.md'),
})

console.log(`Extract Principles (${EXTRACT_PRINCIPLES_VERSION})`)
console.log(`experiences: ${result.principles.length}`)
console.log('')

for (const p of result.principles) {
  console.log(`=== ${p.experience} ===`)
  console.log(
    `  opening=${p.preferredOpening} strategy=${p.preferredStrategy} move=${p.preferredMove}`,
  )
  console.log(
    `  initiative=${p.preferredInitiative} depth=${p.preferredDepth} energy=${p.preferredEnergy}`,
  )
  console.log(
    `  qRate=${p.questionRate} cur=${p.metrics.curiosity} nov=${p.metrics.novelty} pra=${p.metrics.practicality}`,
  )
  console.log(`  confidence=${p.confidence}`)
  console.log(`  recommendations:`)
  for (const r of p.recommendations.slice(0, 3)) console.log(`    - ${r}`)
  console.log(`  avoid:`)
  for (const a of p.avoid.slice(0, 3)) console.log(`    - ${a}`)
  console.log('')
}

console.log(`json:   ${result.jsonPath}`)
console.log(`report: ${result.reportPath}`)
