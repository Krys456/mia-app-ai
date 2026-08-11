/**
 * Conversation Intelligence — extract conversational principles (research only).
 *
 * Deterministic statistical inference over research datasets.
 * No LLM. No Writer / Planner / Runtime / API wiring.
 */

import { writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

import {
  DEFAULT_DATASET_DIR,
  analyzeDatasetFile,
  average,
  listDatasetFiles,
  rankDistribution,
} from './analyze-dataset.js'

export const EXTRACT_PRINCIPLES_VERSION = '0.1.0-extract-principles'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * @param {number} n
 * @param {number} [digits]
 * @returns {number}
 */
function round(n, digits = 4) {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

/**
 * @param {number[]} values
 * @returns {number|null}
 */
export function sampleVariance(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v))
  if (nums.length < 2) return null
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length
  const sumSq = nums.reduce((a, b) => a + (b - mean) ** 2, 0)
  return round(sumSq / (nums.length - 1))
}

/**
 * @param {Record<string, number>} dist
 * @returns {{ key: string|null, count: number, share: number }}
 */
export function preferredFromDistribution(dist) {
  const rank = rankDistribution(dist || {})
  if (!rank.length) return { key: null, count: 0, share: 0 }
  const total = rank.reduce((s, r) => s + r.count, 0)
  const top = rank[0]
  return {
    key: top.key,
    count: top.count,
    share: total > 0 ? round(top.count / total) : 0,
  }
}

/**
 * Infer an opening style from preferred strategy/move + question rate.
 * @param {{ strategy: string|null, move: string|null, questionRate: number }} args
 * @returns {string}
 */
export function inferPreferredOpening(args) {
  const strategy = args.strategy || ''
  const move = args.move || ''
  const q = args.questionRate || 0

  // Strategy/move signals beat moderate question rates; only very high
  // question frequency forces a question opening (unless surprise-led).
  if (move === 'unexpected_fact' || strategy === 'surprise') return 'surprise'
  if (strategy === 'diagnose') return 'technical'
  if (q >= 0.45) return 'question'
  if (move === 'practical_step' || move === 'next_step' || strategy === 'simplify') {
    return 'direct'
  }
  if (move === 'reflection' || strategy === 'expand') return 'warm'
  if (strategy === 'example' || move === 'real_world_example') return 'example'
  if (strategy === 'analogy') return 'analogy'
  if (strategy === 'challenge') return 'challenge'
  return strategy || 'direct'
}

/**
 * Confidence from sample size, strategy dominance, and metric variance.
 * @param {{
 *   examples: number,
 *   strategyShare: number,
 *   curiosities: number[],
 *   novelties: number[],
 *   practicalities: number[],
 * }} args
 * @returns {number}
 */
export function computeConfidence(args) {
  const n = Math.max(0, args.examples || 0)
  // Sample size: 0 at 0, ~0.85 at 27, asymptote 1
  const sizeScore = 1 - Math.exp(-n / 18)

  const dominance = Math.max(0, Math.min(1, args.strategyShare || 0))
  // Mild dominance is ok; very flat distributions lower confidence
  const dominanceScore = 0.35 + 0.65 * dominance

  const vars = [
    sampleVariance(args.curiosities || []),
    sampleVariance(args.novelties || []),
    sampleVariance(args.practicalities || []),
  ].filter((v) => typeof v === 'number')

  let stabilityScore = 0.7
  if (vars.length) {
    const meanVar = vars.reduce((a, b) => a + b, 0) / vars.length
    // curiosity/novelty/practicality are 0..1; variance ~0.02–0.08 typical
    stabilityScore = Math.max(0.25, Math.min(1, 1 - meanVar * 4))
  }

  const confidence = 0.4 * sizeScore + 0.35 * dominanceScore + 0.25 * stabilityScore
  return round(Math.max(0, Math.min(1, confidence)), 2)
}

/**
 * Deterministic recommendations from stats.
 * @param {object} principle partial
 * @returns {{ recommendations: string[], avoid: string[] }}
 */
export function inferRecommendations(principle) {
  /** @type {string[]} */
  const recommendations = []
  /** @type {string[]} */
  const avoid = []

  const experience = principle.experience
  const strategy = principle.preferredStrategy
  const move = principle.preferredMove
  const opening = principle.preferredOpening
  const initiative = principle.preferredInitiative
  const depth = principle.preferredDepth
  const energy = principle.preferredEnergy
  const q = principle.questionRate
  const cur = principle.metrics?.curiosity
  const nov = principle.metrics?.novelty
  const pra = principle.metrics?.practicality
  const isExploration = experience === 'exploration'

  // Experience-specific: exploration openings (stated first)
  if (isExploration) {
    recommendations.push(
      'Prefer opening with one surprising fact, question, or unexpected observation.',
    )
    recommendations.push('Open with an unexpected fact.')
    recommendations.push('Prefer one surprising idea over multiple generic ideas.')
    recommendations.push('Offer one unexpected direction, not a catalog of topics.')
    avoid.push('Possiamo parlare di...')
    avoid.push('generic topic lists')
    avoid.push('generic list')
  }

  // Opening / strategy / move
  if (!isExploration && (opening === 'surprise' || strategy === 'surprise')) {
    recommendations.push('Open with an unexpected fact.')
    recommendations.push('Prefer one surprising idea over multiple generic ideas.')
  }
  if (!isExploration) {
    if (opening === 'question' || (q != null && q >= 0.4)) {
      recommendations.push('Questions are welcome early when they open the field.')
    } else if (q != null && q < 0.2) {
      recommendations.push('Delay questions until after delivering value.')
      avoid.push('opening with a question')
    }
  }
  if (strategy === 'simplify') {
    recommendations.push('Keep the first turn short and concrete.')
    avoid.push('long multi-point openers')
  }
  if (strategy === 'diagnose') {
    recommendations.push('Identify the failure point before proposing fixes.')
    recommendations.push('Prefer one falsifiable next test.')
    avoid.push('generic troubleshooting lists')
  }
  if (strategy === 'expand') {
    recommendations.push('Advance one layer deeper on the same thread.')
  }
  if (strategy === 'example' || move === 'real_world_example') {
    recommendations.push('Lead with a concrete real-world example.')
  }
  if (strategy === 'contrast') {
    recommendations.push('Frame tradeoffs explicitly with at most two options.')
  }
  if (strategy === 'challenge') {
    recommendations.push('Offer one respectful reframe that changes the frame.')
  }
  if (move === 'practical_step' || move === 'next_step') {
    recommendations.push('End with one actionable next step.')
  }
  if (move === 'reflection') {
    recommendations.push('Validate the feeling or point before adding advice.')
  }
  if (move === 'thought_experiment') {
    recommendations.push('Use one thought experiment to open new angles.')
  }
  if (move === 'definition') {
    recommendations.push('State a crisp definition before elaborating.')
  }
  if (move === 'scientific_explanation') {
    recommendations.push('Explain the mechanism in plain language first.')
  }

  // Initiative / depth / energy
  if (initiative === 'high') {
    recommendations.push('Take initiative: propose a direction instead of a menu.')
    avoid.push('generic list')
  }
  if (initiative === 'none' || initiative === 'low') {
    recommendations.push('Stay present; do not force agenda.')
    avoid.push('high-pressure calls to action')
  }
  if (depth === 'minimal' || depth === 'short') {
    recommendations.push(`Prefer ${depth} depth over encyclopedic replies.`)
    avoid.push('deep dumps on first reply')
  }
  if (depth === 'medium' || depth === 'deep') {
    recommendations.push(`Allow ${depth} development when the thread asks for it.`)
  }
  if (energy === 'high') {
    recommendations.push('Keep energy high: vivid, forward-moving turns.')
  }
  if (energy === 'low') {
    recommendations.push('Keep energy low and steady; avoid hype.')
    avoid.push('forced enthusiasm')
  }

  // Metrics
  if (typeof cur === 'number' && cur >= 0.7) {
    recommendations.push('Optimize for curiosity: leave one open hook.')
  }
  if (typeof nov === 'number' && nov >= 0.65) {
    recommendations.push('Protect novelty; avoid repeating known advice.')
    avoid.push('generic advice')
  }
  if (typeof nov === 'number' && nov < 0.35) {
    recommendations.push('Favor familiarity and presence over novelty.')
    avoid.push('clever twists that distract from presence')
  }
  if (typeof pra === 'number' && pra >= 0.8) {
    recommendations.push('Bias toward practical, shippable next actions.')
    avoid.push('abstract speculation')
  }
  if (typeof pra === 'number' && pra < 0.4) {
    recommendations.push('Practicality is secondary; prioritize experience quality.')
  }

  // Experience-specific extras
  if (experience === 'support') {
    recommendations.push('Presence first; advice only if invited.')
    avoid.push('unsolicited fix-it mode')
  }
  if (experience === 'planning') {
    recommendations.push('Make priorities explicit and cut non-goals.')
    avoid.push('open-ended brainstorming without a deadline')
  }
  if (experience === 'brainstorming') {
    recommendations.push('Generate variety first; explain later.')
    avoid.push('premature single-path lock-in')
  }
  if (experience === 'learning') {
    recommendations.push('Concept → why → example → application.')
  }
  if (experience === 'debugging') {
    avoid.push('shotgun patches without a hypothesis')
  }
  if (experience === 'greetings' || experience === 'conversation') {
    recommendations.push('Match brevity; one warm beat is enough.')
    avoid.push('helpdesk openings')
  }

  // Deduplicate while preserving order
  const uniq = (arr) => {
    /** @type {string[]} */
    const out = []
    for (const x of arr) {
      if (x && !out.includes(x)) out.push(x)
    }
    return out
  }

  return {
    recommendations: uniq(recommendations).slice(0, 8),
    avoid: uniq(avoid).slice(0, 6),
  }
}

/**
 * Extract one principle object for a dataset/experience.
 * @param {{ name: string, stats: object, examples: object[] }} fileReport
 * @returns {object}
 */
export function extractPrincipleFromDataset(fileReport) {
  const name = fileReport.name
  const stats = fileReport.stats
  const examples = Array.isArray(fileReport.examples) ? fileReport.examples : []

  const prefStrategy = preferredFromDistribution(stats.strategyDistribution)
  const prefMove = preferredFromDistribution(stats.moveDistribution)
  const prefInitiative = preferredFromDistribution(stats.initiativeDistribution)
  const prefDepth = preferredFromDistribution(stats.depthDistribution)
  const prefEnergy = preferredFromDistribution(stats.energyDistribution)

  const questionRate = round((stats.questionPercentage || 0) / 100, 4)

  const curiosities = examples.map((e) => e.behavior.curiosity)
  const novelties = examples.map((e) => e.behavior.novelty)
  const practicalities = examples.map((e) => e.behavior.practicality)

  const preferredStrategy = prefStrategy.key
  const preferredMove = prefMove.key
  const preferredOpening = inferPreferredOpening({
    strategy: preferredStrategy,
    move: preferredMove,
    questionRate,
  })

  /** @type {object} */
  const principle = {
    experience: name,
    preferredOpening,
    preferredStrategy,
    preferredMove,
    preferredInitiative: prefInitiative.key,
    preferredDepth: prefDepth.key,
    preferredEnergy: prefEnergy.key,
    questionRate,
    metrics: {
      curiosity: stats.averageCuriosity,
      novelty: stats.averageNovelty,
      practicality: stats.averagePracticality,
    },
    dominance: {
      strategyShare: prefStrategy.share,
      moveShare: prefMove.share,
      initiativeShare: prefInitiative.share,
      depthShare: prefDepth.share,
      energyShare: prefEnergy.share,
    },
    examples: stats.examples,
    confidence: 0,
    recommendations: /** @type {string[]} */ ([]),
    avoid: /** @type {string[]} */ ([]),
  }

  principle.confidence = computeConfidence({
    examples: stats.examples,
    strategyShare: prefStrategy.share,
    curiosities,
    novelties,
    practicalities,
  })

  const rec = inferRecommendations(principle)
  principle.recommendations = rec.recommendations
  principle.avoid = rec.avoid

  return principle
}

/**
 * @param {{ dir?: string }} [options]
 * @returns {object[]}
 */
/** Output artifacts that must not be treated as experience datasets. */
const OUTPUT_JSON_NAMES = new Set([
  'conversation-principles.json',
])

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isExperienceDatasetFile(filePath) {
  const base = filePath.split(/[/\\]/).pop() || ''
  if (OUTPUT_JSON_NAMES.has(base)) return false
  try {
    const report = analyzeDatasetFile(filePath)
    return Array.isArray(report.examples) && report.examples.length > 0
  } catch {
    return false
  }
}

export function extractAllPrinciples(options = {}) {
  const dir = resolve(options.dir || DEFAULT_DATASET_DIR)
  const files = listDatasetFiles(dir).filter(isExperienceDatasetFile)
  const reports = files.map((f) => analyzeDatasetFile(f))
  return reports
    .map((r) => extractPrincipleFromDataset(r))
    .sort((a, b) => a.experience.localeCompare(b.experience))
}

/**
 * @param {object[]} principles
 * @returns {string}
 */
export function renderPrinciplesMarkdown(principles) {
  const list = Array.isArray(principles) ? principles : []
  /** @type {string[]} */
  const lines = []
  lines.push('# Conversation Principles')
  lines.push('')
  lines.push(`Generated by extract-principles ${EXTRACT_PRINCIPLES_VERSION}.`)
  lines.push('Deterministic offline inference. No LLM.')
  lines.push('')

  for (const p of list) {
    const title = p.experience.charAt(0).toUpperCase() + p.experience.slice(1)
    lines.push(`## ${title}`)
    lines.push('')
    lines.push(`- Examples: **${p.examples}**`)
    lines.push(`- Confidence: **${p.confidence}**`)
    lines.push(`- Preferred opening: **${p.preferredOpening}**`)
    lines.push(`- Preferred strategy: **${p.preferredStrategy}**`)
    lines.push(`- Preferred move: **${p.preferredMove}**`)
    lines.push(`- Preferred initiative: **${p.preferredInitiative}**`)
    lines.push(`- Preferred depth: **${p.preferredDepth}**`)
    lines.push(`- Preferred energy: **${p.preferredEnergy}**`)
    lines.push(`- Question rate: **${p.questionRate}**`)
    lines.push(
      `- Metrics: curiosity **${p.metrics.curiosity}**, novelty **${p.metrics.novelty}**, practicality **${p.metrics.practicality}**`,
    )
    lines.push('')
    lines.push('### What works')
    lines.push('')
    for (const r of p.recommendations || []) lines.push(`- ${r}`)
    if (!(p.recommendations || []).length) lines.push('- _No recommendations._')
    lines.push('')
    lines.push('### What should be avoided')
    lines.push('')
    for (const a of p.avoid || []) lines.push(`- ${a}`)
    if (!(p.avoid || []).length) lines.push('- _No avoid rules._')
    lines.push('')
    lines.push('### Confidence')
    lines.push('')
    lines.push(
      `Confidence **${p.confidence}** from sample size (${p.examples}), strategy dominance (${p.dominance?.strategyShare ?? '—'}), and metric stability.`,
    )
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Extract principles and optionally write JSON + markdown outputs.
 * @param {{
 *   dir?: string,
 *   writeOutputs?: boolean,
 *   jsonPath?: string,
 *   reportPath?: string,
 * }} [options]
 */
export function extractPrinciplesPackage(options = {}) {
  const dir = resolve(options.dir || DEFAULT_DATASET_DIR)
  const principles = extractAllPrinciples({ dir })
  const markdown = renderPrinciplesMarkdown(principles)
  const payload = {
    version: EXTRACT_PRINCIPLES_VERSION,
    generatedFrom: dir,
    experienceCount: principles.length,
    experiences: principles,
  }

  let jsonPath = null
  let reportPath = null
  if (options.writeOutputs !== false) {
    jsonPath = resolve(options.jsonPath || join(dir, 'conversation-principles.json'))
    reportPath = resolve(
      options.reportPath || join(dir, 'conversation-principles-report.md'),
    )
    writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8')
    writeFileSync(reportPath, markdown, 'utf8')
  }

  return {
    version: EXTRACT_PRINCIPLES_VERSION,
    dir,
    principles,
    markdown,
    jsonPath,
    reportPath,
    payload,
  }
}
