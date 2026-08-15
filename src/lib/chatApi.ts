import {
  sanitizeLearningSignals,
  type LearningSignals,
} from './learningSignals'
import { sanitizeConversationMemoryMap } from './conversationMemoryMap'
import { sanitizeConversationPreferenceProfile } from './conversationPreferenceProfile'
import { getSupabase, isSupabaseConfigured } from './supabase'
import type { V2DebugInfo } from '../types'

export type ChatApiRole = 'user' | 'assistant' | 'system'

export interface ChatApiMessage {
  role: ChatApiRole
  content: string
}

export type { LearningSignals }

export interface ChatApiRequest {
  messages: ChatApiMessage[]
  /** Optional; ignored by the new core (prompt is server-side). Kept for compat. */
  systemPrompt?: string
  userId?: string
  memoryEnabled?: boolean
  /** Legacy — ignored by the new core. */
  engine?: 'v1' | 'v2'
  /** Legacy — ignored by the new core. */
  developerMode?: boolean
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
  /** Soft style bias (automatic | friendly | …). */
  personalityBias?: string
  replyLength?: 'concise' | 'balanced' | 'detailed'
  useEmojis?: boolean
  customInstructions?: string
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
  /** Conversational core for this response (`core` = single-prompt path). */
  runtime?: 'core' | 'v1' | 'v2'
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
  /** Developer debug — present when the server returns a V2 debug snapshot. */
  v2Debug?: V2DebugInfo | null
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
      memoryEnabled: payload.memoryEnabled !== false,
      personalityBias: payload.personalityBias || null,
      replyLength: payload.replyLength || null,
    }),
  )

  let response: Response
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(payload.userId ? { 'X-LAIfe-User-Id': payload.userId } : {}),
    }

    // Memory ownership authority: Supabase access token (server verifies auth.uid()).
    if (isSupabaseConfigured()) {
      try {
        const { data, error } = await getSupabase().auth.getSession()
        if (!error) {
          const token = data.session?.access_token?.trim()
          if (token) headers.Authorization = `Bearer ${token}`
        }
      } catch {
        // Soft: chat still works; server skips memory write without a valid JWT.
      }
    }

    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      // Needed for Vercel Deployment Protection cookies on preview/prod.
      credentials: 'include',
      body: JSON.stringify({
        messages: payload.messages,
        userId: payload.userId,
        memoryEnabled: payload.memoryEnabled !== false,
        ...(payload.learningSignals ? { learningSignals: payload.learningSignals } : {}),
        ...(payload.modality ? { modality: payload.modality } : {}),
        ...(payload.voice ? { voice: true } : {}),
        ...(payload.voiceSession ? { voiceSession: payload.voiceSession } : {}),
        ...(payload.welcomeSession ? { welcomeSession: payload.welcomeSession } : {}),
        ...(payload.displayName ? { displayName: payload.displayName } : {}),
        ...(payload.personalityBias ? { personalityBias: payload.personalityBias } : {}),
        ...(payload.replyLength ? { replyLength: payload.replyLength } : {}),
        ...(typeof payload.useEmojis === 'boolean' ? { useEmojis: payload.useEmojis } : {}),
        ...(payload.customInstructions
          ? { customInstructions: payload.customInstructions }
          : {}),
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

  const v2Debug = sanitizeV2Debug(data.v2Debug)

  return {
    content,
    runtime:
      data.runtime === 'core'
        ? 'core'
        : data.runtime === 'v2'
          ? 'v2'
          : data.runtime === 'v1'
            ? 'v1'
            : undefined,
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
    v2Debug,
  }
}

/**
 * @param {unknown} raw
 * @returns {V2DebugInfo | null}
 */
function sanitizeV2Debug(raw: unknown): V2DebugInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  if (d.servedBy !== 'v2' && d.servedBy !== 'v1-fallback') return null
  return {
    servedBy: d.servedBy,
    ...(typeof d.error === 'string' ? { error: d.error } : {}),
    ...(d.perception && typeof d.perception === 'object'
      ? { perception: d.perception as Record<string, unknown> }
      : {}),
    ...(d.decision && typeof d.decision === 'object'
      ? { decision: d.decision as Record<string, unknown> }
      : {}),
    ...(d.plan && typeof d.plan === 'object' ? { plan: d.plan as Record<string, unknown> } : {}),
    ...(d.writer && typeof d.writer === 'object'
      ? { writer: d.writer as V2DebugInfo['writer'] }
      : {}),
    ...(d.reviewer && typeof d.reviewer === 'object'
      ? { reviewer: d.reviewer as Record<string, unknown> }
      : {}),
    ...(d.timing && typeof d.timing === 'object'
      ? { timing: d.timing as V2DebugInfo['timing'] }
      : {}),
    ...(typeof d.score === 'number' ? { score: d.score } : {}),
    ...(typeof d.reviewDecision === 'string' ? { reviewDecision: d.reviewDecision } : {}),
  }
}
