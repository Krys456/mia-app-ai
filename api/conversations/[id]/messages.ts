import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, sendCorsPreflight, sendJson, errorMessage } from '../../../lib/server/http.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 20,
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

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS')
      return sendJson(res, 405, { success: false, error: 'Method not allowed' })
    }

    const conversationId = conversationIdFromQuery(req)
    if (!conversationId) {
      return sendJson(res, 400, { success: false, error: 'conversation id required' })
    }

    const { readBrowserUserId, upsertMessagesForConversation } = await import(
      '../../../lib/server/chat-persistence.js'
    )
    const browserUserId = readBrowserUserId(req)
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
    const messages = Array.isArray(body.messages) ? body.messages : []

    const result = await upsertMessagesForConversation({
      browserUserId,
      conversationId,
      messages,
      title: typeof body.title === 'string' ? body.title : undefined,
      engine: typeof body.engine === 'string' ? body.engine : undefined,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
    })

    return sendJson(res, 200, { success: true, ...result })
  } catch (error) {
    console.error('[api/conversations/:id/messages] error', error)
    return sendJson(res, 500, {
      success: false,
      error: errorMessage(error) || 'Message persistence failed',
    })
  }
}
