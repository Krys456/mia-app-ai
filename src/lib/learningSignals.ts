/**
 * Client store for internal conversation-reflection learning signals.
 * Calibrates future turns only — never shown in UI, never factual memory.
 */

export type LearningSignals = {
  workedWell: string[]
  neededClarification: string[]
  apparentPreferences: string[]
  mistakesToAvoid: string[]
  directive: string
  turnCount: number
  createdAt: number
}

const STORAGE_KEY = 'laife.learningSignals.v1'

function emptySignals(): LearningSignals {
  return {
    workedWell: [],
    neededClarification: [],
    apparentPreferences: [],
    mistakesToAvoid: [],
    directive: '',
    turnCount: 0,
    createdAt: Date.now(),
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function sanitizeLearningSignals(raw: unknown): LearningSignals | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (
    !isStringArray(s.workedWell) ||
    !isStringArray(s.neededClarification) ||
    !isStringArray(s.apparentPreferences) ||
    !isStringArray(s.mistakesToAvoid)
  ) {
    return null
  }
  return {
    workedWell: s.workedWell.slice(0, 8),
    neededClarification: s.neededClarification.slice(0, 8),
    apparentPreferences: s.apparentPreferences.slice(0, 8),
    mistakesToAvoid: s.mistakesToAvoid.slice(0, 8),
    directive: typeof s.directive === 'string' ? s.directive.slice(0, 2000) : '',
    turnCount: typeof s.turnCount === 'number' && Number.isFinite(s.turnCount) ? s.turnCount : 0,
    createdAt:
      typeof s.createdAt === 'number' && Number.isFinite(s.createdAt) ? s.createdAt : Date.now(),
  }
}

function readStore(): LearningSignals | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return sanitizeLearningSignals(JSON.parse(raw))
  } catch {
    return null
  }
}

function writeStore(signals: LearningSignals | null) {
  try {
    if (!signals) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(signals))
  } catch {
    /* ignore quota / private mode */
  }
}

/** Current session learning signals (invisible to the user). */
export function getLearningSignals(): LearningSignals | null {
  return readStore()
}

/** Persist signals after a completed assistant turn. */
export function saveLearningSignals(raw: unknown): LearningSignals | null {
  const signals = sanitizeLearningSignals(raw)
  if (!signals) return readStore()
  writeStore(signals)
  return signals
}

/**
 * Mark a conversation as completed (new chat).
 * Keeps preference / mistake signals so future chats stay calibrated;
 * clears transient “worked / clarify” lists from the closed thread.
 */
export function finalizeConversationLearning(): LearningSignals | null {
  const prior = readStore()
  if (!prior) return null
  const next: LearningSignals = {
    ...emptySignals(),
    apparentPreferences: prior.apparentPreferences.slice(0, 6),
    mistakesToAvoid: prior.mistakesToAvoid.slice(0, 6),
    turnCount: 0,
    createdAt: Date.now(),
  }
  const has =
    next.apparentPreferences.length > 0 || next.mistakesToAvoid.length > 0
  if (!has) {
    writeStore(null)
    return null
  }
  next.directive =
    'Conversation Reflection (sessione precedente chiusa): mantieni preferenze e evita errori noti. Non citarli.'
  writeStore(next)
  return next
}

export function clearLearningSignals() {
  writeStore(null)
}
