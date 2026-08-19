/**
 * #311 — Refresh-token preservation + public connection shape (Email).
 */

/**
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
 * @param {Record<string, unknown> | null | undefined} row
 */
export function publicEmailConnection(row) {
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
