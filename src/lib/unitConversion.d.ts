/**
 * #319 — Unit Conversion TypeScript declarations for ChatContext.
 */

export function detectUnitConversionIntent(
  raw: string,
  opts?: { languageHint?: 'it' | 'en'; hasConversionContext?: boolean },
): {
  intent: 'unit-conversion' | 'none'
  language: 'it' | 'en'
  operation?: string
  value?: number
  sourceUnitId?: string
  targetUnitId?: string
  followUp?: boolean
  followUpKind?: string
  decimals?: number
  failureCode?: string | null
}

export function detectUnitConversionLanguage(text: string, fallback?: 'it' | 'en'): 'it' | 'en'

export function applyUnitConversionIntent(input: {
  text: string
  languageHint?: 'it' | 'en'
  conversionContext?: unknown
  env?: { copyTextSync?: (t: string) => boolean }
}): {
  handled: boolean
  reply: string | null
  status?: string
  result?: number
  displayResult?: string
  conversionContext?: unknown
  unitUi?: import('../types').UnitConversionUiState | null
  diag: Record<string, unknown>
}

export function loadConversionContext(storage?: Storage | null, nowMs?: number): unknown
export function saveConversionContext(ctx: unknown, storage?: Storage | null): void
export function clearConversionContext(storage?: Storage | null): void
export function isConversionContextFresh(ctx: unknown, nowMs?: number): boolean

export const UNIT_CONVERSION_DIAG_BUILD: string
export function isUnitConversionDiagEnabled(search?: string | null): boolean
export function buildUnitConversionDiag(partial?: Record<string, unknown>): Record<string, unknown>
export function rememberUnitConversionDiag(payload: unknown): void
export function logUnitConversionSafe(event: Record<string, unknown>): void

export function unitConversionCopy(key: string, lang: 'it' | 'en', vars?: Record<string, unknown>): string
export const CONV_CONTEXT_TTL_MS: number
