import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, sendCorsPreflight, sendJson } from '../lib/server/http.js'
import { LAIFE_BASE_SYSTEM_PROMPT } from '../src/lib/personality.js'

/**
 * Chat generation — single OpenAI call with the personality system prompt
 * from src/lib/personality.ts (LAIFE_BASE_SYSTEM_PROMPT).
 * No Cognitive Engine, no coordinator, no post-generation refine chain.
 */

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
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
  memoryEnabled?: boolean
  modality?: 'text' | 'voice'
  voice?: boolean
  voiceSession?: Record<string, unknown> | null
  welcomeSession?: Record<string, unknown> | null
  displayName?: string
  personalityBias?: string
  lifeContext?: Record<string, unknown> | null
  pendingAutomation?: Record<string, unknown> | null
  conversationMemoryMap?: Record<string, unknown> | null
  conversationPreferenceProfile?: Record<string, unknown> | null
  conversationId?: string
  learningSignals?: unknown
  observability?: boolean
  debug?: boolean
  includeV1Debug?: boolean
  developerMode?: boolean
  engine?: 'v1' | 'v2'
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
  if (typeof req.body === 'object') return req.body as ChatApiRequestBody
  return {}
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res)

  if (req.method === 'OPTIONS') {
    return sendCorsPreflight(res)
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
  if (messages.length === 0) {
    return sendJson(res, 400, { error: 'messages must be a non-empty array' })
  }

  const memoryEnabled = body.memoryEnabled !== false
  const modality =
    body.modality === 'voice' || body.voice === true
      ? 'voice'
      : body.modality === 'text'
        ? 'text'
        : undefined

  try {
    // Source of truth: LAIFE_BASE_SYSTEM_PROMPT in src/lib/personality.ts
    const personalityPrompt = LAIFE_BASE_SYSTEM_PROMPT

    // Optional thin personalization from the request body (not the full client mega-prompt).
    const personalizationBits: string[] = []
    const displayName =
      typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 40) : ''
    if (displayName) {
      personalizationBits.push(
        `Il nome dell'utente è ${displayName}. Usalo in modo naturale quando ha senso, senza ripeterlo a ogni frase.`,
      )
    }
    if (typeof body.personalityBias === 'string' && body.personalityBias.trim()) {
      personalizationBits.push(
        `Soft style bias richiesto dal client: ${body.personalityBias.trim().slice(0, 80)}.`,
      )
    }
    const instructions =
      personalizationBits.length > 0
        ? `${personalityPrompt}\n\n${personalizationBits.join('\n\n')}`
        : personalityPrompt

    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey })
    const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'

    const response = await client.responses.create({
      model,
      instructions,
      temperature: 0.85,
      max_output_tokens: modality === 'voice' ? 700 : 4096,
      stream: false,
      input: messages.map((msg) => ({
        type: 'message' as const,
        role: msg.role,
        content: msg.content,
      })),
    })

    const content = response.output_text?.trim() || ''
    if (!content) {
      return sendJson(res, 502, { error: 'Empty response from OpenAI' })
    }

    const lastUserMessage = [...messages].reverse().find((msg) => msg.role === 'user')
    let memoryEvent: 'saved' | 'updated' | null = null
    if (lastUserMessage?.content) {
      memoryEvent = await runMemoryIfEnabled(lastUserMessage.content, content, memoryEnabled)
    }

    const payload: Record<string, unknown> = {
      content,
      memoryEvent,
      // Echo session fields the client already sent — no cognitive engines.
      ...(body.learningSignals != null ? { learningSignals: body.learningSignals } : {}),
      ...(body.voiceSession && typeof body.voiceSession === 'object'
        ? { voiceSession: body.voiceSession }
        : {}),
      ...(body.welcomeSession && typeof body.welcomeSession === 'object'
        ? { welcomeSession: body.welcomeSession }
        : {}),
      ...(body.conversationMemoryMap && typeof body.conversationMemoryMap === 'object'
        ? { conversationMemoryMap: body.conversationMemoryMap }
        : {}),
      ...(body.conversationPreferenceProfile &&
      typeof body.conversationPreferenceProfile === 'object'
        ? { conversationPreferenceProfile: body.conversationPreferenceProfile }
        : {}),
      ...(body.pendingAutomation !== undefined
        ? { pendingAutomation: body.pendingAutomation }
        : {}),
    }

    console.log(
      '[api/chat] final response',
      JSON.stringify({
        contentLen: content.length,
        memoryEvent,
        keys: Object.keys(payload),
        singleShot: true,
      }),
    )
    return sendJson(res, 200, payload)
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
