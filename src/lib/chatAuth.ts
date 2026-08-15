/**
 * Client chat → auth binding for Memory 2.0 Phase 1A.4.
 *
 * Resolves a Supabase Bearer token for /api/chat using the same browser client /
 * anonymous bootstrap as the rest of the app. Soft-fail: never blocks chat.
 */

import {
  bootstrapLaifeAuth,
  type AuthBootstrapResult,
  type AuthSessionClient,
} from './authSession.ts'

export type ChatClientAuthHint = 'unconfigured' | 'absent' | 'present'

export interface ChatAuthResolution {
  /** Authorization header value (`Bearer …`) or null when unavailable. */
  authorization: string | null
  clientAuthHint: ChatClientAuthHint
  clientBearerAttached: boolean
  supabaseConfigured: boolean
  bootstrapStatus: AuthBootstrapResult['status'] | null
  /** True when this call invoked anonymous sign-in recovery. */
  recoveredSession: boolean
}

export interface ResolveChatAuthOptions {
  /** When true, briefly ensure/recover anonymous session before reading token. */
  memoryEnabled?: boolean
  isConfigured?: () => boolean
  getClient?: () => AuthSessionClient
  bootstrap?: (client: AuthSessionClient) => Promise<AuthBootstrapResult>
}

function readToken(result: AuthBootstrapResult): string | null {
  const token = typeof result.accessToken === 'string' ? result.accessToken.trim() : ''
  return token || null
}

async function readSessionToken(client: AuthSessionClient): Promise<string | null> {
  try {
    const { data, error } = await client.auth.getSession()
    if (error) return null
    const token =
      typeof data.session?.access_token === 'string' ? data.session.access_token.trim() : ''
    return token || null
  } catch {
    return null
  }
}

function resolution(
  partial: Partial<ChatAuthResolution> &
    Pick<ChatAuthResolution, 'clientAuthHint' | 'supabaseConfigured'>,
): ChatAuthResolution {
  return {
    authorization: null,
    clientBearerAttached: false,
    bootstrapStatus: null,
    recoveredSession: false,
    ...partial,
  }
}

/**
 * Resolve Bearer auth for a chat request.
 *
 * - Reuses existing anonymous session (no new anon user per message when session exists).
 * - When memoryEnabled, runs bootstrap/recover if needed.
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
    return resolution({
      clientAuthHint: 'unconfigured',
      supabaseConfigured: false,
      bootstrapStatus: 'error',
    })
  }

  if (!isConfigured()) {
    return resolution({
      clientAuthHint: 'unconfigured',
      supabaseConfigured: false,
      bootstrapStatus: 'skipped',
    })
  }

  try {
    const client =
      options.getClient?.() ??
      ((await import('./supabase')).getSupabase() as AuthSessionClient)

    const runBootstrap =
      options.bootstrap ??
      ((c: AuthSessionClient) =>
        bootstrapLaifeAuth({
          isConfigured: () => true,
          getClient: () => c,
        }))

    // Memory off: do not force anonymous sign-in; attach existing token only.
    if (!memoryEnabled) {
      const token = await readSessionToken(client)
      if (token) {
        return resolution({
          authorization: `Bearer ${token}`,
          clientAuthHint: 'present',
          clientBearerAttached: true,
          supabaseConfigured: true,
        })
      }
      return resolution({
        clientAuthHint: 'absent',
        supabaseConfigured: true,
      })
    }

    // Memory on: ensure/recover session (reuse existing; sign-in only if missing).
    const boot = await runBootstrap(client)
    let token = readToken(boot)
    let recoveredSession = boot.signedInAnonymously === true

    if (!token) {
      token = await readSessionToken(client)
    }

    // Soft second ensure for hydration races (still locked against duplicate anon users).
    if (!token && boot.status !== 'error' && boot.status !== 'skipped') {
      const retry = await runBootstrap(client)
      token = readToken(retry) ?? (await readSessionToken(client))
      recoveredSession = recoveredSession || retry.signedInAnonymously === true
    }

    if (token) {
      return resolution({
        authorization: `Bearer ${token}`,
        clientAuthHint: 'present',
        clientBearerAttached: true,
        supabaseConfigured: true,
        bootstrapStatus: boot.status,
        recoveredSession,
      })
    }

    return resolution({
      clientAuthHint: 'absent',
      supabaseConfigured: true,
      bootstrapStatus: boot.status,
      recoveredSession,
    })
  } catch {
    return resolution({
      clientAuthHint: 'absent',
      supabaseConfigured: true,
      bootstrapStatus: 'error',
    })
  }
}
