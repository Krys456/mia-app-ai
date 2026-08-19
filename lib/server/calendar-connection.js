/**
 * #304A1 — Refresh-token preservation helpers (Node mirror of Edge logic).
 */

/**
 * When Google omits refresh_token on reconnect, preserve existing encrypted refresh
 * if present; otherwise mark reconnect_required.
 *
 * @param {{
 *   newRefreshToken: string | null | undefined
 *   existingRefreshTokenEnc: string | null | undefined
 *   newRefreshEnc: string | null | undefined
 * }} opts
 */
export function resolveRefreshTokenEnc(opts) {
  if (opts.newRefreshToken && opts.newRefreshEnc) {
    return { refreshTokenEnc: opts.newRefreshEnc, status: 'connected' }
  }
  if (opts.existingRefreshTokenEnc) {
    return { refreshTokenEnc: opts.existingRefreshTokenEnc, status: 'connected' }
  }
  return { refreshTokenEnc: null, status: 'reconnect_required' }
}

/**
 * Strip any token-like keys from an object destined for client JSON.
 * @param {Record<string, unknown>} row
 */
export function publicCalendarConnection(row) {
  if (!row) {
    return {
      status: 'disconnected',
      provider: 'google',
      accountEmail: null,
      scopes: [],
      connected: false,
      readOnly: true,
      lastErrorCode: null,
      disconnectedAt: null,
      updatedAt: null,
    }
  }
  const status = String(row.status || 'disconnected')
  return {
    status,
    provider: String(row.provider || 'google'),
    accountEmail: typeof row.account_email === 'string' ? row.account_email : null,
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    connected: status === 'connected',
    readOnly: true,
    lastErrorCode: typeof row.last_error_code === 'string' ? row.last_error_code : null,
    disconnectedAt: typeof row.disconnected_at === 'string' ? row.disconnected_at : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  }
}
