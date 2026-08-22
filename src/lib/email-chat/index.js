/**
 * #337B — Gmail chat public exports (read-only).
 */

export { detectEmailIntent, detectEmailFollowUp } from './intent.js'
export { foldEmailText } from './normalize.js'
export {
  EMAIL_CONTEXT_KEY,
  EMAIL_CONTEXT_TTL_MS,
  createEmailContext,
  isEmailContextFresh,
  loadEmailContext,
  saveEmailContext,
  clearEmailContext,
} from './active-context.js'
export { applyEmailIntent } from './controller.js'
export { requestEmailQuery } from './api.js'
export {
  renderEmailList,
  renderFollowUp,
  extractiveSummary,
  failureReply,
} from './render.js'
