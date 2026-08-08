/**
 * Bridge: Universal Action Engine plugins → Plugin Architecture manifests.
 *
 * Keeps action plugins as the execution surface while the architecture
 * owns discovery, enable/disable, auth flags, and indexed lookup.
 */

import { registerCapabilityPlugin, setPluginEnabled, setPluginAuthenticated } from './registry.js'
import { listPlugins as listActionPlugins } from '../action-engine/index.js'
import { getPlugin as getActionPlugin } from '../action-engine/registry.js'

let bridged = false

/**
 * Map an action-engine plugin into a capability manifest + handlers.
 * @param {import('../action-engine/registry.js').ActionPlugin} actionPlugin
 */
export function bridgeActionPlugin(actionPlugin) {
  const mutatingCaps = new Set(
    (actionPlugin.capabilities || []).filter((c) =>
      /^(create|update|delete|send|set|start|stop|play|purchase|share|move|write|run_scene|unlock|lock|climate)/i.test(
        c,
      ),
    ),
  )

  const auth =
    (actionPlugin.requiredPermissions || []).length > 0 ? /** @type {const} */ ('oauth') : /** @type {const} */ ('none')

  return registerCapabilityPlugin(
    {
      id: actionPlugin.id,
      name: actionPlugin.category,
      description: `${actionPlugin.category} integration — actions: ${(actionPlugin.capabilities || []).join(', ')}`,
      version: actionPlugin.version || '1.0.0',
      category: actionPlugin.category,
      permissions: [...(actionPlugin.requiredPermissions || [])],
      authentication: auth,
      actions: (actionPlugin.capabilities || []).map((cap) => ({
        id: cap,
        description: `${actionPlugin.category}: ${cap}`,
        mutating: mutatingCaps.has(cap) || actionPlugin.needsConfirmation?.(cap, {}),
      })),
      tags: [actionPlugin.category, actionPlugin.id, 'action-engine'],
      priority: 10,
    },
    {
      match(userMessage) {
        const m = actionPlugin.match(userMessage)
        if (!m) return null
        return {
          actionId: m.capability,
          score: m.score,
          summary: m.actionSummary,
          params: m.params,
        }
      },
      async execute(ctx) {
        return actionPlugin.execute(ctx)
      },
      verify(result) {
        return actionPlugin.verify(result)
      },
    },
    {
      enabled: true,
      // Auth starts false when oauth required — connectors flip this via setPluginAuthenticated
      authenticated: auth === 'none',
    },
  )
}

/**
 * Ensure all Universal Action Engine builtins are registered in the architecture.
 * Idempotent.
 */
export function ensureActionPluginsBridged() {
  // Touch action-engine listPlugins to boot builtins
  const actionPlugins = listActionPlugins()
  for (const p of actionPlugins) {
    const existing = getActionPlugin(p.id)
    if (!existing) continue
    // Re-register / refresh bridge
    bridgeActionPlugin(existing)
  }
  bridged = true
  return actionPlugins.length
}

/**
 * Enable/disable an action plugin in the architecture (and optionally skip matching).
 * @param {string} id
 * @param {boolean} enabled
 */
export function enablePlugin(id, enabled) {
  return setPluginEnabled(id, enabled)
}

/**
 * Mark connector authentication state for a plugin.
 * @param {string} id
 * @param {boolean} authenticated
 */
export function authenticatePlugin(id, authenticated) {
  return setPluginAuthenticated(id, authenticated)
}

export function isBridged() {
  return bridged
}
