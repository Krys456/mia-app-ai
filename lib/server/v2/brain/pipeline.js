/**
 * LAIfe V2 — Pipeline / Runtime slice
 *
 * Orchestrates: Perception → Mind → Conversation Resume → Planner → Writer
 * No Reviewer, no Memory service, no OpenAI, no V1 wiring.
 * Not connected to api/chat.ts.
 *
 * @see V2_DATA_FLOW.md
 * @see WRITER_API_SPEC.md
 */

import { perceive } from './perception.js'
import { think } from './mind.js'
import { resumeConversation } from './conversation-resume.js'
import { plan } from './planner.js'
import { createWriter, isWriterError } from './writer.js'

export const PIPELINE_VERSION = '2.1.0-pipeline'

const DEFAULT_FOUNDATION = `LAIfe is calm, thoughtful, naturally curious, emotionally intelligent, humble, quietly confident, and warm without pretending. Not a generic helpdesk assistant.`

/**
 * @typedef {object} PipelineConfig
 * @property {ReturnType<typeof createWriter>} [writer]
 * @property {import('./writer.js').WriterConfig} [writerConfig]  // used if writer not provided
 * @property {string|object} [personalityFoundation]
 * @property {object} [conversationMemory]  // read-only defaults for Mind (no Memory module)
 * @property {object} [sessionState]        // read-only defaults for Mind
 * @property {typeof perceive} [perceiveFn]
 * @property {typeof think} [thinkFn]
 * @property {typeof resumeConversation} [resumeFn]
 * @property {typeof plan} [planFn]
 */

/**
 * @typedef {object} RunConversationInput
 * @property {string} userMessage
 * @property {Array<{ role?: string, content?: string }>} [messages]
 * @property {object} [conversationMemory]
 * @property {object} [sessionState]
 * @property {string} [providerId]
 * @property {string} [model]
 * @property {AbortSignal} [abortSignal]
 * @property {object} [metadata]
 * @property {object} [preferences]
 * @property {object} [generation]
 */

/**
 * @typedef {object} PipelineResult
 * @property {object} perception
 * @property {object} decision
 * @property {object} conversationResume
 * @property {object} plan
 * @property {object} response
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

/**
 * Build history for Perception/Writer: prior turns + current user message once.
 * @param {string} userMessage
 * @param {Array<{ role?: string, content?: string }>} [messages]
 */
function buildMessages(userMessage, messages) {
  const prior = Array.isArray(messages)
    ? messages
        .filter((m) => m && typeof m === 'object')
        .map((m) => ({
          role: asString(m.role).toLowerCase(),
          content: asString(m.content),
        }))
        .filter(
          (m) =>
            m.content &&
            (m.role === 'user' || m.role === 'assistant' || m.role === 'system'),
        )
    : []

  const trimmed = asString(userMessage).trim()
  if (!trimmed) return prior

  const last = prior[prior.length - 1]
  if (last && last.role === 'user' && last.content === trimmed) {
    return prior
  }
  return [...prior, { role: 'user', content: trimmed }]
}

/**
 * Create an independent V2 conversation pipeline (Runtime V2 slice).
 * @param {PipelineConfig} [config]
 */
export function createPipeline(config = {}) {
  const perceiveFn = config.perceiveFn || perceive
  const thinkFn = config.thinkFn || think
  const resumeFn = config.resumeFn || resumeConversation
  const planFn = config.planFn || plan

  let writer = config.writer || null
  if (!writer) {
    if (!config.writerConfig || !config.writerConfig.providers) {
      throw new Error(
        'createPipeline requires writer or writerConfig.providers (inject FakeWriterProvider / WriterProvider)',
      )
    }
    writer = createWriter(config.writerConfig)
  }

  const personalityFoundation =
    config.personalityFoundation != null
      ? config.personalityFoundation
      : DEFAULT_FOUNDATION

  const defaultConversationMemory =
    config.conversationMemory && typeof config.conversationMemory === 'object'
      ? config.conversationMemory
      : {}
  const defaultSessionState =
    config.sessionState && typeof config.sessionState === 'object'
      ? config.sessionState
      : { memoryEnabled: false }

  /**
   * Run one conversation turn:
   * Perception → Mind → Conversation Resume → Planner → Writer
   * @param {RunConversationInput} input
   * @returns {Promise<PipelineResult>}
   */
  async function runConversation(input = {}) {
    if (!input || typeof input !== 'object') {
      throw Object.assign(new Error('runConversation input must be an object'), {
        code: 'invalid_request',
      })
    }

    const userMessage = asString(input.userMessage)
    const messages = buildMessages(userMessage, input.messages)

    // 1. Perception
    const perception = perceiveFn({
      userMessage,
      messages,
      // No Memory module in this slice — never pass durable memory packs here.
      memory: null,
    })

    // 2. Mind (no Memory service — empty / injected read-only state only)
    const conversationMemory =
      input.conversationMemory && typeof input.conversationMemory === 'object'
        ? input.conversationMemory
        : defaultConversationMemory
    const sessionState =
      input.sessionState && typeof input.sessionState === 'object'
        ? { memoryEnabled: false, ...defaultSessionState, ...input.sessionState, memoryEnabled: false }
        : { ...defaultSessionState, memoryEnabled: false }

    const decision = thinkFn({
      perception,
      conversationMemory,
      sessionState,
    })

    // Force no-memory policy for this pipeline slice (even if Mind would allow it)
    const decisionForPlan = {
      ...decision,
      shouldUseMemory: false,
    }

    // 3. Conversation Resume (current chat only — Planner decides whether to use it)
    const conversationResume = resumeFn({ messages })

    // 4. Planner (receives resume; exposes only resumeSentence to Writer when eligible)
    const planResult = planFn({
      perception,
      decision: decisionForPlan,
      messages,
      conversationResume,
    })

    // 5. Writer — receives plan.writerBrief.resumeSentence only (not full Resume)
    let response
    try {
      response = await writer.write({
        personalityFoundation,
        decision: decisionForPlan,
        plan: planResult,
        messages,
        mode: 'draft',
        ...(input.preferences ? { preferences: input.preferences } : {}),
        ...(input.providerId ? { providerId: input.providerId } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        ...(input.generation ? { generation: input.generation } : {}),
        memoryPack: null,
      })
    } catch (err) {
      if (isWriterError(err)) throw err
      throw err
    }

    return {
      perception,
      decision: decisionForPlan,
      conversationResume,
      plan: planResult,
      response,
    }
  }

  return {
    version: PIPELINE_VERSION,
    runConversation,
  }
}

export { DEFAULT_FOUNDATION }
