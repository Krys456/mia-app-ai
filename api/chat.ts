/**
 * LAIfe /api/chat — new conversational core.
 *
 * One OpenAI call + one unified system prompt (LAIFE_BASE_SYSTEM_PROMPT).
 * No Cognitive Engine, no V1/V2 pipeline, no post-generation refine chain.
 * Trust the model; do not cage it.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { buildCoreResponsesCreateParams } from '../lib/server/core-responses-params.js'
import { requirePaidApiAccess } from '../lib/server/paid-api-guard.js'
import {
  decideDocumentsEntitlement,
  decideImageGenerationTools,
  decideVisionEntitlement,
  decideWebSearchTools,
  loadUserEntitlementsAsync,
} from '../lib/server/entitlement-gates.js'
import { syncPublicUserProfile } from '../lib/server/brain-memory.js'
import { getServiceSupabase } from '../lib/server/supabase.js'
import {
  appendMemoryPackToInstructions,
  isPersonalMemoryProbe,
  loadCoreMemoryPack,
} from '../lib/server/core-memory-recall.js'
import { applyCors, sendCorsPreflight, sendJson, SAFE_UPSTREAM_ERROR, SAFE_INTERNAL_ERROR } from '../lib/server/http.js'
import { safeErrorSnippet } from '../lib/server/safe-log.js'
import { buildCoreContinuityAppendix } from '../lib/server/conversation-continuity.js'
import { buildCoreConversationalUnderstandingAppendix } from '../lib/server/conversational-understanding.js'
import { buildCoreAdaptiveResponseReasoningAppendix } from '../lib/server/adaptive-response-reasoning.js'
import { LAIFE_BASE_SYSTEM_PROMPT } from '../lib/server/laife-base-system-prompt.js'
import { buildCoreLanguageAppendix } from '../lib/server/language-awareness.js'
import {
  buildReferenceContextAppendix,
  buildReferenceContextDiagPayload,
  deriveReferenceContext,
  REFERENCE_CONTEXT_BUILD,
} from '../lib/server/core-reference-context.js'
import {
  buildConversationWorkingStateAppendix,
  deriveConversationWorkingState,
} from '../lib/server/core-working-state.js'
import {
  buildNaturalResponsePolicyAppendix,
  isNaturalResponseDiagEnabled,
  buildNaturalResponseDiagPayload,
} from '../lib/server/natural-response-policy.js'
import {
  mapMessagesToResponsesInput,
  modelSupportsFileInput,
  modelSupportsImageInput,
  redactAttachmentsForLog,
  sanitizeMultimodalMessages,
  summarizeImageForLog,
  visibleUserText,
} from '../lib/server/chat-image-input.js'
import { summarizePdfForLog } from '../lib/server/chat-pdf-files.js'
import { isVisionTaskShortcut } from '../lib/server/vision-task-shortcuts.js'
import {
  buildImageGenerationAppendix,
  buildImageGenerationTools,
  contentClaimsImageWithoutPayload,
  modelSupportsImageGenerationTool,
  parseImageGenerationCalls,
  toChatApiImages,
} from '../lib/server/image-generation.js'
import { sealChatApiImages } from '../lib/server/image-artifact-proof.js'
import {
  buildWebSearchAppendix,
  buildWebSearchTools,
  detectExplicitWebSearchIntent,
  extractUrlCitations,
  modelSupportsWebSearchTool,
  responseUsedWebSearch,
} from '../lib/server/web-search.js'
import { selectLatestVisionSearchContext } from '../lib/server/vision-search-context.js'
import { detectVisionSearchIntent } from '../lib/server/vision-search-intent.js'
import {
  buildVisionSearchAppendix,
  buildVisionSearchQuery,
} from '../lib/server/vision-search-query.js'
import {
  buildVisionSearchDiagPayload,
  isVisionSearchDiagEnabled,
} from '../lib/server/vision-search-diag.js'
import {
  fileIdBelongsToConversation,
  isDocumentFileExpired,
  selectLatestActiveDocument,
  summarizeActiveDocumentForLog,
} from '../lib/server/document-chat-context.js'
import { detectDocumentReferenceIntent } from '../lib/server/document-chat-intent.js'
import {
  buildDocumentChatAppendix,
  documentExpiredUserMessage,
} from '../lib/server/document-chat-appendix.js'
import { buildPhoneActionCapabilityAppendix } from '../lib/server/phone-action-capability-appendix.js'
import {
  buildDocumentChatDiagPayload,
  isDocumentChatDiagEnabled,
} from '../lib/server/document-chat-diag.js'
import { resolveVisionStickyLang } from '../lib/server/vision-task-shortcuts.js'
import {
  buildConversationStateAppendix,
  buildConversationStateDiagPayload,
  buildStyleAvoidAppendix,
  buildStyleVarietyDiagPayload,
  computeConversationState,
  isConversationStateDiagEnabled,
  sanitizeSessionStyleState,
} from '../lib/server/conversation-state.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 120,
}

type ChatRole = 'user' | 'assistant' | 'system'

interface ChatApiImageAttachment {
  type: 'image'
  mimeType: string
  dataUrl: string
}

interface ChatApiFileAttachment {
  type: 'file'
  fileId: string
  name: string
  mimeType: string
  size: number
  expiresAt?: number
}

interface ChatApiMessage {
  role: ChatRole
  content: string
  attachments?: Array<ChatApiImageAttachment | ChatApiFileAttachment>
}

interface ChatApiRequestBody {
  messages?: ChatApiMessage[]
  /** Ignored by the new core — prompt lives server-side. Kept for client compat. */
  systemPrompt?: string
  userId?: string
  memoryEnabled?: boolean
  modality?: 'text' | 'voice'
  voice?: boolean
  voiceSession?: Record<string, unknown> | null
  welcomeSession?: Record<string, unknown> | null
  displayName?: string
  personalityBias?: string
  replyLength?: 'concise' | 'balanced' | 'detailed'
  useEmojis?: boolean
  customInstructions?: string
  lifeContext?: Record<string, unknown> | null
  pendingAutomation?: Record<string, unknown> | null
  conversationMemoryMap?: Record<string, unknown> | null
  conversationPreferenceProfile?: Record<string, unknown> | null
  conversationId?: string
  learningSignals?: unknown
  /** #326 — session-only recent Core presentation fingerprints (never Memory). */
  sessionStyle?: Record<string, unknown> | null
  /** #326 — opt-in style variety diagnostics (Preview). */
  styleVarietyDiag?: boolean | 1 | '1'
  /** #312 — opt-in Vision × Search diagnostics (Preview). */
  visionSearchDiag?: boolean | 1 | '1'
  /** #313 — opt-in document-chat diagnostics (Preview). */
  documentDiag?: boolean | 1 | '1'
  /** #324 — opt-in Conversation State diagnostics (Preview / development). */
  conversationStateDiag?: boolean | 1 | '1'
  /** #325 — opt-in Natural Response Policy diagnostics (Preview / development). */
  naturalResponseDiag?: boolean | 1 | '1'
  /** #313 — client dismissed active document until next upload. */
  suppressActiveDocumentReuse?: boolean
  /** Optional browser locale — final language fallback only when turn+sticky are uncertain. */
  browserLocale?: string
  locale?: string
  /** Legacy V1/V2 flags — ignored by the new core. */
  developerMode?: boolean
  engine?: 'v1' | 'v2'
}

const PERSONALITY_BIAS: Record<string, string> = {
  automatic:
    'Style bias (modifier only — still ShinkAIdo): adaptive. No fixed tint — match tone and energy to the moment.',
  friendly:
    'Style bias (modifier only — still ShinkAIdo): light warmth. Lean toward closeness without forced friendship.',
  professional:
    'Style bias (modifier only — still ShinkAIdo): restraint. Lean toward clarity and next steps. No bureaucracy.',
  teacher:
    'Style bias (modifier only — still ShinkAIdo): teaching. Prefer progressive steps when explaining — do not turn every turn into a lesson.',
  analytical:
    'Style bias (modifier only — still ShinkAIdo): analytical. Lean toward structure and fact/estimate distinction without mechanical coldness.',
  motivational:
    'Style bias (modifier only — still ShinkAIdo): momentum. Lean toward concrete energy and realistic next steps when they fit. Never slogans.',
}

/** Caption-only view for Memory control helpers that expect string history. */
function toTextOnlyMessages(messages: ChatApiMessage[]): Array<{ role: ChatRole; content: string }> {
  return messages.map((m) => ({ role: m.role, content: m.content }))
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

interface CoreInstructionBundle {
  instructions: string
  conversationState: ReturnType<typeof computeConversationState>
  conversationStateAppendixChars: number
  styleAvoidAppendixChars: number
  sessionStyleReceived: boolean
  naturalResponsePolicyChars: number
  expressionInjected: boolean
  proactiveInjected: boolean
  continuityChars: number
  understandingChars: number
  adaptiveChars: number
  phoneCapabilityInjected: boolean
  referenceContextAppendixChars: number
  referenceContext: ReturnType<typeof deriveReferenceContext>
}

function buildInstructions(body: ChatApiRequestBody, messages: ChatApiMessage[] = []): CoreInstructionBundle {
  const parts: string[] = [LAIFE_BASE_SYSTEM_PROMPT]

  const displayName =
    typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 40) : ''
  if (displayName) {
    parts.push(
      `Il nome dell'utente è ${displayName}. Usalo in modo naturale quando ha senso, senza ripeterlo a ogni frase.`,
    )
  }

  const biasKey =
    typeof body.personalityBias === 'string' ? body.personalityBias.trim().toLowerCase() : ''
  if (biasKey && PERSONALITY_BIAS[biasKey]) {
    parts.push(PERSONALITY_BIAS[biasKey])
  }

  const latestUser = [...messages].reverse().find((m) => m.role === 'user')
  const latestUserText = visibleUserText(latestUser)

  // #324/#325 — Conversation State consumes settings; do not also inject LENGTH/emoji prose.
  const textMessages = toTextOnlyMessages(messages)
  const workingState = deriveConversationWorkingState(textMessages)
  const sessionStyleReceived = body.sessionStyle != null && typeof body.sessionStyle === 'object'
  const sessionStyle = sanitizeSessionStyleState(body.sessionStyle)
  const conversationState = computeConversationState({
    userMessage: latestUserText,
    recentMessages: textMessages,
    settings: {
      replyLength: body.replyLength ?? null,
      useEmojis: typeof body.useEmojis === 'boolean' ? body.useEmojis : null,
    },
    workingState,
    sessionStyle,
  })

  const custom =
    typeof body.customInstructions === 'string'
      ? body.customInstructions.trim().slice(0, 2000)
      : ''
  if (custom) {
    parts.push(`Istruzioni personalizzate dell'utente (rispettale quando possibili):\n${custom}`)
  }

  // #324 — Conversation State (authoritative for current-turn presentation).
  const conversationStateAppendix = buildConversationStateAppendix(conversationState)
  if (conversationStateAppendix) {
    parts.push(conversationStateAppendix)
  }

  // #326 — Recent style soft avoid (never outranks State / emotion / explicit user).
  const styleAvoidAppendix = buildStyleAvoidAppendix(sessionStyle, conversationState)
  if (styleAvoidAppendix) {
    parts.push(styleAvoidAppendix)
  }

  // #325 — Natural Response Policy (consumes State; replaces Expression + Proactive style).
  const naturalResponsePolicyAppendix = buildNaturalResponsePolicyAppendix()
  if (naturalResponsePolicyAppendix) {
    parts.push(naturalResponsePolicyAppendix)
  }

  // #315B — Phone capability truth (conditional after #325).
  const phoneCapabilityAppendix = buildPhoneActionCapabilityAppendix({
    userMessage: latestUserText,
    recentMessages: textMessages,
  })
  const phoneCapabilityInjected = Boolean(phoneCapabilityAppendix)
  if (phoneCapabilityAppendix) {
    parts.push(phoneCapabilityAppendix)
  }

  // Ephemeral LANGUAGE appendix — reply-language only.
  const languageAppendix = buildCoreLanguageAppendix({
    userMessage: latestUserText,
    messages: textMessages,
    browserLocale:
      (typeof body.browserLocale === 'string' && body.browserLocale) ||
      (typeof body.locale === 'string' && body.locale) ||
      '',
  })
  if (languageAppendix) {
    parts.push(languageAppendix)
  }

  // Continuity (#263, slimmed #325) — referents / repair / anti-fabrication.
  const continuityAppendix = buildCoreContinuityAppendix()
  if (continuityAppendix) {
    parts.push(continuityAppendix)
  }

  // Understanding (#286) — multi-part / ambiguity / corrections.
  const understandingAppendix = buildCoreConversationalUnderstandingAppendix()
  if (understandingAppendix) {
    parts.push(understandingAppendix)
  }

  // Adaptive Reasoning (#288) — epistemic honesty / evidence updates.
  const adaptiveReasoningAppendix = buildCoreAdaptiveResponseReasoningAppendix()
  if (adaptiveReasoningAppendix) {
    parts.push(adaptiveReasoningAppendix)
  }

  // Reference Context (#279/#328) — conditional.
  const referenceContext = deriveReferenceContext(messages)
  const referenceContextAppendix = buildReferenceContextAppendix(messages)
  if (referenceContextAppendix) {
    parts.push(referenceContextAppendix)
  }

  // Working State (#278) — conditional.
  const workingStateAppendix = buildConversationWorkingStateAppendix(textMessages)
  if (workingStateAppendix) {
    parts.push(workingStateAppendix)
  }

  // Expression (#284) and Proactive (#285) are no longer injected — migrated into NRP (#325).

  return {
    instructions: parts.join('\n\n'),
    conversationState,
    conversationStateAppendixChars: conversationStateAppendix.length,
    styleAvoidAppendixChars: styleAvoidAppendix ? styleAvoidAppendix.length : 0,
    sessionStyleReceived,
    naturalResponsePolicyChars: naturalResponsePolicyAppendix.length,
    expressionInjected: false,
    proactiveInjected: false,
    continuityChars: continuityAppendix ? continuityAppendix.length : 0,
    understandingChars: understandingAppendix ? understandingAppendix.length : 0,
    adaptiveChars: adaptiveReasoningAppendix ? adaptiveReasoningAppendix.length : 0,
    phoneCapabilityInjected,
    referenceContextAppendixChars: referenceContextAppendix ? referenceContextAppendix.length : 0,
    referenceContext,
  }
}

function appendImageGenerationGuidance(instructions: string, model: string): string {
  if (!modelSupportsImageGenerationTool(model)) return instructions
  const appendix = buildImageGenerationAppendix()
  return appendix ? `${instructions}\n\n${appendix}` : instructions
}

function appendWebSearchGuidance(instructions: string, model: string): string {
  if (!modelSupportsWebSearchTool(model)) return instructions
  const appendix = buildWebSearchAppendix()
  return appendix ? `${instructions}\n\n${appendix}` : instructions
}

/**
 * Build hosted tool list + optional tool_choice for this turn.
 * Narrow explicit search / no-search detector only — not a freshness classifier.
 * #312 — `forceWebSearch` bridges Vision context into the same hosted web_search tool.
 * #332C — when enforcement ON: explicit webSearch require denies; optional tools soft-omit.
 */
function resolveHostedToolsForTurn(
  model: string,
  lastUserCaption: string,
  options: {
    forceWebSearch?: boolean
    entitlements?: Parameters<typeof decideVisionEntitlement>[0]['entitlements']
    enforcementEnabled?: boolean
  } = {},
) {
  const intent = detectExplicitWebSearchIntent(lastUserCaption)
  const forceWebSearch = options.forceWebSearch === true
  const omitWebSearch = intent === 'forbid' && !forceWebSearch
  let webTools: unknown[] = omitWebSearch ? [] : buildWebSearchTools(model)
  let imageTools: unknown[] = buildImageGenerationTools(model)
  /** @type {unknown | undefined} */
  let toolChoice: unknown | undefined
  if ((intent === 'require' || forceWebSearch) && webTools.length > 0) {
    // Force hosted web_search for explicit "Cerca sul web…" / Vision×Search (#312).
    toolChoice = { type: 'web_search' }
  }

  let denial: { error: string; code: 'entitlement_required'; entitlement: string; requiredPlan?: string } | null =
    null
  if (options.entitlements) {
    const webDecision = decideWebSearchTools({
      intent: intent || 'optional',
      forceWebSearch,
      webTools,
      entitlements: options.entitlements,
      enforcementEnabled: options.enforcementEnabled,
    })
    if (webDecision.mode === 'deny' && webDecision.decision && !webDecision.decision.allowed) {
      return {
        tools: [] as unknown[],
        toolChoice: undefined as unknown,
        intent,
        forceWebSearch,
        denial: webDecision.decision.body,
      }
    }
    webTools = webDecision.webTools
    if (webTools.length === 0) toolChoice = undefined

    const imageDecision = decideImageGenerationTools({
      imageTools,
      entitlements: options.entitlements,
      enforcementEnabled: options.enforcementEnabled,
    })
    imageTools = imageDecision.imageTools
  }

  const tools = [...webTools, ...imageTools]
  return { tools, toolChoice, intent, forceWebSearch, denial }
}

function resolveChatModel(env: NodeJS.ProcessEnv = process.env): string {
  const raw = typeof env.OPENAI_MODEL === 'string' ? env.OPENAI_MODEL.trim() : ''
  // Common typo: digit zero instead of letter o (gpt-40 → gpt-4o).
  const normalized = raw.replace(/\bgpt-40\b/gi, 'gpt-4o')
  return normalized || 'gpt-4o'
}

type MemoryFeedbackEvent =
  | {
      type: 'created' | 'updated' | 'removed'
      displayText?: string
    }
  | null

async function runMemoryIfEnabled(
  userMessage: string,
  assistantMessage: string,
  memoryEnabled: boolean,
  ownerUserId: string | null,
): Promise<{ event: MemoryFeedbackEvent }> {
  if (!memoryEnabled || !ownerUserId) {
    return { event: null }
  }

  try {
    const { runMemoryPipeline } = await import('../lib/server/brain-memory.js')
    const { mapMemoryPipelineToFeedbackEvent } = await import(
      '../lib/server/memory-feedback-event.js'
    )

    const result = await runMemoryPipeline({
      userMessage,
      assistantMessage,
      memoryEnabled: true,
      userId: ownerUserId,
      requireExplicitUserId: true,
    })

    return { event: mapMemoryPipelineToFeedbackEvent(result) }
  } catch (error) {
    console.warn(
      '[api/chat] memory write skipped:',
      error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    )
    return { event: null }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, req)

  if (req.method === 'OPTIONS') {
    return sendCorsPreflight(res, req)
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed' }, req)
  }

  // #298A — auth + durable rate limit BEFORE OpenAI / body work.
  // Chat itself stays Free (coreChat); premium tools gated later (#332C).
  const access = await requirePaidApiAccess(req, res, { bucket: 'chat' })
  if (!access) return undefined

  // #332D — async load; DB hit only when ENTITLEMENT_ENFORCEMENT_ENABLED is ON.
  const { entitlements } = await loadUserEntitlementsAsync(access.userId)

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return sendJson(res, 500, {
      error: SAFE_INTERNAL_ERROR,
      code: 'misconfigured',
    }, req)
  }

  let body: ChatApiRequestBody
  try {
    body = parseBody(req)
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body' }, req)
  }

  const sanitized = sanitizeMultimodalMessages(body.messages)
  // Explicit discriminant: Vercel backends typecheck (root tsconfig, strict off)
  // does not narrow after `!sanitized.ok`.
  if (sanitized.ok === false) {
    console.warn(
      '[api/chat] multimodal sanitize rejected',
      redactAttachmentsForLog({
        code: sanitized.code,
        attachmentSummary: Array.isArray(body.messages)
          ? body.messages.map((m) => ({
              role: m?.role,
              contentLen: typeof m?.content === 'string' ? m.content.length : 0,
              attachmentCount: Array.isArray(m?.attachments) ? m.attachments.length : 0,
              attachments: Array.isArray(m?.attachments)
                ? m.attachments.map((a) => summarizeImageForLog(a ?? {}))
                : [],
            }))
          : null,
      }),
    )
    return sendJson(res, 400, { error: sanitized.error, code: sanitized.code }, req)
  }
  const messages = sanitized.messages.filter(
    (msg) => msg.role === 'user' || msg.role === 'assistant',
  )
  if (messages.length === 0) {
    return sendJson(res, 400, { error: 'messages must be a non-empty array' }, req)
  }

  const memoryEnabled = body.memoryEnabled !== false
  const modality =
    body.modality === 'voice' || body.voice === true
      ? 'voice'
      : body.modality === 'text'
        ? 'text'
        : undefined

  // #298A — memory ownership is the verified JWT user (never client userId).
  // #332E2 — sync recoverable email onto public.users when durable (same id).
  let memoryOwnerUserId: string | null = null
  try {
    const supabase = await getServiceSupabase()
    memoryOwnerUserId = await syncPublicUserProfile(supabase, access.userId, {
      email: access.email ?? null,
    })
  } catch (error) {
    console.warn(
      '[api/chat] ensureAuthUserRow failed:',
      error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    )
    memoryOwnerUserId = access.userId
  }

  try {
    const lastUserMessage = [...messages].reverse().find((msg) => msg.role === 'user')
    const lastUserCaption = visibleUserText(lastUserMessage)
    const lastUserAttachments = lastUserMessage?.attachments ?? []
    const lastUserHasImage = lastUserAttachments.some((a) => a.type === 'image')
    const lastUserHasFile = lastUserAttachments.some((a) => a.type === 'file')
    const lastUserHasAttachment = lastUserHasImage || lastUserHasFile
    const model = resolveChatModel(process.env)

    if (lastUserHasImage && !modelSupportsImageInput(model)) {
      console.warn(
        '[api/chat] image rejected: model lacks vision',
        redactAttachmentsForLog({
          model,
          attachments: lastUserAttachments,
        }),
      )
      return sendJson(res, 400, {
        error:
          'Questo modello non supporta le immagini. Invia solo testo, oppure configura un modello con vision (es. GPT-5.6 Sol / GPT-4o).',
        code: 'image_unsupported_model',
      }, req)
    }

    // #332C — Vision entitlement (image turns only). Text Core chat stays Free.
    {
      const visionDecision = decideVisionEntitlement({
        hasImage: lastUserHasImage,
        entitlements,
      })
      if (visionDecision.allowed === false && 'body' in visionDecision) {
        return sendJson(res, 403, visionDecision.body, req)
      }
    }

    if (lastUserHasFile && !modelSupportsFileInput(model)) {
      console.warn(
        '[api/chat] file rejected: model lacks file input',
        redactAttachmentsForLog({
          model,
          attachments: lastUserAttachments,
        }),
      )
      return sendJson(res, 400, {
        error:
          'Questo modello non supporta i documenti allegati. Invia solo testo, oppure configura un modello compatibile (es. GPT-5.6 Sol / GPT-4o).',
        code: 'file_unsupported_model',
      }, req)
    }

    if (lastUserHasAttachment) {
      console.info(
        '[api/chat] multimodal user turn',
        redactAttachmentsForLog({
          model,
          captionLen: lastUserCaption.length,
          attachmentCount: lastUserAttachments.length,
          hasImage: lastUserHasImage,
          hasFile: lastUserHasFile,
          attachments: lastUserAttachments.map((a) =>
            a.type === 'file'
              ? summarizePdfForLog({
                  name: a.name,
                  size: a.size,
                  mimeType: a.mimeType,
                  fileId: a.fileId,
                })
              : summarizeImageForLog(a),
          ),
        }),
      )
    }

    // Memory-control gate (forget-all + specific forget) before Overview / Recall /
    // Extraction / responses.create. Works even when Memory is OFF. Zero model calls
    // when handled. Caption text only — never image bytes.
    if (lastUserCaption) {
      const { tryHandleMemoryControl } = await import('../lib/server/memory-control-forget.js')
      const forget = await tryHandleMemoryControl({
        userMessage: lastUserCaption,
        userId: memoryOwnerUserId,
        messages: toTextOnlyMessages(messages),
      })
      if (forget.handled) {
        const payload: Record<string, unknown> = {
          content: forget.message,
          runtime: 'core',
          model,
          memoryEvent: null,
          memoryControl: forget.status,
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
        return sendJson(res, 200, payload, req)
      }
    }

    // Memory Overview (PR3): explicit "what do you remember about me?" inspection.
    // Runs after Forget controls, before Recall V1. Works when Memory is OFF.
    // Empty/unauth → deterministic, zero model. Non-empty → bounded pack + one Core call.
    let overviewPack = ''
    let overviewHandled = false
    if (lastUserCaption) {
      const { tryHandleMemoryOverview } = await import(
        '../lib/server/memory-control-overview.js'
      )
      const overview = await tryHandleMemoryOverview({
        userMessage: lastUserCaption,
        userId: memoryOwnerUserId,
      })
      if (overview.handled && overview.skippedModel) {
        const payload: Record<string, unknown> = {
          content: overview.message,
          runtime: 'core',
          model,
          memoryEvent: null,
          memoryControl: overview.status,
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
        return sendJson(res, 200, payload, req)
      }
      if (overview.handled && overview.pack) {
        overviewHandled = true
        overviewPack = overview.pack
      }
    }

    // Recall V1: small owner-scoped pack before the single responses.create.
    // Soft-fail inside loadCoreMemoryPack — never brain-api@local.
    // Skipped when Overview already supplied a pack (Overview is not Recall V1).
    const memoryPack = overviewHandled
      ? overviewPack
      : memoryEnabled && lastUserCaption
        ? await loadCoreMemoryPack({
            userMessage: lastUserCaption,
            ownerUserId: memoryOwnerUserId,
            memoryEnabled: true,
          })
        : ''

    // #313 — Active document continuity: reuse file_id on document-referring follow-ups.
    const browserLocale =
      (typeof body.browserLocale === 'string' && body.browserLocale) ||
      (typeof body.locale === 'string' && body.locale) ||
      ''
    const documentDiagOn = isDocumentChatDiagEnabled(req, body as Record<string, unknown>)
    const activeDoc = selectLatestActiveDocument(
      messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
        attachments: m.attachments,
      })),
    )
    const suppressDocReuse = body.suppressActiveDocumentReuse === true
    const docIntent = detectDocumentReferenceIntent(lastUserCaption || '', {
      hasActiveDocument: Boolean(activeDoc) && !suppressDocReuse,
    })
    let documentReuse: { fileId: string; mimeType?: string } | null = null
    let documentAttachedThisTurn = lastUserHasFile
    let activeDocumentReused = false
    let activeFileExpired = false
    let documentFailure: string | null = null
    let documentReferenceDetected = docIntent.refersToDocument
    let fileIncludedInModelInput = lastUserHasFile

    if (
      !lastUserHasFile &&
      !lastUserHasImage &&
      activeDoc &&
      !suppressDocReuse &&
      docIntent.shouldReuseDocument
    ) {
      if (isDocumentFileExpired(activeDoc.expiresAt)) {
        activeFileExpired = true
        documentFailure = 'active_file_expired'
        const stickyLang = resolveVisionStickyLang(
          messages.map((m) => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : '',
          })),
          browserLocale,
        )
        return sendJson(
          res,
          200,
          {
            content: documentExpiredUserMessage(stickyLang),
            runtime: 'core',
            model,
            memoryEvent: null,
            ...(documentDiagOn
              ? {
                  documentDiag: buildDocumentChatDiagPayload({
                    documentAttachedThisTurn: false,
                    activeDocumentFound: true,
                    activeDocumentReused: false,
                    activeFilename: activeDoc.filename,
                    activeFileExpired: true,
                    documentReferenceDetected: true,
                    fileIncludedInModelInput: false,
                    modelRequestReached: false,
                    modelResponseReceived: true,
                    failureCode: 'active_file_expired',
                  }),
                }
              : {}),
          },
          req,
        )
      }
      if (!fileIdBelongsToConversation(messages, activeDoc.fileId)) {
        documentFailure = 'foreign_file_id'
      } else {
        documentReuse = { fileId: activeDoc.fileId, mimeType: activeDoc.mimeType }
        activeDocumentReused = true
        fileIncludedInModelInput = true
      }
    }

    // #332C — Documents entitlement for attach + continuity reuse (rollout OFF by default).
    {
      const docsDecision = decideDocumentsEntitlement({
        hasDocument: lastUserHasFile || Boolean(documentReuse),
        entitlements,
      })
      if (docsDecision.allowed === false && 'body' in docsDecision) {
        return sendJson(res, 403, docsDecision.body, req)
      }
    }

    // #312 — Vision AI × Search: resolve visual context + NL/button intent, then
    // force the *existing* hosted web_search pipeline (no reverse-image upload).
    const visionDiagOn = isVisionSearchDiagEnabled(req, body as Record<string, unknown>)
    const visionMsgs = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : '',
      attachments: m.attachments,
    }))
    const visionCtx = selectLatestVisionSearchContext(visionMsgs)
    const visionRoute = detectVisionSearchIntent(lastUserCaption || '', {
      messages: visionMsgs,
      hasVisionContext: Boolean(visionCtx),
    })
    let visionSearchActive = false
    let visionSearchQuery = ''
    let visionSearchKind: string | null = null
    let visionSearchFailure: string | null = null
    let visionSearchContextSent = false
    const coreBundle = buildInstructions(body, messages)
    const conversationStateDiagOn = isConversationStateDiagEnabled(
      req,
      body as Record<string, unknown>,
    )
    let instructionsWithVision = appendWebSearchGuidance(
      appendImageGenerationGuidance(
        appendMemoryPackToInstructions(coreBundle.instructions, memoryPack),
        model,
      ),
      model,
    )

    if (lastUserHasFile || activeDocumentReused) {
      const docAppendix = buildDocumentChatAppendix({
        filename: activeDoc?.filename || '',
        reused: activeDocumentReused,
      })
      if (docAppendix) {
        instructionsWithVision = `${instructionsWithVision}\n\n${docAppendix}`
      }
    }

    if (visionRoute.intent === 'vision_search') {
      visionSearchKind = visionRoute.kind
      if (!visionCtx) {
        visionSearchFailure = 'no_vision_context'
      } else if (!modelSupportsWebSearchTool(model)) {
        visionSearchFailure = 'search_unavailable'
      } else {
        const built = buildVisionSearchQuery({
          kind: visionRoute.kind,
          userMessage: lastUserCaption || '',
          vision: visionCtx,
        })
        if (!built.ok || !built.query) {
          visionSearchFailure = built.code || 'query_generation_failed'
        } else {
          visionSearchQuery = built.query
          visionSearchActive = true
          const vsAppendix = buildVisionSearchAppendix({
            query: built.query,
            kind: visionRoute.kind,
            uncertain: Boolean(visionCtx.uncertain),
            visionSummary: visionCtx.summary,
          })
          if (vsAppendix) {
            instructionsWithVision = `${instructionsWithVision}\n\n${vsAppendix}`
            visionSearchContextSent = true
          }
        }
      }
    }

    const instructions = instructionsWithVision
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey })

    const mapInputOpts = {
      browserLocale,
      ...(documentReuse ? { reuseDocument: documentReuse } : {}),
    }

    const hosted = resolveHostedToolsForTurn(model, lastUserCaption || '', {
      forceWebSearch: visionSearchActive,
      entitlements,
    })
    if (hosted.denial) {
      return sendJson(res, 403, hosted.denial, req)
    }
    const hostedTools = hosted.tools
    const toolChoice = hosted.toolChoice
    let existingSearchInvoked = false
    let searchResultCount = 0
    let finalResponseReceived = false
    let webSearchUsed: boolean | null = null
    let modelRequestReached = false
    let response: Awaited<ReturnType<typeof client.responses.create>>
    try {
      modelRequestReached = true
      response = await client.responses.create(
        buildCoreResponsesCreateParams({
          model,
          instructions,
          maxOutputTokens: modality === 'voice' ? 700 : 4096,
          input: mapMessagesToResponsesInput(messages, mapInputOpts),
          ...(hostedTools.length ? { tools: hostedTools } : {}),
          ...(toolChoice != null ? { toolChoice } : {}),
        }),
      )
      existingSearchInvoked = visionSearchActive
      finalResponseReceived = true
      webSearchUsed = responseUsedWebSearch(response)
    } catch (upstreamErr) {
      if (visionSearchActive) {
        visionSearchFailure = 'search_unavailable'
        console.warn(
          '[api/chat] vision-search upstream failed:',
          safeErrorSnippet(upstreamErr),
        )
        // Soft-fail: keep Vision answer path by retrying without forced search.
        const retryImageTools = decideImageGenerationTools({
          imageTools: buildImageGenerationTools(model),
          entitlements,
        }).imageTools
        response = await client.responses.create(
          buildCoreResponsesCreateParams({
            model,
            instructions: appendWebSearchGuidance(
              appendImageGenerationGuidance(
                appendMemoryPackToInstructions(coreBundle.instructions, memoryPack),
                model,
              ),
              model,
            ),
            maxOutputTokens: modality === 'voice' ? 700 : 4096,
            input: mapMessagesToResponsesInput(messages, mapInputOpts),
            ...(retryImageTools.length ? { tools: retryImageTools } : {}),
          }),
        )
        finalResponseReceived = true
        existingSearchInvoked = false
        webSearchUsed = false
      } else {
        throw upstreamErr
      }
    }

    const parsedImages = parseImageGenerationCalls(response)
    // Seal with HMAC proof so later history replay cannot spoof assistant images
    // merely by setting source=generated (and allows >1.5MB generated payloads).
    const images = sealChatApiImages(toChatApiImages(parsedImages.images))
    const citations = extractUrlCitations(response)
    searchResultCount = citations.length
    let content = response.output_text?.trim() || ''

    if (visionSearchActive && visionSearchFailure === 'search_unavailable' && content) {
      const note =
        /[àèéìòù]/.test(content) || /\b(il|la|di|che|sono|è)\b/i.test(content)
          ? '\n\nNon sono riuscito a recuperare informazioni aggiornate dal web in questo momento.'
          : '\n\nI could not retrieve current web information right now.'
      if (!content.includes('recuperare informazioni aggiornate') && !content.includes('could not retrieve current web')) {
        content = `${content}${note}`
      }
    }
    if (visionSearchActive && !content && images.length === 0) {
      visionSearchFailure = visionSearchFailure || 'no_search_results'
    }

    if (!content && images.length === 0) {
      if (parsedImages.safetyRefused) {
        return sendJson(res, 200, {
          content: 'Non posso creare o modificare questa immagine.',
          runtime: 'core',
          model,
          memoryEvent: null,
        }, req)
      }
      if (parsedImages.technicalFailure) {
        return sendJson(res, 502, {
          error: 'Image generation failed',
          code: 'image_generation_failed',
        }, req)
      }
      return sendJson(res, 502, { error: 'Empty response from OpenAI', code: 'upstream_ai_error' }, req)
    }

    // Never fabricate success: replace false "I created an image" claims when no payload.
    if (contentClaimsImageWithoutPayload(content, images.length)) {
      content = parsedImages.safetyRefused
        ? 'Non posso creare o modificare questa immagine.'
        : 'Non ho un’immagine da mostrare per questa richiesta.'
    }

    let memoryEvent: MemoryFeedbackEvent = null

    // Overview + personal memory probes inspect memory; do not auto-extract
    // durable facts from the inspection question itself.
    // Image-only / PDF-only turns (empty caption) skip durable extraction.
    // Vision Lens Read/Explain shortcuts are ephemeral task instructions — not user facts.
    // Forget early-return already forces memoryEvent: null (assistant reply is authoritative).
    // Transient image-edit captions are still subject to existing Memory rules (no bytes stored).
    const skipExtractionForInspection =
      overviewHandled ||
      !lastUserCaption ||
      isPersonalMemoryProbe(lastUserCaption) ||
      isVisionTaskShortcut(lastUserCaption) ||
      images.length > 0 ||
      lastUserHasFile ||
      activeDocumentReused

    if (lastUserCaption && !skipExtractionForInspection) {
      const write = await runMemoryIfEnabled(
        lastUserCaption,
        content,
        memoryEnabled,
        memoryOwnerUserId,
      )
      memoryEvent = write.event
    }

    const payload: Record<string, unknown> = {
      content,
      runtime: 'core',
      model,
      memoryEvent,
      ...(images.length ? { images } : {}),
      ...(citations.length ? { citations } : {}),
      ...(overviewHandled ? { memoryControl: 'overview' } : {}),
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

    if (visionDiagOn || visionRoute.intent === 'vision_search' || visionSearchActive) {
      const diag = buildVisionSearchDiagPayload({
        requestId:
          typeof (req as { headers?: Record<string, string> }).headers?.['x-request-id'] === 'string'
            ? (req as { headers: Record<string, string> }).headers['x-request-id']
            : null,
        visionContextFound: Boolean(visionCtx),
        sourceVisionTurnId: visionCtx?.sourceTurnId ?? null,
        visualEntityAvailable: Boolean(visionCtx?.entities?.length),
        visualSearchIntent: visionSearchKind,
        generatedSearchQuery: visionSearchQuery || null,
        existingSearchInvoked,
        searchResultCount,
        searchContextSentToModel: visionSearchContextSent,
        finalResponseReceived,
        failureCode: visionSearchFailure,
        webSearchUsed,
      })
      if (visionDiagOn) {
        payload.visionSearchDiag = diag
      }
      console.info('[api/chat] vision-search', {
        route: diag.route,
        buildId: diag.buildId,
        visionContextFound: diag.visionContextFound,
        visualSearchIntent: diag.visualSearchIntent,
        existingSearchInvoked: diag.existingSearchInvoked,
        searchResultCount: diag.searchResultCount,
        failureCode: diag.failureCode,
        generatedSearchQueryPreview: diag.generatedSearchQueryPreview,
      })
    }

    const conversationStateDiag = buildConversationStateDiagPayload(coreBundle.conversationState, {
      appendixChars: coreBundle.conversationStateAppendixChars,
    })
    console.info('[api/chat] conversation-state', {
      route: conversationStateDiag.route,
      buildId: conversationStateDiag.buildId,
      mode: conversationStateDiag.mode,
      purpose: conversationStateDiag.purpose,
      depth: conversationStateDiag.depth,
      emojiLevel: conversationStateDiag.emojiLevel,
      questionNeeded: conversationStateDiag.questionNeeded,
      initiativeLevel: conversationStateDiag.initiativeLevel,
      shortFollowUpDetected: conversationStateDiag.shortFollowUpDetected,
      stopSignalDetected: conversationStateDiag.stopSignalDetected,
      decisionSignalDetected: conversationStateDiag.decisionSignalDetected,
      priorModeInherited: conversationStateDiag.priorModeInherited,
      appendixChars: conversationStateDiag.appendixChars,
    })
    if (conversationStateDiagOn) {
      payload.conversationStateDiag = conversationStateDiag
    }

    const styleVarietyDiagOn =
      (body.styleVarietyDiag === true ||
        body.styleVarietyDiag === 1 ||
        body.styleVarietyDiag === '1' ||
        (typeof req.url === 'string' &&
          /[?&](?:style_variety_diag|conversation_state_diag)=1(?:&|$)/i.test(req.url))) &&
      (process.env.VERCEL_ENV === 'preview' ||
        process.env.VERCEL_ENV === 'development' ||
        process.env.STYLE_VARIETY_DIAG === '1' ||
        process.env.STYLE_VARIETY_DIAG === 'true' ||
        process.env.CONVERSATION_STATE_DIAG === '1')
    const styleVarietyDiag = buildStyleVarietyDiagPayload(
      sanitizeSessionStyleState(body.sessionStyle),
      {
        sessionStyleReceived: coreBundle.sessionStyleReceived,
        styleAvoidChars: coreBundle.styleAvoidAppendixChars,
      },
    )
    console.info('[api/chat] style-variety', {
      route: styleVarietyDiag.route,
      sessionStyleReceived: styleVarietyDiag.sessionStyleReceived,
      styleAvoidChars: styleVarietyDiag.styleAvoidChars,
      recentFirstPhraseCount: styleVarietyDiag.recentFirstPhraseCount,
      recentEmojiCount: styleVarietyDiag.recentEmojiCount,
    })
    if (styleVarietyDiagOn) {
      payload.styleVarietyDiag = styleVarietyDiag
    }

    const naturalResponseDiagOn = isNaturalResponseDiagEnabled(
      req,
      body as Record<string, unknown>,
    )
    const naturalResponseDiag = buildNaturalResponseDiagPayload({
      policyChars: coreBundle.naturalResponsePolicyChars,
      expressionInjected: coreBundle.expressionInjected,
      proactiveInjected: coreBundle.proactiveInjected,
      continuityChars: coreBundle.continuityChars,
      understandingChars: coreBundle.understandingChars,
      adaptiveChars: coreBundle.adaptiveChars,
      phoneCapabilityInjected: coreBundle.phoneCapabilityInjected,
      totalInstructionChars: coreBundle.instructions.length,
      questionNeeded: coreBundle.conversationState.questionNeeded,
      desiredDepth: coreBundle.conversationState.desiredDepth,
      emojiLevel: coreBundle.conversationState.emojiLevel,
      initiativeLevel: coreBundle.conversationState.initiativeLevel,
      structurePreference: coreBundle.conversationState.structurePreference,
    })
    console.info('[api/chat] natural-response', {
      route: naturalResponseDiag.route,
      buildId: naturalResponseDiag.buildId,
      policyChars: naturalResponseDiag.policyChars,
      momentumPolicyChars: naturalResponseDiag.momentumPolicyChars,
      totalInstructionChars: naturalResponseDiag.totalInstructionChars,
      expressionInjected: naturalResponseDiag.expressionInjected,
      proactiveInjected: naturalResponseDiag.proactiveInjected,
      phoneCapabilityInjected: naturalResponseDiag.phoneCapabilityInjected,
    })
    if (naturalResponseDiagOn) {
      payload.naturalResponseDiag = naturalResponseDiag
    }

    const referenceContextDiag = buildReferenceContextDiagPayload(coreBundle.referenceContext, {
      appendixChars: coreBundle.referenceContextAppendixChars,
    })
    console.info('[api/chat] reference-context', {
      route: referenceContextDiag.route,
      buildId: referenceContextDiag.buildId,
      referenceContextInjected: referenceContextDiag.referenceContextInjected,
      orderedOptionsCount: referenceContextDiag.orderedOptionsCount,
      alternativesCount: referenceContextDiag.alternativesCount,
      likelyReferentPresent: referenceContextDiag.likelyReferentPresent,
      likelyReferentType: referenceContextDiag.likelyReferentType,
      ordinalIndex: referenceContextDiag.ordinalIndex,
      pivotDetected: referenceContextDiag.pivotDetected,
      appendixChars: referenceContextDiag.appendixChars,
      refBuild: REFERENCE_CONTEXT_BUILD,
    })
    const referenceDiagOn =
      (body as { referenceContextDiag?: boolean | 1 | '1' }).referenceContextDiag === true ||
      (body as { referenceContextDiag?: boolean | 1 | '1' }).referenceContextDiag === 1 ||
      (body as { referenceContextDiag?: boolean | 1 | '1' }).referenceContextDiag === '1' ||
      (typeof req.url === 'string' &&
        /[?&](?:reference_context_diag|conversation_state_diag)=1(?:&|$)/i.test(req.url))
    if (
      referenceDiagOn &&
      (process.env.VERCEL_ENV === 'preview' ||
        process.env.VERCEL_ENV === 'development' ||
        process.env.REFERENCE_CONTEXT_DIAG === '1' ||
        process.env.CONVERSATION_STATE_DIAG === '1')
    ) {
      payload.referenceContextDiag = referenceContextDiag
    }

    if (
      documentDiagOn ||
      documentAttachedThisTurn ||
      activeDocumentReused ||
      documentFailure ||
      documentReferenceDetected
    ) {
      const docDiag = buildDocumentChatDiagPayload({
        requestId:
          typeof (req as { headers?: Record<string, string> }).headers?.['x-request-id'] === 'string'
            ? (req as { headers: Record<string, string> }).headers['x-request-id']
            : null,
        documentAttachedThisTurn,
        activeDocumentFound: Boolean(activeDoc),
        activeDocumentReused,
        activeFilename: activeDoc?.filename ?? null,
        activeFileExpired,
        documentReferenceDetected,
        fileIncludedInModelInput,
        modelRequestReached,
        modelResponseReceived: finalResponseReceived,
        failureCode: documentFailure,
      })
      if (documentDiagOn) {
        payload.documentDiag = docDiag
      }
      console.info('[api/chat] document-chat', {
        route: docDiag.route,
        buildId: docDiag.buildId,
        ...summarizeActiveDocumentForLog(activeDoc),
        activeDocumentReused: docDiag.activeDocumentReused,
        documentReferenceDetected: docDiag.documentReferenceDetected,
        fileIncludedInModelInput: docDiag.fileIncludedInModelInput,
        failureCode: docDiag.failureCode,
      })
    }

    // Echo safe active-document metadata for client UI (no bytes).
    if (activeDoc && !suppressDocReuse && !activeFileExpired) {
      payload.activeDocument = {
        fileId: activeDoc.fileId,
        filename: activeDoc.filename,
        mimeType: activeDoc.mimeType,
        size: activeDoc.size,
        expiresAt: activeDoc.expiresAt,
        sourceTurnId: activeDoc.sourceTurnId,
      }
    }

    return sendJson(res, 200, payload, req)
  } catch (error) {
    // #298C — never log payloads; never return raw provider messages to clients.
    console.error('[api/chat] completion failed:', safeErrorSnippet(error))

    try {
      const OpenAI = (await import('openai')).default
      if (error instanceof OpenAI.APIError) {
        const status =
          typeof error.status === 'number' && error.status >= 400 && error.status < 600
            ? error.status
            : 502
        const errMsg = error instanceof Error ? error.message : String(error)
        const visionRejected =
          /image|vision|multimodal|unsupported.*media|invalid.*image/i.test(errMsg)
        return sendJson(
          res,
          status,
          {
            error: visionRejected
              ? 'Il modello non ha accettato l’immagine. Riprova con un JPEG/PNG/WebP più piccolo, oppure invia solo testo.'
              : SAFE_UPSTREAM_ERROR,
            code: visionRejected
              ? 'image_model_rejected'
              : 'upstream_ai_error',
          },
          req)
      }
    } catch {
      // Fall through
    }

    return sendJson(
      res,
      500,
      {
        error: SAFE_INTERNAL_ERROR,
        code: 'internal_error',
      },
      req)
  }
}
