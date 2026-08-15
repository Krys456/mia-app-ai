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
  type AuthFlowDiag,
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
  /** Preview-safe auth flow diagnostics (no tokens). */
  flowDiag: AuthFlowDiag
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

function emptyFlowDiag(partial: Partial<AuthFlowDiag> = {}): AuthFlowDiag {
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

function resolution(
  partial: Partial<ChatAuthResolution> &
    Pick<ChatAuthResolution, 'clientAuthHint' | 'supabaseConfigured'>,
): ChatAuthResolution {
  return {
    authorization: null,
    clientBearerAttached: false,
    bootstrapStatus: null,
    recoveredSession: false,
    flowDiag: emptyFlowDiag(),
    ...partial,
  }
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return resolution({
      clientAuthHint: 'unconfigured',
      supabaseConfigured: false,
      bootstrapStatus: 'error',
      flowDiag: emptyFlowDiag({
        bootstrapStarted: true,
        bootstrapCompleted: true,
        authErrorCode: 'supabase_import_failed',
        authErrorMessage: message.slice(0, 180),
      }),
    })
  }

  if (!isConfigured()) {
    return resolution({
      clientAuthHint: 'unconfigured',
      supabaseConfigured: false,
      bootstrapStatus: 'skipped',
      flowDiag: emptyFlowDiag({
        bootstrapStarted: true,
        bootstrapCompleted: true,
        authErrorCode: 'not_configured',
        authErrorMessage: 'Supabase is not configured in this environment',
      }),
    })
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
        if (token) {
          return resolution({
            authorization: `Bearer ${token}`,
            clientAuthHint: 'present',
            clientBearerAttached: true,
            supabaseConfigured: true,
            flowDiag: emptyFlowDiag({
              bootstrapStarted: true,
              bootstrapCompleted: true,
              getSessionHasSession: true,
              sessionHasAccessToken: true,
            }),
          })
        }
        return resolution({
          clientAuthHint: 'absent',
          supabaseConfigured: true,
          flowDiag: emptyFlowDiag({
            bootstrapStarted: true,
            bootstrapCompleted: true,
            getSessionHasSession: Boolean(data.session),
            sessionHasAccessToken: false,
            authErrorCode: error?.code ? String(error.code) : null,
            authErrorMessage: error?.message ? String(error.message).slice(0, 180) : null,
          }),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return resolution({
          clientAuthHint: 'absent',
          supabaseConfigured: true,
          bootstrapStatus: 'error',
          flowDiag: emptyFlowDiag({
            bootstrapStarted: true,
            bootstrapCompleted: true,
            authErrorCode: 'get_session_failed',
            authErrorMessage: message.slice(0, 180),
          }),
        })
      }
    }

    // Memory on: await shared bootstrap (mount + chat join the same in-flight promise).
    const runBootstrap =
      options.bootstrap ??
      (() => {
        if (options.getClient) {
          return bootstrapLaifeAuth({
            isConfigured: () => true,
            getClient: options.getClient,
            useSharedInFlight: false,
          })
        }
        // Default path: join app-wide single-flight bootstrap.
        return bootstrapLaifeAuth()
      })

    const boot = await runBootstrap()
    let token = readToken(boot)
    let recoveredSession = boot.signedInAnonymously === true
    let flowDiag = { ...boot.diag }

    // Soft second ensure only when first attempt did not hard-error.
    if (!token && boot.status !== 'error' && boot.status !== 'skipped') {
      const retry = await runBootstrap()
      token = readToken(retry)
      recoveredSession = recoveredSession || retry.signedInAnonymously === true
      flowDiag = {
        ...retry.diag,
        bootstrapStarted: true,
        bootstrapCompleted: true,
        usedSharedInFlight: flowDiag.usedSharedInFlight || retry.diag.usedSharedInFlight,
        signInAttempted: flowDiag.signInAttempted || retry.diag.signInAttempted,
        signInSucceeded: flowDiag.signInSucceeded || retry.diag.signInSucceeded,
        signInFailed: flowDiag.signInFailed || retry.diag.signInFailed,
      }
    }

    if (token) {
      return resolution({
        authorization: `Bearer ${token}`,
        clientAuthHint: 'present',
        clientBearerAttached: true,
        supabaseConfigured: true,
        bootstrapStatus: boot.status,
        recoveredSession,
        flowDiag,
      })
    }

    return resolution({
      clientAuthHint: 'absent',
      supabaseConfigured: true,
      bootstrapStatus: boot.status,
      recoveredSession,
      flowDiag: {
        ...flowDiag,
        bootstrapCompleted: true,
        sessionHasAccessToken: false,
        authErrorCode: flowDiag.authErrorCode || (boot.error ? 'bootstrap_no_token' : null),
        authErrorMessage:
          flowDiag.authErrorMessage ||
          (boot.error ? String(boot.error).slice(0, 180) : 'No access token after bootstrap'),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return resolution({
      clientAuthHint: 'absent',
      supabaseConfigured: true,
      bootstrapStatus: 'error',
      flowDiag: emptyFlowDiag({
        bootstrapStarted: true,
        bootstrapCompleted: true,
        authErrorCode: 'resolve_threw',
        authErrorMessage: message.slice(0, 180),
      }),
    })
  }
}

/** Flatten flow diag into memoryDiag-safe fields (no tokens). */
export function chatAuthFlowDiagFields(auth: ChatAuthResolution): Record<string, unknown> {
  const d = auth.flowDiag
  return {
    bootstrapStarted: d.bootstrapStarted,
    bootstrapCompleted: d.bootstrapCompleted,
    signInAttempted: d.signInAttempted,
    signInSucceeded: d.signInSucceeded,
    signInFailed: d.signInFailed,
    getSessionHasSession: d.getSessionHasSession,
    sessionHasAccessToken: d.sessionHasAccessToken,
    usedSharedInFlight: d.usedSharedInFlight,
    bootstrapStatus: auth.bootstrapStatus,
    recoveredSession: auth.recoveredSession,
    authErrorCode: d.authErrorCode,
    authErrorMessage: d.authErrorMessage,
  }
}
