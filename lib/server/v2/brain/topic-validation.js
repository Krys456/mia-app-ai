/**
 * LAIfe V2 — Topic / proposal validation (targeted contamination fix)
 *
 * Conservative guards so Writer noise cannot become authoritative Conversation State.
 * Not a NER engine. Not Memory. Not a Planner.
 *
 * Invariants:
 *   - No activeTopic is better than an invented activeTopic
 *   - No pendingProposal is better than an invented pendingProposal
 *   - Topic lock never outranks topic validity
 *   - Small talk does not require a topic
 */

export const TOPIC_VALIDATION_VERSION = '1.0.0-topic-validation'

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

/** Vague relational / filler phrases that must never become activeTopic. */
const VAGUE_TOPIC_RE =
  /\b(ottima\s+occasione|pensare\s+insieme|possiamo\s+parlar|vediamo\s+insieme|questa\s+cosa|quello|quella|questo|questa|qualcosa\s+di\s+interessante|come\s+possiamo\s+(aiutarti|protegger)|how\s+we\s+can\s+(help|protect)|interesting\s+thing|together\s+we\s+can)\b/i

/** Central unresolved pronouns / clitics that block proposal/topic inference. */
const UNRESOLVED_REF_RE =
  /\b(proteggerla|proteggerlo|aiutarla|aiutarlo|salvarla|salvarlo|quello|quella|questo|questa|those|these|them)\b|(?:^|[^\w])(la|lo|li|le|it|this|that)(?:$|[^\w])/i

/** Soft social / greeting / how-are-you turns. */
const SOCIAL_SMALL_TALK_RE =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve|ehi|yo)[.!…\s😊😄🙂]*$|^(come\s+stai|come\s+va|tutto\s+bene|how\s+are\s+you|how'?s\s+it\s+going|what'?s\s+up)[.!?]?\s*$/i

/** Filler tokens that dominate phantom bag-of-words topics. */
const FILLER_TOPIC_TOKENS = new Set([
  'ottima',
  'occasione',
  'pensare',
  'insieme',
  'possiamo',
  'potremmo',
  'proteggerla',
  'proteggerlo',
  'aiutarti',
  'aiutarla',
  'vediamo',
  'parlarne',
  'parlare',
  'cosa',
  'qualcosa',
  'interessante',
  'come',
  'stai',
  'bene',
  'ciao',
  'hey',
  'hello',
  'great',
  'chance',
  'together',
  'think',
  'protect',
  'help',
  // Boredom / direction utterances must not become activeTopic.
  'annoio',
  'annoia',
  'annoiato',
  'annoiata',
  'bored',
  'boredom',
  'boring',
  'know',
  'talk',
  'about',
  'don',
  'dont',
  'what',
  'idea',
  'suggerisci',
  'scegli',
])

/** Whole-utterance boredom / no-topic asks — never a concrete subject. */
const BOREDOM_UTTERANCE_TOPIC_RE =
  /\b(mi\s+annoio|non\s+so\s+di\s+cosa\s+parlare|non\s+so\s+di\s+che\s+parlare|di\s+cosa\s+parliamo|i\s+don'?t\s+know\s+what\s+to\s+talk\s+about|i'?m\s+bored|nothing\s+to\s+talk\s+about)\b/i

/**
 * @param {string} text
 * @returns {string[]}
 */
function topicTokens(text) {
  const raw = asString(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  return (raw.match(/[a-z0-9]{3,}/g) || []).filter((t) => !FILLER_TOPIC_TOKENS.has(t))
}

/**
 * True when the current user turn is pure social small-talk / greeting.
 * Intentionally narrow: "ok" / agreement must NOT clear living topics.
 * @param {{
 *   userMessage?: string,
 *   perception?: object|null,
 *   conversationSignals?: object|null,
 * }} [context]
 * @returns {boolean}
 */
export function isSocialSmallTalkTurn(context = {}) {
  const user = asString(context.userMessage).replace(/\s+/g, ' ').trim()
  const intent = asString(context.perception?.intent)
  const social = asString(context.perception?.socialIntent)

  if (SOCIAL_SMALL_TALK_RE.test(user)) return true
  if (social === 'greeting' || social === 'how_are_you') return true
  if (intent === 'greeting') return true
  // Perception often labels short acks as small_talk — do not treat those as topic-free social.
  if (
    intent === 'small_talk' &&
    /^(come\s+stai|come\s+va|tutto\s+bene|how\s+are\s+you|ciao|hey|hi|hello|buongiorno)/i.test(
      user,
    )
  ) {
    return true
  }
  return false
}

/**
 * Detect a central unresolved referential expression with no grounded antecedent.
 * Conservative: only flags when no clear noun antecedent exists in context.
 *
 * @param {string} text
 * @param {{
 *   activeTopic?: string|null,
 *   messages?: Array<{ role?: string, content?: string }>,
 *   groundedNouns?: string[],
 * }} [context]
 * @returns {boolean}
 */
export function hasUnresolvedCentralReferent(text, context = {}) {
  const t = asString(text).replace(/\s+/g, ' ').trim()
  if (!t) return false

  // Italian object clitics glued to infinitives: proteggerla, aiutarla, …
  const cliticHit = t.match(
    /\b((?:protegg|aiut|salv|cur|guard|osserv|segu)(?:ere?|are?|ire?)?(la|lo|li|le|ne))\b/i,
  ) || t.match(/\b(proteggerla|proteggerlo|aiutarla|aiutarlo|salvarla|salvarlo)\b/i)
  const barePronounHit =
    /\b(quello|quella|questo|questa|those|these)\b/i.test(t) ||
    /(?:^|[.!?]\s+)(it|this|that)\b/i.test(t)

  if (!cliticHit && !barePronounHit) return false

  const grounded = new Set(
    [
      asString(context.activeTopic),
      ...(Array.isArray(context.groundedNouns) ? context.groundedNouns : []),
    ]
      .flatMap((s) => topicTokens(s))
      .filter(Boolean),
  )

  if (Array.isArray(context.messages)) {
    for (const m of context.messages.slice(-6)) {
      for (const tok of topicTokens(asString(m?.content))) grounded.add(tok)
    }
  }

  // Same-response local antecedent: a concrete feminine/masculine noun earlier in text.
  const sameTextNouns = topicTokens(t)
  for (const n of sameTextNouns) grounded.add(n)

  // If we only have filler / verb stems and no concrete noun, unresolved.
  const concrete = [...grounded].filter((g) => g.length >= 4 && !FILLER_TOPIC_TOKENS.has(g))
  if (concrete.length === 0) return true

  // Clitic -la/-lo without any noun-like antecedent in recent context → unresolved.
  if (cliticHit) {
    const hasNounish =
      /\b(la|il|lo|le|i|gli|the|a|an)\s+[A-Za-zÀ-ÿ]{3,}/i.test(
        asString(
          (context.messages || [])
            .slice(-4)
            .map((m) => m?.content)
            .join(' '),
        ),
      ) || concrete.some((c) => c.length >= 5)
    // Bare greeting history ("Ciao") yields no noun → unresolved.
    if (!hasNounish && concrete.length < 1) return true
    // If concrete tokens exist only inside the suspect phrase itself (protegge…), still unresolved.
    const withoutVerb = concrete.filter(
      (c) => !/^(protegge|aiuta|salva|cura|guardi|guarda|osserva|segui)/i.test(c),
    )
    if (withoutVerb.length === 0) return true
  }

  if (barePronounHit && concrete.length === 0) return true
  return false
}

/**
 * Conservative activeTopic validator.
 * When uncertain → reject (prefer null).
 *
 * @param {unknown} candidate
 * @param {{
 *   userMessage?: string,
 *   perception?: object|null,
 *   conversationSignals?: object|null,
 *   messages?: Array<{ role?: string, content?: string }>,
 *   source?: 'user'|'assistant'|'state'|'proposal'|'reference'|string,
 *   allowAssistantDerived?: boolean,
 * }} [context]
 * @returns {boolean}
 */
export function isValidActiveTopic(candidate, context = {}) {
  const topic = asString(candidate).replace(/\s+/g, ' ').trim()
  if (!topic) return false
  if (topic.length < 2 || topic.length > 80) return false

  if (VAGUE_TOPIC_RE.test(topic)) return false
  if (/^(quello|quella|questo|questa|it|this|that|them|those|these)$/i.test(topic)) return false
  if (hasUnresolvedCentralReferent(topic, context)) return false

  // Boredom / "I don't know what to talk about" must never become activeTopic.
  const user = asString(context.userMessage)
  const intent = asString(context.perception?.intent)
  if (
    intent === 'boredom' ||
    BOREDOM_UTTERANCE_TOPIC_RE.test(user) ||
    BOREDOM_UTTERANCE_TOPIC_RE.test(topic)
  ) {
    // Only allow if the candidate is clearly not the boredom utterance itself.
    if (
      BOREDOM_UTTERANCE_TOPIC_RE.test(topic) ||
      topicTokens(topic).every((t) => FILLER_TOPIC_TOKENS.has(t)) ||
      /^(annoio|bored|boredom|parlare|talk)$/i.test(topic)
    ) {
      return false
    }
    // Candidate extracted from the boredom line's content words → reject.
    if (user && topicTokens(user).join(' ') === topicTokens(topic).join(' ')) {
      return false
    }
  }

  const tokens = topic
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9]{3,}/g) || []

  if (!tokens.length) return false

  const fillerCount = tokens.filter((t) => FILLER_TOPIC_TOKENS.has(t)).length
  if (fillerCount >= Math.ceil(tokens.length * 0.5)) return false
  if (tokens.length >= 5 && fillerCount >= 2) return false

  // Bag-of-words concatenations from assistant greetings.
  if (
    /\b(occasione|pensare|insieme|possiamo|protegger)/i.test(topic) &&
    tokens.length >= 3
  ) {
    return false
  }

  const social = isSocialSmallTalkTurn(context)
  const source = asString(context.source || '')
  if (social && (source === 'assistant' || source === 'state') && !context.allowAssistantDerived) {
    // During social turns, require user grounding unless explicitly allowed.
    const user = asString(context.userMessage)
    const userTokens = topicTokens(user)
    const overlap = tokens.filter((t) => userTokens.includes(t))
    if (overlap.length === 0 && !context.allowAssistantDerived) return false
  }

  // Prefer noun-like / named concepts: reject pure verb stacks.
  if (tokens.every((t) => /^(pensare|possiamo|potremmo|vediamo|parlare|aiutare|proteggere)$/i.test(t))) {
    return false
  }

  return true
}

/**
 * Explicit offer / proposal surface patterns (must be identifiable).
 * Narrower than historical short-reply proposal heuristics.
 */
export const EXPLICIT_PROPOSAL_RE =
  /\b((posso|vorrei|voglio)\s+(spiegarti|raccontarti|mostrarti|parlarti|propor|iniziare|partire|continuare)|(ti\s+(racconto|spiego|dico|mostro)\s)|(se\s+vuoi,?\s+possiamo\s+(parlare|approfondire|continuar)|vuoi\s+che\s+(ti\s+)?(spieghi|racconti|continui)|i\s+can\s+(explain|tell|show)|want\s+me\s+to\s+(explain|tell|show)|shall\s+we\s+(talk|continue)|let\s+me\s+(tell|explain|show)|posso\s+raccontarti|posso\s+spiegarti))\b/i

/**
 * @param {{
 *   type?: string|null,
 *   topic?: string|null,
 *   assistantText?: string,
 * }|null|undefined} proposal
 * @param {{
 *   userMessage?: string,
 *   perception?: object|null,
 *   messages?: Array<{ role?: string, content?: string }>,
 *   activeTopic?: string|null,
 * }} [context]
 * @returns {boolean}
 */
export function isValidPendingProposal(proposal, context = {}) {
  if (!proposal || typeof proposal !== 'object') return false
  const assistantText = asString(proposal.assistantText || '')
  const topic = asString(proposal.topic || '').trim()

  // Prefer validating against the assistant utterance when available.
  if (assistantText) {
    if (!EXPLICIT_PROPOSAL_RE.test(assistantText) && !/\?\s*$/.test(assistantText)) {
      // Questions alone can be open_question only if they name a subject.
      return false
    }
    // Bare "possiamo …" without explicit offer verb pattern is not enough
    // unless EXPLICIT_PROPOSAL_RE matched.
    if (
      /\bpossiamo\b/i.test(assistantText) &&
      !EXPLICIT_PROPOSAL_RE.test(assistantText) &&
      !/\b(se\s+vuoi|vuoi\s+che)\b/i.test(assistantText)
    ) {
      return false
    }
    if (hasUnresolvedCentralReferent(assistantText, context)) return false
  }

  if (topic) {
    if (
      !isValidActiveTopic(topic, {
        ...context,
        source: 'proposal',
        allowAssistantDerived: true,
      })
    ) {
      return false
    }
  } else if (assistantText) {
    // Offer without extractable topic is still ok only for open_question with clear ask.
    if (asString(proposal.type) !== 'open_question') return false
  } else {
    return false
  }

  return true
}

/**
 * Sanitize echoed previous Conversation State before Mind/Planner consume it.
 * Does not mutate the input object.
 *
 * @param {object|null|undefined} previousState
 * @param {{
 *   userMessage?: string,
 *   perception?: object|null,
 *   conversationSignals?: object|null,
 *   messages?: Array<{ role?: string, content?: string }>,
 * }} [context]
 * @returns {object|null}
 */
export function sanitizeEchoedConversationState(previousState, context = {}) {
  if (!previousState || typeof previousState !== 'object') return null

  const social = isSocialSmallTalkTurn(context)
  const next = { ...previousState }

  const topic = asString(next.activeTopic).trim() || null
  if (
    topic &&
    !isValidActiveTopic(topic, {
      ...context,
      source: 'state',
      allowAssistantDerived: !social,
    })
  ) {
    next.activeTopic = null
  }

  if (social) {
    // Small talk may clear phantom topics/proposals even if they barely pass.
    if (next.activeTopic && !isValidActiveTopic(next.activeTopic, {
      ...context,
      source: 'state',
      allowAssistantDerived: false,
    })) {
      next.activeTopic = null
    }
  }

  const pending = next.pendingProposal
  if (pending && typeof pending === 'object') {
    const ok = isValidPendingProposal(
      {
        type: pending.type,
        topic: pending.topic,
        assistantText: asString(pending.topic),
      },
      { ...context, activeTopic: next.activeTopic },
    )
    // Also reject when proposal topic itself is invalid / matches cleared phantom.
    const pendingTopic = asString(pending.topic).trim()
    const topicOk =
      !pendingTopic ||
      isValidActiveTopic(pendingTopic, {
        ...context,
        source: 'proposal',
        allowAssistantDerived: true,
      })
    if (!ok || !topicOk || (social && !topicOk)) {
      next.pendingProposal = null
    } else if (social && !next.activeTopic) {
      // Social turn with no living topic: drop explore_topic phantoms.
      if (
        pending.type === 'explore_topic' ||
        VAGUE_TOPIC_RE.test(pendingTopic) ||
        fillerHeavy(pendingTopic)
      ) {
        next.pendingProposal = null
      }
    }
  }

  if (social) {
    next.activeGoal = next.activeGoal || 'social_connection'
    if (!next.conversationMode || next.conversationMode === 'learning') {
      next.conversationMode = 'social'
    }
  }

  return next
}

/**
 * @param {string} topic
 * @returns {boolean}
 */
function fillerHeavy(topic) {
  const tokens =
    asString(topic)
      .toLowerCase()
      .match(/[a-zàèéìòù0-9]{3,}/gi) || []
  if (tokens.length < 2) return false
  const filler = tokens.filter((t) => FILLER_TOPIC_TOKENS.has(t.toLowerCase())).length
  return filler >= Math.ceil(tokens.length * 0.4)
}

/**
 * Vague noun / demonstrative openings that presuppose an already-known referent.
 * Used when activeTopic is null (fresh initiative / boredom turns).
 */
const IN_MEDIAS_RES_OPENING_RE =
  /^(è|e['’]?)\s+(un|una|il|lo|la)\s+(fenomeno|cosa|fatto|aspetto|meccanismo|processo|principio|dato|dettaglio|esempio)\b/i

const IN_MEDIAS_RES_DEMONSTRATIVE_RE =
  /^(questa\s+cosa|questo\s+fenomeno|quel(?:lo|la)\s+(?:fenomeno|cosa)|la\s+cosa\s+interessante|il\s+punto\s+interessante|ciò\s+che\s+(?:è|risulta)\s+interessante|this\s+(?:is\s+)?(?:a\s+)?(?:fascinating\s+)?(?:phenomenon|thing|fact)|it'?s\s+a\s+(?:fascinating\s+)?(?:phenomenon|thing)|this\s+shows\s+that|this\s+demonstrates|the\s+interesting\s+thing\s+is|what'?s\s+interesting\s+is)\b/i

const IN_MEDIAS_RES_ANAPHORIC_START_RE =
  /^(questo|questa|quello|quella|ciò|this|that|it)\s+(dimostra|mostra|prova|indica|rivela|significa|shows|demonstrates|proves|means|reveals)\b/i

/**
 * True when the first substantive sentence opens in medias res —
 * referring to "a phenomenon / this thing / this shows…" without having
 * established the concrete subject (and no living activeTopic).
 *
 * @param {string} text
 * @param {{
 *   activeTopic?: string|null,
 *   messages?: Array<{ role?: string, content?: string }>,
 * }} [context]
 * @returns {boolean}
 */
export function hasUnsupportedInMediasResOpening(text, context = {}) {
  const activeTopic = asString(context.activeTopic).trim()
  // Living topic can license anaphoric openings — do not false-positive.
  if (activeTopic) return false

  const raw = asString(text).replace(/\s+/g, ' ').trim()
  if (!raw) return false

  // Skip a short social ack, then inspect the first substantive sentence.
  const sentences = raw
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  let first = sentences[0] || ''
  if (
    /^(capisco|ok|okay|va bene|certo|bene|sure|right|alright|mh+|ciao|hey|hi)[.!…]*$/i.test(
      first,
    ) &&
    sentences[1]
  ) {
    first = sentences[1]
  }
  if (!first) return false

  if (IN_MEDIAS_RES_OPENING_RE.test(first)) return true
  if (IN_MEDIAS_RES_DEMONSTRATIVE_RE.test(first)) return true
  if (IN_MEDIAS_RES_ANAPHORIC_START_RE.test(first)) return true

  // "È un fenomeno affascinante, che dimostra…" mid-clause che-anaphora after vague noun.
  if (
    /\b(fenomeno|cosa|fatto)\s+\w{0,20},?\s+che\s+(dimostra|mostra|prova|indica)/i.test(first) &&
    !/\b(si\s+chiama|chiamat[oa]|noto\s+come|known\s+as|called)\b/i.test(first)
  ) {
    // Only if the vague noun is not preceded by an explicit named subject in the same sentence.
    if (!/\b(il|la|lo|i|gli|le|the)\s+[A-Za-zÀ-ÿ]{4,}\s+(è|e['’]?)\s+un\s+(fenomeno|cosa)/i.test(first)) {
      return true
    }
  }

  return false
}

/**
 * True when a reply's first substantive sentence explicitly names/establishes a subject
 * (rough structural check for initiative turns — not NER).
 *
 * @param {string} text
 * @returns {boolean}
 */
export function responseEstablishesConcreteSubject(text) {
  const raw = asString(text).replace(/\s+/g, ' ').trim()
  if (!raw || raw.length < 24) return false
  if (hasUnsupportedInMediasResOpening(raw, { activeTopic: null })) return false

  const sentences = raw
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  let first = sentences[0] || ''
  if (
    /^(capisco|ok|okay|va bene|certo|bene|sure|right|alright|mh+|ciao|hey|hi)[.!…]*$/i.test(
      first,
    ) &&
    sentences[1]
  ) {
    first = sentences[1]
  }

  // Explicit framing that names a subject.
  if (
    /\b(ti\s+(lancio|propongo|racconto)|parliamo\s+di|partiamo\s+(da|con)|una\s+curiosit[aà]\s+(su|sul|sulla|di)|let'?s\s+talk\s+about|here'?s\s+(a|one)|i'?ll\s+(share|tell|start\s+with)|one\s+(concrete|interesting)\s+(subject|topic|fact))\b/i.test(
      first,
    )
  ) {
    return true
  }

  // Named noun phrase as grammatical subject of the opening sentence.
  if (
    /\b([A-ZÁÉÍÓÚÀÈÌÒÙ][\wÁÉÍÓÚÀÈÌÒÙáéíóúàèìòù-]{2,}(?:\s+[A-Za-zÀ-ÿ-]{2,}){0,4})\b/.test(first) ||
    /\b(gli|i|le|il|la|lo|the)\s+[A-Za-zÀ-ÿ]{3,}(?:\s+[A-Za-zÀ-ÿ-]{2,}){0,3}\s+(possono|possono|sono|è|e['’]?|hanno|can|are|is|have)\b/i.test(
      first,
    )
  ) {
    return !IN_MEDIAS_RES_OPENING_RE.test(first)
  }

  return false
}

/**
 * Strip / flag unsupported referential continuation sentences from a draft.
 * Used by Writer grounding and Contract Evaluator.
 *
 * @param {string} draft
 * @param {{
 *   activeTopic?: string|null,
 *   messages?: Array<{ role?: string, content?: string }>,
 *   conversationPhase?: string|null,
 *   isOpeningSocial?: boolean,
 *   requireTopicEstablishment?: boolean,
 * }} [context]
 * @returns {{ text: string, removed: string[], flagged: boolean }}
 */
export function stripUnsupportedReferentialContinuation(draft, context = {}) {
  const original = asString(draft).replace(/\s+/g, ' ').trim()
  if (!original) return { text: '', removed: [], flagged: false, preserveText: false, reason: null }

  const sentences = original
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  /** @type {string[]} */
  const kept = []
  /** @type {string[]} */
  const removed = []

  // Whole-draft in-medias-res check (first substantive sentence).
  // Flag for Evaluator rewrite; do not destroy initiative drafts in Writer grounding.
  if (
    !context.activeTopic &&
    hasUnsupportedInMediasResOpening(original, {
      activeTopic: context.activeTopic || null,
      messages: context.messages || [],
    })
  ) {
    return {
      text: original,
      removed: [sentences[0] || original],
      flagged: true,
      preserveText: true,
      reason: 'unsupported_in_medias_res_opening',
    }
  }

  for (const sentence of sentences) {
    if (
      hasUnresolvedCentralReferent(sentence, {
        activeTopic: context.activeTopic || null,
        messages: context.messages || [],
      })
    ) {
      // Opening social / no topic: always drop.
      if (context.isOpeningSocial || !context.activeTopic) {
        removed.push(sentence)
        continue
      }
      // With a living topic, still drop if the clitic cannot bind to it.
      if (
        !topicTokens(asString(context.activeTopic)).some((t) =>
          sentence.toLowerCase().includes(t),
        )
      ) {
        removed.push(sentence)
        continue
      }
    }
    kept.push(sentence)
  }

  return {
    text: kept.join(' ').trim(),
    removed,
    flagged: removed.length > 0,
    preserveText: false,
    reason: removed.length ? 'unsupported_referential_continuation' : null,
  }
}
