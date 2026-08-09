import { COMFORT_TRAP_TOPICS, TOPIC_LIBRARY, type TopicSeed } from './topicLibrary'

/** Structural fingerprints extracted from an assistant message. */

export interface MessageFingerprints {
  openingStyle: string
  concepts: string[]
  metaphors: string[]
  sentenceStructures: string[]
  topicIds: string[]
  tokens: Set<string>
  bigrams: Set<string>
}

export interface TopicMemoryEntry {
  messageId?: string
  topicIds: string[]
  concepts: string[]
  metaphors: string[]
  openingStyle: string
  sentenceStructures: string[]
  content: string
  createdAt: number
}

export interface TopicMemory {
  /** Chronological assistant entries (newest last) */
  recent: TopicMemoryEntry[]
  /** Topics suppressed after user pivot signals */
  suppressedTopicIds: string[]
  /** Comfort-trap concepts recently overused */
  repeatedConcepts: string[]
  lastPivotAt: number | null
}

export const MEMORY_WINDOW = 10
export const MAX_SUPPRESSED = 12

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'in', 'on', 'at', 'to', 'for', 'of', 'is', 'are',
  'was', 'were', 'be', 'been', 'with', 'as', 'by', 'from', 'that', 'this', 'it', 'you', 'i',
  'we', 'they', 'he', 'she', 'my', 'your', 'our', 'me', 'not', 'so', 'just', 'like', 'about',
  'what', 'how', 'when', 'where', 'who', 'why', 'can', 'will', 'do', 'did', 'have', 'has',
  'here', 'there', 'out', 'up', 'more', 'some', 'any', 'all', 'one', 'two', 'into', 'than',
  'un', 'una', 'il', 'lo', 'la', 'i', 'gli', 'le', 'di', 'da', 'in', 'con', 'per', 'che',
  'non', 'sono', 'sei', 'mi', 'ti', 'ci', 'vi', 'su', 'anche', 'come', 'più', 'piu',
])

const COMFORT_CONCEPTS = [
  'habit', 'habits', 'routine', 'routines', 'productivity', 'wellness', 'self-care',
  'selfcare', 'small step', 'small steps', 'daily', 'morning', 'checklist', 'optimize',
  'abitudin', 'routine', 'produttivit', 'benessere',
]

const METAPHOR_CUES = [
  'like a', 'like an', 'as if', 'as though', 'kind of like', 'sort of like',
  'come un', 'come una', 'quasi come',
]

export function createEmptyMemory(): TopicMemory {
  return {
    recent: [],
    suppressedTopicIds: [],
    repeatedConcepts: [],
    lastPivotAt: null,
  }
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*_`#>[\]()]/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
}

export function openingStyleOf(text: string): string {
  const first = text.trim().split(/\n/)[0] ?? ''
  const cleaned = first.replace(/[*_]/g, '').trim()
  if (!cleaned) return 'empty'
  if (/^[^.!?]+[?!]$/.test(cleaned.slice(0, 120))) return 'question-open'
  if (/^(hey|hi|ciao|okay|ok|got it|capito|ecco|here's|here is|wild|look)/i.test(cleaned)) {
    return `greeting:${cleaned.slice(0, 24).toLowerCase()}`
  }
  if (/^\d+\./.test(cleaned) || /^- /.test(cleaned)) return 'list-open'
  if (/^(i hear|i'm with|thanks for|got it)/i.test(cleaned)) return 'empathy-template'
  return `lead:${cleaned.slice(0, 40).toLowerCase()}`
}

export function extractMetaphors(text: string): string[] {
  const lower = text.toLowerCase()
  const found: string[] = []
  for (const cue of METAPHOR_CUES) {
    let idx = 0
    while ((idx = lower.indexOf(cue, idx)) !== -1) {
      const snippet = lower.slice(idx, idx + 48).replace(/\s+/g, ' ').trim()
      found.push(snippet)
      idx += cue.length
    }
  }
  return [...new Set(found)].slice(0, 6)
}

export function sentenceStructuresOf(text: string): string[] {
  const sentences = text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8)

  return sentences.slice(0, 8).map((s) => {
    const tokens = tokenize(s)
    const shape = [
      /^(\d+|[•*-])/.test(s.trim()) ? 'LIST' : 'PROSE',
      tokens.length < 8 ? 'SHORT' : tokens.length < 18 ? 'MED' : 'LONG',
      /\?$/.test(s.trim()) || s.includes('?') ? 'Q' : 'S',
      tokens.slice(0, 3).join('-') || 'x',
    ]
    return shape.join('|')
  })
}

export function detectConcepts(text: string): string[] {
  const lower = normalizeText(text)
  const concepts = new Set<string>()

  for (const c of COMFORT_CONCEPTS) {
    if (lower.includes(c)) concepts.add(c)
  }

  for (const topic of TOPIC_LIBRARY) {
    for (const concept of topic.concepts) {
      if (lower.includes(concept.toLowerCase())) concepts.add(concept.toLowerCase())
    }
    if (lower.includes(topic.label.toLowerCase())) concepts.add(topic.label.toLowerCase())
  }

  return [...concepts]
}

export function matchTopicsInText(text: string): string[] {
  const lower = normalizeText(text)
  const scored: Array<{ id: string; score: number }> = []

  for (const topic of TOPIC_LIBRARY) {
    let score = 0
    if (lower.includes(topic.label.toLowerCase())) score += 3
    for (const concept of topic.concepts) {
      if (lower.includes(concept.toLowerCase())) score += 2
    }
    for (const spark of topic.sparks) {
      const overlap = jaccard(
        new Set(tokenize(spark)),
        new Set(tokenize(text)),
      )
      if (overlap > 0.18) score += 2
    }
    if (score > 0) scored.push({ id: topic.id, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 3).map((s) => s.id)
}

export function fingerprintMessage(text: string): MessageFingerprints {
  const tokens = new Set(tokenize(text))
  const tokenList = [...tokens]
  const bigrams = new Set<string>()
  for (let i = 0; i < tokenList.length - 1; i++) {
    bigrams.add(`${tokenList[i]}|${tokenList[i + 1]}`)
  }

  return {
    openingStyle: openingStyleOf(text),
    concepts: detectConcepts(text),
    metaphors: extractMetaphors(text),
    sentenceStructures: sentenceStructuresOf(text),
    topicIds: matchTopicsInText(text),
    tokens,
    bigrams,
  }
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

export function rememberAssistantMessage(
  memory: TopicMemory,
  content: string,
  messageId?: string,
): TopicMemory {
  const fp = fingerprintMessage(content)
  const entry: TopicMemoryEntry = {
    messageId,
    topicIds: fp.topicIds,
    concepts: fp.concepts,
    metaphors: fp.metaphors,
    openingStyle: fp.openingStyle,
    sentenceStructures: fp.sentenceStructures,
    content,
    createdAt: Date.now(),
  }

  const recent = [...memory.recent, entry].slice(-MEMORY_WINDOW)
  const conceptCounts = new Map<string, number>()
  for (const e of recent) {
    for (const c of e.concepts) {
      conceptCounts.set(c, (conceptCounts.get(c) ?? 0) + 1)
    }
  }
  const repeatedConcepts = [...conceptCounts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([c]) => c)

  return {
    ...memory,
    recent,
    repeatedConcepts,
  }
}

export function applyPivotSuppression(
  memory: TopicMemory,
  topicIdsToSuppress: string[],
): TopicMemory {
  const suppressed = [
    ...new Set([...memory.suppressedTopicIds, ...topicIdsToSuppress, ...COMFORT_TRAP_TOPICS]),
  ].slice(-MAX_SUPPRESSED)

  return {
    ...memory,
    suppressedTopicIds: suppressed,
    lastPivotAt: Date.now(),
  }
}

export function recentTopicIds(memory: TopicMemory): string[] {
  return memory.recent.flatMap((e) => e.topicIds)
}

export function recentOpeningStyles(memory: TopicMemory): string[] {
  return memory.recent.map((e) => e.openingStyle)
}

export function rebuildMemoryFromMessages(
  assistantContents: string[],
): TopicMemory {
  let memory = createEmptyMemory()
  for (const content of assistantContents.slice(-MEMORY_WINDOW)) {
    memory = rememberAssistantMessage(memory, content)
  }
  return memory
}

export function pickFreshTopic(
  memory: TopicMemory,
  opts?: { forceAvoidComfort?: boolean; preferCategories?: string[] },
): TopicSeed {
  const used = new Set([
    ...recentTopicIds(memory),
    ...memory.suppressedTopicIds,
  ])

  if (opts?.forceAvoidComfort) {
    for (const trap of COMFORT_TRAP_TOPICS) used.add(trap)
  }

  let pool = TOPIC_LIBRARY.filter((t) => !used.has(t.id))
  if (opts?.preferCategories?.length) {
    const preferred = pool.filter((t) =>
      opts.preferCategories!.includes(t.category),
    )
    if (preferred.length) pool = preferred
  }

  if (!pool.length) {
    // Soft reset: allow anything except the very last topic
    const last = memory.recent.at(-1)?.topicIds[0]
    pool = TOPIC_LIBRARY.filter((t) => t.id !== last)
  }

  const idx = Math.floor(Math.random() * pool.length)
  return pool[idx] ?? TOPIC_LIBRARY[0]
}
