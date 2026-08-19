/**
 * #304A1 — Client Calendar UI gate.
 *
 * Default OFF until VITE_CALENDAR_ENABLED is explicitly set.
 * Independent of reminders / push flags.
 */

export function isCalendarUiEnabled(
  env: { VITE_CALENDAR_ENABLED?: unknown } | undefined = typeof import.meta !== 'undefined'
    ? (import.meta as ImportMeta & { env?: { VITE_CALENDAR_ENABLED?: unknown } }).env
    : undefined,
): boolean {
  const raw = env?.VITE_CALENDAR_ENABLED
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}
