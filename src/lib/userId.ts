const STORAGE_KEY = 'laife.userId.v1'

function createUserId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `u_${crypto.randomUUID().replace(/-/g, '')}`
  }
  return `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** Stable per-browser user id used to scope long-term memories. */
export function getOrCreateUserId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY)?.trim()
    if (existing && /^[a-zA-Z0-9_-]+$/.test(existing)) return existing
    const next = createUserId()
    localStorage.setItem(STORAGE_KEY, next)
    return next
  } catch {
    return createUserId()
  }
}
