#!/usr/bin/env node
/**
 * LAIfe V2 — Continuation Planner offline harness
 *
 * Isolated experiment. No Writer / Planner / Runtime / Pipeline / API.
 * No LLM. Prints structured continuation strategies for fixed cases.
 *
 * Usage:
 *   node lib/server/v2/eval/continuation-planner-harness.mjs
 */

import { writeFileSync } from 'fs'
import {
  planContinuation,
  CONTINUATION_PLANNER_VERSION,
} from '../brain/continuation-planner.js'

/** @type {{ name: string, lastUserMessage: string, topic?: string, experience?: string, momentum?: string }[]} */
const CASES = [
  { name: 'ok-neuroscience', lastUserMessage: 'Ok', topic: 'Neuroscience' },
  { name: 'interessante-space', lastUserMessage: 'Interessante', topic: 'Space' },
  { name: 'continua', lastUserMessage: 'Continua' },
  { name: 'continua-physics', lastUserMessage: 'Continua', topic: 'physics' },
  { name: 'dimmi-di-piu', lastUserMessage: 'Dimmi di più', topic: 'biology' },
  { name: 'riassumi', lastUserMessage: 'Riassumi', topic: 'history' },
  { name: 'analogia', lastUserMessage: "Fammi un'analogia", topic: 'philosophy' },
  { name: 'differenza', lastUserMessage: 'Qual è la differenza versus X?', topic: 'history' },
  { name: 'perche', lastUserMessage: 'Perché?', topic: 'astronomy' },
  { name: 'experience-debug', lastUserMessage: '', topic: 'software', experience: 'debugging' },
  { name: 'momentum-learn', lastUserMessage: 'Bene così', topic: 'science', momentum: 'learning' },
  { name: 'ok-plain', lastUserMessage: 'ok' },
]

console.log(`Continuation Planner harness (${CONTINUATION_PLANNER_VERSION}) — offline`)
console.log('')

/** @type {any[]} */
const rows = []

for (const c of CASES) {
  const plan = planContinuation({
    lastUserMessage: c.lastUserMessage,
    topic: c.topic,
    experience: c.experience,
    momentum: c.momentum,
  })
  rows.push({ ...c, plan })

  console.log(`=== ${c.name} ===`)
  console.log(`user:        ${JSON.stringify(c.lastUserMessage)}`)
  if (c.topic) console.log(`topic:       ${c.topic}`)
  if (c.experience) console.log(`experience:  ${c.experience}`)
  if (c.momentum) console.log(`momentum:    ${c.momentum}`)
  console.log(`continue:    ${plan.continueConversation}`)
  console.log(`strategy:    ${plan.strategy}`)
  console.log(`move:        ${plan.move}`)
  console.log(`confidence:  ${plan.confidence}`)
  console.log('')
}

const outPath = '/tmp/v2-continuation-planner-harness.json'
writeFileSync(
  outPath,
  JSON.stringify({ version: CONTINUATION_PLANNER_VERSION, cases: rows }, null, 2),
)
console.log(`saved ${outPath}`)
