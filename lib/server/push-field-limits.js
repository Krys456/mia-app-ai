/**
 * #303C — Push subscription field limits (no OpenAI).
 */

export const PUSH_SUBSCRIPTION_LIMITS = {
  endpoint: 2048,
  p256dh: 512,
  auth: 256,
  userAgent: 512,
}

/** Rate-limit bucket for subscription mutations (tighter than reminders CRUD). */
export const PUSH_SUBSCRIPTION_RATE = {
  requests: 10,
  window: /** @type {const} */ ('1 m'),
}
