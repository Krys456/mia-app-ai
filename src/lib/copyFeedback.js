/**
 * #331 — Lightweight copy-success toast (UI only; no chat/conversation coupling).
 */

export const COPY_TOAST_DEFAULT = 'Copied to clipboard'

/** @type {Set<(message: string) => void>} */
const listeners = new Set()

/** @param {string} [message] */
export function showCopyToast(message = COPY_TOAST_DEFAULT) {
  for (const listener of listeners) {
    try {
      listener(message)
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** @param {(message: string) => void} listener */
export function subscribeCopyToast(listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Long blockquote / quoted prompt threshold for copy chrome. */
export const LONG_QUOTE_COPY_CHARS = 300
