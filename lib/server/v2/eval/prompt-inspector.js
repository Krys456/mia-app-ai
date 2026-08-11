/**
 * LAIfe V2 — Prompt Inspector (experimental)
 *
 * Pure analysis of a Writer prompt. No LLM. No behavior changes.
 * Does not modify Writer / Planner / Cleaner / Reviewer / Runtime / API / V1.
 *
 * Usage:
 *   import { inspectPrompt } from './prompt-inspector.js'
 *   const report = inspectPrompt({ writerPrompt })
 */

export const PROMPT_INSPECTOR_VERSION = '0.1.0-prompt-inspector'

/**
 * @typedef {object} PromptSection
 * @property {string} title
 * @property {number} start
 * @property {number} end
 * @property {number} characters
 * @property {number} tokensEstimate
 * @property {number} lines
 */

/**
 * @typedef {object} PromptDuplicate
 * @property {string} text
 * @property {number} count
 * @property {string} [normalized]
 */

/**
 * @typedef {object} PromptConceptCluster
 * @property {string} cluster
 * @property {string[]} terms
 * @property {number} count
 */

/**
 * @typedef {object} PromptInspection
 * @property {number} characters
 * @property {number} tokensEstimate
 * @property {PromptSection[]} sections
 * @property {number} sectionCount
 * @property {number} averageSectionLength
 * @property {PromptDuplicate[]} duplicates
 * @property {PromptConceptCluster[]} clusters
 * @property {PromptDuplicate[]} contradictions
 * @property {number} instructionCount
 * @property {number} instructionDensity
 * @property {number} redundancyScore
 * @property {number} complexityScore
 * @property {string} summary
 * @property {string} version
 */

/** Rough chars-per-token for mixed IT/EN instruction prose. */
const CHARS_PER_TOKEN = 4

/**
 * Soft contradiction pairs (normalized needles).
 * @type {Array<[string, string, string]>}
 */
const CONTRADICTION_PAIRS = [
  ['ask a question', 'do not ask', 'question_policy'],
  ['ask one question', 'no question', 'question_policy'],
  ['coda=question', 'ask_question:no', 'question_policy'],
  ['must ask', 'must not ask', 'question_policy'],
  ['be concise', 'be detailed', 'length_policy'],
  ['short reply', 'deep response', 'length_policy'],
  ['use memory', 'omit memory', 'memory_policy'],
  ['comfort', 'challenge', 'affect_policy'],
]

/**
 * Concept clusters: related tone / policy vocabulary.
 * @type {Record<string, string[]>}
 */
const CONCEPT_CLUSTERS = {
  tone: [
    'warm',
    'friendly',
    'natural',
    'human',
    'calm',
    'curious',
    'presence',
    'caldo',
    'naturale',
    'umano',
    'cordiale',
  ],
  questions: [
    'question',
    'questions',
    'ask',
    'clarify',
    'clarification',
    'domanda',
    'domande',
    'chiarimento',
    'interview',
  ],
  brevity: [
    'concise',
    'short',
    'brief',
    'minimal',
    'compact',
    'corto',
    'breve',
    'sintetico',
  ],
  no_copy: [
    'do not copy',
    'non copiar',
    'non ripetere',
    'non riutilizzare',
    "don't copy",
    'do not repeat',
  ],
  continuity: [
    'continue',
    'continuity',
    'resume',
    'thread',
    'focus',
    'continuità',
    'riprend',
    'filo',
  ],
  teaching: [
    'teach',
    'explain',
    'example',
    'learning',
    'spiega',
    'esempio',
    'insegn',
  ],
}

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
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  const t = asString(text)
  if (!t) return 0
  // Prefer whitespace token approx, floor with char heuristic.
  const byWords = t.trim().split(/\s+/).filter(Boolean).length
  const byChars = Math.ceil(t.length / CHARS_PER_TOKEN)
  return Math.max(byWords, Math.round(byChars * 0.85))
}

/**
 * Normalize an instruction line for duplicate detection.
 * @param {string} line
 * @returns {string}
 */
function normalizeInstruction(line) {
  return asString(line)
    .toLowerCase()
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.:;!?…]+$/g, '')
    .trim()
}

/**
 * Split prompt into titled sections (ALL-CAPS / known headers / blank-line blocks).
 * @param {string} prompt
 * @returns {PromptSection[]}
 */
export function splitPromptSections(prompt) {
  const text = asString(prompt)
  if (!text.trim()) return []

  const lines = text.split(/\n/)
  /** @type {{ title: string, startLine: number, endLine: number }[]} */
  const raw = []
  let currentTitle = 'PREAMBLE'
  let startLine = 0

  const isHeader = (line) => {
    const t = line.trim()
    if (!t) return false
    if (/^#{1,3}\s+\S/.test(t)) return true
    if (/^[A-Z][A-Z0-9][A-Z0-9 \/_-]{2,80}$/.test(t) && t.length <= 80) return true
    if (
      /^(VOICE (STYLE )?EXAMPLES|VOICE CORPUS|PERSONALITY FOUNDATION|WRITER BRIEF|CONVERSATION PLAN|CONSTRAINTS|REWRITE MODE|MUST|MUST NOT|USER PREFERENCES|MEMORY)\b/i.test(
        t,
      )
    ) {
      return true
    }
    return false
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (isHeader(line) && i > startLine) {
      raw.push({ title: currentTitle, startLine, endLine: i - 1 })
      currentTitle = line.trim().replace(/^#+\s*/, '').slice(0, 80)
      startLine = i
    } else if (isHeader(line) && i === startLine && i === 0) {
      currentTitle = line.trim().replace(/^#+\s*/, '').slice(0, 80)
    }
  }
  raw.push({ title: currentTitle, startLine, endLine: lines.length - 1 })

  return raw.map((s) => {
    const slice = lines.slice(s.startLine, s.endLine + 1).join('\n')
    const characters = slice.length
    return {
      title: s.title,
      start: s.startLine,
      end: s.endLine,
      characters,
      tokensEstimate: estimateTokens(slice),
      lines: s.endLine - s.startLine + 1,
    }
  })
}

/**
 * Extract candidate instruction lines (bullets, MUST lines, short imperative sentences).
 * @param {string} prompt
 * @returns {string[]}
 */
export function extractInstructionLines(prompt) {
  const text = asString(prompt)
  if (!text.trim()) return []

  /** @type {string[]} */
  const out = []
  for (const rawLine of text.split(/\n/)) {
    let line = rawLine.trim()
    if (!line) continue
    if (/^#{1,3}\s+/.test(line)) continue
    if (/^[A-Z][A-Z0-9][A-Z0-9 \/_-]{2,80}$/.test(line) && line.length <= 80) continue
    // Skip few-shot dialogue / example turns (not instructions).
    if (/^(user|assistant)\s*:/i.test(line)) continue
    if (/^example\s+\d+/i.test(line)) continue
    if (/^dialogue\s+\d+/i.test(line)) continue

    // Strip bullets / numbering
    line = line.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '').trim()
    if (line.length < 12) continue

    const lower = line.toLowerCase()
    const looksInstruction =
      /^(do not|don't|never|avoid|keep|write|respond|prefer|use|stay|skip|shape|offer|give|include|exclude|must|non |evita|resta|scrivi|rispond|non\s)/i.test(
        lower,
      ) ||
      /\b(do not|don't|never|avoid|must not|must:|hard:)\b/i.test(lower) ||
      /^experience guidance:/i.test(lower) ||
      /^optional soft continuity/i.test(lower)

    if (looksInstruction) out.push(line)
  }
  return out
}

/**
 * Find repeated instructions (same normalized text, count >= 2).
 * @param {string[]} instructions
 * @returns {PromptDuplicate[]}
 */
export function findDuplicates(instructions) {
  /** @type {Map<string, { text: string, count: number }>} */
  const map = new Map()
  for (const inst of instructions) {
    const key = normalizeInstruction(inst)
    if (!key || key.length < 10) continue
    const prev = map.get(key)
    if (prev) {
      prev.count += 1
    } else {
      map.set(key, { text: inst, count: 1 })
    }
  }
  return [...map.values()]
    .filter((d) => d.count >= 2)
    .map((d) => ({
      text: d.text,
      count: d.count,
      normalized: normalizeInstruction(d.text),
    }))
    .sort((a, b) => b.count - a.count || b.text.length - a.text.length)
}

/**
 * Near-duplicate detection via shared significant token overlap.
 * @param {string[]} instructions
 * @returns {PromptDuplicate[]}
 */
function findNearDuplicates(instructions) {
  const norms = instructions.map((t) => normalizeInstruction(t)).filter((t) => t.length >= 16)
  /** @type {Map<string, { text: string, count: number }>} */
  const buckets = new Map()

  const signature = (norm) => {
    const tokens = norm
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .filter((w) => !/^(that|this|with|from|into|your|their|have|will|sono|della|delle|questo|questa)$/i.test(w))
    return tokens.slice(0, 6).join(' ')
  }

  for (let i = 0; i < norms.length; i += 1) {
    const sig = signature(norms[i])
    if (!sig || sig.split(' ').length < 3) continue
    const prev = buckets.get(sig)
    if (prev) prev.count += 1
    else buckets.set(sig, { text: instructions[i], count: 1 })
  }

  return [...buckets.values()]
    .filter((d) => d.count >= 2)
    .map((d) => ({
      text: d.text,
      count: d.count,
      normalized: normalizeInstruction(d.text),
    }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Concept clusters present in the prompt.
 * @param {string} prompt
 * @returns {PromptConceptCluster[]}
 */
export function findConceptClusters(prompt) {
  const lower = asString(prompt).toLowerCase()
  /** @type {PromptConceptCluster[]} */
  const clusters = []

  for (const [cluster, terms] of Object.entries(CONCEPT_CLUSTERS)) {
    const hitTerms = []
    let count = 0
    const uniqTerms = [...new Set(terms)]
    for (const term of uniqTerms) {
      const re = new RegExp(
        `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'gi',
      )
      const matches = lower.match(re)
      if (matches && matches.length) {
        hitTerms.push(term)
        count += matches.length
      }
    }
    if (count >= 2 && hitTerms.length >= 2) {
      clusters.push({ cluster, terms: hitTerms, count })
    }
  }

  return clusters.sort((a, b) => b.count - a.count)
}

/**
 * Soft contradiction scan.
 * @param {string} prompt
 * @returns {PromptDuplicate[]}
 */
export function findContradictions(prompt) {
  const lower = asString(prompt).toLowerCase()
  /** @type {PromptDuplicate[]} */
  const out = []
  for (const [a, b, label] of CONTRADICTION_PAIRS) {
    if (lower.includes(a) && lower.includes(b)) {
      out.push({
        text: `${label}: "${a}" vs "${b}"`,
        count: 2,
        normalized: label,
      })
    }
  }
  return out
}

/**
 * @param {PromptDuplicate[]} duplicates
 * @param {PromptConceptCluster[]} clusters
 * @param {number} instructionCount
 * @param {number} tokensEstimate
 * @returns {number} 0..1
 */
function computeRedundancyScore(duplicates, clusters, instructionCount, tokensEstimate) {
  if (instructionCount <= 0 && tokensEstimate <= 0) return 0

  let dupWeight = 0
  for (const d of duplicates) {
    dupWeight += Math.max(0, d.count - 1) * Math.min(1, d.text.length / 80)
  }
  const clusterWeight = clusters.reduce((s, c) => s + Math.max(0, c.count - 1) * 0.15, 0)
  const base = instructionCount > 0 ? dupWeight / instructionCount : 0
  const score = Math.min(1, base * 0.85 + Math.min(0.5, clusterWeight / 8) + (tokensEstimate > 2500 ? 0.1 : 0))
  return Number(score.toFixed(3))
}

/**
 * @param {object} args
 * @param {number} args.sectionCount
 * @param {number} args.tokensEstimate
 * @param {number} args.redundancyScore
 * @param {number} args.instructionCount
 * @returns {number} 0..1
 */
function computeComplexityScore({
  sectionCount,
  tokensEstimate,
  redundancyScore,
  instructionCount,
}) {
  const sectionPart = Math.min(1, sectionCount / 14)
  const tokenPart = Math.min(1, tokensEstimate / 3500)
  const instructionPart = Math.min(1, instructionCount / 80)
  const score =
    sectionPart * 0.25 + tokenPart * 0.35 + redundancyScore * 0.25 + instructionPart * 0.15
  return Number(Math.max(0, Math.min(1, score)).toFixed(3))
}

/**
 * @param {object} args
 * @returns {string}
 */
function buildSummary(args) {
  const {
    tokensEstimate,
    characters,
    sectionCount,
    duplicates,
    clusters,
    contradictions,
    redundancyScore,
    complexityScore,
    instructionCount,
  } = args

  /** @type {string[]} */
  const lines = []

  if (tokensEstimate >= 2500 || characters >= 10000) {
    lines.push('Prompt molto lungo.')
  } else if (tokensEstimate >= 1200) {
    lines.push('Prompt lungo.')
  } else if (tokensEstimate <= 400) {
    lines.push('Prompt compatto.')
  } else {
    lines.push('Prompt di lunghezza media.')
  }

  lines.push(`${sectionCount} sezioni, ~${tokensEstimate} token, ${instructionCount} istruzioni rilevate.`)

  const tone = clusters.find((c) => c.cluster === 'tone')
  if (tone) {
    lines.push(`Le istruzioni sul tono sono presenti ${tone.count} volte.`)
  }
  const questions = clusters.find((c) => c.cluster === 'questions')
  if (questions) {
    lines.push(`Le istruzioni sulle domande sono presenti ${questions.count} volte.`)
  }
  const brevity = clusters.find((c) => c.cluster === 'brevity')
  if (brevity && brevity.count >= 3) {
    lines.push(`Le istruzioni sulla brevità sono presenti ${brevity.count} volte.`)
  }

  if (duplicates.length) {
    const top = duplicates[0]
    lines.push(`Istruzione ripetuta più frequente (${top.count}×): "${top.text.slice(0, 80)}".`)
  }

  if (redundancyScore >= 0.55) {
    lines.push('Ridondanza elevata.')
  } else if (redundancyScore >= 0.3) {
    lines.push('Ridondanza moderata.')
  } else {
    lines.push('Ridondanza bassa.')
  }

  if (complexityScore >= 0.65) {
    lines.push('Complessità elevata.')
  } else if (complexityScore >= 0.4) {
    lines.push('Complessità media.')
  }

  if (contradictions.length) {
    lines.push(`Possibili contraddizioni: ${contradictions.length}.`)
  }

  return lines.join(' ')
}

/**
 * Inspect a Writer prompt. Pure analysis only.
 *
 * @param {{ writerPrompt?: string, prompt?: string }} [input]
 * @returns {PromptInspection}
 */
export function inspectPrompt(input = {}) {
  const writerPrompt = asString(input.writerPrompt ?? input.prompt ?? '')
  const characters = writerPrompt.length
  const tokensEstimate = estimateTokens(writerPrompt)
  const sections = splitPromptSections(writerPrompt)
  const sectionCount = sections.length
  const averageSectionLength =
    sectionCount > 0
      ? Number((sections.reduce((s, x) => s + x.characters, 0) / sectionCount).toFixed(1))
      : 0

  const instructionLines = extractInstructionLines(writerPrompt)
  const exactDupes = findDuplicates(instructionLines)
  const nearDupes = findNearDuplicates(instructionLines)

  // Merge duplicates by normalized key, prefer higher counts.
  /** @type {Map<string, PromptDuplicate>} */
  const dupMap = new Map()
  for (const d of [...exactDupes, ...nearDupes]) {
    const key = d.normalized || normalizeInstruction(d.text)
    const prev = dupMap.get(key)
    if (!prev || d.count > prev.count) dupMap.set(key, d)
  }
  const duplicates = [...dupMap.values()].sort((a, b) => b.count - a.count)

  const clusters = findConceptClusters(writerPrompt)
  const contradictions = findContradictions(writerPrompt)
  const instructionCount = instructionLines.length
  const instructionDensity =
    tokensEstimate > 0 ? Number((instructionCount / tokensEstimate).toFixed(4)) : 0

  const redundancyScore = computeRedundancyScore(
    duplicates,
    clusters,
    instructionCount,
    tokensEstimate,
  )
  const complexityScore = computeComplexityScore({
    sectionCount,
    tokensEstimate,
    redundancyScore,
    instructionCount,
  })

  const summary = buildSummary({
    tokensEstimate,
    characters,
    sectionCount,
    duplicates,
    clusters,
    contradictions,
    redundancyScore,
    complexityScore,
    instructionCount,
  })

  return {
    characters,
    tokensEstimate,
    sections,
    sectionCount,
    averageSectionLength,
    duplicates,
    clusters,
    contradictions,
    instructionCount,
    instructionDensity,
    redundancyScore,
    complexityScore,
    summary,
    version: PROMPT_INSPECTOR_VERSION,
  }
}
