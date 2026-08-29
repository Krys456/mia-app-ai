/**
 * #337B — email-query (POST only)
 *
 * Body: { action: 'email_query', queryType, sender?, timeWindow?, timeZone?,
 *          messageId?, includeBody?, maxResults? }
 *
 * Ownership: verified ShinkAIdo JWT → auth.uid() only (never a client field).
 * EMAIL_ENABLED gate → 404 email_disabled when off.
 * Never logs subject / from / snippet / body / sender text / tokens.
 */

import {
  corsHeaders,
  ensureAuthUserRow,
  env,
  extractBearer,
  isEmailEnabled,
  json,
  logSafe,
  serviceClient,
  verifyUserJwt,
} from '../_shared/email-edge.ts'
import {
  buildSafeGmailQuery,
  fetchMessageList,
  fetchSingleMessage,
  getValidAccessToken,
  type MinimalMessage,
} from '../_shared/email-gmail.ts'
import { decideEdgeEntitlement } from '../_shared/entitlement-gate.ts'

type QueryStatus =
  | 'ok'
  | 'empty'
  | 'disabled'
  | 'disconnected'
  | 'reconnect_required'
  | 'timeout'
  | 'error'
  | 'no_sender_match'

function respond(
  status: number,
  cors: Record<string, string>,
  body: {
    ok: boolean
    status: QueryStatus
    messages: MinimalMessage[]
    fetchedAt: string
    timeZone: string | null
    queryType: string | null
    runId: string
    error?: string
    code?: string
  },
) {
  return json(status, body, cors)
}

Deno.serve(async (req) => {
  const started = Date.now()
  const runId = crypto.randomUUID()
  const cors = corsHeaders(req)
  const fetchedAt = new Date().toISOString()

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed', runId }, cors)
  }

  if (!isEmailEnabled()) {
    logSafe('email-query', { runId, status: 'disabled', durationMs: Date.now() - started })
    return respond(404, cors, {
      ok: false,
      status: 'disabled',
      messages: [],
      fetchedAt,
      timeZone: null,
      queryType: null,
      runId,
      error: 'Email unavailable',
      code: 'email_disabled',
    })
  }

  let body: Record<string, unknown> = {}
  try {
    const text = await req.text()
    if (text) body = JSON.parse(text)
  } catch {
    return json(400, { error: 'invalid_json', runId }, cors)
  }

  if (body.user_id || body.userId) {
    return json(400, { error: 'user_id_not_accepted', code: 'user_id_spoof_rejected', runId }, cors)
  }
  if (body.access_token || body.refresh_token || body.client_secret || body.token) {
    return json(400, { error: 'forbidden_fields', code: 'secret_relay_forbidden', runId }, cors)
  }

  const action = typeof body.action === 'string' ? body.action.trim() : ''
  if (action !== 'email_query') {
    return json(400, { error: 'unknown_action', code: 'unknown_action', runId }, cors)
  }

  const queryType = typeof body.queryType === 'string' ? body.queryType.trim() : ''
  const timeZone = typeof body.timeZone === 'string' && body.timeZone.trim() ? body.timeZone.trim() : 'UTC'

  const accessToken = extractBearer(req)
  if (!accessToken) {
    return json(401, { error: 'unauthorized', code: 'missing_bearer', runId }, cors)
  }

  const verified = await verifyUserJwt(accessToken)
  if (!verified.ok) {
    return json(401, { error: 'unauthorized', code: verified.code, runId }, cors)
  }

  const built = buildSafeGmailQuery({
    queryType,
    sender: typeof body.sender === 'string' ? body.sender : undefined,
    timeWindow: typeof body.timeWindow === 'string' ? body.timeWindow : undefined,
    timeZone,
    messageId: typeof body.messageId === 'string' ? body.messageId : undefined,
    includeBody: Boolean(body.includeBody),
    maxResults: typeof body.maxResults === 'number' ? body.maxResults : undefined,
  })
  if (!built.ok) {
    logSafe('email-query', { runId, status: 'error', code: built.code, queryType, durationMs: Date.now() - started })
    return respond(400, cors, {
      ok: false,
      status: 'error',
      messages: [],
      fetchedAt,
      timeZone,
      queryType: queryType || null,
      runId,
      error: 'invalid_query',
      code: built.code,
    })
  }

  const clientId = env('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = env('GOOGLE_OAUTH_CLIENT_SECRET')
  const encKey = env('SHINKAIDO_EMAIL_ENCRYPTION_KEY')
  if (!clientId || !clientSecret || !encKey) {
    logSafe('email-query', { runId, status: 'error', code: 'oauth_misconfigured', durationMs: Date.now() - started })
    return respond(500, cors, {
      ok: false,
      status: 'error',
      messages: [],
      fetchedAt,
      timeZone,
      queryType,
      runId,
      error: 'misconfigured',
      code: 'oauth_misconfigured',
    })
  }

  try {
    const supabase = serviceClient()
    const userId = await ensureAuthUserRow(supabase, verified.userId)

    // #388D — authoritative Gmail read gate (client calls Edge directly).
    const entitlement = await decideEdgeEntitlement({
      supabase,
      userId,
      feature: 'gmail',
      requestId: runId,
      route: 'email-query',
    })
    if (!entitlement.allowed) {
      const httpStatus = entitlement.reason === 'lookup_unavailable' ? 503 : 403
      logSafe('email-query', {
        runId,
        status: 'error',
        code: entitlement.body.code,
        queryType,
        durationMs: Date.now() - started,
      })
      return respond(httpStatus, cors, {
        ok: false,
        status: 'error',
        messages: [],
        fetchedAt,
        timeZone,
        queryType,
        runId,
        error: entitlement.body.error,
        code: entitlement.body.code,
      })
    }

    const tokenRes = await getValidAccessToken(supabase, userId, { encKey, clientId, clientSecret })
    if (!tokenRes.ok) {
      logSafe('email-query', {
        runId,
        status: tokenRes.code,
        queryType,
        durationMs: Date.now() - started,
      })
      return respond(200, cors, {
        ok: false,
        status: tokenRes.code === 'error' ? 'error' : tokenRes.code,
        messages: [],
        fetchedAt,
        timeZone,
        queryType,
        runId,
      })
    }

    if (built.mode === 'single') {
      const single = await fetchSingleMessage({ accessToken: tokenRes.accessToken, messageId: built.messageId })
      if (!single.ok) {
        const status: QueryStatus = single.code === 'google_timeout' ? 'timeout' : 'error'
        logSafe('email-query', { runId, status, queryType, durationMs: Date.now() - started })
        return respond(200, cors, {
          ok: false,
          status,
          messages: [],
          fetchedAt,
          timeZone,
          queryType,
          runId,
        })
      }
      logSafe('email-query', { runId, status: 'ok', count: 1, queryType, durationMs: Date.now() - started })
      return respond(200, cors, {
        ok: true,
        status: 'ok',
        messages: [single.message],
        fetchedAt,
        timeZone,
        queryType,
        runId,
      })
    }

    const listRes = await fetchMessageList({
      accessToken: tokenRes.accessToken,
      q: built.q,
      maxResults: built.maxResults,
      includeBodyForFirst: Boolean(body.includeBody),
    })
    if (!listRes.ok) {
      const status: QueryStatus = listRes.code === 'google_timeout' ? 'timeout' : 'error'
      logSafe('email-query', { runId, status, queryType, durationMs: Date.now() - started })
      return respond(200, cors, {
        ok: false,
        status,
        messages: [],
        fetchedAt,
        timeZone,
        queryType,
        runId,
      })
    }

    const count = listRes.messages.length
    let status: QueryStatus = count > 0 ? 'ok' : 'empty'
    if (queryType === 'sender' && count === 0) status = 'no_sender_match'

    logSafe('email-query', { runId, status, count, queryType, durationMs: Date.now() - started })
    return respond(200, cors, {
      ok: status === 'ok' || status === 'empty' || status === 'no_sender_match',
      status,
      messages: listRes.messages,
      fetchedAt,
      timeZone,
      queryType,
      runId,
    })
  } catch (err) {
    const code =
      err instanceof Error && err.message === 'supabase_service_misconfigured'
        ? 'supabase_service_misconfigured'
        : 'email_query_failed'
    logSafe('email-query', { runId, status: 'error', code, durationMs: Date.now() - started })
    return respond(500, cors, {
      ok: false,
      status: 'error',
      messages: [],
      fetchedAt,
      timeZone,
      queryType,
      runId,
      error: 'email_query_failed',
      code,
    })
  }
})
