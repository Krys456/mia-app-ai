/**
 * Universal Device Manager — built-in category adapters.
 *
 * These are capability adapters (not brands). Real platform connectors
 * register additional adapters without changing the reasoning core.
 *
 * Default: not connected → invoke returns unavailable (fail-soft).
 * listDevices still exposes example inventory so the AI can reason on capabilities.
 */

import { defaultCapabilitiesFor } from './capabilities.js'
import { buildDeviceRecord, registerDeviceAdapter } from './registry.js'

/**
 * @param {object} def
 * @param {string} def.id
 * @param {string} def.name
 * @param {string[]} def.deviceTypes
 * @param {Array<{ id: string, name: string, type: string, room?: string, state?: Record<string, unknown>, tags?: string[] }>} def.examples
 */
function defineCategoryAdapter(def) {
  const { id, name, deviceTypes, examples } = def

  return {
    id,
    name,
    version: '1.0.0',
    deviceTypes: [...deviceTypes],
    isConnected() {
      return false
    },
    listDevices() {
      return examples.map((ex) =>
        buildDeviceRecord(
          {
            id: ex.id,
            name: ex.name,
            type: ex.type,
            adapterId: id,
            room: ex.room,
            state: ex.state || {},
            tags: ex.tags || [],
            online: false,
          },
          defaultCapabilitiesFor(ex.type),
        ),
      )
    },
    async getState(deviceId) {
      const devices = this.listDevices()
      const d = devices.find((x) => x.id === deviceId)
      return d?.state || { online: false }
    },
    async invoke(input) {
      return {
        status: /** @type {const} */ ('unavailable'),
        message: `Adapter «${name}» non collegato: «${input.capability}» su ${input.deviceId} non eseguita. Collega un connettore per questo tipo di dispositivo.`,
        data: {
          adapterId: id,
          deviceId: input.deviceId,
          capability: input.capability,
          params: input.params || {},
        },
      }
    },
  }
}

/** @type {ReturnType<typeof defineCategoryAdapter>[]} */
export const BUILTIN_DEVICE_ADAPTERS = [
  defineCategoryAdapter({
    id: 'adapter.lights',
    name: 'Lights',
    deviceTypes: ['light'],
    examples: [
      { id: 'light.living', name: 'Luci soggiorno', type: 'light', room: 'living', state: { power: 'off', brightness: 0 } },
      { id: 'light.kitchen', name: 'Luci cucina', type: 'light', room: 'kitchen', state: { power: 'off', brightness: 0 } },
    ],
  }),
  defineCategoryAdapter({
    id: 'adapter.thermostats',
    name: 'Thermostats',
    deviceTypes: ['thermostat'],
    examples: [
      {
        id: 'thermo.home',
        name: 'Termostato casa',
        type: 'thermostat',
        room: 'hallway',
        state: { temperatureC: 20, targetC: 21, mode: 'auto' },
      },
    ],
  }),
  defineCategoryAdapter({
    id: 'adapter.smart_plugs',
    name: 'Smart Plugs',
    deviceTypes: ['smart_plug'],
    examples: [
      { id: 'plug.washer', name: 'Presa lavatrice', type: 'smart_plug', room: 'laundry', state: { power: 'off' } },
    ],
  }),
  defineCategoryAdapter({
    id: 'adapter.photovoltaic',
    name: 'Photovoltaic Systems',
    deviceTypes: ['photovoltaic'],
    examples: [
      {
        id: 'pv.roof',
        name: 'Impianto fotovoltaico',
        type: 'photovoltaic',
        state: { producingKw: 0, consumingKw: 0 },
      },
    ],
  }),
  defineCategoryAdapter({
    id: 'adapter.batteries',
    name: 'Batteries',
    deviceTypes: ['battery'],
    examples: [
      { id: 'battery.home', name: 'Batteria domestica', type: 'battery', state: { percent: 55, charging: false } },
    ],
  }),
  defineCategoryAdapter({
    id: 'adapter.ev_chargers',
    name: 'EV Chargers',
    deviceTypes: ['ev_charger'],
    examples: [
      { id: 'ev.wallbox', name: 'Wallbox EV', type: 'ev_charger', state: { percent: 40, charging: false } },
    ],
  }),
  defineCategoryAdapter({
    id: 'adapter.cameras',
    name: 'Cameras',
    deviceTypes: ['camera'],
    examples: [
      { id: 'cam.entrance', name: 'Camera ingresso', type: 'camera', room: 'entrance', state: { recording: false } },
    ],
  }),
  defineCategoryAdapter({
    id: 'adapter.tvs',
    name: 'TVs',
    deviceTypes: ['tv'],
    examples: [
      { id: 'tv.living', name: 'TV soggiorno', type: 'tv', room: 'living', state: { power: 'off', volume: 20 } },
    ],
  }),
  defineCategoryAdapter({
    id: 'adapter.speakers',
    name: 'Speakers',
    deviceTypes: ['speaker'],
    examples: [
      { id: 'speaker.kitchen', name: 'Speaker cucina', type: 'speaker', room: 'kitchen', state: { power: 'off', volume: 15 } },
    ],
  }),
  defineCategoryAdapter({
    id: 'adapter.routers',
    name: 'Routers',
    deviceTypes: ['router'],
    examples: [
      { id: 'router.main', name: 'Router principale', type: 'router', state: { wan: 'up', clients: 0 } },
    ],
  }),
  defineCategoryAdapter({
    id: 'adapter.nas',
    name: 'NAS',
    deviceTypes: ['nas'],
    examples: [
      { id: 'nas.home', name: 'NAS casa', type: 'nas', state: { usedPercent: 42, healthy: true } },
    ],
  }),
  defineCategoryAdapter({
    id: 'adapter.drones',
    name: 'Drones',
    deviceTypes: ['drone'],
    examples: [
      { id: 'drone.1', name: 'Drone', type: 'drone', state: { percent: 80, docked: true } },
    ],
  }),
  defineCategoryAdapter({
    id: 'adapter.robots',
    name: 'Robots',
    deviceTypes: ['robot'],
    examples: [
      { id: 'robot.vacuum', name: 'Robot aspirapolvere', type: 'robot', state: { percent: 90, cleaning: false, docked: true } },
    ],
  }),
]

let builtinsReady = false

/**
 * Register all built-in category adapters (idempotent).
 */
export function registerBuiltinDeviceAdapters() {
  if (builtinsReady) return
  for (const adapter of BUILTIN_DEVICE_ADAPTERS) {
    registerDeviceAdapter(adapter)
  }
  builtinsReady = true
}

/**
 * Test helper — allow re-registration after clear.
 */
export function resetBuiltinDeviceAdaptersFlag() {
  builtinsReady = false
}
