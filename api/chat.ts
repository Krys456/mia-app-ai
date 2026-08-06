import type { VercelRequest, VercelResponse } from '@vercel/node'
import OpenAI from 'openai'

type ChatRole = 'user' | 'assistant' | 'system'

interface ChatApiMessage {
  role: ChatRole
  content: string
}

interface ChatApiRequestBody {
  messages?: ChatApiMessage[]
  systemPrompt?: string
}

function isChatRole(value: unknown): value is ChatRole {
  return value === 'user' || value === 'assistant' || value === 'system'
}

function sanitizeMessages(raw: unknown): ChatApiMessage[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is ChatApiMessage => {
      if (!item || typeof item !== 'object') return false
      const msg = item as ChatApiMessage
      return isChatRole(msg.role) && typeof msg.content === 'string' && msg.content.trim().length > 0
    })
    .map((msg) => ({
      role: msg.role,
      content: msg.content.trim(),
    }))
    // Keep the request bounded for cost / latency safety
    .slice(-40)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server misconfigured: OPENAI_API_KEY is not set',
    })
  }

  let body: ChatApiRequestBody
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as ChatApiRequestBody
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }
  const messages = sanitizeMessages(body?.messages)
  const systemPrompt =
    typeof body?.systemPrompt === 'string' && body.systemPrompt.trim()
      ? body.systemPrompt.trim()
      : 'You are LAIfe — a warm, helpful AI companion.'

  if (messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array' })
  }

  try {
    const openai = new OpenAI({ apiKey })
    const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'

    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.8,
    })

    const content = completion.choices[0]?.message?.content?.trim()
    if (!content) {
      return res.status(502).json({ error: 'Empty response from OpenAI' })
    }

    return res.status(200).json({ content })
  } catch (error) {
    console.error(error)

    if (error instanceof OpenAI.APIError) {
      console.error('[api/chat] OpenAI error details', {
        status: error.status,
        code: error.code,
        type: error.type,
        message: error.message,
      })
    }

    return res.status(502).json({ error: 'Failed to generate a reply' })
  }
}
