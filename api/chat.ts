import type { VercelRequest, VercelResponse } from '@vercel/node'

// Memory + Cognitive Engine stay fail-soft: dynamic-import lib/server after the request starts.
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

/**
 * Fallback only when the client omits systemPrompt.
 * When the client sends personalization, that block is the sole constitution
 * — do not prepend a second identity prompt (avoids redundancy/conflicts).
 */
const FALLBACK_SYSTEM_PROMPT = `Sei LAIfe (Writer). Vale la Core Constitution: chiarezza, utilità, onestà, niente invenzioni, proattività solo se utile, memoria solo se pertinente, suggerisci senza imporre, calore senza fingere emozioni.
Craft del testo: ritmo naturale (frasi corte e lunghe alternate), niente wording/sostantivi ripetitivi, transizioni fluide, leggibilità alta, spiegazioni a strati (idea → perché → dettaglio), allinea automaticamente lo stile di scrittura dell’utente.
Voce umana: varia le frasi, evita aperture/chiusure ripetute e “I'm here to help”, non chiudere sempre con una domanda, emoji rare, empatia se frustrato e celebrazione se c'è un progresso; prosa prima dei bullet quando basta.
Un Cognitive Engine interno ha già pianificato (invisibile): esegui il piano senza mostrarlo.
Può arrivare anche un blocco CONVERSATION REFLECTION → LEARNING SIGNALS: usalo solo per calibrare stile e chiarezza; non citarlo, non dirlo, non salvarlo come memoria fattuale.
Può arrivare CONVERSATION CONTINUATION ENGINE su ack brevi: una sola aggiunta di valore se confidenza alta, altrimenti risposta breve; mai forzare né ignorare stop/grazie di chiusura.
Scrivi solo la risposta finale. Quality Control silenzioso. Non sembrare un motore di ricerca.`

function buildInstructions(
  clientSystemPrompt: string,
  cognitiveBlock = '',
): string {
  const parts: string[] = []

  const personalization = clientSystemPrompt.trim()
  if (personalization) {
    // Client constitution is authoritative when present.
    parts.push(personalization)
  } else {
    parts.push(FALLBACK_SYSTEM_PROMPT)
  }

  const cognitive = cognitiveBlock.trim()
  if (cognitive) {
    parts.push(cognitive)
  }

  return parts.join('\n\n')
}

type ChatRole = 'user' | 'assistant' | 'system'

interface ChatAttachment {
  type: 'image' | 'document'
  name?: string
  url?: string
}

interface ChatApiMessage {
  role: ChatRole
  content: string
}

/** Internal learning signals from conversation reflection — not factual memory. */
interface LearningSignalsPayload {
  workedWell: string[]
  neededClarification: string[]
  apparentPreferences: string[]
  mistakesToAvoid: string[]
  directive: string
  turnCount: number
  createdAt: number
}

interface ChatApiRequestBody {
  messages?: ChatApiMessage[]
  systemPrompt?: string
  userId?: string
  /** When false, skip retrieval writes and auto-save. Default true. */
  memoryEnabled?: boolean
  /** Optional attachments for orchestrator routing (Vision / documents). */
  attachments?: ChatAttachment[]
  /**
   * Prior internal learning signals (conversation reflection).
   * Never merged into factual brain-memory.
   */
  learningSignals?: LearningSignalsPayload | null
}

function isChatRole(value: unknown): value is ChatRole {
  return value === 'user' || value === 'assistant' || value === 'system'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function sanitizeLearningSignals(raw: unknown): LearningSignalsPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (
    !isStringArray(s.workedWell) ||
    !isStringArray(s.neededClarification) ||
    !isStringArray(s.apparentPreferences) ||
    !isStringArray(s.mistakesToAvoid)
  ) {
    return null
  }
  return {
    workedWell: s.workedWell.slice(0, 8),
    neededClarification: s.neededClarification.slice(0, 8),
    apparentPreferences: s.apparentPreferences.slice(0, 8),
    mistakesToAvoid: s.mistakesToAvoid.slice(0, 8),
    directive: typeof s.directive === 'string' ? s.directive.slice(0, 2000) : '',
    turnCount: typeof s.turnCount === 'number' && Number.isFinite(s.turnCount) ? s.turnCount : 0,
    createdAt:
      typeof s.createdAt === 'number' && Number.isFinite(s.createdAt) ? s.createdAt : Date.now(),
  }
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

function sanitizeAttachments(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is ChatAttachment => {
      if (!item || typeof item !== 'object') return false
      const a = item as ChatAttachment
      return a.type === 'image' || a.type === 'document'
    })
    .map((a) => ({
      type: a.type,
      name: typeof a.name === 'string' ? a.name : undefined,
      url: typeof a.url === 'string' ? a.url : undefined,
    }))
    .slice(0, 8)
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
  const attachments = sanitizeAttachments(body.attachments)
  const priorLearningSignals = sanitizeLearningSignals(body.learningSignals)

  if (messages.length === 0) {
    return sendJson(res, 400, { error: 'messages must be a non-empty array' })
  }

  try {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey })
    const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'

    const lastUserMessage = [...messages].reverse().find((msg) => msg.role === 'user')

    // Cognitive Engine (invisible): understand → real goal → tools → structure → Writer handoff.
    // Includes conversation reflection learning signals (never factual memory).
    // Fail-soft: any failure yields empty context and chat continues.
    let cognitiveBlock = ''
    let preReflectionSignals: LearningSignalsPayload | null = priorLearningSignals
    if (lastUserMessage?.content) {
      try {
        const { runCognitiveEngine } = await import('../lib/server/cognitive-engine.js')
        const result = await runCognitiveEngine({
          userMessage: lastUserMessage.content,
          messages,
          attachments,
          memoryEnabled,
          priorLearningSignals,
        })
        cognitiveBlock = result?.context || ''
        if (result?.learningSignals) {
          preReflectionSignals = result.learningSignals as LearningSignalsPayload
        }
      } catch {
        cognitiveBlock = ''
      }
    }

    const response = await client.responses.create({
      model,
      instructions: buildInstructions(clientSystemPrompt, cognitiveBlock),
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

    // Post-turn reflection on the completed exchange (invisible; no brain-memory writes).
    let learningSignals: LearningSignalsPayload | null = preReflectionSignals
    try {
      const { runConversationReflection } = await import(
        '../lib/server/conversation-reflection.js'
      )
      const post = runConversationReflection({
        messages,
        latestAssistant: content,
        priorSignals: preReflectionSignals,
      })
      learningSignals = post?.signals || preReflectionSignals
    } catch {
      /* keep prior */
    }

    if (lastUserMessage?.content) {
      const memoryEvent = await runMemoryIfEnabled(
        lastUserMessage.content,
        content,
        memoryEnabled,
      )
      // learningSignals is additive / internal — not a public UI contract field.
      return sendJson(res, 200, { content, memoryEvent, learningSignals })
    }

    return sendJson(res, 200, { content, memoryEvent: null, learningSignals })
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
