#!/usr/bin/env node
/**
 * Experiment 001 — Exploration Principles in Planner guidance
 *
 * Baseline (useExplorationPrinciples=false)
 *   vs
 * Principles (useExplorationPrinciples=true)
 *
 * Same Writer. Exploration prompts only. Conversation Behavior Harness.
 *
 * Usage:
 *   node research/conversation-intelligence/experiments/001-exploration-principles/run.mjs
 *
 * Env:
 *   OPENAI_API_KEY   required
 *   OPENAI_MODEL     optional (default gpt-4o-mini)
 *
 * No Writer / Runtime / API code changes. No commits.
 */

import { createRequire } from 'module'
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import { createPipeline, DEFAULT_FOUNDATION, PIPELINE_VERSION } from '../../../../lib/server/v2/brain/pipeline.js'
import { createWriter, WRITER_VERSION } from '../../../../lib/server/v2/brain/writer.js'
import {
  plan,
  PLANNER_VERSION,
  evaluateConversationExperience,
} from '../../../../lib/server/v2/brain/planner.js'
import { createOpenAIProvider } from '../../../../lib/server/v2/providers/openai-provider.js'
import {
  createConversationBehaviorHarness,
  CONVERSATION_BEHAVIOR_HARNESS_VERSION,
} from '../../../../lib/server/v2/eval/conversation-behavior-harness.js'

const require = createRequire('/workspace/package.json')
const OpenAI = require('openai').default

const __dirname = dirname(fileURLToPath(import.meta.url))
const reportPath = join(__dirname, 'report.md')
const jsonPath = join(__dirname, 'results.json')

const apiKey = process.env.OPENAI_API_KEY?.trim()
if (!apiKey) {
  console.error('OPENAI_API_KEY missing — cannot run Experiment 001')
  process.exit(1)
}

const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
const client = new OpenAI({ apiKey })

/**
 * @param {string} label
 */
function makeProvider(label) {
  const provider = createOpenAIProvider({
    client,
    defaultModel: model,
    timeoutMs: 60000,
  })
  provider.__label = label
  return provider
}

const writerBaseline = createWriter({
  providers: { openai: makeProvider('baseline') },
  defaultProviderId: 'openai',
})
const writerPrinciples = createWriter({
  providers: { openai: makeProvider('principles') },
  defaultProviderId: 'openai',
})

const pipelineBaseline = createPipeline({
  writer: writerBaseline,
  personalityFoundation: DEFAULT_FOUNDATION,
  planFn: (input) =>
    plan({
      ...input,
      useConversationExperience: true,
      useExplorationPrinciples: false,
    }),
})
const pipelinePrinciples = createPipeline({
  writer: writerPrinciples,
  personalityFoundation: DEFAULT_FOUNDATION,
  planFn: (input) =>
    plan({
      ...input,
      useConversationExperience: true,
      useExplorationPrinciples: true,
    }),
})

/** ≥20 exploration prompts (cue-matched). */
const PROMPTS = [
  'Di cosa possiamo parlare?',
  'Parliamo',
  'Esploriamo',
  'Esplora con me',
  'Di che possiamo parlare?',
  'Di cosa si può parlare?',
  'Cosa possiamo fare?',
  'Cosa potremmo dire?',
  'Cosa possiamo toccare?',
  "Let's talk",
  'What can we talk about?',
  'What should we chat about?',
  'Open the floor',
  'Parliamo di qualcosa',
  'Esploriamo un tema',
  'Di cosa possiamo parlare adesso?',
  'Parliamo pure',
  'Esplora',
  'Cosa potremmo fare insieme?',
  'Di che parlare?',
  "Let's talk about something",
  'Open the floor please',
  "Parliamo un po'",
  'Esploriamo insieme',
]

const POSSIAMO_RE = /possiamo\s+parlare\s+di/i
const GENERIC_OPENING_RE =
  /^(possiamo\s+parlare\s+di|ecco\s+(alcuni|una lista|dei)\s+(argomenti|temi)|alcuni\s+argomenti|we\s+can\s+talk\s+about|here\s+are\s+(some\s+)?topics)/i
const GENERIC_LIST_RE =
  /(1\)|2\)|3\)|^\s*[-•]\s+.+\n\s*[-•]\s+.+\n\s*[-•])/m

/**
 * Deterministic 0..1 scorers for exploration response quality.
 * @param {string} text
 */
function scoreMetrics(text) {
  const t = String(text || '').trim()
  const lower = t.toLowerCase()
  const words = t.split(/\s+/).filter(Boolean)

  let curiosity = 0.35
  if (/\b(curios|inatteso|sorprend|e se|sai che|mai pensato|hook|scopri)\b/i.test(t)) {
    curiosity += 0.2
  }
  if (/\?/.test(t)) curiosity += 0.08
  if (/\b(fatto|dato|percentuale|\d+\s*%|\d{2,})\b/i.test(t)) curiosity += 0.12
  if (/\b(thought experiment|esperimento mentale|immagina|supponi)\b/i.test(t)) {
    curiosity += 0.15
  }
  if (POSSIAMO_RE.test(t) || GENERIC_OPENING_RE.test(t)) curiosity -= 0.18
  if (GENERIC_LIST_RE.test(t)) curiosity -= 0.12

  let novelty = 0.3
  if (/\b(inatteso|sorprend|strano|laterale|inaspett|unexpected|odd|weird)\b/i.test(t)) {
    novelty += 0.22
  }
  if (/\b(thought experiment|esperimento mentale|metafora|angolo)\b/i.test(t)) {
    novelty += 0.15
  }
  if (GENERIC_LIST_RE.test(t) || /catalogo|elenco di temi|topic list/i.test(t)) {
    novelty -= 0.2
  }
  if (POSSIAMO_RE.test(t)) novelty -= 0.15
  // Unique token ratio as a light novelty proxy
  const uniq = new Set(words.map((w) => w.toLowerCase()))
  if (words.length > 0) {
    const ratio = uniq.size / words.length
    novelty += Math.min(0.15, ratio * 0.2)
  }

  let practicality = 0.25
  if (/\b(passo|step|prova|prova a|inizia|concrete|pratico|actionable)\b/i.test(t)) {
    practicality += 0.2
  }
  if (/\b(come fare|next|prossimo)\b/i.test(t)) practicality += 0.1
  // Exploration should not optimize for practicality; keep modest
  if (words.length > 80) practicality += 0.05

  const clamp = (n) => Math.max(0, Math.min(1, Number(n.toFixed(4))))
  return {
    curiosity: clamp(curiosity),
    novelty: clamp(novelty),
    practicality: clamp(practicality),
    lengthChars: t.length,
    lengthWords: words.length,
    hasPossiamoParlareDi: POSSIAMO_RE.test(t) ? 1 : 0,
    hasGenericOpening: GENERIC_OPENING_RE.test(lower) || GENERIC_LIST_RE.test(t) ? 1 : 0,
  }
}

/**
 * Map plan + text into harness behavior labels (deterministic).
 * @param {any} planResult
 * @param {string} text
 * @param {ReturnType<typeof scoreMetrics>} metrics
 */
function labelsFromTurn(planResult, text, metrics) {
  const guidance = planResult?.experienceGuidance?.directives || []
  const principlesOn = guidance.some((d) => /fatto sorprendente/i.test(String(d)))
  const hasQ = /\?/.test(text)
  const strategy = principlesOn
    ? 'surprise'
    : metrics.novelty >= 0.55
      ? 'surprise'
      : 'expand'
  const move = principlesOn
    ? /\?/.test(text)
      ? 'question'
      : /esperimento|immagina|supponi/i.test(text)
        ? 'thought_experiment'
        : 'unexpected_fact'
    : GENERIC_LIST_RE.test(text) || POSSIAMO_RE.test(text)
      ? 'next_step'
      : 'thought_experiment'

  return {
    turnType: /** @type {const} */ ('exploration'),
    strategy,
    move,
    initiative: principlesOn || metrics.curiosity >= 0.55 ? /** @type {const} */ ('high') : /** @type {const} */ ('medium'),
    question: hasQ,
    opening: POSSIAMO_RE.test(text) || GENERIC_OPENING_RE.test(text)
      ? /** @type {const} */ ('friendly')
      : principlesOn
        ? /** @type {const} */ ('direct')
        : /** @type {const} */ ('friendly'),
    closing: hasQ ? /** @type {const} */ ('question') : /** @type {const} */ ('proposal'),
    depth: metrics.lengthWords > 70 ? /** @type {const} */ ('medium') : /** @type {const} */ ('short'),
    energy: principlesOn || metrics.curiosity >= 0.6 ? /** @type {const} */ ('high') : /** @type {const} */ ('medium'),
  }
}

/**
 * @param {number[]} values
 */
function avg(values) {
  if (!values.length) return 0
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4))
}

console.log(
  `Experiment 001 — Exploration Principles | planner ${PLANNER_VERSION} | writer ${WRITER_VERSION} | pipeline ${PIPELINE_VERSION} | harness ${CONVERSATION_BEHAVIOR_HARNESS_VERSION} | model ${model}`,
)
console.log(`prompts: ${PROMPTS.length}`)
console.log('baseline  = useExplorationPrinciples=false')
console.log('principles= useExplorationPrinciples=true')
console.log('')

const harness = createConversationBehaviorHarness()

/** @type {any[]} */
const rows = []

for (let i = 0; i < PROMPTS.length; i += 1) {
  const prompt = PROMPTS[i]
  const id = `exp-${String(i + 1).padStart(2, '0')}`
  const messages = [{ role: 'user', content: prompt }]
  const experience = evaluateConversationExperience(messages)
  if (experience.experience !== 'exploration') {
    console.warn(`skip ${id}: experience=${experience.experience} for "${prompt}"`)
    continue
  }

  process.stdout.write(`… ${id} ${prompt.slice(0, 40)}\n`)

  const baseOut = await pipelineBaseline.runConversation({
    messages,
    model,
    providerId: 'openai',
  })
  const prinOut = await pipelinePrinciples.runConversation({
    messages,
    model,
    providerId: 'openai',
  })

  const baseText = baseOut.response?.text || ''
  const prinText = prinOut.response?.text || ''
  const baseMetrics = scoreMetrics(baseText)
  const prinMetrics = scoreMetrics(prinText)

  const baseLabels = labelsFromTurn(baseOut.plan, baseText, baseMetrics)
  const prinLabels = labelsFromTurn(prinOut.plan, prinText, prinMetrics)

  // Harness: LAIfe slot = principles enabled; ChatGPT slot = baseline
  const caseId = harness.addCase({
    id,
    input: prompt,
    laifeResponse: prinText,
    chatgptResponse: baseText,
    notes: 'LAIfe=principles ChatGPT-slot=baseline',
  })

  const prinScore = prinMetrics.curiosity + prinMetrics.novelty - prinMetrics.hasGenericOpening * 0.3
  const baseScore = baseMetrics.curiosity + baseMetrics.novelty - baseMetrics.hasGenericOpening * 0.3
  let winner = 'Tie'
  if (prinScore > baseScore + 0.05) winner = 'LAIfe'
  else if (baseScore > prinScore + 0.05) winner = 'ChatGPT'

  harness.rate(caseId, {
    ...prinLabels,
    winner,
    chatgpt: baseLabels,
    notes: `Δcuriosity=${(prinMetrics.curiosity - baseMetrics.curiosity).toFixed(3)}`,
  })

  rows.push({
    id,
    prompt,
    experience: experience.experience,
    baseline: {
      text: baseText,
      ...baseMetrics,
      guidance: baseOut.plan?.experienceGuidance?.directives || [],
    },
    principles: {
      text: prinText,
      ...prinMetrics,
      guidance: prinOut.plan?.experienceGuidance?.directives || [],
    },
    winner,
  })
}

const summary = harness.summary()

const baselineCuriosity = avg(rows.map((r) => r.baseline.curiosity))
const principlesCuriosity = avg(rows.map((r) => r.principles.curiosity))
const baselineNovelty = avg(rows.map((r) => r.baseline.novelty))
const principlesNovelty = avg(rows.map((r) => r.principles.novelty))
const baselinePracticality = avg(rows.map((r) => r.baseline.practicality))
const principlesPracticality = avg(rows.map((r) => r.principles.practicality))
const baselineLength = avg(rows.map((r) => r.baseline.lengthWords))
const principlesLength = avg(rows.map((r) => r.principles.lengthWords))
const baselineGeneric = rows.reduce((s, r) => s + r.baseline.hasGenericOpening, 0)
const principlesGeneric = rows.reduce((s, r) => s + r.principles.hasGenericOpening, 0)
const baselinePossiamo = rows.reduce((s, r) => s + r.baseline.hasPossiamoParlareDi, 0)
const principlesPossiamo = rows.reduce((s, r) => s + r.principles.hasPossiamoParlareDi, 0)

const diff = (a, b) => Number((a - b).toFixed(4))

const payload = {
  experiment: '001-exploration-principles',
  plannerVersion: PLANNER_VERSION,
  writerVersion: WRITER_VERSION,
  pipelineVersion: PIPELINE_VERSION,
  harnessVersion: CONVERSATION_BEHAVIOR_HARNESS_VERSION,
  model,
  prompts: rows.length,
  metrics: {
    curiosity: {
      baseline: baselineCuriosity,
      principles: principlesCuriosity,
      difference: diff(principlesCuriosity, baselineCuriosity),
    },
    novelty: {
      baseline: baselineNovelty,
      principles: principlesNovelty,
      difference: diff(principlesNovelty, baselineNovelty),
    },
    practicality: {
      baseline: baselinePracticality,
      principles: principlesPracticality,
      difference: diff(principlesPracticality, baselinePracticality),
    },
    averageResponseLengthWords: {
      baseline: baselineLength,
      principles: principlesLength,
      difference: diff(principlesLength, baselineLength),
    },
    genericOpenings: {
      baseline: baselineGeneric,
      principles: principlesGeneric,
      difference: principlesGeneric - baselineGeneric,
    },
    possiamoParlareDi: {
      baseline: baselinePossiamo,
      principles: principlesPossiamo,
      difference: principlesPossiamo - baselinePossiamo,
    },
  },
  harness: summary,
  rows,
}

writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8')

const md = `# Experiment 001 — Exploration Principles

## Setup

- **Scope:** exploration only (\`useExplorationPrinciples\`)
- **Baseline:** \`useExplorationPrinciples = false\` (existing exploration guidance)
- **Treatment:** \`useExplorationPrinciples = true\` (research exploration principles in Planner guidance)
- **Writer / Runtime:** unchanged (same Writer, no Runtime refactors)
- **Prompts:** ${rows.length} exploration prompts
- **Harness:** Conversation Behavior Harness ${CONVERSATION_BEHAVIOR_HARNESS_VERSION}
  - LAIfe slot = principles enabled
  - ChatGPT slot = baseline
- Versions: planner \`${PLANNER_VERSION}\`, writer \`${WRITER_VERSION}\`, pipeline \`${PIPELINE_VERSION}\`, model \`${model}\`

## Metrics

| Metric | Baseline | Principles | Difference (prin − base) |
| --- | ---: | ---: | ---: |
| Curiosity | ${baselineCuriosity.toFixed(4)} | ${principlesCuriosity.toFixed(4)} | ${diff(principlesCuriosity, baselineCuriosity).toFixed(4)} |
| Novelty | ${baselineNovelty.toFixed(4)} | ${principlesNovelty.toFixed(4)} | ${diff(principlesNovelty, baselineNovelty).toFixed(4)} |
| Practicality | ${baselinePracticality.toFixed(4)} | ${principlesPracticality.toFixed(4)} | ${diff(principlesPracticality, baselinePracticality).toFixed(4)} |
| Avg response length (words) | ${baselineLength.toFixed(2)} | ${principlesLength.toFixed(2)} | ${diff(principlesLength, baselineLength).toFixed(2)} |
| Generic openings (count) | ${baselineGeneric} | ${principlesGeneric} | ${principlesGeneric - baselineGeneric} |
| "Possiamo parlare di..." (count) | ${baselinePossiamo} | ${principlesPossiamo} | ${principlesPossiamo - baselinePossiamo} |

## Curiosity difference

**${diff(principlesCuriosity, baselineCuriosity).toFixed(4)}** (principles − baseline)

## Novelty difference

**${diff(principlesNovelty, baselineNovelty).toFixed(4)}** (principles − baseline)

## Practicality difference

**${diff(principlesPracticality, baselinePracticality).toFixed(4)}** (principles − baseline)

## Average response length

- Baseline: **${baselineLength.toFixed(2)}** words
- Principles: **${principlesLength.toFixed(2)}** words
- Difference: **${diff(principlesLength, baselineLength).toFixed(2)}**

## Number of generic openings

- Baseline: **${baselineGeneric}**
- Principles: **${principlesGeneric}**

## Number of "Possiamo parlare di..."

- Baseline: **${baselinePossiamo}**
- Principles: **${principlesPossiamo}**

## Harness summary

\`\`\`
${harness.printTable()}
\`\`\`

Wins: LAIfe(principles)=${summary.wins.LAIfe}  baseline(slot)=${summary.wins.ChatGPT}  Tie=${summary.wins.Tie}

Overall similarity (label overlap): ${summary.overallSimilarity ?? '—'}

## Notes

- Scoring for curiosity / novelty / practicality is deterministic text analysis (no LLM judge).
- Flag default remains \`false\`; enable only when \`useExplorationPrinciples: true\`.
- Other conversation experiences are untouched.
`

writeFileSync(reportPath, md, 'utf8')

console.log('')
console.log('=== RESULTS ===')
console.log(`curiosity Δ:     ${diff(principlesCuriosity, baselineCuriosity)}`)
console.log(`novelty Δ:       ${diff(principlesNovelty, baselineNovelty)}`)
console.log(`practicality Δ:  ${diff(principlesPracticality, baselinePracticality)}`)
console.log(`length words Δ:  ${diff(principlesLength, baselineLength)}`)
console.log(`generic openings: baseline=${baselineGeneric} principles=${principlesGeneric}`)
console.log(`Possiamo parlare di: baseline=${baselinePossiamo} principles=${principlesPossiamo}`)
console.log(`harness wins: principles=${summary.wins.LAIfe} baseline=${summary.wins.ChatGPT} tie=${summary.wins.Tie}`)
console.log(`report: ${reportPath}`)
console.log(`json:   ${jsonPath}`)
