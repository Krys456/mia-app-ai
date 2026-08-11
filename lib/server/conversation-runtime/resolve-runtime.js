/**
 * Resolve which conversation runtime to use.
 *
 * LAIFE_CONVERSATION_RUNTIME:
 *   unset / empty → v1
 *   v1            → v1
 *   v2            → v2
 *   anything else → v1 (safe default)
 */

/** @typedef {'v1'|'v2'} ConversationRuntimeId */

export const CONVERSATION_RUNTIME_ENV = 'LAIFE_CONVERSATION_RUNTIME'
export const DEFAULT_CONVERSATION_RUNTIME = /** @type {ConversationRuntimeId} */ ('v1')

/**
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
