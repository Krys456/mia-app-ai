export function applyPhoneAction(input: {
  text: string
  lastAssistantText?: string | null
  languageHint?: 'it' | 'en'
  env?: Record<string, unknown>
}): {
  handled: boolean
  reply: string | null
  action: string | null
  target: string | null
  safetyClass: string | null
  navigateVision: boolean
  diag: Record<string, unknown>
}

export function detectPhoneActionIntent(
  raw: string,
  opts?: { languageHint?: 'it' | 'en' },
): {
  kind: string
  language: 'it' | 'en'
  target?: string
  destination?: string
  phone?: string
  email?: string
  subject?: string
  body?: string
  failureCode?: string | null
}

export function detectPhoneLanguage(text: string, fallback?: 'it' | 'en'): 'it' | 'en'

export function buildMapsDirectionsUrl(destination: string): string | null
export function getOpenAppTarget(id: string): { id: string; url: string } | null
export function isAllowedHttpsUrl(url: string): boolean
export const OPEN_APP_TARGETS: Record<string, { id: string; url: string }>

export function buildTelUri(phone: string): string | null
export function buildSmsUri(phone: string, body?: string): string | null
export function buildMailtoUri(
  email: string,
  opts?: { subject?: string; body?: string },
): string | null
export function extractPhoneNumber(raw: string): string | null
export function extractEmail(raw: string): string | null
export function isValidPhone(phone: string): boolean
export function isValidEmail(email: string): boolean
export function maskPhone(phone: string): string
export function maskEmail(email: string): string

export const SAFETY: {
  LOW_RISK: string
  USER_HANDOFF: string
  NATIVE_REQUIRED: string
  BLOCKED: string
}
export function safetyForAction(action: string): string

export const PHONE_ACTION_DIAG_BUILD: string
export function isPhoneActionDiagEnabled(search?: string | null): boolean
export function buildPhoneActionDiag(partial?: Record<string, unknown>): Record<string, unknown>
export function rememberPhoneActionDiag(payload: unknown): void
export function logPhoneActionSafe(event: Record<string, unknown>): void

export function setAppNavigateHandler(fn: ((view: string) => void) | null): void
export function requestAppNavigate(view: string): boolean
