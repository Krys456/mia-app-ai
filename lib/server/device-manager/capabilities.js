/**
 * Universal Device Manager — canonical capability vocabulary.
 *
 * The AI reasons over these capability IDs, never brand-specific APIs.
 * Adapters map brand/platform calls onto this catalog.
 */

/**
 * @typedef {object} CapabilityDef
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {boolean} [mutating]
 * @property {string[]} [deviceTypes]
 */

/** @type {CapabilityDef[]} */
export const CAPABILITY_CATALOG = [
  // Power / outlets
  { id: 'power.get', label: 'Leggi alimentazione', description: 'Stato on/off', mutating: false },
  { id: 'power.set', label: 'Imposta alimentazione', description: 'Accendi/spegni', mutating: true },
  { id: 'power.toggle', label: 'Toggle alimentazione', description: 'Inverti on/off', mutating: true },

  // Lighting
  { id: 'brightness.get', label: 'Leggi luminosità', description: 'Livello luce', mutating: false, deviceTypes: ['light'] },
  { id: 'brightness.set', label: 'Imposta luminosità', description: 'Regola intensità', mutating: true, deviceTypes: ['light'] },
  { id: 'color.set', label: 'Imposta colore', description: 'Colore / temperatura colore', mutating: true, deviceTypes: ['light'] },

  // Climate
  { id: 'temperature.get', label: 'Leggi temperatura', description: 'Temperatura attuale/target', mutating: false, deviceTypes: ['thermostat'] },
  { id: 'temperature.set', label: 'Imposta temperatura', description: 'Target termostato', mutating: true, deviceTypes: ['thermostat'] },
  { id: 'climate.mode.set', label: 'Modalità clima', description: 'heat/cool/auto/off', mutating: true, deviceTypes: ['thermostat'] },

  // Energy / PV / battery / EV
  { id: 'energy.production.get', label: 'Produzione energia', description: 'kW prodotti', mutating: false, deviceTypes: ['photovoltaic', 'battery', 'ev_charger'] },
  { id: 'energy.consumption.get', label: 'Consumo energia', description: 'kW consumati', mutating: false, deviceTypes: ['photovoltaic', 'battery', 'smart_plug', 'ev_charger'] },
  { id: 'battery.level.get', label: 'Livello batteria', description: 'SoC %', mutating: false, deviceTypes: ['battery', 'ev_charger', 'drone', 'robot'] },
  { id: 'battery.charge.start', label: 'Avvia carica', description: 'Inizia ricarica', mutating: true, deviceTypes: ['battery', 'ev_charger'] },
  { id: 'battery.charge.stop', label: 'Ferma carica', description: 'Interrompi ricarica', mutating: true, deviceTypes: ['battery', 'ev_charger'] },
  { id: 'ev.charge.start', label: 'Avvia carica EV', description: 'Ricarica veicolo', mutating: true, deviceTypes: ['ev_charger'] },
  { id: 'ev.charge.stop', label: 'Ferma carica EV', description: 'Stop ricarica veicolo', mutating: true, deviceTypes: ['ev_charger'] },

  // Media
  { id: 'media.play', label: 'Play', description: 'Avvia riproduzione', mutating: true, deviceTypes: ['tv', 'speaker'] },
  { id: 'media.pause', label: 'Pausa', description: 'Metti in pausa', mutating: true, deviceTypes: ['tv', 'speaker'] },
  { id: 'media.volume.set', label: 'Volume', description: 'Imposta volume', mutating: true, deviceTypes: ['tv', 'speaker'] },
  { id: 'media.source.set', label: 'Sorgente', description: 'Input/app', mutating: true, deviceTypes: ['tv'] },

  // Camera / security
  { id: 'camera.stream.get', label: 'Stream camera', description: 'URL/stream live', mutating: false, deviceTypes: ['camera'] },
  { id: 'camera.snapshot', label: 'Istantanea', description: 'Scatta foto', mutating: true, deviceTypes: ['camera'] },
  { id: 'camera.record.start', label: 'Registra', description: 'Avvia registrazione', mutating: true, deviceTypes: ['camera'] },

  // Network / storage
  { id: 'network.status.get', label: 'Stato rete', description: 'Online/clienti/WAN', mutating: false, deviceTypes: ['router'] },
  { id: 'network.reboot', label: 'Riavvia router', description: 'Reboot dispositivo rete', mutating: true, deviceTypes: ['router'] },
  { id: 'storage.status.get', label: 'Stato storage', description: 'Spazio/health NAS', mutating: false, deviceTypes: ['nas'] },
  { id: 'storage.share.list', label: 'Elenca share', description: 'Condivisioni NAS', mutating: false, deviceTypes: ['nas'] },

  // Mobility / robots
  { id: 'mobility.move', label: 'Muovi', description: 'Comando movimento', mutating: true, deviceTypes: ['drone', 'robot'] },
  { id: 'mobility.dock', label: 'Dock/ritorno', description: 'Torna alla base', mutating: true, deviceTypes: ['drone', 'robot'] },
  { id: 'robot.clean.start', label: 'Avvia pulizia', description: 'Start cleaning', mutating: true, deviceTypes: ['robot'] },
  { id: 'robot.clean.stop', label: 'Ferma pulizia', description: 'Stop cleaning', mutating: true, deviceTypes: ['robot'] },

  // Generic
  { id: 'state.get', label: 'Leggi stato', description: 'Snapshot stato dispositivo', mutating: false },
  { id: 'identify', label: 'Identifica', description: 'Blink/beep per trovare il device', mutating: true },
]

/** @type {Record<string, CapabilityDef>} */
export const CAPABILITY_BY_ID = Object.fromEntries(
  CAPABILITY_CATALOG.map((c) => [c.id, c]),
)

/**
 * Device type → default capability set (adapters may expose a subset).
 * @type {Record<string, string[]>}
 */
export const DEFAULT_CAPABILITIES_BY_TYPE = {
  light: ['power.get', 'power.set', 'power.toggle', 'brightness.get', 'brightness.set', 'color.set', 'state.get', 'identify'],
  thermostat: ['temperature.get', 'temperature.set', 'climate.mode.set', 'power.get', 'power.set', 'state.get'],
  smart_plug: ['power.get', 'power.set', 'power.toggle', 'energy.consumption.get', 'state.get'],
  photovoltaic: ['energy.production.get', 'energy.consumption.get', 'state.get'],
  battery: ['battery.level.get', 'battery.charge.start', 'battery.charge.stop', 'energy.production.get', 'energy.consumption.get', 'state.get'],
  ev_charger: ['ev.charge.start', 'ev.charge.stop', 'battery.level.get', 'energy.consumption.get', 'power.get', 'state.get'],
  camera: ['camera.stream.get', 'camera.snapshot', 'camera.record.start', 'state.get'],
  tv: ['power.get', 'power.set', 'media.play', 'media.pause', 'media.volume.set', 'media.source.set', 'state.get'],
  speaker: ['power.get', 'power.set', 'media.play', 'media.pause', 'media.volume.set', 'state.get'],
  router: ['network.status.get', 'network.reboot', 'state.get'],
  nas: ['storage.status.get', 'storage.share.list', 'state.get'],
  drone: ['battery.level.get', 'mobility.move', 'mobility.dock', 'camera.snapshot', 'state.get'],
  robot: ['battery.level.get', 'robot.clean.start', 'robot.clean.stop', 'mobility.dock', 'state.get'],
}

export const DEVICE_TYPES = /** @type {const} */ ([
  'light',
  'thermostat',
  'smart_plug',
  'photovoltaic',
  'battery',
  'ev_charger',
  'camera',
  'tv',
  'speaker',
  'router',
  'nas',
  'drone',
  'robot',
])

/**
 * @param {string} capabilityId
 */
export function getCapability(capabilityId) {
  return CAPABILITY_BY_ID[capabilityId] || null
}

/**
 * @param {string} deviceType
 * @returns {string[]}
 */
export function defaultCapabilitiesFor(deviceType) {
  return [...(DEFAULT_CAPABILITIES_BY_TYPE[deviceType] || ['state.get', 'power.get'])]
}
