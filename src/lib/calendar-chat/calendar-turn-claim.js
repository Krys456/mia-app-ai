/**
 * #375T / #375U — Single claim decision for Calendar LOCAL_EXCHANGE turns.
 * Used by ChatContext and integration tests (same path).
 *
 * #375U: restore sticky lastAssistantHadCalendar (#375S) into the shared claim
 * path. Ownership alone was insufficient live when the React ref signal was
 * inactive and runtime/storage resolve also missed — the visible Calendar badge
 * on the last assistant message is conversational continuity.
 */

import { detectCalendarIntent, detectDayShiftFollowUp } from './intent.js'
import { foldCalendarText } from './normalize.js'
import { isCalendarLocalExchangeActive } from './local-exchange-ownership.js'

/**
 * @param {{
 *   text: string
 *   languageHint?: 'it'|'en'
 *   calendarCtx?: object | null
 *   activeLocalExchangeRef?: { current?: { domain: string } | null } | null
 *   lastAssistantHadCalendar?: boolean
 * }} input
 * @returns {{
 *   claim: boolean
 *   calendarOwned: boolean
 *   intent: object
 *   dayShiftFollowUp: boolean
 * }}
 */
export function resolveCalendarTurnClaim(input) {
  const languageHint = input.languageHint === 'en' ? 'en' : 'it'
  const text = String(input.text || '').trim()
  const stickyCalendar = Boolean(input.lastAssistantHadCalendar)
  const calendarOwned =
    Boolean(input.calendarCtx) ||
    stickyCalendar ||
    isCalendarLocalExchangeActive(input.activeLocalExchangeRef)

  let intent = detectCalendarIntent(text, {
    languageHint,
    hasCalendarContext: calendarOwned,
  })

  // Fail-closed: any ownership/sticky/ctx signal arms day-shift (never Core).
  if (intent.intent !== 'calendar' && calendarOwned) {
    const dayShift = detectDayShiftFollowUp(foldCalendarText(text))
    if (dayShift) {
      intent = {
        intent: 'calendar',
        language: languageHint,
        queryType: 'list',
        dayRef: dayShift,
        followUp: false,
        dayShiftFollowUp: true,
      }
    }
  }

  return {
    claim: intent.intent === 'calendar',
    calendarOwned,
    intent,
    dayShiftFollowUp: Boolean(intent.dayShiftFollowUp),
  }
}
