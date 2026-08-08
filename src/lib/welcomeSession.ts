/**
 * Client store for Welcome Experience Engine session.
 * Tracks used greetings/strategies + lastSeen for pause detection.
 * Invisible — never shown in UI, never factual memory.
 */

export type WelcomeSession = {
  usedGreetingIds: string[]
  usedStrategies: string[]
  welcomeCount: number
  lastSeenAt: number
  updatedAt: number
}

const STORAGE_KEY = 'laife.welcomeSession.v1'

function emptySession(): WelcomeSession {
  return {
    usedGreetingIds: [],
    usedStrategies: [],
    welcomeCount: 0,
    lastSeenAt: 0,
    updatedAt: Date.now(),
  }
}

export function sanitizeWelcomeSession(raw: unknown): WelcomeSession | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (!Array.isArray(s.usedGreetingIds)) return null
  return {
    usedGreetingIds: s.usedGreetingIds
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.slice(0, 40))
      .slice(-48),
    usedStrategies: Array.isArray(s.usedStrategies)
      ? s.usedStrategies
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.slice(0, 40))
          .slice(-12)
      : [],
    welcomeCount:
      typeof s.welcomeCount === 'number' && Number.isFinite(s.welcomeCount) ? s.welcomeCount : 0,
    lastSeenAt:
      typeof s.lastSeenAt === 'number' && Number.isFinite(s.lastSeenAt)
        ? s.lastSeenAt
        : typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt)
          ? s.updatedAt
          : 0,
    updatedAt:
      typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt) ? s.updatedAt : Date.now(),
  }
}

function readStore(): WelcomeSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return sanitizeWelcomeSession(JSON.parse(raw))
  } catch {
    return null
  }
}

function writeStore(session: WelcomeSession | null) {
  try {
    if (!session) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    /* ignore */
  }
}

export function getWelcomeSession(): WelcomeSession | null {
  return readStore()
}

export function saveWelcomeSession(session: WelcomeSession | null) {
  const clean = session ? sanitizeWelcomeSession(session) : null
  writeStore(clean)
}

/** Soft bump — keeps used greetings to avoid repeats. */
export function bumpWelcomeCount() {
  const cur = readStore() || emptySession()
  const now = Date.now()
  writeStore({
    ...cur,
    welcomeCount: cur.welcomeCount + 1,
    lastSeenAt: now,
    updatedAt: now,
  })
}
