/**
 * LAIfe Social Conversation Engine
 *
 * Runs BEFORE Conversation Intent.
 *
 * Not every user message asks for information.
 * Many messages exist to build rapport, create connection, or simply continue
 * a conversation. Detect SOCIAL vs INFORMATIONAL and guide the Writer to
 * respond like a thoughtful human — not a customer-support chatbot.
 *
 * When SOCIAL:
 *   - do NOT treat as an information request
 *   - reply naturally; prioritize connection over information
 *   - sound relaxed; avoid overexplaining
 *   - avoid generic assistant wording
 *   - do not immediately change topic or force another question
 *   - do not always end with "What about you?"
 *   - sometimes a warm sentence is enough
 *   - respond in the same language as the social message
 *
 * Writer check: "Is the user seeking information, or simply making human contact?"
 * If human contact → warmth, rhythm, authenticity over information density.
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'greeting'|'farewell'|'how_are_you'|'whats_up'|'good_morning'|'good_night'|'thanks'|'congratulations'|'excitement'|'laughter'|'agreement'|'encouragement'|'apology'|'compliment'|'playful_teasing'|'casual_checkin'|'conversation_opener'|'mixed_social'} SocialIntent
 */

/**
 * @typedef {'social'|'informational'|'mixed'} SocialMode
 */

/**
 * @typedef {object} SocialConversationPlan
 * @property {boolean} active
 * @property {boolean} isSocial
 * @property {SocialMode} mode
 * @property {SocialIntent | null} socialIntent
 * @property {SocialIntent[]} intents
 * @property {boolean} forceNoQuestion
 * @property {boolean} avoidTopicChange
 * @property {boolean} connectionFirst
 * @property {'it'|'en'|'auto'} replyLanguage
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} reasons
 * @property {string[]} signals
 */

const DISTRESS =
  /\b(panic|ansioso|ansia|depress|suicid|non\s+ce\s+la\s+faccio|aiuto\s+urgente|emergency|grief|lutto)\b/i

const INFO_ASK =
  /\b(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to|does|did)\b|perch[eé]\b|why\b|fix|debug|bug|errore|error|spiegami|explain|crea|build|scriv[ia]|write|calcola|piano|plan|codice|code|implement|deploy|cos'?è|what\s+is|quanto|differenza|vs\b|meglio|tutorial|documentaz|api\b|install|configur)\b/i

const GREETING_ONLY =
  /^(ciao|hey|hi|hello|hola|yo|ehi|salve|buongiorno|buonasera|buon\s+pomeriggio|good\s+(morning|afternoon|evening)|morning|evening)([\s!,.🥰😊🙏❤️✨]*)$/i

const GREETING =
  /\b(ciao|hey|hi+|hello|hola|yo|ehi|salve|buongiorno|buonasera|buon\s+pomeriggio)\b/i

const GOOD_MORNING =
  /\b(good\s+morning|buongiorno|morning[!]?)\b/i

const GOOD_NIGHT =
  /\b(good\s+night|buonanotte|night[!]?|sleep\s+well|sogni\s+d['’]?oro)\b/i

const FAREWELL =
  /\b(bye|goodbye|good\s+bye|see\s+you|see\s+ya|later|ciao\s+ciao|arrivederci|a\s+presto|a\s+dopo|ci\s+vediamo|gotta\s+go|me\s+ne\s+vado|sto\s+andando|talk\s+soon)\b/i

const HOW_ARE_YOU =
  /\b(how\s+are\s+you|how(?:'s|\s+is)\s+it\s+going|how\s+have\s+you\s+been|come\s+stai|come\s+va|tutto\s+bene\??|come\s+te\s+la\s+passi)\b/i

const WHATS_UP =
  /\b(what'?s\s+up|wassup|sup\b|che\s+si\s+dice|che\s+fai|novit[aà]|what'?s\s+new|how'?s\s+everything)\b/i

const THANKS =
  /^(thanks|thank\s+you|thx|ty|grazie|grazie\s+mille|ti\s+ringrazio|thank\s+u)([\s!,.🥰😊🙏❤️💯✨]*)$/i

const THANKS_SOFT =
  /\b(thanks|thank\s+you|thx|grazie|ti\s+ringrazio)\b/i

const CONGRATS =
  /\b(congratulat|congrats|well\s+done|complimenti|bravo|brava|ottimo\s+lavoro|ce\s+l'?hai\s+fatta|you\s+did\s+it|proud\s+of\s+you)\b/i

const EXCITEMENT =
  /\b(yay|evviva|woo+t?|yes[!]+|fantastico|incredibile|amazing|awesome|so\s+excited|troppo\s+forte|bellissima\s+notizia|can'?t\s+wait)\b/i

const LAUGHTER =
  /^(haha+|ahah+|lol+|lmao|😂+|😄+|😆+|🤣+|hehe+|asd+)([\s!,.]*)$/i

const LAUGHTER_SOFT =
  /\b(haha+|ahah+|lol+|lmao|😂|😄|🤣|scherz[oa]|funny|divertente)\b/i

const AGREEMENT =
  /^(ok|okay|k|yes|yep|yeah|sure|exactly|true|right|absolutely|definitely|agree|s[iì]|certo|esatto|vero|assolutamente|perfetto|d['’]?accordo|vai|go\s+on|continua)([\s!,.🥰😊🙏💯🔥]*)$/i

const ENCOURAGEMENT =
  /\b(you\s+got\s+this|keep\s+(?:going|it\s+up)|don'?t\s+give\s+up|forza|dai\s+che\s+ce\s+la\s+fai|in\s+bocca\s+al\s+lupo|coraggio|you\s+can\s+do\s+it)\b/i

const APOLOGY =
  /\b(sorry|i'?m\s+sorry|my\s+bad|apolog|scusa|scusi|mi\s+dispiace|perdonami|scusami)\b/i

const COMPLIMENT =
  /\b(you(?:'re|\s+are)\s+(?:great|awesome|amazing|the\s+best|wonderful|brilliant|smart|kind)|sei\s+(?:fantastico|fantastica|grande|speciale|brav[oa]|genial[ei])|ti\s+adoro|love\s+(?:talking|chatting)\s+(?:to|with)\s+you|mi\s+piace\s+(?:parlare|chiacchierare)\s+con\s+te|nice\s+(?:chat|talk)|bella\s+chiacchierata)\b/i

const PLAYFUL =
  /\b(teasing|burl[oa]|prendi\s+in\s+giro|smartass|smart\s+aleck|cheeky|trovata|gotcha|ti\s+è\s+scappata)\b/i

const CASUAL_CHECKIN =
  /\b(just\s+checking\s+in|checking\s+in|solo\s+passavo|passavo\s+a\s+salutare|just\s+saying\s+hi|niente\s+di\s+particolare|just\s+wanted\s+to\s+say\s+hi|tutto\s+ok\??|still\s+there|ci\s+sei)\b/i

const OPENER =
  /\b(let'?s\s+(?:chat|talk)|parliamo|chiacchieriamo|vorrei\s+parlare|got\s+a\s+minute|hai\s+un\s+minuto|nice\s+to\s+(?:meet|see)\s+you|piacere)\b/i

const HELPDESK_FORBID =
  'Vietato: "How can I help you today?", "What would you like to discuss?", "Is there anything else I can help you with?", "Feel free to ask me anything", "Come posso aiutarti?", "Dimmi pure.", "Sono qui se ti serve.", "Anything else?".'

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {ChatTurn[]|undefined|null} messages
 * @returns {ChatTurn[]}
 */
function normalizeTurns(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: normalize(m.content) }))
    .filter((m) => m.content.length > 0)
}

/**
 * @returns {SocialConversationPlan}
 */
function inactivePlan(reasons = ['inactive'], signals = []) {
  return {
    active: false,
    isSocial: false,
    mode: 'informational',
    socialIntent: null,
    intents: [],
    forceNoQuestion: false,
    avoidTopicChange: false,
    connectionFirst: false,
    replyLanguage: 'auto',
    confidence: 'low',
    writerBrief: '',
    structureLine: null,
    responseHints: [],
    reasons,
    signals,
  }
}

/**
 * @param {string} msg
 * @returns {{ intents: SocialIntent[], signals: string[], score: number }}
 */
function detectSocialIntents(msg) {
  /** @type {SocialIntent[]} */
  const intents = []
  /** @type {string[]} */
  const signals = []
  let score = 0

  if (GREETING_ONLY.test(msg) || (GREETING.test(msg) && msg.split(/\s+/).length <= 4 && !INFO_ASK.test(msg))) {
    intents.push('greeting')
    signals.push('greeting')
    score += GREETING_ONLY.test(msg) ? 4.2 : 3.2
  } else if (GREETING.test(msg) && INFO_ASK.test(msg)) {
    // Greeting mixed into an ask — still count social cue for mixed mode.
    intents.push('greeting')
    signals.push('greeting_with_ask')
    score += 2.4
  }
  if (GOOD_MORNING.test(msg) && !INFO_ASK.test(msg)) {
    if (!intents.includes('greeting')) intents.push('greeting')
    intents.push('good_morning')
    signals.push('good_morning')
    score += 3.6
  }
  if (GOOD_NIGHT.test(msg)) {
    intents.push('good_night')
    if (!intents.includes('farewell')) intents.push('farewell')
    signals.push('good_night')
    score += 4.0
  }
  if (FAREWELL.test(msg) && !GOOD_NIGHT.test(msg)) {
    intents.push('farewell')
    signals.push('farewell')
    score += 3.8
  }
  if (HOW_ARE_YOU.test(msg)) {
    intents.push('how_are_you')
    signals.push('how_are_you')
    score += 4.1
  }
  if (WHATS_UP.test(msg)) {
    intents.push('whats_up')
    signals.push('whats_up')
    score += 3.9
  }
  if (THANKS.test(msg) || (THANKS_SOFT.test(msg) && msg.split(/\s+/).length <= 8 && !INFO_ASK.test(msg))) {
    intents.push('thanks')
    signals.push('thanks')
    score += THANKS.test(msg) ? 4.3 : 3.4
  }
  if (CONGRATS.test(msg)) {
    intents.push('congratulations')
    signals.push('congratulations')
    score += 3.5
  }
  if (EXCITEMENT.test(msg) && msg.split(/\s+/).length <= 12) {
    intents.push('excitement')
    signals.push('excitement')
    score += 3.2
  }
  if (LAUGHTER.test(msg) || (LAUGHTER_SOFT.test(msg) && msg.split(/\s+/).length <= 6)) {
    intents.push('laughter')
    signals.push('laughter')
    score += LAUGHTER.test(msg) ? 4.0 : 2.8
  }
  if (AGREEMENT.test(msg)) {
    intents.push('agreement')
    signals.push('agreement')
    score += 3.6
  }
  if (ENCOURAGEMENT.test(msg)) {
    intents.push('encouragement')
    signals.push('encouragement')
    score += 3.3
  }
  if (APOLOGY.test(msg) && msg.split(/\s+/).length <= 14) {
    intents.push('apology')
    signals.push('apology')
    score += 3.5
  }
  if (COMPLIMENT.test(msg)) {
    intents.push('compliment')
    signals.push('compliment')
    score += 3.7
  }
  if (PLAYFUL.test(msg) && !INFO_ASK.test(msg)) {
    intents.push('playful_teasing')
    signals.push('playful_teasing')
    score += 3.0
  }
  if (CASUAL_CHECKIN.test(msg)) {
    intents.push('casual_checkin')
    signals.push('casual_checkin')
    score += 3.8
  }
  if (OPENER.test(msg) && !INFO_ASK.test(msg)) {
    intents.push('conversation_opener')
    signals.push('conversation_opener')
    score += 3.5
  }

  return { intents: [...new Set(intents)], signals, score }
}

/**
 * @param {SocialIntent[]} intents
 * @returns {SocialIntent | null}
 */
function primaryIntent(intents) {
  const priority = [
    'good_night',
    'farewell',
    'thanks',
    'how_are_you',
    'whats_up',
    'good_morning',
    'greeting',
    'apology',
    'compliment',
    'congratulations',
    'encouragement',
    'excitement',
    'laughter',
    'agreement',
    'playful_teasing',
    'casual_checkin',
    'conversation_opener',
    'mixed_social',
  ]
  for (const p of priority) {
    if (intents.includes(/** @type {SocialIntent} */ (p))) return /** @type {SocialIntent} */ (p)
  }
  return intents[0] || null
}

/**
 * @param {SocialIntent | null} intent
 * @param {'it'|'en'|'auto'} lang
 */
function exampleTone(intent, lang) {
  const en = lang !== 'it'
  switch (intent) {
    case 'greeting':
      return en
        ? 'Tone like: "Hey! 😊 Nice to see you." — not "How can I help you today?"'
        : 'Tono tipo: "Ciao! 😊 Che bello sentirti." — non "Come posso aiutarti?"'
    case 'how_are_you':
      return en
        ? 'Tone like: "I\'m doing well, thanks! 😊 It\'s always nice to chat with you." — not "What would you like to discuss today?"'
        : 'Tono tipo: "Sto bene, grazie! 😊 È sempre bello chiacchierare." — non "Di cosa vuoi parlare?"'
    case 'whats_up':
      return en
        ? 'Reply casually; share a light beat or warm presence — no task menu.'
        : 'Rispondi alla leggera; presenza calda — niente menu di compiti.'
    case 'thanks':
      return en
        ? 'Tone like: "You\'re very welcome! 😄" — not "Is there anything else I can help you with?"'
        : 'Tono tipo: "Di niente! 😄" — non "C\'è altro in cui posso aiutarti?"'
    case 'good_night':
      return en
        ? 'Tone like: "Sleep well 🌙 I hope tomorrow brings you something good." — not "Feel free to ask me anything tomorrow."'
        : 'Tono tipo: "Buonanotte 🌙 Dormi bene." — non "Domani chiedimi pure qualsiasi cosa."'
    case 'good_morning':
      return en
        ? 'Warm morning greeting; relaxed; no agenda push.'
        : 'Buongiorno caldo e rilassato; niente agenda.'
    case 'farewell':
      return en
        ? 'Warm goodbye; short; no "come back with questions."'
        : 'Saluto di chiusura caldo e breve; niente "torna con domande."'
    case 'laughter':
      return en
        ? 'Share the laugh lightly; one warm beat is enough.'
        : 'Condividi la risata con leggerezza; un battito caldo basta.'
    case 'agreement':
      return en
        ? 'Acknowledge naturally; continue or rest — no interview.'
        : 'Riconosci naturalmente; continua o resta — niente intervista.'
    case 'compliment':
      return en
        ? 'Receive warmly and briefly; no self-promotion speech.'
        : 'Accogli con calore e brevità; niente auto-promozione.'
    case 'apology':
      return en
        ? 'Reassure gently; no lecture; keep it human.'
        : 'Rassicurazione gentile; niente predica; resta umano.'
    default:
      return en
        ? 'Connection first: natural, relaxed, authentic.'
        : 'Connessione prima: naturale, rilassato, autentico.'
  }
}

/**
 * @param {SocialConversationPlan} draft
 */
function buildWriterBrief(draft) {
  const langLabel =
    draft.replyLanguage === 'it'
      ? 'italiano'
      : draft.replyLanguage === 'en'
        ? 'English'
        : 'the user’s language'

  if (draft.mode === 'mixed') {
    return [
      'SOCIAL CONVERSATION ENGINE (prima di Conversation Intent): messaggio MISTO — contatto umano + richiesta.',
      `Intenti sociali: ${(draft.intents || []).join(', ') || 'social'}.`,
      'Apri con un cenno caldo e naturale, poi passa alla sostanza senza tono da sportello.',
      'Check interno: c’è anche contatto umano — non solo task.',
      `Rispondi in ${langLabel}.`,
      HELPDESK_FORBID,
      'NON citare Social Conversation Engine / lo stage.',
    ].join(' ')
  }

  return [
    'SOCIAL CONVERSATION ENGINE (prima di Conversation Intent): messaggio SOCIAL — contatto umano, non richiesta di informazione.',
    `SocialIntent=${draft.socialIntent || 'social'} · Mode=social · Confidence=${draft.confidence}.`,
    'Check interno: «Is the user seeking information, or simply making human contact?» → Human contact.',
    'Priorità: calore, ritmo, autenticità — non densità di informazione.',
    'Rispondi naturalmente. Connessione > informazione. Rilassato. Niente overexplain. Niente wording da assistente generico.',
    'Non cambiare subito argomento. Non forzare un’altra domanda. Non chiudere sempre con “What about you?” / “E tu?”.',
    'A volte basta una frase calda.',
    exampleTone(draft.socialIntent, draft.replyLanguage),
    `Rispondi INTERAMENTE in ${langLabel} (stessa lingua del messaggio sociale).`,
    HELPDESK_FORBID,
    'NON citare Social Conversation Engine / lo stage.',
  ].join(' ')
}

/**
 * @param {SocialConversationPlan} draft
 */
function structureLineFor(draft) {
  if (draft.mode === 'mixed') {
    return 'Social Conversation Engine → cenno umano, poi sostanza (niente helpdesk)'
  }
  const intent = draft.socialIntent || 'social'
  return `Social Conversation Engine → SOCIAL (${intent}): connessione > informazione; niente sportello`
}

/**
 * @param {SocialConversationPlan} draft
 */
function responseHintsFor(draft) {
  if (draft.mode === 'mixed') {
    return [
      'Un battito caldo, poi aiuto concreto.',
      'Niente “How can I help you today?”',
    ]
  }
  return [
    'Contatto umano: rispondi come un interlocutore, non come un ticket.',
    'Connessione > informazione; niente overexplain.',
    draft.forceNoQuestion
      ? 'Niente domanda di default — a volte una frase calda basta.'
      : 'Domanda solo se nasce naturale (raro).',
    'Non forzare cambio di tema né “What about you?”.',
    draft.replyLanguage === 'en'
      ? 'Reply in English.'
      : draft.replyLanguage === 'it'
        ? 'Rispondi in italiano.'
        : 'Stessa lingua del messaggio.',
  ]
}

/**
 * Classify social vs informational.
 * @param {object} [input]
 * @returns {SocialConversationPlan}
 */
export function buildSocialConversationPlan(input = {}) {
  const msg = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const words = msg.split(/\s+/).filter(Boolean).length
  const replyLanguage = detectDominantLanguage(msg)

  if (!msg) return inactivePlan(['empty'])
  if (DISTRESS.test(msg)) return inactivePlan(['distress'], ['distress'])

  const detected = detectSocialIntents(msg)
  const hasInfo = INFO_ASK.test(msg)
  const longSubstance = words >= 22 && hasInfo
  const shortSocial = detected.intents.length > 0 && words <= 18

  // Pure information ask with no social cues → inactive.
  if (hasInfo && detected.intents.length === 0) {
    return inactivePlan(['informational'], ['info_ask'])
  }
  if (longSubstance && detected.score < 3) {
    return inactivePlan(['informational_long'], ['info_ask', 'long'])
  }

  // Greeting/social mixed with a real ask → mixed (soft).
  if (hasInfo && detected.intents.length > 0) {
    /** @type {SocialConversationPlan} */
    const mixed = {
      active: true,
      isSocial: false,
      mode: 'mixed',
      socialIntent: 'mixed_social',
      intents: [...detected.intents, 'mixed_social'],
      forceNoQuestion: false,
      avoidTopicChange: false,
      connectionFirst: true,
      replyLanguage,
      confidence: 'medium',
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      reasons: ['mixed_social_plus_ask', ...detected.signals.slice(0, 3)],
      signals: [...detected.signals, 'mixed'],
    }
    mixed.writerBrief = buildWriterBrief(mixed)
    mixed.structureLine = structureLineFor(mixed)
    mixed.responseHints = responseHintsFor(mixed)
    return mixed
  }

  if (!shortSocial && detected.score < 2.5) {
    return inactivePlan(['not_social'], detected.signals)
  }

  const intent = primaryIntent(detected.intents)
  const closingLike =
    intent === 'farewell' ||
    intent === 'good_night' ||
    intent === 'thanks' ||
    intent === 'laughter' ||
    intent === 'agreement'

  /** @type {SocialConversationPlan} */
  const plan = {
    active: true,
    isSocial: true,
    mode: 'social',
    socialIntent: intent,
    intents: detected.intents,
    forceNoQuestion: closingLike || intent === 'greeting' || intent === 'good_morning',
    avoidTopicChange: true,
    connectionFirst: true,
    replyLanguage,
    confidence: detected.score >= 3.8 ? 'high' : detected.score >= 3 ? 'medium' : 'low',
    writerBrief: '',
    structureLine: null,
    responseHints: [],
    reasons: [
      `mode_social`,
      `intent_${intent || 'social'}`,
      `conf_${detected.score >= 3.8 ? 'high' : 'medium'}`,
      ...detected.signals.slice(0, 4),
    ],
    signals: detected.signals,
  }

  // Tiny acknowledgment after prior turns stays social.
  if (turns.length >= 2 && AGREEMENT.test(msg)) {
    plan.signals.push('ack_continue')
  }

  plan.writerBrief = buildWriterBrief(plan)
  plan.structureLine = structureLineFor(plan)
  plan.responseHints = responseHintsFor(plan)
  return plan
}

/**
 * @param {SocialConversationPlan | null | undefined} plan
 */
export function formatSocialConversationForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')

  return `══════════════════════════════════════
SOCIAL CONVERSATION ENGINE (PRE-INTENT, INVISIBILE)
══════════════════════════════════════
Mode=${plan.mode} · IsSocial=${plan.isSocial ? 'yes' : 'no'} · Intent=${plan.socialIntent || '—'}
Intents=${(plan.intents || []).join(', ') || '—'}
Language=${plan.replyLanguage} · Confidence=${plan.confidence}
ConnectionFirst=${plan.connectionFirst ? 'yes' : 'no'} · AvoidTopicChange=${plan.avoidTopicChange ? 'yes' : 'no'} · ForceNoQ=${plan.forceNoQuestion ? 'yes' : 'no'}

${plan.writerBrief}

Hints:
${hints}

Regole: se SOCIAL → connessione > informazione · naturale · rilassato · niente helpdesk · stessa lingua · non citare lo stage.`.trim()
}

/**
 * @param {SocialConversationPlan | null | undefined} plan
 * @returns {string[]}
 */
export function socialConversationStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const lines = [
    plan.structureLine || 'Social Conversation Engine → connessione umana prima dell’informazione',
  ]
  if (plan.isSocial) {
    lines.push('Messaggio SOCIAL: non trattarlo come richiesta di informazione')
    lines.push('Calore e autenticità; niente “How can I help you today?”')
    if (plan.forceNoQuestion) {
      lines.push('Niente domanda obbligata — a volte basta una frase calda')
    }
    if (plan.avoidTopicChange) {
      lines.push('Non cambiare argomento di botto; non forzare “What about you?”')
    }
  } else if (plan.mode === 'mixed') {
    lines.push('Misto: cenno umano breve, poi sostanza senza sportello')
  }
  if (plan.replyLanguage === 'en') {
    lines.push('Social reply language: English')
  } else if (plan.replyLanguage === 'it') {
    lines.push('Social reply language: italiano')
  }
  return lines
}

/**
 * @param {object} [input]
 * @returns {{ plan: SocialConversationPlan, context: string }}
 */
export function runSocialConversationEngine(input = {}) {
  try {
    const plan = buildSocialConversationPlan(input)
    return {
      plan,
      context: formatSocialConversationForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft'], ['fail_soft']),
      context: '',
    }
  }
}
