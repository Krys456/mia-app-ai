/**
 * Plugin Discovery & Reasoning helpers.
 *
 * The AI / reasoning engine discovers available plugins here.
 * This module never mutates conversation state and never imports the chat UI.
 */

import {
  listCapabilityPlugins,
  shortlistPluginIds,
  getCapabilityPlugin,
  toDiscoveryCard,
  registryStats,
} from './registry.js'

/**
 * @typedef {ReturnType<typeof toDiscoveryCard>} PluginDiscoveryCard
 */

/**
 * Automatically discover plugins available to the AI right now.
 *
 * @param {{
 *   includeDisabled?: boolean,
 *   requireAuth?: boolean,
 *   category?: string,
 *   limit?: number,
 * }} [opts]
 * @returns {PluginDiscoveryCard[]}
 */
export function discoverAvailablePlugins(opts = {}) {
  const requireAuth = opts.requireAuth !== false
  let list = listCapabilityPlugins({
    enabledOnly: !opts.includeDisabled,
    availableOnly: requireAuth,
  })

  if (opts.category) {
    const c = String(opts.category).toLowerCase()
    list = list.filter((p) => p.manifest.category.toLowerCase() === c)
  }

  // Stable order: priority desc, name asc
  list.sort((a, b) => {
    const pa = a.manifest.priority || 0
    const pb = b.manifest.priority || 0
    if (pb !== pa) return pb - pa
    return a.manifest.name.localeCompare(b.manifest.name)
  })

  const limit = Math.max(1, Math.min(opts.limit || 500, 1000))
  return list.slice(0, limit).map(toDiscoveryCard)
}

/**
 * Reasoning: decide which plugins are relevant for this user message.
 * Uses indexes first (scales to hundreds); optional full-scan fallback for
 * enabled plugins with a match() handler when shortlist is empty.
 *
 * @param {string} userMessage
 * @param {{
 *   limit?: number,
 *   hints?: { category?: string, action?: string, tags?: string[] },
 *   minScore?: number,
 * }} [opts]
 * @returns {Array<{
 *   pluginId: string,
 *   name: string,
 *   category: string,
 *   actionId: string,
 *   score: number,
 *   summary: string,
 *   card: PluginDiscoveryCard,
 * }>}
 */
export function reasonAboutPlugins(userMessage, opts = {}) {
  const text = String(userMessage || '').trim()
  if (!text) return []

  const minScore = opts.minScore ?? 0.55
  const limit = Math.max(1, Math.min(opts.limit || 8, 40))
  const shortlisted = shortlistPluginIds(text, opts.hints || {})

  /** @type {RegisteredLike[]} */
  let candidates = []

  if (shortlisted.size > 0) {
    for (const id of shortlisted) {
      const p = getCapabilityPlugin(id)
      if (p && p.enabled) candidates.push(p)
    }
  } else {
    // Indexed miss: only scan enabled plugins that expose match() — still bounded
    candidates = listCapabilityPlugins({ enabledOnly: true }).filter(
      (p) => typeof p.handlers?.match === 'function',
    )
  }

  /** @type {Array<{ pluginId: string, name: string, category: string, actionId: string, score: number, summary: string, card: PluginDiscoveryCard }>} */
  const ranked = []

  for (const plugin of candidates) {
    const card = toDiscoveryCard(plugin)
    if (!card.available && plugin.manifest.authentication !== 'none') {
      // Still allow discovery of disabled-auth plugins at lower score for "please connect"
    }

    let match = null
    if (typeof plugin.handlers?.match === 'function') {
      try {
        match = plugin.handlers.match(text)
      } catch {
        match = null
      }
    } else {
      // Manifest-only heuristic: keyword overlap with name/actions
      match = heuristicMatch(plugin, text)
    }

    if (!match || match.score < minScore) continue

    // Soft penalty if not authenticated when auth required
    let score = match.score
    if (plugin.manifest.authentication !== 'none' && !plugin.authenticated) {
      score *= 0.85
    }
    if (!plugin.enabled) continue

    ranked.push({
      pluginId: plugin.manifest.id,
      name: plugin.manifest.name,
      category: plugin.manifest.category,
      actionId: match.actionId,
      score,
      summary: match.summary,
      card,
    })
  }

  ranked.sort((a, b) => b.score - a.score)
  return ranked.slice(0, limit)
}

/**
 * @typedef {import('./types.js').RegisteredPlugin} RegisteredLike
 */

/**
 * @param {RegisteredLike} plugin
 * @param {string} text
 */
function heuristicMatch(plugin, text) {
  const lower = text.toLowerCase()
  const nameHit = plugin.manifest.name.toLowerCase().split(/\s+/).some((w) => w.length > 3 && lower.includes(w))
  /** @type {string|null} */
  let actionId = null
  for (const a of plugin.manifest.actions) {
    if (lower.includes(a.id.toLowerCase()) || lower.includes(a.description.toLowerCase().slice(0, 12))) {
      actionId = a.id
      break
    }
  }
  if (!nameHit && !actionId) {
    // category token
    const cat = plugin.manifest.category.toLowerCase()
    if (!lower.includes(cat) && !cat.split(/\s+/).some((w) => w.length > 3 && lower.includes(w))) {
      return null
    }
    actionId = plugin.manifest.actions[0]?.id || 'invoke'
  }
  return {
    actionId: actionId || plugin.manifest.actions[0]?.id || 'invoke',
    score: nameHit ? 0.64 : 0.56,
    summary: `${plugin.manifest.name}: ${actionId || 'invoke'}`,
    params: {},
  }
}

/**
 * Compact Writer / Cognitive brief — only when plugins are relevant.
 * Does not alter conversation intelligence; pure advisory context.
 *
 * @param {string} userMessage
 * @returns {string}
 */
export function formatPluginDiscoveryForReasoning(userMessage) {
  const suggestions = reasonAboutPlugins(userMessage, { limit: 5, minScore: 0.58 })
  if (suggestions.length === 0) return ''

  const lines = suggestions.map(
    (s, i) =>
      `${i + 1}. ${s.name} (${s.category}) → action «${s.actionId}» score=${s.score.toFixed(2)} — ${s.summary}` +
      `${s.card.available ? '' : ' [auth/connect required]'}`,
  )

  const stats = registryStats()

  return `══════════════════════════════════════
PLUGIN ARCHITECTURE → DISCOVERY (INVISIBILE)
══════════════════════════════════════
Plugin rilevanti per questo messaggio (motore di ragionamento):
${lines.join('\n')}

Registry: ${stats.plugins} plugin · ${stats.categories} categorie · ${stats.actions} actions indexate
Regole:
- Usa un plugin solo se migliora davvero l’esito
- Rispetta enable/disable e autenticazione
- I plugin NON alterano il motore di conversazione
- NON citare registry/plugin ids all’utente salvo che chieda integrazioni`
}

/**
 * Snapshot of all discovery cards (for settings / admin UI later).
 * @returns {PluginDiscoveryCard[]}
 */
export function listAllPluginCards() {
  return discoverAvailablePlugins({ includeDisabled: true, requireAuth: false, limit: 1000 })
}
