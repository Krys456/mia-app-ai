/**
 * #337B — Gmail Settings visibility + shared read-only badge copy.
 *
 * Settings → Integrazioni → Gmail is ALWAYS visible.
 * Real activation gate: Edge/server EMAIL_ENABLED (OAuth start / connection APIs).
 */

/**
 * @deprecated Visibility is always on. Kept for call-site compatibility / tests.
 * Always returns true — do not use as a security check.
 */
export function isEmailUiEnabled(): boolean {
  return true
}

/** Shared "read-only" badge copy (Italian-first) for Gmail integration UI. */
export const EMAIL_READONLY_BADGE_LABEL = 'Sola lettura'
export const EMAIL_READONLY_BADGE_TITLE = 'Permesso sola lettura: niente invio, risposta o eliminazione'
