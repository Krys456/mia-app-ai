/**
 * LAIfe Conversation Ownership Protocol
 *
 * Global protocol: the assistant is responsible for making conversations interesting.
 * Never expect the user to provide the topic, the energy, or the momentum.
 *
 * If the user gives a short, vague, or passive message, take the lead naturally.
 *
 * Rules:
 *   - Never respond to "No", "Eh no", "Boh", "Ok", "Mh", "Non lo so" with generic acknowledgements.
 *   - Do not ask another generic question.
 *   - Instead contribute: idea · surprising fact · thoughtful observation · short story ·
 *     comparison · metaphor · reflection · practical insight.
 *
 * Conversation should never depend entirely on user initiative.
 *
 * Internal check before every response:
 *   "Am I waiting for the user to make the conversation interesting?"
 *   If yes → rewrite.
 *
 * Goal: LAIfe feels like an active conversation partner, not a passive assistant.
 *
 * Runs AFTER HCS / Constitution cues and BEFORE Worth Reading / Writer.
 * Soft pre-send gate (shared one-pass refine budget).
 * Invisible. Fail-soft. Never cite the protocol to the user.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'idea'|'surprising_fact'|'thoughtful_observation'|'short_story'|'comparison'|'metaphor'|'reflection'|'practical_insight'} OwnershipContribution
 */

/**
 * @typedef {object} ConversationOwnershipPlan
 * @property {boolean} active
 * @property {boolean} takeLead  short/vague/passive user turn
 * @property {boolean} forbidGenericAck
 * @property {boolean} forbidGenericQuestion
 * @property {OwnershipContribution | 'any'} preferredContribution
 * @property {string} stance  lead | co_lead | follow
 * @property {string} ownershipCheck  internal question for Writer
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} contributeWith
 * @property {string[]} reasons
 * @property {string[]} signals
 * @property {'high'|'medium'|'low'} confidence
 */

/**
 * @typedef {object} OwnershipIssue
 * @property {string} id
 * @property {string} detail
 * @property {number} severity 0–1
 */

/**
 * @typedef {object} ConversationOwnershipGate
 * @property {OwnershipIssue[]} issues
 * @property {boolean} needsRefine
 * @property {string} refineBrief
 * @property {string[]} failed
 * @property {string[]} reasons
 */

const PASSIVE_SHORT =
  /^(no|eh\s+no|e+h+\s*no|ok|okay|boh|già|mh+|mhm+|uhm+|non\s+lo\s+so|i\s+don'?t\s+know|sure|yeah|yep|yup|nah|va\s+bene|fine|whatever|mah|bo+|idk)[.!?…]*$/i

const GREETING_OR_SOCIAL_CHECKIN =
  /^(ciao|hey|hi|hello|ehi|salve|buongiorno|buonasera|yo|come\s+stai|come\s+va|how\s+are\s+you|how'?s\s+it\s+going|tutto\s+bene\??)([\s?!,.🥰😊🙏]*)$/i

const VAGUE_OPEN =
  /^(e\s+adesso\??|and\s+now\??|boh[,.]?\s*$|non\s+so[,.]?\s*$|whatever|mah|idk|dunno|boh\s+non\s+so)[.!?…]*$/i

const GENERIC_ACK =
  /^(ok|okay|certo|capisco|capito|va\s+bene|got\s+it|i\s+see|i\s+understand|alright|sure|d['’]?accordo)[.!]?\s*/i

const GENERIC_QUESTION =
  /\b(what\s+would\s+you\s+like\s+to\s+(discuss|talk|know|do)|di\s+cosa\s+vuoi\s+(parlare|sapere)|come\s+posso\s+(aiutarti|aiutare)|how\s+can\s+i\s+help|what\s+do\s+you\s+(want|think)\??|cosa\s+ne\s+pensi\??|vuoi\s+(parlarne|che\s+ti\s+aiuti)|would\s+you\s+like\s+to\s+talk|anything\s+(else|on\s+your\s+mind)\??)\b/i

const HELP_DESK =
  /\b(i'?m\s+here\s+if\s+you|sono\s+qui\s+se|let\s+me\s+know|fammi\s+sapere|feel\s+free|non\s+esitare)\b/i

const CONTRIBUTE_WITH = [
  'un’idea interessante',
  'un fatto sorprendente',
  'un’osservazione ponderata',
  'una storia breve',
  'un confronto',
  'una metafora',
  'una riflessione',
  'un insight pratico',
]

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function sentences(text) {
  return normalize(text)
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * @param {ChatTurn[]|undefined|null} messages
 * @returns {string}
 */
function priorTopicHint(messages) {
  if (!Array.isArray(messages)) return ''
  const users = messages
    .filter((m) => m?.role === 'user' && typeof m.content === 'string')
    .map((m) => normalize(m.content))
    .filter((c) => c.length > 12 && !PASSIVE_SHORT.test(c))
  const last = users[users.length - 1] || ''
  return last.slice(0, 120)
}

/**
 * Pick a soft contribution preference from context (heuristic, not random invent).
 * @param {string} userMessage
 * @param {string} topicHint
 * @returns {OwnershipContribution | 'any'}
 */
function preferContribution(userMessage, topicHint) {
  const blob = `${userMessage} ${topicHint}`.toLowerCase()
  if (/\b(perch[eé]|why|how|come\s+funziona|spieg)\b/.test(blob)) return 'practical_insight'
  if (/\b(storia|story|persone|vita|people)\b/.test(blob)) return 'short_story'
  if (/\b(come|like|simile|versus|vs)\b/.test(blob)) return 'comparison'
  if (/\b(sent|feel|emoz|paura|ansios)\b/.test(blob)) return 'reflection'
  if (topicHint.length > 20) return 'thoughtful_observation'
  return 'any'
}

/**
 * @param {object} [input]
 * @returns {ConversationOwnershipPlan}
 */
export function buildConversationOwnershipPlan(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  if (!userMessage) {
    return {
      active: false,
      takeLead: false,
      forbidGenericAck: true,
      forbidGenericQuestion: true,
      preferredContribution: 'any',
      stance: 'follow',
      ownershipCheck: '',
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      contributeWith: CONTRIBUTE_WITH,
      reasons: ['empty'],
      signals: ['empty'],
      confidence: 'low',
    }
  }

  const topicHint = priorTopicHint(input.messages)
  // Pure greetings / how-are-you are social presence — NOT "passive short → take lead".
  // Planner wait/presence turns also suppress takeLead.
  const planner = input.conversationPlanner?.plan || input.conversationPlanner || null
  const plannerRestrains =
    planner &&
    (planner.initiative === false ||
      planner.topicAction === 'wait' ||
      planner.responseMode === 'presence')
  const socialPresence = GREETING_OR_SOCIAL_CHECKIN.test(userMessage)
  const takeLead =
    !socialPresence &&
    !plannerRestrains &&
    (PASSIVE_SHORT.test(userMessage) ||
      VAGUE_OPEN.test(userMessage) ||
      userMessage.length <= 6 ||
      (userMessage.length <= 18 &&
        !/[?]/.test(userMessage) &&
        !/\b(aiut|help|spieg|explain|perch|why|come)\b/i.test(userMessage)))

  /** @type {'lead'|'co_lead'|'follow'} */
  let stance = 'co_lead'
  if (takeLead) stance = 'lead'
  else if (userMessage.length < 80) stance = 'co_lead'
  else stance = 'follow'

  const preferred = preferContribution(userMessage, topicHint)
  const forbidGenericAck = true
  const forbidGenericQuestion = takeLead || stance !== 'follow'

  const ownershipCheck =
    'Am I waiting for the user to make the conversation interesting? If yes → rewrite and contribute.'

  const writerBrief = [
    'CONVERSATION OWNERSHIP PROTOCOL (globale — partner attivo, non assistente passivo):',
    'Tu sei responsabile di rendere la conversazione interessante.',
    'Non aspettarti che l’utente porti il tema, l’energia o il momentum.',
    'Se il messaggio è corto, vago o passivo — prendi naturalmente la guida.',
    'Vietato su “No / Eh no / Boh / Ok / Mh / Non lo so”: acknowledgement generici.',
    'Vietato: un’altra domanda generica per “tenere vivo” il dialogo.',
    'Invece contribuisci con almeno uno: idea · fatto sorprendente · osservazione · storia breve · confronto · metafora · riflessione · insight pratico.',
    `Check interno: «${ownershipCheck}»`,
    takeLead
      ? `Stance=LEAD: turno passivo/corto — porta sostanza tu${topicHint ? ` (filo recente: «${topicHint.slice(0, 72)}»)` : ''}.`
      : `Stance=${stance.toUpperCase()}: resta propositivo; non dipendere dall’iniziativa dell’utente.`,
    preferred !== 'any' ? `Preferisci contributo tipo: ${preferred}.` : 'Scegli il contributo più naturale al filo.',
    'Non citare il protocollo. Non inventare fatti.',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    active: true,
    takeLead,
    forbidGenericAck,
    forbidGenericQuestion,
    preferredContribution: preferred,
    stance,
    ownershipCheck,
    writerBrief,
    structureLine: `Conversation Ownership → stance=${stance}${takeLead ? ' · LEAD' : ''}${forbidGenericQuestion ? ' · no generic Q' : ''}`,
    responseHints: [
      takeLead
        ? 'Turno corto/passivo: prendi il lead — idea, osservazione, storia, metafora o insight.'
        : 'Non aspettare che l’utente renda interessante il dialogo — contribuisci.',
      'Niente “Ok.” / “Capisco.” / “Come posso aiutarti?” / “Cosa ne pensi?” come risposta principale.',
      `Contribuisci con: ${CONTRIBUTE_WITH.slice(0, 4).join(' · ')}…`,
      'Check: sto aspettando che l’utente renda interessante la chat? Se sì → riscrivi.',
    ],
    contributeWith: CONTRIBUTE_WITH,
    reasons: [
      'ownership_protocol',
      `stance_${stance}`,
      takeLead ? 'take_lead' : 'co_active',
      preferred !== 'any' ? `prefer_${preferred}` : 'prefer_any',
    ],
    signals: ['conversation_ownership', stance, takeLead ? 'lead' : 'active'],
    confidence: takeLead ? 'high' : 'medium',
  }
}

/**
 * @param {ConversationOwnershipPlan | null | undefined} plan
 * @returns {string[]}
 */
export function conversationOwnershipStructureHints(plan) {
  if (!plan?.active) return []
  return [
    'Conversation Ownership → partner attivo (non assistente passivo)',
    'Turni corti/passivi → LEAD con contributo reale, niente ack/Q generiche',
    'Check: sto aspettando che l’utente renda interessante la chat? Se sì → riscrivi',
  ]
}

/**
 * @param {ConversationOwnershipPlan | null | undefined} plan
 */
export function formatConversationOwnershipForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const contrib = (plan.contributeWith || CONTRIBUTE_WITH).map((c) => `- ${c}`).join('\n')
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')
  return `══════════════════════════════════════
CONVERSATION OWNERSHIP PROTOCOL
══════════════════════════════════════
${plan.writerBrief}

Contribuisci con (scegline almeno uno):
${contrib}

Hints:
${hints}

Stance: ${plan.stance}${plan.takeLead ? ' · LEAD' : ''}
Non citare il protocollo. Scrivi solo la risposta.`.trim()
}

/**
 * @param {object} [input]
 * @returns {ConversationOwnershipGate}
 */
export function analyzeConversationOwnershipDraft(input = {}) {
  const draft = normalize(input.draft || '')
  const userMessage = normalize(input.userMessage || '')
  /** @type {OwnershipIssue[]} */
  const issues = []
  /** @type {string[]} */
  const reasons = []

  if (!draft || draft.length < 8) {
    return {
      issues: [],
      needsRefine: false,
      refineBrief: '',
      failed: [],
      reasons: ['empty_draft'],
    }
  }

  const takeLead =
    Boolean(input.plan?.takeLead) ||
    (!GREETING_OR_SOCIAL_CHECKIN.test(userMessage) &&
      (PASSIVE_SHORT.test(userMessage) ||
        VAGUE_OPEN.test(userMessage) ||
        userMessage.length <= 6))

  // Presence / wait plans: short natural drafts are valid — do not thin_lead them.
  const planner = input.conversationPlanner || input.planner || null
  const presenceOk =
    planner?.topicAction === 'wait' ||
    planner?.responseMode === 'presence' ||
    planner?.initiative === false ||
    GREETING_OR_SOCIAL_CHECKIN.test(userMessage)
  const sents = sentences(draft)
  const qCount = (draft.match(/\?/g) || []).length
  const endsWithQ = /\?\s*$/.test(draft)
  const onlyAck =
    GENERIC_ACK.test(draft) && draft.length < 80 && qCount === 0
  const ackThenQuestion =
    GENERIC_ACK.test(draft) && qCount >= 1 && draft.length < 160

  // Waiting on user? (generic ack / helpdesk / only a question)
  const waitingOnUser =
    !presenceOk &&
    (onlyAck ||
      ackThenQuestion ||
      HELP_DESK.test(draft) ||
      (takeLead && endsWithQ && sents.length <= 2 && draft.length < 140) ||
      (takeLead && GENERIC_QUESTION.test(draft)))

  if (!presenceOk && takeLead && (onlyAck || ackThenQuestion || HELP_DESK.test(draft))) {
    issues.push({
      id: 'passive_ack',
      detail:
        'Acknowledgement generico su turno passivo — prendi il lead con un contributo reale (idea/osservazione/storia/metafora/insight).',
      severity: 0.95,
    })
    reasons.push('passive_ack')
  }

  if (
    !presenceOk &&
    takeLead &&
    (GENERIC_QUESTION.test(draft) ||
      (endsWithQ && sents.length <= 2 && !/[.!]/.test(draft.replace(/\?+$/, ''))))
  ) {
    issues.push({
      id: 'generic_question',
      detail: 'Domanda generica per tenere vivo il dialogo — sostituisci con un contributo (non interrogare).',
      severity: 0.9,
    })
    reasons.push('generic_q')
  }

  if (waitingOnUser) {
    issues.push({
      id: 'waiting_on_user',
      detail:
        'Sembra che aspetti che l’utente renda interessante la chat — riscrivi e contribuisci tu.',
      severity: 0.9,
    })
    reasons.push('waiting_on_user')
  }

  if (
    !presenceOk &&
    takeLead &&
    draft.length < 70 &&
    qCount === 0 &&
    !/[—–…]/.test(draft)
  ) {
    issues.push({
      id: 'thin_lead',
      detail: 'Lead troppo magro — aggiungi idea, fatto, osservazione, storia, confronto o metafora.',
      severity: 0.75,
    })
    reasons.push('thin_lead')
  }

  const needsRefine = issues.length >= 1
  const refineBrief = needsRefine ? buildRefineBrief(issues, { takeLead }) : ''

  return {
    issues,
    needsRefine,
    refineBrief,
    failed: issues.map((i) => i.id),
    reasons: reasons.length ? reasons : ['ownership_clean'],
  }
}

/**
 * @param {OwnershipIssue[]} issues
 * @param {{ takeLead?: boolean }} [opts]
 */
function buildRefineBrief(issues, opts = {}) {
  const lines = issues.slice(0, 5).map((i) => `- ${i.id}: ${i.detail}`)
  return [
    'CONVERSATION OWNERSHIP (UNA sola rifinitura, invisibile): sii partner attivo — non assistente passivo.',
    'Problemi:',
    ...lines,
    opts.takeLead
      ? 'LEAD: l’utente ha scritto poco/passivo — porta tu un contributo (idea, fatto, osservazione, storia, confronto, metafora, riflessione, insight).'
      : 'Non aspettare l’iniziativa dell’utente — contribuisci.',
    'Vietato: acknowledgement generici, “I’m here if…”, domande generiche (“Cosa ne pensi?”, “Di cosa vuoi parlare?”).',
    'Check: «Sto aspettando che l’utente renda interessante la conversazione?» Se sì → riscrivi.',
    'Restituisci solo il testo finale. Non menzionare il protocollo. Non inventare fatti.',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationOwnershipPlan, context: string }}
 */
export function runConversationOwnershipProtocol(input = {}) {
  try {
    const plan = buildConversationOwnershipPlan(input)
    return {
      plan,
      context: formatConversationOwnershipForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        takeLead: false,
        forbidGenericAck: true,
        forbidGenericQuestion: true,
        preferredContribution: 'any',
        stance: 'follow',
        ownershipCheck: '',
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        contributeWith: CONTRIBUTE_WITH,
        reasons: ['fail_soft'],
        signals: ['fail_soft'],
        confidence: 'low',
      },
      context: '',
    }
  }
}

/**
 * Pre-send gate: refine once if ownership fails (waiting on user / passive ack).
 * @param {object} [input]
 * @returns {{ gate: ConversationOwnershipGate, shouldRefine: boolean }}
 */
export function runConversationOwnershipGate(input = {}) {
  try {
    const gate = analyzeConversationOwnershipDraft(input)
    return {
      gate,
      shouldRefine: Boolean(gate.needsRefine && gate.refineBrief),
    }
  } catch {
    return {
      gate: {
        issues: [],
        needsRefine: false,
        refineBrief: '',
        failed: [],
        reasons: ['fail_soft'],
      },
      shouldRefine: false,
    }
  }
}
