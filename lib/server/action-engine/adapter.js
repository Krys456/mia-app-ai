/**
 * Universal Action Engine — abstract integration adapter.
 *
 * Plugins never talk to Alexa / Gmail / Spotify / etc. directly.
 * They call this adapter interface; concrete platform connectors plug in later.
 */

/**
 * @typedef {object} AdapterInvokeInput
 * @property {string} pluginId
 * @property {string} category
 * @property {string} capability
 * @property {Record<string, unknown>} params
 * @property {string} actionSummary
 */

/**
 * @typedef {object} AdapterResult
 * @property {'ok'|'unavailable'|'denied'|'error'} status
 * @property {string} message
 * @property {Record<string, unknown>} [data]
 * @property {string} [connectorId]  Opaque connector id if one was used
 */

/**
 * @typedef {object} IntegrationAdapter
 * @property {(pluginId: string) => boolean} isConnected
 * @property {(input: AdapterInvokeInput) => Promise<AdapterResult>} invoke
 */

/**
 * Default adapter: no connectors bound. Safe fail-soft.
 * Real connectors register themselves without changing plugin code.
 *
 * @type {IntegrationAdapter}
 */
export const nullAdapter = {
  isConnected() {
    return false
  },
  async invoke(input) {
    return {
      status: 'unavailable',
      message: `Nessun connettore attivo per «${input.pluginId}» (${input.category} / ${input.capability}). L’azione non è stata eseguita.`,
      data: { capability: input.capability, params: input.params },
    }
  },
}

/** @type {IntegrationAdapter} */
let activeAdapter = nullAdapter

/**
 * Replace the active adapter (e.g. when a user connects integrations).
 * @param {IntegrationAdapter | null | undefined} adapter
 */
export function setIntegrationAdapter(adapter) {
  activeAdapter =
    adapter && typeof adapter.invoke === 'function' && typeof adapter.isConnected === 'function'
      ? adapter
      : nullAdapter
}

/**
 * @returns {IntegrationAdapter}
 */
export function getIntegrationAdapter() {
  return activeAdapter
}
