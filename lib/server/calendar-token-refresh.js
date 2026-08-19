/**
 * #304A2 — Owner-scoped Google access-token refresh for Calendar reads.
 *
 * Never logs token material. Preserves refresh_token_enc when Google omits a new one.
 */

import { isCalendarEnabled } from './calendar-enabled.js'
import { CalendarError } from './calendar-errors.js'
import { decryptToken, encryptToken } from './calendar-token-crypto.js'
import { googleRefreshAccessToken } from './calendar-google-http.js'
import { resolveRefreshTokenEnc } from './calendar-connection.js'
import { getServiceSupabase } from './supabase.js'

export const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000

/** @type {Map<string, Promise<any>>} */
const inFlightByUser = new Map()

/**
 * @param {unknown} userId
 */
function requireOwnerUserId(userId) {
  const id = typeof userId === 'string' ? userId.trim() : ''
  if (!id) throw new CalendarError('owner_required', 'owner_required')
  return id
}

/**
 * @param {Record<string, unknown> | null | undefined} row
 */
function assertConnectedRow(row) {
  if (!row) throw new CalendarError('not_connected', 'not_connected')
  const status = String(row.status || '')
  if (status === 'reconnect_required') {
    throw new CalendarError('reconnect_required', 'reconnect_required')
  }
  if (status !== 'connected') {
    throw new CalendarError('not_connected', 'not_connected')
  }
  if (!row.access_token_enc && !row.refresh_token_enc) {
    throw new CalendarError('not_connected', 'not_connected')
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
export async function getValidGoogleAccessToken(opts) {
  const env = opts.env || process.env
  if (!isCalendarEnabled(env)) {
    throw new CalendarError('calendar_disabled', 'calendar_disabled')
  }
  const userId = requireOwnerUserId(opts.userId)

  const existing = inFlightByUser.get(userId)
  if (existing) return existing

  const run = doGetValidGoogleAccessToken({ ...opts, userId, env }).finally(() => {
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
async function doGetValidGoogleAccessToken(opts) {
  const supabase = opts.supabase || (await getServiceSupabase())
  const now = opts.now instanceof Date ? opts.now : new Date()

  const { data: row, error } = await supabase
    .from('calendar_connections')
    .select(
      'id, user_id, status, access_token_enc, refresh_token_enc, token_expires_at, selected_calendar_ids, account_email',
    )
    .eq('user_id', opts.userId)
    .eq('provider', 'google')
    .maybeSingle()

  if (error) {
    throw new CalendarError('google_unavailable', 'google_unavailable')
  }
  assertConnectedRow(row)

  const expiresAt = row.token_expires_at ? Date.parse(row.token_expires_at) : NaN
  const stillValid =
    typeof row.access_token_enc === 'string' &&
    row.access_token_enc &&
    Number.isFinite(expiresAt) &&
    expiresAt - ACCESS_TOKEN_REFRESH_SKEW_MS > now.getTime()

  if (stillValid) {
    const dec = await decryptToken(row.access_token_enc, opts.env.CALENDAR_TOKEN_ENCRYPTION_KEY)
    if (!dec.ok) throw new CalendarError('encryption_failure', 'encryption_failure')
    return {
      accessToken: dec.plaintext,
      connection: row,
      refreshed: false,
    }
  }

  // Need refresh
  if (typeof row.refresh_token_enc !== 'string' || !row.refresh_token_enc) {
    await markReconnectRequired(supabase, opts.userId, 'refresh_token_missing')
    throw new CalendarError('reconnect_required', 'reconnect_required')
  }

  const refreshDec = await decryptToken(
    row.refresh_token_enc,
    opts.env.CALENDAR_TOKEN_ENCRYPTION_KEY,
  )
  if (!refreshDec.ok) throw new CalendarError('encryption_failure', 'encryption_failure')

  const clientId = (opts.env.GOOGLE_OAUTH_CLIENT_ID || '').trim()
  const clientSecret = (opts.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim()
  if (!clientId || !clientSecret) {
    throw new CalendarError('calendar_disabled', 'calendar_disabled')
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
    if (e instanceof CalendarError && e.code === 'google_unauthorized') {
      await markReconnectRequired(supabase, opts.userId, 'google_unauthorized')
      throw new CalendarError('reconnect_required', 'reconnect_required')
    }
    throw e
  }

  // Detect invalid_grant style payloads without logging body (before requiring access_token).
  if (tokenJson && typeof tokenJson.error === 'string') {
    const err = String(tokenJson.error).toLowerCase()
    if (err === 'invalid_grant' || err === 'unauthorized_client') {
      await markReconnectRequired(supabase, opts.userId, 'google_unauthorized')
      throw new CalendarError('reconnect_required', 'reconnect_required')
    }
  }

  const newAccess =
    tokenJson && typeof tokenJson.access_token === 'string' ? tokenJson.access_token : ''
  if (!newAccess) {
    throw new CalendarError('malformed_google_response', 'malformed_google_response')
  }

  const accessEnc = await encryptToken(newAccess, opts.env.CALENDAR_TOKEN_ENCRYPTION_KEY)
  if (!accessEnc.ok) throw new CalendarError('encryption_failure', 'encryption_failure')

  const newRefresh =
    tokenJson && typeof tokenJson.refresh_token === 'string' && tokenJson.refresh_token
      ? tokenJson.refresh_token
      : null
  let newRefreshEnc = null
  if (newRefresh) {
    const enc = await encryptToken(newRefresh, opts.env.CALENDAR_TOKEN_ENCRYPTION_KEY)
    if (!enc.ok) throw new CalendarError('encryption_failure', 'encryption_failure')
    newRefreshEnc = enc.ciphertext
  }

  const resolved = resolveRefreshTokenEnc({
    newRefreshToken: newRefresh,
    existingRefreshTokenEnc: row.refresh_token_enc,
    newRefreshEnc,
  })

  const expiresIn =
    tokenJson && typeof tokenJson.expires_in === 'number' && Number.isFinite(tokenJson.expires_in)
      ? tokenJson.expires_in
      : 3600
  const nextExpires = new Date(now.getTime() + expiresIn * 1000).toISOString()
  const prevExpires = row.token_expires_at || null

  // Conditional update to reduce lost races across instances.
  let updateQuery = supabase
    .from('calendar_connections')
    .update({
      access_token_enc: accessEnc.ciphertext,
      refresh_token_enc: resolved.refreshTokenEnc,
      token_expires_at: nextExpires,
      status: resolved.status,
      last_error_code:
        resolved.status === 'reconnect_required' ? 'refresh_token_missing' : null,
      last_used_at: now.toISOString(),
    })
    .eq('user_id', opts.userId)
    .eq('provider', 'google')
    .eq('id', row.id)

  if (prevExpires == null) {
    updateQuery = updateQuery.is('token_expires_at', null)
  } else {
    updateQuery = updateQuery.eq('token_expires_at', prevExpires)
  }

  const { data: updated, error: updateError } = await updateQuery
    .select(
      'id, user_id, status, access_token_enc, refresh_token_enc, token_expires_at, selected_calendar_ids, account_email',
    )
    .maybeSingle()

  if (updateError) {
    // Another worker may have won the race — re-read and use their token if still valid.
    const reread = await supabase
      .from('calendar_connections')
      .select(
        'id, user_id, status, access_token_enc, refresh_token_enc, token_expires_at, selected_calendar_ids, account_email',
      )
      .eq('user_id', opts.userId)
      .eq('provider', 'google')
      .maybeSingle()
    if (reread.data && reread.data.status === 'connected' && reread.data.access_token_enc) {
      const dec = await decryptToken(
        reread.data.access_token_enc,
        opts.env.CALENDAR_TOKEN_ENCRYPTION_KEY,
      )
      if (dec.ok) {
        return { accessToken: dec.plaintext, connection: reread.data, refreshed: true }
      }
    }
    throw new CalendarError('google_unavailable', 'google_unavailable')
  }

  if (!updated) {
    // Zero rows matched conditional — re-read winner.
    const reread = await supabase
      .from('calendar_connections')
      .select(
        'id, user_id, status, access_token_enc, refresh_token_enc, token_expires_at, selected_calendar_ids, account_email',
      )
      .eq('user_id', opts.userId)
      .eq('provider', 'google')
      .maybeSingle()
    if (reread.data?.access_token_enc) {
      const dec = await decryptToken(
        reread.data.access_token_enc,
        opts.env.CALENDAR_TOKEN_ENCRYPTION_KEY,
      )
      if (dec.ok) {
        return { accessToken: dec.plaintext, connection: reread.data, refreshed: true }
      }
    }
  }

  if (resolved.status === 'reconnect_required') {
    throw new CalendarError('reconnect_required', 'reconnect_required')
  }

  return {
    accessToken: newAccess,
    connection: updated || { ...row, access_token_enc: accessEnc.ciphertext, token_expires_at: nextExpires },
    refreshed: true,
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
      .from('calendar_connections')
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

/** Test helper — clear process-local single-flight map. */
export function resetCalendarRefreshInFlightForTests() {
  inFlightByUser.clear()
}
