/**
 * LAIfe Plugin Architecture — core types & validation.
 *
 * Every capability is an independent plugin with a declarative manifest.
 * Designed to scale to hundreds of plugins without touching the conversation core.
 */

/**
 * @typedef {'none'|'oauth'|'api_key'|'device_link'} PluginAuthKind
 */

/**
 * @typedef {object} PluginAction
 * @property {string} id
 * @property {string} description
 * @property {boolean} [mutating]     Hint for trust policy when trustLevel omitted
 * @property {'low'|'medium'|'high'} [trustLevel]  Explicit trust level for this action
 * @property {string[]} [permissions] Extra scopes for this action (else manifest.permissions)
 */

/**
 * @typedef {object} PluginManifest
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} version
 * @property {string} category
 * @property {string[]} permissions
 * @property {PluginAuthKind} authentication
 * @property {PluginAction[]} actions   supported actions
 * @property {string[]} [tags]
 * @property {number} [priority]        Soft ranking bias (default 0)
 */

/**
 * @typedef {object} PluginHandlers
 * @property {(userMessage: string, context?: object) =>
 *   ({ actionId: string, score: number, summary: string, params?: Record<string, unknown> } | null)
 * } [match]
 * @property {(ctx: object) => Promise<object>} [execute]
 * @property {(result: object) => { ok: boolean, note: string }} [verify]
 */

/**
 * @typedef {object} RegisteredPlugin
 * @property {PluginManifest} manifest
 * @property {PluginHandlers} handlers
 * @property {boolean} enabled
 * @property {boolean} authenticated   Whether required auth is satisfied
 * @property {number} registeredAt
 */

/**
 * @param {PluginManifest} manifest
 * @returns {string[]} validation errors (empty = ok)
 */
export function validateManifest(manifest) {
  /** @type {string[]} */
  const errors = []
  if (!manifest || typeof manifest !== 'object') return ['manifest missing']
  if (!manifest.id || typeof manifest.id !== 'string') errors.push('id required')
  if (!manifest.name || typeof manifest.name !== 'string') errors.push('name required')
  if (!manifest.description || typeof manifest.description !== 'string') {
    errors.push('description required')
  }
  if (!manifest.version) errors.push('version required')
  if (!manifest.category) errors.push('category required')
  if (!Array.isArray(manifest.permissions)) errors.push('permissions must be an array')
  if (!['none', 'oauth', 'api_key', 'device_link'].includes(manifest.authentication)) {
    errors.push('authentication must be none|oauth|api_key|device_link')
  }
  if (!Array.isArray(manifest.actions) || manifest.actions.length === 0) {
    errors.push('actions must be a non-empty array')
  } else {
    for (const a of manifest.actions) {
      if (!a?.id || !a?.description) errors.push(`invalid action: ${a?.id || '?'}`)
    }
  }
  return errors
}

/**
 * Lightweight discovery card for the reasoning engine (no handlers).
 * @param {RegisteredPlugin} plugin
 */
export function toDiscoveryCard(plugin) {
  const m = plugin.manifest
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    category: m.category,
    version: m.version,
    permissions: [...(m.permissions || [])],
    authentication: m.authentication,
    supportedActions: (m.actions || []).map((a) => ({
      id: a.id,
      description: a.description,
      mutating: Boolean(a.mutating),
      trustLevel: a.trustLevel || null,
    })),
    tags: [...(m.tags || [])],
    enabled: plugin.enabled,
    authenticated: plugin.authenticated,
    available: plugin.enabled && (m.authentication === 'none' || plugin.authenticated),
  }
}
