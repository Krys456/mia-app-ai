/**
 * #304A1 — Calendar Settings visibility.
 *
 * Settings → Integrazioni → Google Calendar is ALWAYS visible.
 * VITE_CALENDAR_ENABLED is NOT a security boundary and does not hide the section.
 *
 * Real activation gate: Edge/server CALENDAR_ENABLED (OAuth start / connection APIs).
 * When server Calendar is disabled, the UI stays visible and shows unavailable state.
 */

/**
 * @deprecated Visibility is always on. Kept for call-site compatibility / tests.
 * Always returns true — do not use as a security check.
 */
export function isCalendarUiEnabled(
  _env?: { VITE_CALENDAR_ENABLED?: unknown },
): boolean {
  return true
}
