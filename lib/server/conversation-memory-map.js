/**
 * LAIfe Conversation Memory Map
 *
 * Instead of relying only on previous messages, track a living map of the chat:
 *   - explored topics
 *   - unanswered questions
 *   - ongoing projects
 *   - user's goals
 *   - explanations already given
 *   - misconceptions already corrected
 *   - future ideas introduced
 *
 * The map evolves during the conversation.
 * The assistant should avoid repeating ideas already explored.
 * When continuing a discussion, use the map — not message history alone.
 *
 * Session-scoped. Fail-soft. Invisible.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {object} ConversationMemoryMap
 * @property {string[]} exploredTopics
 * @property {string[]} unansweredQuestions
 * @property {string[]} ongoingProjects
 * @property {string[]} userGoals
 * @property {string[]} explanationsGiven
 * @property {string[]} misconceptionsCorrected
 * @property {string[]} futureIdeasIntroduced
 * @property {string | null} activeTopic
 * @property {number} updatedAt
 * @property {number} turnCount
 * @property {string} writerBrief
 */

const MAX_TOPICS = 12
const MAX_QUESTIONS = 8
const MAX_PROJECTS = 6
const MAX_GOALS = 6
const MAX_EXPLAINED = 10
const MAX_MISCONCEPTIONS = 6
const MAX_FUTURE = 6
const MAX_ITEM_LEN = 96

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
 * @param {number} [max]
 */
function clip(text, max = MAX_ITEM_LEN) {
  const t = normalize(text)
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
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
 * Deduplicate case-insensitively; keep last N.
 * @param {string[]} items
 * @param {number} max
 */
function uniqCap(items, max) {
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  for (const raw of items) {
    const t = clip(raw)
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out.slice(-max)
}

/**
 * @param {string[]} prior
 * @param {string[]} fresh
 * @param {number} max
 */
function mergeLists(prior, fresh, max) {
  return uniqCap([...(Array.isArray(prior) ? prior : []), ...(Array.isArray(fresh) ? fresh : [])], max)
}

/**
 * @param {string[]} questions
 * @param {ChatTurn[]} turns
 * @param {string} userMessage
 */
function pruneAnsweredQuestions(questions, turns, userMessage) {
  const blob = `${turns
    .slice(-6)
    .map((t) => t.content)
    .join('\n')}\n${userMessage}`.toLowerCase()
  return questions.filter((q) => {
    const tokens = normalize(q)
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 4)
    if (tokens.length === 0) return true
    const hits = tokens.filter((w) => blob.includes(w)).length
    return hits < Math.ceil(tokens.length * 0.75)
  })
}

/**
 * @param {string} text
 */
function extractTopicCandidates(text) {
  const t = normalize(text)
  if (!t || t.length < 3) return []
  /** @type {string[]} */
  const out = []

  const about = t.match(
    /\b(?:su|sul|sulla|about|regarding|circa)\s+([a-zàèéìòù0-9][\wàèéìòù\s-]{2,40})/i,
  )
  if (about?.[1]) out.push(about[1])

  const explain = t.match(
    /\b(?:spiegami|spiega|explain|cos['’]?è|what\s+is|come\s+funziona|how\s+does)\s+(.+)$/i,
  )
  if (explain?.[1]) out.push(explain[1].replace(/[?.!].*$/, ''))

  if (out.length === 0 && t.length <= 80 && !/^(ok|ciao|grazie|thanks|yes|no|sì|continua|continue|capito|interessante)\b/i.test(t)) {
    out.push(t.replace(/[?!]+$/, ''))
  }

  return out
    .map((x) => clip(x, 64))
    .filter((x) => x && !/^(continua|continue|ok|ciao|grazie|thanks)$/i.test(x))
}

/**
 * @param {ChatTurn[]} assistantTurns
 */
function extractExplanations(assistantTurns) {
  /** @type {string[]} */
  const out = []
  for (const turn of assistantTurns.slice(-6)) {
    const lines = turn.content.split(/\n+/).map((l) => l.trim()).filter(Boolean)
    for (const line of lines.slice(0, 8)) {
      if (/^#{1,3}\s+\S/.test(line) || /^\d+[\).]\s+\S/.test(line) || /^\*\*[^*]+\*\*/.test(line)) {
        out.push(
          clip(
            line
              .replace(/^#+\s*/, '')
              .replace(/^\*\*|\*\*$/g, '')
              .replace(/^\d+[\).]\s*/, ''),
          ),
        )
      }
    }
    const first = turn.content.match(/^(.{40,120}?[.!?])/m)
    if (first?.[1] && !/[?]/.test(first[1])) out.push(clip(first[1]))
  }
  return uniqCap(out, MAX_EXPLAINED)
}

/**
 * @param {ChatTurn[]} assistantTurns
 */
function extractUnanswered(assistantTurns) {
  /** @type {string[]} */
  const out = []
  for (const turn of assistantTurns.slice(-4)) {
    const parts = turn.content.split(/(?<=[?？])\s+/)
    for (const p of parts) {
      const q = normalize(p)
      if (!q.endsWith('?') && !q.endsWith('？')) continue
      if (q.length < 12 || q.length > 140) continue
      if (/anything else|posso aiutarti|hai altre domande|let me know/i.test(q)) continue
      out.push(clip(q))
    }
  }
  return uniqCap(out, MAX_QUESTIONS)
}

/**
 * @param {ChatTurn[]} assistantTurns
 */
function extractMisconceptions(assistantTurns) {
  /** @type {string[]} */
  const out = []
  const cue =
    /\b(non\s+[eè]\s+vero\s+che|a\s+differenza\s+di\s+quanto\s+si\s+pensa|common\s+misconception|myth\s*:|si\s+pensa\s+spesso\s+che|molti\s+credono\s+che|contrary\s+to\s+(popular\s+)?belief|in\s+realt[aà]\s+non)\b/i
  for (const turn of assistantTurns.slice(-5)) {
    if (!cue.test(turn.content)) continue
    const sentences = turn.content.split(/(?<=[.!?])\s+/)
    for (const s of sentences) {
      if (cue.test(s) || /\b(in\s+realt[aà]|instead|anzi)\b/i.test(s)) {
        out.push(clip(s))
        break
      }
    }
  }
  return uniqCap(out, MAX_MISCONCEPTIONS)
}

/**
 * @param {ChatTurn[]} assistantTurns
 */
function extractFutureIdeas(assistantTurns) {
  /** @type {string[]} */
  const out = []
  const cue =
    /\b(in\s+futuro|un\s+giorno|next\s+(step|time|you\s+could)|potresti\s+(poi|dopo)|quando\s+vorrai|pi[uù]\s+avanti|interesting\s+aside|ecco\s+una\s+cosa\s+interessante|un['’]?altra\s+direzione|we\s+could\s+(also|later)|implicazione\s+futura)\b/i
  for (const turn of assistantTurns.slice(-5)) {
    if (!cue.test(turn.content)) continue
    const sentences = turn.content.split(/(?<=[.!?])\s+/)
    for (const s of sentences) {
      if (cue.test(s)) {
        out.push(clip(s))
        break
      }
    }
  }
  return uniqCap(out, MAX_FUTURE)
}

/**
 * @param {ChatTurn[]} userTurns
 * @param {string} userMessage
 */
function extractProjectsAndGoals(userTurns, userMessage) {
  /** @type {string[]} */
  const projects = []
  /** @type {string[]} */
  const goals = []
  const pool = [...userTurns.slice(-8).map((t) => t.content), userMessage]
  for (const text of pool) {
    const t = normalize(text)
    if (/\b(progetto|project|sto\s+(costruend|lavorand|svilupp)|building|working\s+on)\b/i.test(t)) {
      projects.push(clip(t, 80))
    }
    const goal =
      t.match(
        /\b(?:voglio|vorrei|obiettivo|goal|mi\s+serve|need\s+to|i\s+want\s+to|i'?m\s+trying\s+to)\s+(.{5,70})/i,
      ) || t.match(/\b(?:devo|need\s+to)\s+(.{5,60})/i)
    if (goal?.[1]) goals.push(clip(goal[1].replace(/[?.!].*$/, ''), 72))
  }
  return {
    projects: uniqCap(projects, MAX_PROJECTS),
    goals: uniqCap(goals, MAX_GOALS),
  }
}

/**
 * Sanitize a prior map from the client.
 * @param {unknown} raw
 * @returns {Partial<ConversationMemoryMap> | null}
 */
export function sanitizeConversationMemoryMap(raw) {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)
  const list = (v) =>
    Array.isArray(v)
      ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => clip(String(x)))
      : []
  return {
    exploredTopics: list(o.exploredTopics),
    unansweredQuestions: list(o.unansweredQuestions),
    ongoingProjects: list(o.ongoingProjects),
    userGoals: list(o.userGoals),
    explanationsGiven: list(o.explanationsGiven),
    misconceptionsCorrected: list(o.misconceptionsCorrected),
    futureIdeasIntroduced: list(o.futureIdeasIntroduced),
    activeTopic: typeof o.activeTopic === 'string' ? clip(o.activeTopic, 64) : null,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : 0,
    turnCount: typeof o.turnCount === 'number' ? o.turnCount : 0,
  }
}

/**
 * Empty map.
 * @returns {ConversationMemoryMap}
 */
export function emptyConversationMemoryMap() {
  return {
    exploredTopics: [],
    unansweredQuestions: [],
    ongoingProjects: [],
    userGoals: [],
    explanationsGiven: [],
    misconceptionsCorrected: [],
    futureIdeasIntroduced: [],
    activeTopic: null,
    updatedAt: Date.now(),
    turnCount: 0,
    writerBrief: '',
  }
}

/**
 * Build / evolve the Conversation Memory Map for this turn.
 * @param {object} input
 * @param {string} [input.userMessage]
 * @param {ChatTurn[]} [input.messages]
 * @param {Partial<ConversationMemoryMap> | null} [input.priorMap]
 * @param {{
 *   currentTopic?: string,
 *   alreadyExplained?: string[],
 *   openQuestions?: string[],
 *   currentGoal?: string,
 * } | null} [input.shortTerm]
 * @returns {ConversationMemoryMap}
 */
export function evolveConversationMemoryMap(input = {}) {
  const userMessage = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const prior = sanitizeConversationMemoryMap(input.priorMap) || {}
  const stm = input.shortTerm || null

  const userTurns = turns.filter((t) => t.role === 'user')
  const assistantTurns = turns.filter((t) => t.role === 'assistant')

  const topicFresh = [
    ...(stm?.currentTopic && stm.currentTopic !== 'generale' ? [stm.currentTopic] : []),
    ...extractTopicCandidates(userMessage),
    ...userTurns.slice(-3).flatMap((t) => extractTopicCandidates(t.content)),
  ]

  const { projects, goals } = extractProjectsAndGoals(userTurns, userMessage)
  if (stm?.currentGoal) goals.push(clip(stm.currentGoal, 72))

  let unanswered = mergeLists(
    prior.unansweredQuestions || [],
    [...(stm?.openQuestions || []), ...extractUnanswered(assistantTurns)],
    MAX_QUESTIONS + 4,
  )
  unanswered = pruneAnsweredQuestions(unanswered, turns, userMessage).slice(-MAX_QUESTIONS)

  /** @type {ConversationMemoryMap} */
  const map = {
    exploredTopics: mergeLists(prior.exploredTopics || [], topicFresh, MAX_TOPICS),
    unansweredQuestions: unanswered,
    ongoingProjects: mergeLists(prior.ongoingProjects || [], projects, MAX_PROJECTS),
    userGoals: mergeLists(prior.userGoals || [], goals, MAX_GOALS),
    explanationsGiven: mergeLists(
      prior.explanationsGiven || [],
      [...(stm?.alreadyExplained || []), ...extractExplanations(assistantTurns)],
      MAX_EXPLAINED,
    ),
    misconceptionsCorrected: mergeLists(
      prior.misconceptionsCorrected || [],
      extractMisconceptions(assistantTurns),
      MAX_MISCONCEPTIONS,
    ),
    futureIdeasIntroduced: mergeLists(
      prior.futureIdeasIntroduced || [],
      extractFutureIdeas(assistantTurns),
      MAX_FUTURE,
    ),
    activeTopic:
      (stm?.currentTopic && stm.currentTopic !== 'generale' ? clip(stm.currentTopic, 64) : null) ||
      prior.activeTopic ||
      topicFresh[0] ||
      null,
    updatedAt: Date.now(),
    turnCount: Math.max(prior.turnCount || 0, userTurns.length + (userMessage ? 1 : 0)),
    writerBrief: '',
  }

  map.writerBrief = buildWriterBrief(map)
  return map
}

/**
 * @param {ConversationMemoryMap} map
 */
function buildWriterBrief(map) {
  const lines = [
    'CONVERSATION MEMORY MAP: usa questa mappa al posto di rileggere solo lo storico grezzo.',
    'Evolvi con la chat. NON ripetere idee già esplorate. Quando continui, parti dalla mappa.',
  ]
  if (map.activeTopic) lines.push(`Topic attivo: ${map.activeTopic}.`)
  if (map.exploredTopics.length) {
    lines.push(`Temi già esplorati (non ripetere da zero): ${map.exploredTopics.slice(-6).join(' · ')}.`)
  }
  if (map.explanationsGiven.length) {
    lines.push(
      `Spiegazioni già date (richiamo breve al massimo): ${map.explanationsGiven.slice(-5).join(' · ')}.`,
    )
  }
  if (map.misconceptionsCorrected.length) {
    lines.push(
      `Misconcezioni già corrette (non ribattere): ${map.misconceptionsCorrected.slice(-4).join(' · ')}.`,
    )
  }
  if (map.unansweredQuestions.length) {
    lines.push(
      `Domande ancora aperte (solo se ancora rilevanti): ${map.unansweredQuestions.slice(-4).join(' · ')}.`,
    )
  }
  if (map.userGoals.length) {
    lines.push(`Obiettivi utente: ${map.userGoals.slice(-4).join(' · ')}.`)
  }
  if (map.ongoingProjects.length) {
    lines.push(`Progetti in corso: ${map.ongoingProjects.slice(-3).join(' · ')}.`)
  }
  if (map.futureIdeasIntroduced.length) {
    lines.push(
      `Idee future già introdotte (non ripresentarle come nuove): ${map.futureIdeasIntroduced.slice(-4).join(' · ')}.`,
    )
  }
  return lines.join(' ')
}

/**
 * @param {ConversationMemoryMap | null | undefined} map
 */
export function formatConversationMemoryMapForWriter(map) {
  if (!map) return ''

  const bullet = (arr, empty) =>
    arr?.length ? arr.map((x) => `- ${x}`).join('\n') : `- (${empty})`

  return `══════════════════════════════════════
CONVERSATION MEMORY MAP (INVISIBILE)
══════════════════════════════════════
Mappa viva della conversazione — usala quando continui; non basarti solo sullo storico messaggi.
Evita di ripetere idee già esplorate.

Topic attivo: ${map.activeTopic || '(nessuno)'}
Turni mappa: ${map.turnCount}

Temi esplorati:
${bullet(map.exploredTopics, 'nessuno ancora')}

Domande senza risposta:
${bullet(map.unansweredQuestions, 'nessuna')}

Progetti in corso:
${bullet(map.ongoingProjects, 'nessuno')}

Obiettivi utente:
${bullet(map.userGoals, 'nessuno fissato')}

Spiegazioni già date:
${bullet(map.explanationsGiven, 'nessuna')}

Misconcezioni già corrette:
${bullet(map.misconceptionsCorrected, 'nessuna')}

Idee future già introdotte:
${bullet(map.futureIdeasIntroduced, 'nessuna')}

${map.writerBrief}
Non citare questa mappa all’utente.`.trim()
}

/**
 * Overlay map fields onto short-term session for downstream engines.
 * @param {object} session
 * @param {ConversationMemoryMap} map
 */
export function applyMemoryMapToSession(session, map) {
  if (!session || !map) return session
  const explained = mergeLists(session.alreadyExplained || [], map.explanationsGiven, MAX_EXPLAINED)
  const open = mergeLists(session.openQuestions || [], map.unansweredQuestions, MAX_QUESTIONS)
  session.alreadyExplained = explained
  session.openQuestions = open
  session.memoryMap = {
    exploredTopics: [...map.exploredTopics],
    misconceptionsCorrected: [...map.misconceptionsCorrected],
    futureIdeasIntroduced: [...map.futureIdeasIntroduced],
    ongoingProjects: [...map.ongoingProjects],
    userGoals: [...map.userGoals],
  }
  return session
}

/**
 * @param {object} input
 * @returns {{ map: ConversationMemoryMap, context: string }}
 */
export function runConversationMemoryMap(input = {}) {
  try {
    const map = evolveConversationMemoryMap(input)
    return {
      map,
      context: formatConversationMemoryMapForWriter(map),
    }
  } catch {
    const map = emptyConversationMemoryMap()
    return { map, context: '' }
  }
}
