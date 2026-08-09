import {
  fingerprintMessage,
  jaccard,
  type MessageFingerprints,
  type TopicMemory,
  type TopicMemoryEntry,
} from './topicMemory'

export interface NoveltyReport {
  /** 0–1 where 1 = fully novel vs recent history */
  score: number
  /** True when rewrite is required */
  shouldRewrite: boolean
  maxSimilarity: number
  reasons: string[]
  fingerprint: MessageFingerprints
}

/** Similarity above this vs any of last N messages → rewrite. */
export const SIMILARITY_REWRITE_THRESHOLD = 0.42
/** Novelty below this → rewrite. */
export const NOVELTY_FLOOR = 0.55

function entryToSets(entry: TopicMemoryEntry): {
  tokens: Set<string>
  bigrams: Set<string>
  structures: Set<string>
  concepts: Set<string>
} {
  const fp = fingerprintMessage(entry.content)
  return {
    tokens: fp.tokens,
    bigrams: fp.bigrams,
    structures: new Set(entry.sentenceStructures),
    concepts: new Set(entry.concepts),
  }
}

export function similarityToEntry(
  candidate: MessageFingerprints,
  entry: TopicMemoryEntry,
): number {
  const prior = entryToSets(entry)
  const tokenSim = jaccard(candidate.tokens, prior.tokens)
  const bigramSim = jaccard(candidate.bigrams, prior.bigrams)
  const structureSim = jaccard(
    new Set(candidate.sentenceStructures),
    prior.structures,
  )
  const conceptSim = jaccard(new Set(candidate.concepts), prior.concepts)
  const openingSame =
    candidate.openingStyle &&
    candidate.openingStyle === entry.openingStyle
      ? 1
      : 0
  const metaphorSim = jaccard(
    new Set(candidate.metaphors),
    new Set(entry.metaphors),
  )

  return (
    tokenSim * 0.34 +
    bigramSim * 0.22 +
    structureSim * 0.14 +
    conceptSim * 0.14 +
    openingSame * 0.1 +
    metaphorSim * 0.06
  )
}

export function scoreNovelty(
  candidateText: string,
  memory: TopicMemory,
  options?: { threshold?: number; noveltyFloor?: number },
): NoveltyReport {
  const threshold = options?.threshold ?? SIMILARITY_REWRITE_THRESHOLD
  const noveltyFloor = options?.noveltyFloor ?? NOVELTY_FLOOR
  const fingerprint = fingerprintMessage(candidateText)
  const reasons: string[] = []

  if (memory.recent.length === 0) {
    return {
      score: 1,
      shouldRewrite: false,
      maxSimilarity: 0,
      reasons: ['no-history'],
      fingerprint,
    }
  }

  let maxSimilarity = 0
  for (const entry of memory.recent) {
    const sim = similarityToEntry(fingerprint, entry)
    if (sim > maxSimilarity) maxSimilarity = sim
  }

  if (maxSimilarity >= threshold) {
    reasons.push(`high-similarity:${maxSimilarity.toFixed(2)}`)
  }

  const recentOpenings = memory.recent.map((e) => e.openingStyle)
  if (
    fingerprint.openingStyle &&
    recentOpenings.filter((o) => o === fingerprint.openingStyle).length >= 2
  ) {
    reasons.push(`repeated-opening:${fingerprint.openingStyle}`)
    maxSimilarity = Math.max(maxSimilarity, threshold)
  }

  const recentMetaphors = new Set(memory.recent.flatMap((e) => e.metaphors))
  for (const m of fingerprint.metaphors) {
    if (recentMetaphors.has(m)) {
      reasons.push(`repeated-metaphor`)
      maxSimilarity = Math.max(maxSimilarity, threshold * 0.95)
      break
    }
  }

  for (const c of fingerprint.concepts) {
    if (memory.repeatedConcepts.includes(c)) {
      reasons.push(`repeated-concept:${c}`)
      maxSimilarity = Math.max(maxSimilarity, threshold * 0.9)
    }
  }

  const score = Math.max(0, Math.min(1, 1 - maxSimilarity))
  const shouldRewrite =
    score < noveltyFloor || maxSimilarity >= threshold || reasons.some((r) =>
      r.startsWith('repeated-opening'),
    )

  return {
    score,
    shouldRewrite,
    maxSimilarity,
    reasons: reasons.length ? reasons : ['ok'],
    fingerprint,
  }
}

/** Writer rule helper: have we talked about something very similar recently? */
export function hasTalkedAboutSimilarRecently(
  candidateText: string,
  memory: TopicMemory,
): boolean {
  return scoreNovelty(candidateText, memory).shouldRewrite
}
