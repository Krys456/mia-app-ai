/**
 * #303A — Client reminder types.
 *
 * ReminderProposal is NEVER persisted until the user confirms.
 * Future NL ("Ricordami…") should produce a ReminderProposal only.
 */

export type ReminderStatus =
  | 'pending'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'snoozed'

export type ReminderSource = 'user' | 'conversation' | 'calendar' | 'ai_suggestion'

/** Persisted reminder (API shape). */
export interface Reminder {
  id: string
  userId: string
  title: string
  body: string | null
  fireAt: string
  timezone: string
  status: ReminderStatus
  source: ReminderSource
  sourceRef: string | null
  snoozeUntil: string | null
  channels: string[]
  deliveryAttempts: number
  lastErrorCode: string | null
  createdAt: string
  updatedAt: string
  deliveredAt: string | null
  completedAt: string | null
  cancelledAt: string | null
}

/**
 * Unpersisted proposal shown for confirmation.
 * Confirm → POST /api/reminders. Cancel → discard (nothing stored).
 */
export interface ReminderProposal {
  title: string
  body?: string | null
  /** ISO UTC instant that will become fire_at after confirm. */
  fireAt: string
  timezone: string
  source: ReminderSource
  sourceRef?: string | null
  /** Optional display helpers for the confirm card. */
  localDateLabel?: string
  localTimeLabel?: string
}

export const REMINDER_TITLE_MAX = 200
export const REMINDER_BODY_MAX = 2000
