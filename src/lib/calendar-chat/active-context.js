/**
 * #336B / #375P — activeCalendar context (not Memory).
 *
 * Primary: in-memory runtime holder for the mounted conversation (ChatContext ref).
 * Mirror: sessionStorage (best-effort; failures must not kill follow-ups).
 */

export const CALENDAR_CONTEXT_KEY = 'shinkaido.activeCalendar.v1'
export const CALENDAR_CONTEXT_TTL_MS = 30 * 60 * 1000

/** Module fallback when no ChatContext holder is passed (tests / non-React). */
let moduleRuntimeContext = null

/**
 * @param {{ current?: object | null } | null | undefined} holder
 * @returns {object | null}
 */
function readRuntime(holder) {
  if (holder && typeof holder === 'object' && 'current' in holder) {
    return holder.current || null
  }
  return moduleRuntimeContext
}

/**
 * @param {{ current?: object | null } | null | undefined} holder
 * @param {object | null} ctx
 */
function writeRuntime(holder, ctx) {
  if (holder && typeof holder === 'object' && 'current' in holder) {
    holder.current = ctx
    return
  }
  moduleRuntimeContext = ctx
}

/**
 * Default sessionStorage, or null when unavailable.
 * @returns {Storage | null}
 */
function defaultStorage() {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null
  } catch {
    return null
  }
}

export function createCalendarContext(input) {
  if (!input || typeof input !== 'object') return null
  const now = input.createdAt || Date.now()
  const events = Array.isArray(input.events)
    ? input.events.slice(0, 40).map((e) => ({
        id: String(e.id || '').slice(0, 120),
        title: String(e.title || '').slice(0, 120),
        start: e.start,
        end: e.end,
        allDay: Boolean(e.allDay),
        status: e.status || 'confirmed',
        timeZone: e.timeZone || input.timezone || null,
      }))
    : []
  return {
    dateRange: input.dateRange || null,
    labelDay: String(input.labelDay || ''),
    timezone: String(input.timezone || ''),
    fetchedAt: input.fetchedAt || new Date(now).toISOString(),
    events,
    focusIndex: typeof input.focusIndex === 'number' ? input.focusIndex : events.length ? 0 : -1,
    queryType: String(input.queryType || 'list'),
    status: String(input.status || 'ok'),
    language: input.language === 'en' ? 'en' : 'it',
    dayYmd: input.dayYmd || null,
    createdAt: now,
    expiresAt: input.expiresAt || now + CALENDAR_CONTEXT_TTL_MS,
  }
}

export function isCalendarContextFresh(ctx, nowMs = Date.now()) {
  if (!ctx || typeof ctx !== 'object') return false
  if (typeof ctx.expiresAt !== 'number') return false
  return ctx.expiresAt > nowMs
}

/**
 * Load only from persisted storage (no runtime).
 * @param {Storage | null} [storage]
 * @param {number} [nowMs]
 */
export function loadCalendarContext(
  storage = defaultStorage(),
  nowMs = Date.now(),
) {
  if (!storage) return null
  try {
    const raw = storage.getItem(CALENDAR_CONTEXT_KEY)
    if (!raw) return null
    const ctx = JSON.parse(raw)
    if (!isCalendarContextFresh(ctx, nowMs)) {
      storage.removeItem(CALENDAR_CONTEXT_KEY)
      return null
    }
    return ctx
  } catch {
    return null
  }
}

/**
 * Mirror to storage only (best-effort). Does not touch runtime.
 * @param {object | null} ctx
 * @param {Storage | null} [storage]
 */
export function saveCalendarContext(
  ctx,
  storage = defaultStorage(),
) {
  if (!storage) return
  try {
    if (!ctx || !isCalendarContextFresh(ctx)) {
      storage.removeItem(CALENDAR_CONTEXT_KEY)
      return
    }
    storage.setItem(CALENDAR_CONTEXT_KEY, JSON.stringify(ctx))
  } catch {
    /* ignore — runtime follow-ups must not depend on storage */
  }
}

/**
 * Clear runtime (+ optional storage mirror).
 * Always clears the module fallback as well (new chat / logout isolation).
 * @param {Storage | null} [storage]
 * @param {{ current?: object | null } | null} [runtimeRef]
 */
export function clearCalendarContext(
  storage = defaultStorage(),
  runtimeRef = null,
) {
  writeRuntime(runtimeRef, null)
  moduleRuntimeContext = null
  if (!storage) return
  try {
    storage.removeItem(CALENDAR_CONTEXT_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Prefer runtime holder; fall back to sessionStorage and hydrate runtime.
 * @param {{
 *   runtimeRef?: { current?: object | null } | null
 *   storage?: Storage | null
 *   nowMs?: number
 * }} [opts]
 * @returns {object | null}
 */
export function resolveCalendarContext(opts = {}) {
  const nowMs = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now()
  const storage = opts.storage !== undefined ? opts.storage : defaultStorage()
  const holder = opts.runtimeRef

  const runtime = readRuntime(holder)
  if (isCalendarContextFresh(runtime, nowMs)) {
    return runtime
  }
  // Drop stale runtime.
  writeRuntime(holder, null)

  const persisted = loadCalendarContext(storage, nowMs)
  if (persisted) {
    writeRuntime(holder, persisted)
    return persisted
  }
  return null
}

/**
 * Set runtime primary, then best-effort mirror to storage.
 * Must be called after a successful Calendar LOCAL_EXCHANGE before the next turn.
 * @param {object | null} ctx
 * @param {{
 *   runtimeRef?: { current?: object | null } | null
 *   storage?: Storage | null
 *   nowMs?: number
 * }} [opts]
 * @returns {object | null}
 */
export function rememberCalendarContext(ctx, opts = {}) {
  const nowMs = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now()
  const storage = opts.storage !== undefined ? opts.storage : defaultStorage()
  const holder = opts.runtimeRef

  if (!ctx || !isCalendarContextFresh(ctx, nowMs)) {
    writeRuntime(holder, null)
    saveCalendarContext(null, storage)
    return null
  }

  writeRuntime(holder, ctx)
  saveCalendarContext(ctx, storage)
  return readRuntime(holder)
}

/**
 * Test helper: wipe module-level runtime (does not touch storage).
 */
export function resetModuleCalendarRuntimeForTests() {
  moduleRuntimeContext = null
}
