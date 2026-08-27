/**
 * #332D / #388B — Client subscription + Stripe Test Mode billing actions.
 * Presentation / redirect only. Never treats responses as API authorization.
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
  billing?: {
    enabled: boolean
    checkoutEnabled: boolean
    portalEnabled: boolean
    mode: string
  }
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
    billing: {
      enabled: false,
      checkoutEnabled: false,
      portalEnabled: false,
      mode: 'disabled',
    },
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

    const billingRaw =
      data?.billing && typeof data.billing === 'object'
        ? (data.billing as Record<string, unknown>)
        : null

    return {
      planId: normalizePlanId(data?.planId),
      status: typeof data?.status === 'string' ? data.status : 'none',
      currentPeriodEnd:
        typeof data?.currentPeriodEnd === 'string' ? data.currentPeriodEnd : null,
      cancelAtPeriodEnd: data?.cancelAtPeriodEnd === true,
      provider: typeof data?.provider === 'string' ? data.provider : null,
      resolution: typeof data?.resolution === 'string' ? data.resolution : undefined,
      billing: {
        enabled: billingRaw?.enabled === true,
        checkoutEnabled: billingRaw?.checkoutEnabled === true,
        portalEnabled: billingRaw?.portalEnabled === true,
        mode: typeof billingRaw?.mode === 'string' ? billingRaw.mode : 'disabled',
      },
    }
  } catch {
    return fallback
  }
}

export type BillingActionResult =
  | { ok: true; url: string; planId?: PlanId; code: string }
  | { ok: false; code: string; error: string }

/**
 * Start Stripe Checkout for an internal plan id (server maps to Price).
 * Never sends Stripe Price IDs or customer IDs.
 */
export async function startPlanCheckout(planId: PlanId): Promise<BillingActionResult> {
  if (planId !== 'base' && planId !== 'pro') {
    return { ok: false, code: 'plan_not_purchasable', error: 'Piano non acquistabile.' }
  }

  try {
    const auth = await resolveChatAuthForRequest()
    if (!auth.authorization) {
      return { ok: false, code: 'unauthorized', error: 'Autenticazione richiesta.' }
    }

    const response = await fetch(subscriptionUrl(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: auth.authorization,
      },
      body: JSON.stringify({ action: 'checkout', planId }),
    })

    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!response.ok) {
      const code = typeof data?.code === 'string' ? data.code : 'checkout_failed'
      const error =
        typeof data?.error === 'string' ? data.error : 'Checkout non disponibile.'
      return { ok: false, code, error }
    }

    const url = typeof data?.url === 'string' ? data.url : ''
    if (!url) {
      return { ok: false, code: 'checkout_url_missing', error: 'URL checkout mancante.' }
    }

    return {
      ok: true,
      url,
      planId: normalizePlanId(data?.planId),
      code: typeof data?.code === 'string' ? data.code : 'checkout_created',
    }
  } catch {
    return { ok: false, code: 'checkout_failed', error: 'Checkout non disponibile.' }
  }
}

/**
 * Open Stripe Customer Portal for the authenticated owner.
 */
export async function startBillingPortal(): Promise<BillingActionResult> {
  try {
    const auth = await resolveChatAuthForRequest()
    if (!auth.authorization) {
      return { ok: false, code: 'unauthorized', error: 'Autenticazione richiesta.' }
    }

    const response = await fetch(subscriptionUrl(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: auth.authorization,
      },
      body: JSON.stringify({ action: 'portal' }),
    })

    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!response.ok) {
      const code = typeof data?.code === 'string' ? data.code : 'portal_failed'
      const error =
        typeof data?.error === 'string' ? data.error : 'Portale non disponibile.'
      return { ok: false, code, error }
    }

    const url = typeof data?.url === 'string' ? data.url : ''
    if (!url) {
      return { ok: false, code: 'portal_url_missing', error: 'URL portale mancante.' }
    }

    return {
      ok: true,
      url,
      code: typeof data?.code === 'string' ? data.code : 'portal_created',
    }
  } catch {
    return { ok: false, code: 'portal_failed', error: 'Portale non disponibile.' }
  }
}
