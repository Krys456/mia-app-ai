import {
  sanitizeLearningSignals,
  type LearningSignals,
} from './learningSignals'
import { sanitizeConversationMemoryMap } from './conversationMemoryMap'
import { sanitizeConversationPreferenceProfile } from './conversationPreferenceProfile'
import { resolveChatAuthForRequest } from './chatAuth'
import {
  parseMemoryFeedbackEvent,
  type MemoryFeedbackEvent,
} from './memoryFeedback'
import type { V2DebugInfo, WebCitation } from '../types'
import {
  parseApiErrorResponse,
  USER_NETWORK_ERROR,
  USER_SESSION_FAILED,
  withErrorReference,
} from './apiError'

export type { MemoryFeedbackEvent } from './memoryFeedback'

export type ChatApiRole = 'user' | 'assistant' | 'system'

export interface ChatApiImageAttachment {
  type: 'image'
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | string
  dataUrl: string
  /** #289 — assistant replay requires generated|edited + artifactProof. */
  source?: 'generated' | 'edited' | 'uploaded'
  id?: string
  artifactProof?: string
}

export interface ChatApiFileAttachment {
  type: 'file'
  fileId: string
  name: string
  mimeType:
    | 'application/pdf'
    | 'text/plain'
    | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    | string
  size: number
}

export interface ChatApiMessage {
  role: ChatApiRole
  content: string
  /** Optional attachments (#272 image / #275 PDF). Max 1; image XOR file. */
  attachments?: Array<ChatApiImageAttachment | ChatApiFileAttachment>
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
  /**
   * #289 session-only generated/edited images from the hosted image_generation tool.
   * Only present when the server parsed a real tool result — never client-spoofed.
   */
  images?: ChatApiGeneratedImage[]
  /** #291 optional normalized citations from url_citation annotations. */
  citations?: WebCitation[]
  /** Conversational core for this response (`core` = single-prompt path). */
  runtime?: 'core' | 'v1' | 'v2'
  memoriesSaved?: number
  /** Ephemeral UI hint when auto-memory actually wrote/changed something (#281). */
  memoryEvent?: MemoryFeedbackEvent | null
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

/** Server-authored image artifact from /api/chat (#289). */
export interface ChatApiGeneratedImage {
  id: string
  mimeType: string
  dataUrl: string
  source: 'generated' | 'edited'
  /** HMAC proof — required for assistant history replay. */
  artifactProof: string
  providerCallId?: string
  width?: number
  height?: number
}

export interface ChatApiErrorBody {
  error?: string
  code?: string
  requestId?: string
  retryAfter?: number
}

export class ChatApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly requestId?: string
  readonly retryAfter?: number

  constructor(
    message: string,
    status: number,
    opts?: { code?: string; requestId?: string; retryAfter?: number },
  ) {
    super(message)
    this.name = 'ChatApiError'
    this.status = status
    this.code = opts?.code
    this.requestId = opts?.requestId
    this.retryAfter = opts?.retryAfter
  }
}

function resolveChatEndpoint(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  if (!base) return '/api/chat'
  return `${base.replace(/\/$/, '')}/api/chat`
}

function describeFetchFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  // Browsers surface CORS / network / SSO redirects as the opaque "Failed to fetch".
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return USER_NETWORK_ERROR
  }
  return raw || USER_NETWORK_ERROR
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

  let response: Response
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(payload.userId ? { 'X-LAIfe-User-Id': payload.userId } : {}),
    }

    // #298A — paid /api/chat requires Bearer; do not call without a session token.
    const auth = await resolveChatAuthForRequest()
    if (!auth.authorization) {
      throw new ChatApiError(USER_SESSION_FAILED, 401, { code: 'missing_token' })
    }
    headers.Authorization = auth.authorization

    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      // Same-origin credentials for preview/prod cookies when protection is enabled.
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
    if (import.meta.env.DEV) {
      console.error('[chatApi] fetch threw', error instanceof Error ? error.name : 'unknown')
    }
    throw new ChatApiError(describeFetchFailure(error), 0)
  }

  let data: Partial<ChatApiSuccess> & ChatApiErrorBody = {}
  let rawText = ''
  try {
    rawText = await response.text()
    if (rawText.trim()) {
      data = JSON.parse(rawText) as Partial<ChatApiSuccess> & ChatApiErrorBody
    }
  } catch {
    const headerId = response.headers.get('X-Request-Id')?.trim() || undefined
    if (!response.ok) {
      throw new ChatApiError(
        withErrorReference(
          `Chat API request failed (${response.status}) — non-JSON body`,
          headerId,
        ),
        response.status,
        { requestId: headerId },
      )
    }
    throw new ChatApiError(
      withErrorReference(
        'Chat API returned invalid JSON (expected { content: string })',
        headerId,
      ),
      response.status,
      { requestId: headerId },
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
    const parsed = parseApiErrorResponse(
      response,
      data,
      nested || `Chat API request failed (${response.status})`,
    )
    throw new ChatApiError(withErrorReference(parsed.message, parsed.requestId), parsed.status, {
      code: parsed.code,
      requestId: parsed.requestId,
      retryAfter: parsed.retryAfter,
    })
  }

  const content = typeof data.content === 'string' ? data.content.trim() : ''
  const images = sanitizeChatApiImages(data.images)
  const citations = sanitizeChatApiCitations(data.citations)
  if (!content && images.length === 0) {
    throw new ChatApiError('Chat API returned an empty reply', response.status)
  }

  const memoryEvent = parseMemoryFeedbackEvent(data.memoryEvent)

  const v2Debug = sanitizeV2Debug(data.v2Debug)

  return {
    content,
    ...(images.length ? { images } : {}),
    ...(citations.length ? { citations } : {}),
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
 * Accept only well-formed http(s) citations (max 5). Never invent from free text.
 */
function sanitizeChatApiCitations(raw: unknown): WebCitation[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const out: WebCitation[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const urlRaw = typeof row.url === 'string' ? row.url.trim() : ''
    if (!urlRaw) continue
    let url: string
    try {
      const parsed = new URL(urlRaw)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
      url = parsed.toString()
    } catch {
      continue
    }
    const key = url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const title =
      typeof row.title === 'string' && row.title.trim()
        ? row.title.replace(/\s+/g, ' ').trim().slice(0, 160)
        : (() => {
            try {
              return new URL(url).hostname
            } catch {
              return 'Fonte'
            }
          })()
    const citation: WebCitation = { title, url }
    if (typeof row.startIndex === 'number' && Number.isFinite(row.startIndex)) {
      citation.startIndex = row.startIndex
    }
    if (typeof row.endIndex === 'number' && Number.isFinite(row.endIndex)) {
      citation.endIndex = row.endIndex
    }
    out.push(citation)
    if (out.length >= 5) break
  }
  return out
}

/**
 * Accept only well-formed server image payloads (max 1). Never trust client-shaped spoofs
 * beyond structural validation of the JSON response field.
 * @param {unknown} raw
 * @returns {ChatApiGeneratedImage[]}
 */
function sanitizeChatApiImages(raw: unknown): ChatApiGeneratedImage[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const out: ChatApiGeneratedImage[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const img = item as Record<string, unknown>
    const dataUrl = typeof img.dataUrl === 'string' ? img.dataUrl.trim() : ''
    const mimeType = typeof img.mimeType === 'string' ? img.mimeType.trim().toLowerCase() : ''
    const source = img.source === 'edited' ? 'edited' : img.source === 'generated' ? 'generated' : null
    const artifactProof =
      typeof img.artifactProof === 'string' ? img.artifactProof.trim() : ''
    if (!source) continue
    if (!artifactProof || !/^[a-f0-9]{64}$/i.test(artifactProof)) continue
    if (!/^data:image\/(jpeg|png|webp);base64,/i.test(dataUrl)) continue
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/png' && mimeType !== 'image/webp') continue
    const id =
      typeof img.id === 'string' && img.id.trim()
        ? img.id.trim().slice(0, 120)
        : `gen-${out.length + 1}`
    /** @type {ChatApiGeneratedImage} */
    const entry: ChatApiGeneratedImage = {
      id,
      mimeType,
      dataUrl,
      source,
      artifactProof,
    }
    if (typeof img.providerCallId === 'string' && img.providerCallId.trim()) {
      entry.providerCallId = img.providerCallId.trim().slice(0, 120)
    }
    if (typeof img.width === 'number' && Number.isFinite(img.width)) entry.width = img.width
    if (typeof img.height === 'number' && Number.isFinite(img.height)) entry.height = img.height
    out.push(entry)
    if (out.length >= 1) break
  }
  return out
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
