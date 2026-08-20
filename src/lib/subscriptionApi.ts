/**
 * #332D — Client read of verified subscription (presentation only).
 * Never treats this response as API authorization.
 */

import { resolveChatAuthForRequest } from './chatAuth'
import { parseApiErrorResponse } from './apiError'
import type { PlanId } from './planCatalog'

export type PublicSubscriptionState = {
  planId: PlanId
  status: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  provider: string | null
  resolution?: string
}

function resolveBase(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  return base.replace(/\/$/, '')
}

function subscriptionUrl(): string {
  if (!resolveBase()) return '/api/subscription'
  return `${resolveBase()}/api/subscription`
}

function normalizePlanId(value: unknown): PlanId {
  if (value === 'base' || value === 'pro' || value === 'free') return value
  return 'free'
}

/**
 * Fetch verified plan for Plans UI. On any failure → Free (display only).
 */
export async function fetchVerifiedSubscription(): Promise<PublicSubscriptionState> {
  const fallback: PublicSubscriptionState = {
    planId: 'free',
    status: 'none',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    provider: null,
    resolution: 'free_no_subscription',
  }

  try {
    const auth = await resolveChatAuthForRequest()
    if (!auth.authorization) return fallback

    const response = await fetch(subscriptionUrl(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: auth.authorization,
      },
    })

    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!response.ok) {
      parseApiErrorResponse(response, data, 'subscription_unavailable')
      return fallback
    }

    return {
      planId: normalizePlanId(data?.planId),
      status: typeof data?.status === 'string' ? data.status : 'none',
      currentPeriodEnd:
        typeof data?.currentPeriodEnd === 'string' ? data.currentPeriodEnd : null,
      cancelAtPeriodEnd: data?.cancelAtPeriodEnd === true,
      provider: typeof data?.provider === 'string' ? data.provider : null,
      resolution: typeof data?.resolution === 'string' ? data.resolution : undefined,
    }
  } catch {
    return fallback
  }
}
