/**
 * #315 — App view navigation bridge (Vision, etc.) without coupling Chat↔App tightly.
 */

/** @type {null | ((view: string) => void)} */
let navigateHandler = null

export function setAppNavigateHandler(fn) {
  navigateHandler = typeof fn === 'function' ? fn : null
}

export function requestAppNavigate(view) {
  if (!navigateHandler) return false
  try {
    navigateHandler(view)
    return true
  } catch {
    return false
  }
}
