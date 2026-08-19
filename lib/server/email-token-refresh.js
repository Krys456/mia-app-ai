/**
 * #311 — Owner-scoped Google access-token refresh for Gmail reads.
 * Never logs token material. Preserves refresh_token_enc when Google omits a new one.
 */

import { isEmailEnabled } from './email-enabled.js'
import { EmailError } from './email-errors.js'
import { decryptToken, encryptToken } from './email-token-crypto.js'
import { googleRefreshAccessToken } from './gmail-http.js'
import { resolveRefreshTokenEnc } from './email-connection.js'
import { getServiceSupabase } from './supabase.js'

export const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000

/** @type {Map<string, Promise<any>>} */
const inFlightByUser = new Map()

/**
 * @param {unknown} userId
 */
function requireOwnerUserId(userId) {
  const id = typeof userId === 'string' ? userId.trim() : ''
  if (!id) throw new EmailError('owner_required', 'owner_required')
  return id
}

/**
 * @param {Record<string, unknown> | null | undefined} row
 */
function assertConnectedRow(row) {
  if (!row) throw new EmailError('not_connected', 'not_connected')
  const status = String(row.status || '')
  if (status === 'reconnect_required') {
    throw new EmailError('reconnect_required', 'reconnect_required')
  }
  if (status !== 'connected') {
    throw new EmailError('not_connected', 'not_connected')
  }
  if (!row.access_token_enc && !row.refresh_token_enc) {
    throw new EmailError('not_connected', 'not_connected')
  }
}

/**
 * @param {{
 *   userId: string
 *   supabase?: any
 *   fetchImpl?: typeof fetch
 *   now?: Date
 *   env?: Record<string, string | undefined>
 * }} opts
 */
export async function getValidGmailAccessToken(opts) {
  const env = opts.env || process.env
  if (!isEmailEnabled(env)) {
    throw new EmailError('email_disabled', 'email_disabled')
  }
  const userId = requireOwnerUserId(opts.userId)

  const existing = inFlightByUser.get(userId)
  if (existing) return existing

  const run = doGetValidGmailAccessToken({ ...opts, userId, env }).finally(() => {
    inFlightByUser.delete(userId)
  })
  inFlightByUser.set(userId, run)
  return run
}

/**
 * @param {{
 *   userId: string
 *   supabase?: any
 *   fetchImpl?: typeof fetch
 *   now?: Date
 *   env: Record<string, string | undefined>
 * }} opts
 */
async function doGetValidGmailAccessToken(opts) {
  const supabase = opts.supabase || (await getServiceSupabase())
  const now = opts.now instanceof Date ? opts.now : new Date()

  const { data: row, error } = await supabase
    .from('email_connections')
    .select(
      'id, user_id, status, access_token_enc, refresh_token_enc, token_expires_at, account_email',
    )
    .eq('user_id', opts.userId)
    .eq('provider', 'google')
    .maybeSingle()

  if (error) {
    throw new EmailError('google_unavailable', 'google_unavailable')
  }
  assertConnectedRow(row)

  const expiresAt = row.token_expires_at ? Date.parse(row.token_expires_at) : NaN
  const stillValid =
    typeof row.access_token_enc === 'string' &&
    row.access_token_enc &&
    Number.isFinite(expiresAt) &&
    expiresAt - ACCESS_TOKEN_REFRESH_SKEW_MS > now.getTime()

  if (stillValid) {
    const dec = await decryptToken(row.access_token_enc, opts.env.EMAIL_TOKEN_ENCRYPTION_KEY)
    if (!dec.ok) throw new EmailError('encryption_failure', 'encryption_failure')
    return {
      accessToken: dec.plaintext,
      connection: row,
      refreshed: false,
      tokenDecrypt: 'ok',
      tokenRefreshAttempted: false,
    }
  }

  if (typeof row.refresh_token_enc !== 'string' || !row.refresh_token_enc) {
    await markReconnectRequired(supabase, opts.userId, 'refresh_token_missing')
    throw new EmailError('reconnect_required', 'reconnect_required')
  }

  const refreshDec = await decryptToken(
    row.refresh_token_enc,
    opts.env.EMAIL_TOKEN_ENCRYPTION_KEY,
  )
  if (!refreshDec.ok) throw new EmailError('encryption_failure', 'encryption_failure')

  const clientId = (opts.env.GOOGLE_OAUTH_CLIENT_ID || '').trim()
  const clientSecret = (opts.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim()
  if (!clientId || !clientSecret) {
    throw new EmailError('email_disabled', 'email_disabled')
  }

  let tokenJson
  try {
    const res = await googleRefreshAccessToken({
      clientId,
      clientSecret,
      refreshToken: refreshDec.plaintext,
      fetchImpl: opts.fetchImpl,
    })
    tokenJson = res.json
  } catch (e) {
    if (e instanceof EmailError && e.code === 'google_unauthorized') {
      await markReconnectRequired(supabase, opts.userId, 'google_unauthorized')
      throw new EmailError('reconnect_required', 'reconnect_required')
    }
    throw e
  }

  const accessToken =
    tokenJson && typeof tokenJson.access_token === 'string' ? tokenJson.access_token : ''
  if (!accessToken) {
    await markReconnectRequired(supabase, opts.userId, 'refresh_failed')
    throw new EmailError('reconnect_required', 'reconnect_required')
  }

  const encAccess = await encryptToken(accessToken, opts.env.EMAIL_TOKEN_ENCRYPTION_KEY)
  if (!encAccess.ok) throw new EmailError('encryption_failure', 'encryption_failure')

  const newRefresh =
    tokenJson && typeof tokenJson.refresh_token === 'string' ? tokenJson.refresh_token : null
  let newRefreshEnc = null
  if (newRefresh) {
    const encR = await encryptToken(newRefresh, opts.env.EMAIL_TOKEN_ENCRYPTION_KEY)
    if (!encR.ok) throw new EmailError('encryption_failure', 'encryption_failure')
    newRefreshEnc = encR.ciphertext
  }

  const resolved = resolveRefreshTokenEnc({
    newRefreshToken: newRefresh,
    existingRefreshTokenEnc: row.refresh_token_enc,
    newRefreshEnc,
  })

  const expiresIn =
    tokenJson && typeof tokenJson.expires_in === 'number' ? tokenJson.expires_in : 3600
  const tokenExpiresAt = new Date(now.getTime() + Math.max(60, expiresIn) * 1000).toISOString()

  const { data: updated, error: updateError } = await supabase
    .from('email_connections')
    .update({
      access_token_enc: encAccess.ciphertext,
      refresh_token_enc: resolved.refreshTokenEnc,
      token_expires_at: tokenExpiresAt,
      status: resolved.status,
      last_error_code: resolved.status === 'connected' ? null : 'refresh_token_missing',
      last_used_at: now.toISOString(),
    })
    .eq('user_id', opts.userId)
    .eq('provider', 'google')
    .select(
      'id, user_id, status, access_token_enc, refresh_token_enc, token_expires_at, account_email',
    )
    .maybeSingle()

  if (updateError || !updated) {
    throw new EmailError('google_unavailable', 'google_unavailable')
  }
  if (resolved.status !== 'connected') {
    throw new EmailError('reconnect_required', 'reconnect_required')
  }

  return {
    accessToken,
    connection: updated,
    refreshed: true,
    tokenDecrypt: 'ok',
    tokenRefreshAttempted: true,
  }
}

/**
 * @param {any} supabase
 * @param {string} userId
 * @param {string} code
 */
async function markReconnectRequired(supabase, userId, code) {
  try {
    await supabase
      .from('email_connections')
      .update({
        status: 'reconnect_required',
        last_error_code: code,
        access_token_enc: null,
        token_expires_at: null,
      })
      .eq('user_id', userId)
      .eq('provider', 'google')
  } catch {
    /* soft */
  }
}

/**
 * Soft connection status for diagnostics (no tokens).
 * @param {{
 *   userId: string
 *   supabase?: any
 *   env?: Record<string, string | undefined>
 * }} opts
 */
export async function getEmailConnectionStatus(opts) {
  const env = opts.env || process.env
  if (!isEmailEnabled(env)) {
    return { enabled: false, rowFound: false, status: null, accountEmail: null }
  }
  const userId = requireOwnerUserId(opts.userId)
  const supabase = opts.supabase || (await getServiceSupabase())
  const { data: row, error } = await supabase
    .from('email_connections')
    .select('status, account_email')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .maybeSingle()
  if (error) {
    return { enabled: true, rowFound: false, status: null, accountEmail: null, code: 'lookup_failed' }
  }
  return {
    enabled: true,
    rowFound: Boolean(row),
    status: row ? String(row.status) : null,
    accountEmail: row && typeof row.account_email === 'string' ? row.account_email : null,
  }
}
