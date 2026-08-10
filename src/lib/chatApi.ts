import {
  sanitizeLearningSignals,
  type LearningSignals,
} from './learningSignals'
import { sanitizeConversationMemoryMap } from './conversationMemoryMap'
import { sanitizeConversationPreferenceProfile } from './conversationPreferenceProfile'

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
  /** Conversation Memory Map — explored topics, goals, explanations, … */
  conversationMemoryMap?: Record<string, unknown> | null
  /** Conversation Preference Profile — style prefs from feedback. */
  conversationPreferenceProfile?: Record<string, unknown> | null
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
  /** Internal only — Conversation Memory Map echo. */
  conversationMemoryMap?: Record<string, unknown> | null
  /** Internal only — Conversation Preference Profile echo. */
  conversationPreferenceProfile?: Record<string, unknown> | null
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

function describeFetchFailure(error: unknown, endpoint: string): string {
  const raw = error instanceof Error ? error.message : String(error)
  // Browsers surface CORS / network / SSO redirects as the opaque "Failed to fetch".
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return (
      `Network error calling ${endpoint} (${raw}). ` +
      `Check same-origin /api/chat, CORS, Vercel Deployment Protection, and that the function finished within maxDuration.`
    )
  }
  return raw || 'Chat request failed'
}

/**
 * Client helper for LAIfe chat.
 * Calls the Vercel serverless proxy at `/api/chat` — never the OpenAI API directly.
 */
export async function requestChatCompletion(
  payload: ChatApiRequest,
  init?: { signal?: AbortSignal },
): Promise<ChatApiSuccess> {
  const endpoint = resolveChatEndpoint()
  // Temporary pipeline logging — outgoing client request.
  console.log(
    '[chatApi] request',
    JSON.stringify({
      endpoint,
      messageCount: payload.messages?.length ?? 0,
      hasSystemPrompt: Boolean(payload.systemPrompt?.trim()),
      memoryEnabled: payload.memoryEnabled !== false,
    }),
  )

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(payload.userId ? { 'X-LAIfe-User-Id': payload.userId } : {}),
      },
      // Needed for Vercel Deployment Protection cookies on preview/prod.
      credentials: 'include',
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
        ...(payload.conversationMemoryMap
          ? { conversationMemoryMap: payload.conversationMemoryMap }
          : {}),
        ...(payload.conversationPreferenceProfile
          ? { conversationPreferenceProfile: payload.conversationPreferenceProfile }
          : {}),
      }),
      signal: init?.signal,
    })
  } catch (error) {
    console.error('[chatApi] fetch threw', error)
    throw new ChatApiError(describeFetchFailure(error, endpoint), 0)
  }

  const contentType = response.headers.get('content-type') || ''
  console.log(
    '[chatApi] fetch result',
    JSON.stringify({
      status: response.status,
      ok: response.ok,
      contentType,
      redirected: response.redirected,
      url: response.url,
    }),
  )

  let data: Partial<ChatApiSuccess> & ChatApiErrorBody = {}
  let rawText = ''
  try {
    rawText = await response.text()
    if (rawText.trim()) {
      data = JSON.parse(rawText) as Partial<ChatApiSuccess> & ChatApiErrorBody
    }
    console.log(
      '[chatApi] parse ok',
      JSON.stringify({
        keys: Object.keys(data || {}),
        contentLen: typeof data.content === 'string' ? data.content.length : 0,
        hasError: Boolean(data.error),
      }),
    )
  } catch (parseError) {
    console.error('[chatApi] parse failed', {
      contentType,
      preview: rawText.slice(0, 240),
      parseError,
    })
    if (!response.ok) {
      throw new ChatApiError(
        `Chat API request failed (${response.status}) — non-JSON body`,
        response.status,
      )
    }
    throw new ChatApiError(
      'Chat API returned invalid JSON (expected { content: string })',
      response.status,
    )
  }

  if (!response.ok) {
    const nested =
      data &&
      typeof data === 'object' &&
      data.error &&
      typeof data.error === 'object' &&
      data.error !== null &&
      'message' in (data.error as object)
        ? String((data.error as { message?: unknown }).message || '')
        : ''
    throw new ChatApiError(
      (typeof data.error === 'string' && data.error.trim()) ||
        nested ||
        `Chat API request failed (${response.status})`,
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
    conversationMemoryMap: sanitizeConversationMemoryMap(data.conversationMemoryMap),
    conversationPreferenceProfile: sanitizeConversationPreferenceProfile(
      data.conversationPreferenceProfile,
    ),
  }
}
