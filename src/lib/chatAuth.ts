/**
 * Client → server Bearer resolution for paid APIs (#298A).
 *
 * Always bootstraps / reuses the anonymous Supabase session so Authorization
 * is present before chat, selection, TTS, and file upload. Soft client failure
 * returns null — callers must not send the request without a token.
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
  /**
   * @deprecated #298A — paid APIs always require a session; ignored for bootstrap.
   * Kept for call-site compatibility.
   */
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
 * Resolve Bearer auth for a paid API request.
 *
 * - Reuses existing anonymous session when present.
 * - Otherwise awaits shared bootstrapLaifeAuth() (mount + APIs share one flight).
 * - Never invents a client user id; server verifies JWT.
 */
export async function resolveChatAuthForRequest(
  options: ResolveChatAuthOptions = {},
): Promise<ChatAuthResolution> {
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
        // soft — return null below
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
