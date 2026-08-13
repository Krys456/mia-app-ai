import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, sendCorsPreflight, sendJson, errorMessage } from '../../lib/server/http.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 15,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    applyCors(res)
    if (req.method === 'OPTIONS') return sendCorsPreflight(res)

    const {
      readBrowserUserId,
      listConversationsForBrowserUser,
      upsertConversationRecord,
    } = await import('../../lib/server/chat-persistence.js')

    const browserUserId = readBrowserUserId(req)

    if (req.method === 'GET') {
      const conversations = await listConversationsForBrowserUser(browserUserId)
      return sendJson(res, 200, { success: true, conversations })
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
      const id = typeof body.id === 'string' ? body.id.trim() : ''
      if (!id) {
        return sendJson(res, 400, { success: false, error: 'id is required' })
      }
      const conversation = await upsertConversationRecord({
        id,
        browserUserId,
        title: typeof body.title === 'string' ? body.title : 'Chat',
        engine: typeof body.engine === 'string' ? body.engine : 'v1',
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      })
      return sendJson(res, 200, { success: true, conversation })
    }

    res.setHeader('Allow', 'GET, POST, OPTIONS')
    return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  } catch (error) {
    console.error('[api/conversations] error', error)
    return sendJson(res, 500, {
      success: false,
      error: errorMessage(error) || 'Conversation persistence failed',
    })
  }
}
