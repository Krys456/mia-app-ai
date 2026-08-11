#!/usr/bin/env node
/**
 * LAIfe V2 — Identity Evaluator harness (experimental)
 *
 * Small offline demo with fixed examples. No LLM. No pipeline wiring.
 *
 * Usage:
 *   node lib/server/v2/eval/identity-harness.mjs
 */

import { evaluateIdentity, IDENTITY_EVALUATOR_VERSION } from '../brain/identity-evaluator.js'

const PLAN_CONNECT = {
  objective: 'connect__need_connection__one_spark',
  writerBrief: {
    strategy: 'connect',
    need: 'connection',
    tone: 'warm',
    coda: 'spark',
    mustNot: ['Do not ask a question.'],
  },
  constraints: ['ask_question:no', 'hard:no_question', 'strategy:connect'],
}

const PLAN_SUPPORT = {
  objective: 'support__need_emotional_care',
  writerBrief: {
    strategy: 'support',
    need: 'emotional_care',
    tone: 'supportive',
    coda: 'none',
  },
  constraints: ['ask_question:no', 'strategy:support'],
}

/** @type {{ name: string, response: string, plannerSummary: object, writerSummary?: object }[]} */
const EXAMPLES = [
  {
    name: 'generic-soft-stack',
    response:
      'È bello potersi connettere. Le piccole cose della vita possono davvero fare la differenza. È sorprendente come un semplice scambio possa portare luce nella giornata.',
    plannerSummary: PLAN_CONNECT,
  },
  {
    name: 'laife-signature-coffee',
    response: 'Sto bene. Stamattina il caffè aveva un odore di tostatura quasi dolce.',
    plannerSummary: PLAN_CONNECT,
    writerSummary: { strategy: 'connect', coda: 'spark' },
  },
  {
    name: 'helpdesk',
    response: 'How can I help you today? Feel free to ask me anything.',
    plannerSummary: PLAN_CONNECT,
  },
  {
    name: 'support-with-presence',
    response: 'Mi dispiace. Posso solo immaginare quanto pesi stamattina.',
    plannerSummary: PLAN_SUPPORT,
  },
  {
    name: 'plan-violation-question',
    response: 'Ciao! Come va la tua giornata?',
    plannerSummary: PLAN_CONNECT,
  },
  {
    name: 'salvaged-image',
    response:
      'Ciao! È bello sentirti. A volte bastano piccole cose, come un bel ricordo o una canzone che ci fa sorridere.',
    plannerSummary: PLAN_CONNECT,
  },
  {
    name: 'minimal-ack',
    response: 'Va bene.',
    plannerSummary: PLAN_CONNECT,
  },
]

function pct(n) {
  return `${Math.round(n * 100)}%`
}

function row(label, n) {
  return `${label.padEnd(14)} ${pct(n).padStart(4)}  ${'█'.repeat(Math.round(n * 12))}${'░'.repeat(12 - Math.round(n * 12))}`
}

console.log(`\nLAIfe Identity Evaluator harness (${IDENTITY_EVALUATOR_VERSION})`)
console.log('Measurement only — no rewrites, no pipeline wiring.\n')

/** @type {{ name: string, identityScore: number }[]} */
const ranked = []

for (const example of EXAMPLES) {
  const result = evaluateIdentity({
    response: example.response,
    plannerSummary: example.plannerSummary,
    writerSummary: example.writerSummary,
  })
  ranked.push({ name: example.name, identityScore: result.identityScore })

  console.log(`=== ${example.name} ===`)
  console.log(`response: ${example.response}`)
  console.log(row('identity', result.identityScore))
  console.log(row('genericity', result.genericity))
  console.log(row('signature', result.signature))
  console.log(row('memorability', result.memorability))
  console.log(row('coherence', result.coherence))
  if (result.reasons.length) {
    console.log(`reasons: ${result.reasons.slice(0, 6).join(', ')}`)
  }
  if (result.suggestions.length) {
    console.log(`suggestions: ${result.suggestions.slice(0, 3).join(' | ')}`)
  }
  console.log('')
}

ranked.sort((a, b) => b.identityScore - a.identityScore)
console.log('--- ranked by identityScore (desc) ---')
for (const [i, item] of ranked.entries()) {
  console.log(`${i + 1}. ${item.name.padEnd(28)} ${pct(item.identityScore)}`)
}
console.log('')
