import { useEffect, useState } from 'react'
import {
  bootstrapLaifeAuth,
  type AuthBootstrapResult,
  type AuthBootstrapStatus,
} from '../lib/authSession'

const INITIAL: AuthBootstrapResult = {
  status: 'idle',
  userId: null,
  isAnonymous: null,
  error: null,
  signedInAnonymously: false,
  accessToken: null,
}

/**
 * Runs silent anonymous auth bootstrap on mount.
 * Joins the app-wide single-flight bootstrapLaifeAuth() so chat requests
 * await the same in-flight promise instead of racing a second sign-in.
 * Never blocks rendering; failures are soft (status/error only).
 */
export function useAuthBootstrap(): {
  status: AuthBootstrapStatus
  userId: string | null
  isAnonymous: boolean | null
  error: string | null
  result: AuthBootstrapResult
} {
  const [result, setResult] = useState<AuthBootstrapResult>(INITIAL)

  useEffect(() => {
    let cancelled = false
    setResult((prev) => ({ ...prev, status: 'pending' }))

    // Shares in-flight promise with chatApi → resolveChatAuthForRequest.
    void bootstrapLaifeAuth()
      .then((next) => {
        if (!cancelled) setResult(next)
        if (next.status === 'error') {
          console.warn('[auth] silent bootstrap failed', next.error)
        }
      })
      .catch((error) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        console.warn('[auth] silent bootstrap crashed', message)
        setResult({
          status: 'error',
          userId: null,
          isAnonymous: null,
          error: message,
          signedInAnonymously: false,
          accessToken: null,
        })
      })

    return () => {
      cancelled = true
    }
  }, [])

  return {
    status: result.status,
    userId: result.userId,
    isAnonymous: result.isAnonymous,
    error: result.error,
    result,
  }
}
