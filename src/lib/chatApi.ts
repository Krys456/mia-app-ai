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
  /** Voice mode → spoken-natural answers. */
  modality?: 'text' | 'voice'
  voice?: boolean
  /** Echo back prior voice session (interrupt / resume). */
  voiceSession?: Record<string, unknown> | null
  /** Welcome Engine session — used greeting ids. */
  welcomeSession?: Record<string, unknown> | null
  displayName?: string
  /** Soft style bias for Dynamic Behavior Model. */
  personalityBias?: string
  /** Optional multi-source life signals (calendar, weather, traffic, …). */
  lifeContext?: Record<string, unknown> | null
  /** NL Automation draft awaiting confirm/edit. */
  pendingAutomation?: Record<string, unknown> | null
}

export interface ChatApiSuccess {
  content: string
  memoriesSaved?: number
  /** Discrete UI hint when auto-memory wrote something. */
  memoryEvent?: 'saved' | 'updated' | null
  /** Internal only — client stores silently; never render. */
  learningSignals?: LearningSignals | null
  /** Internal only — client stores for voice interrupt/resume. */
  voiceSession?: Record<string, unknown> | null
  /** Internal only — client stores used welcome greetings. */
  welcomeSession?: Record<string, unknown> | null
  /** Internal only — NL automation draft awaiting confirm/edit. */
  pendingAutomation?: Record<string, unknown> | null
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
      ...(payload.modality ? { modality: payload.modality } : {}),
      ...(payload.voice ? { voice: true } : {}),
      ...(payload.voiceSession ? { voiceSession: payload.voiceSession } : {}),
      ...(payload.welcomeSession ? { welcomeSession: payload.welcomeSession } : {}),
      ...(payload.displayName ? { displayName: payload.displayName } : {}),
      ...(payload.personalityBias ? { personalityBias: payload.personalityBias } : {}),
      ...(payload.lifeContext ? { lifeContext: payload.lifeContext } : {}),
      ...(payload.pendingAutomation
        ? { pendingAutomation: payload.pendingAutomation }
        : {}),
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
    voiceSession:
      data.voiceSession && typeof data.voiceSession === 'object' ? data.voiceSession : null,
    welcomeSession:
      data.welcomeSession && typeof data.welcomeSession === 'object' ? data.welcomeSession : null,
    pendingAutomation:
      data.pendingAutomation === null
        ? null
        : data.pendingAutomation && typeof data.pendingAutomation === 'object'
          ? data.pendingAutomation
          : undefined,
  }
}
