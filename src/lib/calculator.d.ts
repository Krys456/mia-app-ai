/**
 * #318 — Calculator TypeScript declarations for ChatContext.
 */

export function detectCalculatorIntent(
  raw: string,
  opts?: { languageHint?: 'it' | 'en'; hasCalcContext?: boolean },
): {
  intent: 'calculator' | 'none'
  language: 'it' | 'en'
  operation?: string
  expressionText?: string | null
  followUp?: boolean
  followUpKind?: string
  operand?: number
  decimals?: number
  percentHit?: boolean
  failureCode?: string | null
}

export function detectCalculatorLanguage(text: string, fallback?: 'it' | 'en'): 'it' | 'en'

export function applyCalculatorIntent(input: {
  text: string
  languageHint?: 'it' | 'en'
  calcContext?: unknown
  env?: { copyTextSync?: (t: string) => boolean }
}): {
  handled: boolean
  reply: string | null
  status?: string
  result?: number
  displayResult?: string
  calcContext?: unknown
  calcUi?: import('../types').CalculatorUiState | null
  calculationContextBlock?: string
  diag: Record<string, unknown>
}

export function loadCalculationContext(storage?: Storage | null, nowMs?: number): unknown
export function saveCalculationContext(ctx: unknown, storage?: Storage | null): void
export function clearCalculationContext(storage?: Storage | null): void
export function isCalculationContextFresh(ctx: unknown, nowMs?: number): boolean

export const CALCULATOR_DIAG_BUILD: string
export function isCalculatorDiagEnabled(search?: string | null): boolean
export function buildCalculatorDiag(partial?: Record<string, unknown>): Record<string, unknown>
export function rememberCalculatorDiag(payload: unknown): void
export function logCalculatorSafe(event: Record<string, unknown>): void

export function calculatorCopy(key: string, lang: 'it' | 'en', vars?: Record<string, unknown>): string
export const CALC_CONTEXT_TTL_MS: number
