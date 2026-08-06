export type ChatApiRole = 'user' | 'assistant' | 'system'

export interface ChatApiMessage {
  role: ChatApiRole
  content: string
}

export interface ChatApiRequest {
  messages: ChatApiMessage[]
  systemPrompt: string
}

export interface ChatApiSuccess {
  content: string
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: payload.messages,
      systemPrompt: payload.systemPrompt,
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

  return { content }
}
