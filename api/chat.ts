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
import { ensureAuthUserRow } from '../lib/server/brain-memory.js'
import { getServiceSupabase } from '../lib/server/supabase.js'
import {
  appendMemoryPackToInstructions,
  isPersonalMemoryProbe,
  loadCoreMemoryPack,
} from '../lib/server/core-memory-recall.js'
import { applyCors, sendCorsPreflight, sendJson, SAFE_UPSTREAM_ERROR, SAFE_INTERNAL_ERROR } from '../lib/server/http.js'
import { safeErrorSnippet } from '../lib/server/safe-log.js'
import { buildCoreContinuityAppendix } from '../lib/server/conversation-continuity.js'
import { buildCoreExpressionAppendix } from '../lib/server/conversation-expression.js'
import { buildCoreProactiveIntelligenceAppendix } from '../lib/server/proactive-conversation.js'
import { buildCoreConversationalUnderstandingAppendix } from '../lib/server/conversational-understanding.js'
import { buildCoreAdaptiveResponseReasoningAppendix } from '../lib/server/adaptive-response-reasoning.js'
import { LAIFE_BASE_SYSTEM_PROMPT } from '../lib/server/laife-base-system-prompt.js'
import { buildCoreLanguageAppendix } from '../lib/server/language-awareness.js'
import { buildReferenceContextAppendix } from '../lib/server/core-reference-context.js'
import { buildConversationWorkingStateAppendix } from '../lib/server/core-working-state.js'
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
} from '../lib/server/web-search.js'
import {
  appendCalendarPackToInstructions,
  maybeBuildCalendarChatEnrichment,
} from '../lib/server/calendar-chat-pack.js'
import { inspectCalendarChatIntent, safeDiagTextPreview } from '../lib/server/calendar-chat-intent.js'
import {
  buildChatCalendarDiagPayload,
  isCalendarDiagEnvAllowed,
  isCalendarDiagRequested,
} from '../lib/server/calendar-diag.js'
import { getRequestContext } from '../lib/server/request-id.js'

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
  /** Optional browser locale — final language fallback only when turn+sticky are uncertain. */
  browserLocale?: string
  locale?: string
  /** #304A3 — IANA timezone from browser (validated server-side). */
  timeZone?: string
  timezone?: string
  /** #310C — temporary Preview Calendar live-trace opt-in (safe fields only). */
  calendarDiag?: boolean | number | string
  /** #310C — client VITE_SUPABASE_URL hostname only (no keys). */
  clientSupabaseHost?: string
  /** #310F — safe outbound last-user preview from browser (≤80). */
  clientOutboundLastUserPreview?: string
  clientOutboundLastUserLen?: number
  /** #310F — visible UI caption (same hop as outbound messages[] last user). */
  visibleUiLastUserPreview?: string
  visibleUiLastUserLen?: number
  /** Legacy V1/V2 flags — ignored by the new core. */
  developerMode?: boolean
  engine?: 'v1' | 'v2'
}

const PERSONALITY_BIAS: Record<string, string> = {
  automatic:
    'Bias di stile: adattivo. Nessuna tinta fissa — adatta tono ed energia al momento.',
  friendly:
    'Bias di stile: calore leggero. Lean verso vicinanza, senza forzare amicizia.',
  professional:
    'Bias di stile: sobrietà. Lean verso chiarezza e next step. Niente burocratese.',
  teacher:
    'Bias di stile: didattica. Quando serve spiegare, preferisci passi progressivi — non trasformare ogni turno in una lezione.',
  analytical:
    'Bias di stile: analitico. Lean verso struttura e distinzione fatti/stime, senza freddezza meccanica.',
  motivational:
    'Bias di stile: slancio. Lean verso energia concreta e next step realistici quando calza. Mai slogan.',
}

const LENGTH_BIAS: Record<string, string> = {
  concise: 'Preferenza lunghezza: concisa. Bias verso brevità; resta diretto.',
  balanced: 'Preferenza lunghezza: bilanciata. Default equilibrato; segui il filo.',
  detailed:
    'Preferenza lunghezza: dettagliata. Bias verso profondità; se emerge voglia di sintesi, avvicinati gradualmente.',
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

function buildInstructions(body: ChatApiRequestBody, messages: ChatApiMessage[] = []): string {
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

  const lengthKey =
    typeof body.replyLength === 'string' ? body.replyLength.trim().toLowerCase() : ''
  if (lengthKey && LENGTH_BIAS[lengthKey]) {
    parts.push(LENGTH_BIAS[lengthKey])
  }

  if (body.useEmojis === true) {
    parts.push(
      'Preferenza emoji: le emoji sono benvenute quando migliorano naturalmente tono o leggibilità. Usale in modo selettivo e contestuale; non aggiungerle in modo meccanico.',
    )
  } else if (body.useEmojis === false) {
    parts.push(
      "Preferenza emoji: non introdurre emoji solo per stile. Non usarle nel corpo della risposta, salvo che l'utente le usi per primo.",
    )
  }

  const custom =
    typeof body.customInstructions === 'string'
      ? body.customInstructions.trim().slice(0, 2000)
      : ''
  if (custom) {
    parts.push(`Istruzioni personalizzate dell'utente (rispettale quando possibili):\n${custom}`)
  }

  // Ephemeral ADAPTIVE EXPRESSION appendix (#284) — after personalization, before LANGUAGE.
  // Model-led presentation only; no classifiers / emoji engines / second LLM.
  const expressionAppendix = buildCoreExpressionAppendix()
  if (expressionAppendix) {
    parts.push(expressionAppendix)
  }

  // Ephemeral LANGUAGE appendix — reply-language only; not persisted; no second LLM.
  // Caption text only — never data URLs / image bytes.
  const latestUser = [...messages].reverse().find((m) => m.role === 'user')
  const languageAppendix = buildCoreLanguageAppendix({
    userMessage: visibleUserText(latestUser),
    messages: toTextOnlyMessages(messages),
    browserLocale:
      (typeof body.browserLocale === 'string' && body.browserLocale) ||
      (typeof body.locale === 'string' && body.locale) ||
      '',
  })
  if (languageAppendix) {
    parts.push(languageAppendix)
  }

  // Ephemeral CONTINUITY appendix (#263) — after LANGUAGE, before Understanding / Reference / WS / Memory.
  // No resolver / second LLM / DB; model reasons from thread + this contract.
  const continuityAppendix = buildCoreContinuityAppendix()
  if (continuityAppendix) {
    parts.push(continuityAppendix)
  }

  // Ephemeral CONVERSATIONAL UNDERSTANDING appendix (#286) — after CONTINUITY, before Adaptive Reasoning.
  // Model-led multi-part / ambiguity / distant context / corrections / thread>Memory.
  // No classifiers, no new state, no LANGUAGE changes, no second LLM.
  const understandingAppendix = buildCoreConversationalUnderstandingAppendix()
  if (understandingAppendix) {
    parts.push(understandingAppendix)
  }

  // Ephemeral ADAPTIVE REASONING / RESPONSE QUALITY appendix (#288) — after Understanding, before Reference.
  // Model-led evidence-updating / repair discipline; no attempt DB, no hypothesis engine, no CoT dump.
  const adaptiveReasoningAppendix = buildCoreAdaptiveResponseReasoningAppendix()
  if (adaptiveReasoningAppendix) {
    parts.push(adaptiveReasoningAppendix)
  }

  // Temporary Reference Context (#279) — ordered-option + artifact evidence hints.
  // After Understanding / Adaptive Reasoning, before Working State. Request-scoped only; keep attachments
  // so evidenceAvailable reflects multimodal caps honestly. No persistence / second LLM.
  const referenceContextAppendix = buildReferenceContextAppendix(messages)
  if (referenceContextAppendix) {
    parts.push(referenceContextAppendix)
  }

  // Temporary Conversation Working State (#278) — deterministic, request-scoped.
  // Derived only from the same sanitized/selected messages for THIS request.
  // After CONTINUITY / Reference Context, before Proactive Intelligence / Memory.
  const workingStateAppendix = buildConversationWorkingStateAppendix(toTextOnlyMessages(messages))
  if (workingStateAppendix) {
    parts.push(workingStateAppendix)
  }

  // Ephemeral PROACTIVE INTELLIGENCE appendix (#285) — after Working State, before Memory.
  // Model-led when-to-contribute; no classifiers / next-step engines / second LLM.
  const proactiveAppendix = buildCoreProactiveIntelligenceAppendix()
  if (proactiveAppendix) {
    parts.push(proactiveAppendix)
  }

  return parts.join('\n\n')
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
 */
function resolveHostedToolsForTurn(model: string, lastUserCaption: string) {
  const intent = detectExplicitWebSearchIntent(lastUserCaption)
  const omitWebSearch = intent === 'forbid'
  const webTools = omitWebSearch ? [] : buildWebSearchTools(model)
  const imageTools = buildImageGenerationTools(model)
  const tools = [...webTools, ...imageTools]
  /** @type {unknown | undefined} */
  let toolChoice: unknown | undefined
  if (intent === 'require' && webTools.length > 0) {
    // Force hosted web_search for explicit "Cerca sul web…" style requests.
    toolChoice = { type: 'web_search' }
  }
  return { tools, toolChoice, intent }
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
  const access = await requirePaidApiAccess(req, res, { bucket: 'chat' })
  if (!access) return undefined

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
  let memoryOwnerUserId: string | null = null
  try {
    const supabase = await getServiceSupabase()
    memoryOwnerUserId = await ensureAuthUserRow(supabase, access.userId)
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

    // #304A3 — Calendar enrichment ONLY on relevant turns (after auth/rate-limit).
    // Soft-fail; never breaks Core. Exactly one responses.create follows.
    const calendarRequestId = getRequestContext(req as unknown as { [key: string]: unknown })
      ?.requestId
    const calendarEnrichment =
      lastUserCaption && memoryOwnerUserId
        ? await maybeBuildCalendarChatEnrichment({
            userMessage: lastUserCaption,
            userId: memoryOwnerUserId,
            timeZone: body.timeZone || body.timezone,
            requestId: calendarRequestId,
          })
        : (() => {
            const inspected = inspectCalendarChatIntent(lastUserCaption || '')
            return {
              used: false,
              intent: 'none' as const,
              pack: '',
              skipMemoryExtraction: false,
              status: null,
              tokenDecrypt: 'NOT_REACHED' as const,
              preGoogleFailureCode: lastUserCaption ? 'missing_owner' : 'empty_caption',
              enrichmentSelectedLen: inspected.rawLen,
              enrichmentSelectedPreview: inspected.rawPreview,
              detectorRawLen: inspected.rawLen,
              detectorInput: inspected.rawPreview,
              detectorNormalized: inspected.normalizedPreview,
              detectorResult: inspected.intent,
            }
          })()

    // #310F — prove which messages[] item fed the Calendar detector (most recent USER).
    const calendarMessageSource =
      'messages[] → reverse find role=user → visibleUserText(content) → maybeBuildCalendarChatEnrichment.userMessage → detectCalendarChatIntent'

    const instructions = appendCalendarPackToInstructions(
      appendWebSearchGuidance(
        appendImageGenerationGuidance(
          appendMemoryPackToInstructions(buildInstructions(body, messages), memoryPack),
          model,
        ),
        model,
      ),
      calendarEnrichment.pack,
    )
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey })

    const { tools: hostedTools, toolChoice } = resolveHostedToolsForTurn(
      model,
      lastUserCaption || '',
    )
    const response = await client.responses.create(
      buildCoreResponsesCreateParams({
        model,
        instructions,
        maxOutputTokens: modality === 'voice' ? 700 : 4096,
        input: mapMessagesToResponsesInput(messages),
        ...(hostedTools.length ? { tools: hostedTools } : {}),
        ...(toolChoice != null ? { toolChoice } : {}),
      }),
    )

    const parsedImages = parseImageGenerationCalls(response)
    // Seal with HMAC proof so later history replay cannot spoof assistant images
    // merely by setting source=generated (and allows >1.5MB generated payloads).
    const images = sealChatApiImages(toChatApiImages(parsedImages.images))
    const citations = extractUrlCitations(response)
    let content = response.output_text?.trim() || ''

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
    // #304A3 — Calendar pack turns are ephemeral schedule DATA; skip auto-extraction.
    // Transient image-edit captions are still subject to existing Memory rules (no bytes stored).
    const skipExtractionForInspection =
      overviewHandled ||
      !lastUserCaption ||
      isPersonalMemoryProbe(lastUserCaption) ||
      isVisionTaskShortcut(lastUserCaption) ||
      images.length > 0 ||
      calendarEnrichment.skipMemoryExtraction

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

    // #310C / #310F — temporary Preview opt-in Calendar live trace (safe fields only).
    if (isCalendarDiagEnvAllowed(process.env) && isCalendarDiagRequested(req, body as unknown as Record<string, unknown>)) {
      const clientHost =
        typeof body.clientSupabaseHost === 'string'
          ? body.clientSupabaseHost
          : typeof req.headers?.['x-shinkaido-supabase-host'] === 'string'
            ? req.headers['x-shinkaido-supabase-host']
            : null
      payload.calendarDiag = buildChatCalendarDiagPayload({
        correlationId: calendarRequestId || null,
        authUserId: memoryOwnerUserId,
        clientSupabaseHost: clientHost,
        enrichment: calendarEnrichment,
        messageSource: calendarMessageSource,
        selectedMessageRole: lastUserMessage?.role || null,
        apiParsedLastUserLen: lastUserCaption.length,
        apiParsedLastUserPreview: safeDiagTextPreview(lastUserCaption, 80),
        visibleUiLastUserLen:
          typeof body.visibleUiLastUserLen === 'number'
            ? body.visibleUiLastUserLen
            : typeof body.clientOutboundLastUserLen === 'number'
              ? body.clientOutboundLastUserLen
              : null,
        visibleUiLastUserPreview:
          typeof body.visibleUiLastUserPreview === 'string'
            ? body.visibleUiLastUserPreview.slice(0, 80)
            : typeof body.clientOutboundLastUserPreview === 'string'
              ? body.clientOutboundLastUserPreview.slice(0, 80)
              : null,
        clientOutboundLastUserLen:
          typeof body.clientOutboundLastUserLen === 'number'
            ? body.clientOutboundLastUserLen
            : null,
        clientOutboundLastUserPreview:
          typeof body.clientOutboundLastUserPreview === 'string'
            ? body.clientOutboundLastUserPreview.slice(0, 80)
            : null,
      })
      try {
        res.setHeader('X-Shinkaido-Calendar-Diag', '1')
        res.setHeader('X-Shinkaido-Calendar-Diag-Build', '310F-1')
      } catch {
        /* soft */
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
