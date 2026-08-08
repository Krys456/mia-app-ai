/**
 * Plugin Registry — O(1) id lookup + secondary indexes for hundreds of plugins.
 *
 * Indexes:
 * - byId
 * - byCategory
 * - byAction
 * - byTag
 * - keyword → plugin ids (from name/description/tags/actions)
 *
 * Enable/disable is independent per plugin and does not unregister it.
 */

import { validateManifest, toDiscoveryCard } from './types.js'
import { setPluginTrustConfig } from '../trust/index.js'

/** @typedef {import('./types.js').PluginManifest} PluginManifest */
/** @typedef {import('./types.js').PluginHandlers} PluginHandlers */
/** @typedef {import('./types.js').RegisteredPlugin} RegisteredPlugin */

/** @type {Map<string, RegisteredPlugin>} */
const byId = new Map()

/** @type {Map<string, Set<string>>} */
const byCategory = new Map()

/** @type {Map<string, Set<string>>} */
const byAction = new Map()

/** @type {Map<string, Set<string>>} */
const byTag = new Map()

/** @type {Map<string, Set<string>>} */
const byKeyword = new Map()

/**
 * @param {string} key
 * @param {Map<string, Set<string>>} index
 * @param {string} id
 */
function indexAdd(index, key, id) {
  const k = String(key || '').toLowerCase()
  if (!k) return
  let set = index.get(k)
  if (!set) {
    set = new Set()
    index.set(k, set)
  }
  set.add(id)
}

/**
 * @param {Map<string, Set<string>>} index
 * @param {string} key
 * @param {string} id
 */
function indexRemove(index, key, id) {
  const k = String(key || '').toLowerCase()
  const set = index.get(k)
  if (!set) return
  set.delete(id)
  if (set.size === 0) index.delete(k)
}

/**
 * Tokenize text for keyword index.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9à-ÿ]+/i)
    .filter((t) => t.length >= 3)
}

/**
 * @param {RegisteredPlugin} plugin
 */
function addToIndexes(plugin) {
  const id = plugin.manifest.id
  indexAdd(byCategory, plugin.manifest.category, id)
  for (const action of plugin.manifest.actions || []) {
    indexAdd(byAction, action.id, id)
  }
  for (const tag of plugin.manifest.tags || []) {
    indexAdd(byTag, tag, id)
  }
  const corpus = [
    plugin.manifest.name,
    plugin.manifest.description,
    plugin.manifest.category,
    ...(plugin.manifest.tags || []),
    ...(plugin.manifest.actions || []).map((a) => `${a.id} ${a.description}`),
  ].join(' ')
  for (const tok of new Set(tokenize(corpus))) {
    indexAdd(byKeyword, tok, id)
  }
}

/**
 * @param {RegisteredPlugin} plugin
 */
function removeFromIndexes(plugin) {
  const id = plugin.manifest.id
  indexRemove(byCategory, plugin.manifest.category, id)
  for (const action of plugin.manifest.actions || []) {
    indexRemove(byAction, action.id, id)
  }
  for (const tag of plugin.manifest.tags || []) {
    indexRemove(byTag, tag, id)
  }
  // Rebuild keyword index for this id by scanning — rare path (unregister)
  for (const [kw, set] of byKeyword) {
    if (set.has(id)) {
      set.delete(id)
      if (set.size === 0) byKeyword.delete(kw)
    }
  }
}

/**
 * Register a plugin. Idempotent replace if same id.
 *
 * @param {PluginManifest} manifest
 * @param {PluginHandlers} [handlers]
 * @param {{ enabled?: boolean, authenticated?: boolean }} [opts]
 * @returns {RegisteredPlugin}
 */
export function registerCapabilityPlugin(manifest, handlers = {}, opts = {}) {
  const errors = validateManifest(manifest)
  if (errors.length) {
    throw new Error(`Invalid plugin manifest (${manifest?.id || '?'}): ${errors.join('; ')}`)
  }

  const existing = byId.get(manifest.id)
  if (existing) removeFromIndexes(existing)

  /** @type {RegisteredPlugin} */
  const plugin = {
    manifest: {
      ...manifest,
      permissions: [...(manifest.permissions || [])],
      actions: (manifest.actions || []).map((a) => ({ ...a })),
      tags: [...(manifest.tags || [])],
    },
    handlers: handlers || {},
    enabled: opts.enabled !== false,
    authenticated: opts.authenticated === true || manifest.authentication === 'none',
    registeredAt: Date.now(),
  }

  byId.set(manifest.id, plugin)
  addToIndexes(plugin)

  // Sync Trust & Permission config from manifest (configurable per plugin)
  /** @type {Record<string, import('../trust/levels.js').TrustLevel>} */
  const actionTrust = {}
  /** @type {Record<string, string[]>} */
  const actionPermissions = {}
  for (const a of plugin.manifest.actions || []) {
    if (a.trustLevel === 'low' || a.trustLevel === 'medium' || a.trustLevel === 'high') {
      actionTrust[a.id] = a.trustLevel
    }
    if (Array.isArray(a.permissions) && a.permissions.length) {
      actionPermissions[a.id] = [...a.permissions]
    }
  }
  setPluginTrustConfig(manifest.id, {
    actionTrust,
    actionPermissions,
    permissions: [...(manifest.permissions || [])],
  })

  return plugin
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function unregisterCapabilityPlugin(id) {
  const plugin = byId.get(id)
  if (!plugin) return false
  removeFromIndexes(plugin)
  byId.delete(id)
  return true
}

/**
 * Enable / disable without unregistering (independent lifecycle).
 * @param {string} id
 * @param {boolean} enabled
 */
export function setPluginEnabled(id, enabled) {
  const plugin = byId.get(id)
  if (!plugin) return false
  plugin.enabled = Boolean(enabled)
  return true
}

/**
 * Mark whether required authentication is satisfied.
 * @param {string} id
 * @param {boolean} authenticated
 */
export function setPluginAuthenticated(id, authenticated) {
  const plugin = byId.get(id)
  if (!plugin) return false
  plugin.authenticated = Boolean(authenticated)
  return true
}

/**
 * @param {string} id
 * @returns {RegisteredPlugin | undefined}
 */
export function getCapabilityPlugin(id) {
  return byId.get(id)
}

/**
 * @param {{ enabledOnly?: boolean, availableOnly?: boolean }} [opts]
 * @returns {RegisteredPlugin[]}
 */
export function listCapabilityPlugins(opts = {}) {
  let list = [...byId.values()]
  if (opts.enabledOnly) list = list.filter((p) => p.enabled)
  if (opts.availableOnly) {
    list = list.filter(
      (p) => p.enabled && (p.manifest.authentication === 'none' || p.authenticated),
    )
  }
  return list
}

/**
 * Candidate ids from indexes (union) — avoids full scans when possible.
 * @param {string} userMessage
 * @param {{ category?: string, action?: string, tags?: string[] }} [hints]
 * @returns {Set<string>}
 */
export function shortlistPluginIds(userMessage, hints = {}) {
  /** @type {Set<string>} */
  const ids = new Set()

  if (hints.category) {
    const set = byCategory.get(String(hints.category).toLowerCase())
    if (set) for (const id of set) ids.add(id)
  }
  if (hints.action) {
    const set = byAction.get(String(hints.action).toLowerCase())
    if (set) for (const id of set) ids.add(id)
  }
  for (const tag of hints.tags || []) {
    const set = byTag.get(String(tag).toLowerCase())
    if (set) for (const id of set) ids.add(id)
  }

  const tokens = tokenize(userMessage)
  for (const tok of tokens) {
    const set = byKeyword.get(tok)
    if (set) for (const id of set) ids.add(id)
  }

  // Fallback: if nothing indexed matched, return empty — caller may full-scan enabled only
  return ids
}

/**
 * @returns {{ plugins: number, categories: number, actions: number, keywords: number }}
 */
export function registryStats() {
  return {
    plugins: byId.size,
    categories: byCategory.size,
    actions: byAction.size,
    keywords: byKeyword.size,
  }
}

/**
 * Test helper / hot-reload.
 */
export function clearCapabilityRegistry() {
  byId.clear()
  byCategory.clear()
  byAction.clear()
  byTag.clear()
  byKeyword.clear()
}

export { toDiscoveryCard, validateManifest }
