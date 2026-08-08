/**
 * Prior-authorization store for low/medium risk actions.
 *
 * In-memory by default (session / process). Callers can replace the store
 * for durable user preferences later — without changing trust policy logic.
 */

/**
 * @typedef {object} AuthorizationRecord
 * @property {string} pluginId
 * @property {string} actionId
 * @property {import('./levels.js').TrustLevel} trustLevel
 * @property {number} authorizedAt
 * @property {string} [scope]  Optional permission scope that was granted
 */

/**
 * @typedef {object} TrustStore
 * @property {(pluginId: string, actionId: string) => AuthorizationRecord | null} get
 * @property {(record: AuthorizationRecord) => void} set
 * @property {(pluginId: string, actionId?: string) => void} revoke
 * @property {(pluginId?: string) => AuthorizationRecord[]} list
 */

/** @type {Map<string, AuthorizationRecord>} */
const memory = new Map()

/**
 * @param {string} pluginId
 * @param {string} actionId
 */
function key(pluginId, actionId) {
  return `${pluginId}::${String(actionId || '*').toLowerCase()}`
}

/** @type {TrustStore} */
const memoryStore = {
  get(pluginId, actionId) {
    return memory.get(key(pluginId, actionId)) || memory.get(key(pluginId, '*')) || null
  },
  set(record) {
    memory.set(key(record.pluginId, record.actionId), { ...record })
  },
  revoke(pluginId, actionId) {
    if (actionId) {
      memory.delete(key(pluginId, actionId))
      return
    }
    for (const k of [...memory.keys()]) {
      if (k.startsWith(`${pluginId}::`)) memory.delete(k)
    }
  },
  list(pluginId) {
    const all = [...memory.values()]
    return pluginId ? all.filter((r) => r.pluginId === pluginId) : all
  },
}

/** @type {TrustStore} */
let activeStore = memoryStore

/**
 * @param {TrustStore | null | undefined} store
 */
export function setTrustStore(store) {
  activeStore =
    store && typeof store.get === 'function' && typeof store.set === 'function'
      ? store
      : memoryStore
}

/**
 * @returns {TrustStore}
 */
export function getTrustStore() {
  return activeStore
}

/**
 * Record that the user authorized this plugin action.
 * @param {string} pluginId
 * @param {string} actionId
 * @param {import('./levels.js').TrustLevel} trustLevel
 * @param {string} [scope]
 */
export function grantPriorAuthorization(pluginId, actionId, trustLevel, scope) {
  activeStore.set({
    pluginId,
    actionId: String(actionId || '*').toLowerCase(),
    trustLevel,
    authorizedAt: Date.now(),
    scope,
  })
}

/**
 * @param {string} pluginId
 * @param {string} actionId
 */
export function hasPriorAuthorization(pluginId, actionId) {
  return Boolean(activeStore.get(pluginId, actionId))
}

/**
 * @param {string} pluginId
 * @param {string} [actionId]
 */
export function revokeAuthorization(pluginId, actionId) {
  activeStore.revoke(pluginId, actionId)
}

/**
 * Test helper.
 */
export function clearTrustStore() {
  for (const r of memoryStore.list()) {
    memory.delete(key(r.pluginId, r.actionId))
  }
}
