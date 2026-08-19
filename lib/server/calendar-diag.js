/**
 * #310C — Temporary SAFE Calendar live-trace helpers.
 *
 * Never log tokens, JWTs, encryption keys, event titles, or pack bodies.
 * Opt-in only (Preview / CALENDAR_DIAG + client header).
 */

import { isCalendarEnabled } from './calendar-enabled.js'
import { resolveServerBuildId } from './request-id.js'

export const CALENDAR_DIAG_HEADER = 'x-shinkaido-calendar-diag'
export const CALENDAR_DIAG_BUILD = '310F-1'

/**
 * @param {unknown} uid
 * @returns {string | null}
 */
export function maskUid(uid) {
  const id = typeof uid === 'string' ? uid.trim() : ''
  if (id.length < 8) return id ? '…' : null
  return `${id.slice(0, 4)}…${id.slice(-4)}`
}

/**
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export function supabaseProjectRefFromUrl(url) {
  const raw = typeof url === 'string' ? url.trim() : ''
  if (!raw) return null
  try {
    const host = new URL(raw).hostname.toLowerCase()
    // xxx.supabase.co
    const m = /^([a-z0-9-]+)\.supabase\.co$/.exec(host)
    return m ? m[1] : host
  } catch {
    return null
  }
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isCalendarDiagEnvAllowed(env = process.env) {
  const flag = typeof env.CALENDAR_DIAG === 'string' ? env.CALENDAR_DIAG.trim().toLowerCase() : ''
  if (flag === '1' || flag === 'true' || flag === 'yes') return true
  const vercelEnv = typeof env.VERCEL_ENV === 'string' ? env.VERCEL_ENV.trim().toLowerCase() : ''
  return vercelEnv === 'preview'
}

/**
 * @param {{ headers?: Record<string, unknown> } | null | undefined} req
 * @param {Record<string, unknown> | null | undefined} [body]
 */
export function isCalendarDiagRequested(req, body) {
  const headers = req?.headers || {}
  const raw =
    headers[CALENDAR_DIAG_HEADER] ||
    headers['X-Shinkaido-Calendar-Diag'] ||
    headers['x-shinkaido-calendar-diag']
  const headerOn = String(raw || '').trim() === '1' || String(raw || '').toLowerCase() === 'true'
  const bodyOn = body && (body.calendarDiag === true || body.calendarDiag === 1 || body.calendarDiag === '1')
  return Boolean(headerOn || bodyOn)
}

/**
 * Infer safe trace flags from enrichment status/code (no extra Google calls).
 * @param {{
 *   intent?: string | null
 *   status?: string | null
 *   code?: string | null
 *   eventCount?: number
 *   used?: boolean
 *   pack?: string
 * }} enrichment
 */
export function buildCalendarTraceFromEnrichment(enrichment) {
  const intent = enrichment?.intent || 'none'
  const status = enrichment?.status || null
  const code = enrichment?.code || null
  const used = Boolean(enrichment?.used)
  const pack = typeof enrichment?.pack === 'string' ? enrichment.pack : ''
  const packAppended = pack.length > 0 && pack.includes('CALENDAR CONTEXT')
  const eventCount =
    typeof enrichment?.eventCount === 'number' && Number.isFinite(enrichment.eventCount)
      ? enrichment.eventCount
      : null

  let operation = null
  if (intent === 'connection') operation = 'connection'
  else if (intent === 'availability') operation = 'freeBusy'
  else if (intent === 'next') operation = 'listEvents_next'
  else if (intent === 'events') operation = 'listEvents'
  else if (intent === 'none') operation = null

  /** @type {boolean | null} */
  let rowFound = null
  /** @type {boolean | null} */
  let decryptReached = null
  /** @type {boolean | null} */
  let googleRequestReached = null
  /** @type {string | null} */
  let googleHttpResult = null
  /** @type {string | null} */
  let connectionStatus = null

  if (!used || intent === 'none') {
    return {
      intent,
      used: false,
      operation,
      rowFound,
      connectionStatus,
      decryptReached,
      tokenDecrypt: enrichment?.tokenDecrypt || 'NOT_REACHED',
      preGoogleFailureCode:
        enrichment?.preGoogleFailureCode || (intent === 'none' ? 'intent_none' : null),
      googleRequestReached,
      googleHttpResult,
      eventCount,
      packStatus: status,
      packAppended,
      calendarContextPresent: packAppended,
      code,
    }
  }

  if (status === 'disabled' || code === 'calendar_disabled') {
    rowFound = null
    decryptReached = false
    googleRequestReached = false
    googleHttpResult = 'n/a'
  } else if (status === 'not_connected' || code === 'not_connected') {
    rowFound = false
    connectionStatus = 'missing'
    decryptReached = false
    googleRequestReached = false
    googleHttpResult = 'n/a'
  } else if (status === 'reconnect_required' || code === 'reconnect_required') {
    rowFound = true
    connectionStatus = 'reconnect_required'
    // May fail at decrypt or refresh; treat decrypt as attempted when encryption_failure.
    decryptReached = code === 'encryption_failure' ? true : true
    googleRequestReached = code === 'google_unauthorized' || code === 'reconnect_required'
    googleHttpResult = code === 'google_unauthorized' ? '401' : 'n/a'
  } else if (code === 'encryption_failure') {
    rowFound = true
    connectionStatus = 'connected?'
    decryptReached = true
    googleRequestReached = false
    googleHttpResult = 'n/a'
  } else if (status === 'ok' || status === 'empty') {
    rowFound = true
    connectionStatus = 'connected'
    decryptReached = true
    googleRequestReached = true
    googleHttpResult = '200'
  } else if (status === 'unavailable') {
    rowFound = code === 'not_connected' ? false : true
    decryptReached = code === 'encryption_failure' || code !== 'not_connected'
    googleRequestReached =
      code === 'google_unavailable' ||
      code === 'google_timeout' ||
      code === 'google_rate_limited' ||
      code === 'google_forbidden' ||
      code === 'malformed_google_response'
    if (code === 'google_forbidden') googleHttpResult = '403'
    else if (code === 'google_rate_limited') googleHttpResult = '429'
    else if (code === 'google_timeout') googleHttpResult = '408'
    else if (googleRequestReached) googleHttpResult = '5xx/err'
    else googleHttpResult = 'n/a'
  } else if (status === 'connection_query') {
    rowFound = null
    decryptReached = false
    googleRequestReached = false
    googleHttpResult = 'n/a'
  }

  const tokenDecrypt =
    typeof enrichment?.tokenDecrypt === 'string' && enrichment.tokenDecrypt
      ? enrichment.tokenDecrypt
      : decryptReached === true
        ? 'PASS'
        : decryptReached === false
          ? 'NOT_REACHED'
          : 'NOT_REACHED'

  return {
    intent,
    used: true,
    operation,
    rowFound,
    connectionStatus,
    decryptReached,
    tokenDecrypt,
    preGoogleFailureCode: enrichment?.preGoogleFailureCode || code || null,
    googleRequestReached,
    googleHttpResult,
    eventCount,
    packStatus: status,
    packAppended,
    calendarContextPresent: packAppended,
    code,
  }
}

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>
 *   correlationId?: string | null
 *   authUserId?: string | null
 *   clientSupabaseHost?: string | null
 *   enrichment: {
 *     intent?: string | null
 *     status?: string | null
 *     code?: string | null
 *     eventCount?: number
 *     used?: boolean
 *     pack?: string
 *     durationMs?: number
 *   }
 * }} input
 */
export function buildChatCalendarDiagPayload(input) {
  const env = input.env || process.env
  const enrichment = input.enrichment || {}
  const trace = buildCalendarTraceFromEnrichment(enrichment)
  const requestId = input.correlationId || null
  return {
    diagBuild: CALENDAR_DIAG_BUILD,
    phase: 'chat',
    timestamp: new Date().toISOString(),
    correlationId: requestId,
    requestId,
    buildId: resolveServerBuildId(env),
    vercelEnv: typeof env.VERCEL_ENV === 'string' ? env.VERCEL_ENV : null,
    runtimeCalendarEnabled: isCalendarEnabled(env),
    supabaseProject: supabaseProjectRefFromUrl(
      (typeof env.SUPABASE_URL === 'string' && env.SUPABASE_URL) ||
        (typeof env.VITE_SUPABASE_URL === 'string' && env.VITE_SUPABASE_URL) ||
        '',
    ),
    clientSupabaseHost:
      typeof input.clientSupabaseHost === 'string' && input.clientSupabaseHost.trim()
        ? input.clientSupabaseHost.trim().slice(0, 80)
        : null,
    authUid: maskUid(input.authUserId),
    lookupOwnerUid: maskUid(input.authUserId),
    // #310F — message selection / detector text trace (safe previews ≤80)
    messageSource:
      typeof input.messageSource === 'string' ? input.messageSource.slice(0, 120) : null,
    selectedMessageRole:
      typeof input.selectedMessageRole === 'string' ? input.selectedMessageRole : null,
    apiParsedLastUserLen:
      typeof input.apiParsedLastUserLen === 'number' ? input.apiParsedLastUserLen : null,
    apiParsedLastUserPreview:
      typeof input.apiParsedLastUserPreview === 'string'
        ? input.apiParsedLastUserPreview.slice(0, 80)
        : null,
    visibleUiLastUserLen:
      typeof input.visibleUiLastUserLen === 'number' ? input.visibleUiLastUserLen : null,
    visibleUiLastUserPreview:
      typeof input.visibleUiLastUserPreview === 'string'
        ? input.visibleUiLastUserPreview.slice(0, 80)
        : null,
    clientOutboundLastUserLen:
      typeof input.clientOutboundLastUserLen === 'number'
        ? input.clientOutboundLastUserLen
        : null,
    clientOutboundLastUserPreview:
      typeof input.clientOutboundLastUserPreview === 'string'
        ? input.clientOutboundLastUserPreview.slice(0, 80)
        : null,
    enrichmentSelectedLen:
      typeof enrichment.enrichmentSelectedLen === 'number'
        ? enrichment.enrichmentSelectedLen
        : null,
    enrichmentSelectedPreview:
      typeof enrichment.enrichmentSelectedPreview === 'string'
        ? enrichment.enrichmentSelectedPreview.slice(0, 80)
        : null,
    detectorRawLen:
      typeof enrichment.detectorRawLen === 'number' ? enrichment.detectorRawLen : null,
    detectorInput:
      typeof enrichment.detectorInput === 'string' ? enrichment.detectorInput.slice(0, 80) : null,
    detectorNormalized:
      typeof enrichment.detectorNormalized === 'string'
        ? enrichment.detectorNormalized.slice(0, 80)
        : null,
    detectorResult:
      typeof enrichment.detectorResult === 'string' ? enrichment.detectorResult : null,
    ...trace,
    durationMs: typeof enrichment.durationMs === 'number' ? enrichment.durationMs : null,
  }
}
