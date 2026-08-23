/**
 * #375T — Active LOCAL_EXCHANGE domain ownership (ChatProvider runtime).
 *
 * Survives sessionStorage failure and does not depend on message.calendarUi
 * surviving the sendMessage closure. Cleared on newChat and when another
 * local domain claims the turn.
 */

/**
 * @typedef {{ domain: string, at: number }} ActiveLocalExchange
 */

/**
 * @param {{ current?: ActiveLocalExchange | null } | null | undefined} holder
 * @param {string | null | undefined} domain
 */
export function markActiveLocalExchange(holder, domain) {
  if (!holder || typeof holder !== 'object') return
  if (!domain) {
    holder.current = null
    return
  }
  holder.current = { domain: String(domain), at: Date.now() }
}

/**
 * @param {{ current?: ActiveLocalExchange | null } | null | undefined} holder
 * @returns {boolean}
 */
export function isCalendarLocalExchangeActive(holder) {
  return Boolean(holder && holder.current && holder.current.domain === 'calendar')
}

/**
 * Clear only when Calendar currently owns the turn (other domains take over).
 * @param {{ current?: ActiveLocalExchange | null } | null | undefined} holder
 */
export function clearCalendarLocalExchange(holder) {
  if (isCalendarLocalExchangeActive(holder)) {
    markActiveLocalExchange(holder, null)
  }
}
