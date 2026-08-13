/**
 * LAIfe V2 — Authoritative short-reply interpretation (Phase 1)
 *
 * Owns the contextual meaning of short user replies BEFORE Writer.
 * Planner consumes this result and publishes an immutable conversational move.
 * Writer must NOT re-interpret short replies into a different move.
 *
 * Perception may observe surface cues; it does not own this interpretation.
 */

/**
 * @typedef {'accept_proposal'|'continue'|'passive_acknowledgement'|'stop'|'uncertain'|'change_topic'|'decline_proposal'|'not_short_reply'} ShortReplyIntent
 */

/**
 * Writer-facing conversational move chosen by Planner from short-reply intent.
 * @typedef {'execute_pending_proposal'|'continue_topic'|'passive_acknowledgement'|'stop'|'clarify_uncertain'|'change_topic'|'decline_proposal'|'default'} ConversationalMove
 */

/**
 * @typedef {object} ShortReplyState
 * @property {boolean} isShortReply
 * @property {ShortReplyIntent} intent
 * @property {number} confidence 0..1
 * @property {boolean} hasPendingProposal
 * @property {string|null} pendingProposalType
 * @property {string} userText
 * @property {string} previousAssistant
 * @property {string} reason
 * @property {ConversationalMove} conversationalMove
 */

const ALLOWED_MINIMAL_ASSISTANT = new Set(['Perfetto.', 'Ci siamo.', 'Esatto.', 'Va bene.'])

const SHORT_REPLY_CANDIDATE_RE =
  /^(ok|okay|okey|okk|va\s*bene|d['’]?accordo|alright|all\s*right|sì|si|yes|yep|yeah|yup|certo|esatto|perfetto|vai|vai\s*pure|continua|continuiamo|dai|procedi|go\s*on|go\s*ahead|keep\s*going|tell\s*me\s*more|dimmi|dimmi\s*di\s*più|👍|👌|mh+|mhm+|mm+|uhm+|grazie|thanks|thank\s+you|ok\s+grazie)[.!…]*$/i

const MINIMAL_SURFACE_RE =
  /^(ok|okay|okey|okk|esatto|certo|perfetto|va\s*bene|d['’]?accordo|sure|exactly|right|perfect|alright|all\s*right|sì|si|yes|yep|yeah|yup|vai|continua|continuiamo|dai|procedi|go\s*on|keep\s*going|👍|👌)[.!…]*$/i

const STOP_SHORT_REPLY_RE =
  /\b(basta(\s+cos[iì])?|stop(\s+here)?|chiudiamo|nient['’]?altro|that['’]?s\s+all|no\s+grazie|non\s+serve|ho\s+finito|fine\s+cos[iì]|enough)\b/i

const DECLINE_PROPOSAL_RE =
  /^(no|nope|nah|no\s+grazie|preferisco\s+di\s+no|non\s+ora|not\s+now|no\s+thanks)[.!…]*$/i

const THANKS_DONE_RE =
  /^(ok\s+)?(grazie|thanks|thank\s+you)([.!…]*|\s+mille[.!…]*)?$/i

const CHANGE_TOPIC_SHORT_RE =
  /\b(cambiamo\s+argomento|parliamo\s+d['’]?altro|another\s+topic|something\s+else|di\s+qualcos['’]?altro)\b/i

const EXPLICIT_GO_ON_RE =
  /^(vai|vai\s*pure|continua|continuiamo|dai|procedi|go\s*on|go\s*ahead|keep\s*going|tell\s*me\s*more|dimmi|dimmi\s*di\s*più)[.!…]*$/i

const UNCERTAIN_RE = /^(mh+|mhm+|mm+|uhm+)[.!…]*$/i

/** Prior assistant turn looks like an unresolved conversational proposal / offer. */
const UNRESOLVED_PROPOSAL_RES = [
  // Explicit offers only — bare "possiamo/parliamo" is too weak (phantom contamination).
  /\b(posso|vorrei|voglio)\s+(spieg|raccont|mostrar|parlar|propor|iniziar|partir|continuar)/i,
  /\b(se\s+vuoi|vuoi\s+che|want\s+me\s+to|shall\s+we|if\s+you\s+want)\b/i,
  /\b(ti\s+(racconto|spiego|dico|mostro)|let\s+me\s+(tell|explain|show)|i\s+can\s+(tell|explain|show))\b/i,
  /\b(magari|adesso\s+ti|allora\s+(scelgo|ti\s+dico|parto))\b/i,
  /\b(continu\w*\s+(con|con\s+la)|seconda\s+parte|prossima\s+parte)\b/i,
  /\b(parliamo\s+di|let'?s\s+talk\s+about|curiosit[aà]\s+(scientific|su|sul|sulla|di))\b/i,
  /\b(possiamo\s+(parlare|approfondire|continuar|esplor)\w*\s+(di|del|della|dei|degli|delle|su|sul|sulla|about))\b/i,
]

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
 * Central unresolved pronoun / clitic with no grounded subject → not a proposal.
 * @param {string} text
 * @returns {boolean}
 */
function hasUnresolvedProposalReferent(text) {
  const t = asString(text)
  if (/\b(proteggerla|proteggerlo|aiutarla|aiutarlo|salvarla|salvarlo)\b/i.test(t)) {
    if (!/\b(su|sul|sulla|sui|dei|degli|delle|di|about|regarding)\s+[A-Za-zÀ-ÿ]{3,}/i.test(t)) {
      return true
    }
  }
  return false
}

/**
 * @param {Array<{ role?: string, content?: string }>} [messages]
 * @returns {{ userText: string, previousAssistant: string, lastSubstantiveAssistant: string }}
 */
export function splitLatestTurns(messages = []) {
  /** @type {Array<{ role: string, content: string }>} */
  const list = []
  if (Array.isArray(messages)) {
    for (const m of messages) {
      if (!m || typeof m !== 'object') continue
      const role = asString(m.role).toLowerCase()
      const content = asString(m.content).trim()
      if (!content) continue
      if (role !== 'user' && role !== 'assistant' && role !== 'system') continue
      list.push({ role, content })
    }
  }
  let userText = ''
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].role === 'user') {
      userText = list[i].content
      break
    }
  }
  let previousAssistant = ''
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].role !== 'assistant') continue
    previousAssistant = list[i].content
    break
  }
  let lastSubstantiveAssistant = ''
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].role !== 'assistant') continue
    const content = list[i].content
    if (ALLOWED_MINIMAL_ASSISTANT.has(content) || /^(capisco|ok|okay)\.?$/i.test(content)) {
      continue
    }
    if (content.length < 12) continue
    lastSubstantiveAssistant = content
    break
  }
  return { userText, previousAssistant, lastSubstantiveAssistant }
}

/**
 * True when the prior assistant turn still has an open proposal / offer / next step.
 * @param {string} assistantText
 * @returns {boolean}
 */
export function hasUnresolvedConversationalProposal(assistantText) {
  const t = asString(assistantText).replace(/\s+/g, ' ').trim()
  if (!t || t.length < 8) return false
  if (ALLOWED_MINIMAL_ASSISTANT.has(t) || /^(capisco|ok|okay)\.?$/i.test(t)) return false
  // Self-contained completed answers without offers are not proposals.
  if (
    /\b(questa\s+è\s+la\s+procedura|ecco\s+(fatto|complet|tutto)|that's\s+(it|all)|procedura\s+completa|spiegazione\s+completa)\b/i.test(
      t,
    ) &&
    !/\?\s*$/.test(t) &&
    !/\b(posso|possiamo|se\s+vuoi|vuoi)\b/i.test(t)
  ) {
    return false
  }
  // Unresolved pronouns ("proteggerla") with no subject → never a proposal.
  if (hasUnresolvedProposalReferent(t)) return false
  if (UNRESOLVED_PROPOSAL_RES.some((re) => re.test(t))) return true
  // Trailing question can be an open proposal only with an explicit subject cue.
  if (
    /\?\s*$/.test(t) &&
    /\b(vuoi|posso|possiamo|shall|want|preferisci|ti\s+interessa)\b/i.test(t) &&
    /\b(su|sul|sulla|di|dei|degli|delle|about|regarding)\s+[A-Za-zÀ-ÿ]{3,}/i.test(t)
  ) {
    return true
  }
  return false
}

/**
 * @param {string} assistantText
 * @returns {string|null}
 */
export function inferPendingProposalType(assistantText) {
  const t = asString(assistantText)
  if (!t) return null
  if (!hasUnresolvedConversationalProposal(t)) return null
  if (/\b(continu\w*|seconda\s+parte|prossima\s+parte)\b/i.test(t)) return 'continue_part'
  if (/\b(spieg|explain|funzion|how\s+.+works)\b/i.test(t)) return 'explain'
  if (/\b(raccont|storia|story|assurdo|curiosit)/i.test(t)) return 'tell_curiosity'
  if (
    /\b(esplor|parliamo\s+di|let'?s\s+talk\s+about|possiamo\s+(parlare|approfondire|esplor))\b/i.test(
      t,
    )
  ) {
    return 'explore_topic'
  }
  if (/\?\s*$/.test(t)) return 'open_question'
  return 'open_offer'
}

/**
 * @param {ShortReplyIntent} intent
 * @returns {ConversationalMove}
 */
export function shortReplyIntentToMove(intent) {
  switch (intent) {
    case 'accept_proposal':
      return 'execute_pending_proposal'
    case 'continue':
      return 'continue_topic'
    case 'passive_acknowledgement':
      return 'passive_acknowledgement'
    case 'stop':
      return 'stop'
    case 'uncertain':
      return 'clarify_uncertain'
    case 'change_topic':
      return 'change_topic'
    case 'decline_proposal':
      return 'decline_proposal'
    default:
      return 'default'
  }
}

/**
 * Authoritative short-reply interpretation.
 * Depends on recent conversational turns — never on a fixed word meaning.
 *
 * @param {{
 *   messages?: Array<{ role?: string, content?: string }>,
 *   userMessage?: string,
 *   previousAssistant?: string,
 * }} [input]
 * @returns {ShortReplyState}
 */
export function interpretShortReply(input = {}) {
  const fromMessages = splitLatestTurns(input.messages)
  const userText = asString(input.userMessage || fromMessages.userText)
    .replace(/\s+/g, ' ')
    .trim()
  // Prefer last substantive assistant (skip "Va bene." dead-ends) for proposal detection.
  const prev = asString(
    input.previousAssistant ||
      fromMessages.lastSubstantiveAssistant ||
      fromMessages.previousAssistant,
  )
    .replace(/\s+/g, ' ')
    .trim()
  const hasPendingProposal = hasUnresolvedConversationalProposal(prev)
  const pendingProposalType = inferPendingProposalType(prev)

  /** @param {ShortReplyIntent} intent @param {number} confidence @param {string} reason @param {boolean} [isShort] */
  const result = (intent, confidence, reason, isShort = true) => ({
    isShortReply: isShort && intent !== 'not_short_reply',
    intent,
    confidence: Number(confidence.toFixed(3)),
    hasPendingProposal,
    pendingProposalType,
    userText,
    previousAssistant: prev,
    reason,
    conversationalMove: shortReplyIntentToMove(intent),
  })

  if (!userText) {
    return result('not_short_reply', 0.2, 'empty', false)
  }

  if (STOP_SHORT_REPLY_RE.test(userText)) {
    // "no grazie" with open proposal → decline (clear proposal) rather than full conversation stop
    // when the phrase is primarily a soft refusal of the offer.
    if (hasPendingProposal && DECLINE_PROPOSAL_RE.test(userText) && !/\bbasta\b/i.test(userText)) {
      return result('decline_proposal', 0.93, 'decline_open_proposal')
    }
    return result('stop', 0.95, 'stop_phrase')
  }

  if (THANKS_DONE_RE.test(userText) && !hasPendingProposal) {
    return result('stop', 0.9, 'thanks_done')
  }

  if (CHANGE_TOPIC_SHORT_RE.test(userText)) {
    return result('change_topic', 0.88, 'change_topic_cue')
  }

  const shortForm =
    SHORT_REPLY_CANDIDATE_RE.test(userText) || MINIMAL_SURFACE_RE.test(userText)
  if (!shortForm) {
    // Bare "No." / "Nope" after a proposal (not in SHORT_REPLY_CANDIDATE_RE).
    if (hasPendingProposal && DECLINE_PROPOSAL_RE.test(userText)) {
      return result('decline_proposal', 0.92, 'decline_open_proposal')
    }
    return result('not_short_reply', 0.85, 'not_short_reply', false)
  }

  if (hasPendingProposal && DECLINE_PROPOSAL_RE.test(userText)) {
    return result('decline_proposal', 0.93, 'decline_open_proposal')
  }

  if (UNCERTAIN_RE.test(userText)) {
    return result(
      'uncertain',
      0.9,
      hasPendingProposal ? 'uncertain_with_proposal' : 'uncertain_bare',
    )
  }

  if (hasPendingProposal) {
    const goOnUser = EXPLICIT_GO_ON_RE.test(userText)
    const continueShaped =
      pendingProposalType === 'continue_part' ||
      /\b(continu\w*|seconda\s+parte|prossima\s+parte)\b/i.test(prev)
    if (goOnUser || continueShaped) {
      return result('continue', 0.94, goOnUser ? 'explicit_continue' : 'continue_shaped_proposal')
    }
    return result('accept_proposal', 0.94, 'accept_open_proposal')
  }

  // No open proposal: short agreement is a passive acknowledgement.
  return result('passive_acknowledgement', 0.92, 'no_pending_proposal')
}

/**
 * Surface observation helpers for Perception (non-authoritative).
 * @param {string} text
 * @returns {{ isShortReply: boolean, surfaceAgreement: boolean, surfaceContinuation: boolean, surfaceStop: boolean, surfaceUncertain: boolean }}
 */
export function observeShortReplySurface(text) {
  const t = asString(text).replace(/\s+/g, ' ').trim()
  return {
    isShortReply: SHORT_REPLY_CANDIDATE_RE.test(t) || MINIMAL_SURFACE_RE.test(t),
    surfaceAgreement:
      /^(ok|okay|okk|sì|si|yes|certo|va\s*bene|👍|👌)[.!…]*$/i.test(t),
    surfaceContinuation: EXPLICIT_GO_ON_RE.test(t),
    surfaceStop: STOP_SHORT_REPLY_RE.test(t) || THANKS_DONE_RE.test(t),
    surfaceUncertain: UNCERTAIN_RE.test(t),
  }
}

/**
 * Planner helper: force minimal ack only for passive acknowledgement move.
 * @param {ConversationalMove|string|null|undefined} move
 * @returns {boolean}
 */
export function moveRequiresMinimalAck(move) {
  return move === 'passive_acknowledgement'
}
