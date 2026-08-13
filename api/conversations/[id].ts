import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, sendCorsPreflight, sendJson, errorMessage } from '../../lib/server/http.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 15,
}

function conversationIdFromQuery(req: VercelRequest): string {
  const raw = req.query.id
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value.trim() : ''
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    applyCors(res)
    if (req.method === 'OPTIONS') return sendCorsPreflight(res)

    const conversationId = conversationIdFromQuery(req)
    if (!conversationId) {
      return sendJson(res, 400, { success: false, error: 'conversation id required' })
    }

    const {
      readBrowserUserId,
      getConversationWithMessages,
      deleteConversationRecord,
      upsertConversationRecord,
    } = await import('../../lib/server/chat-persistence.js')

    const browserUserId = readBrowserUserId(req)

    if (req.method === 'GET') {
      const conversation = await getConversationWithMessages(browserUserId, conversationId)
      if (!conversation) {
        return sendJson(res, 404, { success: false, error: 'Not found' })
      }
      return sendJson(res, 200, { success: true, conversation })
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
      const conversation = await upsertConversationRecord({
        id: conversationId,
        browserUserId,
        title: typeof body.title === 'string' ? body.title : 'Chat',
        engine: typeof body.engine === 'string' ? body.engine : 'v1',
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      })
      return sendJson(res, 200, { success: true, conversation })
    }

    if (req.method === 'DELETE') {
      const result = await deleteConversationRecord(browserUserId, conversationId)
      return sendJson(res, 200, { success: true, ...result })
    }

    res.setHeader('Allow', 'GET, PUT, PATCH, DELETE, OPTIONS')
    return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  } catch (error) {
    console.error('[api/conversations/:id] error', error)
    const message = errorMessage(error) || 'Conversation persistence failed'
    const status = /forbidden/i.test(message) ? 403 : 500
    return sendJson(res, status, { success: false, error: message })
  }
}
