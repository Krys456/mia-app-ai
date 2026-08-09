/**
 * LAIfe Conversational Memory Engine
 *
 * Remember what happened earlier in the SAME conversation — not only the last message.
 *
 * Track:
 *   - recurring themes
 *   - jokes
 *   - unfinished ideas
 *   - user opinions expressed during the session
 *   - previous comparisons
 *   - emotional transitions
 *
 * Naturally refer back when relevant.
 * Avoid repeating explanations already given in this conversation.
 *
 * Example:
 *   User (earlier): "I've always liked space."
 *   …many turns later…
 *   Assistant: "This reminds me of what you said earlier about space…"
 *
 * Cooperates with Conversation Memory Map / Flow when present.
 * Runs AFTER: Human Imperfection (when present)
 * Runs BEFORE: WriterDirectives
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'en'|'it'} MemoryLang
 */

/**
 * @typedef {'theme'|'joke'|'unfinished'|'opinion'|'comparison'|'emotion'|'explanation'} MemoryKind
 */

/**
 * @typedef {object} SessionMemoryItem
 * @property {MemoryKind} kind
 * @property {string} text
 * @property {number} turnIndex
 * @property {number} salience 0–1
 */

/**
 * @typedef {object} CallbackCandidate
 * @property {SessionMemoryItem} item
 * @property {number} score
 * @property {string} bridge
 * @property {string[]} overlap
 */

/**
 * @typedef {object} ConversationalMemoryPlan
 * @property {boolean} active
 * @property {boolean} shouldReferBack
 * @property {boolean} avoidRepeat
 * @property {SessionMemoryItem[]} recurringThemes
 * @property {SessionMemoryItem[]} jokes
 * @property {SessionMemoryItem[]} unfinishedIdeas
 * @property {SessionMemoryItem[]} userOpinions
 * @property {SessionMemoryItem[]} previousComparisons
 * @property {SessionMemoryItem[]} emotionalTransitions
 * @property {SessionMemoryItem[]} explanationsGiven
 * @property {CallbackCandidate | null} chosenCallback
 * @property {string[]} avoidRepeatTopics
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} signals
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 * @property {MemoryLang} language
 * @property {string} validationCheck
 */

const MAX_PER_KIND = 8
const MAX_ITEM_LEN = 110
const MIN_TURNS_FOR_CALLBACK = 4 // need some history before "earlier"

const OPINION_RE =
  /\b(i('ve| have)?\s+always\s+liked|i\s+love|i\s+like|i\s+prefer|i\s+hate|i\s+don'?t\s+like|i\s+think|i\s+believe|per\s+me|mi\s+piace|adoro|preferisco|odio|non\s+mi\s+piace|penso\s+che|credo\s+che|secondo\s+me)\b/i

const COMPARISON_RE =
  /\b(compared\s+to|rather\s+than|vs\.?|versus|pi[uù]\s+di|meno\s+di|a\s+differenza\s+di|invece\s+di|meglio\s+di|peggio\s+di|come\s+se|like\s+a|unlike)\b/i

const JOKE_RE =
  /\b(haha|hahaha|ahah|lol|lmao|😂|🤣|battuta|scherz|joke|funny|divertent)\b/i

const UNFINISHED_RE =
  /\b(later|another\s+time|we\s+should\s+(come\s+back|revisit)|torneremo|un['’]altra\s+volta|ne\s+parliamo\s+(dopo|pi[uù]\s+avanti)|lasciamo\s+in\s+sospeso|to\s+be\s+continued|ci\s+torniamo)\b/i

const EMOTION_SHIFT_RE =
  /\b(seriously\s+though|scherzi\s+a\s+parte|a\s+parte\s+gli\s+scherzi|adesso\s+per[oò]|but\s+honestly|honestly\s+though|tornando\s+seri|back\s+to\s+being\s+serious)\b/i

const EXPLAIN_ASSIST_RE =
  /\b(basically|in\s+short|in\s+altre\s+parole|funziona\s+cos[iì]|the\s+idea\s+is|il\s+punto\s+[eè]|means\s+that|significa\s+che)\b/i

const MECHANICAL_MEMORY_RE =
  /\b(as\s+you\s+said\s+\d+\s+(weeks?|days?|months?)\s+ago|according\s+to\s+my\s+(memory\s+)?logs?|recalling\s+from\s+memory\s+id|you\s+previously\s+stated\s+on|secondo\s+i\s+miei\s+record|come\s+hai\s+detto\s+\d+\s+(settimane|giorni)\s+fa)\b/i

const NATURAL_BRIDGES_EN = [
  'This reminds me of what you said earlier about',
  'There’s a thread here with what you mentioned about',
  'Going back to what you said about',
]

const NATURAL_BRIDGES_IT = [
  'Questo mi richiama quello che dicevi prima su',
  'C’è un filo con quello che avevi detto a proposito di',
  'Tornando a quello che dicevi su',
]

/** Soft thematic neighborhoods for same-conversation callbacks (not embeddings). */
const THEME_NEIGHBORHOODS = [
  ['space', 'rocket', 'rockets', 'nasa', 'orbit', 'planet', 'planets', 'star', 'stars', 'galaxy', 'moon', 'mars', 'cosmos', 'astronomy', 'astronaut', 'satellite', 'spazio', 'razzo', 'razzi', 'pianeta', 'stelle', 'orbita'],
  ['tea', 'coffee', 'caffè', 'tè', 'drink', 'beverage', 'mug'],
  ['city', 'cities', 'street', 'urban', 'town', 'città', 'strada'],
  ['memory', 'remember', 'brain', 'recall', 'memoria', 'ricord'],
  ['music', 'song', 'melody', 'musica', 'canzone'],
]

/**
 * @param {string} text
 * @returns {Set<string>}
 */
function neighborhoodHits(text) {
  const lower = String(text || '').toLowerCase()
  /** @type {Set<string>} */
  const hits = new Set()
  for (let i = 0; i < THEME_NEIGHBORHOODS.length; i++) {
    const group = THEME_NEIGHBORHOODS[i]
    if (group.some((w) => lower.includes(w))) hits.add(String(i))
  }
  return hits
}

/**
 * @param {string} a
 * @param {string} b
 */
function shareThemeNeighborhood(a, b) {
  const ha = neighborhoodHits(a)
  const hb = neighborhoodHits(b)
  for (const id of ha) {
    if (hb.has(id)) return true
  }
  return false
}

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
 * @param {string} text
 * @param {number} [max]
 */
function clip(text, max = MAX_ITEM_LEN) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4)
}

/**
 * @param {string[]} a
 * @param {string[]} b
 */
function overlapTokens(a, b) {
  const setB = new Set(b)
  return a.filter((t) => setB.has(t))
}

/**
 * @param {SessionMemoryItem[]} items
 * @param {number} max
 */
function uniqByText(items, max) {
  /** @type {SessionMemoryItem[]} */
  const out = []
  const seen = new Set()
  for (const it of items) {
    const key = `${it.kind}|${it.text.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }
  return out.slice(-max)
}

/**
 * Extract a short noun-ish theme from an opinion / topic sentence.
 * @param {string} text
 */
function extractThemeHint(text) {
  const t = clip(text, 90)
  const m =
    t.match(
      /\b(?:liked|like|love|prefer|about|su|di|about)\s+([A-Za-zÀ-ÿ][\wÀ-ÿ'’-]{2,40})/i,
    ) ||
    t.match(/\b([A-Za-zÀ-ÿ][\wÀ-ÿ'’-]{3,40})\b/)
  return m?.[1] ? clip(m[1], 40) : clip(t, 48)
}

/**
 * Build session ledger from full conversation (excluding current user msg if last).
 * @param {ChatTurn[]} turns
 * @returns {{
 *   recurringThemes: SessionMemoryItem[],
 *   jokes: SessionMemoryItem[],
 *   unfinishedIdeas: SessionMemoryItem[],
 *   userOpinions: SessionMemoryItem[],
 *   previousComparisons: SessionMemoryItem[],
 *   emotionalTransitions: SessionMemoryItem[],
 *   explanationsGiven: SessionMemoryItem[],
 * }}
 */
export function buildSessionMemoryLedger(turns) {
  /** @type {SessionMemoryItem[]} */
  const recurringThemes = []
  /** @type {SessionMemoryItem[]} */
  const jokes = []
  /** @type {SessionMemoryItem[]} */
  const unfinishedIdeas = []
  /** @type {SessionMemoryItem[]} */
  const userOpinions = []
  /** @type {SessionMemoryItem[]} */
  const previousComparisons = []
  /** @type {SessionMemoryItem[]} */
  const emotionalTransitions = []
  /** @type {SessionMemoryItem[]} */
  const explanationsGiven = []

  /** @type {Map<string, { count: number, sample: string, turnIndex: number }>} */
  const themeCounts = new Map()

  turns.forEach((turn, idx) => {
    const text = turn.content
    if (!text) return

    if (turn.role === 'user') {
      if (OPINION_RE.test(text)) {
        userOpinions.push({
          kind: 'opinion',
          text: clip(text, 100),
          turnIndex: idx,
          salience: 0.85,
        })
        const theme = extractThemeHint(text).toLowerCase()
        if (theme.length >= 3) {
          const prev = themeCounts.get(theme)
          if (prev) prev.count += 1
          else themeCounts.set(theme, { count: 1, sample: clip(text, 80), turnIndex: idx })
        }
      }

      if (COMPARISON_RE.test(text)) {
        previousComparisons.push({
          kind: 'comparison',
          text: clip(text, 100),
          turnIndex: idx,
          salience: 0.7,
        })
      }

      if (JOKE_RE.test(text)) {
        jokes.push({
          kind: 'joke',
          text: clip(text, 80),
          turnIndex: idx,
          salience: 0.55,
        })
      }

      if (UNFINISHED_RE.test(text)) {
        unfinishedIdeas.push({
          kind: 'unfinished',
          text: clip(text, 100),
          turnIndex: idx,
          salience: 0.75,
        })
      }

      if (EMOTION_SHIFT_RE.test(text)) {
        emotionalTransitions.push({
          kind: 'emotion',
          text: clip(text, 90),
          turnIndex: idx,
          salience: 0.8,
        })
      }

      // Soft theme harvest from longer user turns
      if (text.split(/\s+/).length >= 6) {
        for (const tok of tokens(text).slice(0, 6)) {
          const prev = themeCounts.get(tok)
          if (prev) prev.count += 1
          else themeCounts.set(tok, { count: 1, sample: clip(text, 80), turnIndex: idx })
        }
      }
    }

    if (turn.role === 'assistant') {
      if (JOKE_RE.test(text) || /😄|😊|😉/.test(text)) {
        jokes.push({
          kind: 'joke',
          text: clip(text, 80),
          turnIndex: idx,
          salience: 0.45,
        })
      }
      if (UNFINISHED_RE.test(text) || /\?\s*$/.test(text) && text.split(/\s+/).length > 12) {
        // trailing open question → possible unfinished thread
        if (UNFINISHED_RE.test(text)) {
          unfinishedIdeas.push({
            kind: 'unfinished',
            text: clip(text, 100),
            turnIndex: idx,
            salience: 0.6,
          })
        }
      }
      if (EXPLAIN_ASSIST_RE.test(text) || text.split(/\s+/).length >= 40) {
        explanationsGiven.push({
          kind: 'explanation',
          text: clip(text, 100),
          turnIndex: idx,
          salience: 0.65,
        })
      }
      if (EMOTION_SHIFT_RE.test(text)) {
        emotionalTransitions.push({
          kind: 'emotion',
          text: clip(text, 90),
          turnIndex: idx,
          salience: 0.55,
        })
      }
    }
  })

  for (const [theme, info] of themeCounts.entries()) {
    if (info.count >= 2) {
      recurringThemes.push({
        kind: 'theme',
        text: clip(`${theme} (${info.sample})`, 100),
        turnIndex: info.turnIndex,
        salience: Math.min(1, 0.5 + info.count * 0.15),
      })
    }
  }

  return {
    recurringThemes: uniqByText(recurringThemes, MAX_PER_KIND),
    jokes: uniqByText(jokes, MAX_PER_KIND),
    unfinishedIdeas: uniqByText(unfinishedIdeas, MAX_PER_KIND),
    userOpinions: uniqByText(userOpinions, MAX_PER_KIND),
    previousComparisons: uniqByText(previousComparisons, MAX_PER_KIND),
    emotionalTransitions: uniqByText(emotionalTransitions, MAX_PER_KIND),
    explanationsGiven: uniqByText(explanationsGiven, MAX_PER_KIND),
  }
}

/**
 * Merge Memory Map explanations into avoid-repeat list when available.
 * @param {SessionMemoryItem[]} explanations
 * @param {object|null} memoryMap
 */
function mergeMapExplanations(explanations, memoryMap) {
  const map = memoryMap?.map || memoryMap || null
  const fromMap = Array.isArray(map?.explanationsGiven) ? map.explanationsGiven : []
  /** @type {SessionMemoryItem[]} */
  const extra = fromMap.map((t, i) => ({
    kind: /** @type {MemoryKind} */ ('explanation'),
    text: clip(String(t), 100),
    turnIndex: -1 - i,
    salience: 0.7,
  }))
  return uniqByText([...explanations, ...extra], MAX_PER_KIND + 4)
}

/**
 * Score callback opportunities against the current user message.
 * Prefer older-but-relevant items (not the last 1–2 user turns).
 * @param {object} ledger
 * @param {string} userMessage
 * @param {number} turnCount
 * @param {MemoryLang} language
 * @returns {CallbackCandidate | null}
 */
function chooseCallback(ledger, userMessage, turnCount, language) {
  if (turnCount < MIN_TURNS_FOR_CALLBACK) return null
  const msgTokens = tokens(userMessage)
  if (msgTokens.length === 0 && userMessage.length < 8) return null

  /** @type {SessionMemoryItem[]} */
  const pool = [
    ...ledger.userOpinions,
    ...ledger.recurringThemes,
    ...ledger.previousComparisons,
    ...ledger.unfinishedIdeas,
    ...ledger.jokes,
    ...ledger.emotionalTransitions,
  ]

  // Ignore very recent items (last ~2 turns worth) — "earlier" means earlier
  const cutoff = Math.max(0, turnCount - 3)
  const bridges = language === 'it' ? NATURAL_BRIDGES_IT : NATURAL_BRIDGES_EN

  /** @type {CallbackCandidate[]} */
  const scored = []
  for (const item of pool) {
    if (item.turnIndex >= cutoff) continue
    const itemToks = tokens(item.text)
    const ov = overlapTokens(msgTokens, itemToks)
    let score = ov.length * 1.4 + item.salience
    if (item.kind === 'opinion') score += 0.8
    if (item.kind === 'theme') score += 0.6
    if (item.kind === 'unfinished') score += 0.5
    if (item.kind === 'comparison') score += 0.4
    // Distance bonus: older memories feel more like "earlier"
    const age = Math.max(0, cutoff - item.turnIndex)
    score += Math.min(1.2, age * 0.08)

    const hint = extractThemeHint(item.text).toLowerCase()
    if (hint.length >= 3 && userMessage.toLowerCase().includes(hint)) {
      score += 1.6
      if (!ov.includes(hint)) ov.push(hint)
    }
    if (shareThemeNeighborhood(item.text, userMessage)) {
      score += 1.8
      if (hint.length >= 3 && !ov.includes(hint)) ov.push(hint)
    }

    if (ov.length === 0 && !shareThemeNeighborhood(item.text, userMessage)) {
      continue
    }
    if (score < 1.6) continue
    const topic = extractThemeHint(item.text)
    const bridgeBase = bridges[Math.min(bridges.length - 1, Math.floor(score) % bridges.length)]
    scored.push({
      item,
      score,
      bridge: `${bridgeBase} ${topic}…`,
      overlap: ov.slice(0, 4),
    })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored[0] || null
}

/**
 * Topics that should not be re-explained this turn.
 * @param {SessionMemoryItem[]} explanations
 * @param {string} userMessage
 */
function pickAvoidRepeat(explanations, userMessage) {
  const msgToks = tokens(userMessage)
  /** @type {string[]} */
  const out = []
  for (const ex of explanations) {
    const ov = overlapTokens(msgToks, tokens(ex.text))
    if (ov.length >= 2 || (ov.length >= 1 && EXPLAIN_ASSIST_RE.test(userMessage) === false && msgToks.length <= 8)) {
      // Current ask overlaps a prior explanation → avoid rehashing
      if (ov.length >= 1) out.push(clip(ex.text, 72))
    }
  }
  // Also surface a few recent explanations as soft avoid list when continuing
  for (const ex of explanations.slice(-3)) {
    if (!out.includes(ex.text)) out.push(clip(ex.text, 72))
  }
  return out.slice(0, 5)
}

/**
 * @param {string[]} reasons
 * @returns {ConversationalMemoryPlan}
 */
function inactivePlan(reasons = ['inactive']) {
  return {
    active: false,
    shouldReferBack: false,
    avoidRepeat: false,
    recurringThemes: [],
    jokes: [],
    unfinishedIdeas: [],
    userOpinions: [],
    previousComparisons: [],
    emotionalTransitions: [],
    explanationsGiven: [],
    chosenCallback: null,
    avoidRepeatTopics: [],
    writerBrief: '',
    structureLine: null,
    signals: [],
    reasons,
    confidence: 'low',
    language: 'en',
    validationCheck:
      'Am I remembering what happened earlier in THIS conversation — or only reacting to the last message?',
  }
}

/**
 * @param {ConversationalMemoryPlan} plan
 */
function buildBrief(plan) {
  const lang = plan.language
  const lines = [
    'CONVERSATIONAL MEMORY ENGINE (obbligatorio quando attivo):',
    'Ricorda questa STESSA conversazione — non solo l’ultimo messaggio.',
  ]

  const summarize = (label, items) => {
    if (!items.length) return null
    return `${label}: ${items
      .slice(-3)
      .map((i) => `«${clip(i.text, 48)}»`)
      .join(' · ')}`
  }

  const blocks = [
    summarize(lang === 'it' ? 'Temi ricorrenti' : 'Recurring themes', plan.recurringThemes),
    summarize(lang === 'it' ? 'Battute' : 'Jokes', plan.jokes),
    summarize(lang === 'it' ? 'Idee in sospeso' : 'Unfinished ideas', plan.unfinishedIdeas),
    summarize(lang === 'it' ? 'Opinioni utente' : 'User opinions', plan.userOpinions),
    summarize(lang === 'it' ? 'Confronti' : 'Comparisons', plan.previousComparisons),
    summarize(lang === 'it' ? 'Transizioni emotive' : 'Emotional transitions', plan.emotionalTransitions),
  ].filter(Boolean)

  if (blocks.length) lines.push(...blocks)

  if (plan.shouldReferBack && plan.chosenCallback) {
    const c = plan.chosenCallback
    lines.push(
      lang === 'it'
        ? `Riferisciti naturalmente a qualcosa di PRIMA: ${c.bridge}`
        : `Naturally refer back to something earlier: ${c.bridge}`,
    )
    lines.push(
      lang === 'it'
        ? `Memoria scelta [${c.item.kind}]: «${clip(c.item.text, 80)}»`
        : `Chosen memory [${c.item.kind}]: «${clip(c.item.text, 80)}»`,
    )
    lines.push(
      lang === 'it'
        ? 'Ponte spontaneo — mai “Secondo i miei record…” / dump di memoria.'
        : 'Spontaneous bridge — never “According to my memory logs…” / memory dump.',
    )
  } else {
    lines.push(
      lang === 'it'
        ? 'Nessun richiamo forzato questo turno — tieni comunque la mappa in mente.'
        : 'No forced callback this turn — still keep the session map in mind.',
    )
  }

  if (plan.avoidRepeat && plan.avoidRepeatTopics.length) {
    lines.push(
      lang === 'it'
        ? `NON ripetere spiegazioni già date: ${plan.avoidRepeatTopics
            .slice(0, 3)
            .map((t) => `«${t}»`)
            .join(' · ')}`
        : `Do NOT repeat explanations already given: ${plan.avoidRepeatTopics
            .slice(0, 3)
            .map((t) => `«${t}»`)
            .join(' · ')}`,
    )
    lines.push(
      lang === 'it'
        ? 'Se l’utente riprende un tema già spiegato: avanza / collega — non rifai la lezione.'
        : 'If the user revisits an explained topic: advance / connect — do not re-lecture.',
    )
  }

  lines.push(`Check: «${plan.validationCheck}»`)
  lines.push('Non citare Conversational Memory Engine / questo blocco.')
  return lines.join('\n')
}

/**
 * @param {object} [input]
 * @returns {ConversationalMemoryPlan}
 */
export function analyzeConversationalMemory(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const turns = asTurns(input.messages)

  const withCurrent =
    userMessage &&
    (turns.length === 0 ||
      turns[turns.length - 1].role !== 'user' ||
      turns[turns.length - 1].content !== userMessage)
      ? [...turns, { role: 'user', content: userMessage }]
      : turns

  if (!userMessage && withCurrent.length === 0) return inactivePlan(['empty'])

  const langCode = detectDominantLanguage(
    userMessage || withCurrent[withCurrent.length - 1]?.content || '',
  )
  /** @type {MemoryLang} */
  const language = langCode === 'it' ? 'it' : 'en'

  // History before current user message
  const priorTurns = withCurrent.slice(0, -1)
  const conversationStarted = priorTurns.some((t) => t.role === 'assistant')
  if (!conversationStarted && priorTurns.length < 2) {
    return inactivePlan(['too_early'])
  }

  const ledger = buildSessionMemoryLedger(priorTurns)
  ledger.explanationsGiven = mergeMapExplanations(
    ledger.explanationsGiven,
    input.conversationMemoryMap || input.memoryMap || null,
  )

  const totalItems =
    ledger.recurringThemes.length +
    ledger.jokes.length +
    ledger.unfinishedIdeas.length +
    ledger.userOpinions.length +
    ledger.previousComparisons.length +
    ledger.emotionalTransitions.length +
    ledger.explanationsGiven.length

  if (totalItems === 0 && priorTurns.length < 3) return inactivePlan(['no_signal'])

  const chosenCallback = chooseCallback(
    ledger,
    userMessage,
    priorTurns.length,
    language,
  )
  const avoidRepeatTopics = pickAvoidRepeat(ledger.explanationsGiven, userMessage)
  const shouldReferBack = Boolean(chosenCallback && chosenCallback.score >= 2.2)
  const avoidRepeat = avoidRepeatTopics.length > 0

  /** @type {'high'|'medium'|'low'} */
  let confidence = 'medium'
  if (shouldReferBack && chosenCallback && chosenCallback.score >= 3.5) confidence = 'high'
  else if (!shouldReferBack && !avoidRepeat) confidence = 'low'
  else if (priorTurns.length >= 10) confidence = 'high'

  /** @type {string[]} */
  const signals = ['session_memory']
  if (shouldReferBack) signals.push('refer_back', `kind_${chosenCallback?.item.kind}`)
  if (avoidRepeat) signals.push('avoid_repeat')
  if (ledger.userOpinions.length) signals.push('has_opinions')
  if (ledger.recurringThemes.length) signals.push('has_themes')

  /** @type {ConversationalMemoryPlan} */
  const plan = {
    active: true,
    shouldReferBack,
    avoidRepeat,
    recurringThemes: ledger.recurringThemes,
    jokes: ledger.jokes,
    unfinishedIdeas: ledger.unfinishedIdeas,
    userOpinions: ledger.userOpinions,
    previousComparisons: ledger.previousComparisons,
    emotionalTransitions: ledger.emotionalTransitions,
    explanationsGiven: ledger.explanationsGiven,
    chosenCallback,
    avoidRepeatTopics,
    writerBrief: '',
    structureLine: shouldReferBack
      ? `Conversational Memory → refer back (${chosenCallback?.item.kind}: ${clip(extractThemeHint(chosenCallback?.item.text || ''), 32)})`
      : avoidRepeat
        ? 'Conversational Memory → avoid re-explaining prior ground'
        : 'Conversational Memory → hold session map (no forced callback)',
    signals,
    reasons: [
      shouldReferBack ? 'natural_refer_back' : 'hold_map',
      avoidRepeat ? 'avoid_repeat_explanation' : 'no_repeat_pressure',
      `opinions_${ledger.userOpinions.length}`,
      `themes_${ledger.recurringThemes.length}`,
      `history_turns_${priorTurns.length}`,
    ],
    confidence,
    language,
    validationCheck:
      'Am I remembering what happened earlier in THIS conversation — or only reacting to the last message?',
  }
  plan.writerBrief = buildBrief(plan)
  return plan
}

/**
 * @param {ConversationalMemoryPlan | null | undefined} plan
 */
export function formatConversationalMemoryForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  return `══════════════════════════════════════
CONVERSATIONAL MEMORY ENGINE (INVISIBILE)
══════════════════════════════════════
Active=yes · referBack=${plan.shouldReferBack} · avoidRepeat=${plan.avoidRepeat} · confidence=${plan.confidence}
Themes=${plan.recurringThemes.length} · Jokes=${plan.jokes.length} · Unfinished=${plan.unfinishedIdeas.length} · Opinions=${plan.userOpinions.length} · Comparisons=${plan.previousComparisons.length} · Emotions=${plan.emotionalTransitions.length} · Explained=${plan.explanationsGiven.length}

${plan.writerBrief}

Regole: ricorda la STESSA conversazione · riferisciti con naturalezza · non ripetere spiegazioni già date · non citare il motore.`.trim()
}

/**
 * @param {ConversationalMemoryPlan | null | undefined} plan
 * @returns {string[]}
 */
export function conversationalMemoryStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const hints = []
  if (plan.structureLine) hints.push(plan.structureLine)
  if (plan.shouldReferBack && plan.chosenCallback) {
    hints.push(`Natural callback: ${plan.chosenCallback.bridge}`)
    hints.push('One spontaneous bridge — never a memory dump')
  }
  if (plan.avoidRepeat) {
    hints.push('Do not re-explain ground already covered this conversation')
  }
  hints.push(`Internal check: ${plan.validationCheck}`)
  return hints
}

/**
 * Detect drafts that ignore session memory or dump mechanically.
 * @param {string} draft
 * @param {ConversationalMemoryPlan | null | undefined} plan
 */
export function draftViolatesConversationalMemory(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '').trim()
  if (!text) return true

  if (MECHANICAL_MEMORY_RE.test(text)) return true

  // High-confidence refer-back requested but draft is a cold re-lecture opener with no bridge
  if (
    plan.shouldReferBack &&
    plan.confidence === 'high' &&
    plan.chosenCallback &&
    /^(let me explain|ti spiego|in sintesi|in summary|artificial intelligence has|l['’]intelligenza artificiale)/i.test(
      text,
    )
  ) {
    const theme = extractThemeHint(plan.chosenCallback.item.text).toLowerCase()
    const bridged =
      /remind(s)?\s+me|dicevi\s+prima|avevi\s+detto|earlier|prima\s+su|what you said/i.test(
        text,
      ) || (theme.length >= 3 && text.toLowerCase().includes(theme))
    if (!bridged) return true
  }

  return false
}

/**
 * @param {object} [input]
 * @returns {{ plan: ConversationalMemoryPlan, context: string }}
 */
export function runConversationalMemoryEngine(input = {}) {
  try {
    const plan = analyzeConversationalMemory(input)
    return {
      plan,
      context: formatConversationalMemoryForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft']),
      context: '',
    }
  }
}
