/**
 * #314 — Active timer context (client-only, localStorage).
 */

export const ACTIVE_TIMER_STORAGE_KEY = 'shinkaido.activeTimer.v1'
export const PENDING_TIMER_REPLACE_KEY = 'shinkaido.pendingTimerReplace.v1'

export function createTimerId() {
  return `tmr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function remainingMs(timer, nowMs = Date.now()) {
  if (!timer || timer.status !== 'running') return 0
  return Math.max(0, timer.endsAt - nowMs)
}

export function isTimerExpired(timer, nowMs = Date.now()) {
  if (!timer || timer.status !== 'running') return false
  return timer.endsAt <= nowMs
}

export function createRunningTimer(input) {
  const now = input.nowMs ?? Date.now()
  const durationMs = Math.round(input.durationMs)
  return {
    id: input.id || createTimerId(),
    label: String(input.label || 'Timer').slice(0, 80),
    createdAt: now,
    startedAt: now,
    endsAt: now + durationMs,
    durationMs,
    status: 'running',
    completionAnnounced: false,
  }
}

export function cancelTimer(timer, nowMs = Date.now()) {
  return {
    ...timer,
    status: 'cancelled',
    endsAt: Math.min(timer.endsAt, nowMs),
  }
}

export function completeTimer(timer, nowMs = Date.now()) {
  return {
    ...timer,
    status: 'completed',
    endsAt: Math.min(timer.endsAt, nowMs),
  }
}

export function addTimeToTimer(timer, addMs, nowMs = Date.now()) {
  if (timer.status !== 'running') return null
  if (!Number.isFinite(addMs) || addMs <= 0) return null
  const add = Math.round(addMs)
  return {
    ...timer,
    endsAt: timer.endsAt + add,
    durationMs: timer.durationMs + add,
  }
}

export function markCompletionAnnounced(timer) {
  return { ...timer, completionAnnounced: true }
}

export function parseStoredTimer(raw, nowMs = Date.now()) {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (typeof raw.endsAt !== 'number' || !Number.isFinite(raw.endsAt)) return null
  if (typeof raw.durationMs !== 'number' || !Number.isFinite(raw.durationMs)) return null
  if (typeof raw.startedAt !== 'number') return null
  if (typeof raw.createdAt !== 'number') return null
  const status =
    raw.status === 'running' || raw.status === 'completed' || raw.status === 'cancelled'
      ? raw.status
      : 'running'
  let timer = {
    id: raw.id.slice(0, 64),
    label: typeof raw.label === 'string' ? raw.label.slice(0, 80) : 'Timer',
    createdAt: raw.createdAt,
    startedAt: raw.startedAt,
    endsAt: raw.endsAt,
    durationMs: raw.durationMs,
    status,
    completionAnnounced: raw.completionAnnounced === true,
  }
  if (timer.status === 'running' && timer.endsAt <= nowMs) {
    timer = completeTimer(timer, nowMs)
  }
  return timer
}

export function loadActiveTimerFromStorage(storage = null, nowMs = Date.now()) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
  if (!store) return null
  try {
    const raw = store.getItem(ACTIVE_TIMER_STORAGE_KEY)
    if (!raw) return null
    return parseStoredTimer(JSON.parse(raw), nowMs)
  } catch {
    return null
  }
}

export function saveActiveTimerToStorage(timer, storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
  if (!store) return
  try {
    if (!timer || timer.status === 'cancelled') {
      store.removeItem(ACTIVE_TIMER_STORAGE_KEY)
      return
    }
    store.setItem(ACTIVE_TIMER_STORAGE_KEY, JSON.stringify(timer))
  } catch {
    /* quota / private mode */
  }
}

export function clearActiveTimerStorage(storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
  if (!store) return
  try {
    store.removeItem(ACTIVE_TIMER_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function loadPendingReplace(storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
  if (!store) return null
  try {
    const raw = store.getItem(PENDING_TIMER_REPLACE_KEY)
    if (!raw) return null
    const o = JSON.parse(raw)
    if (!o || typeof o.durationMs !== 'number') return null
    return o
  } catch {
    return null
  }
}

export function savePendingReplace(pending, storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
  if (!store) return
  try {
    if (!pending) {
      store.removeItem(PENDING_TIMER_REPLACE_KEY)
      return
    }
    store.setItem(PENDING_TIMER_REPLACE_KEY, JSON.stringify(pending))
  } catch {
    /* ignore */
  }
}
