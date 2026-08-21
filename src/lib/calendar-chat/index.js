/**
 * #336B — Calendar chat public exports.
 */

export { detectCalendarIntent, detectCalendarFollowUp } from './intent.js'
export { foldCalendarText } from './normalize.js'
export {
  CALENDAR_CONTEXT_KEY,
  CALENDAR_CONTEXT_TTL_MS,
  createCalendarContext,
  isCalendarContextFresh,
  loadCalendarContext,
  saveCalendarContext,
  clearCalendarContext,
} from './active-context.js'
export { applyCalendarIntent } from './controller.js'
export { requestCalendarQuery } from './api.js'
export { computeFreeWindows, filterEventsForQuery } from './free-time.js'
export { renderCalendarAnswer, failureReply } from './render.js'
export { resolveCalendarQueryBounds } from './range.js'
