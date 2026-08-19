export type ActiveTimerContext = {
  id: string
  label: string
  createdAt: number
  startedAt: number
  endsAt: number
  durationMs: number
  status: 'running' | 'completed' | 'cancelled'
  completionAnnounced?: boolean
}

export type PendingTimerReplace = {
  durationMs: number
  label: string
  language: 'it' | 'en'
  createdAt: number
}

export const ACTIVE_TIMER_STORAGE_KEY: string
export const PENDING_TIMER_REPLACE_KEY: string
export const TIMER_MIN_MS: number
export const TIMER_MAX_MS: number
export const TIMER_DIAG_BUILD: string

export function createTimerId(): string
export function remainingMs(timer: ActiveTimerContext | null | undefined, nowMs?: number): number
export function isTimerExpired(timer: ActiveTimerContext | null | undefined, nowMs?: number): boolean
export function createRunningTimer(input: {
  durationMs: number
  label?: string
  nowMs?: number
  id?: string
}): ActiveTimerContext
export function cancelTimer(timer: ActiveTimerContext, nowMs?: number): ActiveTimerContext
export function completeTimer(timer: ActiveTimerContext, nowMs?: number): ActiveTimerContext
export function addTimeToTimer(
  timer: ActiveTimerContext,
  addMs: number,
  nowMs?: number,
): ActiveTimerContext | null
export function markCompletionAnnounced(timer: ActiveTimerContext): ActiveTimerContext
export function parseStoredTimer(raw: unknown, nowMs?: number): ActiveTimerContext | null
export function loadActiveTimerFromStorage(
  storage?: Storage | null,
  nowMs?: number,
): ActiveTimerContext | null
export function saveActiveTimerToStorage(
  timer: ActiveTimerContext | null,
  storage?: Storage | null,
): void
export function clearActiveTimerStorage(storage?: Storage | null): void
export function loadPendingReplace(storage?: Storage | null): PendingTimerReplace | null
export function savePendingReplace(
  pending: PendingTimerReplace | null,
  storage?: Storage | null,
): void

export function parseTimerDurationMs(raw: string): number | null
export function formatDurationLabel(ms: number, lang: 'it' | 'en'): string
export function formatCountdown(ms: number): string
export function formatRemainingSpoken(ms: number, lang: 'it' | 'en'): string

export function applyTimerIntent(input: {
  text: string
  activeTimer: ActiveTimerContext | null
  pendingReplace: PendingTimerReplace | null
  languageHint?: 'it' | 'en'
  nowMs?: number
}): {
  handled: boolean
  reply: string | null
  timer: ActiveTimerContext | null
  pendingReplace: PendingTimerReplace | null
  clearTimer?: boolean
  diag: {
    timerIntent: string
    timerAction: string | null
    parsedDurationMs: number | null
    activeTimerFound: boolean
    timerStarted: boolean
    endsAt: number | null
    remainingMs: number | null
    timerCompleted: boolean
    failureCode: string | null
  }
}

export function expireRunningTimer(
  timer: ActiveTimerContext,
  lang: 'it' | 'en',
  nowMs?: number,
): { timer: ActiveTimerContext; reply: string }

export function detectTimerIntent(
  raw: string,
  opts?: {
    hasActiveTimer?: boolean
    hasPendingReplace?: boolean
    languageHint?: 'it' | 'en'
  },
): {
  kind: string
  language: 'it' | 'en'
  durationMs?: number
  addMs?: number
  needsDuration?: boolean
  failureCode?: string | null
}
export function detectTimerLanguage(text: string, fallback?: 'it' | 'en'): 'it' | 'en'

export function timerCompletedMessage(lang: 'it' | 'en'): string

export function playTimerCompletionSound(
  audioCtxFactory?: (() => AudioContext) | null,
): Promise<{ attempted: boolean; played: boolean; failureCode: string | null }>
export function tryTimerCompletionNotification(lang: 'it' | 'en'): {
  attempted: boolean
  shown: boolean
  failureCode: string | null
}

export function isTimerDiagClientEnabled(search?: string | null): boolean
export function buildTimerDiag(partial?: Record<string, unknown>): {
  route: 'timer-action'
  diagBuild: string
  buildId: string
  requestId: string
  timerIntent: string | null
  timerAction: string | null
  parsedDurationMs: number | null
  activeTimerFound: boolean
  timerStarted: boolean
  endsAt: number | null
  remainingMs: number | null
  timerCompleted: boolean
  completionSoundAttempted: boolean
  notificationAttempted: boolean
  failureCode: string | null
}
export function rememberTimerDiag(payload: unknown): void
export function logTimerSafe(event: {
  action: string
  durationMs?: number | null
  remainingMs?: number | null
  requestId?: string | null
  status?: string | null
}): void
