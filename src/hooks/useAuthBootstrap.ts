import { useEffect, useRef, useState } from 'react'
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
 * Runs silent anonymous auth bootstrap once on mount.
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
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    let cancelled = false
    setResult((prev) => ({ ...prev, status: 'pending' }))

    void bootstrapLaifeAuth()
      .then((next) => {
        if (!cancelled) setResult(next)
        if (next.status === 'error') {
          console.warn('[auth] silent bootstrap failed', next.error)
        } else if (next.status === 'ready') {
          console.info('[auth] session ready', {
            userId: next.userId,
            isAnonymous: next.isAnonymous,
            signedInAnonymously: next.signedInAnonymously,
          })
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
