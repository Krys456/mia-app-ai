/**
 * LAIfe V2 — Experimental Runtime Profile (Sprint 1)
 *
 * Named flag bundles for Planner principle toggles.
 * No Writer / Runtime architecture / API wiring here.
 *
 * production  — all validated principles off (default)
 * experimental — exploration + learning + planning on
 *
 * Left disabled (no flags yet / not validated):
 * debugging, support, brainstorming, decision, conversation
 */

/** @typedef {'production'|'experimental'} RuntimeProfileName */

/**
 * @typedef {object} RuntimeProfileFlags
 * @property {boolean} useExplorationPrinciples
 * @property {boolean} useLearningPrinciples
 * @property {boolean} usePlanningPrinciples
 */

/**
 * @typedef {RuntimeProfileFlags & { name?: string }} RuntimeProfile
 */

/** @type {Readonly<Record<RuntimeProfileName, RuntimeProfileFlags>>} */
export const RuntimeProfiles = Object.freeze({
  production: Object.freeze({
    useExplorationPrinciples: false,
    useLearningPrinciples: false,
    usePlanningPrinciples: false,
  }),
  experimental: Object.freeze({
    useExplorationPrinciples: true,
    useLearningPrinciples: true,
    usePlanningPrinciples: true,
  }),
})

/** Default profile — no principle behavior change. */
export const DEFAULT_RUNTIME_PROFILE = /** @type {RuntimeProfileName} */ ('production')

/**
 * Resolve a profile name or partial flag object into concrete principle flags.
 * Unknown names fall back to production.
 *
 * @param {RuntimeProfileName|string|Partial<RuntimeProfileFlags>|null|undefined} profile
 * @returns {RuntimeProfileFlags & { name: string }}
 */
export function resolveRuntimeProfile(profile) {
  if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
    const src = /** @type {Partial<RuntimeProfileFlags>} */ (profile)
    return {
      name: 'custom',
      useExplorationPrinciples: src.useExplorationPrinciples === true,
      useLearningPrinciples: src.useLearningPrinciples === true,
      usePlanningPrinciples: src.usePlanningPrinciples === true,
    }
  }

  const key = typeof profile === 'string' ? profile.trim().toLowerCase() : ''
  if (key && Object.prototype.hasOwnProperty.call(RuntimeProfiles, key)) {
    const named = RuntimeProfiles[/** @type {RuntimeProfileName} */ (key)]
    return {
      name: key,
      useExplorationPrinciples: named.useExplorationPrinciples === true,
      useLearningPrinciples: named.useLearningPrinciples === true,
      usePlanningPrinciples: named.usePlanningPrinciples === true,
    }
  }

  const production = RuntimeProfiles.production
  return {
    name: DEFAULT_RUNTIME_PROFILE,
    useExplorationPrinciples: production.useExplorationPrinciples === true,
    useLearningPrinciples: production.useLearningPrinciples === true,
    usePlanningPrinciples: production.usePlanningPrinciples === true,
  }
}

/**
 * Principle flags from a profile (convenience).
 * @param {RuntimeProfileName|string|Partial<RuntimeProfileFlags>|null|undefined} [profile]
 * @returns {RuntimeProfileFlags}
 */
export function getPrincipleFlags(profile = DEFAULT_RUNTIME_PROFILE) {
  const resolved = resolveRuntimeProfile(profile)
  return {
    useExplorationPrinciples: resolved.useExplorationPrinciples,
    useLearningPrinciples: resolved.useLearningPrinciples,
    usePlanningPrinciples: resolved.usePlanningPrinciples,
  }
}
