/**
 * Silent Supabase auth bootstrap for LAIfe (Phase 1A step 1).
 *
 * Reuses an existing session when present; otherwise signs in anonymously.
 * Soft-fail: callers receive status/error — chat must not depend on success.
 */

export type AuthBootstrapStatus =
  | 'idle'
  | 'pending'
  | 'ready'
  | 'skipped'
  | 'error'

export interface AuthBootstrapResult {
  status: AuthBootstrapStatus
  userId: string | null
  isAnonymous: boolean | null
  error: string | null
  /** True when signInAnonymously() was invoked this call. */
  signedInAnonymously: boolean
  /**
   * Access token when a session is available.
   * Never log or put this into memoryDiag / UI.
   */
  accessToken: string | null
}

type AuthSessionUser = { id?: string; is_anonymous?: boolean } | null | undefined

type AuthSession = {
  access_token?: string | null
  user?: AuthSessionUser
} | null

/** Minimal auth surface used by ensureAnonymousAuthSession (injectable for tests). */
export interface AuthSessionClient {
  auth: {
    getSession: () => Promise<{
      data: { session: AuthSession }
      error: { message?: string } | null
    }>
    signInAnonymously: () => Promise<{
      data: {
        session: AuthSession
        user?: AuthSessionUser
      }
      error: { message?: string } | null
    }>
  }
}

function readUserMeta(user: AuthSessionUser): {
  userId: string | null
  isAnonymous: boolean | null
} {
  const userId = typeof user?.id === 'string' && user.id.trim() ? user.id.trim() : null
  const isAnonymous = typeof user?.is_anonymous === 'boolean' ? user.is_anonymous : null
  return { userId, isAnonymous }
}

function readAccessToken(session: AuthSession): string | null {
  const token = typeof session?.access_token === 'string' ? session.access_token.trim() : ''
  return token || null
}

function readyResult(input: {
  userId: string
  isAnonymous: boolean | null
  signedInAnonymously: boolean
  accessToken: string | null
}): AuthBootstrapResult {
  return {
    status: 'ready',
    userId: input.userId,
    isAnonymous: input.isAnonymous,
    error: null,
    signedInAnonymously: input.signedInAnonymously,
    accessToken: input.accessToken,
  }
}

function errorResult(
  error: string,
  signedInAnonymously = false,
): AuthBootstrapResult {
  return {
    status: 'error',
    userId: null,
    isAnonymous: null,
    error,
    signedInAnonymously,
    accessToken: null,
  }
}

/** Module-level lock: concurrent ensure calls share one anonymous sign-in. */
const anonSignInLocks = new WeakMap<object, Promise<AuthBootstrapResult>>()

async function signInAnonymouslyOnce(client: AuthSessionClient): Promise<AuthBootstrapResult> {
  const existingLock = anonSignInLocks.get(client)
  if (existingLock) return existingLock

  const lock = (async (): Promise<AuthBootstrapResult> => {
    const signedIn = await client.auth.signInAnonymously()
    if (signedIn.error) {
      return errorResult(signedIn.error.message || 'signInAnonymously failed', true)
    }

    const session = signedIn.data.session
    const user = session?.user || signedIn.data.user || null
    const { userId, isAnonymous } = readUserMeta(user)
    const accessToken = readAccessToken(session)

    if (!userId) {
      return errorResult('Anonymous sign-in returned no user id', true)
    }

    // Some clients briefly expose user before session token is readable — re-read once.
    let token = accessToken
    if (!token) {
      const refresh = await client.auth.getSession()
      if (!refresh.error) {
        token = readAccessToken(refresh.data.session)
      }
    }

    if (!token) {
      return errorResult('Anonymous sign-in returned no access token', true)
    }

    return readyResult({
      userId,
      isAnonymous: isAnonymous ?? true,
      signedInAnonymously: true,
      accessToken: token,
    })
  })()

  anonSignInLocks.set(client, lock)
  try {
    return await lock
  } finally {
    anonSignInLocks.delete(client)
  }
}

/**
 * Ensure a Supabase session exists: reuse getSession(), else signInAnonymously().
 * Does not throw — callers receive status/error for soft handling.
 * Reuses an in-flight anonymous sign-in so concurrent callers share one identity.
 */
export async function ensureAnonymousAuthSession(
  client: AuthSessionClient,
): Promise<AuthBootstrapResult> {
  try {
    const existing = await client.auth.getSession()
    if (existing.error) {
      return errorResult(existing.error.message || 'getSession failed')
    }

    const existingSession = existing.data.session
    const existingUser = existingSession?.user
    if (existingUser?.id) {
      const { userId, isAnonymous } = readUserMeta(existingUser)
      let accessToken = readAccessToken(existingSession)

      // Session row present but token missing — one soft re-read (storage hydration).
      if (userId && !accessToken) {
        const refresh = await client.auth.getSession()
        if (!refresh.error) {
          accessToken = readAccessToken(refresh.data.session)
        }
      }

      if (!userId) {
        return errorResult('Session user missing id')
      }

      return readyResult({
        userId,
        isAnonymous,
        signedInAnonymously: false,
        accessToken,
      })
    }

    return await signInAnonymouslyOnce(client)
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error))
  }
}

export interface BootstrapLaifeAuthOptions {
  isConfigured?: () => boolean
  getClient?: () => AuthSessionClient
}

/**
 * App-level bootstrap: skips when Supabase env is missing; never throws.
 */
export async function bootstrapLaifeAuth(
  options: BootstrapLaifeAuthOptions = {},
): Promise<AuthBootstrapResult> {
  try {
    const isConfigured =
      options.isConfigured ?? (await import('./supabase')).isSupabaseConfigured

    if (!isConfigured()) {
      return {
        status: 'skipped',
        userId: null,
        isAnonymous: null,
        error: 'Supabase is not configured in this environment',
        signedInAnonymously: false,
        accessToken: null,
      }
    }

    const client =
      options.getClient?.() ??
      ((await import('./supabase')).getSupabase() as AuthSessionClient)

    return await ensureAnonymousAuthSession(client)
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error))
  }
}
