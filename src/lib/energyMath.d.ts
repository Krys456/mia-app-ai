/**
 * #320 — Energy Math TypeScript declarations for ChatContext.
 */

export function detectEnergyMathIntent(
  raw: string,
  opts?: { languageHint?: 'it' | 'en'; hasEnergyContext?: boolean },
): {
  intent: 'energy-math' | 'none'
  language: 'it' | 'en'
  operation?: string
  assumptionMode?: string
  followUp?: boolean
  failureCode?: string | null
}

export function detectEnergyMathLanguage(text: string, fallback?: 'it' | 'en'): 'it' | 'en'

export function applyEnergyMathIntent(input: {
  text: string
  languageHint?: 'it' | 'en'
  energyContext?: unknown
  env?: { copyTextSync?: (t: string) => boolean }
}): {
  handled: boolean
  reply: string | null
  status?: string
  result?: number
  displayResult?: string
  energyContext?: unknown
  energyUi?: import('../types').EnergyMathUiState | null
  energyMathContextBlock?: string
  diag: Record<string, unknown>
}

export function loadEnergyMathContext(storage?: Storage | null, nowMs?: number): unknown
export function saveEnergyMathContext(ctx: unknown, storage?: Storage | null): void
export function clearEnergyMathContext(storage?: Storage | null): void
export function isEnergyMathContextFresh(ctx: unknown, nowMs?: number): boolean

export const ENERGY_MATH_DIAG_BUILD: string
export function isEnergyMathDiagEnabled(search?: string | null): boolean
export function buildEnergyMathDiag(partial?: Record<string, unknown>): Record<string, unknown>
export function rememberEnergyMathDiag(payload: unknown): void
export function logEnergyMathSafe(event: Record<string, unknown>): void

export function energyMathCopy(key: string, lang: 'it' | 'en', vars?: Record<string, unknown>): string
export const ENERGY_MATH_CONTEXT_TTL_MS: number
