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
import { applyCors, sendCorsPreflight, sendJson } from '../lib/server/http.js'
import { LAIFE_BASE_SYSTEM_PROMPT } from '../lib/server/laife-base-system-prompt.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
}

type ChatRole = 'user' | 'assistant' | 'system'

interface ChatApiMessage {
  role: ChatRole
  content: string
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

function isChatRole(value: unknown): value is ChatRole {
  return value === 'user' || value === 'assistant' || value === 'system'
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

function buildInstructions(body: ChatApiRequestBody): string {
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
): Promise<{
  event: 'saved' | 'updated' | null
  extractedFactCount: number
  pipelineAttempted: boolean
  writeOutcome:
    | 'saved'
    | 'updated'
    | 'skipped_disabled'
    | 'skipped_no_owner'
    | 'skipped_no_facts'
    | 'failed'
  errorCode: string | null
  errorMessage: string | null
}> {
  if (!memoryEnabled) {
    return {
      event: null,
      extractedFactCount: 0,
      pipelineAttempted: false,
      writeOutcome: 'skipped_disabled',
      errorCode: null,
      errorMessage: null,
    }
  }
  if (!ownerUserId) {
    return {
      event: null,
      extractedFactCount: 0,
      pipelineAttempted: false,
      writeOutcome: 'skipped_no_owner',
      errorCode: 'no_owner',
      errorMessage: 'No verified auth owner for memory write',
    }
  }

  try {
    const { extractDurableFacts, runMemoryPipeline } = await import(
      '../lib/server/brain-memory.js'
    )

    const facts = extractDurableFacts(userMessage)
    const extractedFactCount = Array.isArray(facts) ? facts.length : 0

    const result = await runMemoryPipeline({
      userMessage,
      assistantMessage,
      memoryEnabled: true,
      userId: ownerUserId,
      requireExplicitUserId: true,
    })

    if (result?.updated) {
      return {
        event: 'updated',
        extractedFactCount,
        pipelineAttempted: true,
        writeOutcome: 'updated',
        errorCode: null,
        errorMessage: null,
      }
    }
    if (result?.saved) {
      return {
        event: 'saved',
        extractedFactCount,
        pipelineAttempted: true,
        writeOutcome: 'saved',
        errorCode: null,
        errorMessage: null,
      }
    }

    return {
      event: null,
      extractedFactCount,
      pipelineAttempted: true,
      writeOutcome: 'skipped_no_facts',
      errorCode: result?.reason ? String(result.reason) : 'no_write',
      errorMessage: null,
    }
  } catch (error) {
    const { sanitizeMemoryDiagError } = await import('../lib/server/chat-memory-auth.js')
    return {
      event: null,
      extractedFactCount: 0,
      pipelineAttempted: true,
      writeOutcome: 'failed',
      errorCode: 'pipeline_error',
      errorMessage: sanitizeMemoryDiagError(error),
    }
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

  const messages = sanitizeMessages(body.messages).filter(
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
  const ownerResult = await resolveChatMemoryOwnerUserId(req)
  const memoryOwnerUserId = ownerResult.userId

  try {
    const instructions = buildInstructions(body)
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey })
    const model = resolveChatModel(process.env)

    const response = await client.responses.create(
      buildCoreResponsesCreateParams({
        model,
        instructions,
        maxOutputTokens: modality === 'voice' ? 700 : 4096,
        input: messages.map((msg) => ({
          type: 'message' as const,
          role: msg.role,
          content: msg.content,
        })),
      }),
    )

    const content = response.output_text?.trim() || ''
    if (!content) {
      return sendJson(res, 502, { error: 'Empty response from OpenAI' })
    }

    const lastUserMessage = [...messages].reverse().find((msg) => msg.role === 'user')
    let memoryEvent: 'saved' | 'updated' | null = null
    let memoryWrite = {
      extractedFactCount: 0,
      pipelineAttempted: false,
      writeOutcome: 'skipped_no_facts' as
        | 'saved'
        | 'updated'
        | 'skipped_disabled'
        | 'skipped_no_owner'
        | 'skipped_no_facts'
        | 'failed',
      errorCode: null as string | null,
      errorMessage: null as string | null,
    }

    if (lastUserMessage?.content) {
      const write = await runMemoryIfEnabled(
        lastUserMessage.content,
        content,
        memoryEnabled,
        memoryOwnerUserId,
      )
      memoryEvent = write.event
      memoryWrite = {
        extractedFactCount: write.extractedFactCount,
        pipelineAttempted: write.pipelineAttempted,
        writeOutcome: write.writeOutcome,
        errorCode: write.errorCode,
        errorMessage: write.errorMessage,
      }
    } else if (!memoryEnabled) {
      memoryWrite.writeOutcome = 'skipped_disabled'
    } else if (!memoryOwnerUserId) {
      memoryWrite.writeOutcome = 'skipped_no_owner'
      memoryWrite.errorCode = 'no_owner'
    }

    // Temporary Preview-safe diagnostics — no JWTs, secrets, or memory content.
    const memoryDiag = {
      bearerPresent: ownerResult.diag.bearerPresent,
      ownerPresent: ownerResult.diag.ownerPresent,
      ownerUserIdPrefix: ownerResult.diag.ownerUserIdPrefix,
      authCode: ownerResult.diag.authCode,
      authError: ownerResult.diag.authError,
      memoryEnabled,
      extractedFactCount: memoryWrite.extractedFactCount,
      pipelineAttempted: memoryWrite.pipelineAttempted,
      writeOutcome: memoryWrite.writeOutcome,
      errorCode: memoryWrite.errorCode,
      errorMessage: memoryWrite.errorMessage,
    }

    console.log('[api/chat] memoryDiag', JSON.stringify(memoryDiag))

    const payload: Record<string, unknown> = {
      content,
      runtime: 'core',
      model,
      memoryEvent,
      memoryDiag,
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

    console.log(
      '[api/chat] final response',
      JSON.stringify({
        contentLen: content.length,
        memoryEvent,
        model,
        keys: Object.keys(payload),
        runtime: 'core',
        singleShot: true,
      }),
    )
    return sendJson(res, 200, payload)
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
