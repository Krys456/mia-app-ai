/**
 * #383F — Gmail readonly write_unsupported takes precedence over Phone mailto.
 *
 * Pure guard: when Email classifies the turn as write_unsupported, Phone must
 * not claim email compose / email_needs_address (no mailto handoff).
 * Phone open_app (Apri Gmail / Open Gmail) is unaffected.
 */

/**
 * @param {{ intent?: string, queryType?: string, operation?: string } | null | undefined} emailIntent
 * @param {{
 *   handled?: boolean
 *   action?: string | null
 *   diag?: { phoneActionIntent?: string | null } | null
 * } | null | undefined} phoneResult
 * @returns {boolean}
 */
export function shouldDeferPhoneEmailComposeToGmailWrite(emailIntent, phoneResult) {
  if (!emailIntent || emailIntent.intent !== 'email') return false
  if (
    emailIntent.queryType !== 'write_unsupported' &&
    emailIntent.operation !== 'write_unsupported'
  ) {
    return false
  }
  if (!phoneResult || !phoneResult.handled) return false

  const kind =
    typeof phoneResult.diag?.phoneActionIntent === 'string'
      ? phoneResult.diag.phoneActionIntent
      : null
  if (kind === 'email' || kind === 'email_needs_address') return true
  // applyPhoneAction maps both compose kinds to action: 'email'
  if (phoneResult.action === 'email') return true
  return false
}
