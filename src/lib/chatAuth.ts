/**
 * Client chat → auth binding for Memory 2.0 Phase 1A.4.
 *
 * Resolves a Supabase Bearer token for /api/chat using the same browser client /
 * anonymous bootstrap as the rest of the app. Soft-fail: never blocks chat.
 *
 * Prefers the app-wide single-flight bootstrapLaifeAuth() so mount + chat share
 * one in-flight anonymous sign-in (no duplicate anon users on race).
 */

import {
  bootstrapLaifeAuth,
  type AuthBootstrapResult,
  type AuthSessionClient,
} from './authSession.ts'

export interface ChatAuthResolution {
  /** Authorization header value (`Bearer …`) or null when unavailable. */
  authorization: string | null
}

export interface ResolveChatAuthOptions {
  /** When true, briefly ensure/recover anonymous session before reading token. */
  memoryEnabled?: boolean
  isConfigured?: () => boolean
  getClient?: () => AuthSessionClient
  bootstrap?: () => Promise<AuthBootstrapResult>
}

function readToken(result: AuthBootstrapResult): string | null {
  const token = typeof result.accessToken === 'string' ? result.accessToken.trim() : ''
  return token || null
}

/**
 * Resolve Bearer auth for a chat request.
 *
 * - Reuses existing anonymous session (no new anon user per message when session exists).
 * - When memoryEnabled, awaits shared bootstrap/recover if needed.
 * - When memoryEnabled is false, attaches Bearer only if a session already exists.
 */
export async function resolveChatAuthForRequest(
  options: ResolveChatAuthOptions = {},
): Promise<ChatAuthResolution> {
  const memoryEnabled = options.memoryEnabled !== false

  let isConfigured: () => boolean
  try {
    isConfigured = options.isConfigured ?? (await import('./supabase')).isSupabaseConfigured
  } catch {
    return { authorization: null }
  }

  if (!isConfigured()) {
    return { authorization: null }
  }

  try {
    // Memory off: do not force anonymous sign-in; attach existing token only.
    if (!memoryEnabled) {
      const client =
        options.getClient?.() ??
        ((await import('./supabase')).getSupabase() as AuthSessionClient)
      try {
        if (typeof client.auth.initialize === 'function') {
          await client.auth.initialize()
        }
        const { data, error } = await client.auth.getSession()
        const token =
          !error && typeof data.session?.access_token === 'string'
            ? data.session.access_token.trim()
            : ''
        return { authorization: token ? `Bearer ${token}` : null }
      } catch {
        return { authorization: null }
      }
    }

    // Memory on: await shared bootstrap (mount + chat join the same in-flight promise).
    const client =
      options.getClient?.() ??
      ((await import('./supabase')).getSupabase() as AuthSessionClient)

    const runBootstrap =
      options.bootstrap ??
      (() => {
        if (options.getClient) {
          return bootstrapLaifeAuth({
            isConfigured: () => true,
            getClient: () => client,
            useSharedInFlight: false,
          })
        }
        return bootstrapLaifeAuth()
      })

    const boot = await runBootstrap()
    let token = readToken(boot)

    // Same client re-read — covers bootstrap ready without token in the result object.
    if (!token) {
      try {
        if (typeof client.auth.initialize === 'function') {
          await client.auth.initialize()
        }
        const { data, error } = await client.auth.getSession()
        if (!error && typeof data.session?.access_token === 'string') {
          token = data.session.access_token.trim() || null
        }
      } catch {
        // soft
      }
    }

    if (!token && boot.status !== 'error' && boot.status !== 'skipped') {
      const retry = await runBootstrap()
      token = readToken(retry)
    }

    return { authorization: token ? `Bearer ${token}` : null }
  } catch {
    return { authorization: null }
  }
}
