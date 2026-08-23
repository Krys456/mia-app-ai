/**
 * #375P — Testable Calendar LOCAL_EXCHANGE turn (mirrors ChatContext calendar block).
 * Not used by Core. Zero model calls.
 */

import { applyCalendarIntent } from './controller.js'
import { detectCalendarIntent } from './intent.js'
import { rememberCalendarContext, resolveCalendarContext } from './active-context.js'

/**
 * @param {{
 *   text: string
 *   languageHint?: 'it'|'en'
 *   runtimeRef: { current: object | null }
 *   storage?: Storage | null
 *   inFlightRef?: { current: boolean }
 *   requestFn?: Function
 *   timeZone?: string
 *   now?: Date
 * }} input
 */
export async function runCalendarLocalExchangeTurn(input) {
  const inFlightRef = input.inFlightRef || null
  if (inFlightRef && inFlightRef.current) {
    return {
      handled: false,
      blockedByInFlight: true,
      coreCalled: false,
      hasCalendarContext: false,
      intent: null,
      result: null,
    }
  }

  const calendarCtx = resolveCalendarContext({
    runtimeRef: input.runtimeRef,
    storage: input.storage,
  })
  const hasCalendarContext = Boolean(calendarCtx)
  const intent = detectCalendarIntent(input.text, {
    languageHint: input.languageHint === 'en' ? 'en' : 'it',
    hasCalendarContext,
  })

  if (intent.intent !== 'calendar') {
    return {
      handled: false,
      blockedByInFlight: false,
      coreCalled: true,
      hasCalendarContext,
      intent,
      result: null,
    }
  }

  if (inFlightRef) inFlightRef.current = true
  try {
    const result = await applyCalendarIntent({
      text: input.text,
      languageHint: input.languageHint === 'en' ? 'en' : 'it',
      calendarContext: calendarCtx,
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
    return {
      handled: Boolean(result.handled),
      blockedByInFlight: false,
      coreCalled: false,
      hasCalendarContext,
      intent,
      result,
    }
  } finally {
    if (inFlightRef) inFlightRef.current = false
  }
}
