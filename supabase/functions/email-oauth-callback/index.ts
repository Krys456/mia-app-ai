/**
 * #337B — email-oauth-callback
 *
 * Google redirects here (no user JWT). Validates signed state + pending
 * nonce, exchanges code server-side, encrypts tokens with
 * SHINKAIDO_EMAIL_ENCRYPTION_KEY, upserts email_connections, redirects to
 * the HMAC-bound return origin (allowlisted; no open redirects).
 *
 * verify_jwt = false (see supabase/config.toml) — ownership comes from the
 * HMAC state + DB pending nonce, not a platform JWT.
 */

import {
  ensureAuthUserRow,
  env,
  isEmailEnabled,
  logSafe,
  resolveRefreshTokenEnc,
  serviceClient,
} from '../_shared/email-edge.ts'
import { encryptToken } from '../_shared/email-token-crypto.ts'
import {
  GOOGLE_EMAIL_OAUTH_SCOPES,
  resolveOAuthCallbackReturnUrl,
  verifySignedOAuthState,
} from '../_shared/email-oauth.ts'

function redirect(url: string, status = 302) {
  return new Response(null, {
    status,
    headers: { Location: url, 'Cache-Control': 'no-store' },
  })
}

function failRedirect(returnBase: string, code: string, returnOrigin: string | null = null) {
  const safe = resolveOAuthCallbackReturnUrl({ returnOrigin, allowedBases: returnBase, flag: 'error' })
  if (!safe.ok) {
    return new Response(`OAuth error: ${code}`, { status: 400 })
  }
  const target = new URL(safe.url)
  target.searchParams.set('email', 'error')
  target.searchParams.set('code', code)
  return redirect(target.toString())
}

Deno.serve(async (req) => {
  const runId = crypto.randomUUID()
  const returnBase = env('EMAIL_RETURN_URL')

  if (req.method !== 'GET') {
    return new Response('method_not_allowed', { status: 405 })
  }

  if (!isEmailEnabled()) {
    logSafe('email-oauth-callback', { runId, code: 'email_disabled', ok: false })
    return failRedirect(returnBase, 'email_disabled')
  }

  const url = new URL(req.url)
  const code = (url.searchParams.get('code') || '').trim()
  const state = (url.searchParams.get('state') || '').trim()
  const oauthError = (url.searchParams.get('error') || '').trim()

  if (oauthError) {
    logSafe('email-oauth-callback', { runId, code: 'google_denied', ok: false })
    return failRedirect(returnBase, 'google_denied')
  }
  if (!code || !state) {
    return failRedirect(returnBase, 'missing_code_or_state')
  }

  const encKey = env('SHINKAIDO_EMAIL_ENCRYPTION_KEY')
  const clientId = env('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = env('GOOGLE_OAUTH_CLIENT_SECRET')
  const redirectUri = env('EMAIL_OAUTH_REDIRECT_URI')
  if (!encKey || !clientId || !clientSecret || !redirectUri || !returnBase) {
    logSafe('email-oauth-callback', { runId, code: 'oauth_misconfigured', ok: false })
    return failRedirect(returnBase, 'oauth_misconfigured')
  }

  const verified = await verifySignedOAuthState(state, {}, encKey)
  if (!verified.ok) {
    logSafe('email-oauth-callback', { runId, code: verified.code, ok: false })
    return failRedirect(returnBase, verified.code)
  }

  const boundOrigin = typeof verified.returnOrigin === 'string' ? verified.returnOrigin : null

  try {
    const supabase = serviceClient()
    const userId = await ensureAuthUserRow(supabase, verified.userId)

    const { data: existing, error: existingError } = await supabase
      .from('email_connections')
      .select('id, user_id, refresh_token_enc, oauth_pending_nonce, oauth_pending_expires_at, status')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .maybeSingle()

    if (existingError) {
      logSafe('email-oauth-callback', { runId, code: 'connection_lookup_failed', ok: false })
      return failRedirect(returnBase, 'connection_lookup_failed', boundOrigin)
    }

    if (
      !existing ||
      existing.oauth_pending_nonce !== verified.nonce ||
      !existing.oauth_pending_expires_at ||
      new Date(existing.oauth_pending_expires_at).getTime() < Date.now()
    ) {
      logSafe('email-oauth-callback', { runId, code: 'oauth_nonce_invalid', ok: false, userId })
      return failRedirect(returnBase, 'oauth_nonce_invalid', boundOrigin)
    }

    if (String(existing.user_id) !== userId) {
      logSafe('email-oauth-callback', { runId, code: 'ownership_mismatch', ok: false })
      return failRedirect(returnBase, 'ownership_mismatch', boundOrigin)
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
      logSafe('email-oauth-callback', {
        runId,
        code: 'token_exchange_failed',
        ok: false,
        status: tokenRes.status,
      })
      await supabase
        .from('email_connections')
        .update({
          status: 'error',
          last_error_code: 'token_exchange_failed',
          oauth_pending_nonce: null,
          oauth_pending_expires_at: null,
        })
        .eq('user_id', userId)
        .eq('provider', 'google')
      return failRedirect(returnBase, 'token_exchange_failed', boundOrigin)
    }

    const tokenJson = (await tokenRes.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      scope?: string
    }

    const accessToken = typeof tokenJson.access_token === 'string' ? tokenJson.access_token : ''
    if (!accessToken) {
      logSafe('email-oauth-callback', { runId, code: 'token_response_invalid', ok: false })
      return failRedirect(returnBase, 'token_response_invalid', boundOrigin)
    }

    const refreshToken =
      typeof tokenJson.refresh_token === 'string' && tokenJson.refresh_token ? tokenJson.refresh_token : null

    const accessEnc = await encryptToken(accessToken, encKey)
    if (!accessEnc.ok) {
      logSafe('email-oauth-callback', { runId, code: accessEnc.code, ok: false })
      return failRedirect(returnBase, 'encrypt_failed', boundOrigin)
    }

    let refreshEnc: string | null = null
    if (refreshToken) {
      const enc = await encryptToken(refreshToken, encKey)
      if (!enc.ok) {
        logSafe('email-oauth-callback', { runId, code: enc.code, ok: false })
        return failRedirect(returnBase, 'encrypt_failed', boundOrigin)
      }
      refreshEnc = enc.ciphertext
    }

    const refreshResolved = resolveRefreshTokenEnc({
      newRefreshToken: refreshToken,
      existingRefreshTokenEnc: typeof existing.refresh_token_enc === 'string' ? existing.refresh_token_enc : null,
      newRefreshEnc: refreshEnc,
    })

    // Minimal identity (openid email) — never log tokens or the email address itself.
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
      /* soft — connection can still succeed without identity */
    }

    const expiresIn =
      typeof tokenJson.expires_in === 'number' && Number.isFinite(tokenJson.expires_in) ? tokenJson.expires_in : 3600
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
    const scopes = String(tokenJson.scope || GOOGLE_EMAIL_OAUTH_SCOPES)
      .split(/\s+/)
      .filter(Boolean)

    const { error: upsertError } = await supabase.from('email_connections').upsert(
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
        last_error_code: refreshResolved.status === 'reconnect_required' ? 'refresh_token_missing' : null,
        oauth_pending_nonce: null,
        oauth_pending_expires_at: null,
        disconnected_at: null,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    )

    if (upsertError) {
      logSafe('email-oauth-callback', { runId, code: 'connection_upsert_failed', ok: false })
      return failRedirect(returnBase, 'connection_upsert_failed', boundOrigin)
    }

    logSafe('email-oauth-callback', {
      runId,
      ok: true,
      userId,
      status: refreshResolved.status,
      hasRefresh: Boolean(refreshResolved.refreshTokenEnc),
    })

    const flag = refreshResolved.status === 'connected' ? 'connected' : 'reconnect_required'
    const safe = resolveOAuthCallbackReturnUrl({ returnOrigin: boundOrigin, allowedBases: returnBase, flag })
    if (!safe.ok) return failRedirect(returnBase, 'return_url_not_configured', boundOrigin)
    return redirect(safe.url)
  } catch (err) {
    const code =
      err instanceof Error && err.message === 'supabase_service_misconfigured'
        ? 'supabase_service_misconfigured'
        : 'callback_failed'
    logSafe('email-oauth-callback', { runId, code, ok: false })
    return failRedirect(returnBase, code, boundOrigin)
  }
})
