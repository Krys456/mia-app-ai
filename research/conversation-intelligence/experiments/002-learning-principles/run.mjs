#!/usr/bin/env node
/**
 * Experiment 002 — Learning Principles in Planner guidance
 *
 * Baseline (useLearningPrinciples=false)
 *   vs
 * Principles (useLearningPrinciples=true)
 *
 * Same Writer. Learning prompts only. Conversation Behavior Harness.
 * Concept → Why → Example progression.
 *
 * Usage:
 *   node research/conversation-intelligence/experiments/002-learning-principles/run.mjs
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
  console.error('OPENAI_API_KEY missing — cannot run Experiment 002')
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
      useLearningPrinciples: false,
    }),
})
const pipelinePrinciples = createPipeline({
  writer: writerPrinciples,
  personalityFoundation: DEFAULT_FOUNDATION,
  planFn: (input) =>
    plan({
      ...input,
      useConversationExperience: true,
      useLearningPrinciples: true,
    }),
})

/** ≥25 learning prompts (includes requested examples). */
const PROMPTS = [
  'What is entropy?',
  'Explain blockchain.',
  'What is RAM?',
  'What is IoT?',
  'What is circular economy?',
  'What is a heat pump?',
  'What is quantum computing?',
  'What is an API?',
  'What is DNS?',
  'Explain photosynthesis.',
  'Spiegami la fotosintesi.',
  'Cosa significa latenza?',
  'Come funziona HTTP?',
  'What is recursion?',
  'Teach me about neural networks',
  'Explain TCP.',
  "Spiegami cos'è la RAM.",
  'What is OAuth?',
  'Explain DNS simply.',
  'What is machine learning?',
  'What is a database?',
  'What is encryption?',
  'Explain how batteries work.',
  'What is a compiler?',
  'Come funziona un heat pump?',
  'What are APIs?',
  'Explain entropy.',
]

const GENERIC_OPENING_RE =
  /^(certo[!.,\s]*|assolutamente[!.,\s]*|ottima domanda[!.,\s]*|great question[!.,\s]*|sure[!.,\s]*|of course[!.,\s]*|let me explain[!.,\s]*|ti spiego[!.,\s]*)/i
const EXAMPLE_RE =
  /\b(for example|e\.g\.|eg\.|ad esempio|per esempio|like when|come quando|in pratica|real[- ]world|nel mondo reale|imagine|immagina)\b/i
const DEFINITION_RE =
  /\b(is|are|means|è|sono|significa|si riferisce|refers to|defined as)\b/i
const WHY_RE =
  /\b(why|perché|perche|matters|importante|counts|utile|useful|so that|così)\b/i
const MULTI_EXAMPLE_RE =
  /\b(for example[\s\S]{0,120}for example|ad esempio[\s\S]{0,120}ad esempio|another example|un altro esempio|examples include)\b/i

/**
 * Deterministic 0..1 scorers for learning response quality.
 * @param {string} text
 */
function scoreMetrics(text) {
  const t = String(text || '').trim()
  const lower = t.toLowerCase()
  const words = t.split(/\s+/).filter(Boolean)
  const sentences = t.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean)
  const firstSentence = sentences[0] || ''
  const hasExample = EXAMPLE_RE.test(t)
  const hasDefinition = DEFINITION_RE.test(t)
  const hasWhy = WHY_RE.test(t)
  const definitionWithoutExample = hasDefinition && !hasExample ? 1 : 0
  const hasGenericOpening = GENERIC_OPENING_RE.test(t) ? 1 : 0
  const asksBeforeAnswer =
    (t.indexOf('?') >= 0 && t.indexOf('?') < Math.min(40, t.length / 3)) ||
    /^(what|which|vuoi|dimmi|can you|do you)\b/i.test(firstSentence)

  // Clarity: direct answer first, short sentences, no long intro fluff
  let clarity = 0.35
  if (!hasGenericOpening) clarity += 0.12
  if (!asksBeforeAnswer) clarity += 0.12
  if (DEFINITION_RE.test(firstSentence) || /^(it|a |an |la |il |un )/i.test(firstSentence)) {
    clarity += 0.15
  }
  const avgSentenceLen =
    sentences.length > 0
      ? sentences.reduce((s, x) => s + x.split(/\s+/).length, 0) / sentences.length
      : words.length
  if (avgSentenceLen > 0 && avgSentenceLen <= 18) clarity += 0.12
  if (avgSentenceLen > 28) clarity -= 0.1
  if (/^(certo|assolutamente|ottima domanda|great question)/i.test(t)) clarity -= 0.15

  // Depth: concept + why + example progression
  let depth = 0.2
  if (hasDefinition) depth += 0.2
  if (hasWhy) depth += 0.2
  if (hasExample) depth += 0.25
  if (hasDefinition && hasWhy && hasExample) depth += 0.1
  if (MULTI_EXAMPLE_RE.test(t)) depth -= 0.08
  if (words.length < 12) depth -= 0.1

  // Curiosity: light hook after value, not quiz-first
  let curiosity = 0.3
  if (/\?/.test(t) && !asksBeforeAnswer) curiosity += 0.15
  if (/\b(curios|interesting|interessante|notice|nota che)\b/i.test(t)) curiosity += 0.15
  if (asksBeforeAnswer) curiosity -= 0.12
  if (hasExample) curiosity += 0.1

  // Practicality: grounded example / actionable framing
  let practicality = 0.25
  if (hasExample) practicality += 0.25
  if (/\b(use|usi|usare|everyday|quotidiano|device|dispositivo|when you|quando)\b/i.test(t)) {
    practicality += 0.15
  }
  if (definitionWithoutExample) practicality -= 0.12

  const clamp = (n) => Math.max(0, Math.min(1, Number(n.toFixed(4))))
  return {
    clarity: clamp(clarity),
    depth: clamp(depth),
    curiosity: clamp(curiosity),
    practicality: clamp(practicality),
    lengthChars: t.length,
    lengthWords: words.length,
    hasGenericOpening,
    definitionWithoutExample,
    hasExample: hasExample ? 1 : 0,
    multiExample: MULTI_EXAMPLE_RE.test(t) ? 1 : 0,
  }
}

/**
 * @param {any} planResult
 * @param {string} text
 * @param {ReturnType<typeof scoreMetrics>} metrics
 */
function labelsFromTurn(planResult, text, metrics) {
  const guidance = planResult?.experienceGuidance?.directives || []
  const principlesOn = guidance.some((d) => /real-world example/i.test(String(d)))
  const hasQ = /\?/.test(text)
  return {
    turnType: /** @type {const} */ ('learning'),
    strategy: principlesOn ? /** @type {const} */ ('example') : /** @type {const} */ ('simplify'),
    move: metrics.hasExample
      ? /** @type {const} */ ('real_world_example')
      : /** @type {const} */ ('definition'),
    initiative: /** @type {const} */ ('medium'),
    question: hasQ,
    opening: metrics.hasGenericOpening
      ? /** @type {const} */ ('friendly')
      : /** @type {const} */ ('direct'),
    closing: hasQ ? /** @type {const} */ ('question') : /** @type {const} */ ('statement'),
    depth:
      metrics.depth >= 0.7
        ? /** @type {const} */ ('medium')
        : metrics.depth >= 0.45
          ? /** @type {const} */ ('short')
          : /** @type {const} */ ('minimal'),
    energy: /** @type {const} */ ('medium'),
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
  `Experiment 002 — Learning Principles | planner ${PLANNER_VERSION} | writer ${WRITER_VERSION} | pipeline ${PIPELINE_VERSION} | harness ${CONVERSATION_BEHAVIOR_HARNESS_VERSION} | model ${model}`,
)
console.log(`prompts: ${PROMPTS.length}`)
console.log('baseline  = useLearningPrinciples=false')
console.log('principles= useLearningPrinciples=true')
console.log('')

const harness = createConversationBehaviorHarness()

/** @type {any[]} */
const rows = []

for (let i = 0; i < PROMPTS.length; i += 1) {
  const prompt = PROMPTS[i]
  const id = `learn-${String(i + 1).padStart(2, '0')}`
  const messages = [{ role: 'user', content: prompt }]
  const experience = evaluateConversationExperience(messages)
  if (experience.experience !== 'learning') {
    console.warn(`skip ${id}: experience=${experience.experience} for "${prompt}"`)
    continue
  }

  process.stdout.write(`… ${id} ${prompt.slice(0, 48)}\n`)

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
    notes: 'LAIfe=learning-principles ChatGPT-slot=baseline',
  })

  const prinScore =
    prinMetrics.clarity +
    prinMetrics.depth +
    prinMetrics.curiosity * 0.5 +
    prinMetrics.practicality -
    prinMetrics.definitionWithoutExample * 0.35 -
    prinMetrics.hasGenericOpening * 0.2
  const baseScore =
    baseMetrics.clarity +
    baseMetrics.depth +
    baseMetrics.curiosity * 0.5 +
    baseMetrics.practicality -
    baseMetrics.definitionWithoutExample * 0.35 -
    baseMetrics.hasGenericOpening * 0.2

  let winner = 'Tie'
  if (prinScore > baseScore + 0.08) winner = 'LAIfe'
  else if (baseScore > prinScore + 0.08) winner = 'ChatGPT'

  harness.rate(caseId, {
    ...prinLabels,
    winner,
    chatgpt: baseLabels,
    notes: `Δclarity=${(prinMetrics.clarity - baseMetrics.clarity).toFixed(3)} Δdepth=${(prinMetrics.depth - baseMetrics.depth).toFixed(3)}`,
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

const baselineClarity = avg(rows.map((r) => r.baseline.clarity))
const principlesClarity = avg(rows.map((r) => r.principles.clarity))
const baselineDepth = avg(rows.map((r) => r.baseline.depth))
const principlesDepth = avg(rows.map((r) => r.principles.depth))
const baselineCuriosity = avg(rows.map((r) => r.baseline.curiosity))
const principlesCuriosity = avg(rows.map((r) => r.principles.curiosity))
const baselinePracticality = avg(rows.map((r) => r.baseline.practicality))
const principlesPracticality = avg(rows.map((r) => r.principles.practicality))
const baselineLength = avg(rows.map((r) => r.baseline.lengthWords))
const principlesLength = avg(rows.map((r) => r.principles.lengthWords))
const baselineGeneric = rows.reduce((s, r) => s + r.baseline.hasGenericOpening, 0)
const principlesGeneric = rows.reduce((s, r) => s + r.principles.hasGenericOpening, 0)
const baselineDefNoEx = rows.reduce((s, r) => s + r.baseline.definitionWithoutExample, 0)
const principlesDefNoEx = rows.reduce((s, r) => s + r.principles.definitionWithoutExample, 0)

const diff = (a, b) => Number((a - b).toFixed(4))

const payload = {
  experiment: '002-learning-principles',
  plannerVersion: PLANNER_VERSION,
  writerVersion: WRITER_VERSION,
  pipelineVersion: PIPELINE_VERSION,
  harnessVersion: CONVERSATION_BEHAVIOR_HARNESS_VERSION,
  model,
  prompts: rows.length,
  metrics: {
    clarity: {
      baseline: baselineClarity,
      principles: principlesClarity,
      difference: diff(principlesClarity, baselineClarity),
    },
    depth: {
      baseline: baselineDepth,
      principles: principlesDepth,
      difference: diff(principlesDepth, baselineDepth),
    },
    curiosity: {
      baseline: baselineCuriosity,
      principles: principlesCuriosity,
      difference: diff(principlesCuriosity, baselineCuriosity),
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
    definitionsWithoutExamples: {
      baseline: baselineDefNoEx,
      principles: principlesDefNoEx,
      difference: principlesDefNoEx - baselineDefNoEx,
    },
  },
  harness: summary,
  rows,
}

writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8')

const md = `# Experiment 002 — Learning Principles

## Setup

- **Scope:** learning only (\`useLearningPrinciples\`)
- **Baseline:** \`useLearningPrinciples = false\` (existing learning guidance)
- **Treatment:** \`useLearningPrinciples = true\` (Concept → Why → Example principles in Planner guidance)
- **Writer / Runtime / API:** unchanged (same Writer, no Runtime/API refactors)
- **Prompts:** ${rows.length} learning prompts
- **Harness:** Conversation Behavior Harness ${CONVERSATION_BEHAVIOR_HARNESS_VERSION}
  - LAIfe slot = principles enabled
  - ChatGPT slot = baseline
- Versions: planner \`${PLANNER_VERSION}\`, writer \`${WRITER_VERSION}\`, pipeline \`${PIPELINE_VERSION}\`, model \`${model}\`

## Principles (treatment)

- Start by answering the user's question directly.
- Explain the core concept in simple language.
- Explain why it matters.
- Give one concrete real-world example.
- Only then ask a follow-up question if it genuinely helps.

### Avoid

- Long introductions.
- Definitions without examples.
- Multiple examples.
- Asking questions before answering.

## Metrics

| Metric | Baseline | Principles | Difference (prin − base) |
| --- | ---: | ---: | ---: |
| Clarity | ${baselineClarity.toFixed(4)} | ${principlesClarity.toFixed(4)} | ${diff(principlesClarity, baselineClarity).toFixed(4)} |
| Depth | ${baselineDepth.toFixed(4)} | ${principlesDepth.toFixed(4)} | ${diff(principlesDepth, baselineDepth).toFixed(4)} |
| Curiosity | ${baselineCuriosity.toFixed(4)} | ${principlesCuriosity.toFixed(4)} | ${diff(principlesCuriosity, baselineCuriosity).toFixed(4)} |
| Practicality | ${baselinePracticality.toFixed(4)} | ${principlesPracticality.toFixed(4)} | ${diff(principlesPracticality, baselinePracticality).toFixed(4)} |
| Avg response length (words) | ${baselineLength.toFixed(2)} | ${principlesLength.toFixed(2)} | ${diff(principlesLength, baselineLength).toFixed(2)} |
| Generic openings (count) | ${baselineGeneric} | ${principlesGeneric} | ${principlesGeneric - baselineGeneric} |
| Definitions without examples (count) | ${baselineDefNoEx} | ${principlesDefNoEx} | ${principlesDefNoEx - baselineDefNoEx} |

## Clarity difference

**${diff(principlesClarity, baselineClarity).toFixed(4)}** (principles − baseline)

## Depth difference

**${diff(principlesDepth, baselineDepth).toFixed(4)}** (principles − baseline)

## Curiosity difference

**${diff(principlesCuriosity, baselineCuriosity).toFixed(4)}** (principles − baseline)

## Practicality difference

**${diff(principlesPracticality, baselinePracticality).toFixed(4)}** (principles − baseline)

## Average response length

- Baseline: **${baselineLength.toFixed(2)}** words
- Principles: **${principlesLength.toFixed(2)}** words
- Difference: **${diff(principlesLength, baselineLength).toFixed(2)}**

## Number of generic openings

- Baseline: **${baselineGeneric}**
- Principles: **${principlesGeneric}**

## Number of definitions without examples

- Baseline: **${baselineDefNoEx}**
- Principles: **${principlesDefNoEx}**

## Harness summary

\`\`\`
${harness.printTable()}
\`\`\`

Wins: LAIfe(principles)=${summary.wins.LAIfe}  baseline(slot)=${summary.wins.ChatGPT}  Tie=${summary.wins.Tie}

Overall similarity (label overlap): ${summary.overallSimilarity ?? '—'}

## Notes

- Scoring for clarity / depth / curiosity / practicality is deterministic text analysis (no LLM judge).
- Flag default remains \`false\`; enable only when \`useLearningPrinciples: true\`.
- Other conversation experiences are untouched.
`

writeFileSync(reportPath, md, 'utf8')

console.log('')
console.log('=== RESULTS ===')
console.log(`clarity Δ:       ${diff(principlesClarity, baselineClarity)}`)
console.log(`depth Δ:         ${diff(principlesDepth, baselineDepth)}`)
console.log(`curiosity Δ:     ${diff(principlesCuriosity, baselineCuriosity)}`)
console.log(`practicality Δ:  ${diff(principlesPracticality, baselinePracticality)}`)
console.log(`length words Δ:  ${diff(principlesLength, baselineLength)}`)
console.log(`generic openings: baseline=${baselineGeneric} principles=${principlesGeneric}`)
console.log(`def without ex:   baseline=${baselineDefNoEx} principles=${principlesDefNoEx}`)
console.log(`harness wins: principles=${summary.wins.LAIfe} baseline=${summary.wins.ChatGPT} tie=${summary.wins.Tie}`)
console.log(`report: ${reportPath}`)
console.log(`json:   ${jsonPath}`)
