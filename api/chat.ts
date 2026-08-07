import type { VercelRequest, VercelResponse } from '@vercel/node'

// Memory stays fail-soft: dynamic-import lib/server only after the request starts.
// OpenAI loads after the handler starts.

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
}

async function runMemoryIfEnabled(
  userMessage: string,
  assistantMessage: string,
  memoryEnabled: boolean,
): Promise<'saved' | 'updated' | null> {
  if (!memoryEnabled) return null

  try {
    const { runMemoryPipeline } = await import('../lib/server/brain-memory.js')
    const result = await runMemoryPipeline({
      userMessage,
      assistantMessage,
      memoryEnabled: true,
    })

    if (result?.updated) return 'updated'
    if (result?.saved) return 'saved'
    return null
  } catch {
    return null
  }
}

async function loadRelevantMemoryBlock(userMessage: string): Promise<string> {
  try {
    const { searchMemories } = await import('../lib/server/brain-memory.js')
    const memories = await searchMemories(userMessage, { limit: 5 })

    if (!Array.isArray(memories) || memories.length === 0) {
      return ''
    }

    const lines = memories
      .map((memory: { title?: string; content?: string }) => {
        const title = typeof memory.title === 'string' ? memory.title.trim() : ''
        const content = typeof memory.content === 'string' ? memory.content.trim() : ''
        if (!title && !content) return null
        if (!title) return `- ${content}`
        if (!content) return `- ${title}`
        return `- ${title}: ${content}`
      })
      .filter((line: string | null): line is string => Boolean(line))

    if (lines.length === 0) {
      return ''
    }

    return `Relevant user memories:\n${lines.join('\n')}`
  } catch {
    return ''
  }
}

const SYSTEM_PROMPT = `Sei LAIfe, un assistente AI moderno.

Priorità assolute:
1. Adatta SEMPRE la lingua a quella dell'utente.
2. Scrivi in modo naturale, umano e piacevole da leggere.
3. Usa Markdown intelligente (paragrafi, elenchi, titoli, grassetto, codice) quando migliora la chiarezza.
4. Non essere troppo corto senza motivo; non produrre muri di testo.
5. Alterna prosa e struttura. Evidenzia i punti chiave con **grassetto** con parsimonia.
6. Emoji solo se naturali e utili al tono.

Segui le istruzioni di personalità e lunghezza fornite sotto: modificano tono e packaging, non la qualità dei fatti.`

function buildInstructions(clientSystemPrompt: string, memoryBlock = ''): string {
  const parts = [SYSTEM_PROMPT]

  const personalization = clientSystemPrompt.trim()
  if (personalization) {
    parts.push(`## Personalizzazione\n${personalization}`)
  }

  const memories = memoryBlock.trim()
  if (memories) {
    parts.push(memories)
  }

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
  /** When false, skip retrieval writes and auto-save. Default true. */
  memoryEnabled?: boolean
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
  const memoryEnabled = body.memoryEnabled !== false

  if (messages.length === 0) {
    return sendJson(res, 400, { error: 'messages must be a non-empty array' })
  }

  try {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey })
    const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'

    const lastUserMessage = [...messages].reverse().find((msg) => msg.role === 'user')
    const memoryBlock =
      memoryEnabled && lastUserMessage?.content
        ? await loadRelevantMemoryBlock(lastUserMessage.content)
        : ''

    const response = await client.responses.create({
      model,
      instructions: buildInstructions(clientSystemPrompt, memoryBlock),
      temperature: 0.85,
      max_output_tokens: 4096,
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

    if (lastUserMessage?.content) {
      const memoryEvent = await runMemoryIfEnabled(
        lastUserMessage.content,
        content,
        memoryEnabled,
      )
      return sendJson(res, 200, { content, memoryEvent })
    }

    return sendJson(res, 200, { content, memoryEvent: null })
  } catch (error) {
    console.error(error)

    try {
      const OpenAI = (await import('openai')).default
      if (error instanceof OpenAI.APIError) {
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
    } catch {
      // Fall through
    }

    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
