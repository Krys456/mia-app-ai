/**
 * #298B — Memory Management UI availability.
 *
 * Production builds expose review / edit / delete (JWT-backed /api/memories*).
 * Optional escape hatch: VITE_MEMORY_MANAGE_UI=0 disables the surface
 * (default = enabled). Never read LAIFE_MEMORY_ADMIN_SECRET here.
 */

export function isMemoryManageUiEnabled(
  env: { VITE_MEMORY_MANAGE_UI?: unknown } | undefined = typeof import.meta !== 'undefined'
    ? (import.meta as ImportMeta & { env?: { VITE_MEMORY_MANAGE_UI?: unknown } }).env
    : undefined,
): boolean {
  const raw = env?.VITE_MEMORY_MANAGE_UI
  if (typeof raw === 'string' && raw.trim() === '0') return false
  return true
}
