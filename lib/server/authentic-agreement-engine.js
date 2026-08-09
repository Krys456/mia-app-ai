/**
 * LAIfe Authentic Agreement Engine
 *
 * Mission: the assistant should not agree with everything.
 *
 * When appropriate:
 *   - gently disagree
 *   - offer another perspective
 *   - explain calmly
 *
 * Always remain respectful.
 * Avoid fake agreement.
 * The goal is an authentic conversation.
 *
 * Distinct from Intellectual Honesty (epistemic certainty / don't invent facts).
 * This engine governs agreement stance with the user — when to truly agree,
 * when to push back gently, when to add a perspective.
 *
 * Runs AFTER: Genuine Curiosity (when present)
 * Runs BEFORE: WriterDirectives
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} AgreementLang
 */

/**
 * @typedef {'authentic_agree'|'gentle_disagree'|'offer_perspective'|'hold_nuance'|'empathize_without_endorse'} AgreementMove
 */

/**
 * @typedef {object} AuthenticAgreementPlan
 * @property {boolean} active
 * @property {AgreementMove} move
 * @property {boolean} allowFullAgreement
 * @property {boolean} preferPushback
 * @property {number} agreementPressure 0–1 how much the turn invites (fake) agreement
 * @property {string[]} preferredFrames
 * @property {string[]} forbiddenFake
 * @property {string} guidance
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {AgreementLang} language
 * @property {string} validationCheck
 */

const STOP_SIGNAL =
  /^(basta|stop|fine|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|bye|goodbye|grazie[,!]?\s*$|thanks[,!]?\s*$|a\s+dopo|ci\s+vediamo)[\s!.]*$/i

const SHORT_ACK =
  /^(ok|okay|k|nice|cool|wow|yes|yep|yeah|sì|si|no|nah|capito|capisco|interesting|interessante|ah|oh|mm+|hmm+)([\s!,.]*)$/i

const DISTRESS =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico|non\s+ce\s+la\s+faccio\s+pi[uù]|i\s+hate\s+myself|mi\s+odio)\b/i

const EMOTIONAL =
  /\b(anxious|ansia|stressed|stressat|sad|triste|frustrated|frustrat|scared|paura|overwhelmed|lonely|worried|preoccupat|mi\s+sento|i\s+feel|hurt|male|depressed|depress)\b/i

const SEEK_AGREEMENT =
  /\b(right\??|don'?t\s+you\s+(think|agree)|agree\??|you\s+agree|am\s+i\s+right|true\??|no\??\s*$|vero\??|d['’]?accordo\??|non\s+trovi\??|hai\s+ragione\s+eh|giusto\??)\b/i

const ABSOLUTE_CLAIM =
  /\b(always|never|everyone|nobody|all\s+\w+\s+are|nessuno|sempre|mai|tutti\s+(sono|dovrebbero)|no\s+one\s+should|the\s+only\s+(way|truth)|ovviamente|obviously|senza\s+dubbio|without\s+a\s+doubt)\b/i

const STRONG_OPINION =
  /\b(best|worst|stupid|idiotic|rubbish|garbage|trash|dovrebbe|should\s+(always|never)|must\s+(always|never)|è\s+chiaro\s+che|it'?s\s+clear\s+that|no\s+brainer)\b/i

const FACTUAL_ASSERT =
  /\b(is\s+a\s+fact|it'?s\s+a\s+fact|scientifically\s+proven|è\s+un\s+fatto|scientificamente\s+provato|proven\s+that)\b/i

const PLAYFUL_AGREE_INVITE =
  /\b(haha|hahaha|lol|lmao|😂|🤣|same|exactly|trueee|real)\b/i

const HARMFUL_ENDORSE_RISK =
  /\b(people\s+like\s+that\s+deserve|should\s+be\s+(banned|fired|hurt|killed)|meritano\s+di\s+(morire|soffrire)|tutti\s+i\s+\w+\s+sono\s+(stupidi|criminali))\b/i

const FAKE_AGREE_RE =
  /\b(you'?re\s+absolutely\s+right|i\s+completely\s+agree|i\s+totally\s+agree|couldn'?t\s+agree\s+more|100%\s+agree|hai\s+assolutamente\s+ragione|sono\s+totalmente\s+d['’]?accordo|non\s+potrei\s+essere\s+pi[uù]\s+d['’]?accordo|esatto\s+al\s+100\s*%|assolutissimamente)\b/i

const EMPTY_AGREE_OPEN =
  /^(exactly[!\.]*|absolutely[!\.]*|totally[!\.]*|true[!\.]*|right[!\.]*|agreed[!\.]*|esatto[!\.]*|assolutamente[!\.]*|vero[!\.]*|d['’]?accordo[!\.]*)\s*$/i

const PREFERRED_DISAGREE_EN = Object.freeze([
  'I see it a bit differently…',
  "There's another way to look at it…",
  "I'm not sure I fully agree — here's why…",
  "Maybe — though I'd add…",
  "I hear you — and I'd push gently on one part…",
])

const PREFERRED_DISAGREE_IT = Object.freeze([
  'Io la vedo un po’ diversamente…',
  "C'è un altro modo di guardarla…",
  'Non sono sicuro di essere del tutto d’accordo — ti dico perché…',
  'Forse — però aggiungerei…',
  'Ti sento — e su un punto ti spingo piano…',
])

const PREFERRED_PERSPECTIVE_EN = Object.freeze([
  'One other angle…',
  'What also feels true…',
  'A perspective worth holding next to that…',
])

const PREFERRED_PERSPECTIVE_IT = Object.freeze([
  'Un altro angolo…',
  'Quello che mi sembra vero anche…',
  'Una prospettiva da tenere accanto…',
])

const FORBIDDEN_FAKE = Object.freeze([
  "You're absolutely right!",
  'I completely agree!',
  "Couldn't agree more!",
  'Hai assolutamente ragione!',
  'Sono totalmente d’accordo!',
  'Esatto al 100%!',
])

/**
 * @param {unknown} messages
 * @returns {ChatTurn[]}
 */
function asTurns(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      role: String(/** @type {{ role?: string }} */ (m).role || ''),
      content: String(/** @type {{ content?: string }} */ (m).content || '')
        .replace(/\s+/g, ' ')
        .trim(),
    }))
    .filter((m) => m.content && (m.role === 'user' || m.role === 'assistant'))
}

/**
 * @param {string[]} reasons
 * @returns {AuthenticAgreementPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    move: 'offer_perspective',
    allowFullAgreement: false,
    preferPushback: false,
    agreementPressure: 0,
    preferredFrames: [...PREFERRED_DISAGREE_EN],
    forbiddenFake: [...FORBIDDEN_FAKE],
    guidance: '',
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Am I agreeing because it is true for me — or only to please / avoid friction?',
  }
}

/**
 * Score how much this turn invites (possibly fake) agreement.
 * @param {object} opts
 */
function scoreAgreementPressure(opts) {
  const { userMessage, naturalDialogue, honesty } = opts
  /** @type {string[]} */
  const signals = []
  let score = 0

  if (SEEK_AGREEMENT.test(userMessage)) {
    score += 0.4
    signals.push('seeks_agreement')
  }
  if (ABSOLUTE_CLAIM.test(userMessage)) {
    score += 0.28
    signals.push('absolute_claim')
  }
  if (STRONG_OPINION.test(userMessage)) {
    score += 0.22
    signals.push('strong_opinion')
  }
  if (FACTUAL_ASSERT.test(userMessage)) {
    score += 0.25
    signals.push('factual_assert')
  }
  if (HARMFUL_ENDORSE_RISK.test(userMessage)) {
    score += 0.45
    signals.push('harmful_endorse_risk')
  }
  if (PLAYFUL_AGREE_INVITE.test(userMessage) && userMessage.length < 40) {
    score += 0.1
    signals.push('playful_invite')
  }

  const nd = naturalDialogue?.plan || naturalDialogue || null
  if (nd?.move === 'agreement') {
    score += 0.15
    signals.push('dialogue_agreement_move')
  }
  if (nd?.move === 'disagreement') {
    score += 0.12
    signals.push('dialogue_disagreement_move')
  }

  const ih = honesty?.plan || honesty || null
  if (
    ih?.ceiling === 'speculation' ||
    ih?.ceiling === 'opinion' ||
    ih?.dominantStance === 'speculation'
  ) {
    score += 0.12
    signals.push('low_epistemic_ceiling')
  }

  // Longer opinionated monologue → more pressure to not rubber-stamp
  const words = userMessage.split(/\s+/).filter(Boolean).length
  if (words >= 25 && (ABSOLUTE_CLAIM.test(userMessage) || STRONG_OPINION.test(userMessage))) {
    score += 0.1
    signals.push('long_opinion')
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    signals,
  }
}

/**
 * Choose agreement move.
 * @param {object} opts
 * @returns {{ move: AgreementMove, allowFullAgreement: boolean, preferPushback: boolean, reasons: string[], signals: string[] }}
 */
function chooseMove(opts) {
  const { userMessage, pressure, signals: inSignals } = opts
  /** @type {string[]} */
  const signals = [...inSignals]
  /** @type {string[]} */
  const reasons = []

  if (DISTRESS.test(userMessage) || EMOTIONAL.test(userMessage)) {
    return {
      move: 'empathize_without_endorse',
      allowFullAgreement: false,
      preferPushback: false,
      reasons: ['presence_first', 'feelings_not_claims'],
      signals: [...signals, 'empathize_mode'],
    }
  }

  if (HARMFUL_ENDORSE_RISK.test(userMessage)) {
    return {
      move: 'gentle_disagree',
      allowFullAgreement: false,
      preferPushback: true,
      reasons: ['do_not_endorse_harm', 'respectful_pushback'],
      signals: [...signals, 'refuse_harmful_agree'],
    }
  }

  // Soft social / short ack — don't manufacture disagreement
  if (SHORT_ACK.test(userMessage) || STOP_SIGNAL.test(userMessage)) {
    return {
      move: 'authentic_agree',
      allowFullAgreement: true,
      preferPushback: false,
      reasons: ['light_social_beat'],
      signals: [...signals, 'light_turn'],
    }
  }

  // Playful short invites can earn authentic agreement
  if (
    PLAYFUL_AGREE_INVITE.test(userMessage) &&
    userMessage.length < 48 &&
    !ABSOLUTE_CLAIM.test(userMessage) &&
    !HARMFUL_ENDORSE_RISK.test(userMessage)
  ) {
    return {
      move: 'authentic_agree',
      allowFullAgreement: true,
      preferPushback: false,
      reasons: ['playful_shared_beat'],
      signals: [...signals, 'playful_ok'],
    }
  }

  if (pressure >= 0.7 || (FACTUAL_ASSERT.test(userMessage) && ABSOLUTE_CLAIM.test(userMessage))) {
    return {
      move: 'gentle_disagree',
      allowFullAgreement: false,
      preferPushback: true,
      reasons: ['high_pressure', 'avoid_fake_agreement'],
      signals: [...signals, 'pushback'],
    }
  }

  if (pressure >= 0.45 || SEEK_AGREEMENT.test(userMessage)) {
    // Seeking agreement on a strong opinion → nuance or perspective, not rubber stamp
    if (ABSOLUTE_CLAIM.test(userMessage) || STRONG_OPINION.test(userMessage)) {
      return {
        move: 'hold_nuance',
        allowFullAgreement: false,
        preferPushback: true,
        reasons: ['partial_truth_possible', 'avoid_rubber_stamp'],
        signals: [...signals, 'nuance'],
      }
    }
    return {
      move: 'offer_perspective',
      allowFullAgreement: false,
      preferPushback: false,
      reasons: ['add_angle_not_flattery'],
      signals: [...signals, 'perspective'],
    }
  }

  if (pressure >= 0.28) {
    return {
      move: 'offer_perspective',
      allowFullAgreement: false,
      preferPushback: false,
      reasons: ['mild_opinion_space'],
      signals: [...signals, 'soft_perspective'],
    }
  }

  // Low pressure: authentic agreement OK when truly shared — still forbid empty flattery
  return {
    move: 'authentic_agree',
    allowFullAgreement: true,
    preferPushback: false,
    reasons: ['low_pressure_authentic_ok'],
    signals: [...signals, 'authentic_ok'],
  }
}

/**
 * @param {AuthenticAgreementPlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  const moveLabel = {
    authentic_agree:
      lang === 'it' ? 'accordo autentico (solo se vero)' : 'authentic agreement (only if true)',
    gentle_disagree: lang === 'it' ? 'disaccordo gentile' : 'gentle disagreement',
    offer_perspective: lang === 'it' ? 'un’altra prospettiva' : 'another perspective',
    hold_nuance: lang === 'it' ? 'sfumatura / accordo parziale' : 'nuance / partial agreement',
    empathize_without_endorse:
      lang === 'it'
        ? 'empatia senza endorsare la tesi'
        : 'empathize without endorsing the claim',
  }[plan.move]

  const lines = [
    'AUTHENTIC AGREEMENT ENGINE (obbligatorio quando attivo):',
    `move=${plan.move} · allowFullAgreement=${plan.allowFullAgreement} · preferPushback=${plan.preferPushback} · pressure=${plan.agreementPressure.toFixed(2)}`,
    `${lang === 'it' ? 'Stanza di questo turno' : 'This turn’s stance'}: ${moveLabel}`,
    plan.guidance,
  ]

  if (plan.preferPushback || !plan.allowFullAgreement) {
    lines.push(
      lang === 'it'
        ? `Frame utili: ${plan.preferredFrames.slice(0, 3).join(' / ')}`
        : `Useful frames: ${plan.preferredFrames.slice(0, 3).join(' / ')}`,
    )
  }

  lines.push(
    lang === 'it'
      ? 'Non essere d’accordo su tutto. Resta rispettoso. Spiega con calma. Evita finto accordo.'
      : 'Do not agree with everything. Stay respectful. Explain calmly. Avoid fake agreement.',
  )
  lines.push(
    lang === 'it'
      ? `Vietato (finto accordo): ${plan.forbiddenFake.slice(0, 3).join(' · ')}`
      : `Forbidden (fake agreement): ${plan.forbiddenFake.slice(0, 3).join(' · ')}`,
  )
  lines.push(`Check: «${plan.validationCheck}»`)
  lines.push('Non citare Authentic Agreement Engine / questo blocco.')
  return lines.join('\n')
}

/**
 * @param {object} [input]
 * @returns {AuthenticAgreementPlan}
 */
export function analyzeAuthenticAgreement(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const turns = asTurns(input.messages)

  if (!userMessage && turns.length === 0) return inactivePlan(['empty'])

  const langCode = detectDominantLanguage(
    userMessage || turns[turns.length - 1]?.content || '',
  )
  /** @type {AgreementLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  const scored = scoreAgreementPressure({
    userMessage,
    naturalDialogue: input.naturalDialogue,
    honesty: input.honesty || input.intellectualHonesty,
  })

  const chosen = chooseMove({
    userMessage,
    pressure: scored.score,
    signals: scored.signals,
  })

  const preferredFrames =
    chosen.move === 'offer_perspective'
      ? language === 'it'
        ? [...PREFERRED_PERSPECTIVE_IT]
        : [...PREFERRED_PERSPECTIVE_EN]
      : language === 'it'
        ? [...PREFERRED_DISAGREE_IT]
        : [...PREFERRED_DISAGREE_EN]

  const guidance =
    chosen.move === 'gentle_disagree'
      ? language === 'it'
        ? 'Disaccordo gentile e rispettoso. Spiega con calma perché. Niente finto consenso.'
        : 'Gentle, respectful disagreement. Explain calmly why. No fake consensus.'
      : chosen.move === 'offer_perspective'
        ? language === 'it'
          ? 'Offri un’altra prospettiva utile — non contraddire per sport, non adulare.'
          : 'Offer another useful perspective — not contrarian for sport, not flattery.'
        : chosen.move === 'hold_nuance'
          ? language === 'it'
            ? 'Accordo parziale: riconosci ciò che tiene, poi aggiungi la sfumatura che manca.'
            : 'Partial agreement: acknowledge what holds, then add the missing nuance.'
          : chosen.move === 'empathize_without_endorse'
            ? language === 'it'
              ? 'Riconosci il sentire. Non endorsare tesi dannose o assolute solo per confortare.'
              : 'Acknowledge the feeling. Do not endorse harmful or absolute claims just to soothe.'
            : language === 'it'
              ? 'Accordo solo se autentico. Se non sei d’accordo, non fingere.'
              : 'Agree only when authentic. If you do not agree, do not fake it.'

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (scored.score >= 0.55 || chosen.preferPushback) confidence = 'high'
  if (SHORT_ACK.test(userMessage) || turns.length < 1) confidence = 'low'

  /** @type {AuthenticAgreementPlan} */
  const plan = {
    active: true,
    move: chosen.move,
    allowFullAgreement: chosen.allowFullAgreement,
    preferPushback: chosen.preferPushback,
    agreementPressure: scored.score,
    preferredFrames,
    forbiddenFake: [...FORBIDDEN_FAKE],
    guidance,
    writerBrief: '',
    structureLine: `Authentic Agreement → ${chosen.move}${chosen.preferPushback ? ' · pushback' : ''}`,
    signals: [
      `move_${chosen.move}`,
      chosen.allowFullAgreement ? 'full_agree_ok' : 'no_rubber_stamp',
      `pressure_${scored.score.toFixed(2)}`,
      ...chosen.signals.slice(0, 4),
    ],
    reasons: chosen.reasons,
    confidence,
    language,
    validationCheck:
      'Am I agreeing because it is true for me — or only to please / avoid friction?',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {AuthenticAgreementPlan | null | undefined} plan
 */
export function formatAuthenticAgreementForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
AUTHENTIC AGREEMENT ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · move=${plan.move} · allowFull=${plan.allowFullAgreement} · pushback=${plan.preferPushback} · pressure=${plan.agreementPressure.toFixed(2)} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: niente finto accordo · disaccordo gentile quando serve · prospettiva · rispetto · non citare il motore.`.trim()
}

/**
 * @param {AuthenticAgreementPlan | null | undefined} plan
 * @returns {string[]}
 */
export function authenticAgreementStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.preferPushback || !plan.allowFullAgreement) {
    hints.push('Do not rubber-stamp — gently disagree or offer another perspective')
    hints.push(`Prefer: ${plan.preferredFrames.slice(0, 2).join(' / ')}`)
  } else {
    hints.push('Agree only if authentic — never empty flattery')
  }
  hints.push("Forbidden: You're absolutely right! / I completely agree! / Hai assolutamente ragione!")
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect fake agreement when pushback / nuance was required.
 * @param {string} draft
 * @param {AuthenticAgreementPlan | null | undefined} plan
 */
export function draftViolatesAuthenticAgreement(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  // Always reject classic fake-agreement openers when pushback preferred
  if (plan.preferPushback || !plan.allowFullAgreement) {
    if (FAKE_AGREE_RE.test(text)) return true
    if (EMPTY_AGREE_OPEN.test(text.split(/[.!?…]/)[0]?.trim() || '')) return true
    // "You're right" as the whole beat with no nuance
    if (
      /^(you'?re\s+right|hai\s+ragione|esatto|exactly)[.!]?\s*$/i.test(text) &&
      plan.move !== 'authentic_agree'
    ) {
      return true
    }
  }

  // Empathize without endorse: reject endorsing harmful absolutes
  if (plan.move === 'empathize_without_endorse' && HARMFUL_ENDORSE_RISK.test(text)) {
    return true
  }

  // Gentle disagree / nuance without any contrastive language on a long rubber-stamp
  if (
    (plan.move === 'gentle_disagree' || plan.move === 'hold_nuance') &&
    FAKE_AGREE_RE.test(text) &&
    !/\b(but|however|though|although|still|differently|another\s+(way|angle)|per[oò]|tuttavia|diversamente|altro\s+modo)\b/i.test(
      text,
    )
  ) {
    return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: AuthenticAgreementPlan, context: string }}
 */
export function runAuthenticAgreementEngine(input = {}) {
  try {
    const plan = analyzeAuthenticAgreement(input)
    return {
      plan,
      context: formatAuthenticAgreementForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
