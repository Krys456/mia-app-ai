/**
 * #375T — Single claim decision for Calendar LOCAL_EXCHANGE turns.
 * Used by ChatContext and integration tests (same path).
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
  const calendarOwned =
    Boolean(input.calendarCtx) || isCalendarLocalExchangeActive(input.activeLocalExchangeRef)

  let intent = detectCalendarIntent(text, {
    languageHint,
    hasCalendarContext: calendarOwned,
  })

  // Fail-closed: ownership alone arms day-shift even if detect path missed.
  if (intent.intent !== 'calendar' && isCalendarLocalExchangeActive(input.activeLocalExchangeRef)) {
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
