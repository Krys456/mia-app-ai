/**
 * LAIfe engine feature flag.
 *
 * LAIFE_ENGINE=v1 → legacy cognitive pipeline (default)
 * LAIFE_ENGINE=v2 → V2 Perception→Mind→Planner→Writer→Reviewer
 *
 * Unknown / empty values resolve to v1 (safe default, no public behavior change).
 */

export const LAIFE_ENGINE_V1 = 'v1'
export const LAIFE_ENGINE_V2 = 'v2'

/**
 * @param {unknown} [raw]
 * @returns {'v1'|'v2'}
 */
export function resolveLaifeEngine(raw = process.env.LAIFE_ENGINE) {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (value === LAIFE_ENGINE_V2) return LAIFE_ENGINE_V2
  return LAIFE_ENGINE_V1
}

/**
 * Resolve engine for one HTTP request.
 * Explicit body.engine wins; otherwise fall back to LAIFE_ENGINE env (default v1).
 * @param {unknown} [bodyEngine]
 * @param {unknown} [envEngine]
 * @returns {'v1'|'v2'}
 */
export function resolveRequestEngine(bodyEngine, envEngine = process.env.LAIFE_ENGINE) {
  const fromBody = String(bodyEngine ?? '')
    .trim()
    .toLowerCase()
  if (fromBody === LAIFE_ENGINE_V2 || fromBody === LAIFE_ENGINE_V1) return fromBody
  return resolveLaifeEngine(envEngine)
}

/**
 * @param {unknown} [raw]
 * @returns {boolean}
 */
export function isLaifeEngineV2(raw = process.env.LAIFE_ENGINE) {
  return resolveLaifeEngine(raw) === LAIFE_ENGINE_V2
}
