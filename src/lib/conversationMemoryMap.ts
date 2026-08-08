/**
 * Client store for Conversation Memory Map.
 * Evolves across turns; never shown in UI; not factual long-term memory.
 */

export type ConversationMemoryMap = {
  exploredTopics: string[]
  unansweredQuestions: string[]
  ongoingProjects: string[]
  userGoals: string[]
  explanationsGiven: string[]
  misconceptionsCorrected: string[]
  futureIdeasIntroduced: string[]
  activeTopic: string | null
  updatedAt: number
  turnCount: number
}

const STORAGE_KEY = 'laife.conversationMemoryMap.v1'

function listField(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim().slice(0, 96))
    .slice(-max)
}

export function sanitizeConversationMemoryMap(raw: unknown): ConversationMemoryMap | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  return {
    exploredTopics: listField(o.exploredTopics, 12),
    unansweredQuestions: listField(o.unansweredQuestions, 8),
    ongoingProjects: listField(o.ongoingProjects, 6),
    userGoals: listField(o.userGoals, 6),
    explanationsGiven: listField(o.explanationsGiven, 10),
    misconceptionsCorrected: listField(o.misconceptionsCorrected, 6),
    futureIdeasIntroduced: listField(o.futureIdeasIntroduced, 6),
    activeTopic:
      typeof o.activeTopic === 'string' && o.activeTopic.trim()
        ? o.activeTopic.trim().slice(0, 64)
        : null,
    updatedAt:
      typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : Date.now(),
    turnCount:
      typeof o.turnCount === 'number' && Number.isFinite(o.turnCount) ? o.turnCount : 0,
  }
}

export function getConversationMemoryMap(): ConversationMemoryMap | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return sanitizeConversationMemoryMap(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveConversationMemoryMap(map: ConversationMemoryMap | null | undefined): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (!map) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    const clean = sanitizeConversationMemoryMap(map)
    if (!clean) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean))
  } catch {
    /* ignore */
  }
}

export function clearConversationMemoryMap(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
