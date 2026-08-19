export function applyPhoneAction(input: {
  text: string
  lastAssistantText?: string | null
  languageHint?: 'it' | 'en'
  messagingContext?: {
    phone: string
    body: string
    channel: 'sms' | 'whatsapp' | 'message'
    createdAt: number
  } | null
  env?: Record<string, unknown>
}): {
  handled: boolean
  reply: string | null
  action: string | null
  target: string | null
  safetyClass: string | null
  navigateVision: boolean
  messagingContext?: {
    phone: string
    body: string
    channel: 'sms' | 'whatsapp' | 'message'
    createdAt: number
  } | null
  diag: Record<string, unknown>
}

export function detectPhoneActionIntent(
  raw: string,
  opts?: { languageHint?: 'it' | 'en'; hasMessagingContext?: boolean },
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
export function extractSmsParts(text: string): { phone: string | null; body: string }
export function extractWhatsAppCompose(text: string): { phone: string | null; body: string }
export function looksWhatsAppIntent(
  raw: string,
  text: string,
  opts?: { hasMessagingContext?: boolean },
): false | 'open' | 'compose' | 'followup' | 'needs_number'
export function looksWhatsAppCapabilityQuestion(raw: string, text: string): boolean

export function buildMapsDirectionsUrl(destination: string): string | null
export function buildWhatsAppComposeUrl(phone: string, body?: string): string | null
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

export function createMessagingContext(input: {
  phone: string
  body?: string
  channel?: 'sms' | 'whatsapp' | 'message'
  createdAt?: number
}): {
  phone: string
  body: string
  channel: 'sms' | 'whatsapp' | 'message'
  createdAt: number
} | null
export function isMessagingContextFresh(ctx: unknown, nowMs?: number): boolean
export function loadMessagingContext(storage?: Storage | null, nowMs?: number): {
  phone: string
  body: string
  channel: 'sms' | 'whatsapp' | 'message'
  createdAt: number
} | null
export function saveMessagingContext(
  ctx: {
    phone: string
    body: string
    channel: 'sms' | 'whatsapp' | 'message'
    createdAt: number
  } | null,
  storage?: Storage | null,
): void
export function clearMessagingContext(storage?: Storage | null): void
export function shouldClearMessagingOnUserText(text: string): boolean
export const MESSAGING_CONTEXT_TTL_MS: number
export const MESSAGING_CONTEXT_KEY: string

export function setAppNavigateHandler(fn: ((view: string) => void) | null): void
export function requestAppNavigate(view: string): boolean
