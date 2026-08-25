/**
 * #386C — Clear ShinkAIdo / LAIfe user-scoped browser storage after account deletion.
 * Does not clear unrelated sites or opaque browser data.
 */

/** Exact localStorage keys known to hold ShinkAIdo/LAIfe user state. */
export const ACCOUNT_DELETION_LOCAL_KEYS = Object.freeze([
  'laife.settings.v1',
  'laife.settings.v2',
  'laife.userId.v1',
  'laife.conversationMemoryMap.v1',
  'laife.conversationPreferenceProfile.v1',
  'laife.learningSignals.v1',
  'laife.messageFeedback.v1',
  'laife.welcomeSession.v1',
  'laife.pendingAutomation.v1',
  'shinkaido.push.optin.dismissed',
  'shinkaido.weatherCache.v1',
  'shinkaido:sessionStyle:v1',
])

/** Prefixes for sessionStorage feature contexts. */
export const ACCOUNT_DELETION_SESSION_PREFIXES = Object.freeze([
  'shinkaido.',
  'laife.',
  'shinkaido:',
])

/**
 * @param {{ localStorage?: Storage | null, sessionStorage?: Storage | null }} [stores]
 */
export function clearAccountLocalState(stores: {
  localStorage?: Storage | null
  sessionStorage?: Storage | null
} = {}) {
  const ls =
    stores.localStorage !== undefined
      ? stores.localStorage
      : typeof globalThis !== 'undefined' && 'localStorage' in globalThis
        ? globalThis.localStorage
        : null
  const ss =
    stores.sessionStorage !== undefined
      ? stores.sessionStorage
      : typeof globalThis !== 'undefined' && 'sessionStorage' in globalThis
        ? globalThis.sessionStorage
        : null

  if (ls) {
    for (const key of ACCOUNT_DELETION_LOCAL_KEYS) {
      try {
        ls.removeItem(key)
      } catch {
        /* soft */
      }
    }
    // Sweep remaining laife./shinkaido. keys without touching unrelated apps.
    try {
      const toRemove: string[] = []
      for (let i = 0; i < ls.length; i += 1) {
        const k = ls.key(i)
        if (!k) continue
        if (k.startsWith('laife.') || k.startsWith('shinkaido.') || k.startsWith('shinkaido:')) {
          toRemove.push(k)
        }
      }
      for (const k of toRemove) ls.removeItem(k)
    } catch {
      /* soft */
    }
  }

  if (ss) {
    try {
      const toRemove: string[] = []
      for (let i = 0; i < ss.length; i += 1) {
        const k = ss.key(i)
        if (!k) continue
        if (
          ACCOUNT_DELETION_SESSION_PREFIXES.some((p) => k.startsWith(p)) ||
          k.startsWith('laife.')
        ) {
          toRemove.push(k)
        }
      }
      for (const k of toRemove) ss.removeItem(k)
    } catch {
      /* soft */
    }
  }
}
