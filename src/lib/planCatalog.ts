/**
 * #332A — Static ShinkAIdo Plans catalog (UI foundation only).
 *
 * Provisional product-design prices for Preview evaluation.
 * When billing is integrated, provider-derived prices (Play / App Store / Stripe)
 * should replace these static `priceLabel` strings — do not scatter prices in UI.
 *
 * Presentation only. Authorization lives in `lib/server/entitlements.js` (#332B).
 * Feature bullets here must never gate API access.
 *
 * No entitlement enforcement. No purchase. No schema.
 */

export type PlanId = 'free' | 'base' | 'pro'

export type PlanBillingPeriod = 'month' | 'none'

export type PlanDefinition = {
  planId: PlanId
  displayName: string
  description: string
  /** Display-only provisional label. Not a live store price. */
  priceLabel: string
  billingPeriod: PlanBillingPeriod
  /** Short user-facing bullets (not technical docs). */
  features: string[]
  /** Subtle visual emphasis in the catalog (not a dark-pattern badge). */
  featured?: boolean
  /**
   * Future provider SKU mapping placeholders — unused in #332A.
   * Keep keys stable so the UI catalog does not need a rewrite later.
   */
  productIds?: {
    web?: string
    android?: string
    ios?: string
  }
}

/**
 * #332A temporary UI source of truth for “current plan”.
 * Always Free until verified subscription state exists.
 * Do not persist. Do not infer from client storage.
 * Prefer `getCurrentPlanId()` from `entitlementsUi.ts` at call sites.
 */
export const UI_FOUNDATION_CURRENT_PLAN_ID: PlanId = 'free'

export const PLAN_CATALOG: readonly PlanDefinition[] = Object.freeze([
  {
    planId: 'free',
    displayName: 'Free',
    description: 'Esperienza ShinkAIdo essenziale, già utile ogni giorno.',
    priceLabel: '€0',
    billingPeriod: 'none',
    features: [
      'Chat ShinkAIdo con personalità',
      'Intelligenza conversazionale',
      'Memoria di base',
      'Strumenti quotidiani',
    ],
  },
  {
    planId: 'base',
    displayName: 'Base',
    description: 'Assistente più completo per ricerca, documenti e integrazioni.',
    // Provisional product-design value — replace with provider price later.
    priceLabel: '€1,99',
    billingPeriod: 'month',
    featured: true,
    features: [
      'Tutto di Free',
      'Ricerca web',
      'Documenti',
      'Più capacità di Memoria',
      'Accesso voce',
      'Integrazioni Gmail e Calendar',
    ],
    productIds: {
      web: 'shinkaido_base_monthly',
      android: 'shinkaido_base_monthly',
      ios: 'shinkaido_base_monthly',
    },
  },
  {
    planId: 'pro',
    displayName: 'Pro',
    description: 'Modelli avanzati e capacità più impegnative in termini di calcolo.',
    // Provisional product-design value — replace with provider price later.
    priceLabel: '€7,99',
    billingPeriod: 'month',
    features: [
      'Tutto di Base',
      'Modelli AI avanzati',
      'Vision / fotocamera',
      'Maggiore utilizzo delle funzioni costose',
      'Funzioni ShinkAIdo avanzate',
    ],
    productIds: {
      web: 'shinkaido_pro_monthly',
      android: 'shinkaido_pro_monthly',
      ios: 'shinkaido_pro_monthly',
    },
  },
])

export function getPlanById(planId: PlanId): PlanDefinition | undefined {
  return PLAN_CATALOG.find((p) => p.planId === planId)
}

export function formatPlanPrice(plan: PlanDefinition): string {
  if (plan.billingPeriod === 'month') {
    return `${plan.priceLabel} / mese`
  }
  return plan.priceLabel
}
