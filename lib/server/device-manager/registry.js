/**
 * Universal Device Manager — adapter + device registry.
 *
 * New device support = register a new adapter plugin.
 * No brand-specific logic in the reasoning core.
 */

/**
 * @typedef {import('./capabilities.js').CapabilityDef} CapabilityDef
 */

/**
 * @typedef {object} DeviceAction
 * @property {string} id
 * @property {string} capability
 * @property {string} label
 * @property {Record<string, unknown>} [paramsSchema]
 * @property {boolean} [mutating]
 */

/**
 * @typedef {object} DeviceRecord
 * @property {string} id
 * @property {string} name
 * @property {string} type
 * @property {string} adapterId
 * @property {string[]} capabilities
 * @property {Record<string, unknown>} state
 * @property {DeviceAction[]} availableActions
 * @property {boolean} online
 * @property {string[]} [tags]
 * @property {string} [room]
 */

/**
 * @typedef {object} DeviceAdapter
 * @property {string} id
 * @property {string} name
 * @property {string} version
 * @property {string[]} deviceTypes
 * @property {() => boolean} isConnected
 * @property {() => Promise<DeviceRecord[]>|DeviceRecord[]} listDevices
 * @property {(deviceId: string) => Promise<Record<string, unknown>>|Record<string, unknown>} [getState]
 * @property {(input: {
 *   deviceId: string,
 *   capability: string,
 *   params?: Record<string, unknown>,
 *   actionSummary?: string,
 * }) => Promise<{ status: 'ok'|'unavailable'|'denied'|'error', message: string, data?: Record<string, unknown> }>} invoke
 */

/** @type {Map<string, DeviceAdapter>} */
const adapters = new Map()

/** Optional in-memory device overlays (tests / runtime registration). */
/** @type {Map<string, DeviceRecord>} */
const deviceOverrides = new Map()

/**
 * @param {DeviceAdapter} adapter
 */
export function registerDeviceAdapter(adapter) {
  if (
    !adapter?.id ||
    typeof adapter.listDevices !== 'function' ||
    typeof adapter.invoke !== 'function' ||
    typeof adapter.isConnected !== 'function'
  ) {
    throw new Error('Invalid device adapter')
  }
  adapters.set(adapter.id, adapter)
}

/**
 * @param {string} id
 */
export function unregisterDeviceAdapter(id) {
  adapters.delete(id)
}

/**
 * @returns {DeviceAdapter[]}
 */
export function listDeviceAdapters() {
  return [...adapters.values()]
}

/**
 * @param {string} id
 */
export function getDeviceAdapter(id) {
  return adapters.get(id) || null
}

/**
 * Register or replace a device record (does not require a live connector).
 * @param {DeviceRecord} device
 */
export function upsertDevice(device) {
  if (!device?.id || !device?.type || !device?.adapterId) {
    throw new Error('Invalid device record')
  }
  deviceOverrides.set(device.id, {
    ...device,
    capabilities: [...(device.capabilities || [])],
    availableActions: [...(device.availableActions || [])],
    state: { ...(device.state || {}) },
  })
}

/**
 * @param {string} id
 */
export function removeDevice(id) {
  deviceOverrides.delete(id)
}

export function clearDeviceOverrides() {
  deviceOverrides.clear()
}

export function clearDeviceAdapters() {
  adapters.clear()
}

/**
 * @param {Partial<DeviceRecord> & { id: string, name: string, type: string, adapterId: string }} partial
 * @param {string[]} capabilities
 * @returns {DeviceRecord}
 */
export function buildDeviceRecord(partial, capabilities) {
  const caps = [...capabilities]
  const availableActions = caps.map((capability) => ({
    id: capability.replace(/\./g, '_'),
    capability,
    label: capability,
    mutating: /\.(set|start|stop|toggle|reboot|move|dock|play|pause|record|charge|clean|identify)$/i.test(
      capability,
    ) || /\.(set|start|stop|toggle)$/.test(capability.split('.').pop() || ''),
  }))

  return {
    id: partial.id,
    name: partial.name,
    type: partial.type,
    adapterId: partial.adapterId,
    capabilities: caps,
    state: { online: true, ...(partial.state || {}) },
    availableActions:
      partial.availableActions && partial.availableActions.length
        ? partial.availableActions
        : availableActions,
    online: partial.online !== false,
    tags: partial.tags || [],
    room: partial.room,
  }
}

/**
 * Collect devices from all adapters + overrides.
 * @returns {Promise<DeviceRecord[]>}
 */
export async function listAllDevices() {
  /** @type {DeviceRecord[]} */
  const out = []
  const seen = new Set()

  for (const adapter of adapters.values()) {
    try {
      const list = await Promise.resolve(adapter.listDevices())
      if (!Array.isArray(list)) continue
      for (const d of list) {
        if (!d?.id || seen.has(d.id)) continue
        seen.add(d.id)
        out.push(d)
      }
    } catch {
      // fail-soft per adapter
    }
  }

  for (const d of deviceOverrides.values()) {
    if (seen.has(d.id)) {
      const idx = out.findIndex((x) => x.id === d.id)
      if (idx >= 0) out[idx] = { ...out[idx], ...d }
    } else {
      seen.add(d.id)
      out.push(d)
    }
  }

  return out
}

/**
 * @param {string} deviceId
 * @returns {Promise<DeviceRecord | null>}
 */
export async function getDevice(deviceId) {
  const all = await listAllDevices()
  return all.find((d) => d.id === deviceId) || null
}

/**
 * Invoke a capability on a device through its adapter.
 * @param {{ deviceId: string, capability: string, params?: Record<string, unknown>, actionSummary?: string }} input
 */
export async function invokeDeviceCapability(input) {
  const device = await getDevice(input.deviceId)
  if (!device) {
    return {
      status: /** @type {const} */ ('error'),
      message: `Dispositivo non trovato: ${input.deviceId}`,
    }
  }
  if (!device.capabilities.includes(input.capability)) {
    return {
      status: /** @type {const} */ ('denied'),
      message: `Il dispositivo «${device.name}» non espone la capability «${input.capability}».`,
    }
  }
  const adapter = adapters.get(device.adapterId)
  if (!adapter) {
    return {
      status: /** @type {const} */ ('unavailable'),
      message: `Nessun adapter per «${device.name}» (${device.adapterId}).`,
    }
  }
  if (!adapter.isConnected()) {
    return {
      status: /** @type {const} */ ('unavailable'),
      message: `Adapter «${adapter.name}» non connesso — azione non eseguita.`,
      data: { deviceId: device.id, capability: input.capability },
    }
  }
  try {
    return await adapter.invoke({
      deviceId: device.id,
      capability: input.capability,
      params: input.params || {},
      actionSummary: input.actionSummary || `${input.capability} on ${device.name}`,
    })
  } catch {
    return {
      status: /** @type {const} */ ('error'),
      message: `Errore invocando «${input.capability}» su «${device.name}».`,
    }
  }
}

/**
 * @returns {{ adapters: number, connected: number }}
 */
export function deviceRegistryStats() {
  let connected = 0
  for (const a of adapters.values()) {
    try {
      if (a.isConnected()) connected += 1
    } catch {
      /* ignore */
    }
  }
  return { adapters: adapters.size, connected }
}
