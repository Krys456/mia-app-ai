/**
 * Universal Action Engine — plugin registry.
 *
 * Every integration behaves like a plugin. The engine never hardcodes
 * platform-specific logic; it only routes through registered plugins.
 */

/**
 * @typedef {import('./adapter.js').AdapterResult} AdapterResult
 */

/**
 * @typedef {object} PluginMatch
 * @property {number} score                 0–1
 * @property {string} capability
 * @property {string} actionSummary
 * @property {Record<string, unknown>} params
 * @property {string[]} [permissions]
 */

/**
 * @typedef {object} ActionPlugin
 * @property {string} id
 * @property {string} category
 * @property {string} version
 * @property {string[]} capabilities
 * @property {string[]} requiredPermissions  Default permission scopes
 * @property {(userMessage: string, context?: object) => PluginMatch | null} match
 * @property {(capability: string, params: Record<string, unknown>) => boolean} needsConfirmation
 * @property {(ctx: {
 *   capability: string,
 *   params: Record<string, unknown>,
 *   actionSummary: string,
 *   adapter: import('./adapter.js').IntegrationAdapter,
 * }) => Promise<AdapterResult>} execute
 * @property {(result: AdapterResult) => { ok: boolean, note: string }} verify
 */

/** @type {Map<string, ActionPlugin>} */
const plugins = new Map()

/**
 * @param {ActionPlugin} plugin
 */
export function registerPlugin(plugin) {
  if (!plugin?.id || typeof plugin.match !== 'function' || typeof plugin.execute !== 'function') {
    throw new Error('Invalid action plugin')
  }
  plugins.set(plugin.id, plugin)
}

/**
 * @param {string} id
 */
export function unregisterPlugin(id) {
  plugins.delete(id)
}

/**
 * @returns {ActionPlugin[]}
 */
export function listPlugins() {
  return [...plugins.values()]
}

/**
 * @param {string} id
 * @returns {ActionPlugin | undefined}
 */
export function getPlugin(id) {
  return plugins.get(id)
}

/**
 * @param {string} category
 * @returns {ActionPlugin[]}
 */
export function listPluginsByCategory(category) {
  const c = String(category || '').toLowerCase()
  return listPlugins().filter((p) => p.category.toLowerCase() === c)
}

/**
 * Clear registry (tests / hot-reload).
 */
export function clearRegistry() {
  plugins.clear()
}
