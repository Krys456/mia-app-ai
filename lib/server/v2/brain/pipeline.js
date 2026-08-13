/**
 * LAIfe V2 — Pipeline / Runtime slice
 *
 * Orchestrates:
 *   Perception → Conversation State → Mind → Planner → Writer
 *   → Contract Evaluator (WHAT + adaptive HOW fidelity) → State Transition
 *
 * Conversation Resume remains a compat helper (not a topic authority).
 * No Memory V2, no OpenAI, no V1 wiring inside this module.
 *
 * @see V2_DATA_FLOW.md
 * @see WRITER_API_SPEC.md
 */

import { perceive } from './perception.js'
import { think } from './mind.js'
import { resumeConversation } from './conversation-resume.js'
import {
  buildConversationState,
  hydrateConversationState,
  markPendingProposalExecuting,
  serializePersistedConversationState,
  transitionConversationState,
} from './conversation-state.js'
import { plan } from './planner.js'
import { createWriter, isWriterError } from './writer.js'
import { evaluateContractFidelity } from './contract-evaluator.js'

export const PIPELINE_VERSION = '2.5.0-pipeline'

const DEFAULT_FOUNDATION = `LAIfe is calm, thoughtful, naturally curious, emotionally intelligent, humble, quietly confident, and warm without pretending. Not a generic helpdesk assistant.`

/**
 * @typedef {object} PipelineConfig
 * @property {ReturnType<typeof createWriter>} [writer]
 * @property {import('./writer.js').WriterConfig} [writerConfig]
 * @property {string|object} [personalityFoundation]
 * @property {object} [conversationMemory]
 * @property {object} [sessionState]
 * @property {typeof perceive} [perceiveFn]
 * @property {typeof think} [thinkFn]
 * @property {typeof buildConversationState} [conversationStateFn]
 * @property {typeof resumeConversation} [resumeFn]
 * @property {typeof plan} [planFn]
 * @property {boolean} [enableContractEvaluator] default true
 */

/**
 * @typedef {object} RunConversationInput
 * @property {string} userMessage
 * @property {Array<{ role?: string, content?: string }>} [messages]
 * @property {object} [conversationMemory]
 * @property {object} [sessionState]
 * @property {import('./conversation-state.js').ConversationState|object} [previousConversationState]
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
 * @property {import('./conversation-state.js').ConversationState} conversationState pre-Writer situation
 * @property {object|null} nextConversationState post-Writer persisted State (null if Writer failed)
 * @property {object} decision
 * @property {object} conversationResume
 * @property {object} plan
 * @property {object} response
 * @property {object|null} [contractEvaluation]
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
 * @param {PipelineConfig} [config]
 */
export function createPipeline(config = {}) {
  const perceiveFn = config.perceiveFn || perceive
  const thinkFn = config.thinkFn || think
  const conversationStateFn = config.conversationStateFn || buildConversationState
  const resumeFn = config.resumeFn || resumeConversation
  const planFn = config.planFn || plan
  const enableContractEvaluator = config.enableContractEvaluator !== false

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
      memory: null,
    })

    // 2. Conversation State (WHAT IS CURRENTLY TRUE) — hydrate prior persisted echo
    const conversationResume = resumeFn({ messages })
    const previousState =
      hydrateConversationState(input.previousConversationState) ||
      (input.previousConversationState && typeof input.previousConversationState === 'object'
        ? input.previousConversationState
        : null)

    let conversationState = conversationStateFn({
      messages,
      perception,
      previousState,
    })

    // 3. Mind
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
      conversationState,
      preferences: input.preferences || null,
      userMessage,
    })

    const decisionForPlan = {
      ...decision,
      shouldUseMemory: false,
    }

    // 4. Planner
    let planResult = planFn({
      perception,
      decision: decisionForPlan,
      messages,
      conversationState,
      conversationResume,
    })

    // Mark accepted proposal as executing (still pre-Writer; cleared only after success).
    if (
      conversationState.pendingProposal &&
      (planResult.writerBrief?.conversationalMove === 'execute_pending_proposal' ||
        planResult.writerBrief?.conversationalMove === 'continue_topic')
    ) {
      conversationState = markPendingProposalExecuting(conversationState)
    }

    // 5. Writer
    /** @type {object|null} */
    let contractEvaluation = null
    let response
    let writerSucceeded = false
    try {
      response = await writer.write({
        personalityFoundation,
        decision: decisionForPlan,
        plan: planResult,
        messages,
        conversationState,
        mode: 'draft',
        ...(input.preferences ? { preferences: input.preferences } : {}),
        ...(input.providerId ? { providerId: input.providerId } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        ...(input.generation ? { generation: input.generation } : {}),
        memoryPack: null,
      })
      writerSucceeded = Boolean(asString(response?.text).trim())
    } catch (err) {
      // Failure: do not persist a completed transition.
      const failedNext = transitionConversationState({
        preState: conversationState,
        plan: planResult,
        writerSucceeded: false,
      })
      if (isWriterError(err)) {
        Object.assign(err, {
          nextConversationState: serializePersistedConversationState(failedNext),
        })
        throw err
      }
      throw err
    }

    // 6. Optional Contract Evaluator — at most one constrained rewrite (HOW only).
    if (enableContractEvaluator && writerSucceeded) {
      contractEvaluation = evaluateContractFidelity({
        responseText: response.text,
        plan: planResult,
        conversationState,
        userMessage,
        recentOpeners: conversationState?.recentOpeners,
      })
      if (contractEvaluation.needsRewrite && contractEvaluation.rewriteBrief) {
        try {
          const rewritten = await writer.write({
            personalityFoundation,
            decision: decisionForPlan,
            plan: planResult,
            messages,
            conversationState,
            mode: 'rewrite',
            rewriteBrief: contractEvaluation.rewriteBrief,
            previousDraft: response.text,
            ...(input.preferences ? { preferences: input.preferences } : {}),
            ...(input.providerId ? { providerId: input.providerId } : {}),
            ...(input.model ? { model: input.model } : {}),
            ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
            ...(input.metadata ? { metadata: input.metadata } : {}),
            ...(input.generation ? { generation: input.generation } : {}),
            memoryPack: null,
          })
          if (asString(rewritten?.text).trim()) {
            const warnings = Array.isArray(rewritten.warnings)
              ? rewritten.warnings.slice()
              : []
            if (!warnings.includes('contract_evaluator_rewrite')) {
              warnings.push('contract_evaluator_rewrite')
            }
            response = { ...rewritten, warnings }
            // Lightweight final check — never triggers another rewrite.
            const postRewrite = evaluateContractFidelity({
              responseText: response.text,
              plan: planResult,
              conversationState,
              userMessage,
              recentOpeners: conversationState?.recentOpeners,
              isFinalCheck: true,
            })
            contractEvaluation = {
              ...contractEvaluation,
              rewritten: true,
              postRewrite,
              ok: postRewrite.ok,
              pass: postRewrite.pass,
              hardViolations: postRewrite.hardViolations,
              softViolations: postRewrite.softViolations,
              violations: postRewrite.violations,
            }
          }
        } catch {
          // Keep original draft if rewrite fails — still a delivered response.
          contractEvaluation = {
            ...contractEvaluation,
            rewritten: false,
            rewriteFailed: true,
          }
        }
      }
    }

    // 7. State Transition / Persistence — only after successful delivery.
    const nextConversationState = transitionConversationState({
      preState: conversationState,
      plan: planResult,
      responseText: response?.text,
      writerSucceeded: true,
    })

    return {
      perception,
      conversationState,
      nextConversationState: serializePersistedConversationState(nextConversationState),
      decision: decisionForPlan,
      conversationResume,
      plan: planResult,
      response,
      contractEvaluation,
    }
  }

  return {
    version: PIPELINE_VERSION,
    runConversation,
  }
}

export { DEFAULT_FOUNDATION }
