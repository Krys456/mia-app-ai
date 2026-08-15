/**
 * Phase 0 — Memory Management UI gate.
 *
 * Production builds hide the manage-memories surface until authenticated
 * per-user memory (Phase 1A) ships. Chat memory writes are unchanged.
 *
 * Never read LAIFE_MEMORY_ADMIN_SECRET here — that secret is server-only.
 */
export function isMemoryManageUiEnabled(): boolean {
  // Vite: true for `vite build` / Preview / Production deploys; false for `vite` dev.
  return import.meta.env.PROD !== true
}
