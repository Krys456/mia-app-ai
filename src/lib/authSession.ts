/**
 * Silent Supabase auth bootstrap for LAIfe (Phase 1A step 1).
 *
 * Reuses an existing session when present; otherwise signs in anonymously.
 * Soft-fail: callers receive status/error — chat must not depend on success.
 *
 * Single-flight: concurrent bootstrapLaifeAuth() callers share one in-flight
 * promise so chat + mount bootstrap never race into duplicate anon sign-ins.
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
   * Never log this value.
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
    initialize?: () => Promise<unknown>
    getSession: () => Promise<{
      data: { session: AuthSession }
      error: { message?: string; code?: string; status?: number } | null
    }>
    signInAnonymously: () => Promise<{
      data: {
        session: AuthSession
        user?: AuthSessionUser
      }
      error: { message?: string; code?: string; status?: number } | null
    }>
    refreshSession?: () => Promise<{
      data: { session: AuthSession }
      error: { message?: string; code?: string; status?: number } | null
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
  accessToken: string
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

function errorResult(error: unknown, signedInAnonymously = false): AuthBootstrapResult {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
        ? String((error as { message: string }).message)
        : String(error || 'unknown_error')

  return {
    status: 'error',
    userId: null,
    isAnonymous: null,
    error: message.slice(0, 180),
    signedInAnonymously,
    accessToken: null,
  }
}

/** Module-level lock: concurrent ensure calls share one anonymous sign-in. */
const anonSignInLocks = new WeakMap<object, Promise<AuthBootstrapResult>>()

/** App-wide single-flight for default bootstrapLaifeAuth() (mount + chat share). */
let sharedBootstrapInFlight: Promise<AuthBootstrapResult> | null = null

async function ensureAuthInitialized(client: AuthSessionClient): Promise<void> {
  if (typeof client.auth.initialize === 'function') {
    try {
      await client.auth.initialize()
    } catch {
      // Soft: getSession still awaits initializePromise internally.
    }
  }
}

async function signInAnonymouslyOnce(client: AuthSessionClient): Promise<AuthBootstrapResult> {
  const existingLock = anonSignInLocks.get(client)
  if (existingLock) return existingLock

  const lock = (async (): Promise<AuthBootstrapResult> => {
    const signedIn = await client.auth.signInAnonymously()
    if (signedIn.error) {
      return errorResult(signedIn.error, true)
    }

    const session = signedIn.data.session
    const user = session?.user || signedIn.data.user || null
    const { userId, isAnonymous } = readUserMeta(user)
    let token = readAccessToken(session)

    if (!userId) {
      return errorResult('Anonymous sign-in returned no user id', true)
    }

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
 * Never returns status=ready without a usable accessToken.
 */
export async function ensureAnonymousAuthSession(
  client: AuthSessionClient,
): Promise<AuthBootstrapResult> {
  try {
    await ensureAuthInitialized(client)

    const existing = await client.auth.getSession()
    if (existing.error) {
      return errorResult(existing.error)
    }

    const existingSession = existing.data.session
    const existingUser = existingSession?.user
    if (existingUser?.id) {
      const { userId, isAnonymous } = readUserMeta(existingUser)
      let accessToken = readAccessToken(existingSession)

      if (userId && !accessToken) {
        const refresh = await client.auth.getSession()
        if (!refresh.error) {
          accessToken = readAccessToken(refresh.data.session)
        }
      }

      if (userId && !accessToken && typeof client.auth.refreshSession === 'function') {
        try {
          const refreshed = await client.auth.refreshSession()
          if (!refreshed.error) {
            accessToken = readAccessToken(refreshed.data.session)
          }
        } catch {
          // fall through to anonymous sign-in
        }
      }

      if (userId && accessToken) {
        return readyResult({
          userId,
          isAnonymous,
          signedInAnonymously: false,
          accessToken,
        })
      }
    }

    return await signInAnonymouslyOnce(client)
  } catch (error) {
    return errorResult(error)
  }
}

export interface BootstrapLaifeAuthOptions {
  isConfigured?: () => boolean
  getClient?: () => AuthSessionClient
  /** When true (default for bare calls), join the app-wide in-flight bootstrap. */
  useSharedInFlight?: boolean
}

async function runBootstrapLaifeAuth(
  options: BootstrapLaifeAuthOptions,
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
    return errorResult(error)
  }
}

/**
 * App-level bootstrap: skips when Supabase env is missing; never throws.
 * Bare calls (no custom deps) share one in-flight promise across mount + chat.
 */
export async function bootstrapLaifeAuth(
  options: BootstrapLaifeAuthOptions = {},
): Promise<AuthBootstrapResult> {
  const hasCustomDeps =
    options.isConfigured != null ||
    options.getClient != null ||
    options.useSharedInFlight === false

  if (hasCustomDeps) {
    return runBootstrapLaifeAuth(options)
  }

  if (sharedBootstrapInFlight) {
    return sharedBootstrapInFlight
  }

  sharedBootstrapInFlight = runBootstrapLaifeAuth(options)
  try {
    return await sharedBootstrapInFlight
  } finally {
    sharedBootstrapInFlight = null
  }
}

/** Test helper — clears module single-flight state. */
export function resetAuthBootstrapForTests(): void {
  sharedBootstrapInFlight = null
}
