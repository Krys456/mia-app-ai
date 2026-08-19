/**
 * #304A1 — Client helpers for Google Calendar connection (metadata only).
 *
 * Calls Supabase Edge Functions with the anonymous ShinkAIdo JWT.
 * NEVER stores Google tokens in localStorage or React state.
 *
 * Settings UI is always visible. Server CALENDAR_ENABLED gates real OAuth/ops
 * (Edge returns calendar_disabled / 404 when off).
 */

import { resolveChatAuthForRequest } from './chatAuth.ts'
import { isSupabaseConfigured } from './supabase.ts'

export type CalendarConnectionStatus =
  | 'disconnected'
  | 'pending'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'reconnect_required'
  | 'revoked'

export type CalendarConnectionPublic = {
  status: string
  provider: string
  accountEmail: string | null
  scopes: string[]
  connected: boolean
  readOnly: boolean
  lastErrorCode: string | null
  disconnectedAt: string | null
  updatedAt: string | null
}

function supabaseFunctionsBase(): string | null {
  const url = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
  const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()
  if (!url || !anon) return null
  return url
}

function anonKey(): string {
  return (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()
}

async function edgeHeaders(): Promise<HeadersInit | null> {
  if (!isSupabaseConfigured()) return null
  const { authorization } = await resolveChatAuthForRequest()
  if (!authorization) return null
  return {
    Authorization: authorization,
    apikey: anonKey(),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

export async function fetchCalendarConnectionStatus(): Promise<{
  ok: boolean
  connection: CalendarConnectionPublic | null
  code?: string
}> {
  const base = supabaseFunctionsBase()
  const headers = await edgeHeaders()
  if (!base || !headers) return { ok: false, connection: null, code: 'auth_unavailable' }

  const res = await fetch(`${base}/functions/v1/calendar-connection`, {
    method: 'GET',
    headers,
  })
  if (res.status === 404) return { ok: false, connection: null, code: 'calendar_disabled' }
  if (!res.ok) {
    let code = 'status_failed'
    try {
      const body = await res.json()
      if (typeof body?.code === 'string') code = body.code
    } catch {
      /* soft */
    }
    return { ok: false, connection: null, code }
  }
  const body = (await res.json()) as { connection?: CalendarConnectionPublic }
  return { ok: true, connection: body.connection ?? null }
}

export async function startGoogleCalendarOAuth(): Promise<{
  ok: boolean
  authorizeUrl?: string
  code?: string
  correlationId?: string
  diag?: Record<string, unknown>
}> {
  const base = supabaseFunctionsBase()
  const headers = await edgeHeaders()
  if (!base || !headers) return { ok: false, code: 'auth_unavailable' }

  const correlationId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `cid-${Date.now()}`

  const res = await fetch(`${base}/functions/v1/calendar-oauth-start`, {
    method: 'POST',
    headers,
    // Bind callback return to THIS browser origin (HMAC-signed server-side).
    body: JSON.stringify({
      returnOrigin: typeof window !== 'undefined' ? window.location.origin : '',
      correlationId,
    }),
  })
  if (res.status === 404) return { ok: false, code: 'calendar_disabled' }
  if (!res.ok) {
    let code = 'oauth_start_failed'
    try {
      const body = await res.json()
      if (typeof body?.code === 'string') code = body.code
    } catch {
      /* soft */
    }
    return { ok: false, code }
  }
  const body = (await res.json()) as {
    authorizeUrl?: string
    correlationId?: string
    diag?: Record<string, unknown>
  }
  if (!body.authorizeUrl || !body.authorizeUrl.startsWith('https://accounts.google.com/')) {
    return { ok: false, code: 'authorize_url_invalid' }
  }
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('shinkaido.calendar.correlationId', body.correlationId || correlationId)
      if (body.diag) sessionStorage.setItem('shinkaido.calendar.lastOauthStartDiag', JSON.stringify(body.diag))
    }
  } catch {
    /* soft */
  }
  return {
    ok: true,
    authorizeUrl: body.authorizeUrl,
    correlationId: body.correlationId || correlationId,
    diag: body.diag,
  }
}

export async function disconnectGoogleCalendar(): Promise<{
  ok: boolean
  connection: CalendarConnectionPublic | null
  code?: string
}> {
  const base = supabaseFunctionsBase()
  const headers = await edgeHeaders()
  if (!base || !headers) return { ok: false, connection: null, code: 'auth_unavailable' }

  const res = await fetch(`${base}/functions/v1/calendar-connection`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'disconnect' }),
  })
  if (res.status === 404) return { ok: false, connection: null, code: 'calendar_disabled' }
  if (!res.ok) {
    let code = 'disconnect_failed'
    try {
      const body = await res.json()
      if (typeof body?.code === 'string') code = body.code
    } catch {
      /* soft */
    }
    return { ok: false, connection: null, code }
  }
  const body = (await res.json()) as { connection?: CalendarConnectionPublic }
  return { ok: true, connection: body.connection ?? null }
}

/** #310C — authenticated Edge connection diag (safe fields only). */
export async function fetchCalendarLiveDiag(): Promise<{
  ok: boolean
  diag?: Record<string, unknown>
  code?: string
}> {
  const base = supabaseFunctionsBase()
  const headers = await edgeHeaders()
  if (!base || !headers) return { ok: false, code: 'auth_unavailable' }

  const res = await fetch(`${base}/functions/v1/calendar-connection`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'diag' }),
  })
  if (res.status === 404) return { ok: false, code: 'calendar_disabled' }
  if (!res.ok) {
    let code = 'diag_failed'
    try {
      const body = await res.json()
      if (typeof body?.code === 'string') code = body.code
    } catch {
      /* soft */
    }
    return { ok: false, code }
  }
  const body = (await res.json()) as { diag?: Record<string, unknown> }
  return { ok: true, diag: body.diag }
}

/** Map URL query ?calendar=… after OAuth return. */
export function consumeCalendarReturnQuery(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const url = new URL(window.location.href)
    const flag = url.searchParams.get('calendar')
    const cid = url.searchParams.get('cid')
    if (cid) {
      try {
        sessionStorage.setItem('shinkaido.calendar.correlationId', cid)
        sessionStorage.setItem('shinkaido.calendar.diag', '1')
      } catch {
        /* soft */
      }
    }
    if (!flag) return null
    url.searchParams.delete('calendar')
    url.searchParams.delete('code')
    url.searchParams.delete('cid')
    const next = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState({}, '', next || '/')
    return flag
  } catch {
    return null
  }
}

export function isCalendarDiagModeEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get('calendar_diag') === '1') return true
    return sessionStorage.getItem('shinkaido.calendar.diag') === '1'
  } catch {
    return false
  }
}

export function enableCalendarDiagMode(): void {
  try {
    sessionStorage.setItem('shinkaido.calendar.diag', '1')
  } catch {
    /* soft */
  }
}
