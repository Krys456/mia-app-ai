/**
 * Resolve which conversation runtime to use.
 *
 * Priority:
 *   1. request.body.engine ("v1"|"v2") — only when Developer Mode is ON
 *   2. process.env.LAIFE_CONVERSATION_RUNTIME
 *   3. default = "v1"
 *
 * Developer Mode OFF (missing/false developerMode) → ignore body.engine.
 * Invalid engine → fall through to env / default.
 */

/** @typedef {'v1'|'v2'} ConversationRuntimeId */

export const CONVERSATION_RUNTIME_ENV = 'LAIFE_CONVERSATION_RUNTIME'
export const DEFAULT_CONVERSATION_RUNTIME = /** @type {ConversationRuntimeId} */ ('v1')

/**
 * @param {unknown} value
 * @returns {ConversationRuntimeId|null}
 */
export function normalizeEngine(value) {
  if (value == null) return null
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'v1' || normalized === 'v2') return /** @type {ConversationRuntimeId} */ (normalized)
  return null
}

/**
 * Developer Mode is an explicit client opt-in (`body.developerMode === true`).
 * Old clients omit it → engine is ignored → Production stays env/default.
 *
 * @param {unknown} body
 * @returns {boolean}
 */
export function isDeveloperModeEnabled(body) {
  if (!body || typeof body !== 'object') return false
  return /** @type {any} */ (body).developerMode === true
}

/**
 * Env-only resolution (Priority 2–3).
 *
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>|null|undefined} [env]
 * @returns {ConversationRuntimeId}
 */
export function resolveConversationRuntime(env = process.env) {
  const source = env && typeof env === 'object' ? env : {}
  const raw = source[CONVERSATION_RUNTIME_ENV]
  if (raw == null) return DEFAULT_CONVERSATION_RUNTIME

  const normalized = String(raw).trim().toLowerCase()
  if (!normalized) return DEFAULT_CONVERSATION_RUNTIME
  if (normalized === 'v2') return 'v2'
  if (normalized === 'v1') return 'v1'
  return DEFAULT_CONVERSATION_RUNTIME
}

/**
 * Full request resolution (Priority 1 → 2 → 3).
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv|Record<string, string|undefined>|null,
 *   body?: unknown,
 * }} [input]
 * @returns {ConversationRuntimeId}
 */
export function resolveRequestConversationRuntime(input = {}) {
  const env = input.env ?? process.env
  const body = input.body

  if (isDeveloperModeEnabled(body)) {
    const fromEngine = normalizeEngine(
      body && typeof body === 'object' ? /** @type {any} */ (body).engine : null,
    )
    if (fromEngine) return fromEngine
  }

  return resolveConversationRuntime(env)
}
