/**
 * #332E2 — Client durable-identity helpers (presentation + gate UX).
 * Server JWT verification remains authoritative for future billing.
 */

export type IdentityStatus = {
  authenticated: boolean
  userId: string | null
  anonymous: boolean
  durable: boolean
  emailMasked: string | null
  providers: string[]
  emailConfirmed: boolean
}

type AuthUserLike = {
  id?: string
  email?: string | null
  is_anonymous?: boolean
  email_confirmed_at?: string | null
  identities?: Array<{ provider?: string } | null> | null
} | null

export function maskEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null
  const v = email.trim().toLowerCase()
  if (!v || !v.includes('@')) return null
  const [local, domain] = v.split('@')
  if (!local || !domain) return null
  if (local.startsWith('auth:') && domain === 'laife.local') return null
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}***@${domain}`
}

export function listAuthProviders(user: AuthUserLike): string[] {
  const identities = Array.isArray(user?.identities) ? user.identities : []
  const out: string[] = []
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

export function isDurableIdentity(user: AuthUserLike): boolean {
  if (!user || typeof user !== 'object') return false
  if (user.is_anonymous === true) return false

  const providers = listAuthProviders(user)
  if (providers.some((p) => p === 'google' || p === 'apple' || p === 'email')) {
    if (providers.includes('email')) {
      return Boolean(user.email_confirmed_at) || Boolean(maskEmail(user.email))
    }
    return true
  }

  if (user.is_anonymous === false && user.email_confirmed_at && maskEmail(user.email)) {
    return true
  }

  return false
}

export function resolveIdentityStatus(user: AuthUserLike): IdentityStatus {
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
    }
  }

  return {
    authenticated: true,
    userId,
    anonymous: user?.is_anonymous === true,
    durable: isDurableIdentity(user),
    emailMasked: maskEmail(user?.email),
    providers: listAuthProviders(user),
    emailConfirmed: Boolean(user?.email_confirmed_at),
  }
}

/** Google linking UI — only when explicitly enabled (requires Supabase Manual Linking + Google provider). */
export function isGoogleLinkingEnabled(
  env: Record<string, unknown> = (import.meta as ImportMeta & { env?: Record<string, unknown> })
    .env ?? {},
): boolean {
  const raw = typeof env.VITE_AUTH_GOOGLE_LINKING_ENABLED === 'string'
    ? env.VITE_AUTH_GOOGLE_LINKING_ENABLED.trim().toLowerCase()
    : ''
  return raw === 'true' || raw === '1'
}
