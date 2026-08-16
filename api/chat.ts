/**
 * LAIfe /api/chat — new conversational core.
 *
 * One OpenAI call + one unified system prompt (LAIFE_BASE_SYSTEM_PROMPT).
 * No Cognitive Engine, no V1/V2 pipeline, no post-generation refine chain.
 * Trust the model; do not cage it.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { buildCoreResponsesCreateParams } from '../lib/server/core-responses-params.js'
import { resolveChatMemoryOwnerUserId } from '../lib/server/chat-memory-auth.js'
import {
  appendMemoryPackToInstructions,
  isPersonalMemoryProbe,
  loadCoreMemoryPack,
} from '../lib/server/core-memory-recall.js'
import { applyCors, sendCorsPreflight, sendJson } from '../lib/server/http.js'
import { buildCoreContinuityAppendix } from '../lib/server/conversation-continuity.js'
import { LAIFE_BASE_SYSTEM_PROMPT } from '../lib/server/laife-base-system-prompt.js'
import { buildCoreLanguageAppendix } from '../lib/server/language-awareness.js'
import {
  mapMessagesToResponsesInput,
  modelSupportsImageInput,
  redactAttachmentsForLog,
  sanitizeMultimodalMessages,
  summarizeImageForLog,
  visibleUserText,
} from '../lib/server/chat-image-input.js'

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

interface ChatApiMessage {
  role: ChatRole
  content: string
  attachments?: ChatApiImageAttachment[]
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
      'Preferenza emoji: consentite solo se calzano davvero al tono di questo turno (mai forzate).',
    )
  } else if (body.useEmojis === false) {
    parts.push(
      "Preferenza emoji: non usare emoji nel corpo della risposta, salvo che l'utente le usi per primo.",
    )
  }

  const custom =
    typeof body.customInstructions === 'string'
      ? body.customInstructions.trim().slice(0, 2000)
      : ''
  if (custom) {
    parts.push(`Istruzioni personalizzate dell'utente (rispettale quando possibili):\n${custom}`)
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

  // Ephemeral CONTINUITY appendix (#263) — after LANGUAGE, before Memory pack.
  // No resolver / second LLM / DB; model reasons from thread + this contract.
  const continuityAppendix = buildCoreContinuityAppendix()
  if (continuityAppendix) {
    parts.push(continuityAppendix)
  }

  return parts.join('\n\n')
}

function resolveChatModel(env: NodeJS.ProcessEnv = process.env): string {
  const raw = typeof env.OPENAI_MODEL === 'string' ? env.OPENAI_MODEL.trim() : ''
  // Common typo: digit zero instead of letter o (gpt-40 → gpt-4o).
  const normalized = raw.replace(/\bgpt-40\b/gi, 'gpt-4o')
  return normalized || 'gpt-4o'
}

async function runMemoryIfEnabled(
  userMessage: string,
  assistantMessage: string,
  memoryEnabled: boolean,
  ownerUserId: string | null,
): Promise<{ event: 'saved' | 'updated' | null }> {
  if (!memoryEnabled || !ownerUserId) {
    return { event: null }
  }

  try {
    const { runMemoryPipeline } = await import('../lib/server/brain-memory.js')

    const result = await runMemoryPipeline({
      userMessage,
      assistantMessage,
      memoryEnabled: true,
      userId: ownerUserId,
      requireExplicitUserId: true,
    })

    if (result?.updated) return { event: 'updated' }
    if (result?.saved) return { event: 'saved' }
    return { event: null }
  } catch (error) {
    console.warn(
      '[api/chat] memory write skipped:',
      error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    )
    return { event: null }
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

  const sanitized = sanitizeMultimodalMessages(body.messages)
  if (!sanitized.ok) {
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
    return sendJson(res, 400, { error: sanitized.error, code: sanitized.code })
  }
  const messages = sanitized.messages.filter(
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

  // Soft auth for memory ownership only — never blocks chat generation.
  const memoryOwnerUserId = await resolveChatMemoryOwnerUserId(req)

  try {
    const lastUserMessage = [...messages].reverse().find((msg) => msg.role === 'user')
    const lastUserCaption = visibleUserText(lastUserMessage)
    const lastUserHasImage = Boolean(lastUserMessage?.attachments?.length)
    const model = resolveChatModel(process.env)

    if (lastUserHasImage && !modelSupportsImageInput(model)) {
      console.warn(
        '[api/chat] image rejected: model lacks vision',
        redactAttachmentsForLog({
          model,
          attachments: lastUserMessage?.attachments?.map((a) => summarizeImageForLog(a)),
        }),
      )
      return sendJson(res, 400, {
        error:
          'Questo modello non supporta le immagini. Invia solo testo, oppure configura un modello con vision (es. GPT-5.6 Sol / GPT-4o).',
        code: 'image_unsupported_model',
      })
    }

    if (lastUserHasImage) {
      console.info(
        '[api/chat] multimodal user turn',
        redactAttachmentsForLog({
          model,
          captionLen: lastUserCaption.length,
          attachmentCount: lastUserMessage?.attachments?.length ?? 0,
          attachments: lastUserMessage?.attachments?.map((a) => summarizeImageForLog(a)),
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
        return sendJson(res, 200, payload)
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
        return sendJson(res, 200, payload)
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

    const instructions = appendMemoryPackToInstructions(buildInstructions(body, messages), memoryPack)
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey })

    const response = await client.responses.create(
      buildCoreResponsesCreateParams({
        model,
        instructions,
        maxOutputTokens: modality === 'voice' ? 700 : 4096,
        input: mapMessagesToResponsesInput(messages),
      }),
    )

    const content = response.output_text?.trim() || ''
    if (!content) {
      return sendJson(res, 502, { error: 'Empty response from OpenAI' })
    }

    let memoryEvent: 'saved' | 'updated' | null = null

    // Overview + personal memory probes inspect memory; do not auto-extract
    // durable facts from the inspection question itself.
    // Image-only turns (empty caption) skip durable extraction.
    const skipExtractionForInspection =
      overviewHandled ||
      !lastUserCaption ||
      isPersonalMemoryProbe(lastUserCaption)

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

    return sendJson(res, 200, payload)
  } catch (error) {
    // Never log request payloads / data URLs — message + code only.
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[api/chat] completion failed:', errMsg.slice(0, 240))

    try {
      const OpenAI = (await import('openai')).default
      if (error instanceof OpenAI.APIError) {
        const status =
          typeof error.status === 'number' && error.status >= 400 && error.status < 600
            ? error.status
            : 502
        const visionRejected =
          /image|vision|multimodal|unsupported.*media|invalid.*image/i.test(errMsg)
        return sendJson(res, status, {
          error: visionRejected
            ? 'Il modello non ha accettato l’immagine. Riprova con un JPEG/PNG/WebP più piccolo, oppure invia solo testo.'
            : error.message,
          code: visionRejected ? 'image_model_rejected' : error.code,
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
