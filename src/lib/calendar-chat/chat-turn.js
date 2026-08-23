/**
 * #375T — Testable Calendar LOCAL_EXCHANGE turn (mirrors ChatContext calendar block).
 * Uses the same claim + ownership path as ChatProvider. Not used by Core.
 */

import { applyCalendarIntent } from './controller.js'
import { rememberCalendarContext, resolveCalendarContext } from './active-context.js'
import { resolveCalendarTurnClaim } from './calendar-turn-claim.js'
import { markActiveLocalExchange } from './local-exchange-ownership.js'

/**
 * @param {{
 *   text: string
 *   languageHint?: 'it'|'en'
 *   runtimeRef: { current: object | null }
 *   activeLocalExchangeRef?: { current: object | null }
 *   storage?: Storage | null
 *   inFlightRef?: { current: boolean }
 *   requestFn?: Function
 *   timeZone?: string
 *   now?: Date
 * }} input
 */
export async function runCalendarLocalExchangeTurn(input) {
  const inFlightRef = input.inFlightRef || null
  const ownershipRef = input.activeLocalExchangeRef || null
  if (inFlightRef && inFlightRef.current) {
    return {
      handled: false,
      blockedByInFlight: true,
      coreCalled: false,
      hasCalendarContext: false,
      intent: null,
      result: null,
      calendarUi: null,
    }
  }

  const calendarCtx = resolveCalendarContext({
    runtimeRef: input.runtimeRef,
    storage: input.storage,
  })
  const claim = resolveCalendarTurnClaim({
    text: input.text,
    languageHint: input.languageHint,
    calendarCtx,
    activeLocalExchangeRef: ownershipRef,
  })

  if (!claim.claim) {
    return {
      handled: false,
      blockedByInFlight: false,
      coreCalled: true,
      hasCalendarContext: claim.calendarOwned,
      intent: claim.intent,
      result: null,
      calendarUi: null,
    }
  }

  // Match ChatContext: mark ownership synchronously when Calendar claims.
  markActiveLocalExchange(ownershipRef, 'calendar')

  if (inFlightRef) inFlightRef.current = true
  try {
    const result = await applyCalendarIntent({
      text: input.text,
      languageHint: input.languageHint === 'en' ? 'en' : 'it',
      calendarContext: calendarCtx,
      hasCalendarContext: claim.calendarOwned,
      requestFn: input.requestFn,
      timeZone: input.timeZone,
      now: input.now,
    })
    if (result.calendarContext) {
      rememberCalendarContext(result.calendarContext, {
        runtimeRef: input.runtimeRef,
        storage: input.storage,
      })
    }
    // Keep ownership even on API failure — fail-closed stays on Calendar.
    markActiveLocalExchange(ownershipRef, 'calendar')
    return {
      handled: Boolean(result.handled),
      blockedByInFlight: false,
      coreCalled: false,
      hasCalendarContext: claim.calendarOwned,
      intent: claim.intent,
      result,
      calendarUi: result.calendarUi || null,
    }
  } finally {
    if (inFlightRef) inFlightRef.current = false
  }
}
