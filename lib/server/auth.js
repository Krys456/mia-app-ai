/**
 * Server-side Supabase auth verification (Memory 2.0 — Phase 1A step 2).
 *
 * Verifies Authorization: Bearer <access_token> via getServiceSupabase().auth.getUser(jwt).
 * Derives the real auth.uid() from the verified user. Never trusts body.userId,
 * X-LAIfe-User-Id, or any other client-supplied ownership claim.
 *
 * Not wired into /api/chat or /api/memories yet — reusable primitive only.
 */

import { getServiceSupabase } from './supabase.js'

/** @typedef {'missing_token' | 'malformed_authorization' | 'invalid_token' | 'verification_failed'} AuthErrorCode */

export class AuthError extends Error {
  /**
   * @param {AuthErrorCode} code
   * @param {string} message
   * @param {number} [status=401]
   */
  constructor(code, message, status = 401) {
    super(message)
    this.name = 'AuthError'
    /** @type {AuthErrorCode} */
    this.code = code
    this.status = status
  }
}

/**
 * Read a single header value (Node / Vercel lowercases; mocks may not).
 * @param {Record<string, unknown> | undefined | null} headers
 * @param {string} name header name (any casing)
 * @returns {string}
 */
function readHeader(headers, name) {
  if (!headers || typeof headers !== 'object') return ''
  const target = name.toLowerCase()
  for (const [key, raw] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== target) continue
    if (typeof raw === 'string') return raw
    if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0]
    return ''
  }
  return ''
}

/**
 * Extract the Bearer access token from Authorization.
 * @param {{ headers?: Record<string, unknown> } | null | undefined} req
 * @returns {string}
 * @throws {AuthError}
 */
export function extractBearerToken(req) {
  const authorization = readHeader(req?.headers, 'authorization').trim()

  if (!authorization) {
    throw new AuthError('missing_token', 'Missing Authorization Bearer token')
  }

  const match = /^Bearer\s+(\S+)$/i.exec(authorization)
  if (!match) {
    throw new AuthError(
      'malformed_authorization',
      'Malformed Authorization header (expected Bearer <token>)',
    )
  }

  const token = match[1].trim()
  if (!token) {
    throw new AuthError('malformed_authorization', 'Malformed Authorization Bearer token')
  }

  return token
}

/**
 * @param {unknown} error
 * @returns {AuthError}
 */
function mapSupabaseAuthError(error) {
  const message =
    error && typeof error === 'object' && typeof error.message === 'string'
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Supabase token verification failed'

  const status =
    error && typeof error === 'object' && typeof error.status === 'number'
      ? error.status
      : undefined

  const lower = message.toLowerCase()
  if (
    status === 401 ||
    status === 403 ||
    /invalid|expired|jwt|token|unauthorized|not authenticated/i.test(lower)
  ) {
    return new AuthError('invalid_token', message || 'Invalid or expired access token')
  }

  return new AuthError('verification_failed', message || 'Supabase token verification failed', 401)
}

/**
 * Verify a Supabase access token and return the authenticated user id.
 *
 * @param {string} accessToken
 * @param {{ getSupabase?: () => Promise<{ auth: { getUser: (jwt: string) => Promise<any> } }> }} [options]
 * @returns {Promise<{ userId: string, isAnonymous: boolean | null, user: { id: string } }>}
 * @throws {AuthError}
 */
export async function verifySupabaseAccessToken(accessToken, options = {}) {
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    throw new AuthError('missing_token', 'Missing Authorization Bearer token')
  }

  const token = accessToken.trim()
  const getSupabase = options.getSupabase ?? getServiceSupabase

  let result
  try {
    const supabase = await getSupabase()
    result = await supabase.auth.getUser(token)
  } catch (error) {
    if (error instanceof AuthError) throw error
    throw mapSupabaseAuthError(error)
  }

  if (result?.error) {
    throw mapSupabaseAuthError(result.error)
  }

  const user = result?.data?.user
  const userId = typeof user?.id === 'string' ? user.id.trim() : ''
  if (!userId) {
    throw new AuthError('invalid_token', 'Verified session returned no user id')
  }

  const isAnonymous =
    typeof user?.is_anonymous === 'boolean' ? user.is_anonymous : null

  return {
    userId,
    isAnonymous,
    user: { id: userId },
  }
}

/**
 * Require a verified Supabase user from the request Authorization header.
 *
 * Intentionally ignores body.userId, X-LAIfe-User-Id, and query user ids.
 *
 * @param {{ headers?: Record<string, unknown>, body?: unknown }} req
 * @param {{ getSupabase?: () => Promise<{ auth: { getUser: (jwt: string) => Promise<any> } }> }} [options]
 * @returns {Promise<{ userId: string, isAnonymous: boolean | null, user: { id: string }, accessToken: string }>}
 * @throws {AuthError}
 */
export async function requireAuthenticatedUser(req, options = {}) {
  const accessToken = extractBearerToken(req)
  const verified = await verifySupabaseAccessToken(accessToken, options)
  return {
    ...verified,
    accessToken,
  }
}
