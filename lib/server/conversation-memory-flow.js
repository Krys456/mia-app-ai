/**
 * LAIfe Conversation Memory Flow
 *
 * Mission: naturally weave previous conversation topics into new replies.
 *
 * Do NOT dump memories.
 * Instead: recall naturally · connect ideas across time · notice progress ·
 * mention previous discussions only when relevant.
 *
 * The user should feel: "It remembers me because it was paying attention."
 *
 * Never: "As you said three weeks ago..."
 * Instead: "The last time we talked about this, we were looking at it from another angle..."
 *       or "This reminds me of something we discussed before..."
 *
 * Recall should feel spontaneous — never mechanical.
 *
 * Runs AFTER Conversation Taste (and Memory Map) and BEFORE the Writer.
 * Cooperates with Conversation Memory Map + short-term session.
 * Invisible. Fail-soft. Soft advisor — Coordinator applies before Writer.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'silence'|'weave_soft'|'connect_across_time'|'notice_progress'} MemoryFlowMove
 */

/**
 * @typedef {object} MemoryFlowCandidate
 * @property {string} thread
 * @property {string} kind
 * @property {number} score
 * @property {string} bridge
 * @property {string[]} reasons
 */

/**
 * @typedef {object} ConversationMemoryFlowPlan
 * @property {boolean} active
 * @property {MemoryFlowMove} move
 * @property {MemoryFlowCandidate | null} chosen
 * @property {MemoryFlowCandidate[]} candidates
 * @property {boolean} shouldWeave
 * @property {string[]} naturalPhrases
 * @property {string[]} forbiddenPhrases
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} reasons
 * @property {string[]} signals
 */

const GOODBYE =
  /(a\s+presto|ci\s+vediamo|buonanotte|goodbye|bye\b|talk\s+later|ok\s+grazie|thanks[,!]?\s*$|grazie[,!]?\s*$)/i

const SHORT_REACT =
  /^(ok|okay|k|nice|cool|wow|interesting|awesome|great|thanks|thank\s+you|grazie|capito|capisco|i\s+see|ah|oh|mm+|sì|si|yes|yep|yeah|interessante|bell[oa]|figo|forte|perfetto)([\s!,.]*)$/i

const CONTINUE =
  /\b(continua|go\s+on|keep\s+going|dimmi\s+di\s+pi[uù]|tell\s+me\s+more|e\s+poi|and\s+then|approfond)\b/i

const CALLBACK =
  /\b(prima|before|l['’]altra\s+volta|last\s+time|ricordi|remember|avevamo|we\s+(were|had)|come\s+dicevamo|as\s+we)\b/i

const FORBIDDEN = [
  'As you said three weeks ago…',
  'Come hai detto tre settimane fa…',
  'Secondo i miei record…',
  'According to my memory logs…',
  'Recalling from memory ID…',
  'You previously stated on [date]…',
]

const NATURAL = [
  'The last time we talked about this, we were looking at it from another angle…',
  'This reminds me of something we discussed before…',
  'L’ultima volta che ne parlavamo, lo stavamo guardando da un’altra angolazione…',
  'Questo mi richiama qualcosa di cui avevamo parlato…',
  'C’è un filo con quello che stavi esplorando prima…',
  'There’s a thread here with what you were exploring earlier…',
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
 * @param {string} a
 * @param {string} b
 */
function overlapScore(a, b) {
  const ta = new Set(
    normalize(a)
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 3),
  )
  const tb = normalize(b)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 3)
  if (!ta.size || !tb.length) return 0
  let hit = 0
  for (const w of tb) if (ta.has(w)) hit++
  return hit / Math.max(3, Math.min(ta.size, 12))
}

/**
 * @param {string} kind
 * @param {string} thread
 */
function bridgeFor(kind, thread) {
  const t = normalize(thread).slice(0, 72)
  switch (kind) {
    case 'progress':
      return `Nota il progresso sul filo «${t}» in modo naturale — una frase, non un report.`
    case 'goal':
      return `Collega dolcemente all’obiettivo «${t}» se illumina il turno attuale.`
    case 'project':
      return `Se torna utile, richiama il progetto «${t}» come continuazione viva, non come checklist.`
    case 'explained':
      return `Non ripetere la spiegazione già data su «${t}» — costruisci sopra, o collega da un’altra angolazione.`
    case 'topic':
    default:
      return `Se è pertinente, tessi un richiamo spontaneo a «${t}» (angolo diverso / filo ritrovato) — mai meccanico.`
  }
}

/**
 * Collect weave candidates from memory map + session + recent turns.
 * @param {object} args
 * @returns {MemoryFlowCandidate[]}
 */
function collectCandidates(args) {
  const { userMessage, memoryMap, session, turns } = args
  const text = normalize(userMessage)
  /** @type {MemoryFlowCandidate[]} */
  const raw = []

  const push = (thread, kind, base, reasons) => {
    const t = normalize(thread)
    if (!t || t.length < 3) return
    let score = base + overlapScore(t, text) * 3.2
    if (CALLBACK.test(text)) score += 1.2
    if (CONTINUE.test(text)) score += 0.8
    raw.push({
      thread: t.slice(0, 96),
      kind,
      score: Math.round(score * 100) / 100,
      bridge: bridgeFor(kind, t),
      reasons,
    })
  }

  const map = memoryMap || {}
  for (const t of map.exploredTopics || []) push(t, 'topic', 2.4, ['map_topic'])
  for (const t of map.ongoingProjects || []) push(t, 'project', 3.0, ['map_project'])
  for (const t of map.userGoals || []) push(t, 'goal', 2.9, ['map_goal'])
  for (const t of map.explanationsGiven || []) push(t, 'explained', 2.2, ['map_explained'])
  if (map.activeTopic) push(map.activeTopic, 'topic', 3.1, ['map_active'])

  if (session?.currentTopic) push(session.currentTopic, 'topic', 2.8, ['session_topic'])
  if (session?.currentGoal) push(session.currentGoal, 'goal', 2.7, ['session_goal'])
  if (Array.isArray(session?.alreadyExplained)) {
    for (const t of session.alreadyExplained.slice(-4)) push(t, 'explained', 2.0, ['session_explained'])
  }

  // Progress: prior user topics that reappear
  const priorUser = turns.filter((t) => t.role === 'user').slice(-8, -1)
  for (const u of priorUser) {
    const ov = overlapScore(u.content, text)
    if (ov >= 0.25) {
      push(u.content.slice(0, 80), 'progress', 2.6 + ov, ['revisit_progress'])
    }
  }

  // Dedupe by thread key
  const seen = new Set()
  /** @type {MemoryFlowCandidate[]} */
  const out = []
  for (const c of raw.sort((a, b) => b.score - a.score)) {
    const key = c.thread.toLowerCase().slice(0, 40)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out.slice(0, 6)
}

/**
 * @param {MemoryFlowMove} move
 */
function moveLabel(move) {
  switch (move) {
    case 'weave_soft':
      return 'tessitura soft di un filo passato'
    case 'connect_across_time':
      return 'collegamento tra idee nel tempo'
    case 'notice_progress':
      return 'notare il progresso sul filo'
    case 'silence':
    default:
      return 'silenzio — nessun richiamo forzato'
  }
}

/**
 * @param {object} args
 */
function decideMove(args) {
  const { userMessage, candidates, presence, wisdom, turns } = args
  const text = normalize(userMessage)
  const top = candidates[0] || null
  const asstCount = turns.filter((t) => t.role === 'assistant').length

  if (!top || asstCount < 1 || GOODBYE.test(text) || presence?.need === 'memorable_close') {
    return { move: /** @type {MemoryFlowMove} */ ('silence'), chosen: null, reasons: ['no_weave'] }
  }

  if (SHORT_REACT.test(text) && !CONTINUE.test(text) && !CALLBACK.test(text)) {
    // Short ack: only weave if strong overlap + continue energy
    if (top.score < 4.2) {
      return { move: /** @type {MemoryFlowMove} */ ('silence'), chosen: null, reasons: ['short_silence'] }
    }
  }

  if (presence?.preferBrevity || wisdom?.stance === 'hold_back') {
    if (top.score < 4.5 && !CALLBACK.test(text)) {
      return { move: /** @type {MemoryFlowMove} */ ('silence'), chosen: null, reasons: ['brevity_silence'] }
    }
  }

  // Threshold: don't dump
  if (top.score < 3.1 && !CALLBACK.test(text) && !CONTINUE.test(text)) {
    return { move: /** @type {MemoryFlowMove} */ ('silence'), chosen: null, reasons: ['low_relevance'] }
  }

  if (top.kind === 'progress' || CONTINUE.test(text)) {
    return {
      move: /** @type {MemoryFlowMove} */ ('notice_progress'),
      chosen: top,
      reasons: ['progress', `score_${top.score}`],
    }
  }

  if (CALLBACK.test(text) || top.score >= 4.0) {
    return {
      move: /** @type {MemoryFlowMove} */ ('connect_across_time'),
      chosen: top,
      reasons: ['connect', `score_${top.score}`],
    }
  }

  return {
    move: /** @type {MemoryFlowMove} */ ('weave_soft'),
    chosen: top,
    reasons: ['weave_soft', `score_${top.score}`],
  }
}

/**
 * @param {object} bits
 */
function buildBrief(bits) {
  const { move, chosen, presence, wisdom, memoryMap } = bits
  if (move === 'silence' || !chosen) {
    return [
      'CONVERSATION MEMORY FLOW (prima del Writer): silenzio sul richiamo.',
      'Niente dump di memorie. Niente “Come hai detto tre settimane fa…”.',
      'Se non è spontaneo e pertinente, non forzare il passato nel presente.',
      'Non citare lo stage.',
    ].join(' ')
  }

  return [
    'CONVERSATION MEMORY FLOW (dopo Taste / Memory Map, prima del Writer): tessi il passato con naturalezza.',
    `Mossa: ${moveLabel(move)} (${move}).`,
    `Filo da tessere: «${chosen.thread}» (${chosen.kind}).`,
    `Bridge: ${chosen.bridge}`,
    'Feel: «It remembers me because it was paying attention.» — non un database.',
    'Frasi spontanee OK: “The last time we talked about this, we were looking at it from another angle…” / “This reminds me of something we discussed before…” / equivalenti naturali in italiano.',
    'VIETATO: “As you said three weeks ago…”, log meccanici, elenchi di memorie, citazioni da archivio.',
    'Al massimo UN richiamo breve — mai dump. Solo se illumina il turno attuale.',
    memoryMap?.activeTopic ? `Active topic in map: ${memoryMap.activeTopic}.` : '',
    presence?.need ? `Presence need=${presence.need}.` : '',
    wisdom?.stance ? `Wisdom stance=${wisdom.stance}.` : '',
    'Non inventare ricordi. Non citare lo stage.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * @param {ConversationMemoryFlowPlan | null | undefined} plan
 * @returns {string[]}
 */
export function conversationMemoryFlowStructureHints(plan) {
  if (!plan?.active) return []
  if (!plan.shouldWeave || plan.move === 'silence') {
    return [
      'Conversation Memory Flow → silence (niente dump)',
      'Non forzare richiami; spontaneo o niente',
    ]
  }
  return [
    `Conversation Memory Flow → ${moveLabel(plan.move)}`,
    plan.chosen ? `Filo: ${plan.chosen.thread.slice(0, 64)}` : 'Tessitura soft',
    'Richiamo spontaneo · mai “As you said three weeks ago…”',
    'Un solo ponte naturale — non un elenco di memorie',
  ]
}

/**
 * @param {object} [input]
 * @returns {ConversationMemoryFlowPlan}
 */
export function buildConversationMemoryFlowPlan(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const memoryMap =
    input.conversationMemoryMap ||
    input.memoryMap ||
    input.session?.conversationMemoryMap ||
    null
  const session = input.session || null
  const presence = input.presence?.plan || input.presence || null
  const wisdom = input.wisdom?.plan || input.wisdom || null

  if (!userMessage) {
    return {
      active: false,
      move: 'silence',
      chosen: null,
      candidates: [],
      shouldWeave: false,
      naturalPhrases: NATURAL,
      forbiddenPhrases: FORBIDDEN,
      confidence: 'low',
      writerBrief: '',
      structureLine: null,
      responseHints: [],
      reasons: ['empty'],
      signals: ['empty'],
    }
  }

  const candidates = collectCandidates({
    userMessage,
    memoryMap,
    session,
    turns,
  })
  const decided = decideMove({
    userMessage,
    candidates,
    presence,
    wisdom,
    turns,
  })

  const shouldWeave = decided.move !== 'silence' && Boolean(decided.chosen)
  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (shouldWeave && decided.chosen && decided.chosen.score >= 4.2) confidence = 'high'
  else if (!shouldWeave) confidence = candidates.length ? 'medium' : 'low'

  const writerBrief = buildBrief({
    move: decided.move,
    chosen: decided.chosen,
    presence,
    wisdom,
    memoryMap,
  })

  return {
    active: true,
    move: decided.move,
    chosen: decided.chosen,
    candidates: candidates.slice(0, 4),
    shouldWeave,
    naturalPhrases: NATURAL,
    forbiddenPhrases: FORBIDDEN,
    confidence,
    writerBrief,
    structureLine: shouldWeave
      ? `Conversation Memory Flow → ${moveLabel(decided.move)}`
      : 'Conversation Memory Flow → silence (niente dump)',
    responseHints: shouldWeave
      ? [
          `Tessi «${decided.chosen?.thread || ''}» in modo spontaneo.`,
          'Un solo ponte naturale — zero dump.',
          'Mai “As you said three weeks ago…” / log meccanici.',
          'Feel: paying attention, not retrieving records.',
        ]
      : [
          'Nessun richiamo forzato questo turno.',
          'Silenzio > dump. Spontaneo o niente.',
        ],
    reasons: [
      `move_${decided.move}`,
      shouldWeave ? 'weave' : 'silence',
      ...(decided.reasons || []).slice(0, 3),
      memoryMap ? 'has_map' : 'no_map',
      turns.length > 2 ? 'has_history' : 'fresh',
    ],
    signals: [
      decided.move,
      shouldWeave ? 'weave' : 'silence',
      decided.chosen?.kind || 'none',
      ...(decided.chosen?.reasons || []),
    ].slice(0, 6),
  }
}

/**
 * @param {ConversationMemoryFlowPlan | null | undefined} plan
 */
export function formatConversationMemoryFlowForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')
  const cands =
    plan.candidates?.length > 0
      ? plan.candidates
          .slice(0, 3)
          .map((c) => `- ${c.kind}: ${c.thread.slice(0, 48)} (${c.score})`)
          .join('\n')
      : '- (none)'
  return `══════════════════════════════════════
CONVERSATION MEMORY FLOW (PRE-WRITER)
══════════════════════════════════════
Move=${plan.move} · Weave=${plan.shouldWeave ? 'yes' : 'no'} · Confidence=${plan.confidence}
${plan.chosen ? `Chosen: [${plan.chosen.kind}] ${plan.chosen.thread}` : 'Chosen: (silence)'}

${plan.writerBrief}

Candidates:
${cands}

Natural (examples, not templates to paste):
${(plan.naturalPhrases || []).slice(0, 3).map((p) => `- ${p}`).join('\n')}

Forbidden:
${(plan.forbiddenPhrases || []).slice(0, 3).map((p) => `- ${p}`).join('\n')}

Hints:
${hints}

Regole: spontaneo > meccanico · un richiamo max · mai dump · non inventare ricordi · non citare lo stage.`.trim()
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationMemoryFlowPlan, context: string }}
 */
export function runConversationMemoryFlow(input = {}) {
  try {
    const plan = buildConversationMemoryFlowPlan(input)
    return {
      plan,
      context: formatConversationMemoryFlowForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        move: 'silence',
        chosen: null,
        candidates: [],
        shouldWeave: false,
        naturalPhrases: NATURAL,
        forbiddenPhrases: FORBIDDEN,
        confidence: 'low',
        writerBrief: '',
        structureLine: null,
        responseHints: [],
        reasons: ['fail_soft'],
        signals: ['fail_soft'],
      },
      context: '',
    }
  }
}
