/**
 * #322 — Translation TypeScript declarations for ChatContext.
 */

export function detectTranslationIntent(
  raw: string,
  opts?: { languageHint?: 'it' | 'en'; hasTranslationContext?: boolean },
): {
  intent: 'translation' | 'none'
  language: 'it' | 'en'
  operation?: string
  sourceText?: string | null
  targetLanguage?: unknown
  mode?: string | null
  contextReference?: string | null
  followUp?: boolean
  failureCode?: string | null
}

export function detectTranslationLanguage(text: string, fallback?: 'it' | 'en'): 'it' | 'en'

export function applyTranslationIntent(input: {
  text: string
  languageHint?: 'it' | 'en'
  translationContext?: unknown
  messages?: Array<{ role?: string; content?: string }>
  env?: { copyTextSync?: (t: string) => boolean }
}): Promise<{
  handled: boolean
  reply: string | null
  status?: string
  translationContext?: unknown
  translationUi?: import('../types').TranslationUiState | null
  diag: Record<string, unknown>
}>

export function loadTranslationContext(storage?: Storage | null, nowMs?: number): unknown
export function saveTranslationContext(ctx: unknown, storage?: Storage | null): void
export function clearTranslationContext(storage?: Storage | null): void
export function isTranslationContextFresh(ctx: unknown, nowMs?: number): boolean

export const TRANSLATION_DIAG_BUILD: string
export function isTranslationDiagEnabled(search?: string | null): boolean
export function buildTranslationDiag(partial?: Record<string, unknown>): Record<string, unknown>
export function rememberTranslationDiag(payload: unknown): void
export function logTranslationSafe(event: Record<string, unknown>): void

export const TRANSLATION_CONTEXT_TTL_MS: number
export const TRANSLATION_MAX_INPUT_CHARS: number
