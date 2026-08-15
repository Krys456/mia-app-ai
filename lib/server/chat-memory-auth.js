/**
 * Soft auth binding for Core post-chat memory writes (Memory 2.0 Phase 1A.4).
 *
 * Verifies Authorization Bearer via requireAuthenticatedUser, ensures public.users
 * row for auth.uid(), and returns that id. On missing/invalid auth returns null so
 * chat can continue while memory persistence is skipped (never brain-api@local).
 *
 * Temporary Preview diagnostics (no JWTs / secrets / memory content).
 */

import { AuthError, extractBearerToken, requireAuthenticatedUser } from './auth.js'
import { ensureAuthUserRow } from './brain-memory.js'
import { getServiceSupabase } from './supabase.js'

/**
 * @typedef {{
 *   bearerPresent: boolean
 *   ownerPresent: boolean
 *   authCode: string | null
 *   authError: string | null
 *   ownerUserIdPrefix: string | null
 * }} ChatMemoryOwnerDiag
 */

/**
 * @typedef {{
 *   userId: string | null
 *   diag: ChatMemoryOwnerDiag
 * }} ChatMemoryOwnerResult
 */

/**
 * Sanitize error text for Preview diagnostics — no tokens/secrets.
 * @param {unknown} error
 * @returns {string}
 */
export function sanitizeMemoryDiagError(error) {
  let message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && typeof error.message === 'string'
        ? error.message
        : String(error || 'unknown_error')

  message = message
    .replace(/Bearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]')
    .replace(/service[_-]?role[^\s]*/gi, '[redacted]')
    .replace(/sb_secret_[^\s]+/gi, '[redacted]')
    .replace(/apikey[^\s=]*=\s*\S+/gi, 'apikey=[redacted]')

  return message.slice(0, 180)
}

/**
 * @param {string | null | undefined} userId
 * @returns {string | null}
 */
function ownerPrefix(userId) {
  if (typeof userId !== 'string' || !userId.trim()) return null
  const id = userId.trim()
  return id.length <= 8 ? id : `${id.slice(0, 8)}…`
}

/**
 * Soft-resolve chat memory owner from Bearer JWT.
 *
 * @param {{ headers?: Record<string, unknown>, body?: unknown }} req
 * @param {{
 *   requireAuthenticatedUser?: typeof requireAuthenticatedUser
 *   getServiceSupabase?: typeof getServiceSupabase
 *   ensureAuthUserRow?: typeof ensureAuthUserRow
 * }} [deps]
 * @returns {Promise<ChatMemoryOwnerResult>}
 */
export async function resolveChatMemoryOwnerUserId(req, deps = {}) {
  const authenticate = deps.requireAuthenticatedUser ?? requireAuthenticatedUser
  const getSupabase = deps.getServiceSupabase ?? getServiceSupabase
  const ensureRow = deps.ensureAuthUserRow ?? ensureAuthUserRow

  /** @type {ChatMemoryOwnerDiag} */
  const diag = {
    bearerPresent: false,
    ownerPresent: false,
    authCode: null,
    authError: null,
    ownerUserIdPrefix: null,
  }

  try {
    extractBearerToken(req)
    diag.bearerPresent = true
  } catch (error) {
    if (error instanceof AuthError) {
      diag.authCode = error.code
      diag.authError = sanitizeMemoryDiagError(error)
      return { userId: null, diag }
    }
  }

  try {
    const verified = await authenticate(req)
    const supabase = await getSupabase()
    const userId = await ensureRow(supabase, verified.userId)
    diag.ownerPresent = true
    diag.ownerUserIdPrefix = ownerPrefix(userId)
    return { userId, diag }
  } catch (error) {
    if (error instanceof AuthError) {
      diag.authCode = error.code
      diag.authError = sanitizeMemoryDiagError(error)
      return { userId: null, diag }
    }
    diag.authCode = 'owner_bridge_failed'
    diag.authError = sanitizeMemoryDiagError(error)
    console.warn('[chat-memory-auth] skip memory write:', diag.authError)
    return { userId: null, diag }
  }
}
