/**
 * #375T / #375U — Active LOCAL_EXCHANGE domain ownership.
 *
 * #375U root cause (live #378): authorization for day-shift follow-ups was
 * pinned only to ChatProvider `useRef`. The #375T harness passed a stable
 * `{ current }` object into `runCalendarLocalExchangeTurn` and never exercised
 * ChatProvider remount / clear semantics — so tests passed while Preview lost
 * Calendar claim on turn 2 ("E domani?" → Core).
 *
 * Fix: module-scoped ownership is authoritative for the page session (same
 * pattern as morning-briefing handoff lock / calendar moduleRuntimeContext).
 * Optional React ref holders are mirrors only. Cleared on newChat and when a
 * subsequent USER turn claims another LOCAL_EXCHANGE domain or Core.
 */

/**
 * @typedef {{ domain: string, at: number }} ActiveLocalExchange
 */

/** @type {ActiveLocalExchange | null} */
let moduleActiveLocalExchange = null

/** @type {string | null} */
let lastOwnershipClearReason = null

/**
 * @param {{ current?: ActiveLocalExchange | null } | null | undefined} holder
 * @param {string | null | undefined} domain
 * @param {{ reason?: string } | null} [meta]
 */
export function markActiveLocalExchange(holder, domain, meta = null) {
  if (!domain) {
    moduleActiveLocalExchange = null
    if (holder && typeof holder === 'object') holder.current = null
    if (meta && typeof meta.reason === 'string') {
      lastOwnershipClearReason = meta.reason
    }
    return
  }
  const next = { domain: String(domain), at: Date.now() }
  moduleActiveLocalExchange = next
  lastOwnershipClearReason = null
  if (holder && typeof holder === 'object') {
    holder.current = next
  }
}

/**
 * @param {{ current?: ActiveLocalExchange | null } | null | undefined} holder
 * @returns {boolean}
 */
export function isCalendarLocalExchangeActive(holder) {
  if (moduleActiveLocalExchange && moduleActiveLocalExchange.domain === 'calendar') {
    return true
  }
  return Boolean(holder && holder.current && holder.current.domain === 'calendar')
}

/**
 * Clear only when Calendar currently owns the turn (other domains take over).
 * @param {{ current?: ActiveLocalExchange | null } | null | undefined} holder
 * @param {{ reason?: string } | null} [meta]
 */
export function clearCalendarLocalExchange(holder, meta = null) {
  if (isCalendarLocalExchangeActive(holder)) {
    markActiveLocalExchange(holder, null, meta)
  }
}

/**
 * Peek current ownership (module authoritative). Safe for diagnostics/tests.
 * @returns {ActiveLocalExchange | null}
 */
export function peekActiveLocalExchange() {
  return moduleActiveLocalExchange
}

/**
 * @returns {string | null}
 */
export function peekOwnershipClearReason() {
  return lastOwnershipClearReason
}

/**
 * Test helper: wipe module ownership (does not require a holder).
 */
export function resetModuleActiveLocalExchangeForTests() {
  moduleActiveLocalExchange = null
  lastOwnershipClearReason = null
}
