/**
 * Universal Device Manager — capability-based reasoning.
 *
 * Match user intent to devices via capabilities (never brand APIs).
 */

import { getCapability } from './capabilities.js'

/**
 * @typedef {import('./registry.js').DeviceRecord} DeviceRecord
 */

/**
 * @typedef {object} DeviceIntentMatch
 * @property {DeviceRecord} device
 * @property {string} capability
 * @property {string} actionSummary
 * @property {Record<string, unknown>} params
 * @property {number} score
 * @property {string[]} reasons
 */

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} text
 * @param {DeviceRecord} device
 */
function deviceMentionScore(text, device) {
  let score = 0
  const t = text.toLowerCase()
  const name = String(device.name || '').toLowerCase()
  const room = String(device.room || '').toLowerCase()
  const type = String(device.type || '').toLowerCase()

  if (name && t.includes(name)) score += 0.35
  if (room && t.includes(room)) score += 0.15

  /** @type {Record<string, RegExp>} */
  const typePatterns = {
    light: /\b(luc[ei]|lampad|light|lights|bulb)\b/i,
    thermostat: /\b(termostato|thermostat|riscaldamento|heating|clima)\b/i,
    smart_plug: /\b(presa|smart\s*plug|plug|presa\s+smart)\b/i,
    photovoltaic: /\b(fotovoltaic\w*|photovoltaic|pannell[oi]|solare|pv)\b/i,
    battery: /\b(batteria\s+(domestica|casa|home)|home\s+batter(?:y|ies)|accumulo)\b/i,
    ev_charger: /\b(wallbox|ev\s*charg|colonnina|ricarica\s+(auto|ev|macchina))\b/i,
    camera: /\b(camera|telecamera|webcam|videosorvegl)\b/i,
    tv: /\b(tv|televisore|television)\b/i,
    speaker: /\b(speaker|altoparlante|casse|soundbar)\b/i,
    router: /\b(router|modem|wifi\s+box)\b/i,
    nas: /\b(nas|network\s+storage|synology|qnap)\b/i,
    drone: /\b(drone|uav)\b/i,
    robot: /\b(robot|aspirapolvere|vacuum|roomba)\b/i,
  }

  if (typePatterns[type]?.test(text)) score += 0.28

  // Room synonyms
  if (room === 'living' && /\b(soggiorno|salotto|living)\b/i.test(text)) score += 0.12
  if (room === 'kitchen' && /\b(cucina|kitchen)\b/i.test(text)) score += 0.12
  if (room === 'laundry' && /\b(lavanderia|laundry)\b/i.test(text)) score += 0.12

  return score
}

/**
 * Infer desired capability + params from natural language.
 * @param {string} text
 * @returns {{ capability: string, params: Record<string, unknown>, score: number, reasons: string[] }[]}
 */
export function inferCapabilityIntents(text) {
  const t = normalize(text)
  /** @type {{ capability: string, params: Record<string, unknown>, score: number, reasons: string[] }[]} */
  const out = []

  const on = /\b(accendi|turn\s+on|switch\s+on|power\s+on)\b/i.test(t)
  const off = /\b(spegni|turn\s+off|switch\s+off|power\s+off)\b/i.test(t)
  const powerDevice =
    /\b(luc[ei]|luce|lampad|light|lights|bulb|presa|plug|termostat|tv|televisore|speaker|casse|router|modem|nas|drone|robot|batter|fotovolt|wallbox|camera|telecamera)\b/i.test(
      t,
    )
  if ((on || off) && powerDevice) {
    out.push({
      capability: 'power.set',
      params: { power: on ? 'on' : 'off' },
      score: 0.86,
      reasons: [on ? 'power_on' : 'power_off'],
    })
  }

  const bright = t.match(/\b(?:luminosit[aà]|brightness|al)\s*(\d{1,3})\s*%?/i)
  if (bright || /\b(abbassa|alza).{0,20}\b(luce|luci|brightness)\b/i.test(t)) {
    out.push({
      capability: 'brightness.set',
      params: { brightness: bright ? Number(bright[1]) : /\babbassa\b/i.test(t) ? 30 : 80 },
      score: 0.7,
      reasons: ['brightness'],
    })
  }

  const temp = t.match(/\b(?:termostato|temperature|a)\s*(\d{2})\s*°?\s*c?\b/i)
  if (temp || /\b(imposta|set).{0,30}\b(termostato|temperature)\b/i.test(t)) {
    out.push({
      capability: 'temperature.set',
      params: { targetC: temp ? Number(temp[1]) : 21 },
      score: 0.74,
      reasons: ['temperature_set'],
    })
  }

  if (/\b(produzione|quanto\s+produce|solar\s+production|fotovoltaic\w*)\b/i.test(t)) {
    out.push({
      capability: 'energy.production.get',
      params: {},
      score: 0.7,
      reasons: ['pv_query'],
    })
  }

  if (/\b(stato\s+batteria|battery\s+level|percentuale\s+batteria|soc)\b/i.test(t)) {
    out.push({
      capability: 'battery.level.get',
      params: {},
      score: 0.68,
      reasons: ['battery_level'],
    })
  }

  if (/\b(avvia|start).{0,40}\b(carica|charging|wallbox|ev)\b/i.test(t) || /\b(carica\s+l['’]?auto|charge\s+the\s+car)\b/i.test(t)) {
    out.push({
      capability: 'ev.charge.start',
      params: {},
      score: 0.75,
      reasons: ['ev_charge_start'],
    })
  }
  if (/\b(ferma|stop).{0,40}\b(carica|charging|wallbox|ev)\b/i.test(t)) {
    out.push({
      capability: 'ev.charge.stop',
      params: {},
      score: 0.75,
      reasons: ['ev_charge_stop'],
    })
  }

  if (/\b(mostra|show|apri).{0,30}\b(camera|telecamera|stream)\b/i.test(t)) {
    out.push({
      capability: 'camera.stream.get',
      params: {},
      score: 0.7,
      reasons: ['camera_stream'],
    })
  }
  if (/\b(istantanea|snapshot|foto).{0,30}\b(camera|telecamera)?\b/i.test(t)) {
    out.push({
      capability: 'camera.snapshot',
      params: {},
      score: 0.68,
      reasons: ['camera_snapshot'],
    })
  }

  if (/\b(metti|play|riproduci)\b/i.test(t) && /\b(musica|tv|speaker|film)\b/i.test(t)) {
    out.push({
      capability: 'media.play',
      params: {},
      score: 0.65,
      reasons: ['media_play'],
    })
  }
  if (/\b(volume|alza|abbassa).{0,20}\b(volume|tv|speaker)\b/i.test(t) || /\bvolume\s+(\d{1,3})\b/i.test(t)) {
    const v = t.match(/\bvolume\s+(\d{1,3})\b/i)
    out.push({
      capability: 'media.volume.set',
      params: { volume: v ? Number(v[1]) : 20 },
      score: 0.66,
      reasons: ['volume'],
    })
  }

  if (/\b(riavvia|reboot|restart).{0,20}\b(router|modem)\b/i.test(t)) {
    out.push({
      capability: 'network.reboot',
      params: {},
      score: 0.78,
      reasons: ['router_reboot'],
    })
  }
  if (/\b(stato|status).{0,20}\b(nas|storage|disco)\b/i.test(t) || /\b(spazio\s+sul\s+nas)\b/i.test(t)) {
    out.push({
      capability: 'storage.status.get',
      params: {},
      score: 0.7,
      reasons: ['nas_status'],
    })
  }

  if (/\b(avvia|start).{0,30}\b(pulizia|clean|aspir)\b/i.test(t) || /\b(robot).{0,20}\b(pulisci|clean)\b/i.test(t)) {
    out.push({
      capability: 'robot.clean.start',
      params: {},
      score: 0.76,
      reasons: ['robot_clean'],
    })
  }
  if (/\b(rientra|dock|torna\s+alla\s+base|rincasa)\b/i.test(t)) {
    out.push({
      capability: 'mobility.dock',
      params: {},
      score: 0.7,
      reasons: ['dock'],
    })
  }

  if (/\b(stato|status|come\s+sta|is\s+.*\s+on)\b/i.test(t) && out.length === 0) {
    out.push({
      capability: 'state.get',
      params: {},
      score: 0.5,
      reasons: ['generic_state'],
    })
  }

  return out.sort((a, b) => b.score - a.score)
}

/**
 * Rank devices+capabilities for a user message.
 * @param {string} userMessage
 * @param {DeviceRecord[]} devices
 * @returns {DeviceIntentMatch[]}
 */
export function reasonAboutDevices(userMessage, devices) {
  const text = normalize(userMessage)
  if (!text || !Array.isArray(devices) || devices.length === 0) return []

  const intents = inferCapabilityIntents(text)
  if (intents.length === 0) return []

  /** @type {DeviceIntentMatch[]} */
  const matches = []

  for (const intent of intents) {
    for (const device of devices) {
      if (!device.capabilities?.includes(intent.capability)) continue
      const mention = deviceMentionScore(text, device)
      // Require some device relevance unless only one device has the capability
      const capableCount = devices.filter((d) => d.capabilities.includes(intent.capability)).length
      if (mention < 0.12 && capableCount > 1 && intent.score < 0.8) continue

      const cap = getCapability(intent.capability)
      const score = Math.min(0.98, intent.score * 0.65 + mention + (device.online ? 0.05 : 0))
      if (score < 0.45) continue

      matches.push({
        device,
        capability: intent.capability,
        actionSummary: `${cap?.label || intent.capability}: ${device.name}`,
        params: { ...intent.params, deviceId: device.id, deviceName: device.name },
        score,
        reasons: [...intent.reasons, `device:${device.id}`, `type:${device.type}`],
      })
    }
  }

  return matches.sort((a, b) => b.score - a.score)
}

/**
 * Format inventory for Writer / reasoning (capability-centric).
 * @param {DeviceRecord[]} devices
 * @param {DeviceIntentMatch[]} [matches]
 */
export function formatDeviceManagerForWriter(devices, matches = []) {
  const byType = new Map()
  for (const d of devices) {
    const list = byType.get(d.type) || []
    list.push(d)
    byType.set(d.type, list)
  }

  const inventory = [...byType.entries()]
    .map(([type, list]) => {
      const lines = list
        .slice(0, 4)
        .map(
          (d) =>
            `  - ${d.name} (${d.id}) caps=[${d.capabilities.slice(0, 6).join(', ')}${d.capabilities.length > 6 ? ', …' : ''}] online=${d.online}`,
        )
        .join('\n')
      return `${type}:\n${lines}`
    })
    .join('\n')

  const matchLines =
    matches.length > 0
      ? matches
          .slice(0, 5)
          .map(
            (m) =>
              `- ${m.actionSummary} · capability=${m.capability} · score=${m.score.toFixed(2)} · adapter=${m.device.adapterId}`,
          )
          .join('\n')
      : '- (nessun match capability ad alta confidenza)'

  return `══════════════════════════════════════
UNIVERSAL DEVICE MANAGER (INVISIBILE)
══════════════════════════════════════
Ragiona per CAPABILITY, non per brand/API.
Nuovi dispositivi = nuovo adapter plugin.

Inventory (capability surface):
${inventory || '- (vuoto)'}

Intent matches:
${matchLines}

Se proponi un’azione: cita dispositivo + capability in linguaggio naturale.
Se l’adapter non è connesso: dillo chiaramente, non fingere successo.
Non citare questo blocco.`.trim()
}
