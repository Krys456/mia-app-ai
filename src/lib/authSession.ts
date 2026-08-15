/**
 * Silent Supabase auth bootstrap for LAIfe (Phase 1A step 1).
 *
 * Reuses an existing session when present; otherwise signs in anonymously.
 * Not an authority for memory ownership yet — chat must not depend on success.
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
}

/** Minimal auth surface used by ensureAnonymousAuthSession (injectable for tests). */
export interface AuthSessionClient {
  auth: {
    getSession: () => Promise<{
      data: { session: { user?: { id?: string; is_anonymous?: boolean } | null } | null }
      error: { message?: string } | null
    }>
    signInAnonymously: () => Promise<{
      data: {
        session: { user?: { id?: string; is_anonymous?: boolean } | null } | null
        user?: { id?: string; is_anonymous?: boolean } | null
      }
      error: { message?: string } | null
    }>
  }
}

function readUserMeta(user: { id?: string; is_anonymous?: boolean } | null | undefined): {
  userId: string | null
  isAnonymous: boolean | null
} {
  const userId = typeof user?.id === 'string' && user.id.trim() ? user.id.trim() : null
  const isAnonymous = typeof user?.is_anonymous === 'boolean' ? user.is_anonymous : null
  return { userId, isAnonymous }
}

/**
 * Ensure a Supabase session exists: reuse getSession(), else signInAnonymously().
 * Does not throw — callers receive status/error for soft handling.
 */
export async function ensureAnonymousAuthSession(
  client: AuthSessionClient,
): Promise<AuthBootstrapResult> {
  try {
    const existing = await client.auth.getSession()
    if (existing.error) {
      return {
        status: 'error',
        userId: null,
        isAnonymous: null,
        error: existing.error.message || 'getSession failed',
        signedInAnonymously: false,
      }
    }

    const existingUser = existing.data.session?.user
    if (existingUser?.id) {
      const { userId, isAnonymous } = readUserMeta(existingUser)
      return {
        status: 'ready',
        userId,
        isAnonymous,
        error: null,
        signedInAnonymously: false,
      }
    }

    const signedIn = await client.auth.signInAnonymously()
    if (signedIn.error) {
      return {
        status: 'error',
        userId: null,
        isAnonymous: null,
        error: signedIn.error.message || 'signInAnonymously failed',
        signedInAnonymously: true,
      }
    }

    const user = signedIn.data.session?.user || signedIn.data.user || null
    const { userId, isAnonymous } = readUserMeta(user)

    if (!userId) {
      return {
        status: 'error',
        userId: null,
        isAnonymous: null,
        error: 'Anonymous sign-in returned no user id',
        signedInAnonymously: true,
      }
    }

    return {
      status: 'ready',
      userId,
      isAnonymous: isAnonymous ?? true,
      error: null,
      signedInAnonymously: true,
    }
  } catch (error) {
    return {
      status: 'error',
      userId: null,
      isAnonymous: null,
      error: error instanceof Error ? error.message : String(error),
      signedInAnonymously: false,
    }
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
      }
    }

    const client =
      options.getClient?.() ??
      ((await import('./supabase')).getSupabase() as AuthSessionClient)

    return await ensureAnonymousAuthSession(client)
  } catch (error) {
    return {
      status: 'error',
      userId: null,
      isAnonymous: null,
      error: error instanceof Error ? error.message : String(error),
      signedInAnonymously: false,
    }
  }
}
