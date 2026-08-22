/**
 * #357B — Reminder chat public exports (Italian-first, 0 model calls).
 */

export { foldReminderText } from './normalize.js'
export {
  parseReminderDateTime,
  extractReminderTitle,
  zonedLocalToUtcIso,
} from './datetime.js'
export { detectReminderIntent, detectReminderFollowUp } from './intent.js'
export {
  REMINDERS_CONTEXT_KEY,
  REMINDERS_CONTEXT_TTL_MS,
  REMINDER_PENDING_KEY,
  createRemindersContext,
  isRemindersContextFresh,
  loadRemindersContext,
  saveRemindersContext,
  clearRemindersContext,
  focusIndexInContext,
  getFocusedReminder,
  savePendingReminderProposal,
  loadPendingReminderProposal,
  clearPendingReminderProposal,
} from './active-context.js'
export {
  applyReminderIntent,
  confirmPendingReminderProposal,
  discardPendingReminderProposal,
} from './controller.js'
export {
  failureReply,
  reminderCopy,
  renderReminderList,
  renderProposalText,
  renderSavedText,
  buildProposalUi,
} from './render.js'
