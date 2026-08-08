/**
 * LAIfe Welcome Experience Engine
 *
 * Every new conversation should feel like meeting a trusted personal assistant
 * — not opening a chatbot.
 *
 * When the user greets / starts a chat:
 * 1. Detect first conversation | returning | continuation after a short pause
 * 2. Retrieve only the most relevant memories / ongoing projects
 * 3. Decide whether mentioning previous context improves the conversation
 * 4. Generate a warm, natural, never-identical greeting
 * 5. Continue with the single most valuable next step
 *
 * Greeting adapts to mood, time of day, and history.
 * Strategies vary: warm-only · resume project · celebrate progress · suggest next step.
 * Invisible — Writer guidance only.
 */

/**
 * @typedef {object} WelcomeSessionState
 * @property {string[]} usedGreetingIds
 * @property {string[]} usedStrategies
 * @property {number} welcomeCount
 * @property {number} lastSeenAt
 * @property {number} updatedAt
 */

/**
 * @typedef {'calm'|'warm'|'bright'|'terse'|'formal'} EnthusiasmStyle
 * @typedef {'upbeat'|'neutral'|'tired'|'stressed'|'focused'} Mood
 * @typedef {'morning'|'afternoon'|'evening'|'night'} TimeOfDay
 * @typedef {'first'|'returning'|'pause_resume'} EncounterKind
 * @typedef {'warm_only'|'resume_project'|'celebrate_progress'|'suggest_next'|'warm_handoff'} WelcomeStrategy
 */

/**
 * @typedef {object} RelevantMemory
 * @property {string} label
 * @property {string} detail
 * @property {number} score
 * @property {'project'|'progress'|'goal'|'preference'|'other'} kind
 * @property {string} [source]
 */

/**
 * @typedef {object} WelcomePlan
 * @property {boolean} active
 * @property {boolean} isConversationStart
 * @property {EncounterKind} encounterKind
 * @property {EnthusiasmStyle} enthusiasm
 * @property {Mood} mood
 * @property {TimeOfDay} timeOfDay
 * @property {WelcomeStrategy} strategy
 * @property {boolean} mentionContext
 * @property {string | null} greetingId
 * @property {string} greetingSeed
 * @property {RelevantMemory | null} memory
 * @property {string | null} nextStep
 * @property {'full_welcome'|'warm_handoff'} mode
 * @property {string} writerBrief
 * @property {string[]} reasons
 * @property {WelcomeSessionState} session
 */

/** Short pause: same relationship thread, just stepped away briefly. */
const PAUSE_RESUME_MS = 4 * 60 * 60 * 1000 // 4 hours
/** Ignore sub-second double fires as "pause". */
const PAUSE_MIN_MS = 45 * 1000

const GREETING_ONLY =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|buon\s+pomeriggio|salve|hola|yo|ehi|good\s+(morning|afternoon|evening))([\s!,.]|$)/i

const SUBSTANCE =
  /\b(aiut|help|come\s+|how\s+|perch|why|fix|bug|crea|build|scriv|write|spieg|explain|piano|plan|debug|codice|code|errore|error)\b/i

/**
 * @typedef {{
 *   id: string,
 *   styles: EnthusiasmStyle[],
 *   moods: (Mood | 'any')[],
 *   times: (TimeOfDay | 'any')[],
 *   encounters: (EncounterKind | 'any')[],
 *   strategies: WelcomeStrategy[],
 *   line: (ctx: {
 *     name?: string,
 *     memory?: string,
 *     timePhrase?: string,
 *   }) => string
 * }} GreetingCard
 */

/** @type {GreetingCard[]} */
const GREETING_BANK = [
  // —— warm_only ——
  {
    id: 'wo-morn-1',
    styles: ['warm', 'bright'],
    moods: ['upbeat', 'neutral'],
    times: ['morning'],
    encounters: ['any'],
    strategies: ['warm_only'],
    line: ({ name }) => `Buongiorno${name ? ` ${name}` : ''}. Che bello rivederti qui.`,
  },
  {
    id: 'wo-aft-1',
    styles: ['warm', 'calm'],
    moods: ['neutral', 'focused'],
    times: ['afternoon'],
    encounters: ['returning', 'pause_resume'],
    strategies: ['warm_only'],
    line: ({ name }) => `Eccoti${name ? `, ${name}` : ''}. Sono qui.`,
  },
  {
    id: 'wo-eve-1',
    styles: ['warm', 'calm'],
    moods: ['tired', 'neutral', 'upbeat'],
    times: ['evening'],
    encounters: ['any'],
    strategies: ['warm_only'],
    line: ({ name }) => `Buonasera${name ? ` ${name}` : ''}. Piano piano, dimmi pure.`,
  },
  {
    id: 'wo-night-1',
    styles: ['calm', 'terse', 'warm'],
    moods: ['tired', 'stressed', 'neutral'],
    times: ['night'],
    encounters: ['any'],
    strategies: ['warm_only'],
    line: ({ name }) => `Hey${name ? ` ${name}` : ''}. Ancora in piedi — ci sono.`,
  },
  {
    id: 'wo-pause-1',
    styles: ['warm', 'bright', 'calm'],
    moods: ['neutral', 'upbeat', 'focused'],
    times: ['any'],
    encounters: ['pause_resume'],
    strategies: ['warm_only'],
    line: ({ name }) => `Di nuovo qui${name ? `, ${name}` : ''}. Riprendiamo quando vuoi.`,
  },
  {
    id: 'wo-first-1',
    styles: ['warm', 'bright'],
    moods: ['upbeat', 'neutral'],
    times: ['any'],
    encounters: ['first'],
    strategies: ['warm_only'],
    line: ({ name }) =>
      `Ciao${name ? ` ${name}` : ''}. Sono LAIfe — qui per te, senza giri di parole.`,
  },
  {
    id: 'wo-first-2',
    styles: ['calm', 'terse'],
    moods: ['neutral', 'focused', 'tired'],
    times: ['any'],
    encounters: ['first'],
    strategies: ['warm_only'],
    line: () => `Ciao. Dimmi pure.`,
  },
  {
    id: 'wo-stressed-1',
    styles: ['calm', 'warm', 'terse'],
    moods: ['stressed', 'tired'],
    times: ['any'],
    encounters: ['any'],
    strategies: ['warm_only'],
    line: ({ name }) => `Hey${name ? ` ${name}` : ''}. Respira — andiamo un passo alla volta.`,
  },
  {
    id: 'wo-formal-1',
    styles: ['formal'],
    moods: ['neutral', 'focused'],
    times: ['morning', 'afternoon'],
    encounters: ['any'],
    strategies: ['warm_only'],
    line: ({ name }) => `Buongiorno${name ? ` ${name}` : ''}. Piacere di rivederti.`,
  },

  // —— resume_project ——
  {
    id: 'rp-1',
    styles: ['warm', 'bright', 'calm'],
    moods: ['neutral', 'upbeat', 'focused'],
    times: ['any'],
    encounters: ['returning', 'pause_resume'],
    strategies: ['resume_project'],
    line: ({ name, memory }) =>
      `Eccoti${name ? `, ${name}` : ''}. Se vuoi, riprendiamo da ${memory}.`,
  },
  {
    id: 'rp-2',
    styles: ['warm', 'bright'],
    moods: ['upbeat', 'focused'],
    times: ['morning', 'afternoon'],
    encounters: ['returning'],
    strategies: ['resume_project'],
    line: ({ memory }) => `Bentornato. ${memory} è ancora lì — ci torniamo?`,
  },
  {
    id: 'rp-3',
    styles: ['terse', 'calm'],
    moods: ['focused', 'neutral', 'tired'],
    times: ['any'],
    encounters: ['returning', 'pause_resume'],
    strategies: ['resume_project'],
    line: ({ memory }) => `Ciao. ${memory}?`,
  },
  {
    id: 'rp-4',
    styles: ['formal', 'calm'],
    moods: ['neutral', 'focused'],
    times: ['any'],
    encounters: ['returning'],
    strategies: ['resume_project'],
    line: ({ name, memory }) =>
      `Piacere di rivederti${name ? `, ${name}` : ''}. Possiamo riprendere ${memory}, se ti è utile.`,
  },
  {
    id: 'rp-pause-1',
    styles: ['warm', 'calm', 'bright'],
    moods: ['neutral', 'focused', 'upbeat'],
    times: ['any'],
    encounters: ['pause_resume'],
    strategies: ['resume_project'],
    line: ({ memory }) => `Riprendiamo il filo su ${memory}?`,
  },

  // —— celebrate_progress ——
  {
    id: 'cp-1',
    styles: ['bright', 'warm'],
    moods: ['upbeat', 'neutral'],
    times: ['any'],
    encounters: ['returning', 'pause_resume'],
    strategies: ['celebrate_progress'],
    line: ({ name, memory }) =>
      `Hey${name ? ` ${name}` : ''} — bel pezzo su ${memory}. Vuoi spingere ancora un po’?`,
  },
  {
    id: 'cp-2',
    styles: ['warm', 'calm'],
    moods: ['upbeat', 'focused', 'neutral'],
    times: ['morning', 'afternoon', 'evening'],
    encounters: ['returning'],
    strategies: ['celebrate_progress'],
    line: ({ memory }) => `Ho ancora fresco il progresso su ${memory}. Continuiamo da lì?`,
  },
  {
    id: 'cp-3',
    styles: ['bright'],
    moods: ['upbeat'],
    times: ['any'],
    encounters: ['returning', 'pause_resume'],
    strategies: ['celebrate_progress'],
    line: ({ memory }) => `Ottimo lavoro su ${memory}. Pronto per il passo dopo?`,
  },
  {
    id: 'cp-soft-1',
    styles: ['calm', 'warm'],
    moods: ['tired', 'stressed', 'neutral'],
    times: ['evening', 'night'],
    encounters: ['returning', 'pause_resume'],
    strategies: ['celebrate_progress'],
    line: ({ memory }) => `Hai già fatto strada con ${memory}. Se vuoi, facciamo solo il prossimo pezzetto.`,
  },

  // —— suggest_next ——
  {
    id: 'sn-1',
    styles: ['warm', 'bright', 'calm'],
    moods: ['focused', 'neutral', 'upbeat'],
    times: ['morning', 'afternoon'],
    encounters: ['returning', 'pause_resume'],
    strategies: ['suggest_next'],
    line: ({ name, memory }) =>
      memory
        ? `Ciao${name ? ` ${name}` : ''}. Il passo più utile ora su ${memory} potrebbe essere il prossimo pezzo concreto.`
        : `Ciao${name ? ` ${name}` : ''}. Se vuoi, partiamo dalla cosa più urgente di oggi.`,
  },
  {
    id: 'sn-2',
    styles: ['terse', 'calm'],
    moods: ['focused', 'tired', 'neutral'],
    times: ['any'],
    encounters: ['returning', 'pause_resume', 'first'],
    strategies: ['suggest_next'],
    line: ({ memory }) =>
      memory ? `Ciao. Prossimo passo su ${memory}?` : `Ciao. Priorità di oggi?`,
  },
  {
    id: 'sn-3',
    styles: ['formal'],
    moods: ['neutral', 'focused'],
    times: ['morning', 'afternoon'],
    encounters: ['returning', 'first'],
    strategies: ['suggest_next'],
    line: ({ name, memory }) =>
      memory
        ? `Buongiorno${name ? ` ${name}` : ''}. Propongo di avanzare su ${memory} con un passo chiaro.`
        : `Buongiorno${name ? ` ${name}` : ''}. Dimmi pure la priorità di oggi.`,
  },
  {
    id: 'sn-first-1',
    styles: ['warm', 'bright'],
    moods: ['upbeat', 'neutral'],
    times: ['any'],
    encounters: ['first'],
    strategies: ['suggest_next'],
    line: ({ name }) =>
      `Ciao${name ? ` ${name}` : ''}. Possiamo partire da una cosa concreta — dimmi la più urgente.`,
  },

  // —— warm_handoff (substance already in the message) ——
  {
    id: 'wh-1',
    styles: ['warm', 'bright', 'calm'],
    moods: ['any'],
    times: ['any'],
    encounters: ['any'],
    strategies: ['warm_handoff'],
    line: () => `Ok — ci sono.`,
  },
  {
    id: 'wh-2',
    styles: ['terse', 'calm'],
    moods: ['any'],
    times: ['any'],
    encounters: ['any'],
    strategies: ['warm_handoff'],
    line: () => `Ok.`,
  },
  {
    id: 'wh-3',
    styles: ['bright', 'warm'],
    moods: ['upbeat', 'neutral', 'focused'],
    times: ['any'],
    encounters: ['any'],
    strategies: ['warm_handoff'],
    line: () => `Perfetto, andiamo.`,
  },
  {
    id: 'wh-4',
    styles: ['formal'],
    moods: ['any'],
    times: ['any'],
    encounters: ['any'],
    strategies: ['warm_handoff'],
    line: () => `D’accordo — procediamo.`,
  },
  {
    id: 'wh-5',
    styles: ['calm', 'warm'],
    moods: ['stressed', 'tired'],
    times: ['any'],
    encounters: ['any'],
    strategies: ['warm_handoff'],
    line: () => `Ci sono. Andiamo con calma.`,
  },
]

/**
 * @returns {WelcomeSessionState}
 */
export function emptyWelcomeSession() {
  return {
    usedGreetingIds: [],
    usedStrategies: [],
    welcomeCount: 0,
    lastSeenAt: 0,
    updatedAt: Date.now(),
  }
}

/**
 * @param {unknown} raw
 * @returns {WelcomeSessionState}
 */
export function sanitizeWelcomeSession(raw) {
  const base = emptyWelcomeSession()
  if (!raw || typeof raw !== 'object') return base
  const s = /** @type {Record<string, unknown>} */ (raw)
  return {
    usedGreetingIds: Array.isArray(s.usedGreetingIds)
      ? s.usedGreetingIds.filter((x) => typeof x === 'string').map((x) => x.slice(0, 40)).slice(-48)
      : [],
    usedStrategies: Array.isArray(s.usedStrategies)
      ? s.usedStrategies.filter((x) => typeof x === 'string').map((x) => x.slice(0, 40)).slice(-12)
      : [],
    welcomeCount:
      typeof s.welcomeCount === 'number' && Number.isFinite(s.welcomeCount) ? s.welcomeCount : 0,
    lastSeenAt:
      typeof s.lastSeenAt === 'number' && Number.isFinite(s.lastSeenAt)
        ? s.lastSeenAt
        : typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt)
          ? s.updatedAt
          : 0,
    updatedAt:
      typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt) ? s.updatedAt : Date.now(),
  }
}

/**
 * @param {Array<{ role?: string, content?: string }> | null | undefined} messages
 */
export function isConversationStart(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return true
  const turns = messages.filter(
    (m) =>
      m &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' &&
      m.content.trim(),
  )
  const assistants = turns.filter((m) => m.role === 'assistant')
  const users = turns.filter((m) => m.role === 'user')
  return assistants.length === 0 && users.length <= 1
}

/**
 * @param {Date} [now]
 * @returns {TimeOfDay}
 */
export function detectTimeOfDay(now = new Date()) {
  const h = now.getHours()
  if (h >= 5 && h < 12) return 'morning'
  if (h >= 12 && h < 17) return 'afternoon'
  if (h >= 17 && h < 22) return 'evening'
  return 'night'
}

/**
 * @param {string} text
 * @param {{ apparentPreferences?: string[] } | null} [signals]
 * @returns {EnthusiasmStyle}
 */
export function detectEnthusiasmStyle(text, signals) {
  const t = String(text || '')
  const prefs = (signals?.apparentPreferences || []).join(' ').toLowerCase()

  if (
    /\b(formale|formal|cortese)\b/i.test(prefs) ||
    /\b(per\s+favore|gentil(?:e|mente)|cordiali|please\s+could|potrebbe|vorrei\s+chiederle)\b/i.test(
      t,
    )
  ) {
    return 'formal'
  }
  if (/\b(breve|concis|terse|short)\b/i.test(prefs) || (t.length < 24 && !/[!]/.test(t))) {
    if (GREETING_ONLY.test(t.trim()) && t.length < 16) return 'terse'
  }
  if (
    (t.match(/!/g) || []).length >= 1 ||
    /\b(!!|wow|yay|super|dai)\b/i.test(t) ||
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t)
  ) {
    return 'bright'
  }
  if (/\b(hey|yo|raga|lol|ahah)\b/i.test(t)) return 'bright'
  if (t.length > 140 || /\b(vorrei|potresti|mi\s+chiedevo)\b/i.test(t)) return 'calm'
  if (/\b(breve|tl;dr|in\s+sintesi)\b/i.test(t)) return 'terse'
  return 'warm'
}

/**
 * Mood from greeting / message cues (not a clinical model).
 * @param {string} text
 * @param {EnthusiasmStyle} enthusiasm
 * @returns {Mood}
 */
export function detectMood(text, enthusiasm) {
  const t = String(text || '')
  if (/\b(stanco|esausto|tired|non\s+ce\s+la\s+faccio|esaust)\b/i.test(t)) return 'tired'
  if (/\b(stress|ansios|overwhelm|panic|aiuto\s+urgente|deadline|furios)\b/i.test(t)) {
    return 'stressed'
  }
  if (/\b(focus|concentriam|andiamo|let'?s\s+go|al\s+lavoro)\b/i.test(t)) return 'focused'
  if (
    enthusiasm === 'bright' ||
    /\b(yay|super|ottimo|great|excited|entusias)\b/i.test(t) ||
    (t.match(/!/g) || []).length >= 2
  ) {
    return 'upbeat'
  }
  return 'neutral'
}

/**
 * @param {object} input
 * @param {WelcomeSessionState} session
 * @param {boolean} hasMemories
 * @param {number} [nowMs]
 * @returns {EncounterKind}
 */
export function detectEncounterKind(input, session, hasMemories, nowMs = Date.now()) {
  if (input?.encounterKind === 'first' || input?.encounterKind === 'returning' || input?.encounterKind === 'pause_resume') {
    return input.encounterKind
  }

  const known =
    session.welcomeCount > 0 ||
    hasMemories ||
    input?.isReturning === true ||
    input?.userKind === 'returning' ||
    (input?.learningSignals &&
      (input.learningSignals.turnCount > 0 ||
        (input.learningSignals.apparentPreferences || []).length > 0))

  if (!known && input?.isReturning !== true && input?.userKind !== 'returning') {
    return 'first'
  }

  const last = session.lastSeenAt || session.updatedAt || 0
  if (last > 0) {
    const delta = nowMs - last
    if (delta >= PAUSE_MIN_MS && delta <= PAUSE_RESUME_MS) return 'pause_resume'
  }

  return 'returning'
}

/** @deprecated use detectEncounterKind — kept for callers/tests */
export function detectUserKind(input) {
  const session = sanitizeWelcomeSession(input?.welcomeSession)
  const kind = detectEncounterKind(input, session, Boolean(input?.hasMemories))
  return kind === 'first' ? 'new' : 'returning'
}

/**
 * Score and pick the single most relevant memory/project.
 * @param {Array<object|string>} candidates
 * @param {string} [userMessage]
 * @returns {RelevantMemory | null}
 */
export function pickRelevantMemory(candidates, userMessage = '') {
  if (!Array.isArray(candidates) || candidates.length === 0) return null

  const q = String(userMessage || '').toLowerCase()
  /** @type {RelevantMemory[]} */
  const scored = []

  for (const raw of candidates) {
    if (typeof raw === 'string' && raw.trim()) {
      scored.push({
        label: raw.trim().slice(0, 80),
        detail: raw.trim(),
        score: 2,
        kind: 'project',
        source: 'hint',
      })
      continue
    }
    if (!raw || typeof raw !== 'object') continue
    const category = String(/** @type {any} */ (raw).category || '').toLowerCase()
    const title = String(/** @type {any} */ (raw).title || '').trim()
    const content = String(/** @type {any} */ (raw).content || '').trim()
    if (!title && !content) continue

    const blob = `${title} ${content}`
    let score = Number(/** @type {any} */ (raw).importance) || 1
    /** @type {RelevantMemory['kind']} */
    let kind = 'other'

    if (category === 'projects' || /project|progetto|app|mvp|build/i.test(blob)) {
      score += 8
      kind = 'project'
    } else if (
      category === 'goals' ||
      /\b(goal|obiettivo|progress|avanzament|completato|shipped|fatto)\b/i.test(blob)
    ) {
      score += 6
      kind = /progress|completato|shipped|fatto|avanzament/i.test(blob) ? 'progress' : 'goal'
    } else if (category === 'preferences' || category === 'habits') {
      score += 3
      kind = 'preference'
      // Preferences rarely worth mentioning in a greeting unless highly relevant
      score -= 1
    } else {
      continue
    }

    const hay = blob.toLowerCase()
    for (const tok of q.split(/\W+/).filter((t) => t.length > 3)) {
      if (hay.includes(tok)) score += 2
    }

    const label =
      title.replace(/^(project|progress|goal)[:\s]*/i, '').slice(0, 60) ||
      content.replace(/^user'?s?\s+project:\s*/i, '').slice(0, 60)

    scored.push({
      label: label.trim(),
      detail: content.slice(0, 160) || title,
      score,
      kind,
      source: category || 'memory',
    })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored[0] || null
}

/** @deprecated alias */
export function pickOngoingProject(candidates, userMessage = '') {
  const m = pickRelevantMemory(candidates, userMessage)
  if (!m) return null
  return { label: m.label, detail: m.detail, score: m.score, source: m.source }
}

/**
 * Decide if mentioning prior context helps (vs just greeting warmly).
 * @param {object} opts
 */
export function shouldMentionContext(opts) {
  const { encounterKind, memory, mood, mode, enthusiasm } = opts
  if (mode === 'warm_handoff') return false
  if (encounterKind === 'first') return false
  if (!memory) return false
  if (mood === 'stressed' || mood === 'tired') {
    // Soft presence > project dump when depleted
    return memory.kind === 'progress' && memory.score >= 10
  }
  if (enthusiasm === 'terse' && memory.score < 8) return false
  if (memory.kind === 'preference') return false
  return memory.score >= 5
}

/**
 * Pick strategy with variety (avoid repeating last strategies when possible).
 * @param {object} opts
 * @returns {WelcomeStrategy}
 */
export function chooseWelcomeStrategy(opts) {
  const {
    mode,
    encounterKind,
    mentionContext,
    memory,
    mood,
    usedStrategies = [],
  } = opts

  if (mode === 'warm_handoff') return 'warm_handoff'

  /** @type {WelcomeStrategy[]} */
  let candidates = ['warm_only']

  if (mentionContext && memory) {
    if (memory.kind === 'progress') candidates = ['celebrate_progress', 'resume_project', 'warm_only']
    else if (memory.kind === 'project' || memory.kind === 'goal') {
      candidates = ['resume_project', 'suggest_next', 'warm_only']
    } else {
      candidates = ['suggest_next', 'warm_only']
    }
  } else if (encounterKind === 'first') {
    candidates = ['warm_only', 'suggest_next']
  } else if (encounterKind === 'pause_resume') {
    candidates = mentionContext && memory ? ['resume_project', 'warm_only'] : ['warm_only', 'suggest_next']
  } else {
    candidates = ['warm_only', 'suggest_next']
  }

  if (mood === 'stressed' || mood === 'tired') {
    candidates = candidates.filter((c) => c === 'warm_only' || c === 'celebrate_progress')
    if (candidates.length === 0) candidates = ['warm_only']
  }

  const recent = new Set(usedStrategies.slice(-3))
  const fresh = candidates.filter((c) => !recent.has(c))
  const pool = fresh.length > 0 ? fresh : candidates
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * @param {GreetingCard} card
 * @param {object} opts
 */
function cardMatches(card, opts) {
  if (opts.usedIds?.has(card.id)) return false
  if (!card.strategies.includes(opts.strategy)) return false
  if (!card.encounters.includes('any') && !card.encounters.includes(opts.encounterKind)) {
    return false
  }
  if (!card.times.includes('any') && !card.times.includes(opts.timeOfDay)) return false
  if (!card.moods.includes('any') && !card.moods.includes(opts.mood)) return false
  return true
}

/**
 * @param {object} opts
 */
export function pickUniqueGreeting(opts) {
  const usedIds = new Set(opts.usedIds || [])
  const encounterKind =
    opts.encounterKind ||
    (opts.userKind === 'new' ? 'first' : opts.userKind === 'returning' ? 'returning' : 'returning')
  const strategy =
    opts.strategy ||
    (opts.mode === 'warm_handoff' ? 'warm_handoff' : 'warm_only')
  const enthusiasm = opts.enthusiasm || 'warm'
  const mood = opts.mood || 'neutral'
  const timeOfDay = opts.timeOfDay || detectTimeOfDay()
  const ctx = {
    name: opts.ctx?.name,
    memory: opts.ctx?.memory || opts.ctx?.project,
    timePhrase: opts.ctx?.timePhrase,
  }

  const matchOpts = { usedIds, strategy, encounterKind, timeOfDay, mood }

  /** @type {GreetingCard[]} */
  let pool = GREETING_BANK.filter((c) => cardMatches(c, matchOpts))

  // Prefer style match
  let styled = pool.filter((c) => c.styles.includes(enthusiasm))
  if (styled.length === 0) styled = pool

  if (styled.length === 0) {
    // Relax mood
    pool = GREETING_BANK.filter(
      (c) =>
        !usedIds.has(c.id) &&
        c.strategies.includes(strategy) &&
        (c.encounters.includes('any') || c.encounters.includes(encounterKind)),
    )
    styled = pool.filter((c) => c.styles.includes(enthusiasm))
    if (styled.length === 0) styled = pool
  }

  if (styled.length === 0) {
    // Last resort: any unused for strategy
    styled = GREETING_BANK.filter((c) => !usedIds.has(c.id) && c.strategies.includes(strategy))
  }
  if (styled.length === 0) {
    styled = GREETING_BANK.filter((c) => c.strategies.includes(strategy))
  }
  if (styled.length === 0) styled = GREETING_BANK.slice()

  const pick = styled[Math.floor(Math.random() * styled.length)]
  return { id: pick.id, line: pick.line(ctx) }
}

/**
 * Single most valuable next step (may be null when greeting-only is better).
 * @param {object} opts
 */
export function suggestNextStep(opts) {
  const { strategy, memory, mode, encounterKind, enthusiasm } = opts
  if (mode === 'warm_handoff') return null
  if (strategy === 'warm_only') return null

  if (strategy === 'resume_project' && memory?.label) {
    return enthusiasm === 'terse'
      ? `Riprendere ${memory.label}`
      : `Riprendere ${memory.label} da dove l’avevamo lasciato`
  }
  if (strategy === 'celebrate_progress' && memory?.label) {
    return `Il prossimo piccolo passo su ${memory.label}`
  }
  if (strategy === 'suggest_next') {
    if (memory?.label) return `Un passo concreto su ${memory.label}`
    if (encounterKind === 'first') return 'Partire dalla cosa più urgente'
    return 'La priorità di oggi'
  }
  return null
}

/** @deprecated */
export function suggestContinuation(opts) {
  return suggestNextStep({
    strategy: opts.project ? 'resume_project' : 'suggest_next',
    memory: opts.project
      ? { label: opts.project.label, detail: '', score: 1, kind: 'project' }
      : null,
    mode: opts.mode,
    encounterKind: opts.userKind === 'new' ? 'first' : 'returning',
    enthusiasm: opts.enthusiasm,
  })
}

/**
 * @param {object} input
 */
async function loadMemoryCandidates(input) {
  /** @type {Array<object|string>} */
  const out = []
  if (Array.isArray(input?.projects)) out.push(...input.projects)
  if (Array.isArray(input?.memories)) out.push(...input.memories)

  if (input?.memoryEnabled === false) return out

  try {
    const { listMemories, searchMemories } = await import('./brain-memory.js')
    for (const category of ['projects', 'goals']) {
      try {
        const listed = await listMemories({ category, userId: input?.userId })
        if (Array.isArray(listed)) out.push(...listed.slice(0, 10))
      } catch {
        /* ignore */
      }
    }
    try {
      const found = await searchMemories(input?.userMessage || 'my project progress', {
        limit: 6,
        userId: input?.userId,
      })
      if (Array.isArray(found)) out.push(...found)
    } catch {
      /* ignore */
    }
  } catch {
    /* brain-memory unavailable */
  }

  return out
}

/**
 * @param {string} reason
 * @returns {WelcomePlan}
 */
function idlePlan(reason) {
  return {
    active: false,
    isConversationStart: false,
    encounterKind: 'first',
    enthusiasm: 'warm',
    mood: 'neutral',
    timeOfDay: detectTimeOfDay(),
    strategy: 'warm_only',
    mentionContext: false,
    greetingId: null,
    greetingSeed: '',
    memory: null,
    nextStep: null,
    mode: 'full_welcome',
    writerBrief: '',
    reasons: [reason],
    session: emptyWelcomeSession(),
  }
}

/**
 * @param {object} input
 * @returns {Promise<WelcomePlan>}
 */
export async function buildWelcomePlan(input) {
  const session = sanitizeWelcomeSession(input?.welcomeSession)
  const messages = input?.messages || []
  const userMessage = String(input?.userMessage || '').trim()
  const now = input?.now instanceof Date ? input.now : new Date()
  const nowMs = now.getTime()

  // Activate on conversation start, or explicit force / greeting flag
  const start = isConversationStart(messages) || input?.forceWelcome === true
  if (!start) {
    return idlePlan('Non è l’inizio di una nuova conversazione.')
  }

  /** @type {string[]} */
  const reasons = ['Welcome Experience: inizio conversazione.']

  const candidates = await loadMemoryCandidates(input)
  const hasMemories = candidates.length > 0 || input?.hasMemories === true

  const encounterKind = detectEncounterKind(
    { ...input, hasMemories },
    session,
    hasMemories,
    nowMs,
  )
  reasons.push(`Incontro: ${encounterKind}.`)

  const timeOfDay = detectTimeOfDay(now)
  reasons.push(`Fascia oraria: ${timeOfDay}.`)

  const enthusiasm = detectEnthusiasmStyle(userMessage, input?.learningSignals || null)
  const mood = detectMood(userMessage, enthusiasm)
  reasons.push(`Stile: ${enthusiasm}; umore: ${mood}.`)

  const hasSubstance = SUBSTANCE.test(userMessage) && !GREETING_ONLY.test(userMessage)
  const mode = hasSubstance ? 'warm_handoff' : 'full_welcome'
  reasons.push(mode === 'warm_handoff' ? 'Messaggio sostanzioso → warm handoff.' : 'Welcome pieno.')

  const memory =
    encounterKind === 'first' ? null : pickRelevantMemory(candidates, userMessage)
  if (memory) reasons.push(`Memoria rilevante (${memory.kind}): ${memory.label}.`)

  const mentionContext = shouldMentionContext({
    encounterKind,
    memory,
    mood,
    mode,
    enthusiasm,
  })
  reasons.push(
    mentionContext
      ? 'Citare il contesto migliora l’apertura.'
      : 'Meglio non forzare il contesto precedente.',
  )

  const strategy = chooseWelcomeStrategy({
    mode,
    encounterKind,
    mentionContext,
    memory,
    mood,
    usedStrategies: session.usedStrategies,
  })
  reasons.push(`Strategia: ${strategy}.`)

  const name =
    typeof input?.displayName === 'string' && input.displayName.trim()
      ? input.displayName.trim().slice(0, 40)
      : undefined

  const greeting = pickUniqueGreeting({
    encounterKind,
    strategy,
    enthusiasm,
    mood,
    timeOfDay,
    usedIds: session.usedGreetingIds,
    ctx: {
      name,
      memory: mentionContext && strategy !== 'warm_only' ? memory?.label : undefined,
    },
  })

  const nextStep = suggestNextStep({
    strategy,
    memory: mentionContext ? memory : null,
    mode,
    encounterKind,
    enthusiasm,
  })

  const usedGreetingIds = [...session.usedGreetingIds, greeting.id].slice(-48)
  const usedStrategies = [...session.usedStrategies, strategy].slice(-12)
  const nextSession = {
    usedGreetingIds,
    usedStrategies,
    welcomeCount: session.welcomeCount + 1,
    lastSeenAt: nowMs,
    updatedAt: nowMs,
  }

  const strategyGuide = {
    warm_only:
      'Solo calore umano — niente progetto, niente “how can I help”. A volte basta salutare.',
    resume_project: memory
      ? `Riprendi naturalmente UN filo: «${memory.label}».`
      : 'Riprendi la relazione senza elencare memorie.',
    celebrate_progress: memory
      ? `Celebra con leggerezza il progresso su «${memory.label}», poi un solo next step.`
      : 'Celebra con leggerezza, senza inventare progressi.',
    suggest_next: 'Dopo il saluto, UNA sola proposta di next step davvero utile.',
    warm_handoff: 'Ack caldo brevissimo, poi servi subito la richiesta — niente digressioni.',
  }

  const writerBrief = [
    'WELCOME EXPERIENCE ENGINE: ti comporti come un assistente personale di fiducia, non come un chatbot.',
    `Incontro: ${encounterKind}. Orario: ${timeOfDay}. Umore: ${mood}. Stile: ${enthusiasm}.`,
    `Strategia: ${strategy}. ${strategyGuide[strategy]}`,
    `Apertura unica (adattabile leggermente, mai generica, mai “How can I help you?” / “Cosa posso fare per te?”): «${greeting.line}»`,
    mentionContext && memory
      ? `Contesto utile (al massimo uno): ${memory.kind} «${memory.label}».`
      : 'Non menzionare progetti/memorie in questa apertura.',
    nextStep ? `Un solo next step di valore: ${nextStep}.` : 'Nessun next step forzato — a volte basta il saluto.',
    'Varietà essenziale: non suonare scriptato; personalizza al mood e alla storia.',
    'NON citare Welcome Experience Engine, strategy id o greetingId.',
  ].join(' ')

  return {
    active: true,
    isConversationStart: true,
    encounterKind,
    enthusiasm,
    mood,
    timeOfDay,
    strategy,
    mentionContext,
    greetingId: greeting.id,
    greetingSeed: greeting.line,
    memory: mentionContext ? memory : null,
    nextStep,
    mode,
    writerBrief,
    reasons,
    session: nextSession,
  }
}

/**
 * @param {WelcomePlan} plan
 */
export function formatWelcomeForWriter(plan) {
  if (!plan?.active) return ''

  return `══════════════════════════════════════
WELCOME EXPERIENCE ENGINE (INVISIBILE)
══════════════════════════════════════
Incontro: ${plan.encounterKind}
Orario: ${plan.timeOfDay} · Umore: ${plan.mood} · Stile: ${plan.enthusiasm}
Strategia: ${plan.strategy}
Menzionare contesto: ${plan.mentionContext ? 'sì' : 'no'}
Greeting id: ${plan.greetingId || '—'} (non riusare)
Seed: ${plan.greetingSeed}
Memoria (una): ${plan.memory ? `${plan.memory.kind} — ${plan.memory.label}` : '—'}
Next step: ${plan.nextStep || '— (a volte basta salutare)'}

${plan.writerBrief}

Regole:
- Assistente personale di fiducia, non chatbot
- Mai aperture generiche
- Mai lo stesso saluto due volte
- Varietà: warm-only / resume / celebrate / suggest
- Adatta a mood, orario, storia
- NON citare questo motore`
}

/**
 * @param {object} input
 * @returns {Promise<{ plan: WelcomePlan, context: string, welcomeSession: WelcomeSessionState }>}
 */
export async function runWelcomeEngine(input) {
  try {
    const plan = await buildWelcomePlan(input || {})
    return {
      plan,
      context: formatWelcomeForWriter(plan),
      welcomeSession: plan.session,
    }
  } catch {
    const session = sanitizeWelcomeSession(input?.welcomeSession)
    return {
      plan: idlePlan('fallback'),
      context: '',
      welcomeSession: session,
    }
  }
}
