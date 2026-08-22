/**
 * #337B — email-oauth-start
 *
 * Verifies ShinkAIdo JWT, binds PKCE + signed state (+ optional return
 * origin) to auth.uid(), stores pending nonce on email_connections, returns
 * the Google authorize URL for gmail.readonly + openid email only.
 *
 * Does NOT expose client secret. Tokens never returned to browser.
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
  buildGoogleAuthorizeUrl,
  createSignedOAuthState,
  generateCodeChallenge,
  generateCodeVerifier,
  generateOAuthNonce,
  GOOGLE_EMAIL_OAUTH_SCOPES,
  isAllowedEmailReturnOrigin,
  parseEmailReturnAllowlist,
} from '../_shared/email-oauth.ts'

Deno.serve(async (req) => {
  const started = Date.now()
  const runId = crypto.randomUUID()
  const cors = corsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return json(405, { error: 'method_not_allowed', runId }, cors)
  }

  if (!isEmailEnabled()) {
    logSafe('email-oauth-start', { runId, code: 'email_disabled', ok: false })
    return json(404, { error: 'Email unavailable', code: 'email_disabled', runId }, cors)
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
  const redirectUri = env('EMAIL_OAUTH_REDIRECT_URI')
  const encKey = env('SHINKAIDO_EMAIL_ENCRYPTION_KEY')
  if (!clientId || !redirectUri || !encKey) {
    logSafe('email-oauth-start', { runId, code: 'oauth_misconfigured', ok: false })
    return json(503, { error: 'misconfigured', code: 'oauth_misconfigured', runId }, cors)
  }

  let returnOrigin: string | null = null
  try {
    if (req.method === 'POST') {
      const text = await req.text()
      if (text) {
        const body = JSON.parse(text)
        if (body.client_secret || body.refresh_token || body.access_token) {
          return json(400, { error: 'forbidden_fields', code: 'secret_relay_forbidden', runId }, cors)
        }
        if (typeof body.returnOrigin === 'string') {
          const candidate = body.returnOrigin.trim().replace(/\/+$/, '')
          const allowlist = parseEmailReturnAllowlist(env('EMAIL_RETURN_URL'))
          if (isAllowedEmailReturnOrigin(candidate, allowlist)) {
            returnOrigin = new URL(candidate).origin
          }
        }
      }
    }
  } catch {
    return json(400, { error: 'invalid_json', runId }, cors)
  }

  // Also accept Origin header when allowlisted (SPA same-origin start).
  if (!returnOrigin) {
    const originHdr = (req.headers.get('Origin') || '').trim()
    const allowlist = parseEmailReturnAllowlist(env('EMAIL_RETURN_URL'))
    if (originHdr && isAllowedEmailReturnOrigin(originHdr, allowlist)) {
      try {
        returnOrigin = new URL(originHdr).origin
      } catch {
        /* soft */
      }
    }
  }

  try {
    const supabase = serviceClient()
    const userId = await ensureAuthUserRow(supabase, verified.userId)

    const codeVerifier = generateCodeVerifier()
    const codeChallenge = await generateCodeChallenge(codeVerifier)
    const nonce = generateOAuthNonce()
    const signed = await createSignedOAuthState({ userId, nonce, codeVerifier, returnOrigin }, encKey)
    if (!signed.ok) {
      logSafe('email-oauth-start', { runId, code: signed.code, ok: false })
      return json(503, { error: 'state_failed', code: signed.code, runId }, cors)
    }

    const authorize = buildGoogleAuthorizeUrl({
      clientId,
      redirectUri,
      state: signed.state,
      codeChallenge,
      scopes: GOOGLE_EMAIL_OAUTH_SCOPES,
    })
    if (!authorize.ok) {
      return json(500, { error: 'scope_invalid', code: authorize.code, runId }, cors)
    }

    const pendingExpires = new Date(signed.expiresAtUnix * 1000).toISOString()
    const { error: upsertError } = await supabase.from('email_connections').upsert(
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
    if (upsertError) {
      logSafe('email-oauth-start', { runId, code: 'pending_upsert_failed', ok: false })
      return json(500, { error: 'pending_upsert_failed', code: 'pending_upsert_failed', runId }, cors)
    }

    logSafe('email-oauth-start', {
      runId,
      ok: true,
      userId,
      hasReturnOrigin: Boolean(returnOrigin),
      durationMs: Date.now() - started,
    })

    return json(
      200,
      {
        ok: true,
        authorizeUrl: authorize.url,
        expiresAt: pendingExpires,
        runId,
      },
      cors,
    )
  } catch (err) {
    const code =
      err instanceof Error && err.message === 'supabase_service_misconfigured'
        ? 'supabase_service_misconfigured'
        : 'oauth_start_failed'
    logSafe('email-oauth-start', { runId, code, ok: false })
    return json(500, { error: 'oauth_start_failed', code, runId }, cors)
  }
})
