/**
 * #310C3 — Durable Calendar diagnostics client store.
 *
 * Survives OAuth round-trips by dual-writing sessionStorage + localStorage,
 * keeps ?calendar_diag=1 visible in the URL, and notifies the on-screen panel.
 * SAFE fields only — never tokens, JWTs, secrets, or event titles.
 */

export const CALENDAR_DIAG_EVENT = 'shinkaido:calendar-diag'
export const CALENDAR_DIAG_FLAG_KEY = 'shinkaido.calendar.diag'
export const CALENDAR_DIAG_CID_KEY = 'shinkaido.calendar.correlationId'
export const CALENDAR_DIAG_OAUTH_KEY = 'shinkaido.calendar.lastOauthStartDiag'
export const CALENDAR_DIAG_CONNECTION_KEY = 'shinkaido.calendar.lastConnectionDiag'
export const CALENDAR_DIAG_CHAT_KEY = 'shinkaido.calendar.lastChatDiag'
export const CALENDAR_DIAG_META_KEY = 'shinkaido.calendar.diagMeta'
export const CALENDAR_DIAG_CLIENT_BUILD = '310F-1'

function canUseStorage(): boolean {
  return typeof window !== 'undefined'
}

function readStorage(storage: Storage | undefined, key: string): string | null {
  if (!storage) return null
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(storage: Storage | undefined, key: string, value: string): boolean {
  if (!storage) return false
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function sessionStore(): Storage | undefined {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : undefined
  } catch {
    return undefined
  }
}

function localStore(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined
  } catch {
    return undefined
  }
}

export function notifyCalendarDiagUpdated(detail?: Record<string, unknown>): void {
  if (!canUseStorage()) return
  try {
    window.dispatchEvent(new CustomEvent(CALENDAR_DIAG_EVENT, { detail: detail || {} }))
  } catch {
    /* soft */
  }
}

export function enableCalendarDiagMode(reason = 'manual'): void {
  if (!canUseStorage()) return
  writeStorage(sessionStore(), CALENDAR_DIAG_FLAG_KEY, '1')
  writeStorage(localStore(), CALENDAR_DIAG_FLAG_KEY, '1')
  writeStorage(
    sessionStore(),
    CALENDAR_DIAG_META_KEY,
    JSON.stringify({
      diagBuild: CALENDAR_DIAG_CLIENT_BUILD,
      enabledAt: new Date().toISOString(),
      reason,
      origin: window.location.origin,
    }),
  )
  ensureCalendarDiagInUrl()
  notifyCalendarDiagUpdated({ phase: 'enabled', reason })
}

export function isCalendarDiagModeEnabled(): boolean {
  if (!canUseStorage()) return false
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get('calendar_diag') === '1') return true
  } catch {
    /* soft */
  }
  return (
    readStorage(sessionStore(), CALENDAR_DIAG_FLAG_KEY) === '1' ||
    readStorage(localStore(), CALENDAR_DIAG_FLAG_KEY) === '1'
  )
}

/** Detect URL flag / return params and persist diag mode early (App root). */
export function bootstrapCalendarDiagMode(): boolean {
  if (!canUseStorage()) return false
  try {
    const url = new URL(window.location.href)
    const urlOn = url.searchParams.get('calendar_diag') === '1'
    const persisted =
      readStorage(sessionStore(), CALENDAR_DIAG_FLAG_KEY) === '1' ||
      readStorage(localStore(), CALENDAR_DIAG_FLAG_KEY) === '1'

    if (urlOn || persisted) {
      enableCalendarDiagMode(urlOn ? 'url' : 'persisted')
      return true
    }
  } catch {
    /* soft */
  }
  return false
}

export function ensureCalendarDiagInUrl(): void {
  if (!canUseStorage() || !isCalendarDiagModeEnabled()) return
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get('calendar_diag') === '1') return
    url.searchParams.set('calendar_diag', '1')
    const next = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState({}, '', next || '/')
  } catch {
    /* soft */
  }
}

export function writeCalendarDiagSnapshot(
  key:
    | typeof CALENDAR_DIAG_OAUTH_KEY
    | typeof CALENDAR_DIAG_CONNECTION_KEY
    | typeof CALENDAR_DIAG_CHAT_KEY
    | typeof CALENDAR_DIAG_CID_KEY,
  value: unknown,
): boolean {
  if (!canUseStorage()) return false
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  const okSession = writeStorage(sessionStore(), key, raw)
  const okLocal = writeStorage(localStore(), key, raw)
  notifyCalendarDiagUpdated({ key })
  return okSession || okLocal
}

export function readCalendarDiagSnapshot(key: string): Record<string, unknown> | null {
  const raw = readStorage(sessionStore(), key) || readStorage(localStore(), key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function readCalendarDiagCorrelationId(): string | null {
  return (
    readStorage(sessionStore(), CALENDAR_DIAG_CID_KEY) ||
    readStorage(localStore(), CALENDAR_DIAG_CID_KEY)
  )
}

export function frontendSupabaseProjectRef(): string | null {
  try {
    const viteUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim()
    if (!viteUrl) return null
    const host = new URL(viteUrl).hostname.toLowerCase()
    const m = /^([a-z0-9-]+)\.supabase\.co$/.exec(host)
    return m ? m[1] : host
  } catch {
    return null
  }
}
