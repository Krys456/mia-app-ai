/**
 * #337B — Client helpers for Google Gmail connection (metadata only) + read-only
 * structured email queries used by the local Email chat router.
 *
 * Calls Supabase Edge Functions with the anonymous ShinkAIdo JWT.
 * NEVER stores Google tokens in localStorage or React state.
 *
 * Settings UI is always visible. Server EMAIL_ENABLED gates real OAuth/ops
 * (Edge returns email_disabled / 404 when off).
 *
 * Read-only: this client never sends, replies to, or deletes messages.
 */

import { resolveChatAuthForRequest } from './chatAuth.ts'
import { isSupabaseConfigured } from './supabase.ts'

export type EmailConnectionStatus =
  | 'disconnected'
  | 'pending'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'reconnect_required'
  | 'revoked'

export type EmailConnectionPublic = {
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

export type EmailMessagePublic = {
  id: string
  threadId: string | null
  from: string | null
  fromEmail: string | null
  subject: string | null
  snippet: string | null
  receivedAt: string | null
  unread: boolean
  /** Only present for a single-message body_one fetch (never bulk lists). */
  bodyText?: string | null
}

export type EmailQueryStatus =
  | 'ok'
  | 'empty'
  | 'disabled'
  | 'disconnected'
  | 'reconnect_required'
  | 'timeout'
  | 'error'
  | 'no_sender_match'

export type EmailQueryPayload = {
  action?: 'email_query'
  queryType: string
  sender?: string | null
  timeWindow?: string | null
  timeZone?: string | null
  messageId?: string | null
  includeBody?: boolean
  maxResults?: number
}

export type EmailQueryResult = {
  ok: boolean
  status: EmailQueryStatus
  messages: EmailMessagePublic[]
  fetchedAt: string
  timeZone: string | null
  queryType: string
  code?: string
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

export async function fetchEmailConnectionStatus(): Promise<{
  ok: boolean
  connection: EmailConnectionPublic | null
  code?: string
}> {
  const base = supabaseFunctionsBase()
  const headers = await edgeHeaders()
  if (!base || !headers) return { ok: false, connection: null, code: 'auth_unavailable' }

  const res = await fetch(`${base}/functions/v1/email-connection`, {
    method: 'GET',
    headers,
  })
  if (res.status === 404) return { ok: false, connection: null, code: 'email_disabled' }
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
  const body = (await res.json()) as { connection?: EmailConnectionPublic }
  return { ok: true, connection: body.connection ?? null }
}

export async function startGoogleGmailOAuth(): Promise<{
  ok: boolean
  authorizeUrl?: string
  code?: string
}> {
  const base = supabaseFunctionsBase()
  const headers = await edgeHeaders()
  if (!base || !headers) return { ok: false, code: 'auth_unavailable' }

  let returnOrigin: string | undefined
  try {
    returnOrigin = window.location.origin
  } catch {
    /* soft */
  }

  const res = await fetch(`${base}/functions/v1/email-oauth-start`, {
    method: 'POST',
    headers,
    body: JSON.stringify(returnOrigin ? { returnOrigin } : {}),
  })
  if (res.status === 404) return { ok: false, code: 'email_disabled' }
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
  const body = (await res.json()) as { authorizeUrl?: string }
  if (!body.authorizeUrl || !body.authorizeUrl.startsWith('https://accounts.google.com/')) {
    return { ok: false, code: 'authorize_url_invalid' }
  }
  return { ok: true, authorizeUrl: body.authorizeUrl }
}

export async function disconnectGoogleGmail(): Promise<{
  ok: boolean
  connection: EmailConnectionPublic | null
  code?: string
}> {
  const base = supabaseFunctionsBase()
  const headers = await edgeHeaders()
  if (!base || !headers) return { ok: false, connection: null, code: 'auth_unavailable' }

  const res = await fetch(`${base}/functions/v1/email-connection`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'disconnect' }),
  })
  if (res.status === 404) return { ok: false, connection: null, code: 'email_disabled' }
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
  const body = (await res.json()) as { connection?: EmailConnectionPublic }
  return { ok: true, connection: body.connection ?? null }
}

/** Map URL query ?email=… after OAuth return. */
export function consumeEmailReturnQuery(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const url = new URL(window.location.href)
    const flag = url.searchParams.get('email')
    if (!flag) return null
    url.searchParams.delete('email')
    url.searchParams.delete('code')
    const next = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState({}, '', next || '/')
    return flag
  } catch {
    return null
  }
}

/**
 * Map HTTP / body status to a safe client EmailQueryResult.
 * Never invents messages — empty on any non-ok/non-empty status.
 */
export function mapEmailQueryResponse(
  res: { status: number; ok?: boolean },
  body: Record<string, unknown>,
  payload: EmailQueryPayload,
): EmailQueryResult {
  const fetchedAt = new Date().toISOString()
  const queryType = payload.queryType
  const timeZone = (typeof body.timeZone === 'string' ? body.timeZone : payload.timeZone) || null

  if (typeof body.status === 'string') {
    const status = body.status as EmailQueryStatus
    return {
      ok: status === 'ok' || status === 'empty',
      status,
      messages: Array.isArray(body.messages) ? (body.messages as EmailMessagePublic[]) : [],
      fetchedAt: typeof body.fetchedAt === 'string' ? body.fetchedAt : fetchedAt,
      timeZone,
      queryType,
      code: typeof body.code === 'string' ? body.code : undefined,
    }
  }

  const code = typeof body.code === 'string' ? body.code : ''

  if (res.status === 404 || code === 'email_disabled') {
    return { ok: false, status: 'disabled', messages: [], fetchedAt, timeZone, queryType, code: code || 'email_disabled' }
  }
  if (
    res.status === 401 ||
    res.status === 403 ||
    code === 'unauthorized' ||
    code === 'auth_required' ||
    code === 'auth_unavailable'
  ) {
    return {
      ok: false,
      status: 'disconnected',
      messages: [],
      fetchedAt,
      timeZone,
      queryType,
      code: code || 'auth_required',
    }
  }
  if (code === 'reconnect_required') {
    return { ok: false, status: 'reconnect_required', messages: [], fetchedAt, timeZone, queryType, code }
  }
  if (
    res.status === 429 ||
    res.status === 503 ||
    code === 'rate_limit_exceeded' ||
    code === 'rate_limit_unavailable'
  ) {
    return { ok: false, status: 'timeout', messages: [], fetchedAt, timeZone, queryType, code: code || 'rate_limit' }
  }

  return {
    ok: false,
    status: 'error',
    messages: [],
    fetchedAt,
    timeZone,
    queryType,
    code: code || (res.ok ? 'invalid_pack' : 'http_error'),
  }
}

/**
 * Structured, read-only Gmail query. Only whitelisted fields are sent — never
 * free-text search strings from the model.
 */
export async function requestEmailQuery(payload: EmailQueryPayload): Promise<EmailQueryResult> {
  const fetchedAt = new Date().toISOString()
  const base = supabaseFunctionsBase()
  const headers = await edgeHeaders()
  if (!base || !headers) {
    return {
      ok: false,
      status: 'disconnected',
      messages: [],
      fetchedAt,
      timeZone: payload.timeZone || null,
      queryType: payload.queryType,
      code: 'auth_unavailable',
    }
  }

  let res: Response
  try {
    res = await fetch(`${base}/functions/v1/email-query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'email_query',
        queryType: payload.queryType,
        sender: payload.sender || undefined,
        timeWindow: payload.timeWindow || undefined,
        timeZone: payload.timeZone || undefined,
        messageId: payload.messageId || undefined,
        includeBody: payload.includeBody || undefined,
        maxResults: payload.maxResults || undefined,
      }),
    })
  } catch {
    return {
      ok: false,
      status: 'error',
      messages: [],
      fetchedAt,
      timeZone: payload.timeZone || null,
      queryType: payload.queryType,
      code: 'network',
    }
  }

  let body: Record<string, unknown> = {}
  try {
    body = await res.json()
  } catch {
    body = {}
  }

  return mapEmailQueryResponse(res, body, payload)
}
