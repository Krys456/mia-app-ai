/**
 * Conversation Intelligence — offline dataset analyzer (research only).
 *
 * Read-only. No LLM. No Writer / Planner / Runtime / API wiring.
 * Deterministic statistics over research/conversation-intelligence/*.json
 */

import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'path'
import { fileURLToPath } from 'url'

export const ANALYZE_DATASET_VERSION = '0.1.0-analyze-dataset'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Default dataset directory (this folder). */
export const DEFAULT_DATASET_DIR = __dirname

/** Depth rank for averaging ordinal depth labels. */
const DEPTH_RANK = Object.freeze({
  minimal: 1,
  short: 2,
  medium: 3,
  deep: 4,
})

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function asNumber(value, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

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
export function average(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v))
  if (!nums.length) return null
  return round(nums.reduce((a, b) => a + b, 0) / nums.length)
}

/**
 * @param {string[]} values
 * @returns {Record<string, number>}
 */
export function countDistribution(values) {
  /** @type {Record<string, number>} */
  const out = {}
  for (const v of values) {
    const key = asString(v).trim() || '(empty)'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(
    Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  )
}

/**
 * @param {Record<string, number>} dist
 * @returns {{ key: string, count: number }[]}
 */
export function rankDistribution(dist) {
  return Object.entries(dist || {})
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/**
 * Validate and normalize one example.
 * @param {any} raw
 * @returns {object|null}
 */
export function normalizeExample(raw) {
  if (!raw || typeof raw !== 'object') return null
  const behavior = raw.behavior && typeof raw.behavior === 'object' ? raw.behavior : null
  if (!behavior) return null
  return {
    user: asString(raw.user),
    assistant: asString(raw.assistant),
    behavior: {
      turnType: asString(behavior.turnType),
      strategy: asString(behavior.strategy),
      move: asString(behavior.move),
      initiative: asString(behavior.initiative),
      depth: asString(behavior.depth),
      energy: asString(behavior.energy),
      question: Boolean(behavior.question),
      curiosity: asNumber(behavior.curiosity, 0),
      novelty: asNumber(behavior.novelty, 0),
      practicality: asNumber(behavior.practicality, 0),
    },
  }
}

/**
 * @param {object[]} examples
 * @returns {object}
 */
export function analyzeExamples(examples) {
  const list = Array.isArray(examples)
    ? examples.map(normalizeExample).filter(Boolean)
    : []

  const turnTypes = list.map((e) => e.behavior.turnType)
  const strategies = list.map((e) => e.behavior.strategy)
  const moves = list.map((e) => e.behavior.move)
  const initiatives = list.map((e) => e.behavior.initiative)
  const depths = list.map((e) => e.behavior.depth)
  const energies = list.map((e) => e.behavior.energy)
  const questions = list.map((e) => e.behavior.question)
  const curiosities = list.map((e) => e.behavior.curiosity)
  const novelties = list.map((e) => e.behavior.novelty)
  const practicalities = list.map((e) => e.behavior.practicality)
  const depthRanks = list
    .map((e) => DEPTH_RANK[e.behavior.depth])
    .filter((n) => typeof n === 'number')

  const questionCount = questions.filter(Boolean).length

  return {
    examples: list.length,
    turnTypeDistribution: countDistribution(turnTypes),
    strategyDistribution: countDistribution(strategies),
    moveDistribution: countDistribution(moves),
    initiativeDistribution: countDistribution(initiatives),
    depthDistribution: countDistribution(depths),
    energyDistribution: countDistribution(energies),
    questionPercentage: list.length ? round((questionCount / list.length) * 100, 2) : 0,
    questionCount,
    averageCuriosity: average(curiosities),
    averageNovelty: average(novelties),
    averagePracticality: average(practicalities),
    averageDepthRank: average(depthRanks),
  }
}

/**
 * List dataset JSON files in a directory (excludes report / non-arrays handled later).
 * @param {string} [dir]
 * @returns {string[]} absolute paths sorted by basename
 */
export function listDatasetFiles(dir = DEFAULT_DATASET_DIR) {
  const root = resolve(dir)
  const names = readdirSync(root)
    .filter((name) => extname(name).toLowerCase() === '.json')
    .filter((name) => !name.startsWith('.'))
    .sort((a, b) => a.localeCompare(b))
  return names.map((name) => join(root, name))
}

/**
 * Load and analyze one JSON dataset file.
 * @param {string} filePath
 * @returns {{ file: string, name: string, stats: object, examples: object[] }}
 */
export function analyzeDatasetFile(filePath) {
  const abs = isAbsolute(filePath) ? filePath : resolve(filePath)
  const raw = JSON.parse(readFileSync(abs, 'utf8'))
  if (!Array.isArray(raw)) {
    throw new Error(`Dataset must be a JSON array: ${abs}`)
  }
  const examples = raw.map(normalizeExample).filter(Boolean)
  return {
    file: abs,
    name: basename(abs, '.json'),
    stats: analyzeExamples(examples),
    examples,
  }
}

/**
 * @param {object[]} fileReports
 * @returns {object}
 */
export function buildGlobalReport(fileReports) {
  const reports = Array.isArray(fileReports) ? fileReports : []
  /** @type {object[]} */
  const allExamples = []
  for (const r of reports) {
    if (Array.isArray(r.examples)) allExamples.push(...r.examples)
  }

  const globalStats = analyzeExamples(allExamples)

  /** @type {Record<string, { curiosity: number[], novelty: number[], practicality: number[], count: number }>} */
  const byStrategy = {}
  for (const ex of allExamples) {
    const s = ex.behavior.strategy || '(empty)'
    if (!byStrategy[s]) {
      byStrategy[s] = { curiosity: [], novelty: [], practicality: [], count: 0 }
    }
    byStrategy[s].curiosity.push(ex.behavior.curiosity)
    byStrategy[s].novelty.push(ex.behavior.novelty)
    byStrategy[s].practicality.push(ex.behavior.practicality)
    byStrategy[s].count += 1
  }

  const strategyMetricRows = Object.entries(byStrategy)
    .map(([strategy, bag]) => ({
      strategy,
      count: bag.count,
      averageCuriosity: average(bag.curiosity),
      averageNovelty: average(bag.novelty),
      averagePracticality: average(bag.practicality),
    }))
    .sort((a, b) => a.strategy.localeCompare(b.strategy))

  const strategyRank = rankDistribution(globalStats.strategyDistribution)
  const moveRank = rankDistribution(globalStats.moveDistribution)

  /** Per conversation type = per dataset file name (greetings, exploration, …) */
  const averageValuesPerConversationType = reports
    .map((r) => ({
      type: r.name,
      examples: r.stats.examples,
      averageCuriosity: r.stats.averageCuriosity,
      averageNovelty: r.stats.averageNovelty,
      averagePracticality: r.stats.averagePracticality,
      questionPercentage: r.stats.questionPercentage,
      averageDepthRank: r.stats.averageDepthRank,
      topStrategy: rankDistribution(r.stats.strategyDistribution)[0]?.key || null,
      topMove: rankDistribution(r.stats.moveDistribution)[0]?.key || null,
    }))
    .sort((a, b) => a.type.localeCompare(b.type))

  const byCuriosity = [...strategyMetricRows]
    .filter((r) => r.averageCuriosity != null)
    .sort(
      (a, b) =>
        /** @type {number} */ (b.averageCuriosity) -
          /** @type {number} */ (a.averageCuriosity) || a.strategy.localeCompare(b.strategy),
    )
  const byNovelty = [...strategyMetricRows]
    .filter((r) => r.averageNovelty != null)
    .sort(
      (a, b) =>
        /** @type {number} */ (b.averageNovelty) -
          /** @type {number} */ (a.averageNovelty) || a.strategy.localeCompare(b.strategy),
    )
  const byPracticality = [...strategyMetricRows]
    .filter((r) => r.averagePracticality != null)
    .sort(
      (a, b) =>
        /** @type {number} */ (b.averagePracticality) -
          /** @type {number} */ (a.averagePracticality) || a.strategy.localeCompare(b.strategy),
    )

  return {
    totalExamples: allExamples.length,
    datasets: reports.length,
    globalStats,
    mostCommonStrategies: strategyRank.slice(0, 5),
    rarestStrategies: [...strategyRank].reverse().slice(0, 5),
    mostCommonMoves: moveRank.slice(0, 5),
    rarestMoves: [...moveRank].reverse().slice(0, 5),
    highestCuriosityStrategies: byCuriosity.slice(0, 5),
    highestNoveltyStrategies: byNovelty.slice(0, 5),
    highestPracticalityStrategies: byPracticality.slice(0, 5),
    averageValuesPerConversationType,
    strategyMetricRows,
  }
}

/**
 * Deterministic insight generator (rule-based, no LLM).
 * @param {object[]} fileReports
 * @param {object} global
 * @returns {string[]}
 */
export function generateInsights(fileReports, global) {
  /** @type {string[]} */
  const insights = []
  const byName = Object.fromEntries((fileReports || []).map((r) => [r.name, r]))

  const push = (s) => {
    if (s && !insights.includes(s)) insights.push(s)
  }

  // Per-dataset dominant strategy
  for (const r of fileReports || []) {
    const top = rankDistribution(r.stats.strategyDistribution)[0]
    if (top && top.count / r.stats.examples >= 0.3) {
      push(
        `${typeLabel(r.name)} examples rely mostly on ${top.key} (${top.count}/${r.stats.examples}).`,
      )
    }
  }

  // Question rates
  for (const r of fileReports || []) {
    if (r.stats.questionPercentage <= 20) {
      push(
        `${typeLabel(r.name)} examples rarely end with questions (${r.stats.questionPercentage}%).`,
      )
    } else if (r.stats.questionPercentage >= 45) {
      push(
        `${typeLabel(r.name)} examples often include questions (${r.stats.questionPercentage}%).`,
      )
    }
  }

  // Depth ranking across types
  const depthSorted = [...(global.averageValuesPerConversationType || [])]
    .filter((t) => t.averageDepthRank != null)
    .sort((a, b) => b.averageDepthRank - a.averageDepthRank)
  if (depthSorted[0]) {
    push(
      `${typeLabel(depthSorted[0].type)} has the highest average depth (rank ${depthSorted[0].averageDepthRank}).`,
    )
  }
  if (depthSorted.length > 1) {
    const last = depthSorted[depthSorted.length - 1]
    push(
      `${typeLabel(last.type)} has the lowest average depth (rank ${last.averageDepthRank}).`,
    )
  }

  // Novelty / curiosity / practicality extremes by type
  const types = global.averageValuesPerConversationType || []
  const byNov = [...types].sort((a, b) => (b.averageNovelty || 0) - (a.averageNovelty || 0))
  const byCur = [...types].sort((a, b) => (b.averageCuriosity || 0) - (a.averageCuriosity || 0))
  const byPra = [...types].sort((a, b) => (b.averagePracticality || 0) - (a.averagePracticality || 0))

  if (byNov[0] && byNov[byNov.length - 1]) {
    push(
      `${typeLabel(byNov[0].type)} leads in novelty (avg ${byNov[0].averageNovelty}); ${byNov[byNov.length - 1].type} is lowest (avg ${byNov[byNov.length - 1].averageNovelty}).`,
    )
  }
  if (byCur[0]) {
    push(
      `${typeLabel(byCur[0].type)} shows the highest average curiosity (${byCur[0].averageCuriosity}).`,
    )
  }
  if (byPra[0]) {
    push(
      `${typeLabel(byPra[0].type)} shows the highest average practicality (${byPra[0].averagePracticality}).`,
    )
  }

  // Support-specific empathy-style note (low novelty, presence-heavy)
  if (byName.support) {
    const s = byName.support.stats
    push(
      `Support has relatively low novelty (avg ${s.averageNovelty}) and low question rate (${s.questionPercentage}%), favoring presence over probing.`,
    )
  }

  // Exploration surprise
  if (byName.exploration) {
    const dist = byName.exploration.stats.strategyDistribution
    if (dist.surprise) {
      push(
        `Exploration relies heavily on surprise (${dist.surprise} examples).`,
      )
    }
  }

  // Debugging diagnose
  if (byName.debugging) {
    const dist = byName.debugging.stats.strategyDistribution
    if (dist.diagnose) {
      push(
        `Debugging centers on diagnose (${dist.diagnose} examples).`,
      )
    }
    if ((byName.debugging.stats.averagePracticality || 0) >= 0.85) {
      push(
        `Debugging has very high practicality (avg ${byName.debugging.stats.averagePracticality}).`,
      )
    }
  }

  // Planning questions rare / practicality
  if (byName.planning) {
    push(
      `Planning emphasizes practicality (avg ${byName.planning.stats.averagePracticality}) with question rate ${byName.planning.stats.questionPercentage}%.`,
    )
  }

  // Strategy metric leaders
  if (global.highestCuriosityStrategies?.[0]) {
    const s = global.highestCuriosityStrategies[0]
    push(`Across strategies, ${s.strategy} ranks highest in curiosity (avg ${s.averageCuriosity}).`)
  }
  if (global.highestNoveltyStrategies?.[0]) {
    const s = global.highestNoveltyStrategies[0]
    push(`Across strategies, ${s.strategy} ranks highest in novelty (avg ${s.averageNovelty}).`)
  }
  if (global.highestPracticalityStrategies?.[0]) {
    const s = global.highestPracticalityStrategies[0]
    push(
      `Across strategies, ${s.strategy} ranks highest in practicality (avg ${s.averagePracticality}).`,
    )
  }

  // Global commons
  if (global.mostCommonStrategies?.[0]) {
    push(
      `Globally, the most common strategy is ${global.mostCommonStrategies[0].key} (${global.mostCommonStrategies[0].count}).`,
    )
  }
  if (global.mostCommonMoves?.[0]) {
    push(
      `Globally, the most common move is ${global.mostCommonMoves[0].key} (${global.mostCommonMoves[0].count}).`,
    )
  }
  if (global.rarestStrategies?.[0]) {
    push(
      `Globally, one of the rarest strategies is ${global.rarestStrategies[0].key} (${global.rarestStrategies[0].count}).`,
    )
  }

  // Initiative patterns
  for (const r of fileReports || []) {
    const none = r.stats.initiativeDistribution.none || 0
    const high = r.stats.initiativeDistribution.high || 0
    if (high / r.stats.examples >= 0.45) {
      push(`${typeLabel(r.name)} often uses high initiative (${high}/${r.stats.examples}).`)
    }
    if (none / r.stats.examples >= 0.25) {
      push(`${typeLabel(r.name)} frequently uses initiative=none (${none}/${r.stats.examples}).`)
    }
  }

  // Keep 10–20 observations, deterministic order already
  return insights.slice(0, 20)
}

/**
 * @param {string} s
 * @returns {string}
 */
function capitalize(s) {
  const t = asString(s)
  if (!t) return t
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * Human label for a dataset / conversation type name.
 * @param {string} s
 * @returns {string}
 */
function typeLabel(s) {
  const t = asString(s)
  if (t === 'conversation') return 'Casual chat'
  if (t === 'greetings') return 'Greeting'
  return capitalize(t)
}

/**
 * @param {Record<string, number>} dist
 * @returns {string}
 */
function formatDistMarkdown(dist) {
  const rows = rankDistribution(dist)
  if (!rows.length) return '_No data._\n'
  const lines = ['| Value | Count |', '|---|---:|']
  for (const r of rows) lines.push(`| ${r.key} | ${r.count} |`)
  return `${lines.join('\n')}\n`
}

/**
 * Render markdown report.
 * @param {{ datasets: object[], global: object, insights: string[] }} analysis
 * @returns {string}
 */
export function renderMarkdownReport(analysis) {
  const datasets = analysis.datasets || []
  const global = analysis.global || {}
  const insights = analysis.insights || []

  /** @type {string[]} */
  const lines = []
  lines.push('# Conversation Intelligence Report')
  lines.push('')
  lines.push(`Generated by analyze-dataset ${ANALYZE_DATASET_VERSION}.`)
  lines.push('Deterministic offline statistics. No LLM.')
  lines.push('')

  lines.push('## Dataset summary')
  lines.push('')
  lines.push(`- Datasets: **${global.datasets ?? datasets.length}**`)
  lines.push(`- Total examples: **${global.totalExamples ?? 0}**`)
  lines.push('')
  lines.push('| Dataset | Examples | Top strategy | Top move | Questions % | Avg curiosity | Avg novelty | Avg practicality |')
  lines.push('|---|---:|---|---|---:|---:|---:|---:|')
  for (const row of global.averageValuesPerConversationType || []) {
    lines.push(
      `| ${row.type} | ${row.examples} | ${row.topStrategy ?? '—'} | ${row.topMove ?? '—'} | ${row.questionPercentage} | ${row.averageCuriosity ?? '—'} | ${row.averageNovelty ?? '—'} | ${row.averagePracticality ?? '—'} |`,
    )
  }
  lines.push('')

  lines.push('## Strategy frequency')
  lines.push('')
  lines.push(formatDistMarkdown(global.globalStats?.strategyDistribution || {}))
  lines.push('### Most common strategies')
  lines.push('')
  for (const s of global.mostCommonStrategies || []) {
    lines.push(`- ${s.key}: ${s.count}`)
  }
  lines.push('')
  lines.push('### Rarest strategies')
  lines.push('')
  for (const s of global.rarestStrategies || []) {
    lines.push(`- ${s.key}: ${s.count}`)
  }
  lines.push('')

  lines.push('## Move frequency')
  lines.push('')
  lines.push(formatDistMarkdown(global.globalStats?.moveDistribution || {}))
  lines.push('### Most common moves')
  lines.push('')
  for (const m of global.mostCommonMoves || []) {
    lines.push(`- ${m.key}: ${m.count}`)
  }
  lines.push('')

  lines.push('## Curiosity ranking')
  lines.push('')
  lines.push('| Strategy | Avg curiosity | Count |')
  lines.push('|---|---:|---:|')
  for (const s of global.highestCuriosityStrategies || []) {
    lines.push(`| ${s.strategy} | ${s.averageCuriosity} | ${s.count} |`)
  }
  lines.push('')

  lines.push('## Novelty ranking')
  lines.push('')
  lines.push('| Strategy | Avg novelty | Count |')
  lines.push('|---|---:|---:|')
  for (const s of global.highestNoveltyStrategies || []) {
    lines.push(`| ${s.strategy} | ${s.averageNovelty} | ${s.count} |`)
  }
  lines.push('')

  lines.push('## Practicality ranking')
  lines.push('')
  lines.push('| Strategy | Avg practicality | Count |')
  lines.push('|---|---:|---:|')
  for (const s of global.highestPracticalityStrategies || []) {
    lines.push(`| ${s.strategy} | ${s.averagePracticality} | ${s.count} |`)
  }
  lines.push('')

  lines.push('## Per-dataset detail')
  lines.push('')
  for (const d of datasets) {
    lines.push(`### ${d.name}`)
    lines.push('')
    lines.push(`- Examples: ${d.stats.examples}`)
    lines.push(`- Question %: ${d.stats.questionPercentage}`)
    lines.push(`- Avg curiosity / novelty / practicality: ${d.stats.averageCuriosity} / ${d.stats.averageNovelty} / ${d.stats.averagePracticality}`)
    lines.push('')
    lines.push('**Strategies**')
    lines.push('')
    lines.push(formatDistMarkdown(d.stats.strategyDistribution))
    lines.push('**Moves**')
    lines.push('')
    lines.push(formatDistMarkdown(d.stats.moveDistribution))
  }

  lines.push('## Insights')
  lines.push('')
  if (!insights.length) {
    lines.push('_No insights generated._')
  } else {
    for (const tip of insights) lines.push(`- ${tip}`)
  }
  lines.push('')

  return lines.join('\n')
}

/**
 * Analyze all datasets in a directory and optionally write report.md.
 * @param {{ dir?: string, writeReport?: boolean, reportPath?: string }} [options]
 * @returns {{ datasets: object[], global: object, insights: string[], markdown: string, reportPath: string|null }}
 */
export function analyzeAllDatasets(options = {}) {
  const dir = resolve(options.dir || DEFAULT_DATASET_DIR)
  const files = listDatasetFiles(dir)
  const datasets = files.map((f) => analyzeDatasetFile(f))
  const global = buildGlobalReport(datasets)
  const insights = generateInsights(datasets, global)
  const markdown = renderMarkdownReport({ datasets, global, insights })

  let reportPath = null
  if (options.writeReport !== false) {
    reportPath = resolve(options.reportPath || join(dir, 'report.md'))
    writeFileSync(reportPath, markdown, 'utf8')
  }

  return {
    version: ANALYZE_DATASET_VERSION,
    dir,
    datasets: datasets.map(({ name, file, stats }) => ({ name, file, stats })),
    // keep examples out of default return for size; global already aggregated
    global,
    insights,
    markdown,
    reportPath,
  }
}
