/**
 * #332E2 — Durable identity status (server-only helpers).
 *
 * Durable = recoverable across devices (not anonymous-only).
 * Client "connected" UI is never authorization for billing — use these
 * helpers on verified JWT users before future purchase creation.
 *
 * LINK (anonymous → email/OAuth on same auth.uid) ≠ SIGN IN (switch to existing account).
 */

/**
 * @typedef {{
 *   id?: string
 *   email?: string | null
 *   new_email?: string | null
 *   email_change_sent_at?: string | null
 *   is_anonymous?: boolean
 *   email_confirmed_at?: string | null
 *   identities?: Array<{ provider?: string, identity_id?: string } | null> | null
 *   app_metadata?: Record<string, unknown> | null
 * }} AuthUserLike
 */

/**
 * @typedef {{
 *   authenticated: boolean
 *   userId: string | null
 *   anonymous: boolean
 *   durable: boolean
 *   emailMasked: string | null
 *   providers: string[]
 *   emailConfirmed: boolean
 *   pendingEmailMasked: string | null
 *   emailChangePending: boolean
 * }} IdentityStatus
 */

/**
 * @param {unknown} email
 * @returns {string | null}
 */
export function maskEmail(email) {
  if (typeof email !== 'string') return null
  const v = email.trim().toLowerCase()
  if (!v || !v.includes('@')) return null
  const [local, domain] = v.split('@')
  if (!local || !domain) return null
  if (local.startsWith('auth:') && domain === 'laife.local') return null
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}***@${domain}`
}

/**
 * @param {AuthUserLike | null | undefined} user
 * @returns {string[]}
 */
export function listAuthProviders(user) {
  const identities = Array.isArray(user?.identities) ? user.identities : []
  /** @type {string[]} */
  const out = []
  for (const identity of identities) {
    const provider =
      identity && typeof identity.provider === 'string'
        ? identity.provider.trim().toLowerCase()
        : ''
    if (!provider || provider === 'anonymous') continue
    if (!out.includes(provider)) out.push(provider)
  }
  return out
}

/**
 * True when the user has a recoverable identity (not anonymous-only).
 *
 * Rules:
 * - Missing user → not durable
 * - is_anonymous === true → not durable
 * - email provider with confirmed email → durable
 * - google / apple (or other non-anonymous identity) → durable
 * - is_anonymous === false with confirmed email → durable
 * - Fail-safe: unknown shapes → not durable
 *
 * @param {AuthUserLike | null | undefined} user
 * @returns {boolean}
 */
export function isDurableIdentity(user) {
  if (!user || typeof user !== 'object') return false
  if (user.is_anonymous === true) return false

  const providers = listAuthProviders(user)
  if (providers.some((p) => p === 'google' || p === 'apple' || p === 'email')) {
    if (providers.includes('email')) {
      return Boolean(user.email_confirmed_at) || Boolean(maskEmail(user.email))
    }
    return true
  }

  // Some Supabase builds omit identities but clear is_anonymous after email confirm.
  if (user.is_anonymous === false && user.email_confirmed_at && maskEmail(user.email)) {
    return true
  }

  return false
}

/**
 * @param {IdentityStatus | null | undefined} a
 * @param {IdentityStatus | null | undefined} b
 */
export function identityStatusEquals(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  if (
    a.authenticated !== b.authenticated ||
    a.userId !== b.userId ||
    a.anonymous !== b.anonymous ||
    a.durable !== b.durable ||
    a.emailMasked !== b.emailMasked ||
    a.emailConfirmed !== b.emailConfirmed ||
    a.pendingEmailMasked !== b.pendingEmailMasked ||
    a.emailChangePending !== b.emailChangePending
  ) {
    return false
  }
  const ap = Array.isArray(a.providers) ? a.providers : []
  const bp = Array.isArray(b.providers) ? b.providers : []
  if (ap.length !== bp.length) return false
  for (let i = 0; i < ap.length; i += 1) {
    if (ap[i] !== bp[i]) return false
  }
  return true
}

/**
 * @param {AuthUserLike | null | undefined} user
 * @returns {IdentityStatus}
 */
export function resolveIdentityStatus(user) {
  const userId = typeof user?.id === 'string' && user.id.trim() ? user.id.trim() : null
  if (!userId) {
    return {
      authenticated: false,
      userId: null,
      anonymous: true,
      durable: false,
      emailMasked: null,
      providers: [],
      emailConfirmed: false,
      pendingEmailMasked: null,
      emailChangePending: false,
    }
  }

  const anonymous = user?.is_anonymous === true
  const durable = isDurableIdentity(user)
  const providers = listAuthProviders(user)
  const emailConfirmed = Boolean(user?.email_confirmed_at)
  const pendingEmailMasked = maskEmail(user?.new_email)
  const emailChangePending =
    Boolean(pendingEmailMasked) || Boolean(user?.email_change_sent_at && user?.new_email)

  return {
    authenticated: true,
    userId,
    anonymous,
    durable,
    emailMasked: maskEmail(user?.email),
    providers,
    emailConfirmed,
    pendingEmailMasked,
    emailChangePending,
  }
}

/**
 * Future billing gate — fail closed.
 *
 * @param {AuthUserLike | null | undefined} user
 * @returns {{ ok: true, status: IdentityStatus } | { ok: false, code: 'not_authenticated' | 'not_durable', status: IdentityStatus }}
 */
export function requireDurableIdentity(user) {
  const status = resolveIdentityStatus(user)
  if (!status.authenticated || !status.userId) {
    return { ok: false, code: 'not_authenticated', status }
  }
  if (!status.durable) {
    return { ok: false, code: 'not_durable', status }
  }
  return { ok: true, status }
}
