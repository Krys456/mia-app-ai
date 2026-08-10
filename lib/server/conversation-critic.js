/**
 * LAIfe Conversation Critic
 *
 * Runs AFTER the Writer (pre-send gate). Validates the draft against the
 * Conversation Planner plan and quality rules.
 *
 * Reject / rewrite when the draft:
 *   - changes subject unnecessarily
 *   - becomes an essay
 *   - repeats recent patterns
 *   - ignores conversation history
 *   - forces philosophical reflections
 *   - forces motivational content
 *   - ignores the user's intent / planner plan
 *
 * Also asks: did this advance the planned five-minute arc?
 *
 * Invisible. Fail-soft. Shares the one-pass refine budget in api/chat.
 */

import { draftViolatesConversationPlanner } from './conversation-planner-engine.js'
import { scoreEssayLikeness } from './human-conversation-corpus.js'

/**
 * @typedef {import('./conversation-planner-engine.js').ConversationPlannerPlan} ConversationPlannerPlan
 */

/**
 * @typedef {object} ConversationCriticResult
 * @property {boolean} ok
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {string[]} failed
 * @property {string[]} reasons
 * @property {number} failScore
 */

const PHILOSOPHY_FORCE_RE =
  /\b(the\s+meaning\s+of\s+life|il\s+senso\s+della\s+vita|existential|esistenzial|in\s+the\s+grand\s+scheme|in\s+ultima\s+analisi\s+tutto)\b/i

const MOTIVATIONAL_FORCE_RE =
  /\b(believe\s+in\s+yourself|credi\s+in\s+te|you\s+got\s+this|ogni\s+giorno\s+[eè]\s+una\s+nuova\s+opportunit|never\s+give\s+up|non\s+mollare\s+mai)\b/i

const SUBJECT_JUMP_RE =
  /\b(let'?s\s+talk\s+about|parliamo\s+di|on\s+another\s+note|cambiando\s+argomento|completely\s+unrelated)\b/i

/**
 * @param {string} draft
 * @param {ConversationPlannerPlan | null | undefined} plannerPlan
 * @param {object} [ctx]
 * @returns {ConversationCriticResult}
 */
export function critiqueAgainstPlanner(draft, plannerPlan, ctx = {}) {
  const text = String(draft || '').trim()
  /** @type {string[]} */
  const failed = []
  /** @type {string[]} */
  const reasons = []
  let failScore = 0

  if (!plannerPlan?.active) {
    return {
      ok: true,
      needsRefine: false,
      refineBrief: '',
      failed: [],
      reasons: ['no_planner'],
      failScore: 0,
    }
  }

  if (!text) {
    return {
      ok: false,
      needsRefine: true,
      refineBrief: 'Conversation Critic: empty draft — rewrite following the Conversation Planner plan.',
      failed: ['empty'],
      reasons: ['empty'],
      failScore: 1,
    }
  }

  const p = plannerPlan.plan

  if (draftViolatesConversationPlanner(text, plannerPlan)) {
    failed.push('planner_mismatch')
    failScore += 0.45
    reasons.push('draft_vs_plan')
  }

  let essayScore = 0
  try {
    essayScore = scoreEssayLikeness(text).score
  } catch {
    essayScore = 0
  }
  if (p.depth <= 3 && essayScore > 25) {
    failed.push('essay_voice')
    failScore += 0.35
    reasons.push(`essay_${essayScore}`)
  }

  if (p.topicAction === 'stay' && SUBJECT_JUMP_RE.test(text)) {
    failed.push('unnecessary_subject_change')
    failScore += 0.4
    reasons.push('subject_jump')
  }

  if (p.strategy !== 'reflect' && p.depth <= 3 && PHILOSOPHY_FORCE_RE.test(text)) {
    failed.push('forced_philosophy')
    failScore += 0.3
    reasons.push('philosophy_forced')
  }

  if (MOTIVATIONAL_FORCE_RE.test(text) && p.lookingFor !== 'emotional_presence') {
    failed.push('forced_motivational')
    failScore += 0.3
    reasons.push('motivational_forced')
  }

  if (
    (p.strategy === 'explain' || p.lookingFor === 'learning' || p.lookingFor === 'information') &&
    text.length < 40 &&
    !/\b(is|è|are|sono|means|significa)\b/i.test(text)
  ) {
    failed.push('ignored_intent')
    failScore += 0.35
    reasons.push('too_thin_for_teach')
  }

  const prior = Array.isArray(ctx.messages)
    ? ctx.messages.filter((m) => m?.role === 'assistant').slice(-1)[0]
    : null
  if (
    prior &&
    p.topicAction === 'stay' &&
    /^(ciao|hey|hi|hello)!?\s/i.test(text) &&
    text.length > 100
  ) {
    failed.push('ignore_history')
    failScore += 0.25
    reasons.push('cold_reset')
  }

  const needsRefine = failScore >= 0.35 || failed.length >= 2
  const refineBrief = needsRefine
    ? [
        'Conversation Critic: riscrivi seguendo il Conversation Planner.',
        `Plan: strategy=${p.strategy} · depth=${p.depth} · topic=${p.topicAction} · feel=${p.emotion} · goal«${p.goal}».`,
        `5-min arc: ${p.fiveMinuteArc}`,
        failed.length ? `Failed: ${failed.join(', ')}.` : '',
        'Reject: subject jumps · essays · forced philosophy/motivation · ignoring intent/history.',
        'Optimize for the next 5 minutes of conversation, not only this message.',
      ]
        .filter(Boolean)
        .join(' ')
    : ''

  return {
    ok: !needsRefine,
    needsRefine,
    refineBrief,
    failed,
    reasons,
    failScore: Math.min(1, failScore),
  }
}

/**
 * @param {string} draft
 * @param {ConversationPlannerPlan | null | undefined} plannerPlan
 * @param {object} [ctx]
 */
export function draftViolatesConversationCritic(draft, plannerPlan, ctx = {}) {
  return critiqueAgainstPlanner(draft, plannerPlan, ctx).needsRefine
}
