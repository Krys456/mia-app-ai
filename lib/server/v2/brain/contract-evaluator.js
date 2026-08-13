/**
 * LAIfe V2 — Contract Evaluator (Phase 3)
 *
 * Lightweight post-Writer fidelity gate. Checks Planner contract only.
 * Does NOT score personality, curiosity, or satisfaction.
 * Does NOT invent a new strategy.
 *
 * Hard violations may trigger at most ONE constrained rewrite (HOW only).
 */

export const CONTRACT_EVALUATOR_VERSION = '1.0.0-contract-evaluator'

/**
 * @typedef {object} ContractViolation
 * @property {string} code
 * @property {string} message
 * @property {'hard'|'soft'} severity
 */

/**
 * @typedef {object} ContractEvaluation
 * @property {boolean} ok
 * @property {ContractViolation[]} violations
 * @property {boolean} needsRewrite
 * @property {string|null} rewriteBrief
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

const DEAD_ACK_RE =
  /^(va bene\.?|ok\.?|okay\.?|capisco\.?|perfetto\.?|d['’]accordo\.?|certo\.?)$/i

const QUESTION_RE = /\?\s*$/

/**
 * Evaluate whether Writer output preserves the Planner contract.
 * Pure. No LLM.
 *
 * @param {{
 *   responseText?: string,
 *   plan?: object|null,
 *   conversationState?: object|null,
 * }} [input]
 * @returns {ContractEvaluation}
 */
export function evaluateContractFidelity(input = {}) {
  const text = asString(input.responseText).replace(/\s+/g, ' ').trim()
  const plan = input.plan && typeof input.plan === 'object' ? input.plan : {}
  const brief =
    plan.writerBrief && typeof plan.writerBrief === 'object' ? plan.writerBrief : {}
  const state =
    input.conversationState && typeof input.conversationState === 'object'
      ? input.conversationState
      : null

  /** @type {ContractViolation[]} */
  const violations = []

  const move = asString(brief.conversationalMove || 'default')
  const shouldAsk = Boolean(brief.shouldAskQuestion)
  const forceMinimalAck = Boolean(brief.forceMinimalAck)
  const topic = asString(brief.activeTopic || state?.activeTopic || '')
  const phase = asString(state?.conversationPhase || '')
  const objective = asString(plan.objective || '')

  if (!text) {
    violations.push({
      code: 'empty_response',
      message: 'Writer returned empty text',
      severity: 'hard',
    })
  }

  // Execute/continue must not collapse to acknowledgement.
  if (
    (move === 'execute_pending_proposal' || move === 'continue_topic') &&
    text &&
    DEAD_ACK_RE.test(text)
  ) {
    violations.push({
      code: 'collapsed_execute_continue',
      message: `Move ${move} collapsed to acknowledgement`,
      severity: 'hard',
    })
  }

  // Closing must not reopen with a substantive new thread + question.
  if ((move === 'stop' || phase === 'closing') && text) {
    if (QUESTION_RE.test(text) && text.length > 40) {
      violations.push({
        code: 'reopened_closing',
        message: 'Closing/stop reply reopened with a question',
        severity: 'hard',
      })
    }
  }

  // shouldAskQuestion=false → no trailing question (soft unless execute/continue).
  if (!shouldAsk && text && QUESTION_RE.test(text)) {
    const severity =
      move === 'execute_pending_proposal' || move === 'continue_topic' || move === 'stop'
        ? 'hard'
        : 'soft'
    violations.push({
      code: 'unexpected_question',
      message: 'Reply asks a question while shouldAskQuestion=false',
      severity,
    })
  }

  // Topic continuity: if topic is set and move continues, reply should not be empty ack.
  if (topic && (move === 'continue_topic' || move === 'execute_pending_proposal') && text) {
    if (forceMinimalAck) {
      violations.push({
        code: 'force_minimal_ack_conflict',
        message: 'forceMinimalAck set on execute/continue move',
        severity: 'hard',
      })
    }
  }

  // Objective/passive: forceMinimalAck paths may be short.
  if (move === 'passive_acknowledgement' && text && text.length > 120 && !forceMinimalAck) {
    violations.push({
      code: 'passive_too_long',
      message: 'Passive acknowledgement grew beyond a short ack',
      severity: 'soft',
    })
  }

  void objective

  const hard = violations.filter((v) => v.severity === 'hard')
  const needsRewrite = hard.length > 0
  /** @type {string|null} */
  let rewriteBrief = null
  if (needsRewrite) {
    rewriteBrief = [
      'CONTRACT REWRITE (HOW only — do not change WHAT):',
      `conversationalMove=${move}`,
      `objective=${objective || move}`,
      `activeTopic=${topic || '(none)'}`,
      `shouldAskQuestion=${shouldAsk}`,
      `shouldContinue=${Boolean(brief.shouldContinue)}`,
      `forceMinimalAck=${forceMinimalAck}`,
      'Violations:',
      ...hard.map((v) => `- ${v.code}: ${v.message}`),
      'Preserve topic and move. Do not invent a new strategy. Do not ask a question unless shouldAskQuestion=true.',
      move === 'execute_pending_proposal' || move === 'continue_topic'
        ? 'Deliver the pending content now — never reply with only "Va bene." / "Ok."'
        : '',
      move === 'stop' ? 'Close warmly and briefly. Do not reopen the prior subject.' : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  return {
    ok: hard.length === 0,
    violations,
    needsRewrite,
    rewriteBrief,
  }
}

/**
 * @param {unknown} value
 * @returns {value is ContractEvaluation}
 */
export function isContractEvaluation(value) {
  if (!value || typeof value !== 'object') return false
  const v = /** @type {any} */ (value)
  return typeof v.ok === 'boolean' && Array.isArray(v.violations)
}
