/**
 * Soft auth binding for Core post-chat memory writes (Memory 2.0 Phase 1A.4).
 *
 * Verifies Authorization Bearer via requireAuthenticatedUser, ensures public.users
 * row for auth.uid(), and returns that id. On missing/invalid auth returns null so
 * chat can continue while memory persistence is skipped (never brain-api@local).
 */

import { AuthError, requireAuthenticatedUser } from './auth.js'
import { ensureAuthUserRow } from './brain-memory.js'
import { getServiceSupabase } from './supabase.js'

/**
 * @param {{ headers?: Record<string, unknown>, body?: unknown }} req
 * @param {{
 *   requireAuthenticatedUser?: typeof requireAuthenticatedUser
 *   getServiceSupabase?: typeof getServiceSupabase
 *   ensureAuthUserRow?: typeof ensureAuthUserRow
 * }} [deps]
 * @returns {Promise<string | null>} verified ownership user id, or null to skip memory
 */
export async function resolveChatMemoryOwnerUserId(req, deps = {}) {
  const authenticate = deps.requireAuthenticatedUser ?? requireAuthenticatedUser
  const getSupabase = deps.getServiceSupabase ?? getServiceSupabase
  const ensureRow = deps.ensureAuthUserRow ?? ensureAuthUserRow

  try {
    const verified = await authenticate(req)
    const supabase = await getSupabase()
    return await ensureRow(supabase, verified.userId)
  } catch (error) {
    if (error instanceof AuthError) {
      return null
    }
    // Soft-fail any verification/bridge errors — chat must remain available.
    console.warn(
      '[chat-memory-auth] skip memory write:',
      error instanceof Error ? error.message : String(error),
    )
    return null
  }
}
