/**
 * Conversation runtime dispatcher.
 *
 * api/chat.ts → dispatchConversationRuntime → runV1Chat | runV2Chat
 *
 * Resolution (see resolve-runtime.js):
 *   1. body.engine when developerMode === true
 *   2. LAIFE_CONVERSATION_RUNTIME
 *   3. default v1
 */

export {
  resolveConversationRuntime,
  resolveRequestConversationRuntime,
  normalizeEngine,
  isDeveloperModeEnabled,
  CONVERSATION_RUNTIME_ENV,
  DEFAULT_CONVERSATION_RUNTIME,
} from './resolve-runtime.js'

export {
  runV2Chat,
  mapV2ResultToChatResponse,
  mapV2ErrorToChatResponse,
  sanitizeChatMessages,
  buildV2TurnInput,
  parseChatBody,
  buildV2DebugInfo,
} from './run-v2.js'

/**
 * Dispatch a chat request to V1 or V2 based on developerMode/engine + env.
 * Branching lives here — not in api/chat.ts.
 *
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} [env]
 */
export async function dispatchConversationRuntime(req, res, env = process.env) {
  const { resolveRequestConversationRuntime } = await import('./resolve-runtime.js')
  const { parseChatBody, runV2Chat } = await import('./run-v2.js')

  let body = {}
  try {
    body = parseChatBody(req.body)
  } catch {
    body = {}
  }

  const runtime = resolveRequestConversationRuntime({ env, body })

  if (runtime === 'v2') {
    return runV2Chat(req, res, { runtime: 'v2' })
  }

  const { runV1Chat } = await import('./v1-chat.js')
  return runV1Chat(req, res, { runtime: 'v1' })
}
