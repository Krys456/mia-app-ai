/**
 * #336B — Calendar chat public exports.
 */

export { detectCalendarIntent, detectCalendarFollowUp, detectDayShiftFollowUp } from './intent.js'
export { foldCalendarText } from './normalize.js'
export {
  CALENDAR_CONTEXT_KEY,
  CALENDAR_CONTEXT_TTL_MS,
  createCalendarContext,
  isCalendarContextFresh,
  loadCalendarContext,
  saveCalendarContext,
  clearCalendarContext,
  resolveCalendarContext,
  rememberCalendarContext,
  resetModuleCalendarRuntimeForTests,
} from './active-context.js'
export { applyCalendarIntent } from './controller.js'
export { runCalendarLocalExchangeTurn } from './chat-turn.js'
export { requestCalendarQuery, mapCalendarQueryResponse } from './api.js'
export { computeFreeWindows, filterEventsForQuery, filterEventsForAllDayDayMembership, allDayEventIncludesYmd } from './free-time.js'
export { renderCalendarAnswer, failureReply } from './render.js'
export { resolveCalendarQueryBounds } from './range.js'
