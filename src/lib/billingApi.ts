/**
 * #332E3A — Client billing actions (Checkout only).
 * Never trusts success URL. Never sends Stripe Price IDs.
 */

import { resolveChatAuthForRequest } from './chatAuth'
import { parseApiErrorResponse } from './apiError'
import type { PlanId } from './planCatalog'

export type CreateCheckoutResult =
  | {
      ok: true
      checkoutUrl: string
      sessionId: string
      targetPlan: 'base' | 'pro'
    }
  | {
      ok: false
      status: number
      code: string
      error: string
    }

function resolveBase(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  return base.replace(/\/$/, '')
}

function billingUrl(): string {
  if (!resolveBase()) return '/api/billing'
  return `${resolveBase()}/api/billing`
}

/**
 * Create Stripe Checkout Session for Base/Pro (server maps Price ID).
 */
export async function createCheckoutSession(
  targetPlan: Extract<PlanId, 'base' | 'pro'>,
): Promise<CreateCheckoutResult> {
  try {
    const auth = await resolveChatAuthForRequest()
    if (!auth.authorization) {
      return {
        ok: false,
        status: 401,
        code: 'unauthorized',
        error: 'Authentication required.',
      }
    }

    const response = await fetch(billingUrl(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: auth.authorization,
      },
      body: JSON.stringify({
        action: 'create_checkout',
        targetPlan,
      }),
    })

    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!response.ok) {
      const parsed = parseApiErrorResponse(response, data, 'checkout_creation_failed')
      return {
        ok: false,
        status: response.status,
        code: typeof data?.code === 'string' ? data.code : parsed.code || 'checkout_creation_failed',
        error:
          typeof data?.error === 'string'
            ? data.error
            : parsed.message || 'Unable to start checkout.',
      }
    }

    const checkoutUrl = typeof data?.checkoutUrl === 'string' ? data.checkoutUrl : ''
    if (!checkoutUrl) {
      return {
        ok: false,
        status: 502,
        code: 'checkout_creation_failed',
        error: 'Unable to start checkout.',
      }
    }

    const plan =
      data?.targetPlan === 'base' || data?.targetPlan === 'pro' ? data.targetPlan : targetPlan

    return {
      ok: true,
      checkoutUrl,
      sessionId: typeof data?.sessionId === 'string' ? data.sessionId : '',
      targetPlan: plan,
    }
  } catch {
    return {
      ok: false,
      status: 503,
      code: 'billing_unavailable',
      error: 'Billing temporarily unavailable.',
    }
  }
}

/** Read checkout UX marker from URL (never grants plan). */
export function readCheckoutReturnMarker(): 'success' | 'canceled' | null {
  if (typeof window === 'undefined') return null
  try {
    const params = new URLSearchParams(window.location.search)
    const value = params.get('checkout')
    if (value === 'success' || value === 'canceled') return value
    return null
  } catch {
    return null
  }
}

/** Whether URL asks to open Plans (Stripe return). */
export function shouldOpenPlansFromUrl(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('plans') === '1' || params.has('checkout')
  } catch {
    return false
  }
}

/** Strip checkout/plans query markers after Plans handles them. */
export function clearCheckoutReturnQuery(): void {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete('checkout')
    url.searchParams.delete('plans')
    const next = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState({}, '', next)
  } catch {
    /* ignore */
  }
}
