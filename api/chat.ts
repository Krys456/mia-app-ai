/**
 * LAIfe /api/chat — HTTP entrypoint only.
 *
 * Responsibilities: CORS, method check, dispatch to conversation runtime.
 * V1/V2 branching lives in lib/server/conversation-runtime/.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, sendCorsPreflight, sendJson } from '../lib/server/http.js'
import { dispatchConversationRuntime } from '../lib/server/conversation-runtime/conversation-runtime.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res)

  if (req.method === 'OPTIONS') {
    return sendCorsPreflight(res)
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  return dispatchConversationRuntime(req, res, process.env)
}
