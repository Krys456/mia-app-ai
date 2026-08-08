import {
  sanitizeLearningSignals,
  type LearningSignals,
} from './learningSignals'

export type ChatApiRole = 'user' | 'assistant' | 'system'

export interface ChatApiMessage {
  role: ChatApiRole
  content: string
}

export type { LearningSignals }

export interface ChatApiRequest {
  messages: ChatApiMessage[]
  systemPrompt: string
  userId?: string
  memoryEnabled?: boolean
  /** Prior internal reflection signals — never shown in UI. */
  learningSignals?: LearningSignals | null
}

export interface ChatApiSuccess {
  content: string
  memoriesSaved?: number
  /** Discrete UI hint when auto-memory wrote something. */
  memoryEvent?: 'saved' | 'updated' | null
  /** Internal only — client stores silently; never render. */
  learningSignals?: LearningSignals | null
}

export interface ChatApiErrorBody {
  error?: string
}

export class ChatApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ChatApiError'
    this.status = status
  }
}

function resolveChatEndpoint(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  if (!base) return '/api/chat'
  return `${base.replace(/\/$/, '')}/api/chat`
}

/**
 * Client helper for LAIfe chat.
 * Calls the Vercel serverless proxy at `/api/chat` — never the OpenAI API directly.
 */
export async function requestChatCompletion(
  payload: ChatApiRequest,
  init?: { signal?: AbortSignal },
): Promise<ChatApiSuccess> {
  const response = await fetch(resolveChatEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(payload.userId ? { 'X-LAIfe-User-Id': payload.userId } : {}),
    },
    body: JSON.stringify({
      messages: payload.messages,
      systemPrompt: payload.systemPrompt,
      userId: payload.userId,
      memoryEnabled: payload.memoryEnabled !== false,
      ...(payload.learningSignals ? { learningSignals: payload.learningSignals } : {}),
    }),
    signal: init?.signal,
  })

  let data: Partial<ChatApiSuccess> & ChatApiErrorBody = {}
  try {
    data = (await response.json()) as Partial<ChatApiSuccess> & ChatApiErrorBody
  } catch {
    /* non-JSON body */
  }

  if (!response.ok) {
    throw new ChatApiError(
      data.error?.trim() || `Chat API request failed (${response.status})`,
      response.status,
    )
  }

  const content = data.content?.trim()
  if (!content) {
    throw new ChatApiError('Chat API returned an empty reply', response.status)
  }

  const memoryEvent =
    data.memoryEvent === 'saved' || data.memoryEvent === 'updated' ? data.memoryEvent : null

  return {
    content,
    memoriesSaved: typeof data.memoriesSaved === 'number' ? data.memoriesSaved : 0,
    memoryEvent,
    learningSignals: sanitizeLearningSignals(data.learningSignals),
  }
}
