/**
 * #304A1 — calendar-oauth-start
 *
 * Verifies ShinkAIdo anonymous Supabase JWT, binds PKCE + signed state to auth.uid(),
 * stores pending nonce on calendar_connections, returns Google authorize URL.
 *
 * Does NOT expose client secret. Does NOT replace anon identity with Google.
 * Tokens never returned to browser.
 */

import {
  corsHeaders,
  ensureAuthUserRow,
  env,
  extractBearer,
  isCalendarEnabled,
  json,
  logSafe,
  maskUid,
  serviceClient,
  supabaseProjectRefFromEnv,
  verifyUserJwt,
} from '../_shared/calendar-edge.ts'
import {
  buildGoogleAuthorizeUrl,
  createSignedOAuthState,
  generateCodeChallenge,
  generateCodeVerifier,
  generateOAuthNonce,
  GOOGLE_OAUTH_SCOPES,
  isAllowedCalendarReturnOrigin,
  normalizeReturnOrigin,
} from '../_shared/calendar-oauth.ts'

const OAUTH_DIAG_BUILD = '310C-edge-v4'

Deno.serve(async (req) => {
  const started = Date.now()
  const runId = crypto.randomUUID()
  const correlationId = crypto.randomUUID()
  const cors = corsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return json(405, { error: 'method_not_allowed', runId }, cors)
  }

  if (!isCalendarEnabled()) {
    logSafe('calendar-oauth-start', {
      runId,
      correlationId,
      code: 'calendar_disabled',
      ok: false,
    })
    return json(404, { error: 'Calendar unavailable', code: 'calendar_disabled', runId }, cors)
  }

  const accessToken = extractBearer(req)
  if (!accessToken) {
    return json(401, { error: 'unauthorized', code: 'missing_bearer', runId }, cors)
  }

  const verified = await verifyUserJwt(accessToken)
  if (!verified.ok) {
    return json(401, { error: 'unauthorized', code: verified.code, runId }, cors)
  }

  const clientId = env('GOOGLE_OAUTH_CLIENT_ID')
  const redirectUri = env('CALENDAR_OAUTH_REDIRECT_URI')
  const encKey = env('CALENDAR_TOKEN_ENCRYPTION_KEY')
  if (!clientId || !redirectUri || !encKey) {
    logSafe('calendar-oauth-start', { runId, correlationId, code: 'oauth_misconfigured', ok: false })
    return json(503, { error: 'misconfigured', code: 'oauth_misconfigured', runId }, cors)
  }

  // Reject if client secret somehow appears in request (defense).
  // Capture optional returnOrigin so callback returns to the SAME Preview/app origin.
  let bodyReturnOrigin: string | null = null
  let bodyCorrelationId: string | null = null
  try {
    if (req.method === 'POST') {
      const text = await req.text()
      if (text) {
        const body = JSON.parse(text)
        if (body.client_secret || body.refresh_token || body.access_token) {
          return json(400, { error: 'forbidden_fields', code: 'secret_relay_forbidden', runId }, cors)
        }
        if (typeof body.returnOrigin === 'string') {
          bodyReturnOrigin = body.returnOrigin
        }
        if (typeof body.correlationId === 'string' && body.correlationId.trim()) {
          bodyCorrelationId = body.correlationId.trim().slice(0, 64)
        }
      }
    }
  } catch {
    return json(400, { error: 'invalid_json', runId }, cors)
  }

  const effectiveCorrelationId = bodyCorrelationId || correlationId
  const returnBase = env('CALENDAR_RETURN_URL')
  const headerOrigin = normalizeReturnOrigin(req.headers.get('Origin'))
  const requestedOrigin =
    normalizeReturnOrigin(bodyReturnOrigin) || headerOrigin || normalizeReturnOrigin(returnBase)
  const returnOriginAccepted = Boolean(
    requestedOrigin && isAllowedCalendarReturnOrigin(requestedOrigin, returnBase),
  )

  if (!returnOriginAccepted || !requestedOrigin) {
    logSafe('calendar-oauth-start', {
      runId,
      correlationId: effectiveCorrelationId,
      code: 'return_origin_invalid',
      ok: false,
    })
    return json(400, { error: 'return_origin_invalid', code: 'return_origin_invalid', runId }, cors)
  }

  try {
    const supabase = serviceClient()
    const userId = await ensureAuthUserRow(supabase, verified.userId)

    const codeVerifier = generateCodeVerifier()
    const codeChallenge = await generateCodeChallenge(codeVerifier)
    const nonce = generateOAuthNonce()
    const signed = await createSignedOAuthState(
      {
        userId,
        nonce,
        codeVerifier,
        returnOrigin: requestedOrigin,
        correlationId: effectiveCorrelationId,
      },
      encKey,
    )
    if (!signed.ok) {
      logSafe('calendar-oauth-start', {
        runId,
        correlationId: effectiveCorrelationId,
        code: signed.code,
        ok: false,
      })
      return json(503, { error: 'state_failed', code: signed.code, runId }, cors)
    }

    const authorize = buildGoogleAuthorizeUrl({
      clientId,
      redirectUri,
      state: signed.state,
      codeChallenge,
      scopes: GOOGLE_OAUTH_SCOPES,
    })
    if (!authorize.ok) {
      return json(500, { error: 'scope_invalid', code: authorize.code, runId }, cors)
    }

    const pendingExpires = new Date(signed.expiresAtUnix * 1000).toISOString()
    const { error: upsertError } = await supabase.from('calendar_connections').upsert(
      {
        user_id: userId,
        provider: 'google',
        status: 'pending',
        oauth_pending_nonce: nonce,
        oauth_pending_expires_at: pendingExpires,
        last_error_code: null,
        disconnected_at: null,
      },
      { onConflict: 'user_id,provider' },
    )
    const pendingRowCreated = !upsertError
    if (upsertError) {
      logSafe('calendar-oauth-start', {
        runId,
        correlationId: effectiveCorrelationId,
        code: 'pending_upsert_failed',
        ok: false,
      })
      return json(500, { error: 'pending_upsert_failed', code: 'pending_upsert_failed', runId }, cors)
    }

    const returnHost = (() => {
      try {
        return new URL(requestedOrigin).hostname
      } catch {
        return null
      }
    })()

    logSafe('calendar-oauth-start', {
      runId,
      correlationId: effectiveCorrelationId,
      ok: true,
      authUid: maskUid(userId),
      origin: returnHost,
      pendingRowCreated,
      returnOriginAccepted: true,
      durationMs: Date.now() - started,
      diagBuild: OAUTH_DIAG_BUILD,
    })

    return json(
      200,
      {
        ok: true,
        authorizeUrl: authorize.url,
        expiresAt: pendingExpires,
        runId,
        correlationId: effectiveCorrelationId,
        // #310C safe diag (no tokens)
        diag: {
          diagBuild: OAUTH_DIAG_BUILD,
          phase: 'oauth_start',
          timestamp: new Date().toISOString(),
          correlationId: effectiveCorrelationId,
          origin: requestedOrigin,
          authUid: maskUid(userId),
          pendingRowCreated,
          returnOriginAccepted: true,
          supabaseProject: supabaseProjectRefFromEnv(),
          edgeCalendarEnabled: true,
        },
      },
      cors,
    )
  } catch (_err) {
    const code =
      _err instanceof Error && _err.message === 'supabase_service_misconfigured'
        ? 'supabase_service_misconfigured'
        : 'oauth_start_failed'
    logSafe('calendar-oauth-start', {
      runId,
      correlationId: effectiveCorrelationId,
      code,
      ok: false,
    })
    return json(500, { error: 'oauth_start_failed', code, runId }, cors)
  }
})
