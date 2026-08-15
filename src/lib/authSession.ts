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

/** Temporary Preview-safe auth flow diagnostics — never includes tokens. */
export interface AuthFlowDiag {
  bootstrapStarted: boolean
  bootstrapCompleted: boolean
  signInAttempted: boolean
  signInSucceeded: boolean
  signInFailed: boolean
  getSessionHasSession: boolean
  sessionHasAccessToken: boolean
  usedSharedInFlight: boolean
  authErrorCode: string | null
  authErrorMessage: string | null
}

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
  /** Preview-safe flow diagnostics (no tokens). */
  diag: AuthFlowDiag
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

function emptyDiag(partial: Partial<AuthFlowDiag> = {}): AuthFlowDiag {
  return {
    bootstrapStarted: false,
    bootstrapCompleted: false,
    signInAttempted: false,
    signInSucceeded: false,
    signInFailed: false,
    getSessionHasSession: false,
    sessionHasAccessToken: false,
    usedSharedInFlight: false,
    authErrorCode: null,
    authErrorMessage: null,
    ...partial,
  }
}

/**
 * Sanitize auth errors for Preview diagnostics — no JWTs / secrets.
 * @param {unknown} error
 * @returns {{ code: string | null, message: string | null }}
 */
export function sanitizeAuthFlowError(error: unknown): {
  code: string | null
  message: string | null
} {
  if (error == null) return { code: null, message: null }

  let code: string | null = null
  let message: string

  if (typeof error === 'object') {
    const obj = error as { code?: unknown; message?: unknown; name?: unknown }
    if (typeof obj.code === 'string' && obj.code.trim()) code = obj.code.trim().slice(0, 64)
    else if (typeof obj.name === 'string' && obj.name.trim()) code = obj.name.trim().slice(0, 64)
    message =
      typeof obj.message === 'string' && obj.message.trim()
        ? obj.message
        : String(error)
  } else if (error instanceof Error) {
    code = error.name || null
    message = error.message
  } else {
    message = String(error)
  }

  message = message
    .replace(/Bearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]')
    .replace(/service[_-]?role[^\s]*/gi, '[redacted]')
    .replace(/sb_secret_[^\s]+/gi, '[redacted]')
    .replace(/apikey[^\s=]*=\s*\S+/gi, 'apikey=[redacted]')
    .slice(0, 180)

  return { code, message: message || null }
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
  diag: AuthFlowDiag
}): AuthBootstrapResult {
  return {
    status: 'ready',
    userId: input.userId,
    isAnonymous: input.isAnonymous,
    error: null,
    signedInAnonymously: input.signedInAnonymously,
    accessToken: input.accessToken,
    diag: {
      ...input.diag,
      bootstrapCompleted: true,
      getSessionHasSession: true,
      sessionHasAccessToken: true,
      authErrorCode: null,
      authErrorMessage: null,
    },
  }
}

function errorResult(
  error: unknown,
  diag: AuthFlowDiag,
  signedInAnonymously = false,
): AuthBootstrapResult {
  const sanitized = sanitizeAuthFlowError(error)
  return {
    status: 'error',
    userId: null,
    isAnonymous: null,
    error: sanitized.message,
    signedInAnonymously,
    accessToken: null,
    diag: {
      ...diag,
      bootstrapCompleted: true,
      authErrorCode: sanitized.code,
      authErrorMessage: sanitized.message,
    },
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

async function signInAnonymouslyOnce(
  client: AuthSessionClient,
  diag: AuthFlowDiag,
): Promise<AuthBootstrapResult> {
  const existingLock = anonSignInLocks.get(client)
  if (existingLock) {
    const shared = await existingLock
    return {
      ...shared,
      diag: {
        ...shared.diag,
        usedSharedInFlight: true,
        bootstrapStarted: true,
        bootstrapCompleted: true,
      },
    }
  }

  const lock = (async (): Promise<AuthBootstrapResult> => {
    diag.signInAttempted = true
    const signedIn = await client.auth.signInAnonymously()
    if (signedIn.error) {
      diag.signInFailed = true
      return errorResult(signedIn.error, diag, true)
    }

    const session = signedIn.data.session
    const user = session?.user || signedIn.data.user || null
    const { userId, isAnonymous } = readUserMeta(user)
    let token = readAccessToken(session)

    diag.getSessionHasSession = Boolean(session)
    diag.sessionHasAccessToken = Boolean(token)

    if (!userId) {
      diag.signInFailed = true
      return errorResult('Anonymous sign-in returned no user id', diag, true)
    }

    // Response session missing token — re-read once from the same client.
    if (!token) {
      const refresh = await client.auth.getSession()
      if (!refresh.error) {
        diag.getSessionHasSession = Boolean(refresh.data.session)
        token = readAccessToken(refresh.data.session)
        diag.sessionHasAccessToken = Boolean(token)
      }
    }

    if (!token) {
      diag.signInFailed = true
      return errorResult('Anonymous sign-in returned no access token', diag, true)
    }

    diag.signInSucceeded = true
    return readyResult({
      userId,
      isAnonymous: isAnonymous ?? true,
      signedInAnonymously: true,
      accessToken: token,
      diag,
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
  const diag = emptyDiag({ bootstrapStarted: true })

  try {
    await ensureAuthInitialized(client)

    const existing = await client.auth.getSession()
    if (existing.error) {
      return errorResult(existing.error, diag)
    }

    const existingSession = existing.data.session
    diag.getSessionHasSession = Boolean(existingSession)

    const existingUser = existingSession?.user
    if (existingUser?.id) {
      const { userId, isAnonymous } = readUserMeta(existingUser)
      let accessToken = readAccessToken(existingSession)
      diag.sessionHasAccessToken = Boolean(accessToken)

      // Session row present but token missing — soft re-read / refresh before sign-in.
      if (userId && !accessToken) {
        const refresh = await client.auth.getSession()
        if (!refresh.error) {
          diag.getSessionHasSession = Boolean(refresh.data.session)
          accessToken = readAccessToken(refresh.data.session)
          diag.sessionHasAccessToken = Boolean(accessToken)
        }
      }

      if (userId && !accessToken && typeof client.auth.refreshSession === 'function') {
        try {
          const refreshed = await client.auth.refreshSession()
          if (!refreshed.error) {
            accessToken = readAccessToken(refreshed.data.session)
            diag.getSessionHasSession = Boolean(refreshed.data.session)
            diag.sessionHasAccessToken = Boolean(accessToken)
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
          diag,
        })
      }

      // User present without token (corrupt/partial storage) — recover via anon sign-in.
    }

    return await signInAnonymouslyOnce(client, diag)
  } catch (error) {
    return errorResult(error, diag)
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
        diag: emptyDiag({
          bootstrapStarted: true,
          bootstrapCompleted: true,
          authErrorCode: 'not_configured',
          authErrorMessage: 'Supabase is not configured in this environment',
        }),
      }
    }

    const client =
      options.getClient?.() ??
      ((await import('./supabase')).getSupabase() as AuthSessionClient)

    return await ensureAnonymousAuthSession(client)
  } catch (error) {
    return errorResult(error, emptyDiag({ bootstrapStarted: true, bootstrapCompleted: true }))
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
    const shared = await sharedBootstrapInFlight
    return {
      ...shared,
      diag: {
        ...shared.diag,
        usedSharedInFlight: true,
        bootstrapStarted: true,
        bootstrapCompleted: true,
      },
    }
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
