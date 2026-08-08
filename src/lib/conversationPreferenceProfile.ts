/**
 * Client store for temporary Conversation Preference Profile.
 * Session-scoped style preferences from Feedback Interpretation.
 * Persists for the current conversation until the user changes them.
 * Never shown in UI; never mentioned to the user.
 */

export type LengthPref = 'richer' | 'concise'
export type EmojiPref = 'more_expressive' | 'less_emoji' | 'no_emoji'
export type TechnicalityPref = 'simpler' | 'technical'
export type FormalityPref = 'warmer' | 'more_formal'
export type DepthPref = 'deeper'
export type QuestionsPref = 'fewer'
export type StructurePref = 'prose' | 'lists' | 'clearer'

export type ConversationPreferenceProfile = {
  length: LengthPref | null
  emoji: EmojiPref | null
  technicality: TechnicalityPref | null
  formality: FormalityPref | null
  depth: DepthPref | null
  questions: QuestionsPref | null
  structure: StructurePref | null
  updatedAt: number | null
  version: 1
}

const STORAGE_KEY = 'laife.conversationPreferenceProfile.v1'

function enumOrNull<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  if (typeof raw !== 'string') return null
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null
}

export function emptyConversationPreferenceProfile(): ConversationPreferenceProfile {
  return {
    length: null,
    emoji: null,
    technicality: null,
    formality: null,
    depth: null,
    questions: null,
    structure: null,
    updatedAt: null,
    version: 1,
  }
}

export function sanitizeConversationPreferenceProfile(
  raw: unknown,
): ConversationPreferenceProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const profile: ConversationPreferenceProfile = {
    length: enumOrNull(o.length, ['richer', 'concise'] as const),
    emoji: enumOrNull(o.emoji, ['more_expressive', 'less_emoji', 'no_emoji'] as const),
    technicality: enumOrNull(o.technicality, ['simpler', 'technical'] as const),
    formality: enumOrNull(o.formality, ['warmer', 'more_formal'] as const),
    depth: enumOrNull(o.depth, ['deeper'] as const),
    questions: enumOrNull(o.questions, ['fewer'] as const),
    structure: enumOrNull(o.structure, ['prose', 'lists', 'clearer'] as const),
    updatedAt:
      typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt)
        ? o.updatedAt
        : typeof o.updatedAt === 'string' && o.updatedAt
          ? Date.parse(o.updatedAt) || null
          : null,
    version: 1,
  }
  return profile
}

function hasAnyPreference(profile: ConversationPreferenceProfile): boolean {
  return Boolean(
    profile.length ||
      profile.emoji ||
      profile.technicality ||
      profile.formality ||
      profile.depth ||
      profile.questions ||
      profile.structure,
  )
}

export function getConversationPreferenceProfile(): ConversationPreferenceProfile | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const cleaned = sanitizeConversationPreferenceProfile(JSON.parse(raw))
    if (!cleaned || !hasAnyPreference(cleaned)) return null
    return cleaned
  } catch {
    return null
  }
}

export function saveConversationPreferenceProfile(
  profile: ConversationPreferenceProfile | null | undefined,
): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (!profile) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    const clean = sanitizeConversationPreferenceProfile(profile)
    if (!clean || !hasAnyPreference(clean)) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean))
  } catch {
    /* ignore */
  }
}

export function clearConversationPreferenceProfile(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
