/**
 * LAIfe Universal Action Engine
 *
 * Safely perform real-world actions through external integrations.
 *
 * Workflow (invisible):
 * 1. Understand the user's intent
 * 2. Determine whether an external action is required
 * 3. Select the appropriate integration (plugin)
 * 4. Validate required permissions
 * 5. Ask for confirmation only when needed
 * 6. Execute the action (via abstract adapter — never platform-hardcoded)
 * 7. Verify the result
 * 8. Explain what happened
 *
 * Modular: every integration is a plugin. No Alexa/Gmail/Spotify logic here.
 */

import { getIntegrationAdapter } from './adapter.js'
import {
  listPlugins as listPluginsRaw,
  getPlugin,
  registerPlugin,
  unregisterPlugin,
} from './registry.js'
import { registerBuiltinPlugins } from './plugins.js'
import { getCapabilityPlugin, shortlistPluginIds } from '../plugins/registry.js'
import {
  evaluateTrustPolicy,
  rememberAuthorizationAfterConfirm,
  formatTrustDecisionBrief,
  resolveTrustLevel,
} from '../trust/index.js'

export { registerPlugin, unregisterPlugin, getPlugin } from './registry.js'
export { setIntegrationAdapter, getIntegrationAdapter, nullAdapter } from './adapter.js'

/**
 * @returns {import('./registry.js').ActionPlugin[]}
 */
export function listPlugins() {
  ensureBuiltins()
  return listPluginsRaw()
}

let builtinsReady = false

function ensureBuiltins() {
  if (!builtinsReady) {
    registerBuiltinPlugins()
    builtinsReady = true
  }
}

/**
 * @typedef {object} PermissionState
 * @property {string[]} granted
 * @property {string[]} missing
 * @property {boolean} ok
 */

/**
 * @typedef {object} ActionPlan
 * @property {boolean} actionRequired
 * @property {string | null} intent
 * @property {string | null} pluginId
 * @property {string | null} category
 * @property {string | null} capability
 * @property {string} actionSummary
 * @property {Record<string, unknown>} params
 * @property {PermissionState} permissions
 * @property {boolean} confirmationRequired
 * @property {boolean} confirmationGranted
 * @property {'low'|'medium'|'high'|null} trustLevel
 * @property {string} trustReason
 * @property {'idle'|'awaiting_confirmation'|'ready'|'executed'|'skipped'|'unavailable'|'denied'|'error'} phase
 * @property {{ status: string, message: string, data?: Record<string, unknown> } | null} execution
 * @property {{ ok: boolean, note: string } | null} verification
 * @property {string} explainBrief
 * @property {string} writerBrief
 * @property {string[]} reasons
 * @property {Array<{ pluginId: string, category: string, score: number, capability: string }>} candidates
 */

const CONFIRM_YES =
  /^(s[iì]|yes|yep|ok|okay|confermo|conferma|falle?|procedi|vai|do\s+it|go\s+ahead|please\s+do)([\s!,.]|$)/i

const CONFIRM_NO =
  /^(no|annulla|cancel|stop|non\s+farlo|don't|do\s+not)([\s!,.]|$)/i

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Granted permission scopes from input (future: user settings / OAuth).
 * @param {object} [input]
 * @returns {Set<string>}
 */
function resolveGrantedPermissions(input) {
  const granted = new Set()
  const list = input?.grantedPermissions
  if (Array.isArray(list)) {
    for (const p of list) {
      if (typeof p === 'string' && p.trim()) granted.add(p.trim())
    }
  }
  // Wildcard for local/dev when explicitly opted in
  if (input?.assumeAllPermissions === true) {
    granted.add('*')
  }
  return granted
}

/**
 * @param {string[]} required
 * @param {Set<string>} granted
 * @returns {PermissionState}
 */
function validatePermissions(required, granted) {
  const req = Array.isArray(required) ? required : []
  if (granted.has('*')) {
    return { granted: [...req], missing: [], ok: true }
  }
  const missing = req.filter((p) => !granted.has(p))
  const have = req.filter((p) => granted.has(p))
  // Until real OAuth exists: missing permissions ⇒ treat as "connector not authorized"
  // but do not invent execution. Still allow planning + confirmation UX.
  return {
    granted: have,
    missing,
    ok: missing.length === 0,
  }
}

/**
 * Rank plugin matches for the user message.
 * Uses Plugin Architecture indexes when available (scales to hundreds).
 * Disabled plugins (architecture) are skipped independently.
 * @param {string} userMessage
 */
function selectIntegration(userMessage) {
  ensureBuiltins()
  /** @type {import('./registry.js').ActionPlugin[]} */
  let pool = listPlugins()

  const ids = shortlistPluginIds(userMessage)
  if (ids.size > 0) {
    const filtered = pool.filter((p) => ids.has(p.id))
    if (filtered.length > 0) pool = filtered
  }

  /** @type {Array<{ plugin: import('./registry.js').ActionPlugin, match: import('./registry.js').PluginMatch }>} */
  const hits = []
  for (const plugin of pool) {
    try {
      const cap = getCapabilityPlugin(plugin.id)
      if (cap && cap.enabled === false) continue
      const match = plugin.match(userMessage)
      if (match && match.score > 0.5) hits.push({ plugin, match })
    } catch {
      // ignore broken plugins
    }
  }
  hits.sort((a, b) => b.match.score - a.match.score)
  return hits
}

/**
 * Infer a short intent label.
 * @param {import('./registry.js').PluginMatch | null} match
 * @param {string | null} category
 */
function understandIntent(match, category) {
  if (!match) return null
  return `${category || 'action'}:${match.capability}`
}

/**
 * @param {object} input
 * @returns {Promise<ActionPlan>}
 */
export async function analyzeAction(input) {
  ensureBuiltins()
  const userMessage = normalize(input?.userMessage)
  const granted = resolveGrantedPermissions(input)
  /** @type {string[]} */
  const reasons = []

  if (!userMessage) {
    return idlePlan('Messaggio vuoto.')
  }

  // Explicit cancel of a pending confirmation
  if (CONFIRM_NO.test(userMessage) && input?.pendingAction) {
    const pending = input.pendingAction
    return {
      ...idlePlan('Utente ha annullato l’azione.'),
      actionRequired: true,
      intent: pending.intent || null,
      pluginId: pending.pluginId || null,
      category: pending.category || null,
      capability: pending.capability || null,
      actionSummary: pending.actionSummary || '',
      trustLevel: pending.trustLevel || null,
      trustReason: 'cancelled_by_user',
      phase: 'skipped',
      confirmationRequired: true,
      confirmationGranted: false,
      explainBrief: 'Azione annullata su richiesta dell’utente. Niente è stato eseguito.',
      writerBrief:
        'UNIVERSAL ACTION ENGINE: l’utente ha annullato. Conferma brevemente che non hai eseguito nulla; non riprovare.',
      reasons: ['Conferma negata.'],
    }
  }

  // Resume pending action after confirmation
  if (CONFIRM_YES.test(userMessage) && input?.pendingAction?.pluginId) {
    const plugin = getPlugin(input.pendingAction.pluginId)
    if (!plugin) {
      return idlePlan('Azione in sospeso non trovata (plugin assente).')
    }
    const pending = input.pendingAction
    const trustLevel =
      pending.trustLevel ||
      resolveTrustLevel({
        pluginId: plugin.id,
        category: plugin.category,
        actionId: pending.capability,
      })
    const perms = validatePermissions(
      pending.permissions || plugin.requiredPermissions,
      granted,
    )
    reasons.push('Conferma affermativa ricevuta per azione in sospeso.')
    reasons.push(`Trust level: ${trustLevel}.`)

    // Record prior auth for low/medium (never for high)
    rememberAuthorizationAfterConfirm({
      pluginId: plugin.id,
      actionId: pending.capability,
      trustLevel,
    })

    const adapter = getIntegrationAdapter()
    let execution
    try {
      execution = await plugin.execute({
        capability: pending.capability,
        params: pending.params || {},
        actionSummary: pending.actionSummary || '',
        adapter,
      })
    } catch (err) {
      execution = {
        status: 'error',
        message: err instanceof Error ? err.message : 'Errore di esecuzione',
      }
    }
    const verification = plugin.verify(execution)

    return {
      actionRequired: true,
      intent: understandIntent(
        { capability: pending.capability, score: 1, actionSummary: pending.actionSummary, params: {} },
        plugin.category,
      ),
      pluginId: plugin.id,
      category: plugin.category,
      capability: pending.capability,
      actionSummary: pending.actionSummary || '',
      params: pending.params || {},
      permissions: perms,
      confirmationRequired: true,
      confirmationGranted: true,
      trustLevel,
      trustReason: 'User confirmed pending action.',
      phase:
        execution.status === 'ok'
          ? 'executed'
          : execution.status === 'unavailable'
            ? 'unavailable'
            : execution.status === 'denied'
              ? 'denied'
              : 'error',
      execution,
      verification,
      explainBrief: buildExplain(execution, verification, plugin.category, pending.actionSummary),
      writerBrief: buildWriterBrief({
        phase: execution.status === 'ok' ? 'executed' : execution.status,
        category: plugin.category,
        actionSummary: pending.actionSummary,
        execution,
        verification,
        confirmationRequired: false,
        trustLevel,
      }),
      reasons,
      candidates: [],
    }
  }

  const hits = selectIntegration(userMessage)
  const candidates = hits.slice(0, 5).map((h) => ({
    pluginId: h.plugin.id,
    category: h.plugin.category,
    score: h.match.score,
    capability: h.match.capability,
  }))

  if (hits.length === 0) {
    return {
      ...idlePlan('Nessuna azione esterna richiesta.'),
      candidates,
      reasons: ['Intent puramente conversazionale / informativo.'],
    }
  }

  const best = hits[0]
  // Ambiguous: two close high scores → ask rather than guess
  const ambiguous =
    hits.length > 1 && Math.abs(hits[0].match.score - hits[1].match.score) < 0.06

  if (ambiguous && hits[0].match.score < 0.85) {
    reasons.push('Più integrazioni plausibili a punteggio simile.')
    return {
      actionRequired: true,
      intent: understandIntent(best.match, best.plugin.category),
      pluginId: null,
      category: null,
      capability: null,
      actionSummary: '',
      params: {},
      permissions: { granted: [], missing: [], ok: true },
      confirmationRequired: false,
      confirmationGranted: false,
      trustLevel: null,
      trustReason: 'ambiguous_candidates',
      phase: 'idle',
      execution: null,
      verification: null,
      explainBrief: '',
      writerBrief: [
        'UNIVERSAL ACTION ENGINE: azione esterna plausibile ma ambigua.',
        `Candidati: ${candidates.map((c) => `${c.category}/${c.capability} (${c.score.toFixed(2)})`).join(' · ')}.`,
        'Chiedi UNA precisazione breve su quale azione/integrazione; non eseguire nulla.',
      ].join(' '),
      reasons,
      candidates,
    }
  }

  const plugin = best.plugin
  const match = best.match
  reasons.push(`Integrazione selezionata: ${plugin.category} / ${match.capability} (score=${match.score.toFixed(2)}).`)

  const trust = evaluateTrustPolicy({
    pluginId: plugin.id,
    category: plugin.category,
    actionId: match.capability,
    mutating: plugin.needsConfirmation(match.capability, match.params),
    defaultPermissions: match.permissions || plugin.requiredPermissions,
    explicitForce: /\b(senza\s+chiedere|just\s+do\s+it|esegui\s+subito|no\s+confirmation)\b/i.test(
      userMessage,
    ),
  })
  reasons.push(trust.reason)

  const required = trust.requiredPermissions.length
    ? trust.requiredPermissions
    : match.permissions || plugin.requiredPermissions
  const permissions = validatePermissions(required, granted)
  if (!permissions.ok) {
    reasons.push(`Permessi mancanti: ${permissions.missing.join(', ')}.`)
  }

  // High risk: never skip confirmation (even with "just do it")
  const explicitForce =
    trust.trustLevel !== 'high' &&
    /\b(senza\s+chiedere|just\s+do\s+it|esegui\s+subito|no\s+confirmation)\b/i.test(userMessage)

  const confirmationRequired = trust.confirmationRequired && !explicitForce
  const confirmationGranted = !confirmationRequired

  // Step 5: ask for confirmation when trust policy requires it
  if (confirmationRequired) {
    return {
      actionRequired: true,
      intent: understandIntent(match, plugin.category),
      pluginId: plugin.id,
      category: plugin.category,
      capability: match.capability,
      actionSummary: match.actionSummary,
      params: match.params,
      permissions,
      confirmationRequired: true,
      confirmationGranted: false,
      trustLevel: trust.trustLevel,
      trustReason: trust.reason,
      phase: 'awaiting_confirmation',
      execution: null,
      verification: null,
      explainBrief: '',
      writerBrief: [
        'UNIVERSAL ACTION ENGINE: azione esterna individuata — conferma richiesta (Trust & Permission).',
        `Categoria: ${plugin.category}. Azione: ${match.actionSummary}.`,
        formatTrustDecisionBrief(trust),
        permissions.ok
          ? 'Permessi: ok (o da verificare al connettore).'
          : `Permessi mancanti: ${permissions.missing.join(', ')} — spiega che serve collegare/autorizzare l’integrazione.`,
        trust.trustLevel === 'high'
          ? 'Rischio ALTO: conferma sempre obbligatoria — descrivi chiaramente l’impatto.'
          : trust.trustLevel === 'medium'
            ? 'Rischio MEDIO: chiedi conferma in modo naturale e breve.'
            : 'Rischio BASSO: una sola conferma per autorizzare le prossime esecuzioni automatiche.',
        'NON eseguire ancora. NON citare il motore.',
      ].join(' '),
      reasons: [...reasons, 'In attesa di conferma utente.'],
      candidates,
      pendingActionPayload: {
        pluginId: plugin.id,
        category: plugin.category,
        capability: match.capability,
        actionSummary: match.actionSummary,
        params: match.params,
        permissions: required,
        intent: understandIntent(match, plugin.category),
        trustLevel: trust.trustLevel,
      },
    }
  }

  // Steps 6–7: execute + verify (auto path — low/authorized or medium allowed)
  const adapter = getIntegrationAdapter()
  let execution
  try {
    execution = await plugin.execute({
      capability: match.capability,
      params: match.params,
      actionSummary: match.actionSummary,
      adapter,
    })
  } catch (err) {
    execution = {
      status: 'error',
      message: err instanceof Error ? err.message : 'Errore di esecuzione',
    }
  }
  const verification = plugin.verify(execution)
  const phase =
    execution.status === 'ok'
      ? 'executed'
      : execution.status === 'unavailable'
        ? 'unavailable'
        : execution.status === 'denied'
          ? 'denied'
          : 'error'

  return {
    actionRequired: true,
    intent: understandIntent(match, plugin.category),
    pluginId: plugin.id,
    category: plugin.category,
    capability: match.capability,
    actionSummary: match.actionSummary,
    params: match.params,
    permissions,
    confirmationRequired: false,
    confirmationGranted: true,
    trustLevel: trust.trustLevel,
    trustReason: trust.reason,
    phase,
    execution,
    verification,
    explainBrief: buildExplain(execution, verification, plugin.category, match.actionSummary),
    writerBrief: buildWriterBrief({
      phase,
      category: plugin.category,
      actionSummary: match.actionSummary,
      execution,
      verification,
      confirmationRequired: false,
      permissions,
      trustLevel: trust.trustLevel,
    }),
    reasons,
    candidates,
  }
}

/**
 * @param {string} reason
 * @returns {ActionPlan}
 */
function idlePlan(reason) {
  return {
    actionRequired: false,
    intent: null,
    pluginId: null,
    category: null,
    capability: null,
    actionSummary: '',
    params: {},
    permissions: { granted: [], missing: [], ok: true },
    confirmationRequired: false,
    confirmationGranted: false,
    trustLevel: null,
    trustReason: '',
    phase: 'idle',
    execution: null,
    verification: null,
    explainBrief: '',
    writerBrief: '',
    reasons: [reason],
    candidates: [],
  }
}

/**
 * @param {object} execution
 * @param {{ ok: boolean, note: string }} verification
 * @param {string} category
 * @param {string} actionSummary
 */
function buildExplain(execution, verification, category, actionSummary) {
  if (!execution) return ''
  if (execution.status === 'ok') {
    return `Ho eseguito «${actionSummary}» (${category}). Verifica: ${verification.note}`
  }
  if (execution.status === 'unavailable') {
    return `Volevo fare «${actionSummary}» (${category}), ma l’integrazione non è collegata: nessuna azione reale eseguita.`
  }
  if (execution.status === 'denied') {
    return `Permesso negato per «${actionSummary}» (${category}).`
  }
  return `Non sono riuscito a completare «${actionSummary}» (${category}): ${execution.message || 'errore'}.`
}

/**
 * @param {object} opts
 */
function buildWriterBrief(opts) {
  const { phase, category, actionSummary, execution, verification, permissions, trustLevel } = opts
  const lines = [
    `UNIVERSAL ACTION ENGINE — fase: ${phase}.`,
    trustLevel ? `Trust: ${trustLevel}.` : '',
    category ? `Integrazione: ${category}.` : '',
    actionSummary ? `Azione: ${actionSummary}.` : '',
  ]

  if (phase === 'executed') {
    lines.push(
      'Spiega in modo naturale cosa è stato fatto (senza jargon da API).',
      `Verifica: ${verification?.note || 'ok'}.`,
    )
  } else if (phase === 'unavailable') {
    lines.push(
      'L’integrazione non è collegata: dillo con chiarezza e offri di procedere a parole / quando sarà connessa.',
      'NON fingere che l’azione sia riuscita.',
      execution?.message ? `Dettaglio interno: ${execution.message}` : '',
    )
  } else if (phase === 'denied') {
    lines.push('Permesso negato: spiega cosa manca e come autorizzare, senza colpevolizzare.')
  } else if (phase === 'error') {
    lines.push('Errore di esecuzione: spiega il limite in modo semplice; proponi un’alternativa.')
  }

  if (permissions && !permissions.ok) {
    lines.push(`Permessi mancanti: ${permissions.missing.join(', ')}.`)
  }

  lines.push('NON citare Universal Action Engine, plugin, trust level o adapter all’utente.')
  return lines.filter(Boolean).join(' ')
}

/**
 * @param {ActionPlan | null | undefined} plan
 */
export function formatActionEngineForWriter(plan) {
  if (!plan?.actionRequired && !plan?.writerBrief) return ''

  const cand =
    plan.candidates?.length > 0
      ? plan.candidates
          .map((c) => `- ${c.category} / ${c.capability} (score ${c.score.toFixed(2)})`)
          .join('\n')
      : '- (nessuno)'

  return `══════════════════════════════════════
UNIVERSAL ACTION ENGINE (INVISIBILE)
══════════════════════════════════════
Workflow: intent → serve azione? → plugin → permessi → conferma? → execute → verify → explain
Action required: ${plan.actionRequired ? 'sì' : 'no'}
Intent: ${plan.intent || '—'}
Plugin: ${plan.pluginId || '—'} (${plan.category || '—'}) · capability: ${plan.capability || '—'}
Phase: ${plan.phase}
Trust: ${plan.trustLevel || '—'} ${plan.trustReason ? `(${plan.trustReason})` : ''}
Confirmation: ${plan.confirmationRequired ? (plan.confirmationGranted ? 'granted' : 'required') : 'not needed'}
Permissions: ${plan.permissions?.ok ? 'ok' : `missing: ${(plan.permissions?.missing || []).join(', ')}`}

Candidati:
${cand}

${plan.writerBrief || 'Nessuna azione esterna.'}

${plan.explainBrief ? `Spiegazione prevista: ${plan.explainBrief}` : ''}

Regole assolute:
- Mai hardcodare logica di piattaforma (Alexa, Gmail, Spotify, …) — solo plugin + adapter
- Mai fingere successi se l’azione non è stata eseguita
- Conferma secondo Trust & Permission: low (auto se autorizzato), medium (quando appropriato), high (sempre)
- NON citare questo motore all’utente`
}

/**
 * @param {object} input
 * @returns {Promise<{ plan: ActionPlan, context: string }>}
 */
export async function runUniversalActionEngine(input) {
  try {
    const plan = await analyzeAction(input)
    return {
      plan,
      context: formatActionEngineForWriter(plan),
    }
  } catch {
    return {
      plan: idlePlan('fallback'),
      context: '',
    }
  }
}
