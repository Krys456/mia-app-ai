/**
 * LAIfe Plugin Architecture
 *
 * - Every capability is an independent plugin
 * - Plugins declare: name, description, permissions, authentication, supported actions
 * - Enable / disable independently
 * - AI discovers available plugins automatically
 * - Reasoning decides when to use them
 * - Isolated from the core conversation engine (no coupling to chat UI / CI memory)
 *
 * Scales to hundreds of plugins via indexed registry (category / action / tag / keyword).
 */

export {
  registerCapabilityPlugin,
  unregisterCapabilityPlugin,
  setPluginEnabled,
  setPluginAuthenticated,
  getCapabilityPlugin,
  listCapabilityPlugins,
  shortlistPluginIds,
  registryStats,
  clearCapabilityRegistry,
  validateManifest,
  toDiscoveryCard,
} from './registry.js'

export {
  discoverAvailablePlugins,
  reasonAboutPlugins,
  formatPluginDiscoveryForReasoning,
  listAllPluginCards,
} from './discovery.js'

export {
  ensureActionPluginsBridged,
  bridgeActionPlugin,
  enablePlugin,
  authenticatePlugin,
} from './bridge-action.js'

export {
  setPluginTrustConfig,
  getPluginTrustConfig,
  evaluateTrustPolicy,
  resolveTrustLevel,
  grantPriorAuthorization,
  clearTrustStore,
} from '../trust/index.js'

import { ensureActionPluginsBridged } from './bridge-action.js'
import { formatPluginDiscoveryForReasoning, reasonAboutPlugins } from './discovery.js'
import { registryStats } from './registry.js'

/**
 * Boot architecture + bridge action plugins; return reasoning brief if relevant.
 * Safe to call every turn — fail-soft, never throws into conversation core.
 *
 * @param {object} input
 * @param {string} input.userMessage
 * @returns {{ suggestions: ReturnType<typeof reasonAboutPlugins>, context: string, stats: ReturnType<typeof registryStats> }}
 */
export function runPluginArchitecture(input) {
  try {
    ensureActionPluginsBridged()
    const userMessage = String(input?.userMessage || '')
    const suggestions = reasonAboutPlugins(userMessage, { limit: 5, minScore: 0.58 })
    const context =
      suggestions.length > 0 ? formatPluginDiscoveryForReasoning(userMessage) : ''
    return {
      suggestions,
      context,
      stats: registryStats(),
    }
  } catch {
    return {
      suggestions: [],
      context: '',
      stats: { plugins: 0, categories: 0, actions: 0, keywords: 0 },
    }
  }
}
