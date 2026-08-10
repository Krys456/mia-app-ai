/**
 * LAIfe Conversation Planner Engine
 *
 * Mission: before writing any response, decide what the conversation should
 * achieve. Never jump from the user's message straight to text generation —
 * first build a conversational plan.
 *
 * Pipeline position:
 *   Language Detection → Conversation Intent → Emotional State
 *   → Conversation Opportunity → Conversation Planner → Writer
 *   → Conversation Critic
 *
 * Internal questions:
 *   1. What is the user really looking for?
 *   2. What should the user feel after reading?
 *   3. What is the best conversational strategy?
 *   4. How deep should this response be? (1–5)
 *   5. Should we stay / expand / shift / related / wait on topic?
 *
 * Plan for the next five minutes of conversation — not only the next message.
 * Internal check: «If a great conversationalist received this message, what
 * would they want this conversation to become over the next five minutes?»
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 * Writer must follow this plan. Critic validates the draft against it.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} PlannerLang
 */

/**
 * @typedef {'information'|'exploration'|'companionship'|'entertainment'|'emotional_presence'|'brainstorming'|'learning'|'curiosity'} UserLookingFor
 */

/**
 * @typedef {'understood'|'inspired'|'curious'|'relaxed'|'excited'|'informed'|'challenged'|'amused'} DesiredFeeling
 */

/**
 * @typedef {'explain'|'explore_together'|'tell_story'|'share_observation'|'build_curiosity'|'brainstorm'|'debate'|'reflect'|'challenge_idea'|'play'|'simply_listen'|'friendly'} ConversationalStrategy
 */

/**
 * @typedef {'stay'|'expand'|'shift_naturally'|'introduce_related'|'wait'} TopicAction
 */

/**
 * @typedef {object} ConversationPlan
 * @property {string} goal
 * @property {ConversationalStrategy} strategy
 * @property {DesiredFeeling} emotion
 * @property {number} depth 1–5
 * @property {TopicAction} topicAction
 * @property {boolean} initiative
 * @property {string} responseMode
 * @property {UserLookingFor} lookingFor
 * @property {string} fiveMinuteArc what a great conversationalist would aim for next ~5 min
 */

/**
 * @typedef {object} ConversationPlannerPlan
 * @property {boolean} active
 * @property {ConversationPlan} plan
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} rejectRules
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {PlannerLang} language
 * @property {string} validationCheck
 * @property {string} internalQuestion
 */

const GREETING_RE =
  /^(ciao|hey|hi|hello|ehi|salve|buongiorno|buonasera|good\s+(morning|afternoon|evening)|yo)([\s!,.🥰😊🙏]*)$/i

const BORED_RE =
  /\b(mi\s+annoio|sono\s+annoiato|i'?m\s+bored|boring|annoiato|noia|nothing\s+to\s+do|non\s+so\s+cosa\s+fare)\b/i

const INTERESTING_OPEN_RE =
  /\b(parliamo\s+di\s+qualcosa|let'?s\s+talk\s+about\s+something|dimmi\s+qualcosa\s+di\s+interessante|something\s+interesting|qualcosa\s+di\s+interessante|raccontami\s+qualcosa)\b/i

// Note: JS \b is ASCII-only — do not put \b after accented letters (è/é).
const TEACH_RE =
  /(?:^|[^\p{L}])(?:cos['’]?[eè]|what\s+is|spiegami|explain|come\s+funziona|how\s+does|definizione|definition|perch[eé]\s+[eè]|why\s+is)(?=$|[^\p{L}])/iu

const PLAY_RE =
  /^(a?ha(ha)+|asd+|ble+h+|po(\s+po)+|lalala+|🦆+|😂+|🤣+)([\s!.]*)$/i

const LISTEN_RE =
  /\b(mi\s+sento|i\s+feel|sono\s+triste|anxious|ansia|ho\s+bisogno|need\s+to\s+vent|ascoltami|just\s+listen)\b/i

const BRAINSTORM_RE =
  /\b(brainstorm|idee\s+per|ideas\s+for|aiutami\s+a\s+pensare|help\s+me\s+think|progettiamo|let'?s\s+design)\b/i

const DEBATE_RE =
  /\b(non\s+sono\s+d'?accordo|i\s+disagree|secondo\s+te|what\s+do\s+you\s+think\s+about|dibatt|debate|contro)\b/i

const HARD_TASK_RE =
  /\b(step[- ]?by[- ]?step|codice|code\s+sample|debug|sql|api\s+key|unit\s+test|traduci|translate\s+this|compila)\b/i

const DISTRESS_RE =
  /\b(suicid|kill\s+myself|self[- ]?harm|voglio\s+morire|panic\s+attack|attacco\s+di\s+panico)\b/i

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
      content: String(/** @type {{ content?: string }} */ (m).content || '').trim(),
    }))
    .filter((m) => m.content)
}

/**
 * @param {object} input
 * @returns {PlannerLang}
 */
function resolveLang(input) {
  const la = input.languageAwareness?.plan || input.languageAwareness || null
  const reply = String(la?.replyLanguage || la?.detected || '').toLowerCase()
  if (reply.startsWith('en')) return 'en'
  if (reply.startsWith('it')) return 'it'
  const fromMsg = detectDominantLanguage(String(input.userMessage || ''))
  return fromMsg === 'en' ? 'en' : 'it'
}

/**
 * @param {string} s
 * @param {number} mod
 */
function hashPick(s, mod) {
  let h = 2166136261
  const str = String(s || '')
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return mod > 0 ? (h >>> 0) % mod : 0
}

/**
 * Infer what the user is looking for.
 * @param {object} args
 * @returns {{ lookingFor: UserLookingFor, signals: string[] }}
 */
function inferLookingFor(args) {
  const { msg, intent, emotionalState } = args
  /** @type {string[]} */
  const signals = []
  const expects = String(intent?.expects || '')
  const emo = String(intent?.emotionalIntent || emotionalState?.emotionalIntent || '')

  if (DISTRESS_RE.test(msg) || LISTEN_RE.test(msg) || emotionalState?.needsSupport) {
    signals.push('emotional_presence')
    return { lookingFor: 'emotional_presence', signals }
  }
  if (GREETING_RE.test(msg)) {
    signals.push('greeting')
    return { lookingFor: 'companionship', signals }
  }
  if (BORED_RE.test(msg) || INTERESTING_OPEN_RE.test(msg)) {
    signals.push('want_interesting')
    return { lookingFor: 'curiosity', signals }
  }
  if (PLAY_RE.test(msg) || emo === 'playful') {
    signals.push('entertainment')
    return { lookingFor: 'entertainment', signals }
  }
  if (BRAINSTORM_RE.test(msg)) {
    signals.push('brainstorm')
    return { lookingFor: 'brainstorming', signals }
  }
  if (TEACH_RE.test(msg) || HARD_TASK_RE.test(msg) || expects === 'information') {
    signals.push('learning_or_info')
    return { lookingFor: TEACH_RE.test(msg) ? 'learning' : 'information', signals }
  }
  if (expects === 'exploration' || intent?.curiosityLevel === 'high') {
    signals.push('exploration')
    return { lookingFor: 'exploration', signals }
  }
  if (expects === 'companionship' || expects === 'presence') {
    signals.push('companionship')
    return { lookingFor: 'companionship', signals }
  }
  if (msg.split(/\s+/).length >= 8 && /\?/.test(msg)) {
    return { lookingFor: 'information', signals: ['question'] }
  }
  return { lookingFor: 'curiosity', signals: ['default_curiosity'] }
}

/**
 * Desired feeling after reading.
 * @param {UserLookingFor} lookingFor
 * @param {string} msg
 * @returns {DesiredFeeling}
 */
function pickDesiredFeeling(lookingFor, msg) {
  if (LISTEN_RE.test(msg) || lookingFor === 'emotional_presence') return 'understood'
  if (GREETING_RE.test(msg)) return 'relaxed'
  if (BORED_RE.test(msg) || INTERESTING_OPEN_RE.test(msg)) return 'curious'
  if (lookingFor === 'entertainment') return 'amused'
  if (lookingFor === 'learning' || lookingFor === 'information') return 'informed'
  if (lookingFor === 'brainstorming') return 'inspired'
  if (DEBATE_RE.test(msg)) return 'challenged'
  if (lookingFor === 'exploration') return 'curious'
  if (lookingFor === 'companionship') return 'relaxed'
  return 'curious'
}

/**
 * @param {object} args
 * @returns {{ strategy: ConversationalStrategy, responseMode: string }}
 */
function pickStrategy(args) {
  const { lookingFor, msg, opportunity, intent } = args
  if (PLAY_RE.test(msg) || lookingFor === 'entertainment') {
    return { strategy: 'play', responseMode: 'humor' }
  }
  if (LISTEN_RE.test(msg) || lookingFor === 'emotional_presence') {
    return { strategy: 'simply_listen', responseMode: 'listening' }
  }
  if (GREETING_RE.test(msg)) {
    return { strategy: 'friendly', responseMode: 'presence' }
  }
  if (lookingFor === 'learning' || TEACH_RE.test(msg)) {
    return { strategy: 'explain', responseMode: 'explanation' }
  }
  if (lookingFor === 'information' || HARD_TASK_RE.test(msg)) {
    return { strategy: 'explain', responseMode: 'explanation' }
  }
  if (BORED_RE.test(msg)) {
    return { strategy: 'build_curiosity', responseMode: 'curiosity' }
  }
  if (INTERESTING_OPEN_RE.test(msg) || lookingFor === 'exploration' || lookingFor === 'curiosity') {
    return { strategy: 'explore_together', responseMode: 'exploration' }
  }
  if (lookingFor === 'brainstorming' || BRAINSTORM_RE.test(msg)) {
    return { strategy: 'brainstorm', responseMode: 'exploration' }
  }
  if (DEBATE_RE.test(msg)) {
    return { strategy: 'debate', responseMode: 'challenge' }
  }
  if (opportunity?.initiativeAllowed && opportunity?.initiativeType === 'story') {
    return { strategy: 'tell_story', responseMode: 'story' }
  }
  if (opportunity?.initiativeAllowed && opportunity?.initiativeType === 'curiosity') {
    return { strategy: 'build_curiosity', responseMode: 'curiosity' }
  }
  if (intent?.expects === 'companionship') {
    return { strategy: 'share_observation', responseMode: 'observation' }
  }
  return { strategy: 'share_observation', responseMode: 'observation' }
}

/**
 * Depth 1–5.
 * @param {object} args
 */
function pickDepth(args) {
  const { lookingFor, msg, strategy } = args
  if (GREETING_RE.test(msg) || PLAY_RE.test(msg)) return 1
  if (strategy === 'simply_listen' || strategy === 'friendly') return 2
  if (BORED_RE.test(msg)) return 3
  if (lookingFor === 'companionship' && msg.split(/\s+/).length <= 6) return 2
  if (INTERESTING_OPEN_RE.test(msg) || lookingFor === 'exploration' || lookingFor === 'curiosity') {
    return 4
  }
  if (lookingFor === 'learning' || TEACH_RE.test(msg)) return 4
  if (lookingFor === 'brainstorming') return 4
  if (lookingFor === 'information' || HARD_TASK_RE.test(msg)) return 3
  if (lookingFor === 'entertainment') return 2
  if (msg.split(/\s+/).length >= 20) return 4
  return 3
}

/**
 * @param {object} args
 * @returns {TopicAction}
 */
function pickTopicAction(args) {
  const { lookingFor, msg, opportunity, intent } = args
  if (GREETING_RE.test(msg) && !asTurns(args.messages).some((t) => t.role === 'assistant')) {
    return 'wait'
  }
  if (TEACH_RE.test(msg) || HARD_TASK_RE.test(msg) || lookingFor === 'learning' || lookingFor === 'information') {
    return 'stay'
  }
  if (LISTEN_RE.test(msg) || lookingFor === 'emotional_presence') return 'stay'
  if (INTERESTING_OPEN_RE.test(msg) || BORED_RE.test(msg)) {
    // Choose highest-value related spark — not random dump; planner marks expand/related
    return opportunity?.initiativeAllowed ? 'introduce_related' : 'expand'
  }
  if (intent?.opennessToContinue === 'eager' || lookingFor === 'exploration') return 'expand'
  if (opportunity?.initiativeAllowed && opportunity.initiativeType !== 'none') {
    return 'introduce_related'
  }
  return 'stay'
}

/**
 * @param {ConversationPlan} plan
 * @param {PlannerLang} lang
 */
function buildGoal(plan, lang, msg) {
  if (GREETING_RE.test(msg)) {
    return lang === 'en' ? 'Warm greeting — open the door, don’t force curiosity.' : 'Saluto caldo — apri la porta, non forzare curiosità.'
  }
  if (BORED_RE.test(msg)) {
    return lang === 'en' ? 'Increase engagement with interactive curiosity.' : 'Aumenta engagement con curiosità interattiva.'
  }
  if (INTERESTING_OPEN_RE.test(msg)) {
    return lang === 'en'
      ? 'Create a memorable conversation — pick a high-potential topic (novelty × interest), not at random.'
      : 'Crea una conversazione memorabile — scegli un tema ad alto potenziale (novità × interesse), non a caso.'
  }
  if (TEACH_RE.test(msg) || plan.lookingFor === 'learning') {
    return lang === 'en' ? 'Teach clearly — stay on the requested topic.' : 'Insegna con chiarezza — resta sul tema richiesto.'
  }
  if (plan.lookingFor === 'emotional_presence') {
    return lang === 'en' ? 'Offer emotional presence — listen first.' : 'Offri presenza emotiva — ascolta prima.'
  }
  if (plan.lookingFor === 'entertainment') {
    return lang === 'en' ? 'Play along — keep it light and fun.' : 'Gioca — resta leggero e divertente.'
  }
  if (plan.lookingFor === 'brainstorming') {
    return lang === 'en' ? 'Brainstorm useful options together.' : 'Brainstormate insieme opzioni utili.'
  }
  if (plan.lookingFor === 'information') {
    return lang === 'en' ? 'Inform clearly and usefully.' : 'Informa in modo chiaro e utile.'
  }
  return lang === 'en'
    ? 'Grow a living conversation over the next few minutes.'
    : 'Fai crescere una conversazione viva nei prossimi minuti.'
}

/**
 * @param {ConversationPlan} plan
 * @param {PlannerLang} lang
 */
function buildFiveMinuteArc(plan, lang) {
  const mapEn = {
    information: 'Answer well, then leave one natural thread they can pull if curious.',
    learning: 'Teach the core clearly, then invite one deeper angle if they want.',
    exploration: 'Open a rich topic and develop it together across a few turns.',
    curiosity: 'Spark genuine interest and keep the thread alive without interrogating.',
    companionship: 'Warm presence and light connection — follow their pace.',
    entertainment: 'Match play energy; keep riffing if they continue.',
    emotional_presence: 'Stay with the feeling; deepen understanding before advice.',
    brainstorming: 'Generate options, then refine the best ones together.',
  }
  const mapIt = {
    information: 'Rispondi bene, poi lascia un filo naturale da tirare se sono curiosi.',
    learning: 'Insegna il nucleo con chiarezza, poi invita un angolo più profondo se vogliono.',
    exploration: 'Apri un tema ricco e sviluppatelo insieme in più turni.',
    curiosity: 'Accendi interesse genuino e tieni vivo il filo senza interrogare.',
    companionship: 'Presenza calda e connessione leggera — al loro ritmo.',
    entertainment: 'Allinea l’energia giocosa; continua il riff se proseguono.',
    emotional_presence: 'Resta con il sentimento; approfondisci la comprensione prima dei consigli.',
    brainstorming: 'Genera opzioni, poi affinate insieme le migliori.',
  }
  const table = lang === 'en' ? mapEn : mapIt
  return table[plan.lookingFor] || table.curiosity
}

/**
 * Quality reject rules for Writer + Critic.
 * @param {ConversationPlan} plan
 */
function buildRejectRules(plan) {
  /** @type {string[]} */
  const rules = [
    'Do not change subject unnecessarily',
    'Do not become an essay / TED / Wikipedia voice',
    'Do not repeat recent reply patterns',
    'Do not ignore conversation history',
    'Do not force philosophical reflections',
    'Do not force motivational content',
    'Do not ignore the user’s intent',
  ]
  if (plan.topicAction === 'stay') {
    rules.push('Stay on the requested topic — no random pivots')
  }
  if (plan.depth <= 2) {
    rules.push('Keep it short — depth plan is low; no concept dump')
  }
  if (plan.strategy === 'friendly' || plan.strategy === 'simply_listen') {
    rules.push('Do not force curiosity openers')
  }
  if (!plan.initiative) {
    rules.push('Initiative not earned — follow their direction')
  }
  return rules
}

/**
 * @param {object} [input]
 * @returns {ConversationPlannerPlan}
 */
export function buildConversationPlannerPlan(input = {}) {
  const language = resolveLang(input)
  const msg = String(input.userMessage || '').trim()
  const intent =
    input.conversationIntent?.plan?.inference ||
    input.conversationIntent?.inference ||
    null
  const opportunity =
    input.conversationOpportunity?.plan || input.conversationOpportunity || null
  const emotionalState =
    input.emotionalState ||
    opportunity?.emotionalState ||
    null
  const responseMode = input.responseMode?.plan || input.responseMode || null

  if (!msg) {
    return {
      active: false,
      plan: {
        goal: '',
        strategy: 'friendly',
        emotion: 'relaxed',
        depth: 1,
        topicAction: 'wait',
        initiative: false,
        responseMode: 'presence',
        lookingFor: 'companionship',
        fiveMinuteArc: '',
      },
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      rejectRules: [],
      signals: ['empty'],
      reasons: ['empty'],
      confidence: 'low',
      language,
      validationCheck: '',
      internalQuestion:
        'If a great conversationalist received this message, what would they want this conversation to become over the next five minutes?',
    }
  }

  const look = inferLookingFor({ msg, intent, emotionalState })
  const emotion = pickDesiredFeeling(look.lookingFor, msg)
  const { strategy, responseMode: modeFromStrategy } = pickStrategy({
    lookingFor: look.lookingFor,
    msg,
    opportunity,
    intent,
  })
  // Prefer Response Mode Engine pick when aligned; else planner strategy mode
  const responseModeId =
    responseMode?.mode && strategy !== 'friendly' && strategy !== 'simply_listen'
      ? String(responseMode.mode)
      : modeFromStrategy
  const depth = pickDepth({ lookingFor: look.lookingFor, msg, strategy })
  const topicAction = pickTopicAction({
    lookingFor: look.lookingFor,
    msg,
    opportunity,
    intent,
    messages: input.messages,
  })
  const initiative = Boolean(
    opportunity?.initiativeAllowed &&
      opportunity?.initiativeType &&
      opportunity.initiativeType !== 'none' &&
      topicAction !== 'stay' &&
      topicAction !== 'wait' &&
      strategy !== 'simply_listen' &&
      strategy !== 'explain',
  )

  /** @type {ConversationPlan} */
  const plan = {
    goal: '',
    strategy,
    emotion,
    depth,
    topicAction,
    initiative,
    responseMode: responseModeId,
    lookingFor: look.lookingFor,
    fiveMinuteArc: '',
  }
  plan.goal = buildGoal(plan, language, msg)
  plan.fiveMinuteArc = buildFiveMinuteArc(plan, language)
  const rejectRules = buildRejectRules(plan)

  /** @type {ConversationPlannerPlan} */
  const out = {
    active: true,
    plan,
    writerBrief: '',
    structureLine: `Conversation Planner → goal«${plan.goal.slice(0, 48)}» · ${plan.strategy} · feel ${plan.emotion} · depth ${plan.depth} · topic ${plan.topicAction}`,
    responseHints: [
      `LookingFor=${plan.lookingFor}`,
      `Strategy=${plan.strategy}`,
      `DesiredFeeling=${plan.emotion}`,
      `Depth=${plan.depth}/5`,
      `TopicAction=${plan.topicAction}`,
      `Initiative=${plan.initiative ? 'yes' : 'no'}`,
      `5min: ${plan.fiveMinuteArc}`,
    ],
    rejectRules,
    signals: [
      ...look.signals,
      `strategy_${strategy}`,
      `depth_${depth}`,
      `topic_${topicAction}`,
      initiative ? 'initiative_on' : 'initiative_off',
    ],
    reasons: [
      'plan_before_write',
      `looking_${look.lookingFor}`,
      `feel_${emotion}`,
      'optimize_next_5_minutes',
    ],
    confidence:
      GREETING_RE.test(msg) || TEACH_RE.test(msg) || BORED_RE.test(msg) || INTERESTING_OPEN_RE.test(msg)
        ? 'high'
        : 'medium',
    language,
    validationCheck:
      'Did the Writer follow the plan (goal, strategy, depth, topicAction) and aim at the next five minutes — not only a one-shot answer?',
    internalQuestion:
      'If a great conversationalist received this message, what would they want this conversation to become over the next five minutes?',
  }
  out.writerBrief = buildWriterBrief(out)
  return out
}

/**
 * @param {ConversationPlannerPlan} full
 */
function buildWriterBrief(full) {
  if (!full.active) return ''
  const p = full.plan
  return [
    'CONVERSATION PLANNER ENGINE: NON saltare dal messaggio alla generazione — segui questo piano.',
    `Internal Q: ${full.internalQuestion}`,
    `PLAN JSON: ${JSON.stringify({
      goal: p.goal,
      strategy: p.strategy,
      emotion: p.emotion,
      depth: p.depth,
      topicAction: p.topicAction,
      initiative: p.initiative,
      responseMode: p.responseMode,
      lookingFor: p.lookingFor,
    })}`,
    `Five-minute arc: ${p.fiveMinuteArc}`,
    `Depth guide: 1 very short · 2 concise · 3 developed · 4 detailed · 5 memorable — target ${p.depth}.`,
    `Topic action: ${p.topicAction}.`,
    `Reject if: ${full.rejectRules.slice(0, 5).join(' · ')}`,
    'Optimize for the next 5 minutes of conversation, not only the next message.',
    `Check: ${full.validationCheck}`,
    'NON citare Conversation Planner / lo stage.',
  ].join(' ')
}

/**
 * @param {ConversationPlannerPlan | null | undefined} plan
 */
export function formatConversationPlannerForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const p = plan.plan
  return `══════════════════════════════════════
CONVERSATION PLANNER ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · strategy=${p.strategy} · depth=${p.depth} · topic=${p.topicAction} · initiative=${p.initiative} · feel=${p.emotion} · confidence=${plan.confidence}

${plan.writerBrief}

Regole: pianifica prima di scrivere · Writer segue il piano · 5 minuti > un messaggio · non citare il motore.`.trim()
}

/**
 * @param {ConversationPlannerPlan | null | undefined} plan
 * @returns {string[]}
 */
export function conversationPlannerStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  hints.push(`Follow plan strategy: ${plan.plan.strategy} · depth ${plan.plan.depth}`)
  hints.push(`Topic action: ${plan.plan.topicAction}`)
  hints.push(`5-min arc: ${plan.plan.fiveMinuteArc}`)
  hints.push(`Internal: ${plan.internalQuestion}`)
  return hints
}

/**
 * Soft length heuristic for depth targets.
 * @param {string} text
 * @param {number} depth
 */
function depthMismatch(text, depth) {
  const t = String(text || '').trim()
  const len = t.length
  if (depth <= 1 && len > 220) return true
  if (depth === 2 && len > 420) return true
  if (depth >= 4 && len < 80 && !/^(ciao|hey|hi)\b/i.test(t)) return true
  return false
}

/**
 * Draft violates planner intent (used by Critic + chat refine).
 * @param {string} draft
 * @param {ConversationPlannerPlan | null | undefined} plan
 */
export function draftViolatesConversationPlanner(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true
  const p = plan.plan

  // Essay / motivational / philosophy dumps when not planned
  if (
    p.depth <= 2 &&
    /\b(it\s+is\s+fascinating|è\s+affascinante|this\s+leads\s+us|human\s+communication|believe\s+in\s+yourself|nel\s+mondo\s+di\s+oggi)\b/i.test(
      text,
    )
  ) {
    return true
  }

  if (p.strategy === 'friendly' || p.strategy === 'simply_listen') {
    if (text.length > 320 && /\b(because|perch[eé]|in\s+conclusion|filosof|philosophy)\b/i.test(text)) {
      return true
    }
  }

  if (p.topicAction === 'stay' && /\b(let'?s\s+talk\s+about|parliamo\s+di|changing\s+(the\s+)?subject|comunque\s+parlando\s+di\s+altro)\b/i.test(text)) {
    return true
  }

  if (p.strategy === 'explain' && p.topicAction === 'stay' && /\b(unrelated|del\s+tutto\s+altro|random\s+fact)\b/i.test(text)) {
    return true
  }

  if (!p.initiative && p.topicAction === 'wait' && text.length > 260) return true

  if (depthMismatch(text, p.depth)) return true

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationPlannerPlan, context: string }}
 */
export function runConversationPlannerEngine(input = {}) {
  try {
    const plan = buildConversationPlannerPlan(input)
    return {
      plan,
      context: formatConversationPlannerForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        plan: {
          goal: '',
          strategy: 'friendly',
          emotion: 'relaxed',
          depth: 1,
          topicAction: 'wait',
          initiative: false,
          responseMode: 'presence',
          lookingFor: 'companionship',
          fiveMinuteArc: '',
        },
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        rejectRules: [],
        signals: ['fail_soft'],
        reasons: ['fail_soft'],
        confidence: 'low',
        language: 'it',
        validationCheck: '',
        internalQuestion: '',
      },
      context: '',
    }
  }
}
