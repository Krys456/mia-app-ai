/**
 * #315 — Phone Action safety classes.
 */

export const SAFETY = Object.freeze({
  LOW_RISK: 'LOW_RISK',
  USER_HANDOFF: 'USER_HANDOFF',
  NATIVE_REQUIRED: 'NATIVE_REQUIRED',
  BLOCKED: 'BLOCKED',
})

export function safetyForAction(action) {
  switch (action) {
    case 'copy':
    case 'share':
    case 'open_app':
    case 'open_vision':
      return SAFETY.LOW_RISK
    case 'navigate':
    case 'call':
    case 'sms':
    case 'email':
    case 'whatsapp':
      return SAFETY.USER_HANDOFF
    case 'native_required':
      return SAFETY.NATIVE_REQUIRED
    default:
      return SAFETY.BLOCKED
  }
}
