/**
 * Universal Action Engine — category plugins.
 *
 * Each plugin is category-level (Smart Home, Calendar, …), not a brand.
 * Platform connectors (Alexa, Gmail, Spotify, …) must plug in via the adapter —
 * never inside these match/execute handlers.
 */

import { registerPlugin } from './registry.js'

/**
 * @param {object} def
 * @param {string} def.id
 * @param {string} def.category
 * @param {string[]} def.capabilities
 * @param {string[]} def.requiredPermissions
 * @param {RegExp} def.pattern
 * @param {(text: string) => { capability: string, params: Record<string, unknown>, actionSummary: string } | null} [def.resolve]
 * @param {(capability: string) => boolean} [def.confirmIf]
 */
function defineCategoryPlugin(def) {
  const {
    id,
    category,
    capabilities,
    requiredPermissions,
    pattern,
    resolve,
    confirmIf,
  } = def

  return {
    id,
    category,
    version: '1.0.0',
    capabilities,
    requiredPermissions,
    /**
     * @param {string} userMessage
     */
    match(userMessage) {
      const text = String(userMessage || '').trim()
      if (!text || !pattern.test(text)) return null

      const resolved =
        typeof resolve === 'function'
          ? resolve(text)
          : {
              capability: capabilities[0] || 'invoke',
              params: { raw: text },
              actionSummary: `${category}: ${text.slice(0, 80)}`,
            }

      if (!resolved) return null

      // Score: pattern hit + action verbs boost
      let score = 0.62
      if (/\b(accendi|spegni|imposta|crea|aggiungi|invia|apri|chiudi|avvia|ferma|prenota|cancella|elimina|ricordami|turn\s+on|turn\s+off|set|create|send|play|pause|navigate|book)\b/i.test(text)) {
        score += 0.2
      }
      if (/\b(per\s+favore|please|ora|adesso|now)\b/i.test(text)) score += 0.05
      score = Math.min(0.98, score)

      return {
        score,
        capability: resolved.capability,
        actionSummary: resolved.actionSummary,
        params: resolved.params || {},
        permissions: requiredPermissions,
      }
    },
    needsConfirmation(capability) {
      if (typeof confirmIf === 'function') return confirmIf(capability)
      // Mutating capabilities require confirmation by default
      return /^(create|update|delete|send|set|start|stop|play|purchase|share|move|write|unlock|lock|open_garage|spend|pay|transfer)/i.test(
        capability,
      )
    },
    /**
     * @param {{ capability: string, params: Record<string, unknown>, actionSummary: string, adapter: import('./adapter.js').IntegrationAdapter }} ctx
     */
    async execute(ctx) {
      const { adapter, capability, params, actionSummary } = ctx
      if (!adapter.isConnected(id)) {
        return {
          status: 'unavailable',
          message: `Integrazione «${category}» non collegata. Nessuna azione eseguita sul mondo reale.`,
          data: { capability, params },
        }
      }
      return adapter.invoke({
        pluginId: id,
        category,
        capability,
        params,
        actionSummary,
      })
    },
    /**
     * @param {import('./adapter.js').AdapterResult} result
     */
    verify(result) {
      if (!result) return { ok: false, note: 'Nessun risultato da verificare.' }
      if (result.status === 'ok') {
        return { ok: true, note: 'Azione confermata dall’adapter.' }
      }
      if (result.status === 'unavailable') {
        return { ok: false, note: 'Nessun connettore: azione non eseguita (sicuro).' }
      }
      if (result.status === 'denied') {
        return { ok: false, note: 'Permesso negato dal connettore.' }
      }
      return { ok: false, note: result.message || 'Esito non verificabile.' }
    },
  }
}

/**
 * Extract a short free-text payload after a keyword.
 * @param {string} text
 * @param {RegExp} re
 */
function after(re, text) {
  const m = String(text).match(re)
  return m?.[1] ? m[1].trim() : ''
}

/** Register all built-in category plugins (idempotent if called once at boot). */
export function registerBuiltinPlugins() {
  const builtins = [
    defineCategoryPlugin({
      id: 'smart_home',
      category: 'Smart Home',
      capabilities: ['set', 'query', 'scene', 'unlock', 'open_garage'],
      requiredPermissions: ['smarthome.control'],
      pattern:
        /\b(accendi|spegni|dimmer|termostato|luce|luci|lampad[ae]|presa|smart\s*home|homekit|hue|porta|door|garage|sblocca|unlock|apri\s+(la\s+)?porta|apri\s+(il\s+)?garage|open\s+(the\s+)?(door|garage))\b/i,
      resolve(text) {
        const garage = /\b(garage|cancelletto|cancello\s+garage)\b/i.test(text)
        const unlockDoor =
          /\b(sblocca|unlock|apri)\b/i.test(text) &&
          /\b(porta|door|serratura|lock)\b/i.test(text)
        if (garage && /\b(apri|open|aprire)\b/i.test(text)) {
          return {
            capability: 'open_garage',
            params: { raw: text },
            actionSummary: 'Aprire il garage',
          }
        }
        if (unlockDoor || (/\b(sblocca|unlock)\b/i.test(text) && /\b(porta|door)\b/i.test(text))) {
          return {
            capability: 'unlock',
            params: { raw: text },
            actionSummary: 'Sbloccare la porta',
          }
        }
        const on = /\b(accendi|turn\s+on|accendere)\b/i.test(text)
        const off = /\b(spegni|turn\s+off|spegnere)\b/i.test(text)
        const device =
          after(/\b(?:luce|luci|lampad[ae]|termostato|presa)\s+([A-Za-z0-9À-ÿ'’\-\s]{1,40})/i, text) ||
          'dispositivo'
        return {
          capability: on || off ? 'set' : 'query',
          params: { device, power: on ? 'on' : off ? 'off' : 'unknown', raw: text },
          actionSummary: on
            ? `Accendere ${device}`
            : off
              ? `Spegnere ${device}`
              : `Controllare Smart Home: ${device}`,
        }
      },
      confirmIf: (cap) =>
        cap === 'set' || cap === 'scene' || cap === 'unlock' || cap === 'open_garage',
    }),

    defineCategoryPlugin({
      id: 'calendar',
      category: 'Calendar',
      capabilities: ['create', 'list', 'update', 'delete'],
      requiredPermissions: ['calendar.write', 'calendar.read'],
      pattern:
        /\b(calendario|appuntament[oi]|riunion[ei]|meeting|agenda|schedule|prenota|book\s+a\s+meeting|crea\s+evento|read\s+(my\s+)?calendar|consulta\s+(il\s+)?calendario)\b/i,
      resolve(text) {
        const del = /\b(elimina|cancella|delete|rimuovi)\b/i.test(text)
        const create = /\b(crea|aggiungi|prenota|book|schedule|nuovo\s+evento)\b/i.test(text)
        const title =
          after(/\b(?:evento|riunione|meeting|appuntamento)\s+([^.!?]{3,80})/i, text) ||
          text.slice(0, 80)
        const capability = del ? 'delete' : create ? 'create' : 'list'
        return {
          capability,
          params: { title, raw: text },
          actionSummary:
            capability === 'create'
              ? `Creare evento: ${title}`
              : capability === 'delete'
                ? `Eliminare evento: ${title}`
                : 'Consultare calendario',
        }
      },
      confirmIf: (cap) => cap === 'create' || cap === 'update' || cap === 'delete',
    }),

    defineCategoryPlugin({
      id: 'email',
      category: 'Email',
      capabilities: ['send', 'draft', 'list'],
      requiredPermissions: ['email.send', 'email.read'],
      pattern: /\b(email|e-mail|mail|invia\s+una\s+mail|send\s+(an\s+)?email|scrivi\s+una\s+mail)\b/i,
      resolve(text) {
        const send = /\b(invia|send|manda)\b/i.test(text)
        return {
          capability: send ? 'send' : 'draft',
          params: { raw: text },
          actionSummary: send ? 'Inviare email' : 'Preparare bozza email',
        }
      },
      confirmIf: (cap) => cap === 'send',
    }),

    defineCategoryPlugin({
      id: 'notes',
      category: 'Notes',
      capabilities: ['create', 'append', 'list'],
      requiredPermissions: ['notes.write'],
      pattern: /\b(nota|note|appunti|salva\s+in\s+note|take\s+a\s+note|create\s+a\s+note)\b/i,
      resolve(text) {
        const body =
          after(/\b(?:nota|note|appunti)[:\s]+([^.!?]{3,200})/i, text) || text.slice(0, 120)
        return {
          capability: 'create',
          params: { body, raw: text },
          actionSummary: `Salvare nota: ${body.slice(0, 60)}`,
        }
      },
    }),

    defineCategoryPlugin({
      id: 'tasks',
      category: 'Tasks',
      capabilities: ['create', 'complete', 'list'],
      requiredPermissions: ['tasks.write'],
      pattern:
        /\b(task|todo|to-do|compit[oi]|promemoria|ricordami|aggiungi\s+alla\s+lista|remind\s+me|create\s+a\s+task)\b/i,
      resolve(text) {
        const title =
          after(/\b(?:ricordami(?:\s+di)?|remind\s+me\s+to|task|todo)[:\s]+([^.!?]{3,120})/i, text) ||
          text.slice(0, 100)
        return {
          capability: 'create',
          params: { title, raw: text },
          actionSummary: `Creare task: ${title}`,
        }
      },
    }),

    defineCategoryPlugin({
      id: 'files',
      category: 'File Management',
      capabilities: ['list', 'move', 'delete', 'rename'],
      requiredPermissions: ['files.manage'],
      pattern:
        /\b(file|cartella|folder|rinomina|sposta|elimina\s+il\s+file|delete\s+file|rename\s+file)\b/i,
      resolve(text) {
        const del = /\b(elimina|cancella|delete)\b/i.test(text)
        const move = /\b(sposta|move)\b/i.test(text)
        return {
          capability: del ? 'delete' : move ? 'move' : 'list',
          params: { raw: text },
          actionSummary: del ? 'Eliminare file' : move ? 'Spostare file' : 'Gestire file',
        }
      },
      confirmIf: (cap) => cap === 'delete' || cap === 'move',
    }),

    defineCategoryPlugin({
      id: 'cloud_storage',
      category: 'Cloud Storage',
      capabilities: ['upload', 'share', 'list'],
      requiredPermissions: ['cloud.write', 'cloud.read'],
      pattern:
        /\b(drive|dropbox|onedrive|icloud|cloud\s+storage|carica\s+su\s+cloud|upload\s+to\s+cloud|condividi\s+file)\b/i,
      resolve(text) {
        const share = /\b(condividi|share)\b/i.test(text)
        const upload = /\b(carica|upload)\b/i.test(text)
        return {
          capability: share ? 'share' : upload ? 'upload' : 'list',
          params: { raw: text },
          actionSummary: share ? 'Condividere file cloud' : upload ? 'Caricare su cloud' : 'Elencare cloud',
        }
      },
    }),

    defineCategoryPlugin({
      id: 'music',
      category: 'Music',
      capabilities: ['play', 'pause', 'skip', 'queue'],
      requiredPermissions: ['music.control'],
      pattern:
        /\b(musica|canzone|playlist|riproduci|metti\s+su|play\s+(music|song)|spotify|ascolta)\b/i,
      resolve(text) {
        const pause = /\b(pausa|pause|stop)\b/i.test(text)
        const track =
          after(/\b(?:riproduci|play|ascolta|metti)\s+([^.!?]{2,80})/i, text) || 'musica'
        return {
          capability: pause ? 'pause' : 'play',
          params: { track, raw: text },
          actionSummary: pause ? 'Mettere in pausa la musica' : `Riprodurre: ${track}`,
        }
      },
      confirmIf: () => false, // play/pause is low-risk
    }),

    defineCategoryPlugin({
      id: 'maps',
      category: 'Maps',
      capabilities: ['navigate', 'search', 'eta'],
      requiredPermissions: ['maps.navigate'],
      pattern:
        /\b(mappe|naviga|indicazioni|percorso|directions|navigate\s+to|portami\s+a|quanto\s+ci\s+vuole)\b/i,
      resolve(text) {
        const dest =
          after(/\b(?:naviga(?:re)?\s+(?:verso|a)|portami\s+a|navigate\s+to|direzione(?:\s+per)?)\s+([^.!?]{2,80})/i, text) ||
          after(/\b(?:verso|a)\s+([A-Za-zÀ-ÿ0-9'’\-\s]{2,60})$/i, text) ||
          'destinazione'
        return {
          capability: 'navigate',
          params: { destination: dest, raw: text },
          actionSummary: `Navigare verso ${dest}`,
        }
      },
      confirmIf: () => false,
    }),

    defineCategoryPlugin({
      id: 'messaging',
      category: 'Messaging',
      capabilities: ['send', 'draft'],
      requiredPermissions: ['messaging.send'],
      pattern:
        /\b(messaggio|whatsapp|telegram|sms|invia\s+un\s+messaggio|send\s+(a\s+)?(message|sms|text))\b/i,
      resolve(text) {
        const send = /\b(invia|manda|send)\b/i.test(text)
        return {
          capability: send ? 'send' : 'draft',
          params: { raw: text },
          actionSummary: send ? 'Inviare messaggio' : 'Preparare messaggio',
        }
      },
      confirmIf: (cap) => cap === 'send',
    }),

    defineCategoryPlugin({
      id: 'weather_action',
      category: 'Weather',
      capabilities: ['query', 'alert'],
      requiredPermissions: ['weather.read'],
      pattern:
        /\b(meteo|weather|temperatura|allerta\s+meteo|weather\s+alert|che\s+tempo\s+fa|read\s+(the\s+)?weather|avvisami\s+se\s+piove|notify\s+me\s+(?:if|when)\s+.*\b(rain|snow|storm))\b/i,
      resolve(text) {
        const alert =
          /\b(allerta|alert|avvisami|notify)\b/i.test(text) ||
          /\b(avvisami\s+se\s+piove)\b/i.test(text)
        return {
          capability: alert ? 'alert' : 'query',
          params: { raw: text },
          actionSummary: alert ? 'Impostare avviso meteo' : 'Consultare meteo',
        }
      },
      confirmIf: (cap) => cap === 'alert',
    }),

    defineCategoryPlugin({
      id: 'iot',
      category: 'IoT devices',
      capabilities: ['set', 'query'],
      requiredPermissions: ['iot.control'],
      pattern:
        /\b(iot|sensore|sensor|attuatore|dispositivo\s+connesso|connected\s+device|mqtt)\b/i,
      resolve(text) {
        const set = /\b(imposta|set|attiva|disattiva)\b/i.test(text)
        return {
          capability: set ? 'set' : 'query',
          params: { raw: text },
          actionSummary: set ? 'Controllare dispositivo IoT' : 'Leggere sensore IoT',
        }
      },
    }),

    defineCategoryPlugin({
      id: 'home_automation',
      category: 'Home Automation',
      capabilities: ['run_scene', 'schedule'],
      requiredPermissions: ['automation.control'],
      pattern:
        /\b(automazione|scena|routine|home\s+automation|avvia\s+la\s+scena|run\s+(the\s+)?scene|buongiorno\s+routine)\b/i,
      resolve(text) {
        const scene =
          after(/\b(?:scena|routine|scene)\s+([A-Za-z0-9À-ÿ'’\-\s]{2,40})/i, text) || 'scena'
        return {
          capability: 'run_scene',
          params: { scene, raw: text },
          actionSummary: `Avviare automazione: ${scene}`,
        }
      },
    }),

    defineCategoryPlugin({
      id: 'vehicles',
      category: 'Vehicles',
      capabilities: ['lock', 'unlock', 'climate', 'locate', 'charge'],
      requiredPermissions: ['vehicle.control'],
      pattern:
        /\b(auto|macchina|veicolo|vehicle|tesla|sblocca\s+l['’]?auto|apri\s+l['’]?auto|clima\s+auto|car\s+lock|precondition)\b/i,
      resolve(text) {
        const unlock = /\b(sblocca|unlock|apri)\b/i.test(text)
        const lock = /\b(blocca|lock|chiudi)\b/i.test(text)
        const climate = /\b(clima|precondition|riscalda|raffresca)\b/i.test(text)
        const capability = unlock ? 'unlock' : lock ? 'lock' : climate ? 'climate' : 'locate'
        return {
          capability,
          params: { raw: text },
          actionSummary: `Azione veicolo: ${capability}`,
        }
      },
      confirmIf: (cap) => cap === 'unlock' || cap === 'lock' || cap === 'climate',
    }),

    defineCategoryPlugin({
      id: 'energy',
      category: 'Energy Systems',
      capabilities: ['set', 'query', 'optimize'],
      requiredPermissions: ['energy.control'],
      pattern:
        /\b(energia|batteria\s+casa|fotovoltaico|solar|powerwall|consumi\s+elettrici|energy\s+system|modalit[aà]\s+risparmio)\b/i,
      resolve(text) {
        const set = /\b(imposta|attiva|set|risparmio|optimize)\b/i.test(text)
        return {
          capability: set ? 'set' : 'query',
          params: { raw: text },
          actionSummary: set ? 'Regolare sistema energetico' : 'Consultare energia',
        }
      },
    }),

    defineCategoryPlugin({
      id: 'payments',
      category: 'Payments',
      capabilities: ['spend', 'purchase', 'transfer'],
      requiredPermissions: ['payments.spend'],
      pattern:
        /\b(paga|pagamento|purchase|compra|spend[ei]|trasferisci\s+soldi|send\s+money|pay\s+|spend\s+money|bonifico)\b/i,
      resolve(text) {
        const transfer = /\b(trasferisci|transfer|bonifico|send\s+money)\b/i.test(text)
        const purchase = /\b(compra|purchase|acquista)\b/i.test(text)
        const capability = transfer ? 'transfer' : purchase ? 'purchase' : 'spend'
        return {
          capability,
          params: { raw: text },
          actionSummary:
            capability === 'transfer'
              ? 'Trasferire denaro'
              : capability === 'purchase'
                ? 'Effettuare un acquisto'
                : 'Spendere denaro',
        }
      },
      confirmIf: () => true,
    }),
  ]

  for (const plugin of builtins) {
    registerPlugin(plugin)
  }

  return builtins.length
}
