/**
 * LAIfe Universal Device Manager
 *
 * Support any connected device through adapters.
 * Every device exposes: capabilities · state · available actions.
 * The AI reasons using capabilities instead of brand-specific APIs.
 * New device support = register a new adapter plugin only.
 *
 * Invisible. Fail-soft.
 */

export {
  CAPABILITY_CATALOG,
  DEVICE_TYPES,
  DEFAULT_CAPABILITIES_BY_TYPE,
  getCapability,
  defaultCapabilitiesFor,
} from './capabilities.js'

export {
  registerDeviceAdapter,
  unregisterDeviceAdapter,
  listDeviceAdapters,
  getDeviceAdapter,
  upsertDevice,
  removeDevice,
  listAllDevices,
  getDevice,
  invokeDeviceCapability,
  buildDeviceRecord,
  deviceRegistryStats,
  clearDeviceAdapters,
  clearDeviceOverrides,
} from './registry.js'

export {
  registerBuiltinDeviceAdapters,
  BUILTIN_DEVICE_ADAPTERS,
  resetBuiltinDeviceAdaptersFlag,
} from './adapters.js'

export {
  inferCapabilityIntents,
  reasonAboutDevices,
  formatDeviceManagerForWriter,
} from './reason.js'

import { CAPABILITY_CATALOG } from './capabilities.js'
import { registerBuiltinDeviceAdapters } from './adapters.js'
import {
  deviceRegistryStats,
  invokeDeviceCapability,
  listAllDevices,
  listDeviceAdapters,
} from './registry.js'
import { formatDeviceManagerForWriter, reasonAboutDevices } from './reason.js'

/** @returns {import('./capabilities.js').CapabilityDef[]} */
export function listCapabilities() {
  return [...CAPABILITY_CATALOG]
}

/**
 * @typedef {import('./registry.js').DeviceRecord} DeviceRecord
 * @typedef {import('./reason.js').DeviceIntentMatch} DeviceIntentMatch
 */

/**
 * @typedef {object} DeviceManagerPlan
 * @property {boolean} active
 * @property {DeviceRecord[]} devices
 * @property {DeviceIntentMatch[]} matches
 * @property {DeviceIntentMatch | null} topMatch
 * @property {boolean} shouldAct
 * @property {{ status: string, message: string, data?: Record<string, unknown> } | null} invocation
 * @property {string} writerBrief
 * @property {string[]} reasons
 * @property {{ adapters: number, connected: number }} stats
 */

/**
 * @param {DeviceManagerPlan} plan
 */
function buildWriterBrief(plan) {
  if (!plan.active) return ''
  const lines = [
    'UNIVERSAL DEVICE MANAGER (invisibile):',
    'Ragiona per capability (power.set, temperature.set, …), mai per API di marca.',
    `Dispositivi noti: ${plan.devices.length} · adapter: ${plan.stats.adapters} (connessi: ${plan.stats.connected}).`,
  ]
  if (plan.topMatch) {
    lines.push(
      `Match: «${plan.topMatch.device.name}» → capability «${plan.topMatch.capability}» (${plan.topMatch.actionSummary}).`,
    )
    if (plan.invocation) {
      lines.push(`Esito adapter: ${plan.invocation.status} — ${plan.invocation.message}`)
    } else if (plan.shouldAct) {
      lines.push('Pronto ad agire via adapter; conferma se l’azione è mutante e non ancora autorizzata.')
    } else {
      lines.push('Descrivi opzioni in linguaggio naturale; non inventare stati o successi.')
    }
  } else {
    lines.push('Nessun match capability forte — non forzare controllo dispositivi.')
  }
  lines.push('Nuovo dispositivo = nuovo adapter plugin. Non citare il Device Manager.')
  return lines.join(' ')
}

/**
 * Run Universal Device Manager for this turn.
 *
 * @param {object} input
 * @param {string} [input.userMessage]
 * @param {boolean} [input.execute]  When true, invoke top mutating/query match through adapter
 * @param {number} [input.minScore]
 * @returns {Promise<{ plan: DeviceManagerPlan, context: string }>}
 */
export async function runUniversalDeviceManager(input = {}) {
  try {
    registerBuiltinDeviceAdapters()
    const userMessage = String(input.userMessage || '')
    const devices = await listAllDevices()
    const stats = deviceRegistryStats()
    const matches = reasonAboutDevices(userMessage, devices)
    const minScore = typeof input.minScore === 'number' ? input.minScore : 0.58
    const topMatch = matches.find((m) => m.score >= minScore) || null

    /** @type {DeviceManagerPlan} */
    const plan = {
      active: devices.length > 0,
      devices,
      matches: matches.slice(0, 8),
      topMatch,
      shouldAct: Boolean(topMatch && topMatch.score >= 0.7),
      invocation: null,
      writerBrief: '',
      reasons: topMatch
        ? [`match_${topMatch.capability}`, `device_${topMatch.device.id}`, ...topMatch.reasons.slice(0, 3)]
        : devices.length
          ? ['inventory_only']
          : ['no_devices'],
      stats,
    }

    if (input.execute && topMatch && plan.shouldAct) {
      plan.invocation = await invokeDeviceCapability({
        deviceId: topMatch.device.id,
        capability: topMatch.capability,
        params: topMatch.params,
        actionSummary: topMatch.actionSummary,
      })
      plan.reasons.push(`invoke_${plan.invocation.status}`)
    }

    plan.writerBrief = buildWriterBrief(plan)
    const context =
      plan.active && (topMatch || userMessage)
        ? formatDeviceManagerForWriter(devices, matches)
        : plan.active
          ? formatDeviceManagerForWriter(devices, [])
          : ''

    return {
      plan,
      context: context
        ? `${context}\n\n${plan.writerBrief}`
        : plan.writerBrief
          ? `══════════════════════════════════════\nUNIVERSAL DEVICE MANAGER (INVISIBILE)\n══════════════════════════════════════\n${plan.writerBrief}`
          : '',
    }
  } catch {
    return {
      plan: {
        active: false,
        devices: [],
        matches: [],
        topMatch: null,
        shouldAct: false,
        invocation: null,
        writerBrief: '',
        reasons: ['fail_soft'],
        stats: { adapters: 0, connected: 0 },
      },
      context: '',
    }
  }
}

/**
 * Discovery summary for plugin architecture / debugging.
 */
export function listDeviceAdapterCards() {
  registerBuiltinDeviceAdapters()
  return listDeviceAdapters().map((a) => ({
    id: a.id,
    name: a.name,
    version: a.version,
    deviceTypes: [...a.deviceTypes],
    connected: (() => {
      try {
        return a.isConnected()
      } catch {
        return false
      }
    })(),
  }))
}
