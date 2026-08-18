/**
 * #303A — Reminders UI availability.
 *
 * Kill switch: VITE_REMINDERS_ENABLED=0 hides client surfaces.
 * Default = enabled (matches Memory Manage pattern).
 * Server also gates with REMINDERS_ENABLED=0 → 404.
 */

export function isRemindersUiEnabled(
  env: { VITE_REMINDERS_ENABLED?: unknown } | undefined = typeof import.meta !== 'undefined'
    ? (import.meta as ImportMeta & { env?: { VITE_REMINDERS_ENABLED?: unknown } }).env
    : undefined,
): boolean {
  const raw = env?.VITE_REMINDERS_ENABLED
  if (typeof raw === 'string' && raw.trim() === '0') return false
  return true
}
