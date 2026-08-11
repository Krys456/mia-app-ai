#!/usr/bin/env node
/**
 * Experiment 003 — Planning Principles in Planner guidance
 *
 * Baseline (usePlanningPrinciples=false)
 *   vs
 * Principles (usePlanningPrinciples=true)
 *
 * Same Writer. Planning prompts only. Conversation Behavior Harness.
 * Lead with an actionable plan instead of explanation.
 *
 * Usage:
 *   node research/conversation-intelligence/experiments/003-planning-principles/run.mjs
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
  console.error('OPENAI_API_KEY missing — cannot run Experiment 003')
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
      usePlanningPrinciples: false,
    }),
})
const pipelinePrinciples = createPipeline({
  writer: writerPrinciples,
  personalityFoundation: DEFAULT_FOUNDATION,
  planFn: (input) =>
    plan({
      ...input,
      useConversationExperience: true,
      usePlanningPrinciples: true,
    }),
})

/** ≥25 planning prompts (includes requested examples + cue-matched variants). */
const PROMPTS = [
  'What should I do now?',
  'Help me organize my day.',
  "I don't know where to start.",
  'Help me plan fixing three bugs.',
  'How should I study today?',
  'Help me prioritize.',
  'I have one hour — plan it.',
  'Create a plan to improve LAIfe.',
  'My next step?',
  'Create a work plan.',
  'Pianifichiamo la giornata.',
  'Cosa facciamo oggi?',
  'Aiutami a prioritizzare.',
  'Organiziamo il lavoro.',
  'Dammi un piano.',
  'Qual è il prossimo passo?',
  'Help me plan my week.',
  'I need a roadmap.',
  'Plan my morning.',
  'Cosa faccio adesso?',
  'Organize these tasks for today.',
  'Help me prioritize my todos.',
  'Build a study plan.',
  'Prioritize my bugs.',
  'Make a plan for LAIfe.',
  'Prossimo passo sul progetto.',
  'Help me sequence the work.',
]

const GENERIC_INTRO_RE =
  /^(certo[!.,\s]*|assolutamente[!.,\s]*|ottima (domanda|idea)[!.,\s]*|great (question|idea)[!.,\s]*|sure[!.,\s]*|of course[!.,\s]*|let'?s (think|start by talking)|puoi farcela|you('ve| have) got this|motivati|stay motivated)/i
const ACTION_RE =
  /\b(first|start (by|with)|step\s*1|1[).:]|apri|open|write|scriv|lista|list|fix|riproduci|block|calendar|agenda|set a timer|imposta|apri il|open the|do this|fai questo|inizia|begin)\b/i
const MOTIVATION_RE =
  /^(you can do this|you'?ve got this|puoi farcela|credici|stay positive|non mollare)/im
const OPTION_LIST_RE =
  /(opzione\s*[abc]|option\s*[abc]|^\s*[-•]\s+.+\n\s*[-•]\s+.+\n\s*[-•]\s+.+\n\s*[-•])/im
const RECOMMEND_RE =
  /\b(do this first|inizia (con|da)|start with|raccomand|recommend|priorit[àa]|priority|next step|prossimo passo|first action)\b/i

/**
 * Extract content words from a user prompt for goal-repeat detection.
 * @param {string} prompt
 * @returns {string[]}
 */
function goalTokens(prompt) {
  const stop = new Set([
    'a', 'an', 'the', 'i', 'me', 'my', 'to', 'do', 'now', 'what', 'should', 'help',
    'me', 'how', 'is', 'for', 'it', 'and', 'or', 'of', 'in', 'on', 'with', 'have',
    'don', 't', 'know', 'where', 'un', 'una', 'il', 'la', 'di', 'da', 'per', 'che',
    'cosa', 'qual', 'mi', 'ho', 'non', 'so',
  ])
  return String(prompt || '')
    .toLowerCase()
    .replace(/[^a-zàèéìòù0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w))
}

/**
 * Deterministic scorers for planning response quality.
 * @param {string} text
 * @param {string} prompt
 */
function scoreMetrics(text, prompt) {
  const t = String(text || '').trim()
  const words = t.split(/\s+/).filter(Boolean)
  const sentences = t.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean)
  const firstSentence = sentences[0] || ''
  const hasGenericIntro = GENERIC_INTRO_RE.test(t) || MOTIVATION_RE.test(t) ? 1 : 0

  // First actionable step latency = word index of first action cue (lower better).
  // If none found, latency = word count (worst).
  let firstActionWordIndex = words.length
  for (let i = 0; i < words.length; i += 1) {
    const window = words.slice(i, i + 6).join(' ')
    if (ACTION_RE.test(window) || /^\d+[).:]/.test(words[i])) {
      firstActionWordIndex = i
      break
    }
  }
  const firstActionLatency =
    words.length > 0 ? Number((firstActionWordIndex / words.length).toFixed(4)) : 1

  // Repeated user goal: early sentences echo prompt tokens heavily
  const tokens = goalTokens(prompt)
  const early = words.slice(0, Math.min(24, words.length)).join(' ').toLowerCase()
  let echoHits = 0
  for (const tok of tokens) {
    if (tok.length >= 4 && early.includes(tok)) echoHits += 1
  }
  const repeatedUserGoal =
    tokens.length > 0 && echoHits / tokens.length >= 0.6 && hasGenericIntro
      ? 1
      : tokens.length >= 2 &&
          echoHits >= 2 &&
          /^(you want|vuoi|il tuo obiettivo|your goal|so you want)/i.test(firstSentence)
        ? 1
        : 0

  // Practicality
  let practicality = 0.3
  if (firstActionWordIndex <= 8) practicality += 0.25
  else if (firstActionWordIndex <= 20) practicality += 0.12
  if (ACTION_RE.test(t)) practicality += 0.15
  if (RECOMMEND_RE.test(t)) practicality += 0.12
  if (hasGenericIntro) practicality -= 0.15
  if (OPTION_LIST_RE.test(t) && !RECOMMEND_RE.test(t)) practicality -= 0.15

  // Clarity
  let clarity = 0.35
  if (!hasGenericIntro) clarity += 0.15
  if (firstActionWordIndex <= 12) clarity += 0.15
  const avgSentenceLen =
    sentences.length > 0
      ? sentences.reduce((s, x) => s + x.split(/\s+/).length, 0) / sentences.length
      : words.length
  if (avgSentenceLen > 0 && avgSentenceLen <= 16) clarity += 0.12
  if (avgSentenceLen > 26) clarity -= 0.1
  if (/^(1[).:]|step\s*1|first[,:])/i.test(t.trim())) clarity += 0.1

  // Recommendation quality
  let recommendationQuality = 0.25
  if (RECOMMEND_RE.test(t) || firstActionWordIndex <= 10) recommendationQuality += 0.3
  if (/\b(then|poi|next|dopo|2[).:]|step\s*2)\b/i.test(t)) recommendationQuality += 0.15
  if (OPTION_LIST_RE.test(t) && !RECOMMEND_RE.test(t)) recommendationQuality -= 0.25
  if (hasGenericIntro) recommendationQuality -= 0.1
  if (repeatedUserGoal) recommendationQuality -= 0.1

  const clamp = (n) => Math.max(0, Math.min(1, Number(n.toFixed(4))))
  return {
    practicality: clamp(practicality),
    clarity: clamp(clarity),
    firstActionLatency,
    firstActionWordIndex,
    recommendationQuality: clamp(recommendationQuality),
    lengthChars: t.length,
    lengthWords: words.length,
    hasGenericIntro,
    repeatedUserGoal,
  }
}

/**
 * @param {any} planResult
 * @param {string} text
 * @param {ReturnType<typeof scoreMetrics>} metrics
 */
function labelsFromTurn(planResult, text, metrics) {
  const guidance = planResult?.experienceGuidance?.directives || []
  const principlesOn = guidance.some((d) => /first concrete action/i.test(String(d)))
  const hasQ = /\?/.test(text)
  return {
    turnType: /** @type {const} */ ('planning'),
    strategy: principlesOn ? /** @type {const} */ ('simplify') : /** @type {const} */ ('expand'),
    move: /** @type {const} */ ('practical_step'),
    initiative: principlesOn || metrics.firstActionLatency <= 0.25
      ? /** @type {const} */ ('high')
      : /** @type {const} */ ('medium'),
    question: hasQ,
    opening: metrics.hasGenericIntro
      ? /** @type {const} */ ('friendly')
      : /** @type {const} */ ('direct'),
    closing: hasQ ? /** @type {const} */ ('question') : /** @type {const} */ ('proposal'),
    depth: metrics.lengthWords > 80 ? /** @type {const} */ ('medium') : /** @type {const} */ ('short'),
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
  `Experiment 003 — Planning Principles | planner ${PLANNER_VERSION} | writer ${WRITER_VERSION} | pipeline ${PIPELINE_VERSION} | harness ${CONVERSATION_BEHAVIOR_HARNESS_VERSION} | model ${model}`,
)
console.log(`prompts: ${PROMPTS.length}`)
console.log('baseline  = usePlanningPrinciples=false')
console.log('principles= usePlanningPrinciples=true')
console.log('')

const harness = createConversationBehaviorHarness()

/** @type {any[]} */
const rows = []

for (let i = 0; i < PROMPTS.length; i += 1) {
  const prompt = PROMPTS[i]
  const id = `plan-${String(i + 1).padStart(2, '0')}`
  const messages = [{ role: 'user', content: prompt }]
  const experience = evaluateConversationExperience(messages)
  if (experience.experience !== 'planning') {
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
  const baseMetrics = scoreMetrics(baseText, prompt)
  const prinMetrics = scoreMetrics(prinText, prompt)

  const baseLabels = labelsFromTurn(baseOut.plan, baseText, baseMetrics)
  const prinLabels = labelsFromTurn(prinOut.plan, prinText, prinMetrics)

  const caseId = harness.addCase({
    id,
    input: prompt,
    laifeResponse: prinText,
    chatgptResponse: baseText,
    notes: 'LAIfe=planning-principles ChatGPT-slot=baseline',
  })

  // Lower firstActionLatency is better — invert for composite score.
  const prinScore =
    prinMetrics.practicality +
    prinMetrics.clarity +
    prinMetrics.recommendationQuality +
    (1 - prinMetrics.firstActionLatency) -
    prinMetrics.hasGenericIntro * 0.25 -
    prinMetrics.repeatedUserGoal * 0.2
  const baseScore =
    baseMetrics.practicality +
    baseMetrics.clarity +
    baseMetrics.recommendationQuality +
    (1 - baseMetrics.firstActionLatency) -
    baseMetrics.hasGenericIntro * 0.25 -
    baseMetrics.repeatedUserGoal * 0.2

  let winner = 'Tie'
  if (prinScore > baseScore + 0.08) winner = 'LAIfe'
  else if (baseScore > prinScore + 0.08) winner = 'ChatGPT'

  harness.rate(caseId, {
    ...prinLabels,
    winner,
    chatgpt: baseLabels,
    notes: `Δprac=${(prinMetrics.practicality - baseMetrics.practicality).toFixed(3)} Δlat=${(prinMetrics.firstActionLatency - baseMetrics.firstActionLatency).toFixed(3)}`,
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

const baselinePracticality = avg(rows.map((r) => r.baseline.practicality))
const principlesPracticality = avg(rows.map((r) => r.principles.practicality))
const baselineClarity = avg(rows.map((r) => r.baseline.clarity))
const principlesClarity = avg(rows.map((r) => r.principles.clarity))
const baselineLatency = avg(rows.map((r) => r.baseline.firstActionLatency))
const principlesLatency = avg(rows.map((r) => r.principles.firstActionLatency))
const baselineLength = avg(rows.map((r) => r.baseline.lengthWords))
const principlesLength = avg(rows.map((r) => r.principles.lengthWords))
const baselineGeneric = rows.reduce((s, r) => s + r.baseline.hasGenericIntro, 0)
const principlesGeneric = rows.reduce((s, r) => s + r.principles.hasGenericIntro, 0)
const baselineRepeat = rows.reduce((s, r) => s + r.baseline.repeatedUserGoal, 0)
const principlesRepeat = rows.reduce((s, r) => s + r.principles.repeatedUserGoal, 0)
const baselineRec = avg(rows.map((r) => r.baseline.recommendationQuality))
const principlesRec = avg(rows.map((r) => r.principles.recommendationQuality))

const diff = (a, b) => Number((a - b).toFixed(4))

const payload = {
  experiment: '003-planning-principles',
  plannerVersion: PLANNER_VERSION,
  writerVersion: WRITER_VERSION,
  pipelineVersion: PIPELINE_VERSION,
  harnessVersion: CONVERSATION_BEHAVIOR_HARNESS_VERSION,
  model,
  prompts: rows.length,
  metrics: {
    practicality: {
      baseline: baselinePracticality,
      principles: principlesPracticality,
      difference: diff(principlesPracticality, baselinePracticality),
    },
    clarity: {
      baseline: baselineClarity,
      principles: principlesClarity,
      difference: diff(principlesClarity, baselineClarity),
    },
    firstActionableStepLatency: {
      baseline: baselineLatency,
      principles: principlesLatency,
      difference: diff(principlesLatency, baselineLatency),
      note: 'fraction of response before first action cue; lower is better',
    },
    averageResponseLengthWords: {
      baseline: baselineLength,
      principles: principlesLength,
      difference: diff(principlesLength, baselineLength),
    },
    genericIntroductions: {
      baseline: baselineGeneric,
      principles: principlesGeneric,
      difference: principlesGeneric - baselineGeneric,
    },
    repeatedUserGoal: {
      baseline: baselineRepeat,
      principles: principlesRepeat,
      difference: principlesRepeat - baselineRepeat,
    },
    recommendationQuality: {
      baseline: baselineRec,
      principles: principlesRec,
      difference: diff(principlesRec, baselineRec),
    },
  },
  harness: summary,
  rows,
}

writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8')

const md = `# Experiment 003 — Planning Principles

## Setup

- **Scope:** planning only (\`usePlanningPrinciples\`)
- **Baseline:** \`usePlanningPrinciples = false\` (existing planning guidance)
- **Treatment:** \`usePlanningPrinciples = true\` (actionable-plan principles in Planner guidance)
- **Writer / Runtime:** unchanged (same Writer, no Runtime refactors)
- **Prompts:** ${rows.length} planning prompts
- **Harness:** Conversation Behavior Harness ${CONVERSATION_BEHAVIOR_HARNESS_VERSION}
  - LAIfe slot = principles enabled
  - ChatGPT slot = baseline
- Versions: planner \`${PLANNER_VERSION}\`, writer \`${WRITER_VERSION}\`, pipeline \`${PIPELINE_VERSION}\`, model \`${model}\`

## Metrics

| Metric | Baseline | Principles | Difference (prin − base) |
| --- | ---: | ---: | ---: |
| Practicality | ${baselinePracticality.toFixed(4)} | ${principlesPracticality.toFixed(4)} | ${diff(principlesPracticality, baselinePracticality).toFixed(4)} |
| Clarity | ${baselineClarity.toFixed(4)} | ${principlesClarity.toFixed(4)} | ${diff(principlesClarity, baselineClarity).toFixed(4)} |
| First actionable step latency | ${baselineLatency.toFixed(4)} | ${principlesLatency.toFixed(4)} | ${diff(principlesLatency, baselineLatency).toFixed(4)} |
| Avg response length (words) | ${baselineLength.toFixed(2)} | ${principlesLength.toFixed(2)} | ${diff(principlesLength, baselineLength).toFixed(2)} |
| Generic introductions (count) | ${baselineGeneric} | ${principlesGeneric} | ${principlesGeneric - baselineGeneric} |
| Repeated user goal (count) | ${baselineRepeat} | ${principlesRepeat} | ${principlesRepeat - baselineRepeat} |
| Recommendation quality | ${baselineRec.toFixed(4)} | ${principlesRec.toFixed(4)} | ${diff(principlesRec, baselineRec).toFixed(4)} |

## Practicality difference

**${diff(principlesPracticality, baselinePracticality).toFixed(4)}** (principles − baseline)

## Clarity difference

**${diff(principlesClarity, baselineClarity).toFixed(4)}** (principles − baseline)

## First actionable step latency

- Baseline: **${baselineLatency.toFixed(4)}** (fraction of response before first action; lower is better)
- Principles: **${principlesLatency.toFixed(4)}**
- Difference: **${diff(principlesLatency, baselineLatency).toFixed(4)}**

## Average response length

- Baseline: **${baselineLength.toFixed(2)}** words
- Principles: **${principlesLength.toFixed(2)}** words
- Difference: **${diff(principlesLength, baselineLength).toFixed(2)}**

## Number of generic introductions

- Baseline: **${baselineGeneric}**
- Principles: **${principlesGeneric}**

## Number of repeated user goal

- Baseline: **${baselineRepeat}**
- Principles: **${principlesRepeat}**

## Recommendation quality difference

**${diff(principlesRec, baselineRec).toFixed(4)}** (principles − baseline)

## Harness summary

\`\`\`
${harness.printTable()}
\`\`\`

Wins: LAIfe(principles)=${summary.wins.LAIfe}  baseline(slot)=${summary.wins.ChatGPT}  Tie=${summary.wins.Tie}

Overall similarity (label overlap): ${summary.overallSimilarity ?? '—'}

## Notes

- Scoring for practicality / clarity / latency / recommendation quality is deterministic text analysis (no LLM judge).
- First actionable step latency is the fraction of words before the first action cue; lower is better.
- Flag default remains \`false\`; enable only when \`usePlanningPrinciples: true\`.
- Other conversation experiences are untouched.
`

writeFileSync(reportPath, md, 'utf8')

console.log('')
console.log('=== RESULTS ===')
console.log(`practicality Δ:  ${diff(principlesPracticality, baselinePracticality)}`)
console.log(`clarity Δ:       ${diff(principlesClarity, baselineClarity)}`)
console.log(`first-action latency Δ: ${diff(principlesLatency, baselineLatency)} (lower better)`)
console.log(`length words Δ:  ${diff(principlesLength, baselineLength)}`)
console.log(`generic intros:  baseline=${baselineGeneric} principles=${principlesGeneric}`)
console.log(`repeated goal:   baseline=${baselineRepeat} principles=${principlesRepeat}`)
console.log(`recommendation Δ:${diff(principlesRec, baselineRec)}`)
console.log(`harness wins: principles=${summary.wins.LAIfe} baseline=${summary.wins.ChatGPT} tie=${summary.wins.Tie}`)
console.log(`report: ${reportPath}`)
console.log(`json:   ${jsonPath}`)
