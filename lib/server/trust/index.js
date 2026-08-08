/**
 * LAIfe Trust and Permission System
 *
 * Every external action has a trust level (low / medium / high).
 * Permissions are configurable per plugin.
 *
 * - Low: auto-execute if previously authorized; else one-time confirm
 * - Medium: confirm when appropriate
 * - High: always confirm
 */

export {
  TRUST_LEVELS,
  DEFAULT_ACTION_TRUST,
  CATEGORY_TRUST_OVERRIDES,
  resolveTrustLevel,
  isTrustLevel,
} from './levels.js'

export {
  setTrustStore,
  getTrustStore,
  grantPriorAuthorization,
  hasPriorAuthorization,
  revokeAuthorization,
  clearTrustStore,
} from './store.js'

export {
  setPluginTrustConfig,
  getPluginTrustConfig,
  clearPluginTrustConfig,
  evaluateTrustPolicy,
  rememberAuthorizationAfterConfirm,
  formatTrustDecisionBrief,
} from './policy.js'
