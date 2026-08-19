/** #314 — Barrel for timer MVP (JS modules under ./timer/). */
export {
  ACTIVE_TIMER_STORAGE_KEY,
  PENDING_TIMER_REPLACE_KEY,
  addTimeToTimer,
  cancelTimer,
  clearActiveTimerStorage,
  completeTimer,
  createRunningTimer,
  createTimerId,
  isTimerExpired,
  loadActiveTimerFromStorage,
  loadPendingReplace,
  markCompletionAnnounced,
  parseStoredTimer,
  remainingMs,
  saveActiveTimerToStorage,
  savePendingReplace,
} from './timer/active-context.js'

export {
  formatCountdown,
  formatDurationLabel,
  formatRemainingSpoken,
  parseTimerDurationMs,
  TIMER_MAX_MS,
  TIMER_MIN_MS,
} from './timer/duration.js'

export { applyTimerIntent, expireRunningTimer } from './timer/controller.js'

export { detectTimerIntent, detectTimerLanguage } from './timer/intent.js'

export { timerCompletedMessage } from './timer/copy.js'

export {
  playTimerCompletionSound,
  tryTimerCompletionNotification,
} from './timer/sound.js'

export {
  TIMER_DIAG_BUILD,
  buildTimerDiag,
  isTimerDiagClientEnabled,
  logTimerSafe,
  rememberTimerDiag,
} from './timer/diag.js'
