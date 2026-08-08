/**
 * Client store for Welcome Engine session (used greeting ids).
 * Invisible — never shown in UI, never factual memory.
 */

export type WelcomeSession = {
  usedGreetingIds: string[]
  welcomeCount: number
  updatedAt: number
}

const STORAGE_KEY = 'laife.welcomeSession.v1'

function emptySession(): WelcomeSession {
  return {
    usedGreetingIds: [],
    welcomeCount: 0,
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
      .slice(-40),
    welcomeCount:
      typeof s.welcomeCount === 'number' && Number.isFinite(s.welcomeCount) ? s.welcomeCount : 0,
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

/** Soft reset on explicit preference clear — keeps used greetings to avoid repeats. */
export function bumpWelcomeCount() {
  const cur = readStore() || emptySession()
  writeStore({ ...cur, welcomeCount: cur.welcomeCount + 1, updatedAt: Date.now() })
}
