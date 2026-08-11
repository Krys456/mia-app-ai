#!/usr/bin/env node
/**
 * LAIfe V2 — Planner Fidelity harness (experimental)
 *
 * Offline examples. Measurement only — no rewrites, no pipeline wiring.
 *
 * Usage:
 *   node lib/server/v2/eval/planner-fidelity-harness.mjs
 */

import {
  evaluatePlannerFidelity,
  PLANNER_FIDELITY_VERSION,
} from '../brain/planner-fidelity.js'

const PLAN_SUPPORT = {
  objective: 'support__need_emotional_care',
  writerBrief: {
    strategy: 'support',
    need: 'emotional_care',
    tone: 'supportive',
    depth: 'light',
    coda: 'none',
    comfort: true,
    must: ['Prioritize emotional recognition.'],
    mustNot: ['Do not ask a question.', 'Do not use helpdesk openers.'],
  },
  conversationMomentum: { kind: 'emotional_support', confidence: 0.85, signals: [], scores: {} },
  conversationFocus: {
    status: 'active',
    topic: 'tristezza',
    confidence: 0.8,
    signals: [],
    avoidClarification: true,
  },
  constraints: [
    'strategy:support',
    'ask_question:no',
    'hard:no_question',
    'comfort:yes',
    'conversation_momentum:emotional_support',
    'focus:avoid_clarification',
  ],
}

const PLAN_LEARN = {
  objective: 'explain__need_learning',
  writerBrief: {
    strategy: 'explain',
    need: 'learning',
    tone: 'calm',
    depth: 'balanced',
    coda: 'none',
    teaching: true,
    mustNot: ['Do not ask a question.'],
  },
  conversationMomentum: { kind: 'learning', confidence: 0.9, signals: [], scores: {} },
  constraints: ['strategy:explain', 'ask_question:no', 'teach:yes', 'conversation_momentum:learning'],
}

const PLAN_CONNECT = {
  objective: 'connect__need_connection',
  writerBrief: {
    strategy: 'connect',
    need: 'connection',
    tone: 'warm',
    depth: 'light',
    coda: 'spark',
    mustNot: ['Do not ask a question.', 'Do not use helpdesk openers.'],
  },
  conversationMomentum: { kind: 'social', confidence: 0.7, signals: [], scores: {} },
  constraints: ['strategy:connect', 'ask_question:no', 'conversation_momentum:social'],
}

const PLAN_DEBUG = {
  objective: 'guide__need_problem_solving',
  writerBrief: {
    strategy: 'guide',
    need: 'problem_solving',
    tone: 'direct',
    depth: 'balanced',
    coda: 'none',
    mustNot: ['Do not ask a question.'],
  },
  conversationMomentum: { kind: 'debugging', confidence: 0.88, signals: [], scores: {} },
  constraints: ['strategy:guide', 'ask_question:no', 'conversation_momentum:debugging'],
}

/** @type {{ name: string, plannerOutput: object, response: string }[]} */
const EXAMPLES = [
  {
    name: 'support-faithful',
    plannerOutput: PLAN_SUPPORT,
    response: 'Mi dispiace. Sono qui con te.',
  },
  {
    name: 'support-helpdesk-miss',
    plannerOutput: PLAN_SUPPORT,
    response: 'How can I help you today? What is wrong?',
  },
  {
    name: 'learning-faithful',
    plannerOutput: PLAN_LEARN,
    response:
      'La fotosintesi converte luce, acqua e CO₂ in zuccheri. Perché importa: produce energia per la pianta. Per esempio, una foglia al sole accumula glucosio.',
  },
  {
    name: 'connect-question-miss',
    plannerOutput: PLAN_CONNECT,
    response: 'Ciao! Come posso aiutarti oggi?',
  },
  {
    name: 'connect-presence-ok',
    plannerOutput: PLAN_CONNECT,
    response: 'Ciao! Bentornato.',
  },
  {
    name: 'debugging-faithful',
    plannerOutput: PLAN_DEBUG,
    response:
      'Il TypeError nasce probabilmente da un valore undefined al submit. Prova a loggare il payload prima della chiamata. Se fallisce ancora, controlla il guard sul campo email.',
  },
]

/**
 * @param {number} n
 * @returns {string}
 */
function bar(n) {
  const filled = Math.round(clamp(n) * 12)
  return `${'█'.repeat(filled)}${'░'.repeat(12 - filled)}`
}

/**
 * @param {number} n
 * @returns {number}
 */
function clamp(n) {
  return Math.max(0, Math.min(1, n))
}

/**
 * @param {number} n
 * @returns {string}
 */
function pct(n) {
  return `${Math.round(clamp(n) * 100)}%`.padStart(3, ' ')
}

console.log(`LAIfe Planner Fidelity harness (${PLANNER_FIDELITY_VERSION})`)
console.log('Measurement only — no rewrites, no pipeline wiring.\n')

/** @type {{ name: string, fidelityScore: number }[]} */
const ranked = []

for (const ex of EXAMPLES) {
  const r = evaluatePlannerFidelity({
    plannerOutput: ex.plannerOutput,
    response: ex.response,
  })
  ranked.push({ name: ex.name, fidelityScore: r.fidelityScore })
  console.log(`=== ${ex.name} ===`)
  console.log(`response: ${ex.response}`)
  console.log(`fidelity       ${pct(r.fidelityScore)}  ${bar(r.fidelityScore)}`)
  console.log(`strategy       ${pct(r.strategy)}  ${bar(r.strategy)}`)
  console.log(`momentum       ${pct(r.momentum)}  ${bar(r.momentum)}`)
  console.log(`tone           ${pct(r.tone)}  ${bar(r.tone)}`)
  console.log(`depth          ${pct(r.depth)}  ${bar(r.depth)}`)
  console.log(`constraints    ${pct(r.constraints)}  ${bar(r.constraints)}`)
  if (r.missedSignals.length) console.log(`missed: ${r.missedSignals.join(', ')}`)
  if (r.reasons.length) console.log(`reasons: ${r.reasons.slice(0, 8).join(', ')}`)
  console.log('')
}

ranked.sort((a, b) => b.fidelityScore - a.fidelityScore)
console.log('--- ranked by fidelityScore (desc) ---')
ranked.forEach((r, i) => {
  console.log(`${i + 1}. ${r.name.padEnd(28)} ${pct(r.fidelityScore)}`)
})
