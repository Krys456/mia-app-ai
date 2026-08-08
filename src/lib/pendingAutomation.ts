/**
 * Client-side session for NL Automation Builder drafts awaiting confirm/edit.
 * Internal only — never render as UI chrome.
 */

const STORAGE_KEY = 'laife.pendingAutomation.v1'

export type PendingAutomationSession = Record<string, unknown>

export function getPendingAutomation(): PendingAutomationSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as PendingAutomationSession
  } catch {
    return null
  }
}

export function savePendingAutomation(value: PendingAutomationSession | null): void {
  try {
    if (!value) {
      sessionStorage.removeItem(STORAGE_KEY)
      return
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // fail-soft
  }
}

export function clearPendingAutomation(): void {
  savePendingAutomation(null)
}
