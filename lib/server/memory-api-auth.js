/**
 * Memory CRUD route auth — JWT ownership for /api/memories*.
 *
 * Replaces Phase 0 admin-secret on user-facing memory CRUD.
 * /api/memory-test may keep Phase 0 for developer curl access.
 */

import { AuthError, requireAuthenticatedUser } from './auth.js'
import { ensureAuthUserRow } from './brain-memory.js'
import { getServiceSupabase } from './supabase.js'
import { sendJson } from './http.js'

/**
 * Verify Bearer token, ensure public.users row for auth.uid(), return scoped userId.
 * Sends 401 JSON on AuthError and returns null.
 *
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 * @param {{
 *   requireAuthenticatedUser?: typeof requireAuthenticatedUser
 *   getServiceSupabase?: typeof getServiceSupabase
 *   ensureAuthUserRow?: typeof ensureAuthUserRow
 * }} [deps]
 * @returns {Promise<{ userId: string, isAnonymous: boolean | null } | null>}
 */
export async function requireMemoryApiUser(req, res, deps = {}) {
  const authenticate = deps.requireAuthenticatedUser ?? requireAuthenticatedUser
  const getSupabase = deps.getServiceSupabase ?? getServiceSupabase
  const ensureRow = deps.ensureAuthUserRow ?? ensureAuthUserRow

  try {
    const verified = await authenticate(req)
    const supabase = await getSupabase()
    const userId = await ensureRow(supabase, verified.userId)
    return {
      userId,
      isAnonymous: verified.isAnonymous,
    }
  } catch (error) {
    if (error instanceof AuthError) {
      sendJson(res, error.status || 401, {
        success: false,
        error: error.message,
        code: error.code,
      })
      return null
    }
    throw error
  }
}

/** Options passed into brain-memory CRUD so brain-api@local is never used. */
export function memoryOwnerScope(userId) {
  return {
    userId,
    requireExplicitUserId: true,
  }
}
