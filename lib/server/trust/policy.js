/**
 * Trust & Permission policy engine.
 *
 * Rules:
 * - Low risk  → execute automatically if previously authorized; else one-time auth confirm
 * - Medium    → request confirmation when appropriate (default: confirm unless plugin opts out)
 * - High      → ALWAYS request confirmation (never auto)
 *
 * Permissions are configurable per plugin via setPluginTrustConfig.
 */

import { resolveTrustLevel, isTrustLevel } from './levels.js'
import { hasPriorAuthorization, grantPriorAuthorization } from './store.js'

/**
 * @typedef {import('./levels.js').TrustLevel} TrustLevel
 */

/**
 * @typedef {object} PluginTrustConfig
 * @property {Record<string, TrustLevel>} [actionTrust]  Per-action overrides
 * @property {boolean} [autoLowIfAuthorized]  default true
 * @property {'always'|'unless_authorized'|'never'} [mediumConfirm]  default 'always'
 * @property {'always'} [highConfirm]  always 'always' — high cannot be relaxed
 * @property {string[]} [permissions]  Plugin-level permission scopes (configurable)
 * @property {Record<string, string[]>} [actionPermissions]  Per-action permission overrides
 */

/** @type {Map<string, PluginTrustConfig>} */
const configs = new Map()

/**
 * Configure trust/permissions for a plugin (merge).
 * @param {string} pluginId
 * @param {PluginTrustConfig} config
 */
export function setPluginTrustConfig(pluginId, config) {
  const prev = configs.get(pluginId) || {}
  configs.set(pluginId, {
    ...prev,
    ...config,
    actionTrust: { ...(prev.actionTrust || {}), ...(config.actionTrust || {}) },
    actionPermissions: {
      ...(prev.actionPermissions || {}),
      ...(config.actionPermissions || {}),
    },
    permissions: config.permissions
      ? [...config.permissions]
      : prev.permissions
        ? [...prev.permissions]
        : undefined,
  })
}

/**
 * @param {string} pluginId
 * @returns {PluginTrustConfig}
 */
export function getPluginTrustConfig(pluginId) {
  return configs.get(pluginId) || {}
}

/**
 * @param {string} pluginId
 */
export function clearPluginTrustConfig(pluginId) {
  if (pluginId) configs.delete(pluginId)
  else configs.clear()
}

/**
 * @typedef {object} TrustDecision
 * @property {TrustLevel} trustLevel
 * @property {boolean} confirmationRequired
 * @property {boolean} canAutoExecute
 * @property {boolean} previouslyAuthorized
 * @property {string[]} requiredPermissions
 * @property {string} reason
 * @property {'auto'|'confirm_once'|'confirm_always'} policy
 */

/**
 * Decide confirmation / auto-exec for an external action.
 *
 * @param {object} input
 * @param {string} input.pluginId
 * @param {string} [input.category]
 * @param {string} input.actionId
 * @param {boolean} [input.mutating]
 * @param {string[]} [input.defaultPermissions]
 * @param {boolean} [input.explicitForce]  User said "just do it" — still blocked for high
 * @returns {TrustDecision}
 */
export function evaluateTrustPolicy(input) {
  const pluginId = input.pluginId
  const actionId = String(input.actionId || '').toLowerCase()
  const cfg = getPluginTrustConfig(pluginId)

  const trustLevel = resolveTrustLevel({
    pluginId,
    category: input.category,
    actionId,
    actionTrust: cfg.actionTrust,
    mutating: input.mutating,
  })

  const requiredPermissions =
    cfg.actionPermissions?.[actionId] ||
    cfg.actionPermissions?.[input.actionId] ||
    cfg.permissions ||
    input.defaultPermissions ||
    []

  const previouslyAuthorized = hasPriorAuthorization(pluginId, actionId)
  const autoLow = cfg.autoLowIfAuthorized !== false
  const mediumMode = cfg.mediumConfirm || 'always'
  // highConfirm is always always — ignore attempts to relax
  const highMode = 'always'

  if (trustLevel === 'high') {
    return {
      trustLevel,
      confirmationRequired: true,
      canAutoExecute: false,
      previouslyAuthorized,
      requiredPermissions: [...requiredPermissions],
      reason: 'High-risk action — confirmation always required.',
      policy: 'confirm_always',
    }
  }

  if (trustLevel === 'low') {
    if (autoLow && previouslyAuthorized) {
      return {
        trustLevel,
        confirmationRequired: false,
        canAutoExecute: true,
        previouslyAuthorized: true,
        requiredPermissions: [...requiredPermissions],
        reason: 'Low-risk and previously authorized — auto-execute.',
        policy: 'auto',
      }
    }
    // First time: one-time confirmation to establish authorization
    return {
      trustLevel,
      confirmationRequired: true,
      canAutoExecute: false,
      previouslyAuthorized: false,
      requiredPermissions: [...requiredPermissions],
      reason: 'Low-risk but not yet authorized — one-time confirmation.',
      policy: 'confirm_once',
    }
  }

  // medium
  if (mediumMode === 'never') {
    return {
      trustLevel,
      confirmationRequired: false,
      canAutoExecute: true,
      previouslyAuthorized,
      requiredPermissions: [...requiredPermissions],
      reason: 'Medium-risk with plugin config mediumConfirm=never.',
      policy: 'auto',
    }
  }
  if (mediumMode === 'unless_authorized' && previouslyAuthorized) {
    return {
      trustLevel,
      confirmationRequired: false,
      canAutoExecute: true,
      previouslyAuthorized: true,
      requiredPermissions: [...requiredPermissions],
      reason: 'Medium-risk previously authorized — auto-execute (plugin config).',
      policy: 'auto',
    }
  }

  // explicitForce cannot skip high (already handled); for medium it can proceed after grant
  if (input.explicitForce && mediumMode !== 'always') {
    return {
      trustLevel,
      confirmationRequired: false,
      canAutoExecute: true,
      previouslyAuthorized,
      requiredPermissions: [...requiredPermissions],
      reason: 'Medium-risk with explicit user force.',
      policy: 'auto',
    }
  }

  return {
    trustLevel,
    confirmationRequired: true,
    canAutoExecute: false,
    previouslyAuthorized,
    requiredPermissions: [...requiredPermissions],
    reason:
      mediumMode === 'unless_authorized'
        ? 'Medium-risk — confirmation appropriate until authorized.'
        : 'Medium-risk — confirmation requested.',
    policy: previouslyAuthorized ? 'confirm_always' : 'confirm_once',
  }
}

/**
 * After user confirms, record prior authorization (low/medium only).
 * High-risk confirmations do NOT create lasting auto-auth.
 *
 * @param {object} input
 * @param {string} input.pluginId
 * @param {string} input.actionId
 * @param {TrustLevel} input.trustLevel
 * @param {string} [input.scope]
 */
export function rememberAuthorizationAfterConfirm(input) {
  if (!isTrustLevel(input.trustLevel) || input.trustLevel === 'high') return false
  grantPriorAuthorization(input.pluginId, input.actionId, input.trustLevel, input.scope)
  return true
}

/**
 * Writer-facing trust brief fragment.
 * @param {TrustDecision} decision
 */
export function formatTrustDecisionBrief(decision) {
  return [
    `Trust level: ${decision.trustLevel}.`,
    `Policy: ${decision.policy}.`,
    decision.reason,
    decision.previouslyAuthorized ? 'Prior authorization: yes.' : 'Prior authorization: no.',
    decision.confirmationRequired
      ? 'Chiedi conferma all’utente prima di eseguire.'
      : 'Puoi procedere senza nuova conferma (se permessi/connettore ok).',
  ].join(' ')
}
