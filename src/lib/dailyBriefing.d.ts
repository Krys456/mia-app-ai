/**
 * #321 — Daily Briefing TypeScript declarations for ChatContext.
 */

export function detectDailyBriefingIntent(
  raw: string,
  opts?: { languageHint?: 'it' | 'en'; hasBriefingContext?: boolean },
): {
  intent: 'daily-briefing' | 'none'
  language: 'it' | 'en'
  target?: 'today' | 'tomorrow'
  locationText?: string | null
  followUp?: boolean
  followUpKind?: string
  failureCode?: string | null
}

export function detectBriefingLanguage(text: string, fallback?: 'it' | 'en'): 'it' | 'en'

export function applyDailyBriefingIntent(input: {
  text: string
  languageHint?: 'it' | 'en'
  briefingContext?: unknown
  weatherContext?: unknown
}): Promise<{
  handled: boolean
  reply: string | null
  status?: string
  briefingContext?: unknown
  briefingUi?: import('../types').DailyBriefingUiState | null
  diag: Record<string, unknown>
}>

export function loadBriefingContext(storage?: Storage | null, nowMs?: number): unknown
export function saveBriefingContext(ctx: unknown, storage?: Storage | null): void
export function clearBriefingContext(storage?: Storage | null): void
export function isBriefingContextFresh(ctx: unknown, nowMs?: number): boolean

export const DAILY_BRIEFING_DIAG_BUILD: string
export function isDailyBriefingDiagEnabled(search?: string | null): boolean
export function buildDailyBriefingDiag(partial?: Record<string, unknown>): Record<string, unknown>
export function rememberDailyBriefingDiag(payload: unknown): void
export function logDailyBriefingSafe(event: Record<string, unknown>): void

export const BRIEFING_CONTEXT_TTL_MS: number
