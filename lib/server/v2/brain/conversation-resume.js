/**
 * LAIfe V2 — Conversation Resume Engine (experimental)
 *
 * Pure offline summarizer of the *current* chat history.
 *
 * - Does NOT use durable / permanent memory
 * - Does NOT recall facts outside the provided messages
 * - Does NOT call LLMs
 * - Pipeline may call this before Planner; Planner decides whether to use it
 *
 * Input:
 *   - messages: [{ role, content }, ...]  (current conversation only)
 *
 * Output:
 *   {
 *     currentTopic: string|null,
 *     currentGoal: string|null,
 *     progress: string[],
 *     unresolvedQuestions: string[],
 *     importantDecisions: string[],
 *     emotionalContext: string|null,
 *     suggestedResumeSentence: string,  // max 2 sentences
 *     confidence: number,               // 0..1 operational confidence
 *   }
 */

export const CONVERSATION_RESUME_VERSION = '0.2.0-conversation-resume'

/**
 * @typedef {object} ChatMessage
 * @property {string} [role]
 * @property {string} [content]
 */

/**
 * @typedef {object} ConversationResume
 * @property {string|null} currentTopic
 * @property {string|null} currentGoal
 * @property {string[]} progress
 * @property {string[]} unresolvedQuestions
 * @property {string[]} importantDecisions
 * @property {string|null} emotionalContext
 * @property {string} suggestedResumeSentence
 * @property {number} confidence
 */

/**
 * @typedef {object} ConversationResumeInput
 * @property {ChatMessage[]} [messages]
 */

const STOPWORDS = new Set([
  'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'uno', 'di', 'a', 'da', 'in', 'con', 'su', 'per',
  'tra', 'fra', 'the', 'and', 'or', 'to', 'of', 'is', 'are', 'am', 'be', 'was', 'were', 'a', 'an',
  'che', 'chi', 'cosa', 'non', 'mi', 'ti', 'ci', 'vi', 'si', 'ho', 'hai', 'ha', 'hanno', 'sono',
  'sei', 'siamo', 'come', 'what', 'how', 'why', 'when', 'where', 'which', 'this', 'that', 'with',
  'from', 'your', 'you', 'me', 'my', 'our', 'we', 'they', 'them', 'ciao', 'hey', 'hello', 'ok',
  'okay', 'yes', 'no', 'si', 'sì', 'del', 'della', 'dei', 'delle', 'degli', 'nel', 'nella',
  'nei', 'nelle', 'al', 'alla', 'ai', 'alle', 'dal', 'dalla', 'dai', 'dalle', 'perché', 'perche',
  'about', 'into', 'just', 'very', 'also', 'ancora', 'poi', 'già', 'qui', 'qua', 'più', 'meno',
  'una', 'uno', 'degli', 'delle', 'questo', 'questa', 'quello', 'quella', 'essere', 'avere',
  'fare', 'dire', 'stare', 'vorrei', 'voglio', 'posso', 'puoi', 'please', 'grazie', 'thanks',
])

const GOAL_CUES =
  /\b(obiettivo|goal|voglio|vorrei|rendere|migliorare|creare|costruire|finisci|completare|serve|dobbiamo|let'?s|need to|want to|trying to|aim(?:ing)? to)\b/i

const PROGRESS_CUES =
  /\b(completato|fatto|aggiunto|implementato|finito|done|completed|added|shipped|merged|risolto|fixed|pronto|ready)\b/i

const DECISION_CUES =
  /\b(decid\w*|scelt\w*|non (?:dobbiamo|vogliamo|modificare|toccare)|evitare|prefer\w*|instead|from now|d['’]?ora in poi|regola|vincolo|must not|do not|niente più|mai più|passar(?:e|emo|iamo)\s+all?[aeo]?|da ora|priorit[aà])\b/i

const EMOTION_CUES = [
  { re: /\b(triste|tristezza|piango|down|sad|heartbroken)\b/i, label: 'tristezza' },
  { re: /\b(ansia|ansios\w*|paura|worried|anxious|stress)\b/i, label: 'ansia' },
  { re: /\b(felice|contento|entusias\w*|excited|happy|joy)\b/i, label: 'entusiasmo' },
  { re: /\b(frustrat\w*|arrabbiat\w*|irritat\w*|angry|frustrated)\b/i, label: 'frustrazione' },
  { re: /\b(stanco|esaust\w*|tired|overwhelmed)\b/i, label: 'stanchezza' },
  { re: /\b(confus\w*|perso|unclear|confused)\b/i, label: 'confusione' },
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
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function clip(text, max = 120) {
  const t = asString(text).replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(0, max - 1))}…`
}

/**
 * @param {unknown} messages
 * @returns {ChatMessage[]}
 */
export function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return []
  /** @type {ChatMessage[]} */
  const out = []
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue
    const role = asString(/** @type {any} */ (m).role).toLowerCase()
    const content = asString(/** @type {any} */ (m).content).trim()
    if (!content) continue
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue
    out.push({ role, content })
  }
  return out
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractContentTokens(text) {
  const raw = asString(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  const parts = raw.match(/[a-z0-9]{3,}/g) || []
  /** @type {string[]} */
  const out = []
  for (const p of parts) {
    if (STOPWORDS.has(p)) continue
    if (!out.includes(p)) out.push(p)
  }
  return out
}

/**
 * Rank noun-like / content phrases from recent user turns as topic candidates.
 * @param {ChatMessage[]} messages
 * @returns {string|null}
 */
export function inferCurrentTopic(messages) {
  const list = normalizeMessages(messages)
  if (!list.length) return null

  /** @type {Map<string, number>} */
  const scores = new Map()
  const recent = list.slice(-8)
  recent.forEach((m, idx) => {
    const weight = m.role === 'user' ? 1.4 : 0.8
    const recency = 0.6 + (idx / Math.max(1, recent.length - 1)) * 0.4
    for (const tok of extractContentTokens(m.content || '')) {
      scores.set(tok, (scores.get(tok) || 0) + weight * recency)
    }
  })

  // Prefer multi-word topical fragments from the latest substantive user line.
  let latestUser = ''
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].role !== 'user') continue
    const c = asString(list[i].content).trim()
    if (c.length < 8) continue
    if (/^(ok|okay|esatto|certo|perfetto|sì|si|yes)[.!]*$/i.test(c)) continue
    if (/^(decisione|regola|vincolo)\s*:/i.test(c)) continue
    if (/\?\s*$/.test(c)) continue
    if (
      /\b(riprendiamo|riprendere|da dove (?:avevamo|eravamo) lasciato|where we left)\b/i.test(c) &&
      wordCount(c) <= 12
    ) {
      continue
    }
    // Skip pure progress acknowledgements when seeking a topic label.
    if (PROGRESS_CUES.test(c) && !GOAL_CUES.test(c) && wordCount(c) <= 12) continue
    latestUser = c
    break
  }

  if (latestUser) {
    const about = latestUser.match(
      /\b((?:sviluppo|lavoro|progetto|tema|topic)\s+(?:di|su|sul|sulla|del|della)\s+[A-ZÁÉÍÓÚÀÈÌÒÙa-záéíóúàèìòù][\wÁÉÍÓÚÀÈÌÒÙáéíóúàèìòù-]{1,40})/i,
    )
    if (about) {
      return clip(about[1].replace(/\s+/g, ' ').trim(), 80)
    }

    // Strip leading goal verbs for a cleaner topic label when possible.
    const cleaned = latestUser
      .replace(/^[^.?!]{0,40}\b(su|sul|sulla|about|regarding)\s+/i, '')
      .replace(/^(parliamo di|lavoriamo su|stiamo (?:facendo|lavorando) (?:su|a)|working on)\s+/i, '')
      .replace(/^(l['’]?obiettivo(?:\s+è)?|obiettivo[:\s]+|goal[:\s]+|voglio|vorrei)\s+/i, '')
      .trim()
    const topicish = cleaned.match(
      /\b(?:[A-ZÁÉÍÓÚÀÈÌÒÙ][\wÁÉÍÓÚÀÈÌÒÙáéíóúàèìòù-]{2,}(?:\s+[A-ZÁÉÍÓÚÀÈÌÒÙa-záéíóúàèìòù-]{2,}){0,4})\b/,
    )
    if (topicish && !/^(Decisione|Regola|Vincolo|Quando|Come|Cosa|Perché)$/i.test(topicish[0])) {
      return clip(topicish[0], 80)
    }

    const tokens = extractContentTokens(cleaned).slice(0, 5)
    if (tokens.length >= 2) return tokens.join(' ')
    if (tokens.length === 1) return tokens[0]
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])
  if (!ranked.length) return null
  return ranked
    .slice(0, 4)
    .map(([t]) => t)
    .join(' ')
}

/**
 * @param {ChatMessage[]} messages
 * @returns {string|null}
 */
export function inferCurrentGoal(messages) {
  const list = normalizeMessages(messages)
  /** @type {string[]} */
  const candidates = []
  for (const m of list) {
    // Prefer explicit user intent; assistant text is too noisy for goals.
    if (m.role !== 'user') continue
    const content = asString(m.content).trim()
    if (!GOAL_CUES.test(content)) continue

    const match = content.match(
      /(?:l['’]?obiettivo(?:\s+è)?\s*|obiettivo[:\s]+(?:è\s+)?|goal[:\s]+|voglio\s+|vorrei\s+|need to\s+|want to\s+|trying to\s+|aim(?:ing)? to\s+)([^.!?\n]{6,100})/i,
    )
    if (match && match[1]) {
      candidates.push(clip(match[1].replace(/^(è|is|to)\s+/i, ''), 100))
      continue
    }

    const action = content.match(
      /\b((?:rendere|migliorare|creare|costruire|completare)\s+[^.!?\n]{4,90})/i,
    )
    if (action && action[1]) {
      candidates.push(clip(action[1], 100))
    }
  }
  if (!candidates.length) return null
  return candidates[candidates.length - 1]
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeProgressItem(text) {
  let t = asString(text).replace(/\s+/g, ' ').trim()
  t = t.replace(/^[-*•\d.)\s]+/, '')
  // Prefer compact "X completato/aggiunto" style
  const m = t.match(
    /\b([A-ZÁÉÍÓÚÀÈÌÒÙa-záéíóúàèìòù][\wÁÉÍÓÚÀÈÌÒÙáéíóúàèìòù. -]{2,60}?)\s+(completato|aggiunto|implementato|finito|fatto|done|completed|added|fixed|risolto)\b/i,
  )
  if (m) {
    const name = m[1].trim().replace(/^[Oo]k\.?\s+/i, '')
    const verb = m[2].toLowerCase()
    const map = {
      completato: 'completato',
      aggiunto: 'aggiunto',
      implementato: 'implementato',
      finito: 'completato',
      fatto: 'completato',
      done: 'completato',
      completed: 'completato',
      added: 'aggiunto',
      fixed: 'risolto',
      risolto: 'risolto',
    }
    return clip(`${name} ${map[verb] || verb}`, 100)
  }
  return clip(t, 100)
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractProgressItems(text) {
  const t = asString(text)
  /** @type {string[]} */
  const out = []
  const re =
    /\b([A-ZÁÉÍÓÚÀÈÌÒÙa-záéíóúàèìòù][\wÁÉÍÓÚÀÈÌÒÙáéíóúàèìòù. -]{2,60}?)\s+(completato|aggiunto|implementato|finito|fatto|done|completed|added|fixed|risolto)\b/gi
  let match
  while ((match = re.exec(t)) !== null) {
    const name = match[1].trim().replace(/^[Oo]k\.?\s+/i, '')
    const verb = match[2].toLowerCase()
    const map = {
      completato: 'completato',
      aggiunto: 'aggiunto',
      implementato: 'implementato',
      finito: 'completato',
      fatto: 'completato',
      done: 'completato',
      completed: 'completato',
      added: 'aggiunto',
      fixed: 'risolto',
      risolto: 'risolto',
    }
    const item = clip(`${name} ${map[verb] || verb}`, 100)
    if (item && !out.includes(item)) out.push(item)
  }
  if (!out.length && PROGRESS_CUES.test(t)) {
    const item = normalizeProgressItem(t)
    if (item) out.push(item)
  }
  return out
}

/**
 * @param {ChatMessage[]} messages
 * @returns {string[]}
 */
export function inferProgress(messages) {
  const list = normalizeMessages(messages)
  /** @type {string[]} */
  const out = []
  for (const m of list) {
    const content = asString(m.content)
    if (!PROGRESS_CUES.test(content)) continue
    const chunks = content.split(/\n+|;\s+|•\s+|(?<=[.!?])\s+/).map((c) => c.trim()).filter(Boolean)
    for (const chunk of chunks) {
      if (!PROGRESS_CUES.test(chunk)) continue
      for (const item of extractProgressItems(chunk)) {
        if (!out.includes(item)) out.push(item)
      }
    }
  }
  return out.slice(-8)
}

/**
 * Unanswered user questions still near the end of the thread.
 * @param {ChatMessage[]} messages
 * @returns {string[]}
 */
export function inferUnresolvedQuestions(messages) {
  const list = normalizeMessages(messages)
  /** @type {string[]} */
  const unresolved = []

  for (let i = 0; i < list.length; i += 1) {
    const m = list[i]
    if (m.role !== 'user') continue
    const content = asString(m.content).trim()
    const isQuestion =
      /\?\s*$/.test(content) ||
      /^(come|cosa|perché|perche|quando|dove|chi|what|why|how|when|where|which)\b/i.test(content)
    if (!isQuestion) continue

    // Consider resolved if a later assistant message exists that is not itself only a question
    // and appears before the next user turn — simple heuristic.
    let resolved = false
    for (let j = i + 1; j < list.length; j += 1) {
      if (list[j].role === 'user') break
      if (list[j].role === 'assistant') {
        const a = asString(list[j].content).trim()
        if (a && !/^\?\s*$/.test(a) && wordCount(a) >= 3) {
          resolved = true
          break
        }
      }
    }
    if (!resolved) {
      const q = clip(content, 140)
      if (!unresolved.includes(q)) unresolved.push(q)
    }
  }
  return unresolved.slice(-5)
}

/**
 * @param {string} text
 * @returns {number}
 */
function wordCount(text) {
  const t = asString(text).trim()
  if (!t) return 0
  return t.split(/\s+/).filter(Boolean).length
}

/**
 * @param {ChatMessage[]} messages
 * @returns {string[]}
 */
export function inferImportantDecisions(messages) {
  const list = normalizeMessages(messages)
  /** @type {string[]} */
  const out = []
  for (const m of list) {
    const content = asString(m.content).trim()
    if (!DECISION_CUES.test(content)) continue
    // Keep decision-shaped clauses
    const parts = content.split(/(?<=[.!])\s+|\n+/).map((p) => p.trim()).filter(Boolean)
    for (const part of parts) {
      if (!DECISION_CUES.test(part)) continue
      const item = clip(
        part.replace(/^[-*•\d.)\s]+/, '').replace(/^(decisione|regola|vincolo)\s*:\s*/i, ''),
        120,
      )
      if (item && !out.includes(item)) out.push(item)
    }
  }
  return out.slice(-6)
}

/**
 * @param {ChatMessage[]} messages
 * @returns {string|null}
 */
export function inferEmotionalContext(messages) {
  const list = normalizeMessages(messages)
  if (!list.length) return null
  const recent = list.slice(-6)
  /** @type {Map<string, number>} */
  const hits = new Map()
  for (const m of recent) {
    const text = asString(m.content)
    for (const cue of EMOTION_CUES) {
      if (cue.re.test(text)) {
        const w = m.role === 'user' ? 2 : 1
        hits.set(cue.label, (hits.get(cue.label) || 0) + w)
      }
    }
  }
  if (!hits.size) return null
  const ranked = [...hits.entries()].sort((a, b) => b[1] - a[1])
  return ranked[0][0]
}

/**
 * Clamp a resume cue to at most two sentences.
 * @param {string} text
 * @returns {string}
 */
export function limitResumeSentence(text, maxSentences = 2) {
  const t = asString(text).replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const parts = t.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [t]
  const kept = parts
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, Math.max(1, maxSentences))
  return kept.join(' ').trim()
}

/**
 * Operational confidence for current-chat resume (not memory recall).
 * @param {Omit<ConversationResume, 'confidence'|'suggestedResumeSentence'> & { suggestedResumeSentence?: string }} resume
 * @param {ChatMessage[]} messages
 * @returns {number}
 */
export function computeResumeConfidence(resume, messages = []) {
  const list = normalizeMessages(messages)
  let c = 0.28
  if (resume?.currentTopic) c += 0.18
  if (resume?.currentGoal) c += 0.18
  if (Array.isArray(resume?.progress) && resume.progress.length) c += 0.14
  if (Array.isArray(resume?.importantDecisions) && resume.importantDecisions.length) c += 0.1
  if (resume?.emotionalContext) c += 0.04
  const assistants = list.filter((m) => m.role === 'assistant').length
  const users = list.filter((m) => m.role === 'user').length
  if (assistants >= 1) c += 0.08
  if (users >= 2) c += 0.05
  if (list.length >= 4) c += 0.04

  const sentence = asString(resume?.suggestedResumeSentence)
  if (/Non c['’]è ancora una conversazione/i.test(sentence)) c = 0
  else if (/Possiamo riprendere da dove avevamo lasciato/i.test(sentence)) c = Math.min(c, 0.45)

  return Number(Math.max(0, Math.min(0.98, c)).toFixed(3))
}

/**
 * @param {ConversationResume} resume
 * @returns {string}
 */
export function buildSuggestedResumeSentence(resume) {
  const topic = resume.currentTopic
  const goal = resume.currentGoal
  const progress = Array.isArray(resume.progress) ? resume.progress : []
  const lastProgress = progress.length ? progress[progress.length - 1] : null
  const goalIsAction = Boolean(goal && /^(rendere|migliorare|creare|costruire|completare)\b/i.test(goal))

  if (goalIsAction && lastProgress) {
    return `L'ultima volta stavamo lavorando per ${goal} e avevamo appena completato: ${lastProgress}.`
  }
  if (topic && goal && lastProgress) {
    return `L'ultima volta stavamo lavorando su ${topic} per ${goal} e avevamo appena completato: ${lastProgress}.`
  }
  if (topic && lastProgress) {
    return `L'ultima volta stavamo lavorando su ${topic} e avevamo appena completato: ${lastProgress}.`
  }
  if (goalIsAction) {
    return `L'ultima volta stavamo lavorando per ${goal}.`
  }
  if (topic && goal) {
    return `L'ultima volta stavamo lavorando su ${topic} con l'obiettivo di ${goal}.`
  }
  if (topic) {
    return `L'ultima volta stavamo parlando di ${topic}.`
  }
  if (goal) {
    return `L'ultima volta l'obiettivo era ${goal}.`
  }
  if (resume.emotionalContext) {
    return `L'ultima volta c'era un contesto emotivo di ${resume.emotionalContext}.`
  }
  return 'Possiamo riprendere da dove avevamo lasciato.'
}

/**
 * Build an operational resume of the current conversation only.
 * Pure. No I/O. No LLM.
 *
 * @param {ConversationResumeInput|ChatMessage[]} [input]
 * @returns {ConversationResume}
 */
export function resumeConversation(input = {}) {
  const messages = Array.isArray(input)
    ? normalizeMessages(input)
    : normalizeMessages(/** @type {ConversationResumeInput} */ (input).messages)

  if (!messages.length) {
    return {
      currentTopic: null,
      currentGoal: null,
      progress: [],
      unresolvedQuestions: [],
      importantDecisions: [],
      emotionalContext: null,
      suggestedResumeSentence: 'Non c\'è ancora una conversazione da riprendere.',
      confidence: 0,
    }
  }

  const currentTopic = inferCurrentTopic(messages)
  const currentGoal = inferCurrentGoal(messages)
  const progress = inferProgress(messages)
  const unresolvedQuestions = inferUnresolvedQuestions(messages)
  const importantDecisions = inferImportantDecisions(messages)
  const emotionalContext = inferEmotionalContext(messages)

  /** @type {ConversationResume} */
  const resume = {
    currentTopic,
    currentGoal,
    progress,
    unresolvedQuestions,
    importantDecisions,
    emotionalContext,
    suggestedResumeSentence: '',
    confidence: 0,
  }
  resume.suggestedResumeSentence = limitResumeSentence(buildSuggestedResumeSentence(resume), 2)
  resume.confidence = computeResumeConfidence(resume, messages)
  return resume
}

/**
 * @param {object} [config]
 */
export function createConversationResumeEngine(config = {}) {
  void config
  return {
    version: CONVERSATION_RESUME_VERSION,
    /**
     * @param {ConversationResumeInput|ChatMessage[]} input
     * @returns {ConversationResume}
     */
    resume(input) {
      return resumeConversation(input)
    },
  }
}

/**
 * @param {unknown} value
 * @returns {value is ConversationResume}
 */
export function isConversationResume(value) {
  if (!value || typeof value !== 'object') return false
  const v = /** @type {any} */ (value)
  return (
    (v.currentTopic === null || typeof v.currentTopic === 'string') &&
    (v.currentGoal === null || typeof v.currentGoal === 'string') &&
    Array.isArray(v.progress) &&
    Array.isArray(v.unresolvedQuestions) &&
    Array.isArray(v.importantDecisions) &&
    (v.emotionalContext === null || typeof v.emotionalContext === 'string') &&
    typeof v.suggestedResumeSentence === 'string' &&
    typeof v.confidence === 'number'
  )
}
