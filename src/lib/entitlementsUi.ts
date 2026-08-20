/**
 * #332B — Client-side entitlement UX helpers (non-authoritative).
 *
 * Server `lib/server/entitlements.js` is the authorization source of truth.
 * This module only helps the UI interpret `entitlement_required` responses
 * and navigate to Plans. It must never grant premium API access.
 */

import type { PlanId } from './planCatalog'
import { UI_FOUNDATION_CURRENT_PLAN_ID } from './planCatalog'

/** Mirrors server EntitlementKey for typed client handling of API errors. */
export type EntitlementKey =
  | 'coreChat'
  | 'basicMemory'
  | 'advancedMemory'
  | 'webSearch'
  | 'documents'
  | 'voice'
  | 'gmail'
  | 'calendar'
  | 'vision'
  | 'advancedModel'
  | 'imageGeneration'

export type EntitlementRequiredDetails = {
  code: 'entitlement_required'
  entitlement?: string
  requiredPlan?: PlanId
}

/**
 * Runtime current plan for UI (#332A/#332B).
 * Always Free until a later phase supplies verified subscription state.
 * Do not read localStorage / query / client-claimed plan.
 */
export function getCurrentPlanId(): PlanId {
  return UI_FOUNDATION_CURRENT_PLAN_ID
}

export function isEntitlementRequiredCode(code: string | null | undefined): boolean {
  return code === 'entitlement_required'
}

/**
 * Future soft UX: after entitlement_required, open Plans AppView.
 * Call sites should use App navigation — this is the stable view id.
 */
export const PLANS_APP_VIEW = 'plans' as const

/**
 * Italian copy for entitlement_required (no billing-provider details).
 */
export function userFacingEntitlementMessage(input: {
  entitlement?: string | null
  requiredPlan?: string | null
}): string {
  const entitlement =
    typeof input.entitlement === 'string' ? input.entitlement.trim() : ''
  const plan = typeof input.requiredPlan === 'string' ? input.requiredPlan.trim().toLowerCase() : ''

  if (entitlement === 'webSearch') {
    return 'La ricerca web è inclusa nel piano Base. Vedi i piani ShinkAIdo.'
  }
  if (entitlement === 'documents') {
    return 'I documenti sono inclusi nel piano Base. Vedi i piani ShinkAIdo.'
  }
  if (entitlement === 'voice') {
    return 'La voce è inclusa nel piano Base. Vedi i piani ShinkAIdo.'
  }
  if (entitlement === 'vision') {
    return 'Vision è disponibile con ShinkAIdo Pro. Vedi i piani.'
  }
  if (entitlement === 'imageGeneration') {
    return 'La generazione immagini è disponibile con ShinkAIdo Pro. Vedi i piani.'
  }

  const planLabel =
    plan === 'pro' ? 'Pro' : plan === 'base' ? 'Base' : plan ? plan : 'un piano superiore'

  return `Questa funzione richiede ${planLabel}. Vedi i piani ShinkAIdo.`
}
