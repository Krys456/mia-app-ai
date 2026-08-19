/**
 * #304A1 — calendar-oauth-callback
 *
 * Google redirects here (no user JWT). Validates signed state + pending nonce,
 * exchanges code server-side, encrypts tokens, upserts calendar_connections for
 * the verified ShinkAIdo user_id from state, redirects safely back to the app.
 *
 * verify_jwt = false (gateway) — ownership comes from HMAC state + DB nonce.
 * Open redirects rejected via CALENDAR_RETURN_URL allowlist.
 */

import {
  ensureAuthUserRow,
  env,
  isCalendarEnabled,
  logSafe,
  resolveRefreshTokenEnc,
  serviceClient,
} from '../_shared/calendar-edge.ts'
import { encryptToken } from '../_shared/calendar-token-crypto.ts'
import {
  GOOGLE_OAUTH_SCOPES,
  resolveOAuthCallbackReturnUrl,
  resolveSafeReturnUrl,
  verifySignedOAuthState,
} from '../_shared/calendar-oauth.ts'

function redirect(url: string, status = 302) {
  return new Response(null, {
    status,
    headers: { Location: url, 'Cache-Control': 'no-store' },
  })
}

function failRedirect(base: string, code: string) {
  const safe = resolveSafeReturnUrl(null, base)
  const target = safe.ok ? new URL(safe.url) : null
  if (!target) {
    return new Response(`OAuth error: ${code}`, { status: 400 })
  }
  target.searchParams.set('calendar', 'error')
  target.searchParams.set('code', code)
  return redirect(target.toString())
}

Deno.serve(async (req) => {
  const runId = crypto.randomUUID()
  const returnBase = env('CALENDAR_RETURN_URL')

  if (req.method !== 'GET') {
    return new Response('method_not_allowed', { status: 405 })
  }

  if (!isCalendarEnabled()) {
    logSafe('calendar-oauth-callback', { runId, code: 'calendar_disabled', ok: false })
    return failRedirect(returnBase, 'calendar_disabled')
  }

  const url = new URL(req.url)
  const code = (url.searchParams.get('code') || '').trim()
  const state = (url.searchParams.get('state') || '').trim()
  const oauthError = (url.searchParams.get('error') || '').trim()

  if (oauthError) {
    logSafe('calendar-oauth-callback', { runId, code: 'google_denied', ok: false })
    return failRedirect(returnBase, 'google_denied')
  }
  if (!code || !state) {
    return failRedirect(returnBase, 'missing_code_or_state')
  }

  const encKey = env('CALENDAR_TOKEN_ENCRYPTION_KEY')
  const clientId = env('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = env('GOOGLE_OAUTH_CLIENT_SECRET')
  const redirectUri = env('CALENDAR_OAUTH_REDIRECT_URI')
  if (!encKey || !clientId || !clientSecret || !redirectUri || !returnBase) {
    logSafe('calendar-oauth-callback', { runId, code: 'oauth_misconfigured', ok: false })
    return failRedirect(returnBase, 'oauth_misconfigured')
  }

  const verified = await verifySignedOAuthState(state, {}, encKey)
  if (!verified.ok) {
    logSafe('calendar-oauth-callback', { runId, code: verified.code, ok: false, stateValid: false })
    return failRedirect(returnBase, verified.code)
  }

  try {
    const supabase = serviceClient()
    const userId = await ensureAuthUserRow(supabase, verified.userId)

    const { data: existing, error: existingError } = await supabase
      .from('calendar_connections')
      .select(
        'id, user_id, refresh_token_enc, oauth_pending_nonce, oauth_pending_expires_at, status',
      )
      .eq('user_id', userId)
      .eq('provider', 'google')
      .maybeSingle()

    if (existingError) {
      logSafe('calendar-oauth-callback', { runId, code: 'connection_lookup_failed', ok: false })
      return failRedirect(returnBase, 'connection_lookup_failed')
    }

    // Bind callback to the pending start for THIS user (CSRF / replay / IDOR).
    if (
      !existing ||
      existing.oauth_pending_nonce !== verified.nonce ||
      !existing.oauth_pending_expires_at ||
      new Date(existing.oauth_pending_expires_at).getTime() < Date.now()
    ) {
      logSafe('calendar-oauth-callback', { runId, code: 'oauth_nonce_invalid', ok: false, userId })
      return failRedirect(returnBase, 'oauth_nonce_invalid')
    }

    // Defense: state user must match row owner (already keyed by userId query).
    if (String(existing.user_id) !== userId) {
      logSafe('calendar-oauth-callback', { runId, code: 'ownership_mismatch', ok: false })
      return failRedirect(returnBase, 'ownership_mismatch')
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verified.codeVerifier,
      }),
    })

    if (!tokenRes.ok) {
      logSafe('calendar-oauth-callback', {
        runId,
        code: 'token_exchange_failed',
        ok: false,
        status: tokenRes.status,
      })
      await supabase
        .from('calendar_connections')
        .update({
          status: 'error',
          last_error_code: 'token_exchange_failed',
          oauth_pending_nonce: null,
          oauth_pending_expires_at: null,
        })
        .eq('user_id', userId)
        .eq('provider', 'google')
      return failRedirect(returnBase, 'token_exchange_failed')
    }

    const tokenJson = (await tokenRes.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      scope?: string
      id_token?: string
      token_type?: string
    }

    const accessToken = typeof tokenJson.access_token === 'string' ? tokenJson.access_token : ''
    if (!accessToken) {
      logSafe('calendar-oauth-callback', { runId, code: 'token_response_invalid', ok: false })
      return failRedirect(returnBase, 'token_response_invalid')
    }

    const refreshToken =
      typeof tokenJson.refresh_token === 'string' && tokenJson.refresh_token
        ? tokenJson.refresh_token
        : null

    const accessEnc = await encryptToken(accessToken, encKey)
    if (!accessEnc.ok) {
      logSafe('calendar-oauth-callback', { runId, code: accessEnc.code, ok: false })
      return failRedirect(returnBase, 'encrypt_failed')
    }

    let refreshEnc: string | null = null
    if (refreshToken) {
      const enc = await encryptToken(refreshToken, encKey)
      if (!enc.ok) {
        logSafe('calendar-oauth-callback', { runId, code: enc.code, ok: false })
        return failRedirect(returnBase, 'encrypt_failed')
      }
      refreshEnc = enc.ciphertext
    }

    const refreshResolved = resolveRefreshTokenEnc({
      newRefreshToken: refreshToken,
      existingRefreshTokenEnc:
        typeof existing.refresh_token_enc === 'string' ? existing.refresh_token_enc : null,
      newRefreshEnc: refreshEnc,
    })

    // Minimal identity (openid email) — never log tokens.
    let googleSub: string | null = null
    let accountEmail: string | null = null
    try {
      const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (infoRes.ok) {
        const info = (await infoRes.json()) as { sub?: string; email?: string }
        googleSub = typeof info.sub === 'string' ? info.sub : null
        accountEmail = typeof info.email === 'string' ? info.email : null
      }
    } catch {
      /* soft — connection can still succeed without email */
    }

    const expiresIn =
      typeof tokenJson.expires_in === 'number' && Number.isFinite(tokenJson.expires_in)
        ? tokenJson.expires_in
        : 3600
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
    const scopes = String(tokenJson.scope || GOOGLE_OAUTH_SCOPES)
      .split(/\s+/)
      .filter(Boolean)

    const { error: upsertError } = await supabase.from('calendar_connections').upsert(
      {
        user_id: userId,
        provider: 'google',
        google_sub: googleSub,
        account_email: accountEmail,
        scopes,
        access_token_enc: accessEnc.ciphertext,
        refresh_token_enc: refreshResolved.refreshTokenEnc,
        token_expires_at: tokenExpiresAt,
        status: refreshResolved.status,
        last_error_code:
          refreshResolved.status === 'reconnect_required' ? 'refresh_token_missing' : null,
        oauth_pending_nonce: null,
        oauth_pending_expires_at: null,
        disconnected_at: null,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    )

    if (upsertError) {
      logSafe('calendar-oauth-callback', { runId, code: 'connection_upsert_failed', ok: false })
      return failRedirect(returnBase, 'connection_upsert_failed')
    }

    logSafe('calendar-oauth-callback', {
      runId,
      correlationId: verified.correlationId || null,
      ok: true,
      authUid: (() => {
        const id = String(userId)
        return id.length >= 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : '…'
      })(),
      status: refreshResolved.status,
      hasRefresh: Boolean(refreshResolved.refreshTokenEnc),
      connectionUpserted: true,
      // origin host only — never tokens
      returnHost: (() => {
        try {
          return verified.returnOrigin ? new URL(verified.returnOrigin).hostname : null
        } catch {
          return null
        }
      })(),
      stateValid: true,
    })

    const calendarFlag =
      refreshResolved.status === 'connected' ? 'connected' : 'reconnect_required'
    const cid = verified.correlationId ? `&cid=${encodeURIComponent(verified.correlationId)}` : ''
    // #310C3 — restore ?calendar_diag=1 after Google so frontend diag mode cannot drop.
    const diagQ = verified.calendarDiag ? '&calendar_diag=1' : ''
    const safe = resolveOAuthCallbackReturnUrl({
      signedReturnOrigin: verified.returnOrigin,
      allowedBase: returnBase,
      pathQuery: `calendar=${calendarFlag}${cid}${diagQ}`,
    })
    if (!safe.ok) return failRedirect(returnBase, safe.code || 'return_url_not_configured')
    return redirect(safe.url)
  } catch (err) {
    const code =
      err instanceof Error && err.message === 'supabase_service_misconfigured'
        ? 'supabase_service_misconfigured'
        : 'callback_failed'
    logSafe('calendar-oauth-callback', { runId, code, ok: false })
    return failRedirect(returnBase, code)
  }
})
