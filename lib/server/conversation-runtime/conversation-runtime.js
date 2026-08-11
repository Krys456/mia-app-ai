/**
 * Conversation runtime dispatcher.
 *
 * api/chat.ts → dispatchConversationRuntime → runV1Chat | runV2Chat
 *
 * LAIFE_CONVERSATION_RUNTIME: unset/v1/unknown → V1; v2 → V2.
 */

export {
  resolveConversationRuntime,
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
} from './run-v2.js'

/**
 * Dispatch a chat request to V1 or V2 based on env.
 * Branching lives here — not in api/chat.ts.
 *
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} [env]
 */
export async function dispatchConversationRuntime(req, res, env = process.env) {
  const { resolveConversationRuntime: resolve } = await import('./resolve-runtime.js')
  const runtime = resolve(env)

  if (runtime === 'v2') {
    const { runV2Chat } = await import('./run-v2.js')
    return runV2Chat(req, res)
  }

  const { runV1Chat } = await import('./v1-chat.js')
  return runV1Chat(req, res)
}
