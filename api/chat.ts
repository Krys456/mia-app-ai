import type { VercelRequest, VercelResponse } from '@vercel/node'
import OpenAI from 'openai'
import {
  ensureMemoriesTable,
  formatMemoriesForPrompt,
  listMemoriesForUser,
  sanitizeUserId,
  tryGetSql,
} from '../server/db'
import { extractAndStoreMemories } from '../server/memoryExtract'

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
}

const SYSTEM_PROMPT = `Sei LAIfe, un assistente AI avanzato.
Adatta SEMPRE la tua lingua a quella usata dall'utente (se l'utente scrive in italiano, rispondi esclusivamente in italiano fluido e naturale).
Fornisci risposte chiare, esaustive e ben strutturate, evitando di essere troppo sbrigativo.
Quando conosci obiettivi, interessi o preferenze dell'utente dalla memoria a lungo termine, usali in modo naturale nelle risposte future.`

function buildInstructions(clientSystemPrompt: string, memoryBlock: string): string {
  const parts = [SYSTEM_PROMPT]
  const personalization = clientSystemPrompt.trim()
  if (personalization) parts.push(`## Personalizzazione\n${personalization}`)
  if (memoryBlock.trim()) parts.push(memoryBlock.trim())
  return parts.join('\n\n')
}

type ChatRole = 'user' | 'assistant' | 'system'

interface ChatApiMessage {
  role: ChatRole
  content: string
}

interface ChatApiRequestBody {
  messages?: ChatApiMessage[]
  systemPrompt?: string
  userId?: string
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
    .slice(-40)
}

function parseBody(req: VercelRequest): ChatApiRequestBody {
  if (req.body == null) return {}
  if (typeof req.body === 'string') {
    const trimmed = req.body.trim()
    if (!trimmed) return {}
    return JSON.parse(trimmed) as ChatApiRequestBody
  }
  if (typeof req.body === 'object') {
    return req.body as ChatApiRequestBody
  }
  throw new Error('Unsupported request body')
}

function sendJson(res: VercelResponse, status: number, payload: Record<string, unknown>) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.status(status).json(payload)
}

function readUserId(req: VercelRequest, body: ChatApiRequestBody): string | null {
  const header = req.headers['x-laife-user-id']
  if (typeof header === 'string') {
    const fromHeader = sanitizeUserId(header)
    if (fromHeader) return fromHeader
  }
  return sanitizeUserId(body.userId)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-LAIfe-User-Id')
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return sendJson(res, 500, {
      error: 'Server misconfigured: OPENAI_API_KEY is not set',
    })
  }

  let body: ChatApiRequestBody
  try {
    body = parseBody(req)
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body' })
  }

  const messages = sanitizeMessages(body.messages).filter(
    (msg) => msg.role === 'user' || msg.role === 'assistant',
  )
  const clientSystemPrompt =
    typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : ''
  const userId = readUserId(req, body)

  if (messages.length === 0) {
    return sendJson(res, 400, { error: 'messages must be a non-empty array' })
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'

    let memoryBlock = ''
    let existingMemories: Awaited<ReturnType<typeof listMemoriesForUser>> = []
    const sql = tryGetSql()
    if (sql && userId) {
      try {
        await ensureMemoriesTable(sql)
        existingMemories = await listMemoriesForUser(sql, userId, { limit: 60 })
        memoryBlock = formatMemoriesForPrompt(existingMemories)
      } catch (memoryError) {
        console.error('[api/chat] memory load failed', memoryError)
      }
    }

    const response = await client.responses.create({
      model,
      instructions: buildInstructions(clientSystemPrompt, memoryBlock),
      temperature: 0.8,
      input: messages.map((msg) => ({
        type: 'message' as const,
        role: msg.role,
        content: msg.content,
      })),
    })

    const content = response.output_text?.trim()
    if (!content) {
      return sendJson(res, 502, { error: 'Empty response from OpenAI' })
    }

    let memoriesSaved = 0
    const latestUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content
    if (sql && userId && latestUserMessage) {
      try {
        memoriesSaved = await extractAndStoreMemories({
          client,
          model,
          userId,
          userMessage: latestUserMessage,
          existing: existingMemories,
        })
      } catch (extractError) {
        console.error('[api/chat] memory extract failed', extractError)
      }
    }

    return sendJson(res, 200, { content, memoriesSaved })
  } catch (error) {
    console.error(error)

    if (error instanceof OpenAI.APIError) {
      console.error('[api/chat] OpenAI error details', {
        status: error.status,
        code: error.code,
        type: error.type,
        message: error.message,
      })

      const status =
        typeof error.status === 'number' && error.status >= 400 && error.status < 600
          ? error.status
          : 502

      return sendJson(res, status, {
        error: error.message,
        code: error.code,
        type: error.type,
      })
    }

    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
