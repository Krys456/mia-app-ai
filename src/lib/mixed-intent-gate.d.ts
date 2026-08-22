/**
 * #364B — Type declarations for mixed-intent-gate.js
 */
export const MIXED_INTENT_GATE_BUILD: '364b-1'

export type MixedIntentRouterType =
  | 'translation'
  | 'timer'
  | 'reminder'
  | 'calculator'
  | 'units'
  | 'weather'
  | 'briefing'
  | 'phone'
  | 'calendar'
  | 'email'
  | 'places'
  | 'energy'
  | 'other'

export function residualAfterCapabilityRemoval(
  fullText: string,
  opts?: {
    detectedSpan?: string | null
    sourceText?: string | null
    routerType?: MixedIntentRouterType
  },
): string

export function residualLooksLikeIndependentAsk(residual: string): boolean

export function shouldLocalRouterClaimWholeTurn(input: {
  routerType: MixedIntentRouterType
  fullText: string
  detectedSpan?: string | null
  sourceText?: string | null
  intentMetadata?: Record<string, unknown> | null
}): {
  claimWholeTurn: boolean
  reason: string
  residual: string
  residualAsk: boolean
}

export function localRouterMayClaim(
  intentMatched: boolean,
  gateInput: Parameters<typeof shouldLocalRouterClaimWholeTurn>[0],
): ReturnType<typeof shouldLocalRouterClaimWholeTurn>
