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
  ordinal?: number | null
  beforeHour?: number | null
  failureCode?: string | null
}

export function detectBriefingFollowUp(t: string): {
  kind: string
  ordinal?: number
  beforeHour?: number
} | null

export function detectBriefingLanguage(text: string, fallback?: 'it' | 'en'): 'it' | 'en'

export function applyDailyBriefingIntent(input: {
  text: string
  languageHint?: 'it' | 'en'
  briefingContext?: unknown
  weatherContext?: unknown
  now?: Date
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

export function renderDailyBriefing(
  model: unknown,
  language?: 'it' | 'en',
  opts?: { now?: Date },
): string

export function composeDailyBriefing(
  model: unknown,
  language?: 'it' | 'en',
  opts?: { now?: Date },
): { text: string; priorities: unknown[]; presentationItems: unknown[] }

export function buildBriefingUi(
  model: unknown,
  language?: 'it' | 'en',
): import('../types').DailyBriefingUiState | null

export function safeTitle(title: string): string
export function greetingForDayPart(
  language: 'it' | 'en',
  part: 'morning' | 'afternoon' | 'evening',
): string
export function buildBriefingPriorities(model: unknown, opts?: { now?: Date }): unknown[]
export function dayPartInZone(
  timeZone: string,
  now?: Date,
): 'morning' | 'afternoon' | 'evening'
export function answerBriefingFollowUp(
  intent: { followUpKind: string; beforeHour?: number | null; ordinal?: number | null },
  ctx: unknown,
  language: 'it' | 'en',
  opts?: { now?: Date },
): {
  handled: boolean
  reply: string
  briefingContext: unknown
  diag: Record<string, unknown>
}